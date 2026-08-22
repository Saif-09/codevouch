import type { Db } from './db.js';
export interface Repo {
    id: string;
    root: string;
    name: string;
}
export declare function getRepo(db: Db, root: string): Repo | null;
export declare function upsertRepo(db: Db, root: string, name: string): Repo;
/**
 * Session boundaries, spec §5.1. `tick` fires from the post-commit hook:
 * it extends the open session, or lazily closes an idle one (using the head
 * recorded at its last activity, not the current one) and opens the next.
 */
export declare function tick(db: Db, repo: Repo): Promise<{
    closed: string | null;
}>;
export declare function explicitStart(db: Db, repo: Repo): Promise<string>;
export declare function explicitEnd(db: Db, repo: Repo): Promise<string | null>;
export interface IngestResult {
    newDependencyNodes: string[];
    artifactNodes: string[];
}
export declare function ingestSession(db: Db, repo: Repo, sessionId: string, before: string, after: string): Promise<IngestResult>;
declare function sessionHash(root: string, s: string): string;
export { sessionHash };
