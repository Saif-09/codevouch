import { describe, it, expect } from 'vitest';
import { tempDb, seedRepo } from './helpers.js';
import {
  checkEligibility, isSubstantivePrompt, sampled, openHunch, recordHunch,
  calibration, hunchInstruction, DEFAULT_COOLDOWN_MINUTES,
} from '../src/hunch.js';
import { gapPerZone } from '../src/scoring.js';
import { ulid, nowIso } from '../src/util.js';

const ROOT = '/tmp/myrepo';
const PROMPT = 'why does the checkout webhook sometimes fire twice for the same order id?';

function seedRepoAt(db: any, root = ROOT) {
  const id = 'REPO1';
  db.prepare('INSERT INTO repos (id, root, name, created_at) VALUES (?, ?, ?, ?)').run(id, root, 'r', nowIso());
  db.prepare("INSERT INTO sharp_zones (id, repo_id, kind, pattern, name, stance, critical, created_at) VALUES (?, ?, 'path', '**', 'all', 'keep_sharp', 0, ?)")
    .run(ulid(), id, nowIso());
  return id;
}

/** Find a prompt id that the deterministic sampler accepts. */
function sampledId(oneIn: number): string {
  for (let i = 0; i < 500; i++) {
    const id = `p${i}`;
    if (sampled(id, oneIn)) return id;
  }
  throw new Error('no sampled id found');
}

describe('real-time hunch eligibility (RESEARCH §7.1)', () => {
  it('ignores trivial and short prompts', () => {
    expect(isSubstantivePrompt(PROMPT)).toBe(true);
    for (const p of ['go', 'yes', 'continue', 'ok thanks', 'next', 'fix it', 'do it please now ok']) {
      expect(isSubstantivePrompt(p), p).toBe(false);
    }
  });

  it('sampling is deterministic, so behaviour is testable rather than random', () => {
    const id = sampledId(3);
    expect(sampled(id, 3)).toBe(true);
    expect(sampled(id, 3)).toBe(true); // same answer every time
    expect(sampled('anything', 1)).toBe(true); // 1-in-1 always fires
  });

  it('fires only inside a registered repo that has keep-sharp zones', () => {
    const db = tempDb();
    const id = sampledId(1);
    expect(checkEligibility(db, ROOT, id, PROMPT, { sampleOneIn: 1 }).reason).toBe('repo not registered');

    const repo = 'REPO1';
    db.prepare('INSERT INTO repos (id, root, name, created_at) VALUES (?, ?, ?, ?)').run(repo, ROOT, 'r', nowIso());
    expect(checkEligibility(db, ROOT, id, PROMPT, { sampleOneIn: 1 }).reason).toBe('no keep-sharp zones');

    db.prepare("INSERT INTO sharp_zones (id, repo_id, kind, pattern, name, stance, critical, created_at) VALUES (?, ?, 'path', '**', 'all', 'keep_sharp', 0, ?)")
      .run(ulid(), repo, nowIso());
    expect(checkEligibility(db, ROOT, id, PROMPT, { sampleOneIn: 1 }).eligible).toBe(true);
  });

  it('matches a subdirectory of the repo, not just its root', () => {
    const db = tempDb();
    seedRepoAt(db);
    const id = sampledId(1);
    expect(checkEligibility(db, `${ROOT}/src/api`, id, PROMPT, { sampleOneIn: 1 }).eligible).toBe(true);
    expect(checkEligibility(db, '/tmp/otherrepo', id, PROMPT, { sampleOneIn: 1 }).eligible).toBe(false);
  });

  it('never fires twice while a hunch is in flight', () => {
    const db = tempDb();
    const repo = seedRepoAt(db);
    const id = sampledId(1);
    expect(checkEligibility(db, ROOT, id, PROMPT, { sampleOneIn: 1 }).eligible).toBe(true);
    openHunch(db, repo, id);
    // the user's reply to Claude's prediction question must not start another
    const second = checkEligibility(db, ROOT, sampledId(1), PROMPT, { sampleOneIn: 1 });
    expect(second.eligible).toBe(false);
    expect(second.reason).toBe('hunch already in flight');
  });

  it('cools down after a completed hunch', () => {
    const db = tempDb();
    const repo = seedRepoAt(db);
    openHunch(db, repo, 'p1');
    db.prepare("UPDATE reps SET answered_at = datetime('now') WHERE type = 'hunch'").run();
    expect(checkEligibility(db, ROOT, sampledId(1), PROMPT, { sampleOneIn: 1 }).reason).toBe('cooling down');

    db.prepare("UPDATE reps SET asked_at = datetime('now', ?) WHERE type = 'hunch'")
      .run(`-${DEFAULT_COOLDOWN_MINUTES + 5} minutes`);
    expect(checkEligibility(db, ROOT, sampledId(1), PROMPT, { sampleOneIn: 1 }).eligible).toBe(true);
  });

  it('respects sampling', () => {
    const db = tempDb();
    seedRepoAt(db);
    const misses = ['a', 'b', 'c', 'd', 'e'].filter((id) => !sampled(id, 3));
    expect(misses.length).toBeGreaterThan(0);
    expect(checkEligibility(db, ROOT, misses[0], PROMPT, { sampleOneIn: 3 }).reason).toBe('not sampled');
  });

  it('the injected instruction never blocks and never rewrites the request', () => {
    const text = hunchInstruction();
    expect(text).toMatch(/before you answer/i);
    expect(text).toMatch(/wait for their reply/i);
    expect(text).toMatch(/answer the original request normally/i);
    expect(text).toMatch(/vouch_record_hunch/);
    expect(text).toMatch(/skip/i);                       // an escape hatch always exists
    expect(text).toMatch(/do not let it change what you would otherwise answer/i);
  });
});

describe('recording hunches and calibration (spec §9)', () => {
  it('records a hit and a miss, and computes calibration', () => {
    const db = tempDb();
    const repo = seedRepoAt(db);
    expect(calibration(db, repo)).toBeNull(); // no data, not zero

    recordHunch(db, { repoRoot: ROOT, topic: 'webhook idempotency', prediction: 'missing idempotency key', matched: true });
    expect(calibration(db, repo)).toBe(100);

    recordHunch(db, { repoRoot: ROOT, topic: 'react hydration', prediction: 'a css problem', matched: false, note: 'it was a server/client markup mismatch' });
    expect(calibration(db, repo)).toBe(50);

    const concepts = db.prepare("SELECT label FROM nodes WHERE kind = 'concept' ORDER BY label").all() as any[];
    expect(concepts.map((c) => c.label)).toContain('webhook idempotency');
  });

  it('closes an in-flight hunch rather than leaving it stuck', () => {
    const db = tempDb();
    const repo = seedRepoAt(db);
    openHunch(db, repo, 'p1');
    expect(checkEligibility(db, ROOT, sampledId(1), PROMPT, { sampleOneIn: 1 }).reason).toBe('hunch already in flight');
    recordHunch(db, { repoRoot: ROOT, topic: 'webhooks', prediction: 'idempotency', matched: true });
    const open = db.prepare("SELECT COUNT(*) c FROM reps WHERE type='hunch' AND answered_at IS NULL").get() as any;
    expect(open.c).toBe(0);
  });

  it('hunches feed calibration and never the Gap, which needs a confidence rating', () => {
    const db = tempDb();
    const repo = seedRepoAt(db);
    recordHunch(db, { repoRoot: ROOT, topic: 't', prediction: 'p', matched: false });
    const rep = db.prepare("SELECT confidence_before FROM reps WHERE type = 'hunch'").get() as any;
    expect(rep.confidence_before).toBeNull();
    expect(gapPerZone(db, repo)).toEqual([]); // no rating, so no gap contribution
    expect(calibration(db, repo)).toBe(0);
  });

  it('refuses to record against an unregistered repo', () => {
    const db = tempDb();
    seedRepoAt(db);
    expect(() => recordHunch(db, { repoRoot: '/nowhere', topic: 't', prediction: 'p', matched: true }))
      .toThrow(/not registered/);
  });
});

describe('hook payload compatibility', () => {
  it('reads the prompt from the field Claude Code actually sends', async () => {
    // Claude Code 2.1.238 sends `prompt`; the published docs say `user_input`.
    // Verified live: the hook must accept both, or it silently never fires.
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const hook = readFileSync(
      resolve(__dirname, '..', '..', 'plugin', 'scripts', 'hunch-hook.mjs'),
      'utf8',
    );
    expect(hook).toContain('input.prompt ?? input.user_input');
    // and it must never block: exit 2 erases the prompt the user just typed
    expect(hook).not.toMatch(/process\.exit\(2\)/);
    expect(hook).toMatch(/catch\(\(\) => process\.exit\(0\)\)/);
  });
});

describe('unused dependency detection', () => {
  it('separates likely-unused from packages that never have an import site by design', async () => {
    const { findUnused, isConfigOnly } = await import('../src/unused.js');
    const db = tempDb();
    const repo = seedRepoAt(db);
    const add = (label: string, sites: number, size: number | null) => {
      const id = ulid();
      db.prepare(
        `INSERT INTO nodes (id, repo_id, kind, key, label, state, alive, in_zone, critical, state_changed_at, created_at)
         VALUES (?, ?, 'dependency', ?, ?, 'unknown', 1, 1, 0, ?, ?)`,
      ).run(id, repo, `npm:${label}`, label, nowIso(), nowIso());
      for (let i = 0; i < sites; i++) {
        db.prepare('INSERT INTO call_sites (node_id, path, line, snippet) VALUES (?, ?, ?, ?)')
          .run(id, `src/a${i}.ts`, i + 1, 'import x');
      }
      db.prepare('INSERT INTO dossiers (id, node_id, body_json, impact_json, fetched_at) VALUES (?, ?, NULL, ?, ?)')
        .run(ulid(), id, JSON.stringify({ installSizeBytes: size }), nowIso());
      return id;
    };
    add('zod', 2, 500_000);                 // used
    const ghost = add('leftover-lib', 0, 2_000_000);  // nothing imports it
    add('eslint-plugin-react', 0, 900_000); // no import site by design
    add('@types/node', 0, 100_000);         // ditto

    const r = findUnused(db, repo);
    expect(r.scanned).toBe(4);
    expect(r.likelyUnused.map((f) => f.name)).toEqual(['leftover-lib']);
    expect(r.likelyUnused[0].nodeId).toBe(ghost);
    expect(r.bytesLikelyUnused).toBe(2_000_000);
    expect(r.configOnly.map((f) => f.name).sort()).toEqual(['@types/node', 'eslint-plugin-react']);
    // config-only packages never inflate the headline number
    expect(r.bytesLikelyUnused).not.toContain?.(900_000);
    expect(isConfigOnly('tailwindcss')).toBe(true);
    expect(isConfigOnly('react')).toBe(false);
  });

  it('ships the caveat, because zero imports is a question and not a verdict', async () => {
    const { findUnused, CAVEAT } = await import('../src/unused.js');
    const db = tempDb();
    const repo = seedRepoAt(db);
    expect(findUnused(db, repo).caveat).toBe(CAVEAT);
    expect(CAVEAT).toMatch(/not an instruction to delete/);
  });
});
