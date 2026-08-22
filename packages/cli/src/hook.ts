import { existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MARKER = '# vouch-tick (installed by vouch init)';

function cliMain(): string {
  return fileURLToPath(import.meta.url).replace(/hook\.js$/, 'main.js');
}

/** Backgrounded and silenced: the hook must never slow or fail a commit. */
export function installPostCommitHook(repoRoot: string): void {
  const hookPath = join(repoRoot, '.git', 'hooks', 'post-commit');
  const line = `${MARKER}\n("${process.execPath}" "${cliMain()}" session tick >/dev/null 2>&1 &) || true\n`;
  mkdirSync(dirname(hookPath), { recursive: true });
  if (existsSync(hookPath)) {
    const current = readFileSync(hookPath, 'utf8');
    if (current.includes(MARKER)) return; // idempotent
    writeFileSync(hookPath, current.trimEnd() + '\n' + line);
  } else {
    writeFileSync(hookPath, `#!/bin/sh\n${line}`);
  }
  chmodSync(hookPath, 0o755);
}

export function removePostCommitHook(repoRoot: string): void {
  const hookPath = join(repoRoot, '.git', 'hooks', 'post-commit');
  if (!existsSync(hookPath)) return;
  const lines = readFileSync(hookPath, 'utf8').split('\n');
  const idx = lines.findIndex((l) => l.includes(MARKER));
  if (idx === -1) return;
  lines.splice(idx, 2); // marker + command line
  const rest = lines.join('\n');
  writeFileSync(hookPath, rest);
}
