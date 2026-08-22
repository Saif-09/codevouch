import { parse as parseYaml } from 'yaml';
import { parse as parseToml } from 'smol-toml';

/**
 * Spec §5.3. Direct dependencies come from the manifest (package.json,
 * pyproject.toml, requirements.txt); lockfiles supply resolved versions.
 * New direct dependencies become nodes immediately, with no model call.
 */

export interface DirectDep {
  ecosystem: 'npm' | 'pypi';
  name: string;
  version: string | null; // resolved when a lockfile provides it
  dev: boolean;
}

export const MANIFEST_FILES = [
  'package.json',
  'pyproject.toml',
  'requirements.txt',
] as const;

export const LOCK_FILES = [
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'uv.lock',
] as const;

export function isDependencyFile(path: string): boolean {
  const base = path.split('/').pop() ?? path;
  return (
    (MANIFEST_FILES as readonly string[]).includes(base) ||
    (LOCK_FILES as readonly string[]).includes(base)
  );
}

/** files: relative path → content at a given rev. Missing files are absent keys. */
export function parseDirectDeps(files: Map<string, string>): DirectDep[] {
  const out: DirectDep[] = [];
  const seen = new Set<string>();
  const push = (d: DirectDep) => {
    const k = `${d.ecosystem}:${d.name}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(d);
    }
  };

  for (const [path, content] of files) {
    const base = path.split('/').pop() ?? path;
    try {
      if (base === 'package.json') {
        const pkg = JSON.parse(content);
        const versions = npmResolvedVersions(files, path);
        for (const [name] of Object.entries(pkg.dependencies ?? {})) {
          push({ ecosystem: 'npm', name, version: versions.get(name) ?? null, dev: false });
        }
        for (const [name] of Object.entries(pkg.devDependencies ?? {})) {
          push({ ecosystem: 'npm', name, version: versions.get(name) ?? null, dev: true });
        }
      } else if (base === 'requirements.txt') {
        for (const raw of content.split('\n')) {
          const line = raw.trim();
          if (!line || line.startsWith('#') || line.startsWith('-')) continue;
          const m = line.match(/^([A-Za-z0-9._-]+)\s*(?:==\s*([^\s;#]+))?/);
          if (m) push({ ecosystem: 'pypi', name: normPy(m[1]), version: m[2] ?? null, dev: false });
        }
      } else if (base === 'pyproject.toml') {
        const doc: any = parseToml(content);
        const deps: string[] = doc?.project?.dependencies ?? [];
        const uv = uvResolvedVersions(files, path);
        for (const spec of deps) {
          const m = String(spec).match(/^([A-Za-z0-9._-]+)/);
          if (m) {
            const name = normPy(m[1]);
            push({ ecosystem: 'pypi', name, version: uv.get(name) ?? null, dev: false });
          }
        }
      }
    } catch {
      // A malformed manifest never blocks ingest; it just yields nothing.
    }
  }
  return out;
}

function normPy(name: string): string {
  return name.toLowerCase().replace(/[._]/g, '-');
}

function siblings(files: Map<string, string>, manifestPath: string, base: string): string | undefined {
  const dir = manifestPath.includes('/') ? manifestPath.slice(0, manifestPath.lastIndexOf('/') + 1) : '';
  return files.get(dir + base);
}

/** Resolved versions for direct npm deps from whichever lockfile sits beside the manifest. */
function npmResolvedVersions(files: Map<string, string>, manifestPath: string): Map<string, string> {
  const out = new Map<string, string>();

  const pnpm = siblings(files, manifestPath, 'pnpm-lock.yaml');
  if (pnpm) {
    try {
      const doc: any = parseYaml(pnpm);
      const importer = doc?.importers?.['.'] ?? doc; // v9 importers, or old flat layout
      for (const section of ['dependencies', 'devDependencies']) {
        for (const [name, entry] of Object.entries<any>(importer?.[section] ?? {})) {
          const v = typeof entry === 'string' ? entry : entry?.version;
          if (typeof v === 'string') out.set(name, v.split('(')[0]);
        }
      }
    } catch { /* version enrichment only */ }
  }

  const npmLock = siblings(files, manifestPath, 'package-lock.json');
  if (npmLock) {
    try {
      const doc = JSON.parse(npmLock);
      for (const [p, entry] of Object.entries<any>(doc.packages ?? {})) {
        const m = p.match(/^node_modules\/((?:@[^/]+\/)?[^/]+)$/);
        if (m && entry?.version && !out.has(m[1])) out.set(m[1], entry.version);
      }
    } catch { /* version enrichment only */ }
  }

  const yarn = siblings(files, manifestPath, 'yarn.lock');
  if (yarn) {
    try {
      // classic yarn.lock: `name@range:` block with `  version "x"`. Good enough
      // for version enrichment; directness always comes from package.json.
      const re = /^"?((?:@[^/\s"]+\/)?[^@/\s"]+)@[^\n]*:\n(?:[ \t].*\n)*?[ \t]+version[ \t]+"([^"]+)"/gm;
      let m: RegExpExecArray | null;
      while ((m = re.exec(yarn))) if (!out.has(m[1])) out.set(m[1], m[2]);
    } catch { /* version enrichment only */ }
  }

  return out;
}

function uvResolvedVersions(files: Map<string, string>, manifestPath: string): Map<string, string> {
  const out = new Map<string, string>();
  const uv = siblings(files, manifestPath, 'uv.lock');
  if (!uv) return out;
  try {
    const doc: any = parseToml(uv);
    for (const pkg of doc?.package ?? []) {
      if (pkg?.name && pkg?.version) out.set(normPy(String(pkg.name)), String(pkg.version));
    }
  } catch { /* version enrichment only */ }
  return out;
}

/** Deps present after but not before: the Dossier trigger. */
export function newDirectDeps(before: DirectDep[], after: DirectDep[]): DirectDep[] {
  const had = new Set(before.map((d) => `${d.ecosystem}:${d.name}`));
  return after.filter((d) => !had.has(`${d.ecosystem}:${d.name}`));
}
