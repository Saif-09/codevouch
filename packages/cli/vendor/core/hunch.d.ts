import type { Db } from './db.js';
/**
 * Phase 3: real-time Hunch (RESEARCH §7.1).
 *
 * A UserPromptSubmit hook cannot ask the user anything: hooks are one-shot,
 * JSON in and JSON out. So Vouch does not try. It injects `additionalContext`
 * that asks CLAUDE to run the prediction step, because the model is the only
 * component in the loop that can hold a conversation. Claude then reports the
 * exchange back through an MCP tool, which is why nothing here ever reads a
 * transcript (hard rule 7).
 */
export declare const PENDING_MINUTES = 20;
export declare const DEFAULT_COOLDOWN_MINUTES = 45;
export declare const DEFAULT_SAMPLE_ONE_IN = 3;
export declare function isSubstantivePrompt(text: string): boolean;
/** Deterministic sampling, so behaviour is testable rather than random. */
export declare function sampled(promptId: string, oneIn: number): boolean;
export interface HunchEligibility {
    eligible: boolean;
    reason: string;
    repoId?: string;
}
/**
 * Read-only and cheap: this runs synchronously in front of every prompt the
 * user types, so it must be fast and must never throw into the session.
 */
export declare function checkEligibility(db: Db, cwd: string, promptId: string, userInput: string, opts?: {
    cooldownMinutes?: number;
    sampleOneIn?: number;
}): HunchEligibility;
/**
 * The injected instruction. Written for Claude, not for the user, and
 * deliberately short: it competes for attention with the real request, and
 * must never override it.
 */
export declare function hunchInstruction(): string;
/** Marks a hunch in flight so the next prompt does not trigger another. */
export declare function openHunch(db: Db, repoId: string, promptId: string): string;
export interface RecordHunchInput {
    repoRoot: string;
    topic: string;
    prediction: string;
    matched: boolean;
    note?: string;
}
/**
 * Claude reports the exchange here. Hunch reps carry no 1-to-7 rating: the
 * prediction itself is the generative act, and asking for a rating too would
 * put friction in the hot loop. Hunch therefore feeds Calibration rather than
 * the Gap, exactly as spec §9 defines it.
 */
export declare function recordHunch(db: Db, input: RecordHunchInput): {
    ok: true;
    calibration: number | null;
};
/** Share of predictions that matched the answer's shape (spec §9). */
export declare function calibration(db: Db, repoId: string, days?: number): number | null;
