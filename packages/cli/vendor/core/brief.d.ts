import type { Db } from './db.js';
import type { ExtractionBackend } from './extraction.js';
import type { Repo } from './ingest.js';
export interface BriefBody {
    name: string;
    approach: string[];
    concepts: string[];
    rejected: {
        option: string;
        why_not: string;
    }[];
    assumptions: string[];
    breaks_first: string[];
    flow_correct: string;
    flow_distractors: string[];
}
/** The reveal view: everything except the answers to the recognition items. */
export type BriefPublic = Omit<BriefBody, 'flow_distractors'>;
/**
 * Phase 1. Runs at session close for every in-zone cluster: creates the
 * `decision` node and its WITHHELD brief. Degrades: extraction failure
 * leaves the node with no brief, retried on a later pass, never blocking.
 */
export declare function generateBriefs(db: Db, repo: Repo, backend: ExtractionBackend, sessionId: string): Promise<{
    created: number;
    failed: number;
}>;
