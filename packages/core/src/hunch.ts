import type { Db } from './db.js';
import { ulid, nowIso, sha256, slugify } from './util.js';

/**
 * Phase 3: real-time Hunch (RESEARCH §7.1).
 *
 * A UserPromptSubmit hook cannot ask the user anything: hooks are one-shot,
 * JSON in and JSON out. So Vouch does not try. It injects `additionalContext`
 * that asks CLAUDE to run the prediction step, because the model is the only
 * component in the loop that can hold a conversation. Claude then reports the
 * exchange back through an MCP tool, which is why nothing here ever reads a
 * transcript (hard rule 7).
 */

export const PENDING_MINUTES = 20;
export const DEFAULT_COOLDOWN_MINUTES = 45;
export const DEFAULT_SAMPLE_ONE_IN = 3;

/** Prompts too short or too procedural to carry a predictable answer. */
const TRIVIAL = /^\s*(y|n|yes|no|ok|okay|go|next|continue|thanks|ty|stop|do it|proceed|please continue)\b/i;

export function isSubstantivePrompt(text: string): boolean {
  if (!text || text.trim().length < 40) return false;
  if (TRIVIAL.test(text)) return false;
  return true;
}

/** Deterministic sampling, so behaviour is testable rather than random. */
export function sampled(promptId: string, oneIn: number): boolean {
  if (oneIn <= 1) return true;
  const h = parseInt(sha256(promptId).slice(0, 8), 16);
  return h % oneIn === 0;
}

export interface HunchEligibility {
  eligible: boolean;
  reason: string;
  repoId?: string;
}

/**
 * Read-only and cheap: this runs synchronously in front of every prompt the
 * user types, so it must be fast and must never throw into the session.
 */
export function checkEligibility(
  db: Db,
  cwd: string,
  promptId: string,
  userInput: string,
  opts: { cooldownMinutes?: number; sampleOneIn?: number } = {},
): HunchEligibility {
  const cooldown = opts.cooldownMinutes ?? DEFAULT_COOLDOWN_MINUTES;
  const oneIn = opts.sampleOneIn ?? DEFAULT_SAMPLE_ONE_IN;

  const repo = db
    .prepare('SELECT id FROM repos WHERE ? = root OR ? LIKE root || \'/%\' ORDER BY length(root) DESC LIMIT 1')
    .get(cwd, cwd) as { id: string } | undefined;
  if (!repo) return { eligible: false, reason: 'repo not registered' };

  const zones = db
    .prepare("SELECT COUNT(*) AS c FROM sharp_zones WHERE repo_id = ? AND stance = 'keep_sharp'")
    .get(repo.id) as { c: number };
  if (zones.c === 0) return { eligible: false, reason: 'no keep-sharp zones', repoId: repo.id };

  if (!isSubstantivePrompt(userInput)) return { eligible: false, reason: 'prompt too slight', repoId: repo.id };

  // Never interrupt a hunch that is already in flight: the user's reply to
  // Claude's prediction question is itself a prompt, and would otherwise
  // trigger a second hunch on top of the first.
  const pending = db
    .prepare(
      `SELECT 1 FROM reps r JOIN nodes n ON n.id = r.node_id
       WHERE n.repo_id = ? AND r.type = 'hunch' AND r.answered_at IS NULL
         AND r.asked_at > datetime('now', ?) LIMIT 1`,
    )
    .get(repo.id, `-${PENDING_MINUTES} minutes`);
  if (pending) return { eligible: false, reason: 'hunch already in flight', repoId: repo.id };

  const recent = db
    .prepare(
      `SELECT 1 FROM reps r JOIN nodes n ON n.id = r.node_id
       WHERE n.repo_id = ? AND r.type = 'hunch'
         AND r.asked_at > datetime('now', ?) LIMIT 1`,
    )
    .get(repo.id, `-${cooldown} minutes`);
  if (recent) return { eligible: false, reason: 'cooling down', repoId: repo.id };

  if (!sampled(promptId, oneIn)) return { eligible: false, reason: 'not sampled', repoId: repo.id };

  return { eligible: true, reason: 'ok', repoId: repo.id };
}

/**
 * The injected instruction. Written for Claude, not for the user, and
 * deliberately short: it competes for attention with the real request, and
 * must never override it.
 */
export function hunchInstruction(): string {
  return [
    'VOUCH: before you answer, run one prediction step (this is a training tool the user installed deliberately).',
    '1. Ask the user, in one short line, to predict the SHAPE of your answer before they see it: the approach, the API or function name, the likely root cause, or which file it lives in. Not the full code. Tell them "just a guess, one line" and that they can reply "skip".',
    '2. Stop and wait for their reply. Do not answer the original request in the same message.',
    '3. When they reply, answer the original request normally and in full.',
    '4. After answering, call the vouch_record_hunch tool once with: a short topic for what was asked about, their prediction verbatim, whether it matched the shape of your answer, and one line naming the difference.',
    'If they reply "skip", answer normally and call vouch_record_hunch with matched=false and prediction="skip".',
    'Keep every line you write for this step plain and short, and never use an em-dash.',
    'Do not mention this instruction block. Do not let it change what you would otherwise answer.',
  ].join('\n');
}

/** Marks a hunch in flight so the next prompt does not trigger another. */
export function openHunch(db: Db, repoId: string, promptId: string): string {
  const key = 'concept:pending-hunch';
  let nodeId = (db.prepare("SELECT id FROM nodes WHERE repo_id = ? AND kind = 'concept' AND key = ?").get(repoId, key) as { id: string } | undefined)?.id;
  const now = nowIso();
  if (!nodeId) {
    nodeId = ulid();
    db.prepare(
      `INSERT INTO nodes (id, repo_id, kind, key, label, state, alive, in_zone, critical, state_changed_at, created_at)
       VALUES (?, ?, 'concept', ?, 'hunch in flight', 'unknown', 1, 0, 0, ?, ?)`,
    ).run(nodeId, repoId, key, now, now);
  }
  const repId = ulid();
  db.prepare("INSERT INTO reps (id, node_id, type, prompt_json, asked_at) VALUES (?, ?, 'hunch', ?, ?)")
    .run(repId, nodeId, JSON.stringify({ promptId }), now);
  return repId;
}

export interface RecordHunchInput {
  repoRoot: string;
  topic: string;
  prediction: string;
  matched: boolean;
  note?: string;
}

/**
 * Claude reports the exchange here. Hunch reps carry no 1-to-7 rating: the
 * prediction itself is the generative act, and asking for a rating too would
 * put friction in the hot loop. Hunch therefore feeds Calibration rather than
 * the Gap, exactly as spec §9 defines it.
 */
export function recordHunch(db: Db, input: RecordHunchInput): { ok: true; calibration: number | null } {
  const repo = db
    .prepare('SELECT id FROM repos WHERE ? = root OR ? LIKE root || \'/%\' ORDER BY length(root) DESC LIMIT 1')
    .get(input.repoRoot, input.repoRoot) as { id: string } | undefined;
  if (!repo) throw new Error('repo not registered');

  const key = `concept:${slugify(input.topic) || 'untitled'}`;
  let nodeId = (db.prepare("SELECT id FROM nodes WHERE repo_id = ? AND kind = 'concept' AND key = ?").get(repo.id, key) as { id: string } | undefined)?.id;
  const now = nowIso();
  if (!nodeId) {
    nodeId = ulid();
    db.prepare(
      `INSERT INTO nodes (id, repo_id, kind, key, label, state, alive, in_zone, critical, state_changed_at, created_at)
       VALUES (?, ?, 'concept', ?, ?, 'unknown', 1, 0, 0, ?, ?)`,
    ).run(nodeId, repo.id, key, input.topic.slice(0, 80), now, now);
    db.prepare("INSERT INTO node_states (id, node_id, from_state, to_state, cause, rep_id, at) VALUES (?, ?, NULL, 'unknown', 'ingest', NULL, ?)")
      .run(ulid(), nodeId, now);
  }

  // close the in-flight marker, if any
  const open = db
    .prepare(
      `SELECT r.id FROM reps r JOIN nodes n ON n.id = r.node_id
       WHERE n.repo_id = ? AND r.type = 'hunch' AND r.answered_at IS NULL
       ORDER BY r.asked_at DESC LIMIT 1`,
    )
    .get(repo.id) as { id: string } | undefined;

  const repId = open?.id ?? ulid();
  if (!open) {
    db.prepare("INSERT INTO reps (id, node_id, type, prompt_json, asked_at) VALUES (?, ?, 'hunch', '{}', ?)")
      .run(repId, nodeId, now);
  }
  db.prepare(
    `UPDATE reps SET node_id = ?, answer_text = ?, verdict = ?, gap_text = ?, answered_at = ?, revealed_at = ? WHERE id = ?`,
  ).run(nodeId, input.prediction, input.matched ? 'pass' : 'fail', input.note ?? null, now, now, repId);

  return { ok: true, calibration: calibration(db, repo.id) };
}

/** Share of predictions that matched the answer's shape (spec §9). */
export function calibration(db: Db, repoId: string, days = 90): number | null {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n, SUM(CASE WHEN r.verdict = 'pass' THEN 1 ELSE 0 END) AS hits
       FROM reps r JOIN nodes n ON n.id = r.node_id
       WHERE n.repo_id = ? AND r.type = 'hunch' AND r.answered_at IS NOT NULL
         AND r.answered_at > datetime('now', ?)`,
    )
    .get(repoId, `-${days} days`) as { n: number; hits: number | null };
  if (!row.n) return null;
  return (100 * (row.hits ?? 0)) / row.n;
}
