import type { Db } from './db.js';
import type { ExtractionBackend } from './extraction.js';
import type { BriefPublic } from './brief.js';
import { type Verdict } from './statemachine.js';
import type { DossierBody } from './dossier.js';
/**
 * The rep flow, hard rules 2 and 3 (spec §1):
 *  - confidence before the rep, always; the delta is the product
 *  - withhold before reveal: nothing from the dossier body or the reveal
 *    payload is serialized to any client until an attempt is submitted
 *
 * Event ordering on completion (spec §4, worked through):
 *  apply 'reveal' first, then the verdict, EXCEPT a fail when the reveal
 *  just fired. A fresh node whose probe you fail still ends at `explained`,
 *  because the reveal you just read is exactly what `explained` means;
 *  a fail on an already-explained node demotes normally.
 */
export declare function fallbackProbe(label: string): string;
export interface RepQuestion {
    repId: string;
    nodeId: string;
    type: 'dossier' | 'defend';
    label: string;
    question: string;
    callSites: {
        path: string;
        line: number;
        snippet: string;
    }[];
    /** Defend only: the shuffled data-flow options. Never says which is right. */
    flowOptions?: string[];
    /** Defend only: the files this change touched, as the only prompt. */
    paths?: string[];
}
/** ONLY these fields ever leave the server before an answer. */
export declare function askRep(db: Db, nodeId: string): RepQuestion | null;
export interface RepReveal {
    verdict: Verdict;
    gap: string | null;
    confidenceBefore: number;
    demonstrated: number;
    delta: number;
    body: Omit<DossierBody, 'probe_expected'> | null;
    impact: any;
    stateNow: string;
}
export declare const DEMONSTRATED: Record<Exclude<Verdict, 'ungraded'>, number>;
export declare function answerRep(db: Db, backend: ExtractionBackend, repId: string, confidenceBefore: number, answer: string): Promise<RepReveal>;
export declare function recordConfidenceAfter(db: Db, repId: string, confidenceAfter: number): void;
/** User verdict override (spec §12): audited as cause 'manual'. */
export declare function overrideVerdict(db: Db, repId: string, verdict: Verdict): void;
export declare const DEFEND_QUESTION = "In one or two sentences, from memory: what does this change do, and what is it assuming?";
export interface DefendReveal {
    verdict: Verdict;
    gap: string | null;
    confidenceBefore: number;
    demonstrated: number;
    delta: number;
    flowCorrect: string;
    flowWasRight: boolean;
    brief: BriefPublic;
    stateNow: string;
    /** Files promoted alongside the feature, so the map moves visibly. */
    filesPromoted: number;
}
/**
 * Two parts: one free-text reconstruction (graded by the model) and one
 * recognition item (graded locally, no model needed). The recognition item
 * can only downgrade a passing reconstruction, never rescue a failing one:
 * picking the right sentence from four is weak evidence next to producing
 * the answer yourself, which is the whole premise (RESEARCH §1).
 */
export declare function answerDefend(db: Db, backend: ExtractionBackend, repId: string, confidenceBefore: number, reconstruction: string, flowChoice: string): Promise<DefendReveal>;
export interface CardReveal {
    correct: boolean;
    correctAnswer: string;
    confidenceBefore: number;
    demonstrated: number;
    delta: number;
    stateNow: string;
}
/**
 * A card is graded locally against the stored answer: no model call, so
 * re-testing stays free forever. A wrong card demotes per §4, which is what
 * makes decay real rather than cosmetic.
 */
export declare function answerCard(db: Db, repId: string, confidenceBefore: number, choice: string): CardReveal;
