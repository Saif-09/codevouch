const MIN_CLUSTER = 2; // a single changed symbol is not a feature
function dirOf(key) {
    const path = key.split('#')[0];
    const i = path.lastIndexOf('/');
    return i === -1 ? '(root)' : path.slice(0, i);
}
export function clusterSession(db, repoId, sessionId) {
    const rows = db
        .prepare(`SELECT id, key, in_zone, critical FROM nodes
       WHERE repo_id = ? AND kind = 'artifact' AND alive = 1 AND first_seen_session = ?`)
        .all(repoId, sessionId);
    const byDir = new Map();
    for (const r of rows) {
        const d = dirOf(r.key);
        const arr = byDir.get(d) ?? [];
        arr.push(r);
        byDir.set(d, arr);
    }
    const clusters = [];
    for (const [dir, members] of byDir) {
        if (members.length < MIN_CLUSTER)
            continue;
        if (!members.some((m) => m.in_zone === 1))
            continue; // zones gate everything
        clusters.push({
            slug: dir.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'root',
            dir,
            nodeIds: members.map((m) => m.id),
            paths: [...new Set(members.map((m) => m.key.split('#')[0]))],
            inZone: members.some((m) => m.in_zone === 1),
            critical: members.some((m) => m.critical === 1),
        });
    }
    return clusters;
}
