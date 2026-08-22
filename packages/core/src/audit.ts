import type { Db } from './db.js';
import type { ImpactData, Advisory } from './feeds.js';
import { fetchImpact } from './feeds.js';
import { isConfigOnly } from './unused.js';
import { parseDirectDeps, MANIFEST_FILES, LOCK_FILES } from './lockfiles.js';
import { fileAt, headSha, listFiles } from './gitrepo.js';
import { readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { mapLimit, nowIso, ulid } from './util.js';
import type { Repo } from './ingest.js';

/**
 * `vouch audit`: everything Vouch already knows about your dependencies,
 * in one place.
 *
 * The data was already being fetched for Dossiers and then shown one package
 * at a time, buried behind a rep. Advisories, deprecation flags, release
 * dates and licences were being stored and never surfaced. This reads the
 * same keyless feeds for EVERY direct dependency, so the whole report costs
 * nothing and needs no AI.
 *
 * Honesty rules, because a security-flavoured report is easy to overstate:
 *  - severity is quoted from the advisory database, never computed here
 *  - "no release in N years" is a fact; "abandoned" would be a judgement, and
 *    plenty of good packages are simply finished
 *  - unused means "nothing imports it", which is a question, not a verdict
 */

const STALE_YEARS = 2;
const REFRESH_DAYS = 7;

export interface AuditFinding {
  name: string;
  installSizeBytes: number | null;
  advisories: Advisory[];
  deprecated: boolean;
  lastPublished: string | null;
  yearsSincePublish: number | null;
  license: string | null;
  transitiveCount: number | null;
  unused: boolean;
  configOnly: boolean;
}

export interface AuditReport {
  repo: string;
  scanned: number;
  vulnerable: AuditFinding[];
  deprecated: AuditFinding[];
  stale: AuditFinding[];
  unused: AuditFinding[];
  heaviest: AuditFinding[];
  /** How many packages were checked at the version actually installed. */
  versionPinned: number;
  totalInstallBytes: number;
  unusedInstallBytes: number;
  worstSeverity: Advisory['severity'] | null;
  incomplete: number;
  notes: string[];
}

const RANK: Record<Advisory['severity'], number> = {
  CRITICAL: 4, HIGH: 3, MODERATE: 2, LOW: 1, UNKNOWN: 0,
};

/**
 * Impact for EVERY direct dependency, in or out of zone. No extraction call,
 * so this stays free. Cached for a week like the Dossier feeds.
 */
export async function refreshAllImpact(
  db: Db,
  repo: Repo,
  onProgress?: (done: number, total: number) => void,
): Promise<{ fetched: number; cached: number; failed: number }> {
  const deps = db
    .prepare("SELECT id, key, label FROM nodes WHERE repo_id = ? AND kind = 'dependency' AND alive = 1 ORDER BY label")
    .all(repo.id) as { id: string; key: string; label: string }[];

  /**
   * The version actually installed, from the lockfile.
   *
   * Checking advisories against the LATEST published version would be worse
   * than not checking at all: a project pinned to a vulnerable release would
   * be reported clean, because the maintainer has since fixed it upstream.
   * A security report has to ask about the code you are running.
   */
  const installed = await resolveInstalledVersions(repo);

  let fetched = 0;
  let cached = 0;
  let failed = 0;
  let done = 0;

  await mapLimit(deps, 4, async (dep) => {
    const existing = db
      .prepare('SELECT id, impact_json, fetched_at FROM dossiers WHERE node_id = ?')
      .get(dep.id) as { id: string; impact_json: string; fetched_at: string } | undefined;

    const fresh =
      existing &&
      Date.now() - Date.parse(existing.fetched_at) < REFRESH_DAYS * 86_400_000 &&
      existing.impact_json &&
      existing.impact_json !== '{}';

    if (fresh) {
      cached++;
    } else {
      const [ecosystem, name] = dep.key.split(/:(.+)/) as ['npm' | 'pypi', string];
      try {
        const impact = await fetchImpact(ecosystem, name, installed.get(dep.key) ?? null);
        if (existing) {
          db.prepare('UPDATE dossiers SET impact_json = ?, fetched_at = ? WHERE id = ?')
            .run(JSON.stringify(impact), nowIso(), existing.id);
        } else {
          db.prepare('INSERT INTO dossiers (id, node_id, body_json, impact_json, fetched_at) VALUES (?, ?, NULL, ?, ?)')
            .run(ulid(), dep.id, JSON.stringify(impact), nowIso());
        }
        fetched++;
      } catch {
        failed++;
      }
    }
    done++;
    onProgress?.(done, deps.length);
  });

  return { fetched, cached, failed };
}

export function buildAudit(db: Db, repo: Repo): AuditReport {
  const rows = db
    .prepare(
      `SELECT n.label, d.impact_json,
              (SELECT COUNT(*) FROM call_sites c WHERE c.node_id = n.id) AS sites
       FROM nodes n
       LEFT JOIN dossiers d ON d.node_id = n.id
       WHERE n.repo_id = ? AND n.kind = 'dependency' AND n.alive = 1
       ORDER BY n.label`,
    )
    .all(repo.id) as { label: string; impact_json: string | null; sites: number }[];

  const findings: AuditFinding[] = [];
  let incomplete = 0;
  let versionPinned = 0;

  for (const r of rows) {
    let impact: Partial<ImpactData> = {};
    if (r.impact_json) {
      try {
        impact = JSON.parse(r.impact_json);
      } catch { /* treated as incomplete below */ }
    }
    if (!impact.name) incomplete++;
    if (impact.version) versionPinned++;

    const last = impact.lastPublished ? Date.parse(impact.lastPublished) : NaN;
    findings.push({
      name: r.label,
      installSizeBytes: impact.installSizeBytes ?? null,
      advisories: (impact.advisories ?? []) as Advisory[],
      deprecated: Boolean(impact.deprecated),
      lastPublished: impact.lastPublished ?? null,
      yearsSincePublish: Number.isNaN(last) ? null : (Date.now() - last) / (365.25 * 86_400_000),
      license: impact.license ?? null,
      transitiveCount: impact.transitiveCount ?? null,
      unused: r.sites === 0 && !isConfigOnly(r.label),
      configOnly: isConfigOnly(r.label),
    });
  }

  const vulnerable = findings
    .filter((f) => f.advisories.length > 0)
    .sort((a, b) => worst(b.advisories) - worst(a.advisories));
  const unused = findings.filter((f) => f.unused);

  const notes: string[] = [];
  if (incomplete > 0) {
    notes.push(`${incomplete} package${incomplete === 1 ? '' : 's'} had no data from the registries and are not represented below.`);
  }

  const allSeverities = vulnerable.flatMap((f) => f.advisories);
  return {
    repo: repo.name,
    scanned: findings.length,
    vulnerable,
    deprecated: findings.filter((f) => f.deprecated),
    stale: findings
      .filter((f) => (f.yearsSincePublish ?? 0) >= STALE_YEARS && !f.configOnly)
      .sort((a, b) => (b.yearsSincePublish ?? 0) - (a.yearsSincePublish ?? 0)),
    unused,
    heaviest: [...findings]
      .filter((f) => f.installSizeBytes)
      .sort((a, b) => (b.installSizeBytes ?? 0) - (a.installSizeBytes ?? 0))
      .slice(0, 5),
    totalInstallBytes: findings.reduce((a, f) => a + (f.installSizeBytes ?? 0), 0),
    unusedInstallBytes: unused.reduce((a, f) => a + (f.installSizeBytes ?? 0), 0),
    worstSeverity: allSeverities.length
      ? allSeverities.reduce((w, a) => (RANK[a.severity] > RANK[w] ? a.severity : w), 'UNKNOWN' as Advisory['severity'])
      : null,
    incomplete,
    versionPinned,
    notes,
  };
}

function worst(list: Advisory[]): number {
  return list.reduce((m, a) => Math.max(m, RANK[a.severity] ?? 0), 0);
}

/** Resolved versions for every direct dependency, keyed as `<ecosystem>:<name>`. */
async function resolveInstalledVersions(repo: Repo): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const wanted = new Set<string>([...MANIFEST_FILES, ...LOCK_FILES]);
    const files = new Map<string, string>();
    for (const rel of await listFiles(repo.root)) {
      if (!wanted.has(basename(rel)) || rel.includes('node_modules/')) continue;
      try {
        files.set(rel, readFileSync(join(repo.root, rel), 'utf8'));
      } catch { /* unreadable manifest contributes nothing */ }
    }
    for (const dep of parseDirectDeps(files)) {
      if (dep.version) out.set(`${dep.ecosystem}:${dep.name}`, dep.version);
    }
  } catch { /* fall back to latest, which the report labels */ }
  return out;
}
