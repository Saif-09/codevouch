import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { daemonInfoPath } from '@vouch/core';

const require = createRequire(import.meta.url);

/** Healthy AND running the same build as this CLI (see DAEMON_VERSION). */
async function health(port: number, expected: string): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return false;
    const doc: any = await res.json();
    return doc?.version === expected;
  } catch {
    return false;
  }
}

/** Stop a daemon left over from an older build, and wait for it to go. */
async function stopStale(): Promise<void> {
  try {
    const { pid } = JSON.parse(readFileSync(daemonInfoPath(), 'utf8'));
    process.kill(pid, 'SIGTERM');
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 50));
      try {
        process.kill(pid, 0);
      } catch {
        return;
      }
    }
  } catch { /* nothing running */ }
}

export async function daemonPort(): Promise<number> {
  const { DAEMON_VERSION } = await import('@vouch/core/daemon-version');
  const infoPath = daemonInfoPath();
  if (existsSync(infoPath)) {
    try {
      const { port } = JSON.parse(readFileSync(infoPath, 'utf8'));
      if (await health(port, DAEMON_VERSION)) return port;
      await stopStale(); // an older build is running: replace it
    } catch { /* stale info file; respawn below */ }
  }
  // spawn detached and wait for the info file
  const daemonMain = require.resolve('@vouch/core/daemon');
  const child = spawn(process.execPath, ['--no-warnings', daemonMain], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
  child.unref();
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 120));
    if (existsSync(infoPath)) {
      try {
        const { port } = JSON.parse(readFileSync(infoPath, 'utf8'));
        if (await health(port, DAEMON_VERSION)) return port;
      } catch { /* not ready yet */ }
    }
  }
  throw new Error('vouch daemon failed to start (see ~/.vouch/daemon.log)');
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const port = await daemonPort();
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const doc: any = await res.json();
  if (!res.ok) throw new Error(doc?.error ?? `daemon ${res.status}`);
  return doc as T;
}
