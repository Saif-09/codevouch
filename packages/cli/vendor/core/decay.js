import { applyEvent } from './statemachine.js';
/**
 * Spec §4: only `defended` decays, only for nodes that are alive and in zone,
 * default window 90 days per zone, and `critical` nodes use half the window.
 *
 * The sweep is LAZY, run on read rather than on a timer. A local daemon may
 * be down for a week; a scheduler would simply miss that window, whereas
 * evaluating elapsed time when someone actually looks is always correct.
 */
export const DEFAULT_DECAY_DAYS = 90;
export function sweepDecay(db, repoId) {
    const due = db
        .prepare(`SELECT n.id
       FROM nodes n
       LEFT JOIN sharp_zones z ON z.id = n.zone_id
       WHERE n.repo_id = ?
         AND n.state = 'defended'
         AND n.alive = 1 AND n.in_zone = 1
         AND julianday('now') - julianday(n.state_changed_at) >=
             (COALESCE(z.decay_days, ?) / (CASE WHEN n.critical THEN 2.0 ELSE 1.0 END))`)
        .all(repoId, DEFAULT_DECAY_DAYS);
    let moved = 0;
    for (const row of due) {
        if (applyEvent(db, row.id, { type: 'decay' }) !== null)
            moved++;
    }
    return moved;
}
/** Nodes whose decay window is more than 80% elapsed: the card queue. */
export function approachingDecay(db, repoId, limit = 20) {
    return db
        .prepare(`SELECT n.id
         FROM nodes n
         LEFT JOIN sharp_zones z ON z.id = n.zone_id
         WHERE n.repo_id = ?
           AND n.state = 'defended'
           AND n.alive = 1 AND n.in_zone = 1
           AND julianday('now') - julianday(n.state_changed_at) >=
               0.8 * (COALESCE(z.decay_days, ?) / (CASE WHEN n.critical THEN 2.0 ELSE 1.0 END))
         ORDER BY n.critical DESC, n.state_changed_at ASC
         LIMIT ?`)
        .all(repoId, DEFAULT_DECAY_DAYS, limit).map((r) => r.id);
}
