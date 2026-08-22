import type { Db } from './db.js';
import type { ImpactData } from './feeds.js';

/**
 * Unused dependency detection.
 *
 * This was not in the spec. It fell out of Dossiers being grounded in real
 * call sites: a package with zero call sites is a package nothing imports,
 * and the first real run against shoppin surfaced one. It is worth naming
 * explicitly rather than leaving implicit in a dossier's prose.
 *
 * The honesty rule for this feature: Vouch finds IMPORTS in TypeScript,
 * JavaScript and Python source. Plenty of legitimate packages are never
 * imported, so a finding here is a QUESTION, never an instruction to delete.
 * Anything matching a known config-only shape is reported separately and
 * never counted in the headline number.
 */

/** Packages that legitimately have no import site. Reported, never counted. */
const CONFIG_ONLY = [
  /^@types\//,
  /^eslint(-|$)/, /^@eslint\//, /eslint-plugin/, /eslint-config/,
  /^prettier(-|$)/, /^@prettier\//,
  /^postcss(-|$)/, /^autoprefixer$/, /^tailwindcss(-|$)/, /^@tailwindcss\//,
  /^typescript$/, /^ts-node$/, /^tsx$/, /^tsc-/,
  /^vite(-|$)/, /^@vitejs\//, /^webpack(-|$)/, /^rollup(-|$)/, /^esbuild$/, /^turbo$/,
  /^jest(-|$)/, /^@jest\//, /^vitest$/, /^@vitest\//, /^babel-/, /^@babel\//,
  /^husky$/, /^lint-staged$/, /^commitlint/, /^@commitlint\//,
  /^sharp$/, /^node-gyp/, /^patch-package$/, /^npm-run-all$/, /^rimraf$/, /^cross-env$/,
  /^@storybook\//, /^storybook$/, /^chromatic$/, /^@chromatic-com\//,
  /^pm2$/, /^nodemon$/, /^concurrently$/, /^dotenv-cli$/,
];

export function isConfigOnly(name: string): boolean {
  return CONFIG_ONLY.some((re) => re.test(name));
}

export interface UnusedFinding {
  nodeId: string;
  name: string;
  installSizeBytes: number | null;
  inZone: boolean;
  /** true when the package plausibly has no import site by design */
  configOnly: boolean;
  /** what the dossier concluded, when one exists */
  ifItVanished: string | null;
}

export interface UnusedReport {
  likelyUnused: UnusedFinding[];
  configOnly: UnusedFinding[];
  bytesLikelyUnused: number;
  scanned: number;
  caveat: string;
}

export const CAVEAT =
  'Vouch finds imports in TypeScript, JavaScript and Python source. Packages used only through config files, CLI scripts, bundler plugins or generated code have no import site and will appear here. Treat each one as a question to answer, not an instruction to delete.';

export function findUnused(db: Db, repoId: string): UnusedReport {
  const rows = db
    .prepare(
      `SELECT n.id, n.label, n.in_zone,
              (SELECT COUNT(*) FROM call_sites c WHERE c.node_id = n.id) AS sites,
              d.impact_json, d.body_json
       FROM nodes n
       LEFT JOIN dossiers d ON d.node_id = n.id
       WHERE n.repo_id = ? AND n.kind = 'dependency' AND n.alive = 1
       ORDER BY n.label`,
    )
    .all(repoId) as {
      id: string; label: string; in_zone: number; sites: number;
      impact_json: string | null; body_json: string | null;
    }[];

  const likelyUnused: UnusedFinding[] = [];
  const configOnly: UnusedFinding[] = [];

  for (const r of rows) {
    if (r.sites > 0) continue;
    let installSizeBytes: number | null = null;
    if (r.impact_json) {
      try {
        installSizeBytes = (JSON.parse(r.impact_json) as ImpactData).installSizeBytes ?? null;
      } catch { /* impact is optional */ }
    }
    let ifItVanished: string | null = null;
    if (r.body_json) {
      try {
        ifItVanished = JSON.parse(r.body_json).if_it_vanished ?? null;
      } catch { /* body is optional */ }
    }
    const finding: UnusedFinding = {
      nodeId: r.id,
      name: r.label,
      installSizeBytes,
      inZone: r.in_zone === 1,
      configOnly: isConfigOnly(r.label),
      ifItVanished,
    };
    (finding.configOnly ? configOnly : likelyUnused).push(finding);
  }

  return {
    likelyUnused,
    configOnly,
    bytesLikelyUnused: likelyUnused.reduce((a, f) => a + (f.installSizeBytes ?? 0), 0),
    scanned: rows.length,
    caveat: CAVEAT,
  };
}
