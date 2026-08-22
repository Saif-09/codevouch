import { applyEvent } from './statemachine.js';
/**
 * A `decision` node stands for the cluster of artifacts it is about. When
 * the Defend rep passes, those artifacts are promoted with it: you have just
 * demonstrated you can explain the change those files make up.
 *
 * Promotion walks the same one-step state machine as everything else, so an
 * artifact at `unknown` reaches `explained`, and reaches `defended` only if
 * a later pass moves it again. Nothing skips a state.
 */
export function promoteClusterArtifacts(db, decisionId, repId) {
    const artifacts = db
        .prepare(`SELECT a.id FROM edges e JOIN nodes a ON a.id = e.to_node
       WHERE e.from_node = ? AND e.rel = 'about' AND a.kind = 'artifact'
         AND a.alive = 1 AND a.in_zone = 1`)
        .all(decisionId);
    let moved = 0;
    for (const a of artifacts) {
        // reveal first (unknown -> explained), then the pass (explained -> defended)
        applyEvent(db, a.id, { type: 'reveal' }, repId);
        if (applyEvent(db, a.id, { type: 'verdict', verdict: 'pass' }, repId) !== null)
            moved++;
    }
    return moved;
}
