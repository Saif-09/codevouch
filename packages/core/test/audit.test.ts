import { describe, it, expect } from 'vitest';
import { tempDb, seedRepo } from './helpers.js';
import { buildAudit } from '../src/audit.js';
import { ulid, nowIso } from '../src/util.js';

function seedDep(db: any, repo: string, label: string, impact: any, sites = 1) {
  const id = ulid();
  db.prepare(
    `INSERT INTO nodes (id, repo_id, kind, key, label, state, alive, in_zone, critical, state_changed_at, created_at)
     VALUES (?, ?, 'dependency', ?, ?, 'unknown', 1, 1, 0, ?, ?)`,
  ).run(id, repo, `npm:${label}`, label, nowIso(), nowIso());
  for (let i = 0; i < sites; i++) {
    db.prepare('INSERT INTO call_sites (node_id, path, line, snippet) VALUES (?, ?, ?, ?)')
      .run(id, `src/${label}${i}.ts`, i + 1, 'import x');
  }
  db.prepare('INSERT INTO dossiers (id, node_id, body_json, impact_json, fetched_at) VALUES (?, ?, NULL, ?, ?)')
    .run(ulid(), id, JSON.stringify(impact), nowIso());
  return id;
}

const yearsAgo = (n: number) => new Date(Date.now() - n * 365.25 * 86_400_000).toISOString();

describe('vouch audit', () => {
  const repoRef = { id: 'REPO1', root: '/tmp/x', name: 'demo' };

  it('sorts vulnerable packages worst-first using the database severity, never a computed one', () => {
    const db = tempDb();
    const repo = seedRepo(db);
    seedDep(db, repo, 'mild', { name: 'mild', version: '1.0.0', advisories: [{ id: 'A', summary: 's', severity: 'LOW' }] });
    seedDep(db, repo, 'severe', { name: 'severe', version: '1.0.0', advisories: [{ id: 'B', summary: 's', severity: 'CRITICAL' }] });
    seedDep(db, repo, 'mid', { name: 'mid', version: '1.0.0', advisories: [{ id: 'C', summary: 's', severity: 'MODERATE' }] });
    seedDep(db, repo, 'clean', { name: 'clean', version: '1.0.0', advisories: [] });

    const r = buildAudit(db, repoRef as any);
    expect(r.vulnerable.map((f) => f.name)).toEqual(['severe', 'mid', 'mild']);
    expect(r.worstSeverity).toBe('CRITICAL');
    expect(r.scanned).toBe(4);
  });

  it('reports null worstSeverity when nothing is vulnerable, rather than a reassuring zero', () => {
    const db = tempDb();
    const repo = seedRepo(db);
    seedDep(db, repo, 'clean', { name: 'clean', version: '1.0.0', advisories: [] });
    expect(buildAudit(db, repoRef as any).worstSeverity).toBeNull();
  });

  it('separates deprecated, stale and unused, and excludes config-only packages from stale', () => {
    const db = tempDb();
    const repo = seedRepo(db);
    seedDep(db, repo, 'gone', { name: 'gone', version: '1.0.0', deprecated: true, advisories: [] });
    seedDep(db, repo, 'ancient', { name: 'ancient', version: '1.0.0', lastPublished: yearsAgo(5), advisories: [] });
    seedDep(db, repo, 'eslint-plugin-old', { name: 'eslint-plugin-old', version: '1.0.0', lastPublished: yearsAgo(6), advisories: [] }, 0);
    seedDep(db, repo, 'orphan', { name: 'orphan', version: '1.0.0', installSizeBytes: 5_000_000, advisories: [] }, 0);
    seedDep(db, repo, 'fresh', { name: 'fresh', version: '1.0.0', lastPublished: yearsAgo(0.2), advisories: [] });

    const r = buildAudit(db, repoRef as any);
    expect(r.deprecated.map((f) => f.name)).toEqual(['gone']);
    expect(r.stale.map((f) => f.name)).toEqual(['ancient']);   // the eslint plugin is config-only
    expect(r.unused.map((f) => f.name)).toEqual(['orphan']);   // eslint plugin excluded there too
    expect(r.unusedInstallBytes).toBe(5_000_000);
  });

  it('counts how many packages were checked at their installed version', () => {
    const db = tempDb();
    const repo = seedRepo(db);
    seedDep(db, repo, 'pinned', { name: 'pinned', version: '1.2.3', advisories: [] });
    seedDep(db, repo, 'unpinned', { name: 'unpinned', version: null, advisories: [] });
    const r = buildAudit(db, repoRef as any);
    expect(r.versionPinned).toBe(1);
    expect(r.scanned).toBe(2);
  });

  it('counts packages with no registry data as incomplete and says so', () => {
    const db = tempDb();
    const repo = seedRepo(db);
    seedDep(db, repo, 'known', { name: 'known', version: '1.0.0', advisories: [] });
    const id = ulid();
    db.prepare(
      `INSERT INTO nodes (id, repo_id, kind, key, label, state, alive, in_zone, critical, state_changed_at, created_at)
       VALUES (?, ?, 'dependency', 'npm:mystery', 'mystery', 'unknown', 1, 1, 0, ?, ?)`,
    ).run(id, repo, nowIso(), nowIso());
    const r = buildAudit(db, repoRef as any);
    expect(r.incomplete).toBe(1);
    expect(r.notes.join(' ')).toMatch(/no data from the registries/);
  });

  it('ranks the heaviest packages by install size', () => {
    const db = tempDb();
    const repo = seedRepo(db);
    seedDep(db, repo, 'big', { name: 'big', version: '1.0.0', installSizeBytes: 90_000_000, advisories: [] });
    seedDep(db, repo, 'small', { name: 'small', version: '1.0.0', installSizeBytes: 1_000, advisories: [] });
    const r = buildAudit(db, repoRef as any);
    expect(r.heaviest[0].name).toBe('big');
    expect(r.totalInstallBytes).toBe(90_001_000);
  });
});
