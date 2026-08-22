import type { Db } from './db.js';
export type NodeState = 'unknown' | 'explained' | 'predicted' | 'defended' | 'decayed';
export type Verdict = 'pass' | 'partial' | 'fail' | 'ungraded';
export type StateEvent = {
    type: 'reveal';
} | {
    type: 'hunch_correct';
} | {
    type: 'verdict';
    verdict: Verdict;
} | {
    type: 'decay';
};
export type Cause = 'ingest' | 'rep_pass' | 'rep_fail' | 'decay' | 'manual';
/**
 * The transition table from spec §4, pure. Returns null when nothing changes.
 * Constraints encoded here and asserted by tests:
 *  - demotion is one step at a time and never below `unknown`
 *  - only `defended` decays
 *  - `partial` and `ungraded` never move state
 */
export declare function transition(state: NodeState, event: StateEvent): {
    to: NodeState;
    cause: Cause;
} | null;
/** Applies an event to a stored node, writing the append-only audit row. */
export declare function applyEvent(db: Db, nodeId: string, event: StateEvent, repId?: string): NodeState | null;
/** Manual verdict override by the user; always audited as cause 'manual'. */
export declare function manualSetState(db: Db, nodeId: string, to: NodeState): void;
