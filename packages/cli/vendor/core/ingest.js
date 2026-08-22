import { ulid, nowIso, sha256 } from './util.js';
import { headSha, parentOf, changedFiles, fileAt, aiAuthored, listFiles, } from './gitrepo.js';
import { parseDirectDeps, newDirectDeps, isDependencyFile, MANIFEST_FILES, LOCK_FILES } from './lockfiles.js';
import { exportedSymbols, isSourceFile } from './symbols.js';
import { findCallSites } from './callsites.js';
import { loadZones, matchPathZone, matchDepZone, isCriticalDep } from './zones.js';
import { appendFileSync } from 'node:fs';
import { logPath } from './home.js';
const IDLE_MINUTES = 90;
function log(msg) {
    try {
        appendFileSync(logPath(), `${nowIso()} ${msg}\n`);
    }
    catch { /* logging never breaks ingest */ }
}
export function getRepo(db, root) {
    return db.prepare('SELECT id, root, name FROM repos WHERE root = ?').get(root) ?? null;
}
export function upsertRepo(db, root, name) {
    const existing = getRepo(db, root);
    if (existing)
        return existing;
    const id = ulid();
    db.prepare('INSERT INTO repos (id, root, name, created_at) VALUES (?, ?, ?, ?)').run(id, root, name, nowIso());
    return { id, root, name };
}
function openSession(db, repoId) {
    return db
        .prepare('SELECT id, head_before, head_after, last_activity FROM sessions WHERE repo_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1')
        .get(repoId) ?? null;
}
function startSession(db, repoId, headBefore) {
    const id = ulid();
    const now = nowIso();
    db.prepare('INSERT INTO sessions (id, repo_id, started_at, head_before, last_activity) VALUES (?, ?, ?, ?, ?)').run(id, repoId, now, headBefore, now);
    return { id, head_before: headBefore, head_after: null, last_activity: now };
}
/**
 * Session boundaries, spec §5.1. `tick` fires from the post-commit hook:
 * it extends the open session, or lazily closes an idle one (using the head
 * recorded at its last activity, not the current one) and opens the next.
 */
export async function tick(db, repo) {
    const head = await headSha(repo.root);
    const open = openSession(db, repo.id);
    const now = Date.now();
    if (open) {
        const idleMs = now - Date.parse(open.last_activity);
        if (idleMs < IDLE_MINUTES * 60_000) {
            db.prepare('UPDATE sessions SET head_after = ?, last_activity = ? WHERE id = ?').run(head, nowIso(), open.id);
            return { closed: null };
        }
        const closedId = await closeSession(db, repo, open);
        const before = open.head_after ?? open.head_before;
        const next = startSession(db, repo.id, before);
        db.prepare('UPDATE sessions SET head_after = ?, last_activity = ? WHERE id = ?').run(head, nowIso(), next.id);
        return { closed: closedId };
    }
    const parent = (await parentOf(repo.root, head)) ?? head;
    const s = startSession(db, repo.id, parent);
    db.prepare('UPDATE sessions SET head_after = ?, last_activity = ? WHERE id = ?').run(head, nowIso(), s.id);
    return { closed: null };
}
export async function explicitStart(db, repo) {
    const open = openSession(db, repo.id);
    if (open)
        await closeSession(db, repo, open);
    const head = await headSha(repo.root);
    return startSession(db, repo.id, head).id;
}
export async function explicitEnd(db, repo) {
    const open = openSession(db, repo.id);
    if (!open)
        return null;
    const head = await headSha(repo.root);
    db.prepare('UPDATE sessions SET head_after = ? WHERE id = ?').run(head, open.id);
    open.head_after = head;
    return closeSession(db, repo, open);
}
/** Close = ingest. A session with no diff is discarded, not stored (spec §5.1). */
async function closeSession(db, repo, s) {
    const after = s.head_after ?? s.head_before;
    if (after === s.head_before) {
        db.prepare('DELETE FROM sessions WHERE id = ?').run(s.id);
        return null;
    }
    db.prepare('UPDATE sessions SET ended_at = ? WHERE id = ?').run(nowIso(), s.id);
    try {
        await ingestSession(db, repo, s.id, s.head_before, after);
    }
    catch (e) {
        log(`ingest failed for session ${s.id}: ${e.message}`);
    }
    return s.id;
}
export async function ingestSession(db, repo, sessionId, before, after) {
    const zones = loadZones(db, repo.id);
    const changed = await changedFiles(repo.root, before, after);
    const ai = await aiAuthored(repo.root, before, after);
    db.prepare('UPDATE sessions SET ai_authored = ? WHERE id = ?').run(ai ? 1 : 0, sessionId);
    const result = { newDependencyNodes: [], artifactNodes: [] };
    // --- dependencies: manifest + lockfile deltas (spec §5.3) ---
    const depFiles = changed.filter((c) => isDependencyFile(c.path));
    if (depFiles.length > 0) {
        const wanted = [...MANIFEST_FILES, ...LOCK_FILES];
        const collect = async (rev) => {
            const map = new Map();
            for (const c of depFiles) {
                const dir = c.path.includes('/') ? c.path.slice(0, c.path.lastIndexOf('/') + 1) : '';
                for (const base of wanted) {
                    const p = dir + base;
                    if (!map.has(p)) {
                        const content = await fileAt(repo.root, rev, p);
                        if (content !== null)
                            map.set(p, content);
                    }
                }
            }
            return map;
        };
        const beforeDeps = parseDirectDeps(await collect(before));
        const afterDeps = parseDirectDeps(await collect(after));
        const fresh = newDirectDeps(beforeDeps, afterDeps);
        const allFiles = await listFiles(repo.root);
        for (const dep of fresh) {
            const id = upsertDependencyNode(db, repo, sessionId, zones, dep);
            if (id) {
                result.newDependencyNodes.push(id);
                const sites = findCallSites(repo.root, allFiles, dep.ecosystem, dep.name);
                const ins = db.prepare('INSERT OR IGNORE INTO call_sites (node_id, path, line, snippet) VALUES (?, ?, ?, ?)');
                for (const site of sites)
                    ins.run(id, site.path, site.line, site.snippet);
            }
        }
    }
    // --- artifacts: exported symbols of changed in-zone source files (spec §5.3, §3.1) ---
    for (const c of changed) {
        if (!isSourceFile(c.path))
            continue;
        if (c.status === 'R' && c.oldPath) {
            await rekeyRenamedFile(db, repo, c.oldPath, c.path, after);
        }
        if (c.status === 'D') {
            retireFileArtifacts(db, repo.id, c.path);
            continue;
        }
        const zone = matchPathZone(zones, c.path);
        if (!zone || zone.stance !== 'keep_sharp')
            continue; // silence means out of scope
        const content = await fileAt(repo.root, after, c.path);
        if (content === null)
            continue;
        const symbols = exportedSymbols(c.path, content);
        const liveKeys = new Set();
        for (const sym of symbols) {
            const key = `${c.path}#${sym.name}`;
            liveKeys.add(key);
            const nodeId = upsertArtifactNode(db, repo, sessionId, key, sym.name, sym.hash, zone);
            result.artifactNodes.push(nodeId);
        }
        // symbols that vanished from this file are retired
        const rows = db
            .prepare("SELECT id, key FROM nodes WHERE repo_id = ? AND kind = 'artifact' AND alive = 1 AND key LIKE ?")
            .all(repo.id, `${c.path}#%`);
        for (const row of rows) {
            if (!liveKeys.has(row.key))
                db.prepare('UPDATE nodes SET alive = 0 WHERE id = ?').run(row.id);
        }
    }
    return result;
}
function upsertDependencyNode(db, repo, sessionId, zones, dep) {
    const key = `${dep.ecosystem}:${dep.name}`;
    const existing = db
        .prepare("SELECT id FROM nodes WHERE repo_id = ? AND kind = 'dependency' AND key = ?")
        .get(repo.id, key);
    if (existing) {
        db.prepare('UPDATE nodes SET alive = 1 WHERE id = ?').run(existing.id);
        return null; // re-added, not new: no fresh dossier
    }
    const zone = matchDepZone(zones, dep.name, dep.dev);
    const inZone = zone?.stance === 'keep_sharp' ? 1 : 0;
    const critical = isCriticalDep(dep.name) ? 1 : 0;
    const id = ulid();
    const now = nowIso();
    db.prepare(`INSERT INTO nodes (id, repo_id, kind, key, label, state, alive, in_zone, critical, zone_id, first_seen_session, state_changed_at, created_at)
     VALUES (?, ?, 'dependency', ?, ?, 'unknown', 1, ?, ?, ?, ?, ?, ?)`).run(id, repo.id, key, dep.name, inZone, critical, zone?.id ?? null, sessionId, now, now);
    db.prepare(`INSERT INTO node_states (id, node_id, from_state, to_state, cause, rep_id, at)
     VALUES (?, ?, NULL, 'unknown', 'ingest', NULL, ?)`).run(ulid(), id, now);
    return id;
}
function upsertArtifactNode(db, repo, sessionId, key, label, hash, zone) {
    const existing = db
        .prepare("SELECT id FROM nodes WHERE repo_id = ? AND kind = 'artifact' AND key = ?")
        .get(repo.id, key);
    if (existing) {
        db.prepare('UPDATE nodes SET alive = 1, content_hash = ? WHERE id = ?').run(hash, existing.id);
        return existing.id;
    }
    const id = ulid();
    const now = nowIso();
    db.prepare(`INSERT INTO nodes (id, repo_id, kind, key, label, state, alive, in_zone, critical, zone_id, content_hash, first_seen_session, state_changed_at, created_at)
     VALUES (?, ?, 'artifact', ?, ?, 'unknown', 1, 1, ?, ?, ?, ?, ?, ?)`).run(id, repo.id, key, label, zone.critical, zone.id, hash, sessionId, now, now);
    db.prepare(`INSERT INTO node_states (id, node_id, from_state, to_state, cause, rep_id, at)
     VALUES (?, ?, NULL, 'unknown', 'ingest', NULL, ?)`).run(ulid(), id, now);
    return id;
}
/**
 * Spec §3.1: on rename, match by symbol first and content hash second, then
 * rewrite the key and log it. Unmatched renames retire the old node and let
 * the normal upsert create a fresh one — never silently merge.
 */
async function rekeyRenamedFile(db, repo, oldPath, newPath, afterRev) {
    const content = await fileAt(repo.root, afterRev, newPath);
    const newSymbols = content ? exportedSymbols(newPath, content) : [];
    const byName = new Map(newSymbols.map((s) => [s.name, s]));
    const byHash = new Map(newSymbols.map((s) => [s.hash, s]));
    const rows = db
        .prepare("SELECT id, key, label, content_hash FROM nodes WHERE repo_id = ? AND kind = 'artifact' AND alive = 1 AND key LIKE ?")
        .all(repo.id, `${oldPath}#%`);
    for (const row of rows) {
        const match = byName.get(row.label) ?? (row.content_hash ? byHash.get(row.content_hash) : undefined);
        if (match) {
            const newKey = `${newPath}#${match.name}`;
            db.prepare('UPDATE nodes SET key = ?, label = ?, content_hash = ? WHERE id = ?').run(newKey, match.name, match.hash, row.id);
            log(`rekey ${row.key} -> ${newKey}`);
        }
        else {
            db.prepare('UPDATE nodes SET alive = 0 WHERE id = ?').run(row.id);
            log(`retire ${row.key} (rename to ${newPath} had no symbol or hash match)`);
        }
    }
}
function retireFileArtifacts(db, repoId, path) {
    db.prepare("UPDATE nodes SET alive = 0 WHERE repo_id = ? AND kind = 'artifact' AND key LIKE ?").run(repoId, `${path}#%`);
}
function sessionHash(root, s) {
    return sha256(`${root}:${s}`).slice(0, 12);
}
export { sessionHash };
