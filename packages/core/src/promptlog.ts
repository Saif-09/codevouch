import type { Db } from './db.js';
import { scrubText } from './redact.js';
import { ulid, nowIso } from './util.js';

/**
 * A record of the prompts you actually typed, so `vouch prompts` can tell you
 * how to type better ones.
 *
 * Captured live from the documented `UserPromptSubmit` hook payload. Vouch
 * never reads the transcript file: its format is explicitly internal and
 * changes between versions (hard rule 7), and a feature built on it would
 * break silently.
 *
 * Prompts are redacted with the same scrubber used before any model call, so
 * a key pasted into a prompt is never written to disk.
 */

const MAX_PROMPT_CHARS = 8_000;

export function recordPrompt(
  db: Db,
  claudeSession: string,
  cwd: string,
  text: string,
): void {
  if (!text.trim()) return;

  const repo = db
    .prepare("SELECT id FROM repos WHERE ? = root OR ? LIKE root || '/%' ORDER BY length(root) DESC LIMIT 1")
    .get(cwd, cwd) as { id: string } | undefined;

  const { text: safe } = scrubText(text);
  const next = (db
    .prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM prompts WHERE claude_session = ?')
    .get(claudeSession) as { n: number }).n;

  db.prepare(
    'INSERT OR IGNORE INTO prompts (id, repo_id, claude_session, seq, text, chars, at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(ulid(), repo?.id ?? null, claudeSession, next, safe.slice(0, MAX_PROMPT_CHARS), text.length, nowIso());
}

export interface SessionSummary {
  claudeSession: string;
  prompts: number;
  chars: number;
  startedAt: string;
  endedAt: string;
  repo: string | null;
}

export function recentSessions(db: Db, limit = 10): SessionSummary[] {
  return db
    .prepare(
      `SELECT p.claude_session AS claudeSession, COUNT(*) AS prompts, SUM(p.chars) AS chars,
              MIN(p.at) AS startedAt, MAX(p.at) AS endedAt, r.name AS repo
       FROM prompts p LEFT JOIN repos r ON r.id = p.repo_id
       GROUP BY p.claude_session
       ORDER BY MAX(p.at) DESC, MAX(p.rowid) DESC LIMIT ?`,
    )
    .all(limit) as SessionSummary[];
}

export interface StoredPrompt { seq: number; text: string; chars: number; at: string }

export function sessionPrompts(db: Db, claudeSession: string): StoredPrompt[] {
  return db
    .prepare('SELECT seq, text, chars, at FROM prompts WHERE claude_session = ? ORDER BY seq')
    .all(claudeSession) as StoredPrompt[];
}

export function latestSession(db: Db, repoRoot?: string): string | null {
  if (repoRoot) {
    const row = db
      .prepare(
        `SELECT p.claude_session AS s FROM prompts p JOIN repos r ON r.id = p.repo_id
         WHERE ? = r.root OR ? LIKE r.root || '/%'
         ORDER BY p.at DESC, p.rowid DESC LIMIT 1`,
      )
      .get(repoRoot, repoRoot) as { s: string } | undefined;
    if (row) return row.s;
  }
  const any = db.prepare('SELECT claude_session AS s FROM prompts ORDER BY at DESC, rowid DESC LIMIT 1').get() as
    | { s: string }
    | undefined;
  return any?.s ?? null;
}
