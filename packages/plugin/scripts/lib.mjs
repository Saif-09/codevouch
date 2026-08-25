import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Locate the compiled core. The plugin scripts run inside Claude Code, not
 * inside the Vouch monorepo, so this checks the in-repo layout first and then
 * the installed package. VOUCH_CORE overrides for development and tests.
 */
function coreDir() {
  const explicit = process.env.VOUCH_CORE;
  if (explicit) return dirname(explicit);
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '..', '..', 'core', 'dist'),        // monorepo
    join(here, '..', 'vendor', 'core'),            // published package
    join(here, '..', 'node_modules', '@vouch', 'core', 'dist'),
  ];
  for (const c of candidates) {
    if (existsSync(join(c, 'index.js'))) return c;
  }
  const require = createRequire(import.meta.url);
  return dirname(require.resolve('@vouch/core'));
}

/**
 * Load ONLY the named modules.
 *
 * The barrel export pulls in ts-morph, simple-git and the whole feed layer,
 * which cost about 170ms of import time. This hook runs in front of every
 * prompt the user types, so it imports the two or three small modules it
 * actually needs and nothing else. Measured, not guessed.
 */
export async function loadCoreModules(names) {
  const dir = coreDir();
  const mods = await Promise.all(names.map((n) => import(pathToFileURL(join(dir, `${n}.js`)).href)));
  return Object.assign({}, ...mods);
}

/** Full core, for the paths where startup time does not matter. */
export async function loadCore() {
  return import(pathToFileURL(join(coreDir(), 'index.js')).href);
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
