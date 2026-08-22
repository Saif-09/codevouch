import http from 'node:http';
import { type Ctx } from './routes.js';
/** Localhost only. The daemon is the single writer to SQLite (spec §2). */
export declare function startServer(ctx: Ctx, port?: number): Promise<{
    server: http.Server;
    port: number;
}>;
export declare function runDaemon(): Promise<void>;
