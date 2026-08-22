import type { Db } from './db.js';
import { DEMONSTRATED } from './reps.js';
import { sweepDecay } from './decay.js';

/**
 * Spec §9. Explicability beats precision. Weight is 1, or 3 for critical.
 * Vouched % is the weighted share of live in-zone nodes at `defended`.
 * The Gap is mean(confidence_before - demonstrated) over graded reps,
 * reported PER ZONE because the aggregate is useless.
 */

/**
 * Vouched % counts artifacts, dependencies and decisions: the things that
 * ARE the codebase and that a rep can promote. Concepts are excluded on
 * purpose. They are techniques rather than units of ownership, they feed the
 * "what to study" list, and counting them would put rows in the denominator
 * that no rep is meant to promote, which is how a score becomes unwinnable
 * (spec §9: never show a total that only goes down).
 */
export const SCORED_KINDS = ['artifact', 'dependency', 'decision'] as const;

export function vouchedPct(db: Db, repoId: string): number | null {
  const row = db
    .prepare(
      `SELECT
         SUM(CASE WHEN state = 'defended' THEN (CASE WHEN critical THEN 3 ELSE 1 END) ELSE 0 END) AS num,
         SUM(CASE WHEN critical THEN 3 ELSE 1 END) AS den
       FROM nodes
       WHERE repo_id = ? AND alive = 1 AND in_zone = 1
         AND kind IN ('artifact','dependency','decision')`,
    )
    .get(repoId) as { num: number | null; den: number | null };
  if (!row.den) return null;
  return (100 * (row.num ?? 0)) / row.den;
}

/** Vouched % over time, rebuilt from the append-only audit trail (spec §4). */
export interface VouchedPoint { date: string; vouched: number }

export function vouchedOverTime(db: Db, repoId: string, days = 90): VouchedPoint[] {
  const rows = db
    .prepare(
      `SELECT date(s.at) AS day,
              SUM(CASE WHEN s.to_state = 'defended' THEN 1 ELSE 0 END) AS gained,
              SUM(CASE WHEN s.from_state = 'defended' THEN 1 ELSE 0 END) AS lost
       FROM node_states s
       JOIN nodes n ON n.id = s.node_id
       WHERE n.repo_id = ? AND n.in_zone = 1
         AND n.kind IN ('artifact','dependency','decision')
         AND s.at > datetime('now', ?)
       GROUP BY day ORDER BY day`,
    )
    .all(repoId, `-${days} days`) as { day: string; gained: number; lost: number }[];

  const den = (db
    .prepare(
      `SELECT COUNT(*) AS c FROM nodes WHERE repo_id = ? AND alive = 1 AND in_zone = 1
         AND kind IN ('artifact','dependency','decision')`,
    )
    .get(repoId) as { c: number }).c;
  if (den === 0) return [];

  let running = 0;
  return rows.map((r) => {
    running += r.gained - r.lost;
    return { date: r.day, vouched: Math.max(0, (100 * running) / den) };
  });
}

/** The Gap per zone over time: is your calibration actually improving? */
export interface GapPoint { week: string; gap: number; reps: number }

export function gapOverTime(db: Db, repoId: string, weeks = 12): GapPoint[] {
  const rows = db
    .prepare(
      `SELECT strftime('%Y-W%W', r.answered_at) AS week, r.confidence_before, r.verdict
       FROM reps r JOIN nodes n ON n.id = r.node_id
       WHERE n.repo_id = ?
         AND r.verdict IN ('pass','partial','fail')
         AND r.confidence_before IS NOT NULL
         AND r.answered_at > datetime('now', ?)
       ORDER BY r.answered_at`,
    )
    .all(repoId, `-${weeks * 7} days`) as
      { week: string; confidence_before: number; verdict: 'pass' | 'partial' | 'fail' }[];

  const byWeek = new Map<string, number[]>();
  for (const r of rows) {
    const arr = byWeek.get(r.week) ?? [];
    arr.push(r.confidence_before - DEMONSTRATED[r.verdict]);
    byWeek.set(r.week, arr);
  }
  return [...byWeek.entries()].map(([week, deltas]) => ({
    week,
    gap: deltas.reduce((a, b) => a + b, 0) / deltas.length,
    reps: deltas.length,
  }));
}

/** Every read path calls this first, so elapsed decay is always applied. */
export function refresh(db: Db, repoId: string): number {
  return sweepDecay(db, repoId);
}

export interface ZoneGap {
  zoneName: string;
  gap: number;
  reps: number;
}

export function gapPerZone(db: Db, repoId: string, windowDays = 90): ZoneGap[] {
  const rows = db
    .prepare(
      `SELECT COALESCE(z.name, '(unzoned)') AS zoneName, r.confidence_before, r.verdict
       FROM reps r
       JOIN nodes n ON n.id = r.node_id
       LEFT JOIN sharp_zones z ON z.id = n.zone_id
       WHERE n.repo_id = ?
         AND r.verdict IN ('pass','partial','fail')
         AND r.confidence_before IS NOT NULL
         AND r.answered_at > datetime('now', ?)`,
    )
    .all(repoId, `-${windowDays} days`) as { zoneName: string; confidence_before: number; verdict: 'pass' | 'partial' | 'fail' }[];

  const byZone = new Map<string, number[]>();
  for (const r of rows) {
    const deltas = byZone.get(r.zoneName) ?? [];
    deltas.push(r.confidence_before - DEMONSTRATED[r.verdict]);
    byZone.set(r.zoneName, deltas);
  }
  return [...byZone.entries()]
    .map(([zoneName, deltas]) => ({
      zoneName,
      gap: deltas.reduce((a, b) => a + b, 0) / deltas.length,
      reps: deltas.length,
    }))
    .sort((a, b) => b.gap - a.gap);
}

export function extractionCost(db: Db): { totalUsd: number; calls: number; failures: number } {
  const row = db
    .prepare('SELECT COALESCE(SUM(cost_usd), 0) AS total, COUNT(*) AS calls, SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS failures FROM extraction_calls')
    .get() as { total: number; calls: number; failures: number };
  return { totalUsd: row.total, calls: row.calls, failures: row.failures ?? 0 };
}
