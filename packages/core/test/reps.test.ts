import { describe, it, expect } from 'vitest';
import { tempDb, seedRepo, seedNode, FakeBackend } from './helpers.js';
import { askRep, answerRep, recordConfidenceAfter, isNonAnswer } from '../src/reps.js';
import { ulid, nowIso } from '../src/util.js';

function seedDossier(db: any, nodeId: string, withBody = true) {
  const body = {
    what_it_does_here: 'validates env config at boot in src/env.ts',
    replaced: null,
    if_it_vanished: 'hand-write the runtime validation for 14 env vars',
    probe_question: 'What happens at boot when an env var fails validation?',
    probe_expected: 'The process exits before the server binds; zod throws in src/env.ts.',
  };
  db.prepare('INSERT INTO dossiers (id, node_id, body_json, impact_json, fetched_at) VALUES (?, ?, ?, ?, ?)')
    .run(ulid(), nodeId, withBody ? JSON.stringify(body) : null, JSON.stringify({ installSizeBytes: 700000 }), nowIso());
}

describe('rep flow: withhold before reveal (hard rules 2 and 3, DoD #4, #9)', () => {
  it('the ask payload NEVER contains probe_expected or any reveal field', () => {
    const db = tempDb();
    const repo = seedRepo(db);
    const node = seedNode(db, repo);
    seedDossier(db, node);
    const q = askRep(db, node)!;
    const serialized = JSON.stringify(q);
    expect(serialized).not.toContain('probe_expected');
    expect(serialized).not.toContain('correct answer');
    expect(serialized).not.toContain('what_it_does_here');
    expect(serialized).not.toContain('if_it_vanished');
    expect(serialized).not.toContain('process exits'); // the withheld content itself
    expect(q.question).toContain('boot');
    // the reveal payload only exists after an answer: revealed_at is NULL until then
    const row = db.prepare('SELECT revealed_at, answered_at FROM reps WHERE id = ?').get(q.repId) as any;
    expect(row.revealed_at).toBeNull();
    expect(row.answered_at).toBeNull();
  });

  it('answering requires confidence 1..7 and returns the reveal with the delta', async () => {
    const db = tempDb();
    const repo = seedRepo(db);
    const node = seedNode(db, repo);
    seedDossier(db, node);
    const q = askRep(db, node)!;
    const backend = new FakeBackend([{ verdict: 'pass', gap: '', grader_confidence: 'high' }]);
    await expect(answerRep(db, backend, q.repId, 9, 'x')).rejects.toThrow(/1\.\.7/);
    const reveal = await answerRep(db, backend, q.repId, 6, 'zod throws and the process exits before listen()');
    expect(reveal.verdict).toBe('pass');
    expect(reveal.confidenceBefore).toBe(6);
    expect(reveal.demonstrated).toBe(7);
    expect(reveal.delta).toBe(-1);
    expect(reveal.body?.what_it_does_here).toContain('validates env');
    expect((reveal.body as any).probe_expected).toBeUndefined(); // expected answer stays server-side even in the reveal
    recordConfidenceAfter(db, q.repId, 6);
    const row = db.prepare('SELECT confidence_before, confidence_after, verdict FROM reps WHERE id = ?').get(q.repId) as any;
    expect(row).toEqual({ confidence_before: 6, confidence_after: 6, verdict: 'pass' });
  });

  it('a rep cannot be answered twice', async () => {
    const db = tempDb();
    const repo = seedRepo(db);
    const node = seedNode(db, repo);
    seedDossier(db, node);
    const q = askRep(db, node)!;
    const backend = new FakeBackend([{ verdict: 'pass', gap: '', grader_confidence: 'high' }]);
    await answerRep(db, backend, q.repId, 5, 'answer');
    await expect(answerRep(db, backend, q.repId, 5, 'again')).rejects.toThrow(/already answered/);
  });

  it('state ordering: pass on a fresh node lands at defended; fail lands at explained', async () => {
    const db = tempDb();
    const repo = seedRepo(db);

    const n1 = seedNode(db, repo);
    seedDossier(db, n1);
    const q1 = askRep(db, n1)!;
    await answerRep(db, new FakeBackend([{ verdict: 'pass', gap: '', grader_confidence: 'high' }]), q1.repId, 7, 'good answer');
    expect((db.prepare('SELECT state FROM nodes WHERE id = ?').get(n1) as any).state).toBe('defended');

    const n2 = seedNode(db, repo);
    seedDossier(db, n2);
    const q2 = askRep(db, n2)!;
    await answerRep(db, new FakeBackend([{ verdict: 'fail', gap: 'did not know the boot behaviour', grader_confidence: 'high' }]), q2.repId, 7, 'no idea');
    // the reveal they just read is what explained means; fail does not demote below it
    expect((db.prepare('SELECT state FROM nodes WHERE id = ?').get(n2) as any).state).toBe('explained');

    // but a fail on an ALREADY explained node demotes to unknown
    const q3 = askRep(db, n2)!;
    await answerRep(db, new FakeBackend([{ verdict: 'fail', gap: 'still no', grader_confidence: 'high' }]), q3.repId, 4, 'nope');
    expect((db.prepare('SELECT state FROM nodes WHERE id = ?').get(n2) as any).state).toBe('unknown');
  });

  it('grading degrades to ungraded on extraction failure, and ungraded never promotes (hard rule 9)', async () => {
    const db = tempDb();
    const repo = seedRepo(db);
    const node = seedNode(db, repo);
    seedDossier(db, node);
    const q = askRep(db, node)!;
    const reveal = await answerRep(db, new FakeBackend([], true), q.repId, 6, 'a decent answer');
    expect(reveal.verdict).toBe('ungraded');
    // reveal still promotes unknown -> explained (they read it), but no further
    expect(reveal.stateNow).toBe('explained');
  });

  it('a low-confidence pass grades as ungraded (never promotes on a shaky grade)', async () => {
    const db = tempDb();
    const repo = seedRepo(db);
    const node = seedNode(db, repo, { state: 'explained' });
    seedDossier(db, node);
    const q = askRep(db, node)!;
    const reveal = await answerRep(db, new FakeBackend([{ verdict: 'pass', gap: '', grader_confidence: 'low' }]), q.repId, 6, 'maybe right');
    expect(reveal.verdict).toBe('ungraded');
    expect(reveal.stateNow).toBe('explained');
  });

  it('works with zero extraction: fallback probe, impact-only dossier', async () => {
    const db = tempDb();
    const repo = seedRepo(db);
    const node = seedNode(db, repo, { label: 'drizzle-orm' });
    seedDossier(db, node, false); // no body: extraction was down
    const q = askRep(db, node)!;
    expect(q.question).toContain('vanished');
    const reveal = await answerRep(db, new FakeBackend([], true), q.repId, 5, 'rewrite queries by hand');
    expect(reveal.verdict).toBe('ungraded');
    expect(reveal.impact.installSizeBytes).toBe(700000);
  });

  it('"I don\'t know" gets the answer taught, with no grader call', async () => {
    const db = tempDb();
    const repo = seedRepo(db);
    const node = seedNode(db, repo);
    seedDossier(db, node);
    const q = askRep(db, node)!;
    const backend = new FakeBackend([{ verdict: 'pass', gap: '', grader_confidence: 'high' }]);
    const reveal = await answerRep(db, backend, q.repId, 5, 'i dont know');

    expect(backend.calls).toHaveLength(0); // nothing to grade, so nothing is spent
    expect(reveal.saidUnsure).toBe(true);
    expect(reveal.verdict).toBe('fail');
    // the whole point: the answer they did not have is now in front of them
    expect(reveal.expectedAnswer).toContain('process exits');
    expect(reveal.body?.what_it_does_here).toContain('validates env');
    // and the delta still lands, because the delta is the product
    expect(reveal.demonstrated).toBe(1);
    expect(reveal.delta).toBe(4);
    // non-empty gap keeps it in the card queue, phrased as teaching not scolding
    const row = db.prepare('SELECT gap_text FROM reps WHERE id = ?').get(q.repId) as any;
    expect(row.gap_text).toBeTruthy();
  });

  it('a hedge that still makes a claim is graded on the claim, not waved through', async () => {
    const db = tempDb();
    const repo = seedRepo(db);
    const node = seedNode(db, repo);
    seedDossier(db, node);
    const q = askRep(db, node)!;
    const backend = new FakeBackend([{ verdict: 'partial', gap: 'zod throws in src/env.ts', grader_confidence: 'high' }]);
    const reveal = await answerRep(
      db, backend, q.repId, 5,
      'i dont know exactly where, but i think it validates something at startup',
    );
    expect(backend.calls).toHaveLength(1);
    expect(reveal.saidUnsure).toBe(false);
    expect(reveal.verdict).toBe('partial');
    expect(reveal.expectedAnswer).toContain('process exits'); // taught on partial too
  });

  it('the answer is taught on every verdict short of a pass, and never before the answer', async () => {
    const db = tempDb();
    const repo = seedRepo(db);
    const node = seedNode(db, repo);
    seedDossier(db, node);
    const q = askRep(db, node)!;
    expect(JSON.stringify(q)).not.toContain('process exits'); // rule 3 still holds
    const reveal = await answerRep(db, new FakeBackend([], true), q.repId, 6, 'something plausible');
    expect(reveal.verdict).toBe('ungraded'); // grader down: still teach
    expect(reveal.expectedAnswer).toContain('process exits');
  });

  it('out-of-zone and dead nodes never get reps (hard rule 4)', () => {
    const db = tempDb();
    const repo = seedRepo(db);
    expect(askRep(db, seedNode(db, repo, { in_zone: 0 }))).toBeNull();
    expect(askRep(db, seedNode(db, repo, { alive: 0 }))).toBeNull();
  });
});

describe('isNonAnswer: an honest "no idea" versus a real attempt', () => {
  it('catches bare disclaimers', () => {
    for (const t of [
      'i dont know', "I don't know.", 'I do not know', 'idk', 'dunno', 'no idea',
      'no clue', 'honestly no idea', 'not sure', 'not really sure', 'unsure',
      'i cant remember', 'i forget', 'i dont remember at all', 'no idea sorry',
      '?', '...', 'n/a', 'nope', '', '   ',
    ]) {
      expect(isNonAnswer(t), t).toBe(true);
    }
  });

  it('leaves anything carrying a claim to the grader', () => {
    for (const t of [
      'i dont know exactly where it is instantiated, but i know it was used for payments',
      'not sure of the file, but zod validates env vars at boot',
      'it exits before the server binds',
      'src/env.ts, line 40ish',
      'maybe the boot sequence',
    ]) {
      expect(isNonAnswer(t), t).toBe(false);
    }
  });
});
