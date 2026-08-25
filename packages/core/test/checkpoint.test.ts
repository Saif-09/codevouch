import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempDb, tempGitRepo, commit } from './helpers.js';
import {
  checkCheckpointEligibility, jitteredGapMinutes, openCheckpoint, recordCheckpoint,
  checkpointInFlight, checkpointInstruction, buildSubject, recall,
  MIN_GAP_MINUTES, MAX_GAP_MINUTES, BIG_SESSION_PROMPTS,
} from '../src/checkpoint.js';
import { calibration } from '../src/hunch.js';
import { ulid, nowIso } from '../src/util.js';

const SESSION = 'claude-session-1';

function seedRepoAt(db: any, root: string) {
  const id = 'REPO1';
  db.prepare('INSERT INTO repos (id, root, name, created_at) VALUES (?, ?, ?, ?)').run(id, root, 'r', nowIso());
  db.prepare("INSERT INTO sharp_zones (id, repo_id, kind, pattern, name, stance, critical, created_at) VALUES (?, ?, 'path', '**', 'all', 'keep_sharp', 0, ?)")
    .run(ulid(), id, nowIso());
  return id;
}

/** N prompts in this session, the first of them `minutesAgo` old. */
function seedPrompts(db: any, repoId: string, session: string, n: number, minutesAgo: number) {
  for (let i = 0; i < n; i++) {
    const at = `datetime('now', '-${Math.max(0, minutesAgo - i)} minutes')`;
    db.exec(
      `INSERT INTO prompts (id, repo_id, claude_session, seq, text, chars, at)
       VALUES ('${ulid()}', '${repoId}', '${session}', ${i + 1}, 'a prompt long enough to be substantive', 40, ${at})`,
    );
  }
}

describe('mid-session checkpoint', () => {
  it('stays quiet until the session is big on both time and prompt count', () => {
    const db = tempDb();
    const repoId = seedRepoAt(db, '/tmp/myrepo');

    // long enough, too few prompts
    seedPrompts(db, repoId, 's-few', 3, 200);
    expect(checkCheckpointEligibility(db, '/tmp/myrepo', 's-few').reason).toBe('session not big enough yet');

    // enough prompts, not long enough
    seedPrompts(db, repoId, 's-fast', BIG_SESSION_PROMPTS + 2, 10);
    expect(checkCheckpointEligibility(db, '/tmp/myrepo', 's-fast').reason).toBe('session not big enough yet');
  });

  it('fires at 1 to 2 hours in, never sooner', () => {
    const db = tempDb();
    const repoId = seedRepoAt(db, '/tmp/myrepo');

    // 50 minutes in: big enough to qualify, still inside the minimum gap
    seedPrompts(db, repoId, 's-50', BIG_SESSION_PROMPTS + 1, 50);
    const early = checkCheckpointEligibility(db, '/tmp/myrepo', 's-50');
    expect(early.eligible).toBe(false);
    expect(early.reason).toMatch(/next checkpoint in \d+ min/);

    // past the longest possible gap: eligible whatever the jitter chose
    seedPrompts(db, repoId, 's-late', BIG_SESSION_PROMPTS + 1, MAX_GAP_MINUTES + 5);
    expect(checkCheckpointEligibility(db, '/tmp/myrepo', 's-late').eligible).toBe(true);
  });

  it('spaces checkpoints 1 to 2 hours apart, deterministically', () => {
    for (const session of ['a', 'b', 'c', 'd', 'e']) {
      for (const ordinal of [0, 1, 2]) {
        const gap = jitteredGapMinutes(session, ordinal);
        expect(gap).toBeGreaterThanOrEqual(MIN_GAP_MINUTES);
        expect(gap).toBeLessThanOrEqual(MAX_GAP_MINUTES);
        expect(jitteredGapMinutes(session, ordinal)).toBe(gap); // same answer every time
      }
    }
    // the jitter actually varies rather than pinning to one end
    const spread = new Set(Array.from({ length: 40 }, (_, i) => jitteredGapMinutes(`s${i}`, 0)));
    expect(spread.size).toBeGreaterThan(5);
  });

  it('asks once and then waits: an unanswered checkpoint blocks the next one', () => {
    const db = tempDb();
    const repoId = seedRepoAt(db, '/tmp/myrepo');
    seedPrompts(db, repoId, SESSION, BIG_SESSION_PROMPTS + 1, MAX_GAP_MINUTES + 5);
    expect(checkCheckpointEligibility(db, '/tmp/myrepo', SESSION).eligible).toBe(true);

    openCheckpoint(db, repoId, SESSION, { files: ['src/a.ts'], churn: 40 });
    expect(checkpointInFlight(db, repoId)).toBe(true);
    expect(checkCheckpointEligibility(db, '/tmp/myrepo', SESSION).reason).toBe('checkpoint already in flight');

    recordCheckpoint(db, { repoRoot: '/tmp/myrepo', recalled: 'renamed the port helper', verdict: 'pass' });
    expect(checkpointInFlight(db, repoId)).toBe(false);
    // answered, so the clock restarts from the answer rather than firing again
    expect(checkCheckpointEligibility(db, '/tmp/myrepo', SESSION).eligible).toBe(false);
  });

  it('feeds Recall, and leaves Calibration and the Gap alone', () => {
    const db = tempDb();
    seedRepoAt(db, '/tmp/myrepo');
    const at = (verdict: any) => {
      openCheckpoint(db, 'REPO1', SESSION, { files: ['src/a.ts'], churn: 10 });
      recordCheckpoint(db, { repoRoot: '/tmp/myrepo', recalled: 'x', verdict });
    };
    at('pass');
    at('fail');
    expect(recall(db, 'REPO1')).toBe(50);

    // a skip is not a miss: declining is not the same as not knowing
    at('skip');
    expect(recall(db, 'REPO1')).toBe(50);

    // checkpoints are not reps, so neither of the other two numbers moves
    expect(calibration(db, 'REPO1')).toBeNull();
    expect((db.prepare('SELECT COUNT(*) AS c FROM reps').get() as any).c).toBe(0);
  });

  it('redacts the recall answer before it is written', () => {
    const db = tempDb();
    seedRepoAt(db, '/tmp/myrepo');
    openCheckpoint(db, 'REPO1', SESSION, { files: ['src/a.ts'], churn: 10 });
    recordCheckpoint(db, {
      repoRoot: '/tmp/myrepo',
      recalled: 'swapped the key for sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      verdict: 'partial',
    });
    const row = db.prepare('SELECT recalled FROM checkpoints LIMIT 1').get() as { recalled: string };
    expect(row.recalled).not.toContain('sk-ant-api03-AAAA');
  });

  it('builds its subject from what the session actually churned, not the conversation', async () => {
    const db = tempDb();
    const root = tempGitRepo();
    const repoId = seedRepoAt(db, root);
    const base = commit(root, { 'src/a.ts': 'const a = 1;\n', 'src/b.ts': 'const b = 1;\n' });
    db.prepare(
      `INSERT INTO sessions (id, repo_id, started_at, head_before, last_activity, ai_authored)
       VALUES (?, ?, ?, ?, ?, 1)`,
    ).run(ulid(), repoId, nowIso(), base, nowIso());

    // a.ts churns hard, b.ts barely
    writeFileSync(join(root, 'src/a.ts'), `${'const a = 1;\n'.repeat(30)}`);
    writeFileSync(join(root, 'src/b.ts'), 'const b = 2;\n');

    const subject = await buildSubject(db, repoId, root);
    expect(subject).not.toBeNull();
    expect(subject!.files[0]).toBe('src/a.ts'); // ranked by churn
    expect(subject!.churn).toBeGreaterThan(29);

    const text = checkpointInstruction(subject!, 95);
    expect(text).toContain('src/a.ts');
    expect(text).toContain('1.6 hours');
    expect(text).toContain('FROM MEMORY');
    expect(text).toContain('vouch_record_checkpoint');
    // it must not hand the answer over before asking
    expect(text).toContain('do NOT say what changed');
  });

  it('stays quiet when the session changed nothing', async () => {
    const db = tempDb();
    const root = tempGitRepo();
    const repoId = seedRepoAt(db, root);
    commit(root, { 'src/a.ts': 'const a = 1;\n' });
    expect(await buildSubject(db, repoId, root)).toBeNull();
  });

  it('never throws into the session when git is unavailable', async () => {
    const db = tempDb();
    const repoId = seedRepoAt(db, '/tmp/not-a-repo-at-all');
    expect(await buildSubject(db, repoId, '/tmp/not-a-repo-at-all')).toBeNull();
  });
});
