import { describe, it, expect } from 'vitest';
import { transition, applyEvent, type NodeState } from '../src/statemachine.js';
import { tempDb, seedRepo, seedNode } from './helpers.js';

describe('state machine (spec §4)', () => {
  it('covers every transition in the table', () => {
    expect(transition('unknown', { type: 'reveal' })).toEqual({ to: 'explained', cause: 'rep_pass' });
    expect(transition('explained', { type: 'hunch_correct' })).toEqual({ to: 'predicted', cause: 'rep_pass' });
    for (const from of ['explained', 'predicted', 'decayed'] as NodeState[]) {
      expect(transition(from, { type: 'verdict', verdict: 'pass' })?.to).toBe('defended');
    }
    expect(transition('defended', { type: 'verdict', verdict: 'fail' })?.to).toBe('explained');
    expect(transition('explained', { type: 'verdict', verdict: 'fail' })?.to).toBe('unknown');
    expect(transition('predicted', { type: 'verdict', verdict: 'fail' })?.to).toBe('unknown');
    expect(transition('defended', { type: 'decay' })?.to).toBe('decayed');
  });

  it('demotion is one step and never below unknown', () => {
    expect(transition('unknown', { type: 'verdict', verdict: 'fail' })).toBeNull();
    expect(transition('decayed', { type: 'verdict', verdict: 'fail' })).toBeNull();
    // defended + fail lands at explained, not unknown: one step
    expect(transition('defended', { type: 'verdict', verdict: 'fail' })?.to).toBe('explained');
  });

  it('partial and ungraded never move state', () => {
    for (const state of ['unknown', 'explained', 'predicted', 'defended', 'decayed'] as NodeState[]) {
      expect(transition(state, { type: 'verdict', verdict: 'partial' })).toBeNull();
      expect(transition(state, { type: 'verdict', verdict: 'ungraded' })).toBeNull();
    }
  });

  it('only defended decays', () => {
    for (const state of ['unknown', 'explained', 'predicted', 'decayed'] as NodeState[]) {
      expect(transition(state, { type: 'decay' })).toBeNull();
    }
  });

  it('decay only touches alive, in-zone nodes', () => {
    const db = tempDb();
    const repo = seedRepo(db);
    const dead = seedNode(db, repo, { state: 'defended', alive: 0 });
    const outZone = seedNode(db, repo, { state: 'defended', in_zone: 0 });
    const live = seedNode(db, repo, { state: 'defended' });
    expect(applyEvent(db, dead, { type: 'decay' })).toBeNull();
    expect(applyEvent(db, outZone, { type: 'decay' })).toBeNull();
    expect(applyEvent(db, live, { type: 'decay' })).toBe('decayed');
  });

  it('every transition writes an append-only node_states row', () => {
    const db = tempDb();
    const repo = seedRepo(db);
    const n = seedNode(db, repo, { state: 'unknown' });
    applyEvent(db, n, { type: 'reveal' });
    applyEvent(db, n, { type: 'verdict', verdict: 'pass' });
    applyEvent(db, n, { type: 'verdict', verdict: 'fail' });
    const rows = db.prepare('SELECT from_state, to_state, cause FROM node_states WHERE node_id = ? ORDER BY rowid').all(n) as any[];
    expect(rows).toEqual([
      { from_state: 'unknown', to_state: 'explained', cause: 'rep_pass' },
      { from_state: 'explained', to_state: 'defended', cause: 'rep_pass' },
      { from_state: 'defended', to_state: 'explained', cause: 'rep_fail' },
    ]);
    // no-op events add no rows
    applyEvent(db, n, { type: 'verdict', verdict: 'partial' });
    expect((db.prepare('SELECT COUNT(*) AS c FROM node_states WHERE node_id = ?').get(n) as any).c).toBe(3);
  });
});
