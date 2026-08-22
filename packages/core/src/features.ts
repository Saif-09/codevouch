import type { Db } from './db.js';

/**
 * Feature clustering, tech spec §7.2: "a cluster of same-session artifact
 * nodes". A real call graph is Wave 2 work; this clusters by session plus
 * shared directory, which is an honest heuristic and is labelled as one
 * rather than dressed up as dependency analysis.
 *
 * A cluster becomes a `decision` node, whose key format the spec already
 * anchors to the session (§3.1: `decision:<sha-of-session>:<slug>`). The
 * withheld brief hangs off that node.
 */

export interface FeatureCluster {
  slug: string;
  dir: string;
  nodeIds: string[];
  paths: string[];
  inZone: boolean;
  critical: boolean;
}

const MIN_CLUSTER = 2; // a single changed symbol is not a feature

function dirOf(key: string): string {
  const path = key.split('#')[0];
  const i = path.lastIndexOf('/');
  return i === -1 ? '(root)' : path.slice(0, i);
}

export function clusterSession(db: Db, repoId: string, sessionId: string): FeatureCluster[] {
  const rows = db
    .prepare(
      `SELECT id, key, in_zone, critical FROM nodes
       WHERE repo_id = ? AND kind = 'artifact' AND alive = 1 AND first_seen_session = ?`,
    )
    .all(repoId, sessionId) as { id: string; key: string; in_zone: number; critical: number }[];

  const byDir = new Map<string, typeof rows>();
  for (const r of rows) {
    const d = dirOf(r.key);
    const arr = byDir.get(d) ?? [];
    arr.push(r);
    byDir.set(d, arr);
  }

  const clusters: FeatureCluster[] = [];
  for (const [dir, members] of byDir) {
    if (members.length < MIN_CLUSTER) continue;
    if (!members.some((m) => m.in_zone === 1)) continue; // zones gate everything
    clusters.push({
      slug: dir.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'root',
      dir,
      nodeIds: members.map((m) => m.id),
      paths: [...new Set(members.map((m) => m.key.split('#')[0]))],
      inZone: members.some((m) => m.in_zone === 1),
      critical: members.some((m) => m.critical === 1),
    });
  }
  return clusters;
}
