#!/usr/bin/env -S node --no-warnings
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
import { readStdin, loadCoreModules, dbFile } from './lib.mjs';

async function main() {
  const input = await readStdin();
  const cwd = input.cwd ?? process.cwd();
  const promptId = input.prompt_id ?? '';
  // Claude Code 2.1.238 sends ; the published docs say .
  // Accept both, and treat an unknown shape as "not eligible" rather than
  // guessing, so a future rename degrades to silence instead of misfiring.
  const userInput = input.prompt ?? input.user_input ?? '';

  if (!existsSync(dbFile())) return; // vouch not set up here

  // only the modules this hook needs: see loadCoreModules
  const core = await loadCoreModules(['db', 'promptlog', 'hunch', 'checkpoint']);
  const db = core.openDb(dbFile());
  try {
    // Record every prompt for `vouch prompts`. Redacted on the way in, and
    // wrapped so a logging failure can never affect the session.
    try {
      core.recordPrompt(db, input.session_id ?? 'unknown', cwd, userInput);
    } catch { /* logging is never worth breaking a prompt over */ }

    // The checkpoint goes first. It fires once or twice in an afternoon
    // against the hunch's every-45-minutes, and asking both in one prompt
    // would spend the user's attention twice before they get an answer.
    if (process.env.VOUCH_CHECKPOINT !== 'off') {
      const cp = core.checkCheckpointEligibility(db, cwd, input.session_id ?? 'unknown', {
        minGapMinutes: Number(process.env.VOUCH_CHECKPOINT_MIN ?? core.MIN_GAP_MINUTES),
        maxGapMinutes: Number(process.env.VOUCH_CHECKPOINT_MAX ?? core.MAX_GAP_MINUTES),
      });
      if (cp.eligible) {
        const subject = await core.buildSubject(db, cp.repoId, cp.repoRoot);
        // No churn means nothing to recall: stay quiet rather than ask about
        // a session that only read code.
        if (subject) {
          core.openCheckpoint(db, cp.repoId, input.session_id ?? 'unknown', subject);
          process.stdout.write(
            JSON.stringify({
              hookSpecificOutput: {
                hookEventName: 'UserPromptSubmit',
                additionalContext: core.checkpointInstruction(subject, cp.elapsedMinutes),
              },
            }),
          );
          return;
        }
      }
      // A checkpoint waiting for an answer also suppresses the hunch: the
      // user's recall reply is itself a prompt.
      if (cp.repoId && core.checkpointInFlight(db, cp.repoId)) return;
    }

    const check = core.checkEligibility(db, cwd, promptId, userInput, {
      cooldownMinutes: Number(process.env.VOUCH_HUNCH_COOLDOWN ?? core.DEFAULT_COOLDOWN_MINUTES),
      sampleOneIn: Number(process.env.VOUCH_HUNCH_SAMPLE ?? core.DEFAULT_SAMPLE_ONE_IN),
    });
    if (process.env.VOUCH_HUNCH === 'off') return;
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
