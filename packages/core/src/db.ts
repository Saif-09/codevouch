import Database from 'better-sqlite3';
import type { Database as Db } from 'better-sqlite3';

export type { Db };

// Spec §3, with three documented additions the spec requires functionally:
//   nodes.content_hash  — §3.1 says renames match "by symbol first and content hash second"
//   nodes.zone_id       — §9 reports the Gap PER ZONE, so each node caches its matched zone
//   extraction_calls    — §6 requires a local cost meter that `vouch status` prints
const SCHEMA = `
CREATE TABLE IF NOT EXISTS repos (
  id TEXT PRIMARY KEY,
  root TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sharp_zones (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repos(id),
  kind TEXT NOT NULL CHECK (kind IN ('path','topic','dependency_class')),
  pattern TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  stance TEXT NOT NULL CHECK (stance IN ('keep_sharp','outsourced')),
  critical INTEGER NOT NULL DEFAULT 0,
  decay_days INTEGER NOT NULL DEFAULT 90,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repos(id),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  head_before TEXT NOT NULL,
  head_after TEXT,
  last_activity TEXT NOT NULL,
  ai_authored INTEGER NOT NULL DEFAULT 0,
  digest_shown_at TEXT
);

CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repos(id),
  kind TEXT NOT NULL CHECK (kind IN ('concept','artifact','dependency','decision')),
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('unknown','explained','predicted','defended','decayed')),
  alive INTEGER NOT NULL DEFAULT 1,
  in_zone INTEGER NOT NULL DEFAULT 0,
  critical INTEGER NOT NULL DEFAULT 0,
  zone_id TEXT REFERENCES sharp_zones(id),
  content_hash TEXT,
  first_seen_session TEXT REFERENCES sessions(id),
  state_changed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (repo_id, kind, key)
);

CREATE TABLE IF NOT EXISTS edges (
  from_node TEXT NOT NULL REFERENCES nodes(id),
  to_node   TEXT NOT NULL REFERENCES nodes(id),
  rel TEXT NOT NULL CHECK (rel IN ('uses','introduced_by','replaces','depends_on','about')),
  PRIMARY KEY (from_node, to_node, rel)
);

CREATE TABLE IF NOT EXISTS reps (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES nodes(id),
  type TEXT NOT NULL CHECK (type IN ('dossier','defend','hunch','card')),
  confidence_before INTEGER CHECK (confidence_before BETWEEN 1 AND 7),
  prompt_json TEXT NOT NULL,
  answer_text TEXT,
  verdict TEXT CHECK (verdict IN ('pass','partial','fail','ungraded')),
  gap_text TEXT,
  confidence_after INTEGER CHECK (confidence_after BETWEEN 1 AND 7),
  asked_at TEXT NOT NULL,
  answered_at TEXT,
  revealed_at TEXT
);

CREATE TABLE IF NOT EXISTS node_states (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES nodes(id),
  from_state TEXT,
  to_state TEXT NOT NULL,
  cause TEXT NOT NULL CHECK (cause IN ('ingest','rep_pass','rep_fail','decay','manual')),
  rep_id TEXT REFERENCES reps(id),
  at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS briefs (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES nodes(id),
  session_id TEXT NOT NULL REFERENCES sessions(id),
  body_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dossiers (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL UNIQUE REFERENCES nodes(id),
  body_json TEXT,
  impact_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS call_sites (
  node_id TEXT NOT NULL REFERENCES nodes(id),
  path TEXT NOT NULL,
  line INTEGER NOT NULL,
  snippet TEXT NOT NULL,
  PRIMARY KEY (node_id, path, line)
);

CREATE TABLE IF NOT EXISTS extraction_calls (
  id TEXT PRIMARY KEY,
  task TEXT NOT NULL,
  ok INTEGER NOT NULL,
  cost_usd REAL,
  at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nodes_repo ON nodes(repo_id, alive, in_zone);
CREATE INDEX IF NOT EXISTS idx_states_node ON node_states(node_id, at);
CREATE INDEX IF NOT EXISTS idx_reps_node ON reps(node_id, asked_at);
`;

/**
 * Additive column migrations. `CREATE TABLE IF NOT EXISTS` never alters an
 * existing table, so every column added after a release must be declared
 * here too, or existing installs break on the first query that names it.
 * Additive only: no drops, no renames, no data loss.
 */
const MIGRATIONS: { table: string; column: string; ddl: string }[] = [
  { table: 'sharp_zones', column: 'decay_days', ddl: 'ALTER TABLE sharp_zones ADD COLUMN decay_days INTEGER NOT NULL DEFAULT 90' },
  { table: 'nodes', column: 'zone_id', ddl: 'ALTER TABLE nodes ADD COLUMN zone_id TEXT REFERENCES sharp_zones(id)' },
  { table: 'nodes', column: 'content_hash', ddl: 'ALTER TABLE nodes ADD COLUMN content_hash TEXT' },
  { table: 'sessions', column: 'last_activity', ddl: "ALTER TABLE sessions ADD COLUMN last_activity TEXT NOT NULL DEFAULT ''" },
];

function migrate(db: Db): void {
  for (const m of MIGRATIONS) {
    const cols = db.prepare(`PRAGMA table_info(${m.table})`).all() as { name: string }[];
    if (cols.length === 0) continue; // table itself is new; SCHEMA already made it
    if (!cols.some((c) => c.name === m.column)) db.exec(m.ddl);
  }
}

export function openDb(path: string): Db {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}
