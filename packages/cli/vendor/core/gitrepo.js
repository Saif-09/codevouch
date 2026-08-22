import { simpleGit } from 'simple-git';
export function git(root) {
    return simpleGit({ baseDir: root });
}
export async function headSha(root) {
    try {
        return (await git(root).revparse(['HEAD'])).trim();
    }
    catch {
        throw new Error('this repository has no commits yet; make one commit and re-run');
    }
}
export async function parentOf(root, sha) {
    try {
        return (await git(root).revparse([`${sha}^`])).trim();
    }
    catch {
        return null; // first commit
    }
}
/** name-status with rename detection between two revs. */
export async function changedFiles(root, before, after) {
    const raw = await git(root).raw(['diff', '--name-status', '-M', `${before}..${after}`]);
    const out = [];
    for (const line of raw.split('\n')) {
        if (!line.trim())
            continue;
        const parts = line.split('\t');
        const code = parts[0][0];
        if (code === 'R')
            out.push({ status: 'R', oldPath: parts[1], path: parts[2] });
        else if (code === 'A' || code === 'M' || code === 'D')
            out.push({ status: code, path: parts[1] });
    }
    return out;
}
export async function fileAt(root, rev, path) {
    try {
        return await git(root).show([`${rev}:${path}`]);
    }
    catch {
        return null;
    }
}
export async function unifiedDiff(root, before, after) {
    return git(root).raw(['diff', '--unified=3', `${before}..${after}`]);
}
// AI authorship from explicit git metadata, the method validated at scale by
// RESEARCH §2.4: trailers, bot logins, known author names and emails.
// A label, not a filter (spec §5.2).
const AI_AUTHOR = /claude|copilot|cursor|devin|gemini|aider|codex|windsurf|openhands|\[bot\]/i;
const AI_EMAIL = /noreply@anthropic\.com|copilot@|bot@|noreply@openai\.com/i;
const AI_TRAILER = /co-authored-by:.*(claude|copilot|cursor|devin|gemini|aider|codex)/i;
export async function aiAuthored(root, before, after) {
    const log = await git(root).raw([
        'log', '--format=%an%x09%ae%x09%(trailers)%x09%B%x00', `${before}..${after}`,
    ]);
    for (const entry of log.split('\0')) {
        const [name = '', email = '', trailers = '', body = ''] = entry.split('\t');
        if (AI_AUTHOR.test(name) || AI_EMAIL.test(email))
            return true;
        if (AI_TRAILER.test(trailers) || AI_TRAILER.test(body))
            return true;
    }
    return false;
}
export async function listFiles(root) {
    const raw = await git(root).raw(['ls-files']);
    return raw.split('\n').filter(Boolean);
}
