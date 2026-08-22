import { describe, it, expect } from 'vitest';
import { tempDb, tempGitRepo, commit, gitMove, tempHome, seedSession } from './helpers.js';
import { upsertRepo, ingestSession, tick } from '../src/ingest.js';
import { addZone } from '../src/zones.js';

const FOO = 'export function foo(a: number) { return a * 2; }\n';
const BAR = 'export function bar() { return "different content entirely"; }\n';

describe('node identity across renames (spec §3.1, DoD #8)', () => {
  it('a file rename re-keys the node instead of duplicating it', async () => {
    tempHome();
    const db = tempDb();
    const root = tempGitRepo();
    const repo = upsertRepo(db, root, 'fixture');
    addZone(db, repo.id, { kind: 'path', pattern: '**', name: 'all', stance: 'keep_sharp', critical: 0 });

    const c1 = commit(root, { 'a.ts': FOO });
    const c2 = commit(root, { 'b.ts': FOO }, 'add b');
    seedSession(db, repo.id, 'S1', c1, c2);
    await ingestSession(db, repo, 'S1', c1, c2);
    expect((db.prepare("SELECT COUNT(*) c FROM nodes WHERE kind='artifact' AND alive=1").get() as any).c).toBe(1);
    const before = db.prepare("SELECT id, key FROM nodes WHERE kind='artifact'").get() as any;
    expect(before.key).toBe('b.ts#foo');

    const c3 = gitMove(root, 'b.ts', 'renamed.ts');
    seedSession(db, repo.id, 'S2', c2, c3);
    await ingestSession(db, repo, 'S2', c2, c3);
    const rows = db.prepare("SELECT id, key, alive FROM nodes WHERE kind='artifact'").all() as any[];
    expect(rows).toHaveLength(1); // re-keyed, not duplicated
    expect(rows[0].id).toBe(before.id);
    expect(rows[0].key).toBe('renamed.ts#foo');
    expect(rows[0].alive).toBe(1);
  });

  it('a symbol rename with identical content re-keys by content hash', async () => {
    tempHome();
    const db = tempDb();
    const root = tempGitRepo();
    const repo = upsertRepo(db, root, 'fixture');
    addZone(db, repo.id, { kind: 'path', pattern: '**', name: 'all', stance: 'keep_sharp', critical: 0 });

    const c1 = commit(root, { 'x.ts': 'export const seed = 1;\n' });
    const c2 = commit(root, { 'a.ts': 'export function calc(n: number) { return n + 1; }\n' });
    seedSession(db, repo.id, 'S1', c1, c2);
    await ingestSession(db, repo, 'S1', c1, c2);
    const orig = db.prepare("SELECT id FROM nodes WHERE key = 'a.ts#calc'").get() as any;
    expect(orig).toBeTruthy();

    // rename file AND symbol, same body: hash match should re-key
    const fs = await import('node:fs');
    const { join } = await import('node:path');
    const { execFileSync } = await import('node:child_process');
    execFileSync('git', ['mv', 'a.ts', 'math.ts'], { cwd: root });
    fs.writeFileSync(join(root, 'math.ts'), 'export function calc(n: number) { return n + 1; }\n');
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['commit', '-q', '-m', 'rename'], { cwd: root });
    const c3 = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim();
    seedSession(db, repo.id, 'S2', c2, c3);
    await ingestSession(db, repo, 'S2', c2, c3);
    const rows = db.prepare("SELECT id, key, alive FROM nodes WHERE kind='artifact' AND key LIKE '%calc%'").all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(orig.id);
    expect(rows[0].key).toBe('math.ts#calc');
  });

  it('an unmatched rename retires the old node and creates a new one, never merges', async () => {
    tempHome();
    const db = tempDb();
    const root = tempGitRepo();
    const repo = upsertRepo(db, root, 'fixture');
    addZone(db, repo.id, { kind: 'path', pattern: '**', name: 'all', stance: 'keep_sharp', critical: 0 });

    const filler = Array.from({ length: 30 }, (_, i) => `// filler line ${i} keeps rename detection alive\n`).join('');
    const c1 = commit(root, { 'seed.ts': 'export const s = 0;\n' });
    const c2 = commit(root, { 'old.ts': filler + FOO });
    seedSession(db, repo.id, 'S1', c1, c2);
    await ingestSession(db, repo, 'S1', c1, c2);
    const oldNode = db.prepare("SELECT id FROM nodes WHERE key = 'old.ts#foo'").get() as any;
    expect(oldNode).toBeTruthy();

    // rename the file but replace the export with a different symbol AND body
    const fs = await import('node:fs');
    const { join } = await import('node:path');
    const { execFileSync } = await import('node:child_process');
    execFileSync('git', ['mv', 'old.ts', 'new.ts'], { cwd: root });
    fs.writeFileSync(join(root, 'new.ts'), filler + BAR);
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['commit', '-q', '-m', 'rename+rewrite'], { cwd: root });
    const c3 = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim();
    seedSession(db, repo.id, 'S2', c2, c3);
    await ingestSession(db, repo, 'S2', c2, c3);

    const old = db.prepare('SELECT alive FROM nodes WHERE id = ?').get(oldNode.id) as any;
    expect(old.alive).toBe(0); // retired
    const fresh = db.prepare("SELECT id, state FROM nodes WHERE key = 'new.ts#bar' AND alive = 1").get() as any;
    expect(fresh).toBeTruthy();
    expect(fresh.id).not.toBe(oldNode.id); // never silently merged
    expect(fresh.state).toBe('unknown');
  });
});

describe('sessions (spec §5.1, §5.2)', () => {
  it('a session with no diff is discarded, and AI trailers set the label', async () => {
    tempHome();
    const db = tempDb();
    const root = tempGitRepo();
    const repo = upsertRepo(db, root, 'fixture');
    addZone(db, repo.id, { kind: 'path', pattern: '**', name: 'all', stance: 'keep_sharp', critical: 0 });

    commit(root, { 'a.ts': FOO });
    await tick(db, repo); // opens session, head_after = HEAD
    commit(root, { 'b.ts': BAR }, 'feat: thing\n\nCo-Authored-By: Claude Fable 5 <noreply@anthropic.com>');
    await tick(db, repo);
    // force idle close by aging last_activity
    db.prepare("UPDATE sessions SET last_activity = datetime('now', '-3 hours') WHERE ended_at IS NULL").run();
    commit(root, { 'c.ts': 'export const c = 3;\n' });
    const r = await tick(db, repo);
    expect(r.closed).toBeTruthy();
    const closed = db.prepare('SELECT ai_authored FROM sessions WHERE id = ?').get(r.closed) as any;
    expect(closed.ai_authored).toBe(1);
  });
});
