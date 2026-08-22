import { safeFetch, osvBatchPost } from './egress.js';
import { lookupService, type ServiceImpact } from '@vouch/services';
import { mapLimit } from './util.js';

/**
 * Spec §8. All keyless. Rate limits are undocumented, so concurrency is
 * capped at 4 and results are cached by the caller for 7 days.
 * npm dist.unpackedSize is INSTALL size and is labelled as such; bundle
 * size is a Wave 2 field with no keyless source.
 */

export interface ImpactData {
  ecosystem: string;
  name: string;
  version: string | null;
  installSizeBytes: number | null;   // npm only, labelled install size
  weeklyDownloads: number | null;    // npm only
  lastPublished: string | null;
  license: string | null;
  transitiveCount: number | null;
  dependentCount: number | null;
  scorecardScore: number | null;
  advisories: string[];              // OSV ids
  deprecated: boolean;
  service: ServiceImpact | null;     // curated table, spec §8
  errors: string[];                  // feeds that failed; shown honestly, never hidden
}

const DEPS_DEV = 'https://api.deps.dev/v3alpha';

async function json(url: string): Promise<any> {
  const res = await safeFetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

function depsDevSystem(eco: string): string {
  return eco === 'npm' ? 'npm' : 'pypi';
}

export async function fetchImpact(
  ecosystem: 'npm' | 'pypi',
  name: string,
  version: string | null,
): Promise<ImpactData> {
  const impact: ImpactData = {
    ecosystem, name, version,
    installSizeBytes: null, weeklyDownloads: null, lastPublished: null,
    license: null, transitiveCount: null, dependentCount: null,
    scorecardScore: null, advisories: [], deprecated: false,
    service: lookupService(name), errors: [],
  };
  const sys = depsDevSystem(ecosystem);
  const enc = encodeURIComponent(name);

  // Resolve a concrete version from deps.dev when the lockfile gave none.
  let v = version;
  const tasks: Array<() => Promise<void>> = [];

  try {
    const pkg = await json(`${DEPS_DEV}/systems/${sys}/packages/${enc}`);
    const versions: any[] = pkg?.versions ?? [];
    const latest = versions.filter((x) => x?.isDefault).at(0) ?? versions.at(-1);
    if (!v) v = latest?.versionKey?.version ?? null;
    impact.lastPublished = latest?.publishedAt ?? null;
  } catch (e: any) {
    impact.errors.push(`deps.dev package: ${e.message}`);
  }

  if (v) {
    const vEnc = encodeURIComponent(v);
    tasks.push(async () => {
      try {
        const ver = await json(`${DEPS_DEV}/systems/${sys}/packages/${enc}/versions/${vEnc}`);
        impact.license = (ver?.licenses ?? []).join(', ') || null;
        impact.deprecated = Boolean(ver?.isDeprecated);
      } catch (e: any) {
        impact.errors.push(`deps.dev version: ${e.message}`);
      }
    });
    tasks.push(async () => {
      try {
        const deps = await json(`${DEPS_DEV}/systems/${sys}/packages/${enc}/versions/${vEnc}:dependencies`);
        const nodes: any[] = deps?.nodes ?? [];
        impact.transitiveCount = Math.max(0, nodes.length - 1);
      } catch (e: any) {
        impact.errors.push(`deps.dev dependencies: ${e.message}`);
      }
    });
    tasks.push(async () => {
      try {
        const dep = await json(`${DEPS_DEV}/systems/${sys}/packages/${enc}/versions/${vEnc}:dependents`);
        impact.dependentCount = dep?.dependentCount ?? null;
      } catch (e: any) {
        impact.errors.push(`deps.dev dependents: ${e.message}`);
      }
    });
    tasks.push(async () => {
      try {
        const res = await osvBatchPost('/v1/querybatch', {
          queries: [{ package: { name, ecosystem: ecosystem === 'npm' ? 'npm' : 'PyPI' }, version: v }],
        });
        impact.advisories = (res?.results?.[0]?.vulns ?? []).map((x: any) => x.id);
      } catch (e: any) {
        impact.errors.push(`osv: ${e.message}`);
      }
    });
  }

  if (ecosystem === 'npm') {
    if (v) {
      const vv = v;
      tasks.push(async () => {
        try {
          const doc = await json(`https://registry.npmjs.org/${enc}/${encodeURIComponent(vv)}`);
          impact.installSizeBytes = doc?.dist?.unpackedSize ?? null;
          impact.license = impact.license ?? doc?.license ?? null;
        } catch (e: any) {
          impact.errors.push(`npm version doc: ${e.message}`);
        }
      });
    }
    tasks.push(async () => {
      try {
        const dl = await json(`https://api.npmjs.org/downloads/point/last-week/${enc}`);
        impact.weeklyDownloads = dl?.downloads ?? null;
      } catch (e: any) {
        impact.errors.push(`npm downloads: ${e.message}`);
      }
    });
  }

  await mapLimit(tasks, 4, (t) => t());
  impact.version = v;
  return impact;
}
