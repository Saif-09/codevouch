import type { Db } from './db.js';
/**
 * A `decision` node stands for the cluster of artifacts it is about. When
 * the Defend rep passes, those artifacts are promoted with it: you have just
 * demonstrated you can explain the change those files make up.
 *
 * Promotion walks the same one-step state machine as everything else, so an
 * artifact at `unknown` reaches `explained`, and reaches `defended` only if
 * a later pass moves it again. Nothing skips a state.
 */
export declare function promoteClusterArtifacts(db: Db, decisionId: string, repId: string): number;
