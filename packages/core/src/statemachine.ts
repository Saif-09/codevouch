import type { Db } from './db.js';
import { ulid, nowIso } from './util.js';

export type NodeState = 'unknown' | 'explained' | 'predicted' | 'defended' | 'decayed';
export type Verdict = 'pass' | 'partial' | 'fail' | 'ungraded';

export type StateEvent =
  | { type: 'reveal' }          // brief or dossier revealed after an attempt
  | { type: 'hunch_correct' }
  | { type: 'verdict'; verdict: Verdict }
  | { type: 'decay' };

export type Cause = 'ingest' | 'rep_pass' | 'rep_fail' | 'decay' | 'manual';

/**
 * The transition table from spec §4, pure. Returns null when nothing changes.
 * Constraints encoded here and asserted by tests:
 *  - demotion is one step at a time and never below `unknown`
 *  - only `defended` decays
 *  - `partial` and `ungraded` never move state
 */
export function transition(
  state: NodeState,
  event: StateEvent,
): { to: NodeState; cause: Cause } | null {
  switch (event.type) {
    case 'reveal':
      return state === 'unknown' ? { to: 'explained', cause: 'rep_pass' } : null;
    case 'hunch_correct':
      return state === 'explained' ? { to: 'predicted', cause: 'rep_pass' } : null;
    case 'decay':
      return state === 'defended' ? { to: 'decayed', cause: 'decay' } : null;
    case 'verdict':
      switch (event.verdict) {
        case 'pass':
          if (state === 'explained' || state === 'predicted' || state === 'decayed') {
            return { to: 'defended', cause: 'rep_pass' };
          }
          return null;
        case 'fail':
          if (state === 'defended') return { to: 'explained', cause: 'rep_fail' };
          if (state === 'explained' || state === 'predicted') {
            return { to: 'unknown', cause: 'rep_fail' };
          }
          return null; // unknown and decayed have nowhere lower to go
        case 'partial':
        case 'ungraded':
          return null;
      }
  }
}

/** Applies an event to a stored node, writing the append-only audit row. */
export function applyEvent(
  db: Db,
  nodeId: string,
  event: StateEvent,
  repId?: string,
): NodeState | null {
  const row = db
    .prepare('SELECT state, alive, in_zone FROM nodes WHERE id = ?')
    .get(nodeId) as { state: NodeState; alive: number; in_zone: number } | undefined;
  if (!row) throw new Error(`no such node: ${nodeId}`);

  // Decay only ever touches live, in-zone nodes (spec §4).
  if (event.type === 'decay' && (row.alive !== 1 || row.in_zone !== 1)) return null;

  const result = transition(row.state, event);
  if (!result) return null;

  const at = nowIso();
  db.prepare('UPDATE nodes SET state = ?, state_changed_at = ? WHERE id = ?').run(
    result.to, at, nodeId,
  );
  db.prepare(
    `INSERT INTO node_states (id, node_id, from_state, to_state, cause, rep_id, at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(ulid(), nodeId, row.state, result.to, result.cause, repId ?? null, at);
  return result.to;
}

/** Manual verdict override by the user; always audited as cause 'manual'. */
export function manualSetState(db: Db, nodeId: string, to: NodeState): void {
  const row = db.prepare('SELECT state FROM nodes WHERE id = ?').get(nodeId) as
    | { state: NodeState }
    | undefined;
  if (!row) throw new Error(`no such node: ${nodeId}`);
  if (row.state === to) return;
  const at = nowIso();
  db.prepare('UPDATE nodes SET state = ?, state_changed_at = ? WHERE id = ?').run(to, at, nodeId);
  db.prepare(
    `INSERT INTO node_states (id, node_id, from_state, to_state, cause, rep_id, at)
     VALUES (?, ?, ?, ?, 'manual', NULL, ?)`,
  ).run(ulid(), nodeId, row.state, to, at);
}
