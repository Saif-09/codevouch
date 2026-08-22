import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openDb, type Db } from '../src/db.js';
import type { ExtractionBackend, ExtractionSpec, ExtractionResult } from '../src/extraction.js';

export function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vouch-home-'));
  process.env.VOUCH_HOME = dir;
  return dir;
}

export function tempDb(): Db {
  return openDb(join(mkdtempSync(join(tmpdir(), 'vouch-db-')), 'test.db'));
}

export function tempGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vouch-repo-'));
  const run = (...args: string[]) => execFileSync('git', args, { cwd: dir });
  run('init', '-q');
  run('config', 'user.email', 'test@example.com');
  run('config', 'user.name', 'Test');
  run('config', 'commit.gpgsign', 'false');
  return dir;
}

export function commit(dir: string, files: Record<string, string | null>, message = 'work'): string {
  for (const [rel, content] of Object.entries(files)) {
    const p = join(dir, rel);
    if (content === null) {
      execFileSync('git', ['rm', '-q', rel], { cwd: dir });
    } else {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content);
      execFileSync('git', ['add', rel], { cwd: dir });
    }
  }
  execFileSync('git', ['commit', '-q', '-m', message, '--allow-empty'], { cwd: dir });
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir }).toString().trim();
}

export function gitMove(dir: string, from: string, to: string, message = 'rename'): string {
  execFileSync('git', ['mv', from, to], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', message], { cwd: dir });
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir }).toString().trim();
}

export function seedSession(db: Db, repoId: string, id: string, before: string, after: string): string {
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO sessions (id, repo_id, started_at, ended_at, head_before, head_after, last_activity) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(id, repoId, now, now, before, after, now);
  return id;
}

/** Scripted backend: answers from a queue, or always fails. */
export class FakeBackend implements ExtractionBackend {
  public calls: ExtractionSpec[] = [];
  constructor(private responses: any[] = [], private alwaysFail = false) {}
  async run<T>(spec: ExtractionSpec): Promise<ExtractionResult<T>> {
    this.calls.push(spec);
    if (this.alwaysFail || this.responses.length === 0) {
      const { ExtractionError } = await import('../src/extraction.js');
      throw new ExtractionError('fake backend failure');
    }
    return { value: this.responses.shift() as T, costUsd: 0.01 };
  }
}

export function seedRepo(db: Db, root = '/tmp/x'): string {
  const id = 'REPO1';
  db.prepare('INSERT INTO repos (id, root, name, created_at) VALUES (?, ?, ?, ?)').run(id, root, 'x', new Date().toISOString());
  return id;
}

export function seedNode(
  db: Db,
  repoId: string,
  over: Partial<{ id: string; kind: string; key: string; label: string; state: string; alive: number; in_zone: number; critical: number }> = {},
): string {
  const id = over.id ?? `N${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO nodes (id, repo_id, kind, key, label, state, alive, in_zone, critical, state_changed_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, repoId,
    over.kind ?? 'dependency',
    over.key ?? `npm:pkg-${id}`,
    over.label ?? `pkg-${id}`,
    over.state ?? 'unknown',
    over.alive ?? 1,
    over.in_zone ?? 1,
    over.critical ?? 0,
    now, now,
  );
  return id;
}
