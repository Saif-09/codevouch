#!/usr/bin/env -S node --no-warnings
/**
 * SessionEnd hook: close the Vouch session precisely rather than waiting for
 * the idle timeout, so the digest is ready when the user next looks.
 *
 * Ingest reads the diff from git (hook payloads carry none, RESEARCH §7.3),
 * and this never touches the transcript (hard rule 7). Fails open.
 */
import { existsSync } from 'node:fs';
import { readStdin, loadCoreModules, dbFile } from './lib.mjs';

async function main() {
  const input = await readStdin();
  const cwd = input.cwd ?? process.cwd();
  if (!existsSync(dbFile())) return;

  const core = await loadCoreModules(['db', 'ingest']);
  const db = core.openDb(dbFile());
  try {
    const repo = db
      .prepare("SELECT id, root, name FROM repos WHERE ? = root OR ? LIKE root || '/%' ORDER BY length(root) DESC LIMIT 1")
      .get(cwd, cwd);
    if (!repo) return;
    await core.explicitEnd(db, repo);
  } finally {
    db.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(0));
