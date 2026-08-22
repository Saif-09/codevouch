import type { Db } from './db.js';
/**
 * Spec §4: only `defended` decays, only for nodes that are alive and in zone,
 * default window 90 days per zone, and `critical` nodes use half the window.
 *
 * The sweep is LAZY, run on read rather than on a timer. A local daemon may
 * be down for a week; a scheduler would simply miss that window, whereas
 * evaluating elapsed time when someone actually looks is always correct.
 */
export declare const DEFAULT_DECAY_DAYS = 90;
export declare function sweepDecay(db: Db, repoId: string): number;
/** Nodes whose decay window is more than 80% elapsed: the card queue. */
export declare function approachingDecay(db: Db, repoId: string, limit?: number): string[];
