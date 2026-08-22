#!/usr/bin/env node
/**
 * UserPromptSubmit hook.
 *
 * Two rules govern every line of this file:
 *  - It MUST NEVER block. Exit code 2 erases the prompt the user just typed,
 *    so it is never used here under any circumstance.
 *  - It MUST fail open. Any error exits 0 with no output, and the prompt
 *    proceeds untouched. A training tool is never worth breaking a session.
 *
 * It also runs in front of every prompt, so it stays read-mostly and quick.
 */
import { existsSync } from 'node:fs';
import { readStdin, loadCore, dbFile } from './lib.mjs';

async function main() {
  const input = await readStdin();
  const cwd = input.cwd ?? process.cwd();
  const promptId = input.prompt_id ?? '';
  // Claude Code 2.1.238 sends ; the published docs say .
  // Accept both, and treat an unknown shape as "not eligible" rather than
  // guessing, so a future rename degrades to silence instead of misfiring.
  const userInput = input.prompt ?? input.user_input ?? '';

  if (process.env.VOUCH_HUNCH === 'off') return;
  if (!existsSync(dbFile())) return; // vouch not set up here

  const core = await loadCore();
  const db = core.openDb(dbFile());
  try {
    const check = core.checkEligibility(db, cwd, promptId, userInput, {
      cooldownMinutes: Number(process.env.VOUCH_HUNCH_COOLDOWN ?? core.DEFAULT_COOLDOWN_MINUTES),
      sampleOneIn: Number(process.env.VOUCH_HUNCH_SAMPLE ?? core.DEFAULT_SAMPLE_ONE_IN),
    });
    if (!check.eligible) return;

    core.openHunch(db, check.repoId, promptId);
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext: core.hunchInstruction(),
        },
      }),
    );
  } finally {
    db.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(0)); // fail open, always
