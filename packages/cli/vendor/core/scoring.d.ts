import type { Db } from './db.js';
/**
 * Spec §9. Explicability beats precision. Weight is 1, or 3 for critical.
 * Vouched % is the weighted share of live in-zone nodes at `defended`.
 * The Gap is mean(confidence_before - demonstrated) over graded reps,
 * reported PER ZONE because the aggregate is useless.
 */
/**
 * Vouched % counts artifacts, dependencies and decisions: the things that
 * ARE the codebase and that a rep can promote. Concepts are excluded on
 * purpose. They are techniques rather than units of ownership, they feed the
 * "what to study" list, and counting them would put rows in the denominator
 * that no rep is meant to promote, which is how a score becomes unwinnable
 * (spec §9: never show a total that only goes down).
 */
export declare const SCORED_KINDS: readonly ["artifact", "dependency", "decision"];
export declare function vouchedPct(db: Db, repoId: string): number | null;
/** Vouched % over time, rebuilt from the append-only audit trail (spec §4). */
export interface VouchedPoint {
    date: string;
    vouched: number;
}
export declare function vouchedOverTime(db: Db, repoId: string, days?: number): VouchedPoint[];
/** The Gap per zone over time: is your calibration actually improving? */
export interface GapPoint {
    week: string;
    gap: number;
    reps: number;
}
export declare function gapOverTime(db: Db, repoId: string, weeks?: number): GapPoint[];
/** Every read path calls this first, so elapsed decay is always applied. */
export declare function refresh(db: Db, repoId: string): number;
export interface ZoneGap {
    zoneName: string;
    gap: number;
    reps: number;
}
export declare function gapPerZone(db: Db, repoId: string, windowDays?: number): ZoneGap[];
export declare function extractionCost(db: Db): {
    totalUsd: number;
    calls: number;
    failures: number;
};
