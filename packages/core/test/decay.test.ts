import { describe, it, expect } from 'vitest';
import { tempDb, seedRepo, seedNode } from './helpers.js';
import { sweepDecay, approachingDecay, DEFAULT_DECAY_DAYS } from '../src/decay.js';
import { buildCard, dueCards } from '../src/cards.js';
import { answerCard } from '../src/reps.js';
import { promoteClusterArtifacts } from '../src/promote.js';
import { vouchedPct, vouchedOverTime, gapOverTime } from '../src/scoring.js';
import { ulid, nowIso } from '../src/util.js';

function ageNode(db: any, nodeId: string, days: number) {
  db.prepare("UPDATE nodes SET state_changed_at = datetime('now', ?) WHERE id = ?").run(`-${days} days`, nodeId);
}

function seedZone(db: any, repoId: string, name: string, decayDays = DEFAULT_DECAY_DAYS) {
  const id = ulid();
  db.prepare(
    "INSERT INTO sharp_zones (id, repo_id, kind, pattern, name, stance, critical, decay_days, created_at) VALUES (?, ?, 'path', '**', ?, 'keep_sharp', 0, ?, ?)",
  ).run(id, repoId, name, decayDays, nowIso());
  return id;
}

describe('decay (spec §4)', () => {
  it('moves defended to decayed only after the window, and only for live in-zone nodes', () => {
    const db = tempDb();
    const repo = seedRepo(db);
    const fresh = seedNode(db, repo, { state: 'defended' });
    const stale = seedNode(db, repo, { state: 'defended' });
    const dead = seedNode(db, repo, { state: 'defended', alive: 0 });
    const outZone = seedNode(db, repo, { state: 'defended', in_zone: 0 });
    const notDefended = seedNode(db, repo, { state: 'explained' });
    for (const n of [stale, dead, outZone, notDefended]) ageNode(db, n, 200);
    ageNode(db, fresh, 10);

    expect(sweepDecay(db, repo)).toBe(1);
    const state = (id: string) => (db.prepare('SELECT state FROM nodes WHERE id = ?').get(id) as any).state;
    expect(state(stale)).toBe('decayed');
    expect(state(fresh)).toBe('defended');
    expect(state(dead)).toBe('defended');      // untouched: not live
    expect(state(outZone)).toBe('defended');   // untouched: outsourced
    expect(state(notDefended)).toBe('explained');
  });

  it('critical nodes decay in half the window', () => {
    const db = tempDb();
    const repo = seedRepo(db);
    const zone = seedZone(db, repo, 'z', 90);
    const normal = seedNode(db, repo, { state: 'defended' });
    const critical = seedNode(db, repo, { state: 'defended', critical: 1 });
    for (const n of [normal, critical]) {
      db.prepare('UPDATE nodes SET zone_id = ? WHERE id = ?').run(zone, n);
      ageNode(db, n, 50); // past 45 (critical) but not 90 (normal)
    }
    expect(sweepDecay(db, repo)).toBe(1);
    const state = (id: string) => (db.prepare('SELECT state FROM nodes WHERE id = ?').get(id) as any).state;
    expect(state(critical)).toBe('decayed');
    expect(state(normal)).toBe('defended');
  });

  it('honours a per-zone decay window', () => {
    const db = tempDb();
    const repo = seedRepo(db);
    const fast = seedZone(db, repo, 'fast', 7);
    const n = seedNode(db, repo, { state: 'defended' });
    db.prepare('UPDATE nodes SET zone_id = ? WHERE id = ?').run(fast, n);
    ageNode(db, n, 10);
    expect(sweepDecay(db, repo)).toBe(1);
  });

  it('is idempotent: a second sweep moves nothing', () => {
    const db = tempDb();
    const repo = seedRepo(db);
    const n = seedNode(db, repo, { state: 'defended' });
    ageNode(db, n, 200);
    expect(sweepDecay(db, repo)).toBe(1);
    expect(sweepDecay(db, repo)).toBe(0);
  });

  it('surfaces nodes at 80% of their window as approaching', () => {
    const db = tempDb();
    const repo = seedRepo(db);
    const soon = seedNode(db, repo, { state: 'defended' });
    const early = seedNode(db, repo, { state: 'defended' });
    ageNode(db, soon, 75);
    ageNode(db, early, 5);
    expect(approachingDecay(db, repo)).toEqual([soon]);
  });
});

describe('cards (spec §7.4)', () => {
  function seedDossierNode(db: any, repo: string, label: string, does: string) {
    const id = seedNode(db, repo, { label, key: `npm:${label}` });
    db.prepare('INSERT INTO dossiers (id, node_id, body_json, impact_json, fetched_at) VALUES (?, ?, ?, ?, ?)')
      .run(ulid(), id, JSON.stringify({
        what_it_does_here: does, if_it_vanished: 'x', probe_question: 'q', probe_expected: 'e',
      }), '{}', nowIso());
    return id;
  }

  it('builds a dependency card whose distractors are other real packages in the repo', () => {
    const db = tempDb();
    const repo = seedRepo(db);
    const zod = seedDossierNode(db, repo, 'zod', 'validates env vars at boot in src/env.ts');
    seedDossierNode(db, repo, 'clsx', 'joins conditional class names in the button component');
    seedDossierNode(db, repo, 'nanoid', 'generates short ids for cart line items');

    const card = buildCard(db, repo, zod)!;
    expect(card.type).toBe('card');
    expect(card.options).toHaveLength(3);
    expect(card.options).toContain('validates env vars at boot in src/env.ts');
    expect(card.options).toContain('joins conditional class names in the button component');
    // the answer is never marked in what the client receives
    expect(JSON.stringify(card)).not.toContain('correct');
  });

  it('refuses to build a card when the repo cannot supply real distractors', () => {
    const db = tempDb();
    const repo = seedRepo(db);
    const lonely = seedDossierNode(db, repo, 'zod', 'validates env vars');
    expect(buildCard(db, repo, lonely)).toBeNull(); // never invents an option
  });

  it('a right card keeps the node, a wrong card demotes it', () => {
    const db = tempDb();
    const repo = seedRepo(db);
    const a = seedDossierNode(db, repo, 'zod', 'validates env vars at boot');
    seedDossierNode(db, repo, 'clsx', 'joins class names');
    seedDossierNode(db, repo, 'nanoid', 'generates ids');
    db.prepare("UPDATE nodes SET state = 'defended' WHERE id = ?").run(a);

    const card = buildCard(db, repo, a)!;
    const right = answerCard(db, card.repId, 6, 'validates env vars at boot');
    expect(right.correct).toBe(true);
    expect(right.stateNow).toBe('defended');

    db.prepare("UPDATE nodes SET state = 'defended' WHERE id = ?").run(a);
    const card2 = buildCard(db, repo, a)!;
    const wrong = answerCard(db, card2.repId, 7, 'joins class names');
    expect(wrong.correct).toBe(false);
    expect(wrong.correctAnswer).toBe('validates env vars at boot');
    expect(wrong.stateNow).toBe('explained'); // demoted one step: decay is real
    expect(wrong.delta).toBe(6);
  });

  it('a decayed node returns to defended when a card is answered right', () => {
    const db = tempDb();
    const repo = seedRepo(db);
    const a = seedDossierNode(db, repo, 'zod', 'validates env vars at boot');
    seedDossierNode(db, repo, 'clsx', 'joins class names');
    seedDossierNode(db, repo, 'nanoid', 'generates ids');
    db.prepare("UPDATE nodes SET state = 'decayed' WHERE id = ?").run(a);
    const card = buildCard(db, repo, a)!;
    expect(answerCard(db, card.repId, 4, 'validates env vars at boot').stateNow).toBe('defended');
  });

  it('queues nodes approaching decay', () => {
    const db = tempDb();
    const repo = seedRepo(db);
    const a = seedDossierNode(db, repo, 'zod', 'validates env vars at boot');
    seedDossierNode(db, repo, 'clsx', 'joins class names');
    seedDossierNode(db, repo, 'nanoid', 'generates ids');
    db.prepare("UPDATE nodes SET state = 'defended' WHERE id = ?").run(a);
    db.prepare("UPDATE nodes SET state_changed_at = datetime('now', '-80 days') WHERE id = ?").run(a);
    const due = dueCards(db, repo);
    expect(due.map((c) => c.nodeId)).toContain(a);
  });
});

describe('the score is winnable (Phase 2 fix)', () => {
  it('defending a feature promotes the artifacts it is about', () => {
    const db = tempDb();
    const repo = seedRepo(db);
    const decision = seedNode(db, repo, { kind: 'decision', key: 'decision:a:b', label: 'feature' });
    const f1 = seedNode(db, repo, { kind: 'artifact', key: 'store/a.ts#x', label: 'x' });
    const f2 = seedNode(db, repo, { kind: 'artifact', key: 'store/b.ts#y', label: 'y' });
    const outside = seedNode(db, repo, { kind: 'artifact', key: 'other/c.ts#z', label: 'z' });
    for (const a of [f1, f2]) {
      db.prepare("INSERT INTO edges (from_node, to_node, rel) VALUES (?, ?, 'about')").run(decision, a);
    }
    const repId = ulid();
    db.prepare("INSERT INTO reps (id, node_id, type, prompt_json, asked_at) VALUES (?, ?, 'defend', '{}', ?)")
      .run(repId, decision, nowIso());
    expect(promoteClusterArtifacts(db, decision, repId)).toBe(2);
    const state = (id: string) => (db.prepare('SELECT state FROM nodes WHERE id = ?').get(id) as any).state;
    expect(state(f1)).toBe('defended');
    expect(state(f2)).toBe('defended');
    expect(state(outside)).toBe('unknown'); // only what the decision is about
  });

  it('concepts are excluded from vouched %, so the denominator stays winnable', () => {
    const db = tempDb();
    const repo = seedRepo(db);
    seedNode(db, repo, { kind: 'artifact', key: 'a.ts#a', state: 'defended' });
    seedNode(db, repo, { kind: 'concept', key: 'concept:x', label: 'x' });
    seedNode(db, repo, { kind: 'concept', key: 'concept:y', label: 'y' });
    expect(vouchedPct(db, repo)).toBe(100); // not 33
  });
});

describe('trends over time', () => {
  it('rebuilds vouched % from the audit trail and reports the gap by week', () => {
    const db = tempDb();
    const repo = seedRepo(db);
    const a = seedNode(db, repo, { kind: 'artifact', key: 'a.ts#a', state: 'defended' });
    const b = seedNode(db, repo, { kind: 'artifact', key: 'b.ts#b', state: 'unknown' });
    db.prepare("INSERT INTO node_states (id, node_id, from_state, to_state, cause, at) VALUES (?, ?, 'explained', 'defended', 'rep_pass', datetime('now','-3 days'))").run(ulid(), a);
    const pts = vouchedOverTime(db, repo);
    expect(pts).toHaveLength(1);
    expect(pts[0].vouched).toBe(50); // 1 of 2 scored nodes

    db.prepare("INSERT INTO reps (id, node_id, type, confidence_before, prompt_json, verdict, asked_at, answered_at) VALUES (?, ?, 'card', 7, '{}', 'fail', datetime('now','-2 days'), datetime('now','-2 days'))").run(ulid(), b);
    const gap = gapOverTime(db, repo);
    expect(gap).toHaveLength(1);
    expect(gap[0].gap).toBe(6);
  });
});

describe('schema migrations', () => {
  it('adds new columns to a database created before they existed', async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { DatabaseSync } = await import('node:sqlite');
    const { openDb } = await import('../src/db.js');

    const file = join(mkdtempSync(join(tmpdir(), 'vouch-migrate-')), 'old.db');
    // an old-shaped table, exactly as a previous release would have left it
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE sharp_zones (
      id TEXT PRIMARY KEY, repo_id TEXT NOT NULL, kind TEXT NOT NULL, pattern TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '', stance TEXT NOT NULL, critical INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL)`);
    old.prepare("INSERT INTO sharp_zones VALUES ('Z','R','path','**','z','keep_sharp',0,'now')").run();
    old.close();

    const db = openDb(file);
    const cols = (db.prepare('PRAGMA table_info(sharp_zones)').all() as { name: string }[]).map((c) => c.name);
    expect(cols).toContain('decay_days');
    // the pre-existing row survives and gets the default
    expect(db.prepare('SELECT decay_days FROM sharp_zones WHERE id = ?').get('Z')).toEqual({ decay_days: 90 });
  });
});
