import type { Db } from './db.js';
/**
 * Spec §6. One interface, two adapters, from the first commit, because batch
 * use of a subscription via `claude -p` is neither prohibited nor explicitly
 * permitted (RESEARCH §7.5). ClaudeCliBackend is the default for personal
 * use; GatewayBackend exists so distribution never depends on resolving
 * someone else's subscription terms.
 *
 * Extraction is batch, at session end, never in the hot loop. Failure
 * DEGRADES, never blocks: callers catch ExtractionError and carry on.
 */
export type ExtractionTask = 'concepts' | 'dossier' | 'brief' | 'grade';
export interface ExtractionSpec {
    task: ExtractionTask;
    system: string;
    input: string;
    schema: object;
    maxUsd?: number;
}
export interface ExtractionResult<T> {
    value: T;
    costUsd: number | null;
}
export declare class ExtractionError extends Error {
}
export interface ExtractionBackend {
    run<T>(spec: ExtractionSpec): Promise<ExtractionResult<T>>;
}
export declare class ClaudeCliBackend implements ExtractionBackend {
    private bin;
    private model;
    /**
     * Extraction defaults to haiku: measured on 2.1.238, the Claude Code
     * system-prompt overhead alone costs ~$0.74 per cold call on a frontier
     * model and ~$0.05 on haiku, and dossier extraction does not need a
     * frontier model. (--bare would shed the overhead but skips the keychain
     * read, losing subscription auth entirely.)
     */
    constructor(bin?: string, model?: string);
    run<T>(spec: ExtractionSpec): Promise<ExtractionResult<T>>;
}
export declare class GatewayBackend implements ExtractionBackend {
    private apiKey;
    private model;
    constructor(apiKey: string, model?: string);
    run<T>(spec: ExtractionSpec): Promise<ExtractionResult<T>>;
}
export declare function chooseBackend(): ExtractionBackend;
/** Wraps a backend with the local cost meter (`vouch status` prints it). */
export declare function metered(db: Db, backend: ExtractionBackend): ExtractionBackend;
