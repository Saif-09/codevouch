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
export const SCORED_KINDS = ['artifact', 'dependency', 'decision'];
export function vouchedPct(db, repoId) {
    const row = db
        .prepare(`SELECT
         SUM(CASE WHEN state = 'defended' THEN (CASE WHEN critical THEN 3 ELSE 1 END) ELSE 0 END) AS num,
         SUM(CASE WHEN critical THEN 3 ELSE 1 END) AS den
       FROM nodes
       WHERE repo_id = ? AND alive = 1 AND in_zone = 1
         AND kind IN ('artifact','dependency','decision')`)
        .get(repoId);
    if (!row.den)
        return null;
    return (100 * (row.num ?? 0)) / row.den;
}
export function vouchedOverTime(db, repoId, days = 90) {
    const rows = db
        .prepare(`SELECT date(s.at) AS day,
              SUM(CASE WHEN s.to_state = 'defended' THEN 1 ELSE 0 END) AS gained,
              SUM(CASE WHEN s.from_state = 'defended' THEN 1 ELSE 0 END) AS lost
       FROM node_states s
       JOIN nodes n ON n.id = s.node_id
       WHERE n.repo_id = ? AND n.in_zone = 1
         AND n.kind IN ('artifact','dependency','decision')
         AND s.at > datetime('now', ?)
       GROUP BY day ORDER BY day`)
        .all(repoId, `-${days} days`);
    const den = db
        .prepare(`SELECT COUNT(*) AS c FROM nodes WHERE repo_id = ? AND alive = 1 AND in_zone = 1
         AND kind IN ('artifact','dependency','decision')`)
        .get(repoId).c;
    if (den === 0)
        return [];
    let running = 0;
    return rows.map((r) => {
        running += r.gained - r.lost;
        return { date: r.day, vouched: Math.max(0, (100 * running) / den) };
    });
}
export function gapOverTime(db, repoId, weeks = 12) {
    const rows = db
        .prepare(`SELECT strftime('%Y-W%W', r.answered_at) AS week, r.confidence_before, r.verdict
       FROM reps r JOIN nodes n ON n.id = r.node_id
       WHERE n.repo_id = ?
         AND r.verdict IN ('pass','partial','fail')
         AND r.confidence_before IS NOT NULL
         AND r.answered_at > datetime('now', ?)
       ORDER BY r.answered_at`)
        .all(repoId, `-${weeks * 7} days`);
    const byWeek = new Map();
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
export function refresh(db, repoId) {
    return sweepDecay(db, repoId);
}
export function gapPerZone(db, repoId, windowDays = 90) {
    const rows = db
        .prepare(`SELECT COALESCE(z.name, '(unzoned)') AS zoneName, r.confidence_before, r.verdict
       FROM reps r
       JOIN nodes n ON n.id = r.node_id
       LEFT JOIN sharp_zones z ON z.id = n.zone_id
       WHERE n.repo_id = ?
         AND r.verdict IN ('pass','partial','fail')
         AND r.confidence_before IS NOT NULL
         AND r.answered_at > datetime('now', ?)`)
        .all(repoId, `-${windowDays} days`);
    const byZone = new Map();
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
export function extractionCost(db) {
    const row = db
        .prepare('SELECT COALESCE(SUM(cost_usd), 0) AS total, COUNT(*) AS calls, SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS failures FROM extraction_calls')
        .get();
    return { totalUsd: row.total, calls: row.calls, failures: row.failures ?? 0 };
}
