import { describe, it, expect } from 'vitest';
import { tempDb, seedRepo, seedNode } from './helpers.js';
import { vouchedPct, gapPerZone } from '../src/scoring.js';
import { buildDigest } from '../src/digest.js';
import { buildMapModel, squarify } from '../src/map.js';
import { renderMapSvg } from '../src/mapsvg.js';
import { ulid, nowIso } from '../src/util.js';

describe('the two numbers (spec §9)', () => {
  it('vouched % is the weighted share of live in-zone defended nodes', () => {
    const db = tempDb();
    const repo = seedRepo(db);
    seedNode(db, repo, { state: 'defended', critical: 1 });        // weight 3, counts
    seedNode(db, repo, { state: 'unknown' });                       // weight 1
    seedNode(db, repo, { state: 'defended', in_zone: 0 });          // out of zone: excluded entirely
    seedNode(db, repo, { state: 'defended', alive: 0 });            // dead: excluded
    expect(vouchedPct(db, repo)).toBe(75); // 3 / (3+1)
  });

  it('vouched % is null with an empty zone, never 0-by-default', () => {
    const db = tempDb();
    const repo = seedRepo(db);
    expect(vouchedPct(db, repo)).toBeNull();
  });

  it('the Gap is per zone: confidence minus demonstrated over graded reps', () => {
    const db = tempDb();
    const repo = seedRepo(db);
    const zoneId = ulid();
    db.prepare("INSERT INTO sharp_zones (id, repo_id, kind, pattern, name, stance, critical, created_at) VALUES (?, ?, 'path', 'src/**', 'auth', 'keep_sharp', 1, ?)").run(zoneId, repo, nowIso());
    const n = seedNode(db, repo);
    db.prepare('UPDATE nodes SET zone_id = ? WHERE id = ?').run(zoneId, n);
    const mkRep = (conf: number, verdict: string) =>
      db.prepare("INSERT INTO reps (id, node_id, type, confidence_before, prompt_json, verdict, asked_at, answered_at, revealed_at) VALUES (?, ?, 'dossier', ?, '{}', ?, ?, ?, ?)")
        .run(ulid(), n, conf, verdict, nowIso(), nowIso(), nowIso());
    mkRep(7, 'fail');    // 7 - 1 = +6
    mkRep(6, 'partial'); // 6 - 4 = +2
    mkRep(4, 'pass');    // 4 - 7 = -3
    mkRep(7, 'ungraded'); // excluded
    const gaps = gapPerZone(db, repo);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].zoneName).toBe('auth');
    expect(gaps[0].reps).toBe(3);
    expect(gaps[0].gap).toBeCloseTo((6 + 2 - 3) / 3, 5);
  });
});

describe('digest (Wave 1 spec §3)', () => {
  it('caps at five, critical first, and is regenerated from the graph', () => {
    const db = tempDb();
    const repo = seedRepo(db);
    for (let i = 0; i < 9; i++) seedNode(db, repo, { label: `dep${i}` });
    const crit = seedNode(db, repo, { label: 'stripe', critical: 1 });
    seedNode(db, repo, { state: 'defended' });   // not a digest candidate
    seedNode(db, repo, { in_zone: 0 });          // out of zone: never appears
    const items = buildDigest(db, repo);
    expect(items).toHaveLength(5);
    expect(items[0].nodeId).toBe(crit);
    expect(items.every((i) => i.state !== 'defended')).toBe(true);
  });
});

describe('map (spec §10)', () => {
  it('squarify covers the rect with no overlaps and area proportional to weight', () => {
    const items = [{ id: 'a', weight: 6 }, { id: 'b', weight: 3 }, { id: 'c', weight: 1 }];
    const rects = squarify(items, { x: 0, y: 0, w: 100, h: 100 });
    const area = (r: any) => r.w * r.h;
    const total = rects.reduce((s, r) => s + area(r), 0);
    expect(total).toBeCloseTo(10000, 3);
    expect(area(rects.find((r) => r.id === 'a')!)).toBeCloseTo(6000, 2);
    expect(area(rects.find((r) => r.id === 'c')!)).toBeCloseTo(1000, 2);
  });

  it('renders SVG with the hatch pattern for decayed, a legend, and focusable cells', () => {
    const db = tempDb();
    const repo = seedRepo(db);
    seedNode(db, repo, { kind: 'artifact', key: 'src/auth.ts#login', label: 'login', state: 'decayed', critical: 1 });
    seedNode(db, repo, { key: 'npm:zod', label: 'zod', state: 'defended' });
    seedNode(db, repo, { key: 'npm:eslint', label: 'eslint', in_zone: 0 });
    const model = buildMapModel(db, repo, 960, 540);
    expect(model.totalNodes).toBe(3);
    const svg = renderMapSvg(model, { width: 960, height: 574 });
    expect(svg).toContain('decayhatch');            // greyscale survival
    expect(svg).toContain('url(#decayhatch)');      // actually applied
    expect(svg).toContain('tabindex="0"');          // keyboard navigable
    expect(svg).toContain('#4E7B77');               // verdigris for defended
    expect(svg).toContain('#D7D0C4');               // chalk for out of zone
    expect(svg).toContain('legend');
    expect(svg).not.toMatch(/#(00f|0000ff|f0f|800080|ffa500)/i); // no generic hues
  });
});
