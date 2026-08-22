import { GRADE_SCHEMA, GRADE_SYSTEM, DEFEND_GRADE_SCHEMA, DEFEND_GRADE_SYSTEM } from './prompts.js';
import { promoteClusterArtifacts } from './promote.js';
import { applyEvent } from './statemachine.js';
import { ulid, nowIso } from './util.js';
/**
 * The rep flow, hard rules 2 and 3 (spec §1):
 *  - confidence before the rep, always; the delta is the product
 *  - withhold before reveal: nothing from the dossier body or the reveal
 *    payload is serialized to any client until an attempt is submitted
 *
 * Event ordering on completion (spec §4, worked through):
 *  apply 'reveal' first, then the verdict, EXCEPT a fail when the reveal
 *  just fired. A fresh node whose probe you fail still ends at `explained`,
 *  because the reveal you just read is exactly what `explained` means;
 *  a fail on an already-explained node demotes normally.
 */
// The canonical fallback probe (spec §7.1): works with zero extraction.
export function fallbackProbe(label) {
    return `If ${label} vanished from this project tomorrow, what would you have to do?`;
}
/** ONLY these fields ever leave the server before an answer. */
export function askRep(db, nodeId) {
    const kindRow = db.prepare('SELECT kind FROM nodes WHERE id = ?').get(nodeId);
    if (kindRow?.kind === 'decision')
        return askDefend(db, nodeId);
    const node = db
        .prepare("SELECT id, label, alive, in_zone FROM nodes WHERE id = ? AND kind = 'dependency'")
        .get(nodeId);
    if (!node || node.alive !== 1 || node.in_zone !== 1)
        return null;
    // reuse an open (asked, unanswered) rep rather than stacking duplicates
    const open = db
        .prepare("SELECT id, prompt_json FROM reps WHERE node_id = ? AND answered_at IS NULL ORDER BY asked_at DESC LIMIT 1")
        .get(nodeId);
    const dossier = db
        .prepare('SELECT body_json FROM dossiers WHERE node_id = ?')
        .get(nodeId);
    const body = dossier?.body_json ? JSON.parse(dossier.body_json) : null;
    const question = body?.probe_question ?? fallbackProbe(node.label);
    const callSites = db
        .prepare('SELECT path, line, snippet FROM call_sites WHERE node_id = ? LIMIT 3')
        .all(nodeId);
    let repId;
    if (open) {
        repId = open.id;
    }
    else {
        repId = ulid();
        db.prepare(`INSERT INTO reps (id, node_id, type, prompt_json, asked_at) VALUES (?, ?, 'dossier', ?, ?)`).run(repId, nodeId, JSON.stringify({ question }), nowIso());
    }
    return { repId, nodeId, type: 'dossier', label: node.label, question, callSites };
}
export const DEMONSTRATED = {
    pass: 7,
    partial: 4,
    fail: 1,
};
export async function answerRep(db, backend, repId, confidenceBefore, answer) {
    const rep = db
        .prepare('SELECT id, node_id, answered_at FROM reps WHERE id = ?')
        .get(repId);
    if (!rep)
        throw new Error('no such rep');
    if (rep.answered_at)
        throw new Error('rep already answered');
    if (!(confidenceBefore >= 1 && confidenceBefore <= 7))
        throw new Error('confidence must be 1..7');
    const dossier = db
        .prepare('SELECT body_json, impact_json FROM dossiers WHERE node_id = ?')
        .get(rep.node_id);
    const body = dossier?.body_json ? JSON.parse(dossier.body_json) : null;
    // grade — degrades to 'ungraded', which never promotes (hard rule 9)
    let verdict = 'ungraded';
    let gap = null;
    if (body?.probe_expected && answer.trim()) {
        try {
            const { value } = await backend.run({
                task: 'grade',
                system: GRADE_SYSTEM,
                input: `Question: ${body.probe_question}\n\nExpected: ${body.probe_expected}\n\nDeveloper's answer: ${answer.trim()}\n\nGrade this answer now. Respond only through the structured output.`,
                schema: GRADE_SCHEMA,
            });
            gap = value.gap || null;
            verdict = value.grader_confidence === 'low' && value.verdict === 'pass' ? 'ungraded' : value.verdict;
        }
        catch {
            verdict = 'ungraded';
        }
    }
    const now = nowIso();
    db.prepare('UPDATE reps SET confidence_before = ?, answer_text = ?, verdict = ?, gap_text = ?, answered_at = ?, revealed_at = ? WHERE id = ?').run(confidenceBefore, answer, verdict, gap, now, now, repId);
    const revealFired = applyEvent(db, rep.node_id, { type: 'reveal' }, repId) !== null;
    if (!(verdict === 'fail' && revealFired)) {
        applyEvent(db, rep.node_id, { type: 'verdict', verdict }, repId);
    }
    const state = db.prepare('SELECT state FROM nodes WHERE id = ?').get(rep.node_id).state;
    const demonstrated = verdict === 'ungraded' ? confidenceBefore : DEMONSTRATED[verdict];
    const publicBody = body ? (({ probe_expected: _omit, ...rest }) => rest)(body) : null;
    return {
        verdict,
        gap,
        confidenceBefore,
        demonstrated,
        delta: confidenceBefore - demonstrated,
        body: publicBody,
        impact: dossier ? JSON.parse(dossier.impact_json) : null,
        stateNow: state,
    };
}
export function recordConfidenceAfter(db, repId, confidenceAfter) {
    if (!(confidenceAfter >= 1 && confidenceAfter <= 7))
        throw new Error('confidence must be 1..7');
    db.prepare('UPDATE reps SET confidence_after = ? WHERE id = ? AND answered_at IS NOT NULL').run(confidenceAfter, repId);
}
/** User verdict override (spec §12): audited as cause 'manual'. */
export function overrideVerdict(db, repId, verdict) {
    const rep = db.prepare('SELECT node_id, answered_at FROM reps WHERE id = ?').get(repId);
    if (!rep?.answered_at)
        throw new Error('rep not answered');
    db.prepare('UPDATE reps SET verdict = ? WHERE id = ?').run(verdict, repId);
    // Manual overrides move state through the same one-step table, audited manually.
    applyEvent(db, rep.node_id, { type: 'verdict', verdict }, repId);
}
// ---------- Phase 1: the Defend rep (tech spec §7.2) ----------
/**
 * Deterministic shuffle keyed by the rep id, so re-asking an unanswered rep
 * shows the same option order and the correct answer's position carries no
 * information.
 */
function shuffled(items, seed) {
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
export const DEFEND_QUESTION = 'In one or two sentences, from memory: what does this change do, and what is it assuming?';
function askDefend(db, nodeId) {
    const node = db
        .prepare("SELECT id, label, alive, in_zone FROM nodes WHERE id = ? AND kind = 'decision'")
        .get(nodeId);
    if (!node || node.alive !== 1 || node.in_zone !== 1)
        return null;
    const brief = db.prepare('SELECT body_json FROM briefs WHERE node_id = ?').get(nodeId);
    if (!brief)
        return null; // no brief, no Defend rep: never invent one
    const body = JSON.parse(brief.body_json);
    const open = db
        .prepare("SELECT id FROM reps WHERE node_id = ? AND answered_at IS NULL ORDER BY asked_at DESC LIMIT 1")
        .get(nodeId);
    const repId = open?.id ?? ulid();
    if (!open) {
        db.prepare("INSERT INTO reps (id, node_id, type, prompt_json, asked_at) VALUES (?, ?, 'defend', ?, ?)").run(repId, nodeId, JSON.stringify({ question: DEFEND_QUESTION }), nowIso());
    }
    const paths = db
        .prepare(`SELECT DISTINCT a.key FROM edges e JOIN nodes a ON a.id = e.to_node
       WHERE e.from_node = ? AND e.rel = 'about' AND a.kind = 'artifact'`)
        .all(nodeId).map((r) => r.key.split('#')[0]);
    return {
        repId,
        nodeId,
        type: 'defend',
        label: node.label,
        question: DEFEND_QUESTION,
        callSites: [],
        paths: [...new Set(paths)],
        flowOptions: shuffled([body.flow_correct, ...body.flow_distractors], repId),
    };
}
/**
 * Two parts: one free-text reconstruction (graded by the model) and one
 * recognition item (graded locally, no model needed). The recognition item
 * can only downgrade a passing reconstruction, never rescue a failing one:
 * picking the right sentence from four is weak evidence next to producing
 * the answer yourself, which is the whole premise (RESEARCH §1).
 */
export async function answerDefend(db, backend, repId, confidenceBefore, reconstruction, flowChoice) {
    const rep = db
        .prepare("SELECT id, node_id, answered_at FROM reps WHERE id = ? AND type = 'defend'")
        .get(repId);
    if (!rep)
        throw new Error('no such defend rep');
    if (rep.answered_at)
        throw new Error('rep already answered');
    if (!(confidenceBefore >= 1 && confidenceBefore <= 7))
        throw new Error('confidence must be 1..7');
    const brief = db.prepare('SELECT body_json FROM briefs WHERE node_id = ?').get(rep.node_id);
    if (!brief)
        throw new Error('no brief for this node');
    const body = JSON.parse(brief.body_json);
    const flowWasRight = flowChoice.trim() === body.flow_correct.trim();
    let verdict = 'ungraded';
    let gap = null;
    if (reconstruction.trim()) {
        try {
            const { value } = await backend.run({
                task: 'grade',
                system: DEFEND_GRADE_SYSTEM,
                input: [
                    `Brief approach: ${body.approach.join(' ')}`,
                    `Brief assumptions: ${body.assumptions.join(' ')}`,
                    `Developer reconstruction: ${reconstruction.trim()}`,
                    'Grade this reconstruction now. Respond only through the structured output.',
                ].join('\n\n'),
                schema: DEFEND_GRADE_SCHEMA,
            });
            gap = value.gap || null;
            verdict = value.grader_confidence === 'low' && value.verdict === 'pass' ? 'ungraded' : value.verdict;
        }
        catch {
            verdict = 'ungraded';
        }
    }
    // Recognition can only pull a pass down to partial, never lift a fail.
    if (verdict === 'pass' && !flowWasRight) {
        verdict = 'partial';
        gap = gap ?? 'The reconstruction held up, but the data-flow question went to a distractor.';
    }
    const now = nowIso();
    db.prepare('UPDATE reps SET confidence_before = ?, answer_text = ?, verdict = ?, gap_text = ?, answered_at = ?, revealed_at = ? WHERE id = ?').run(confidenceBefore, reconstruction, verdict, gap, now, now, repId);
    const revealFired = applyEvent(db, rep.node_id, { type: 'reveal' }, repId) !== null;
    if (!(verdict === 'fail' && revealFired)) {
        applyEvent(db, rep.node_id, { type: 'verdict', verdict }, repId);
    }
    // Defending a feature IS defending the files it is made of: the decision
    // node is a proxy for its cluster (spec §7.2). Without this, artifact
    // nodes sit in the score denominator with no rep that can ever promote
    // them, and Vouched % is arithmetically unwinnable.
    const promoted = verdict === 'pass' ? promoteClusterArtifacts(db, rep.node_id, repId) : 0;
    const state = db.prepare('SELECT state FROM nodes WHERE id = ?').get(rep.node_id).state;
    const demonstrated = verdict === 'ungraded' ? confidenceBefore : DEMONSTRATED[verdict];
    const { flow_distractors: _withheld, ...publicBrief } = body;
    return {
        verdict,
        gap,
        confidenceBefore,
        demonstrated,
        delta: confidenceBefore - demonstrated,
        flowCorrect: body.flow_correct,
        flowWasRight,
        brief: publicBrief,
        stateNow: state,
        filesPromoted: promoted,
    };
}
/**
 * A card is graded locally against the stored answer: no model call, so
 * re-testing stays free forever. A wrong card demotes per §4, which is what
 * makes decay real rather than cosmetic.
 */
export function answerCard(db, repId, confidenceBefore, choice) {
    const rep = db
        .prepare("SELECT id, node_id, prompt_json, answered_at FROM reps WHERE id = ? AND type = 'card'")
        .get(repId);
    if (!rep)
        throw new Error('no such card');
    if (rep.answered_at)
        throw new Error('rep already answered');
    if (!(confidenceBefore >= 1 && confidenceBefore <= 7))
        throw new Error('confidence must be 1..7');
    const { correct } = JSON.parse(rep.prompt_json);
    const right = choice.trim() === correct.trim();
    const verdict = right ? 'pass' : 'fail';
    const now = nowIso();
    db.prepare('UPDATE reps SET confidence_before = ?, answer_text = ?, verdict = ?, gap_text = ?, answered_at = ?, revealed_at = ? WHERE id = ?').run(confidenceBefore, choice, verdict, right ? null : correct, now, now, repId);
    // No `reveal` event here: a card re-tests something already met, so it
    // moves state through the verdict alone.
    applyEvent(db, rep.node_id, { type: 'verdict', verdict }, repId);
    const state = db.prepare('SELECT state FROM nodes WHERE id = ?').get(rep.node_id).state;
    const demonstrated = DEMONSTRATED[verdict];
    return {
        correct: right,
        correctAnswer: correct,
        confidenceBefore,
        demonstrated,
        delta: confidenceBefore - demonstrated,
        stateNow: state,
    };
}
