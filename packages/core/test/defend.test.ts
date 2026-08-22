import { describe, it, expect } from 'vitest';
import { tempDb, seedRepo, seedNode, seedSession, FakeBackend, tempGitRepo, commit, tempHome } from './helpers.js';
import { askRep, answerDefend, DEFEND_QUESTION } from '../src/reps.js';
import { clusterSession } from '../src/features.js';
import { generateBriefs } from '../src/brief.js';
import { buildDigest } from '../src/digest.js';
import { upsertRepo, ingestSession } from '../src/ingest.js';
import { addZone } from '../src/zones.js';
import { ulid, nowIso } from '../src/util.js';

const BRIEF = {
  name: 'wishlist persistence',
  approach: ['store wishlist ids in localStorage', 'hydrate on mount', 'sync to the api on login'],
  concepts: ['optimistic local state', 'hydration on mount'],
  rejected: [{ option: 'server-only storage', why_not: 'needs auth before the first add' }],
  assumptions: ['localStorage is available and not full', 'ids stay stable across releases'],
  breaks_first: ['private browsing blocks localStorage', 'quota exceeded on large lists', 'id format changes'],
  flow_correct: 'add() writes to localStorage first, then the effect pushes to the api',
  flow_distractors: [
    'the api write happens first and localStorage mirrors the response',
    'the reducer writes both in the same synchronous tick',
    'hydration reads from the api and ignores localStorage entirely',
  ],
};

let seq = 0;
function seedDecision(db: any, repoId: string, state = 'unknown') {
  const nodeId = seedNode(db, repoId, { kind: 'decision', key: `decision:abc:store${seq++}`, label: BRIEF.name, state });
  const sessionId = seedSession(db, repoId, ulid(), 'aaa', 'bbb');
  db.prepare('INSERT INTO briefs (id, node_id, session_id, body_json, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(ulid(), nodeId, sessionId, JSON.stringify(BRIEF), nowIso());
  return nodeId;
}

describe('Defend rep: withholding (hard rule 3, DoD #4)', () => {
  it('the ask reveals the options but never which is correct, nor any brief content', () => {
    const db = tempDb();
    const repo = seedRepo(db);
    const node = seedDecision(db, repo);
    const q = askRep(db, node)!;
    const serialized = JSON.stringify(q);

    expect(q.type).toBe('defend');
    expect(q.question).toBe(DEFEND_QUESTION);
    expect(q.flowOptions).toHaveLength(4);
    // the correct answer is present among the options, but nothing marks it
    expect(q.flowOptions).toContain(BRIEF.flow_correct);
    expect(serialized).not.toContain('flow_correct');
    expect(serialized).not.toContain('flow_distractors');
    // and none of the actual brief leaks
    expect(serialized).not.toContain('localStorage is available and not full');
    expect(serialized).not.toContain('private browsing');
    expect(serialized).not.toContain('server-only storage');
    for (const line of BRIEF.approach) expect(serialized).not.toContain(line);
  });

  it('option order is stable across re-asks and does not depend on correctness', () => {
    const db = tempDb();
    const repo = seedRepo(db);
    const node = seedDecision(db, repo);
    const a = askRep(db, node)!;
    const b = askRep(db, node)!;
    expect(b.repId).toBe(a.repId);
    expect(b.flowOptions).toEqual(a.flowOptions);
  });

  it('a decision node with no brief never produces a rep', () => {
    const db = tempDb();
    const repo = seedRepo(db);
    const bare = seedNode(db, repo, { kind: 'decision', key: 'decision:x:y', label: 'no brief' });
    expect(askRep(db, bare)).toBeNull();
  });
});

describe('Defend rep: grading and state', () => {
  it('a good reconstruction plus the right flow passes and reaches defended', async () => {
    const db = tempDb();
    const repo = seedRepo(db);
    const node = seedDecision(db, repo, 'explained');
    const q = askRep(db, node)!;
    const backend = new FakeBackend([{ verdict: 'pass', gap: '', grader_confidence: 'high' }]);
    const r = await answerDefend(db, backend, q.repId, 6, 'writes wishlist ids to localStorage then syncs, assuming storage is available', BRIEF.flow_correct);
    expect(r.verdict).toBe('pass');
    expect(r.flowWasRight).toBe(true);
    expect(r.stateNow).toBe('defended');
    expect(r.brief.approach).toEqual(BRIEF.approach);
    expect((r.brief as any).flow_distractors).toBeUndefined();
  });

  it('recognition can pull a pass down to partial but never lifts a fail', async () => {
    const db = tempDb();
    const repo = seedRepo(db);

    const n1 = seedDecision(db, repo, 'explained');
    const q1 = askRep(db, n1)!;
    const r1 = await answerDefend(db, new FakeBackend([{ verdict: 'pass', gap: '', grader_confidence: 'high' }]),
      q1.repId, 6, 'good reconstruction', BRIEF.flow_distractors[0]);
    expect(r1.verdict).toBe('partial');
    expect(r1.flowWasRight).toBe(false);
    expect(r1.stateNow).toBe('explained'); // partial never promotes

    const n2 = seedDecision(db, repo, 'explained');
    const q2 = askRep(db, n2)!;
    const r2 = await answerDefend(db, new FakeBackend([{ verdict: 'fail', gap: 'missed the assumption', grader_confidence: 'high' }]),
      q2.repId, 7, 'no idea', BRIEF.flow_correct);
    expect(r2.verdict).toBe('fail'); // guessing the flow right does not rescue it
    expect(r2.delta).toBe(6);
  });

  it('degrades to ungraded when extraction is down, and never promotes', async () => {
    const db = tempDb();
    const repo = seedRepo(db);
    const node = seedDecision(db, repo, 'explained');
    const q = askRep(db, node)!;
    const r = await answerDefend(db, new FakeBackend([], true), q.repId, 5, 'some answer', BRIEF.flow_correct);
    expect(r.verdict).toBe('ungraded');
    expect(r.stateNow).toBe('explained');
  });

  it('cannot be answered twice', async () => {
    const db = tempDb();
    const repo = seedRepo(db);
    const node = seedDecision(db, repo);
    const q = askRep(db, node)!;
    const b = () => new FakeBackend([{ verdict: 'pass', gap: '', grader_confidence: 'high' }]);
    await answerDefend(db, b(), q.repId, 5, 'x', BRIEF.flow_correct);
    await expect(answerDefend(db, b(), q.repId, 5, 'x', BRIEF.flow_correct)).rejects.toThrow(/already answered/);
  });
});

describe('feature clustering and brief generation', () => {
  it('clusters same-session artifacts by directory and skips singletons and out-of-zone dirs', async () => {
    tempHome();
    const db = tempDb();
    const root = tempGitRepo();
    const repo = upsertRepo(db, root, 'fx');
    addZone(db, repo.id, { kind: 'topic', pattern: '(^|/)store/', name: 'state', stance: 'keep_sharp', critical: 0 });

    const c1 = commit(root, { 'seed.ts': 'export const s = 0;\n' });
    const c2 = commit(root, {
      'store/cart.ts': 'export const useCart = () => 1;\n',
      'store/wishlist.ts': 'export const useWishlist = () => 2;\n',
      'lib/util.ts': 'export const helper = () => 3;\n', // out of zone
    });
    seedSession(db, repo.id, 'S1', c1, c2);
    await ingestSession(db, repo, 'S1', c1, c2);

    const clusters = clusterSession(db, repo.id, 'S1');
    expect(clusters).toHaveLength(1);
    expect(clusters[0].dir).toBe('store');
    expect(clusters[0].paths.sort()).toEqual(['store/cart.ts', 'store/wishlist.ts']);
  });

  it('generateBriefs creates a decision node with a withheld brief plus concept nodes', async () => {
    tempHome();
    const db = tempDb();
    const root = tempGitRepo();
    const repo = upsertRepo(db, root, 'fx');
    addZone(db, repo.id, { kind: 'topic', pattern: '(^|/)store/', name: 'state', stance: 'keep_sharp', critical: 0 });
    const c1 = commit(root, { 'seed.ts': 'export const s = 0;\n' });
    const c2 = commit(root, {
      'store/cart.ts': 'export const useCart = () => 1;\n',
      'store/wishlist.ts': 'export const useWishlist = () => 2;\n',
    });
    seedSession(db, repo.id, 'S1', c1, c2);
    await ingestSession(db, repo, 'S1', c1, c2);

    const res = await generateBriefs(db, repo, new FakeBackend([BRIEF]), 'S1');
    expect(res).toEqual({ created: 1, failed: 0 });

    const decision = db.prepare("SELECT id, label, state, in_zone FROM nodes WHERE kind = 'decision'").get() as any;
    expect(decision.label).toBe('wishlist persistence');
    expect(decision.state).toBe('unknown');
    expect(decision.in_zone).toBe(1);
    const concepts = db.prepare("SELECT label FROM nodes WHERE kind = 'concept' ORDER BY label").all() as any[];
    expect(concepts.map((c) => c.label)).toEqual(['hydration on mount', 'optimistic local state']);
    // the decision is linked to both artifacts and both concepts
    const edges = db.prepare("SELECT COUNT(*) c FROM edges WHERE from_node = ? AND rel = 'about'").get(decision.id) as any;
    expect(edges.c).toBe(4);
  });

  it('a failed extraction creates no half-built decision node', async () => {
    tempHome();
    const db = tempDb();
    const root = tempGitRepo();
    const repo = upsertRepo(db, root, 'fx');
    addZone(db, repo.id, { kind: 'topic', pattern: '(^|/)store/', name: 'state', stance: 'keep_sharp', critical: 0 });
    const c1 = commit(root, { 'seed.ts': 'export const s = 0;\n' });
    const c2 = commit(root, {
      'store/a.ts': 'export const a = () => 1;\n',
      'store/b.ts': 'export const b = () => 2;\n',
    });
    seedSession(db, repo.id, 'S1', c1, c2);
    await ingestSession(db, repo, 'S1', c1, c2);
    const res = await generateBriefs(db, repo, new FakeBackend([], true), 'S1');
    expect(res).toEqual({ created: 0, failed: 1 });
    expect(db.prepare("SELECT COUNT(*) c FROM nodes WHERE kind = 'decision'").get()).toEqual({ c: 0 });
    expect(db.prepare('SELECT COUNT(*) c FROM briefs').get()).toEqual({ c: 0 });
  });
});

describe('digest with defends (rule 5)', () => {
  it('puts dossiers first and includes at most one Defend rep', () => {
    const db = tempDb();
    const repo = seedRepo(db);
    for (let i = 0; i < 6; i++) seedNode(db, repo, { label: `dep${i}` });
    seedDecision(db, repo);
    seedDecision(db, repo);
    const items = buildDigest(db, repo);
    expect(items).toHaveLength(5);
    expect(items.filter((i) => i.kind === 'decision')).toHaveLength(1);
    expect(items[items.length - 1].kind).toBe('decision'); // dossiers first
  });
});
