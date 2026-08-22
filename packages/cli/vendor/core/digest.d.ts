import type { Db } from './db.js';
/**
 * Wave 1 spec §3. Five items maximum, regenerated from the current graph,
 * never from a backlog table. Weight then recency, critical first, dossiers
 * before defends (only dossiers exist in Phase 0). Framed as "here is what
 * landed today and here is what you could not explain about it".
 */
export interface DigestItem {
    nodeId: string;
    kind: string;
    label: string;
    state: string;
    critical: number;
    zoneName: string | null;
}
/**
 * Dossiers first because they are cheaper and build momentum, then at most
 * ONE Defend rep, which is the heavy high-interactivity item (rule 5).
 * A decision node with no brief is not a candidate: askRep would refuse it.
 */
export declare function buildDigest(db: Db, repoId: string, limit?: number): DigestItem[];
