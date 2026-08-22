import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * The daemon's build identity, derived from the compiled code it serves.
 *
 * This was a hand-edited string and broke three times: twice mangled by a
 * find-and-replace, once simply forgotten after a route change, which left a
 * stale daemon serving old logic while everything looked fine. A version you
 * have to remember to change is a version that will be wrong.
 *
 * The first attempt at hashing only covered this directory, which missed the
 * bulk of the daemon's behaviour: the route handlers call into modules a
 * level up, so editing one of those changed nothing here and the stale daemon
 * survived anyway. It hashes the whole compiled package now.
 */
function walkJs(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir).sort()) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walkJs(p, acc);
    else if (p.endsWith('.js') && !p.endsWith(`${'version'}.js`)) acc.push(p);
  }
  return acc;
}

function computeVersion(): string {
  try {
    const coreDist = dirname(dirname(fileURLToPath(import.meta.url)));
    const hash = createHash('sha256');
    for (const f of walkJs(coreDist)) hash.update(readFileSync(f));
    return hash.digest('hex').slice(0, 12);
  } catch {
    // Unreadable tree: return a constant so a running daemon is reused rather
    // than restarted on every command.
    return 'unknown';
  }
}

export const DAEMON_VERSION: string = computeVersion();
