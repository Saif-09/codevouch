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
export declare function clusterSession(db: Db, repoId: string, sessionId: string): FeatureCluster[];
