import { approachingDecay } from './decay.js';
import { ulid, nowIso } from './util.js';
/**
 * Spec §7.4. A card is the cheapest rep: confidence, one recognition item,
 * reveal. Failing one demotes per §4, which is what makes decay real rather
 * than cosmetic.
 *
 * Distractors cost NOTHING and are drawn from the user's own repository:
 *  - dependency cards use other dependencies' real "what it does here" lines
 *  - decision cards reuse the flow distractors already stored with the brief
 *  - concept cards ask which change used the technique, against other changes
 * That satisfies the spec's "plausible and drawn from the same repo" rule
 * without an extraction call, so re-testing forever stays free.
 *
 * A card needs at least two real distractors. When the repo cannot supply
 * them, there is no card. Vouch never invents an option.
 */
const MIN_DISTRACTORS = 2;
const MAX_OPTIONS = 4;
function shuffle(items, seed) {
    const out = [...items];
    let h = 0;
    for (let i = 0; i < seed.length; i++)
        h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    for (let i = out.length - 1; i > 0; i--) {
        h = (h * 1103515245 + 12345) >>> 0;
        const j = h % (i + 1);
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}
function trim(text, n = 150) {
    const clean = text.replace(/\s+/g, ' ').trim();
    return clean.length <= n ? clean : `${clean.slice(0, n - 1)}...`;
}
function buildForDependency(db, repoId, nodeId, label) {
    const own = db.prepare('SELECT body_json FROM dossiers WHERE node_id = ?').get(nodeId);
    if (!own?.body_json)
        return null;
    const correct = trim(JSON.parse(own.body_json).what_it_does_here);
    const others = db
        .prepare(`SELECT d.body_json FROM dossiers d
         JOIN nodes n ON n.id = d.node_id
         WHERE n.repo_id = ? AND n.id != ? AND d.body_json IS NOT NULL AND n.alive = 1`)
        .all(repoId, nodeId)
        .map((r) => trim(JSON.parse(r.body_json).what_it_does_here))
        .filter((t) => t && t !== correct);
    const distractors = [...new Set(others)].slice(0, MAX_OPTIONS - 1);
    if (distractors.length < MIN_DISTRACTORS)
        return null;
    return {
        question: `Which of these describes what ${label} does in this repository?`,
        correct,
        options: [correct, ...distractors],
    };
}
function buildForDecision(db, nodeId, label) {
    const row = db.prepare('SELECT body_json FROM briefs WHERE node_id = ?').get(nodeId);
    if (!row)
        return null;
    const body = JSON.parse(row.body_json);
    const distractors = body.flow_distractors.slice(0, MAX_OPTIONS - 1).map((d) => trim(d));
    if (distractors.length < MIN_DISTRACTORS)
        return null;
    return {
        question: `In "${label}", how does the data actually move?`,
        correct: trim(body.flow_correct),
        options: [trim(body.flow_correct), ...distractors],
    };
}
function buildForConcept(db, repoId, nodeId, label) {
    const owner = db
        .prepare(`SELECT d.label FROM edges e JOIN nodes d ON d.id = e.from_node
       WHERE e.to_node = ? AND e.rel = 'about' AND d.kind = 'decision' LIMIT 1`)
        .get(nodeId);
    if (!owner)
        return null;
    const others = db
        .prepare(`SELECT label FROM nodes
         WHERE repo_id = ? AND kind = 'decision' AND alive = 1 AND label != ?`)
        .all(repoId, owner.label).map((r) => r.label);
    const distractors = [...new Set(others)].slice(0, MAX_OPTIONS - 1);
    if (distractors.length < MIN_DISTRACTORS)
        return null;
    return {
        question: `Which change used "${label}"?`,
        correct: owner.label,
        options: [owner.label, ...distractors],
    };
}
/** Builds the card for a node, or null when the repo cannot supply distractors. */
export function buildCard(db, repoId, nodeId) {
    const node = db
        .prepare('SELECT id, kind, label, alive, in_zone FROM nodes WHERE id = ?')
        .get(nodeId);
    if (!node || node.alive !== 1 || node.in_zone !== 1)
        return null;
    const built = node.kind === 'dependency' ? buildForDependency(db, repoId, nodeId, node.label)
        : node.kind === 'decision' ? buildForDecision(db, nodeId, node.label)
            : node.kind === 'concept' ? buildForConcept(db, repoId, nodeId, node.label)
                : null;
    if (!built)
        return null;
    const open = db
        .prepare("SELECT id FROM reps WHERE node_id = ? AND type = 'card' AND answered_at IS NULL ORDER BY asked_at DESC LIMIT 1")
        .get(nodeId);
    const repId = open?.id ?? ulid();
    if (!open) {
        db.prepare("INSERT INTO reps (id, node_id, type, prompt_json, asked_at) VALUES (?, ?, 'card', ?, ?)").run(repId, nodeId, JSON.stringify({ question: built.question, correct: built.correct }), nowIso());
    }
    const stored = JSON.parse(db.prepare('SELECT prompt_json FROM reps WHERE id = ?').get(repId).prompt_json);
    return {
        repId,
        nodeId,
        type: 'card',
        kind: node.kind,
        label: node.label,
        question: stored.question,
        options: shuffle(built.options, repId),
    };
}
/**
 * The due queue: nodes approaching their decay window first, then nodes
 * carrying a recorded gap from an earlier rep (spec §7.4).
 */
export function dueCards(db, repoId, limit = 5) {
    const ids = [
        ...approachingDecay(db, repoId, limit * 3),
        ...db
            .prepare(`SELECT DISTINCT n.id FROM nodes n
           JOIN reps r ON r.node_id = n.id
           WHERE n.repo_id = ? AND n.alive = 1 AND n.in_zone = 1
             AND r.gap_text IS NOT NULL AND r.gap_text != ''
             AND n.state IN ('explained', 'predicted', 'decayed')
             AND NOT EXISTS (
               SELECT 1 FROM reps r2 WHERE r2.node_id = n.id
                 AND r2.revealed_at IS NOT NULL AND r2.revealed_at > datetime('now', '-1 day')
             )
           ORDER BY n.critical DESC, r.answered_at ASC
           LIMIT ?`)
            .all(repoId, limit * 3).map((r) => r.id),
    ];
    const out = [];
    const seen = new Set();
    for (const id of ids) {
        if (out.length >= limit)
            break;
        if (seen.has(id))
            continue;
        seen.add(id);
        const card = buildCard(db, repoId, id);
        if (card)
            out.push(card);
    }
    return out;
}
