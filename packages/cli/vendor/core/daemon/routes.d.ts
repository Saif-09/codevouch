import type { Db } from '../db.js';
import { type Repo } from '../ingest.js';
import { type ExtractionBackend } from '../extraction.js';
export interface Ctx {
    db: Db;
    backend: ExtractionBackend;
}
export declare function createCtx(backend?: ExtractionBackend): Ctx;
export declare class HttpError extends Error {
    status: number;
    constructor(status: number, message: string);
}
/**
 * First ingest at init (Wave 1 spec §1): the whole current HEAD becomes the
 * baseline graph. Every current direct dependency gets a node (and later a
 * dossier or an explicit out-of-zone classification: DoD #2, no silent
 * omissions), every in-zone source file contributes artifact nodes. All of
 * it starts at `unknown`, which is simply the honest state.
 */
export declare function backfill(ctx: Ctx, repo: Repo): Promise<{
    deps: number;
    artifacts: number;
}>;
/** Generate dossiers for every dependency node still missing one. Degrades per node. */
export declare function generatePendingDossiers(ctx: Ctx, repo: Repo, limit?: number, nodeIds?: string[]): Promise<{
    generated: number;
    failed: number;
}>;
export interface Route {
    method: string;
    pattern: RegExp;
    handler: (ctx: Ctx, params: Record<string, string>, body: any, query: URLSearchParams) => Promise<any>;
}
export declare const routes: Route[];
