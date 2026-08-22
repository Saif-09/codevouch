import { globMatch } from './glob.js';
import { lookupService } from '@vouch/services';
import type { Db } from './db.js';
import { ulid, nowIso } from './util.js';

export interface Zone {
  id: string;
  kind: 'path' | 'topic' | 'dependency_class';
  pattern: string;
  name: string;
  stance: 'keep_sharp' | 'outsourced';
  critical: number;
}

export function loadZones(db: Db, repoId: string): Zone[] {
  return db
    .prepare('SELECT id, kind, pattern, name, stance, critical FROM sharp_zones WHERE repo_id = ? ORDER BY created_at')
    .all(repoId) as Zone[];
}

/**
 * First matching zone wins; silence means out of scope (Wave 1 spec §1).
 * 'path' zones are user-authored globs; 'topic' zones are the rule-derived
 * regexes proposed at init.
 */
export function matchPathZone(zones: Zone[], path: string): Zone | null {
  for (const z of zones) {
    if (z.kind === 'path' && globMatch(z.pattern, path)) return z;
    if (z.kind === 'topic') {
      try {
        if (new RegExp(z.pattern, 'i').test(path)) return z;
      } catch { /* a bad user edit never crashes matching */ }
    }
  }
  return null;
}

// Token-boundary matching: 'auth' as a segment, never inside a word like
// "class-variance-authority" (a real false positive found on a production repo).
const CRITICAL_DEP = /(^|[-_@/])o?auth(?=[-_/.]|$)|jsonwebtoken|passport|(^|[-_@/])jose(?=[-_/.]|$)|bcrypt|argon2|(^|[-_@/])stripe(?=[-_/.]|$)|razorpay|braintree|paypal|(^|[-_@/])crypto(?=[-_/.]|$)|secret|keytar|clerk/i;

export function dependencyClass(name: string, dev: boolean): string {
  const svc = lookupService(name);
  if (svc) return svc.category;
  if (CRITICAL_DEP.test(name)) return 'auth';
  return dev ? 'dev' : 'runtime';
}

export function isCriticalDep(name: string): boolean {
  const svc = lookupService(name);
  if (svc && (svc.category === 'auth' || svc.category === 'payments')) return true;
  return CRITICAL_DEP.test(name);
}

export function matchDepZone(zones: Zone[], name: string, dev: boolean): Zone | null {
  const cls = dependencyClass(name, dev);
  for (const z of zones) {
    if (z.kind === 'dependency_class' && (z.pattern === cls || (z.pattern === 'runtime' && cls !== 'dev'))) {
      return z;
    }
  }
  return null;
}

export function addZone(
  db: Db,
  repoId: string,
  z: Omit<Zone, 'id'>,
): string {
  const id = ulid();
  db.prepare(
    `INSERT INTO sharp_zones (id, repo_id, kind, pattern, name, stance, critical, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, repoId, z.kind, z.pattern, z.name, z.stance, z.critical, nowIso());
  return id;
}

// ---------- init-time zone proposal (Wave 1 spec §1) ----------

export interface ZoneCandidate {
  name: string;
  kind: 'path' | 'topic' | 'dependency_class';
  pattern: string;
  fileCount: number;
  example: string;
  defaultStance: 'keep_sharp' | 'outsourced';
  critical: boolean;
}

interface Rule {
  name: string;
  test: RegExp;
  defaultStance: 'keep_sharp' | 'outsourced';
  critical?: boolean;
}

// Order matters: earlier rules claim files first.
const RULES: Rule[] = [
  { name: 'auth and sessions', test: /(^|\/)(auth|login|session|middleware)[^/]*\/|auth\.[jt]sx?$|(^|\/)(auth|login|signin|signup)[^/]*\.[jt]sx?$/i, defaultStance: 'keep_sharp', critical: true },
  { name: 'payments and billing', test: /(stripe|billing|payment|checkout|razorpay)/i, defaultStance: 'keep_sharp', critical: true },
  { name: 'data model and migrations', test: /(^|\/)(db|database|drizzle|prisma|migrations|schema|models)\//i, defaultStance: 'keep_sharp' },
  { name: 'api and server routes', test: /(^|\/)(api|server|routes|controllers|handlers)\//i, defaultStance: 'keep_sharp' },
  { name: 'state management', test: /(^|\/)(store|stores|state|context|redux|zustand)\//i, defaultStance: 'keep_sharp' },
  { name: 'background jobs and queues', test: /(^|\/)(jobs|workers|queues|crons?)\//i, defaultStance: 'keep_sharp' },
  { name: 'tests', test: /(^|\/)(__tests__|tests?)\/|\.(test|spec)\.[jt]sx?$/i, defaultStance: 'outsourced' },
  { name: 'styling', test: /\.(css|scss|sass|less)$|(^|\/)(styles?|theme)\//i, defaultStance: 'outsourced' },
  { name: 'build and tooling config', test: /(^|\/)[^/]*\.config\.[a-z]+$|(^|\/)(tsconfig|eslint|prettier|vitest|jest)[^/]*$|(^|\/)\.github\//i, defaultStance: 'outsourced' },
  { name: 'generated and vendored', test: /(^|\/)(dist|build|out|\.next|generated|vendor|coverage)\//i, defaultStance: 'outsourced' },
  { name: 'infrastructure', test: /docker|terraform|vercel\.(json|ts)$|fly\.toml$|k8s|helm/i, defaultStance: 'outsourced' },
  { name: 'ui components', test: /(^|\/)(components|ui|views|screens|pages|app)\//i, defaultStance: 'keep_sharp' },
];

/** Candidates derived from what is actually in the repo, never a generic checklist. */
export function proposeZones(files: string[]): ZoneCandidate[] {
  const buckets = new Map<string, { rule: Rule; files: string[] }>();
  for (const f of files) {
    for (const rule of RULES) {
      if (rule.test.test(f)) {
        const b = buckets.get(rule.name) ?? { rule, files: [] };
        b.files.push(f);
        buckets.set(rule.name, b);
        break;
      }
    }
  }
  const out: ZoneCandidate[] = [];
  for (const { rule, files: matched } of buckets.values()) {
    if (matched.length === 0) continue;
    out.push({
      name: rule.name,
      kind: 'topic',
      pattern: rule.test.source,
      fileCount: matched.length,
      example: matched[0],
      defaultStance: rule.defaultStance,
      critical: rule.critical ?? false,
    });
  }
  return out.slice(0, 12);
}
