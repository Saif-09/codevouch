import type { Db } from './db.js';
export interface CardQuestion {
    repId: string;
    nodeId: string;
    type: 'card';
    label: string;
    kind: string;
    question: string;
    options: string[];
}
/** Builds the card for a node, or null when the repo cannot supply distractors. */
export declare function buildCard(db: Db, repoId: string, nodeId: string): CardQuestion | null;
/**
 * The due queue: nodes approaching their decay window first, then nodes
 * carrying a recorded gap from an earlier rep (spec §7.4).
 */
export declare function dueCards(db: Db, repoId: string, limit?: number): CardQuestion[];
