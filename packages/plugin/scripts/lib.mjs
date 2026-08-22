import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The plugin scripts run inside Claude Code, not inside the Vouch monorepo,
 * so they resolve @vouch/core from the installed CLI's own node_modules.
 * VOUCH_CORE overrides for development and tests.
 */
export async function loadCore() {
  const explicit = process.env.VOUCH_CORE;
  if (explicit) return import(explicit);

  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '..', '..', 'core', 'dist', 'index.js'),          // in-repo layout
    join(here, '..', 'node_modules', '@vouch', 'core', 'dist', 'index.js'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return import(c);
  }
  const require = createRequire(import.meta.url);
  return import(require.resolve('@vouch/core'));
}

export function vouchHomeDir() {
  return process.env.VOUCH_HOME ?? join(homedir(), '.vouch');
}

export function dbFile() {
  return join(vouchHomeDir(), 'vouch.db');
}

export async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw ? JSON.parse(raw) : {};
}
