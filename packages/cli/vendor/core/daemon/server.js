import http from 'node:http';
import { writeFileSync } from 'node:fs';
import { daemonInfoPath } from '../home.js';
import { routes, HttpError } from './routes.js';
import { DAEMON_VERSION } from './version.js';
/** Localhost only. The daemon is the single writer to SQLite (spec §2). */
export function startServer(ctx, port = 0) {
    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        let body = undefined;
        if (req.method === 'POST') {
            const chunks = [];
            for await (const c of req)
                chunks.push(c);
            const raw = Buffer.concat(chunks).toString('utf8');
            try {
                body = raw ? JSON.parse(raw) : {};
            }
            catch {
                res.writeHead(400, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ error: 'invalid JSON body' }));
                return;
            }
        }
        for (const route of routes) {
            if (route.method !== req.method)
                continue;
            const m = url.pathname.match(route.pattern);
            if (!m)
                continue;
            try {
                const result = await route.handler(ctx, (m.groups ?? {}), body, url.searchParams);
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify(result ?? null));
            }
            catch (e) {
                const status = e instanceof HttpError ? e.status : 500;
                res.writeHead(status, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ error: e.message }));
            }
            return;
        }
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
    });
    return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(port, '127.0.0.1', () => {
            const addr = server.address();
            const actualPort = typeof addr === 'object' && addr ? addr.port : port;
            resolve({ server, port: actualPort });
        });
    });
}
export async function runDaemon() {
    const { createCtx } = await import('./routes.js');
    const ctx = createCtx();
    const { port } = await startServer(ctx);
    writeFileSync(daemonInfoPath(), JSON.stringify({ port, pid: process.pid, startedAt: new Date().toISOString(), version: DAEMON_VERSION }));
    // eslint-disable-next-line no-console
    console.log(`vouch daemon on 127.0.0.1:${port}`);
}
