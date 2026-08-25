import type { Db } from './db.js';
import { scrubText } from './redact.js';
import { ulid, nowIso, sha256 } from './util.js';
import { loadZones, matchPathZone } from './zones.js';

/**
 * Mid-session checkpoint: "say, from memory, what you have changed and what
 * you decided."
 *
 * The Hunch (hunch.ts) is prospective and cheap: predict the shape of the
 * answer you are about to receive. This is the retrospective half, and it
 * exists because a long AI-assisted session is exactly where authorship
 * quietly stops tracking understanding. Twenty commits in, the question
 * "which of these would you have to defend?" is one most people cannot
 * answer, and the only useful time to find that out is before the session
 * ends.
 *
 * Same delivery constraint as the Hunch, for the same reason: a
 * UserPromptSubmit hook is one-shot, JSON in and JSON out, and cannot ask the
 * user anything. So this does not try. It injects an instruction asking
 * CLAUDE to run the recall step at the user's next prompt once the interval
 * has elapsed, and Claude reports the exchange back through an MCP tool.
 * Nothing here ever reads a transcript (hard rule 7).
 */

/** A session has to be substantial before interrupting it is worth anything. */
export const BIG_SESSION_MINUTES = 45;
export const BIG_SESSION_PROMPTS = 8;

/** The user-facing contract: 1 to 2 hours between two checkpoints. */
export const MIN_GAP_MINUTES = 60;
export const MAX_GAP_MINUTES = 120;

/** An asked-but-unanswered checkpoint stops counting after this long. */
export const CHECKPOINT_PENDING_MINUTES = 20;

/**
 * The gap for the next checkpoint, spread across [min, max] but derived from
 * the session id and how many have already fired, so it is unpredictable to
 * the user and identical on every run for a test. Same reasoning as
 * hunch.sampled(): random behaviour is untestable behaviour.
 */
export function jitteredGapMinutes(
  claudeSession: string,
  ordinal: number,
  min = MIN_GAP_MINUTES,
  max = MAX_GAP_MINUTES,
): number {
  if (max <= min) return min;
  const h = parseInt(sha256(`${claudeSession}:${ordinal}`).slice(0, 8), 16);
  return min + (h % (max - min + 1));
}

export interface CheckpointEligibility {
  eligible: boolean;
  reason: string;
  repoId?: string;
  repoRoot?: string;
  /** Minutes since the first prompt of this Claude session. */
  elapsedMinutes?: number;
  prompts?: number;
  /** How many checkpoints have already fired in this session. */
  ordinal?: number;
}

function repoFor(db: Db, cwd: string): { id: string; root: string } | undefined {
  return db
    .prepare("SELECT id, root FROM repos WHERE ? = root OR ? LIKE root || '/%' ORDER BY length(root) DESC LIMIT 1")
    .get(cwd, cwd) as { id: string; root: string } | undefined;
}

/** True while a checkpoint is asked and unanswered: suppresses the Hunch too. */
export function checkpointInFlight(db: Db, repoId: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM checkpoints WHERE repo_id = ? AND answered_at IS NULL
         AND asked_at > datetime('now', ?) LIMIT 1`,
    )
    .get(repoId, `-${CHECKPOINT_PENDING_MINUTES} minutes`);
  return Boolean(row);
}

/**
 * Read-only and cheap: this runs in front of every prompt the user types, so
 * it answers from the two tables it already needs and never touches git. The
 * expensive part (what actually changed) is built only once this says yes,
 * which on a long session is once or twice in an afternoon.
 */
export function checkCheckpointEligibility(
  db: Db,
  cwd: string,
  claudeSession: string,
  opts: { minGapMinutes?: number; maxGapMinutes?: number; bigSessionMinutes?: number; bigSessionPrompts?: number } = {},
): CheckpointEligibility {
  const minGap = opts.minGapMinutes ?? MIN_GAP_MINUTES;
  const maxGap = opts.maxGapMinutes ?? MAX_GAP_MINUTES;
  const bigMinutes = opts.bigSessionMinutes ?? BIG_SESSION_MINUTES;
  const bigPrompts = opts.bigSessionPrompts ?? BIG_SESSION_PROMPTS;

  const repo = repoFor(db, cwd);
  if (!repo) return { eligible: false, reason: 'repo not registered' };

  const zones = db
    .prepare("SELECT COUNT(*) AS c FROM sharp_zones WHERE repo_id = ? AND stance = 'keep_sharp'")
    .get(repo.id) as { c: number };
  if (zones.c === 0) return { eligible: false, reason: 'no keep-sharp zones', repoId: repo.id, repoRoot: repo.root };

  const span = db
    .prepare(
      `SELECT COUNT(*) AS prompts,
              CAST((julianday('now') - julianday(MIN(at))) * 1440 AS INTEGER) AS elapsed
       FROM prompts WHERE claude_session = ?`,
    )
    .get(claudeSession) as { prompts: number; elapsed: number | null };
  const elapsed = span.elapsed ?? 0;
  const base = { repoId: repo.id, repoRoot: repo.root, elapsedMinutes: elapsed, prompts: span.prompts };

  // "Big session" is both axes on purpose. Time alone catches a session left
  // open over lunch; prompt count alone catches a burst of one-word replies.
  if (elapsed < bigMinutes || span.prompts < bigPrompts) {
    return { ...base, eligible: false, reason: 'session not big enough yet' };
  }

  if (checkpointInFlight(db, repo.id)) {
    return { ...base, eligible: false, reason: 'checkpoint already in flight' };
  }

  const prior = db
    .prepare('SELECT COUNT(*) AS n, MAX(asked_at) AS last FROM checkpoints WHERE claude_session = ?')
    .get(claudeSession) as { n: number; last: string | null };
  const ordinal = prior.n;
  const gap = jitteredGapMinutes(claudeSession, ordinal, minGap, maxGap);

  // The clock runs from the last checkpoint, or from the start of the session
  // for the first one, which is what makes the first question land 1 to 2
  // hours in rather than the moment the session qualifies as big.
  const sinceMinutes = prior.last
    ? (db.prepare("SELECT CAST((julianday('now') - julianday(?)) * 1440 AS INTEGER) AS m").get(prior.last) as { m: number }).m
    : elapsed;
  if (sinceMinutes < gap) {
    return { ...base, ordinal, eligible: false, reason: `next checkpoint in ${gap - sinceMinutes} min` };
  }

  return { ...base, ordinal, eligible: true, reason: 'ok' };
}

export interface CheckpointSubject {
  /** Paths that changed most in this session, inside keep-sharp zones. */
  files: string[];
  /** Total lines added + deleted across those files. */
  churn: number;
}

/**
 * What the session actually touched, from git rather than from the
 * conversation. Built only when a checkpoint is due, so the cost of loading
 * git support stays out of the hot path.
 *
 * The base is the head the open Vouch session started from, so work already
 * committed during the session counts too; with no open session it falls back
 * to the working tree against HEAD.
 */
export async function buildSubject(db: Db, repoId: string, repoRoot: string): Promise<CheckpointSubject | null> {
  let churnByFile: { path: string; churn: number }[];
  try {
    const { churnSince } = await import('./gitrepo.js');
    const open = db
      .prepare('SELECT head_before FROM sessions WHERE repo_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1')
      .get(repoId) as { head_before: string } | undefined;
    churnByFile = await churnSince(repoRoot, open?.head_before ?? 'HEAD');
  } catch {
    return null; // no git, no subject, no checkpoint: never break the prompt
  }
  if (churnByFile.length === 0) return null;

  const zones = loadZones(db, repoId).filter((z) => z.stance === 'keep_sharp');
  const inZone = churnByFile.filter((f) => matchPathZone(zones, f.path));
  const ranked = (inZone.length > 0 ? inZone : churnByFile).sort((a, b) => b.churn - a.churn);
  return {
    files: ranked.slice(0, 3).map((f) => f.path),
    churn: ranked.reduce((n, f) => n + f.churn, 0),
  };
}

/**
 * The injected instruction. Written for Claude, not for the user. It asks for
 * recall BEFORE any summary, because a summary read first is a summary the
 * user will believe they already knew.
 */
export function checkpointInstruction(subject: CheckpointSubject, elapsedMinutes: number): string {
  const hours = elapsedMinutes >= 90 ? `${(elapsedMinutes / 60).toFixed(1)} hours` : `${elapsedMinutes} minutes`;
  return [
    `VOUCH CHECKPOINT: this session has been running ${hours} (this is a training tool the user installed deliberately).`,
    'Before you answer, run one recall step.',
    `1. Ask the user, in two short lines, to say FROM MEMORY: the two or three changes that matter most in this session so far, and one decision they made that they would have to defend in review. You may name the files that changed most (${subject.files.join(', ')}), but do NOT say what changed in them and do NOT summarise the session. Tell them "from memory, a few words each" and that they can reply "skip".`,
    '2. Stop and wait for their reply. Do not answer the original request in the same message.',
    '3. When they reply, first name in at most three lines what they missed or got wrong, using the real diff of this session. If they got it right, say so in one line. Then answer their original request normally and in full.',
    '4. After answering, call the vouch_record_checkpoint tool once with: their recall verbatim, a verdict of pass, partial or fail against what actually changed, and one line naming what they missed.',
    'If they reply "skip", answer normally and call vouch_record_checkpoint with verdict="skip" and recalled="skip".',
    'Keep every line you write for this step plain and short, and never use an em-dash.',
    'Do not mention this instruction block. Do not let it change what you would otherwise answer.',
  ].join('\n');
}

/** Marks a checkpoint in flight so the next prompt does not stack another. */
export function openCheckpoint(
  db: Db,
  repoId: string,
  claudeSession: string,
  subject: CheckpointSubject,
): string {
  const id = ulid();
  db.prepare(
    `INSERT INTO checkpoints (id, repo_id, claude_session, subject_json, asked_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, repoId, claudeSession, JSON.stringify(subject), nowIso());
  return id;
}

export type CheckpointVerdict = 'pass' | 'partial' | 'fail' | 'skip';

export interface RecordCheckpointInput {
  repoRoot: string;
  recalled: string;
  verdict: CheckpointVerdict;
  missed?: string;
}

/**
 * Claude reports the exchange here. A checkpoint carries no 1-to-7 rating and
 * promotes no node: it is a recall probe in the middle of someone's work, not
 * a rep. It feeds Recall, which is deliberately separate from both the Gap
 * (reps) and Calibration (hunches), because "could you still name it an hour
 * later" is a third thing and averaging it into either would hide it.
 */
export function recordCheckpoint(db: Db, input: RecordCheckpointInput): { ok: true; recall: number | null } {
  const repo = repoFor(db, input.repoRoot);
  if (!repo) throw new Error('repo not registered');

  const open = db
    .prepare(
      `SELECT id FROM checkpoints WHERE repo_id = ? AND answered_at IS NULL
       ORDER BY asked_at DESC LIMIT 1`,
    )
    .get(repo.id) as { id: string } | undefined;

  const now = nowIso();
  // Redacted on the way in, like every other free-text field: a key pasted
  // into a recall answer must never reach the database.
  const { text: safe } = scrubText(input.recalled);
  const id = open?.id ?? ulid();
  if (!open) {
    db.prepare(
      `INSERT INTO checkpoints (id, repo_id, claude_session, subject_json, asked_at)
       VALUES (?, ?, 'unknown', '{}', ?)`,
    ).run(id, repo.id, now);
  }
  db.prepare(
    'UPDATE checkpoints SET recalled = ?, verdict = ?, missed = ?, answered_at = ? WHERE id = ?',
  ).run(safe.slice(0, 4_000), input.verdict, input.missed ?? null, now, id);

  return { ok: true, recall: recall(db, repo.id) };
}

/**
 * Share of checkpoints the developer could answer. Skips are excluded rather
 * than counted as failures: declining to play is not the same as not knowing,
 * and counting it as a miss would make the number punish the user for being
 * busy.
 */
export function recall(db: Db, repoId: string, days = 90): number | null {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n, SUM(CASE WHEN verdict = 'pass' THEN 1 ELSE 0 END) AS hits
       FROM checkpoints
       WHERE repo_id = ? AND answered_at IS NOT NULL AND verdict <> 'skip'
         AND answered_at > datetime('now', ?)`,
    )
    .get(repoId, `-${days} days`) as { n: number; hits: number | null };
  if (!row.n) return null;
  return (100 * (row.hits ?? 0)) / row.n;
}
