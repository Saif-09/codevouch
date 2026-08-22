import { describe, it, expect } from 'vitest';
import { tempDb } from './helpers.js';
import { recordPrompt, sessionPrompts, recentSessions, latestSession } from '../src/promptlog.js';
import { estimateWaste } from '../src/promptreview.js';
import { nowIso } from '../src/util.js';

function seedRepoAt(db: any, root: string, name = 'r') {
  db.prepare('INSERT INTO repos (id, root, name, created_at) VALUES (?, ?, ?, ?)')
    .run(`R${name}`, root, name, nowIso());
  return `R${name}`;
}

describe('prompt capture', () => {
  it('records prompts in order and attaches them to the repo the cwd is inside', () => {
    const db = tempDb();
    seedRepoAt(db, '/tmp/proj');
    recordPrompt(db, 'sess1', '/tmp/proj/src/deep', 'add a wishlist feature');
    recordPrompt(db, 'sess1', '/tmp/proj', 'no, localStorage not the server');
    const rows = sessionPrompts(db, 'sess1');
    expect(rows.map((r) => r.seq)).toEqual([1, 2]);
    expect(rows[0].text).toBe('add a wishlist feature');
    expect((db.prepare('SELECT repo_id FROM prompts WHERE seq = 1').get() as any).repo_id).toBe('Rr');
  });

  it('redacts secrets before they are ever written to disk', () => {
    const db = tempDb();
    seedRepoAt(db, '/tmp/proj');
    recordPrompt(db, 's', '/tmp/proj', 'deploy with STRIPE_KEY=sk-live_abcdefghijklmnopqrstuvwx and fix the bug');
    const stored = sessionPrompts(db, 's')[0].text;
    expect(stored).not.toContain('sk-live_abcdefghij');
    expect(stored).toContain('[REDACTED:');
    expect(stored).toContain('fix the bug');
  });

  it('ignores empty prompts and records outside a known repo without crashing', () => {
    const db = tempDb();
    recordPrompt(db, 's', '/somewhere/else', '   ');
    recordPrompt(db, 's', '/somewhere/else', 'a real prompt with no repo');
    const rows = sessionPrompts(db, 's');
    expect(rows).toHaveLength(1);
    expect((db.prepare('SELECT repo_id FROM prompts').get() as any).repo_id).toBeNull();
  });

  it('finds the most recent session for a repo, and lists sessions', () => {
    const db = tempDb();
    seedRepoAt(db, '/tmp/a', 'a');
    recordPrompt(db, 'old', '/tmp/a', 'first');
    recordPrompt(db, 'new', '/tmp/a', 'second');
    expect(latestSession(db, '/tmp/a')).toBe('new');
    const sessions = recentSessions(db);
    expect(sessions.map((s) => s.claudeSession)).toContain('new');
    expect(sessions.find((s) => s.claudeSession === 'new')!.prompts).toBe(1);
  });
});

describe('token waste estimate', () => {
  const p = (seq: number, chars: number) => ({ seq, chars, text: 'x'.repeat(chars), at: nowIso() });

  it('charges an avoidable prompt the whole conversation up to that point, not just its own length', () => {
    // each turn re-sends everything before it, so a late correction costs far
    // more than an early one of the same length
    const prompts = [p(1, 400), p(2, 400), p(3, 400)];
    const early = estimateWaste(prompts, new Set([1]));
    const late = estimateWaste(prompts, new Set([3]));
    expect(late.wasted).toBeGreaterThan(early.wasted * 5);
  });

  it('reports zero waste when nothing was avoidable', () => {
    const r = estimateWaste([p(1, 100), p(2, 100)], new Set());
    expect(r.wasted).toBe(0);
    expect(r.percent).toBe(0);
  });

  it('never reports more than 100 percent wasted', () => {
    const prompts = [p(1, 100), p(2, 100), p(3, 100)];
    const r = estimateWaste(prompts, new Set([1, 2, 3]));
    expect(r.percent).toBeCloseTo(100, 5);
  });

  it('handles an empty session without dividing by zero', () => {
    expect(estimateWaste([], new Set())).toEqual({ wasted: 0, total: 0, percent: 0 });
  });
});
