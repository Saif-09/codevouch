import type { Db } from './db.js';
import type { ExtractionBackend } from './extraction.js';
import { ExtractionError } from './extraction.js';
import { fetchImpact, type ImpactData } from './feeds.js';
import { DOSSIER_SCHEMA, DOSSIER_SYSTEM } from './prompts.js';
import { redactFiles } from './redact.js';
import { parseDirectDeps, MANIFEST_FILES, LOCK_FILES } from './lockfiles.js';
import { fileAt, headSha } from './gitrepo.js';
import { ulid, nowIso } from './util.js';
import type { Repo } from './ingest.js';

export interface DossierBody {
  what_it_does_here: string;
  replaced?: string | null;
  if_it_vanished: string;
  probe_question: string;
  probe_expected: string;
}

const REFRESH_DAYS = 7;

/**
 * Spec §7.1. The dossier row exists as soon as the keyless feeds answer;
 * the extraction body is best-effort and retried on later passes. The
 * universal fallback probe is the canonical "if it vanished tomorrow"
 * question, so a dossier rep works even when extraction is down.
 */
export async function generateDossier(
  db: Db,
  repo: Repo,
  backend: ExtractionBackend,
  nodeId: string,
): Promise<void> {
  const node = db
    .prepare("SELECT id, key, label FROM nodes WHERE id = ? AND kind = 'dependency'")
    .get(nodeId) as { id: string; key: string; label: string } | undefined;
  if (!node) return;
  const [ecosystem, name] = node.key.split(/:(.+)/) as ['npm' | 'pypi', string];

  const existing = db
    .prepare('SELECT id, body_json, fetched_at FROM dossiers WHERE node_id = ?')
    .get(nodeId) as { id: string; body_json: string | null; fetched_at: string } | undefined;

  const stale = existing
    ? Date.now() - Date.parse(existing.fetched_at) > REFRESH_DAYS * 86_400_000
    : true;

  let impact: ImpactData | null = null;
  if (stale) {
    // resolve the lockfile version at HEAD for accuracy
    let version: string | null = null;
    try {
      const head = await headSha(repo.root);
      const map = new Map<string, string>();
      for (const base of [...MANIFEST_FILES, ...LOCK_FILES]) {
        const content = await fileAt(repo.root, head, base);
        if (content !== null) map.set(base, content);
      }
      version = parseDirectDeps(map).find((d) => d.ecosystem === ecosystem && d.name === name)?.version ?? null;
    } catch { /* version stays null; feeds resolve latest */ }
    impact = await fetchImpact(ecosystem, name, version);
  }

  let bodyJson: string | null = existing?.body_json ?? null;
  if (bodyJson === null) {
    const sites = db
      .prepare('SELECT path, line, snippet FROM call_sites WHERE node_id = ? LIMIT 3')
      .all(nodeId) as { path: string; line: number; snippet: string }[];
    const siteText = sites.length > 0
      ? sites.map((s) => `${s.path}:${s.line}  ${s.snippet}`).join('\n')
      : '(no call sites found in the repo; say so explicitly rather than guessing)';
    const { kept } = redactFiles(repo.root, [
      { path: 'call-sites.txt', content: siteText },
    ]);
    const input = [
      `Package: ${name} (${ecosystem})`,
      `Call sites in this repository:`,
      kept[0]?.content ?? '(redacted)',
      'Write the dossier for this package now, grounded in the call sites above. Respond only through the structured output.',
    ].join('\n\n');
    try {
      const { value } = await backend.run<DossierBody>({
        task: 'dossier',
        system: DOSSIER_SYSTEM,
        input,
        schema: DOSSIER_SCHEMA,
      });
      bodyJson = JSON.stringify(value);
    } catch (e) {
      if (!(e instanceof ExtractionError)) throw e;
      bodyJson = null; // degrade: impact-only dossier, retried later
    }
  }

  if (existing) {
    db.prepare('UPDATE dossiers SET body_json = ?, impact_json = COALESCE(?, impact_json), fetched_at = ? WHERE id = ?')
      .run(bodyJson, impact ? JSON.stringify(impact) : null, impact ? nowIso() : existing.fetched_at, existing.id);
  } else {
    db.prepare('INSERT INTO dossiers (id, node_id, body_json, impact_json, fetched_at) VALUES (?, ?, ?, ?, ?)')
      .run(ulid(), nodeId, bodyJson, JSON.stringify(impact ?? {}), nowIso());
  }
}
