const CANDIDATES = `
  SELECT n.id AS nodeId, n.kind, n.label, n.state, n.critical, z.name AS zoneName
  FROM nodes n
  LEFT JOIN sharp_zones z ON z.id = n.zone_id
  WHERE n.repo_id = ?
    AND n.alive = 1 AND n.in_zone = 1
    AND n.kind = ?
    AND n.state IN ('unknown', 'explained', 'decayed')
    AND NOT EXISTS (
      SELECT 1 FROM reps r
      WHERE r.node_id = n.id AND r.revealed_at IS NOT NULL
        AND r.revealed_at > datetime('now', '-1 day')
    )
  ORDER BY n.critical DESC, n.state_changed_at DESC
  LIMIT ?`;
/**
 * Dossiers first because they are cheaper and build momentum, then at most
 * ONE Defend rep, which is the heavy high-interactivity item (rule 5).
 * A decision node with no brief is not a candidate: askRep would refuse it.
 */
export function buildDigest(db, repoId, limit = 5) {
    // The Defend rep gets a RESERVED slot rather than competing for one. It is
    // the highest-value item in the digest, and with a full dossier queue it
    // would otherwise never surface.
    const defends = db.prepare(CANDIDATES).all(repoId, 'decision', 4)
        .filter((d) => db.prepare('SELECT 1 FROM briefs WHERE node_id = ?').get(d.nodeId))
        .slice(0, 1);
    const dossiers = db
        .prepare(CANDIDATES)
        .all(repoId, 'dependency', Math.max(0, limit - defends.length));
    return [...dossiers, ...defends];
}
