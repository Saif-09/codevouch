import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

/** ~/.vouch by default; VOUCH_HOME overrides for tests and purge safety. */
export function vouchHome(): string {
  const dir = process.env.VOUCH_HOME ?? join(homedir(), '.vouch');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function dbPath(): string {
  return join(vouchHome(), 'vouch.db');
}

export function daemonInfoPath(): string {
  return join(vouchHome(), 'daemon.json');
}

export function logPath(): string {
  return join(vouchHome(), 'daemon.log');
}
