import { safeFetch, osvBatchPost } from './egress.js';
import { lookupService } from '../services/index.js';
import { mapLimit } from './util.js';
const DEPS_DEV = 'https://api.deps.dev/v3alpha';
async function json(url) {
    const res = await safeFetch(url);
    if (!res.ok)
        throw new Error(`${res.status} ${url}`);
    return res.json();
}
function depsDevSystem(eco) {
    return eco === 'npm' ? 'npm' : 'pypi';
}
export async function fetchImpact(ecosystem, name, version) {
    const impact = {
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
    const tasks = [];
    try {
        const pkg = await json(`${DEPS_DEV}/systems/${sys}/packages/${enc}`);
        const versions = pkg?.versions ?? [];
        const latest = versions.filter((x) => x?.isDefault).at(0) ?? versions.at(-1);
        if (!v)
            v = latest?.versionKey?.version ?? null;
        impact.lastPublished = latest?.publishedAt ?? null;
    }
    catch (e) {
        impact.errors.push(`deps.dev package: ${e.message}`);
    }
    if (v) {
        const vEnc = encodeURIComponent(v);
        tasks.push(async () => {
            try {
                const ver = await json(`${DEPS_DEV}/systems/${sys}/packages/${enc}/versions/${vEnc}`);
                impact.license = (ver?.licenses ?? []).join(', ') || null;
                impact.deprecated = Boolean(ver?.isDeprecated);
            }
            catch (e) {
                impact.errors.push(`deps.dev version: ${e.message}`);
            }
        });
        tasks.push(async () => {
            try {
                const deps = await json(`${DEPS_DEV}/systems/${sys}/packages/${enc}/versions/${vEnc}:dependencies`);
                const nodes = deps?.nodes ?? [];
                impact.transitiveCount = Math.max(0, nodes.length - 1);
            }
            catch (e) {
                impact.errors.push(`deps.dev dependencies: ${e.message}`);
            }
        });
        tasks.push(async () => {
            try {
                const dep = await json(`${DEPS_DEV}/systems/${sys}/packages/${enc}/versions/${vEnc}:dependents`);
                impact.dependentCount = dep?.dependentCount ?? null;
            }
            catch (e) {
                impact.errors.push(`deps.dev dependents: ${e.message}`);
            }
        });
        tasks.push(async () => {
            try {
                const res = await osvBatchPost('/v1/querybatch', {
                    queries: [{ package: { name, ecosystem: ecosystem === 'npm' ? 'npm' : 'PyPI' }, version: v }],
                });
                impact.advisories = (res?.results?.[0]?.vulns ?? []).map((x) => x.id);
            }
            catch (e) {
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
                }
                catch (e) {
                    impact.errors.push(`npm version doc: ${e.message}`);
                }
            });
        }
        tasks.push(async () => {
            try {
                const dl = await json(`https://api.npmjs.org/downloads/point/last-week/${enc}`);
                impact.weeklyDownloads = dl?.downloads ?? null;
            }
            catch (e) {
                impact.errors.push(`npm downloads: ${e.message}`);
            }
        });
    }
    await mapLimit(tasks, 4, (t) => t());
    impact.version = v;
    return impact;
}
