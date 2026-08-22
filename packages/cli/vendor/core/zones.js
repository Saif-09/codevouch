import { globMatch } from './glob.js';
import { lookupService } from '../services/index.js';
import { ulid, nowIso } from './util.js';
export function loadZones(db, repoId) {
    return db
        .prepare('SELECT id, kind, pattern, name, stance, critical FROM sharp_zones WHERE repo_id = ? ORDER BY created_at')
        .all(repoId);
}
/**
 * First matching zone wins; silence means out of scope (Wave 1 spec §1).
 * 'path' zones are user-authored globs; 'topic' zones are the rule-derived
 * regexes proposed at init.
 */
export function matchPathZone(zones, path) {
    for (const z of zones) {
        if (z.kind === 'path' && globMatch(z.pattern, path))
            return z;
        if (z.kind === 'topic') {
            try {
                if (new RegExp(z.pattern, 'i').test(path))
                    return z;
            }
            catch { /* a bad user edit never crashes matching */ }
        }
    }
    return null;
}
// Token-boundary matching: 'auth' as a segment, never inside a word like
// "class-variance-authority" (a real false positive caught on the shoppin run).
const CRITICAL_DEP = /(^|[-_@/])o?auth(?=[-_/.]|$)|jsonwebtoken|passport|(^|[-_@/])jose(?=[-_/.]|$)|bcrypt|argon2|(^|[-_@/])stripe(?=[-_/.]|$)|razorpay|braintree|paypal|(^|[-_@/])crypto(?=[-_/.]|$)|secret|keytar|clerk/i;
export function dependencyClass(name, dev) {
    const svc = lookupService(name);
    if (svc)
        return svc.category;
    if (CRITICAL_DEP.test(name))
        return 'auth';
    return dev ? 'dev' : 'runtime';
}
export function isCriticalDep(name) {
    const svc = lookupService(name);
    if (svc && (svc.category === 'auth' || svc.category === 'payments'))
        return true;
    return CRITICAL_DEP.test(name);
}
export function matchDepZone(zones, name, dev) {
    const cls = dependencyClass(name, dev);
    for (const z of zones) {
        if (z.kind === 'dependency_class' && (z.pattern === cls || (z.pattern === 'runtime' && cls !== 'dev'))) {
            return z;
        }
    }
    return null;
}
export function addZone(db, repoId, z) {
    const id = ulid();
    db.prepare(`INSERT INTO sharp_zones (id, repo_id, kind, pattern, name, stance, critical, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, repoId, z.kind, z.pattern, z.name, z.stance, z.critical, nowIso());
    return id;
}
// Order matters: earlier rules claim files first.
const RULES = [
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
export function proposeZones(files) {
    const buckets = new Map();
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
    const out = [];
    for (const { rule, files: matched } of buckets.values()) {
        if (matched.length === 0)
            continue;
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
