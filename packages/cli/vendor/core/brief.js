import { ExtractionError } from './extraction.js';
import { BRIEF_SCHEMA, BRIEF_SYSTEM } from './prompts.js';
import { redactFiles } from './redact.js';
import { fileAt } from './gitrepo.js';
import { clusterSession } from './features.js';
import { ulid, nowIso, sha256, slugify } from './util.js';
const MAX_DIFF_CHARS = 24_000;
const MAX_CLUSTERS_PER_SESSION = 3;
/**
 * Builds the diff context for a cluster, redacted (spec §11) before it can
 * reach any backend. Returns null when redaction left nothing usable.
 */
async function clusterDiff(repo, cluster, before, after) {
    const files = [];
    for (const path of cluster.paths.slice(0, 12)) {
        const content = await fileAt(repo.root, after, path);
        if (content !== null)
            files.push({ path, content });
    }
    const { kept } = redactFiles(repo.root, files);
    if (kept.length === 0)
        return null;
    let out = '';
    for (const f of kept) {
        const chunk = `--- ${f.path}\n${f.content}\n`;
        if (out.length + chunk.length > MAX_DIFF_CHARS)
            break;
        out += chunk;
    }
    return out.trim() || null;
}
/**
 * Phase 1. Runs at session close for every in-zone cluster: creates the
 * `decision` node and its WITHHELD brief. Degrades: extraction failure
 * leaves the node with no brief, retried on a later pass, never blocking.
 */
export async function generateBriefs(db, repo, backend, sessionId) {
    const session = db
        .prepare('SELECT head_before, head_after FROM sessions WHERE id = ?')
        .get(sessionId);
    if (!session?.head_after)
        return { created: 0, failed: 0 };
    // Cap clusters per session. A first ingest can group hundreds of files into
    // dozens of directories, and one extraction call each would turn `vouch
    // init` into a surprise bill. Biggest and most critical clusters first.
    const clusters = clusterSession(db, repo.id, sessionId)
        .sort((a, b) => Number(b.critical) - Number(a.critical) || b.nodeIds.length - a.nodeIds.length)
        .slice(0, MAX_CLUSTERS_PER_SESSION);
    let created = 0;
    let failed = 0;
    for (const cluster of clusters) {
        const key = `decision:${sha256(sessionId).slice(0, 12)}:${cluster.slug}`;
        const exists = db
            .prepare("SELECT id FROM nodes WHERE repo_id = ? AND kind = 'decision' AND key = ?")
            .get(repo.id, key);
        if (exists)
            continue;
        const diff = await clusterDiff(repo, cluster, session.head_before, session.head_after);
        if (!diff)
            continue;
        let body;
        try {
            const { value } = await backend.run({
                task: 'brief',
                system: BRIEF_SYSTEM,
                input: `${diff}\n\nWrite the build brief for this change now. Respond only through the structured output.`,
                schema: BRIEF_SCHEMA,
            });
            body = value;
        }
        catch (e) {
            if (!(e instanceof ExtractionError))
                throw e;
            failed++;
            continue;
        }
        const zoneId = db
            .prepare('SELECT zone_id FROM nodes WHERE id = ?')
            .get(cluster.nodeIds[0]);
        const id = ulid();
        const now = nowIso();
        db.prepare(`INSERT INTO nodes (id, repo_id, kind, key, label, state, alive, in_zone, critical, zone_id, first_seen_session, state_changed_at, created_at)
       VALUES (?, ?, 'decision', ?, ?, 'unknown', 1, ?, ?, ?, ?, ?, ?)`).run(id, repo.id, key, body.name, cluster.inZone ? 1 : 0, cluster.critical ? 1 : 0, zoneId?.zone_id ?? null, sessionId, now, now);
        db.prepare("INSERT INTO node_states (id, node_id, from_state, to_state, cause, rep_id, at) VALUES (?, ?, NULL, 'unknown', 'ingest', NULL, ?)").run(ulid(), id, now);
        db.prepare('INSERT INTO briefs (id, node_id, session_id, body_json, created_at) VALUES (?, ?, ?, ?, ?)')
            .run(ulid(), id, sessionId, JSON.stringify(body), now);
        // the artifacts this decision is about
        const edge = db.prepare("INSERT OR IGNORE INTO edges (from_node, to_node, rel) VALUES (?, ?, 'about')");
        for (const artifactId of cluster.nodeIds)
            edge.run(id, artifactId);
        // concepts named by the brief become nodes, linked to the decision
        for (const label of body.concepts.slice(0, 8)) {
            const ckey = `concept:${slugify(label)}`;
            if (!ckey.replace('concept:', ''))
                continue;
            let cid = db.prepare("SELECT id FROM nodes WHERE repo_id = ? AND kind = 'concept' AND key = ?").get(repo.id, ckey)?.id;
            if (!cid) {
                cid = ulid();
                db.prepare(`INSERT INTO nodes (id, repo_id, kind, key, label, state, alive, in_zone, critical, zone_id, first_seen_session, state_changed_at, created_at)
           VALUES (?, ?, 'concept', ?, ?, 'unknown', 1, ?, 0, ?, ?, ?, ?)`).run(cid, repo.id, ckey, label, cluster.inZone ? 1 : 0, zoneId?.zone_id ?? null, sessionId, now, now);
                db.prepare("INSERT INTO node_states (id, node_id, from_state, to_state, cause, rep_id, at) VALUES (?, ?, NULL, 'unknown', 'ingest', NULL, ?)").run(ulid(), cid, now);
            }
            db.prepare("INSERT OR IGNORE INTO edges (from_node, to_node, rel) VALUES (?, ?, 'about')").run(id, cid);
        }
        created++;
    }
    return { created, failed };
}
