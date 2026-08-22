import type { Db } from '../db.js';
import { openDb } from '../db.js';
import { dbPath } from '../home.js';
import {
  getRepo, upsertRepo, tick, explicitStart, explicitEnd, ingestSession, type Repo,
} from '../ingest.js';
import { headSha, parentOf, listFiles } from '../gitrepo.js';
import { parseDirectDeps, MANIFEST_FILES, LOCK_FILES } from '../lockfiles.js';
import { findCallSites } from '../callsites.js';
import { exportedSymbols, isSourceFile } from '../symbols.js';
import { loadZones, matchPathZone, matchDepZone, isCriticalDep, addZone, proposeZones } from '../zones.js';
import { generateDossier } from '../dossier.js';
import { askRep, answerRep, answerDefend, answerCard, recordConfidenceAfter, overrideVerdict } from '../reps.js';
import { dueCards, buildCard } from '../cards.js';
import { calibration } from '../hunch.js';
import { findUnused } from '../unused.js';
import { generateBriefs } from '../brief.js';
import { buildDigest } from '../digest.js';
import { vouchedPct, gapPerZone, extractionCost, vouchedOverTime, gapOverTime, refresh } from '../scoring.js';
import { buildMapModel } from '../map.js';
import { renderMapSvg, renderShareSvg } from '../mapsvg.js';
import { svgToPngFile } from '../mappng.js';
import { chooseBackend, metered, type ExtractionBackend } from '../extraction.js';
import { ulid, nowIso, mapLimit } from '../util.js';
import { DAEMON_VERSION } from './version.js';
import { readFileSync } from 'node:fs';
import { join, basename } from 'node:path';

export interface Ctx {
  db: Db;
  backend: ExtractionBackend;
}

export function createCtx(backend?: ExtractionBackend): Ctx {
  const db = openDb(dbPath());
  return { db, backend: backend ?? metered(db, chooseBackend()) };
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function requireRepo(ctx: Ctx, root: string | undefined): Repo {
  if (!root) throw new HttpError(400, 'root required');
  const repo = getRepo(ctx.db, root);
  if (!repo) throw new HttpError(404, `repo not registered: ${root}. Run vouch init first.`);
  return repo;
}

/**
 * First ingest at init (Wave 1 spec §1): the whole current HEAD becomes the
 * baseline graph. Every current direct dependency gets a node (and later a
 * dossier or an explicit out-of-zone classification: DoD #2, no silent
 * omissions), every in-zone source file contributes artifact nodes. All of
 * it starts at `unknown`, which is simply the honest state.
 */
export async function backfill(ctx: Ctx, repo: Repo): Promise<{ deps: number; artifacts: number }> {
  const db = ctx.db;
  const zones = loadZones(db, repo.id);
  const head = await headSha(repo.root);
  const sessionId = ulid();
  const now = nowIso();
  const parent = (await parentOf(repo.root, head)) ?? head;
  db.prepare(
    'INSERT INTO sessions (id, repo_id, started_at, ended_at, head_before, head_after, last_activity) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(sessionId, repo.id, now, now, parent, head, now);

  const files = await listFiles(repo.root);
  let deps = 0;
  let artifacts = 0;

  // dependencies at HEAD
  const map = new Map<string, string>();
  for (const f of files) {
    const base = basename(f);
    if (([...MANIFEST_FILES, ...LOCK_FILES] as string[]).includes(base) && !f.includes('node_modules/')) {
      try {
        map.set(f, readFileSync(join(repo.root, f), 'utf8'));
      } catch { /* unreadable manifests contribute nothing */ }
    }
  }
  const insSite = db.prepare('INSERT OR IGNORE INTO call_sites (node_id, path, line, snippet) VALUES (?, ?, ?, ?)');
  const clearSites = db.prepare('DELETE FROM call_sites WHERE node_id = ?');
  for (const dep of parseDirectDeps(map)) {
    const key = `${dep.ecosystem}:${dep.name}`;
    const exists = db.prepare("SELECT id FROM nodes WHERE repo_id = ? AND kind = 'dependency' AND key = ?").get(repo.id, key) as { id: string } | undefined;
    if (exists) {
      // Refresh call sites even for nodes we already know: imports move, and
      // stale call-site data quietly turns `vouch unused` into a liar.
      clearSites.run(exists.id);
      for (const site of findCallSites(repo.root, files, dep.ecosystem, dep.name)) {
        insSite.run(exists.id, site.path, site.line, site.snippet);
      }
      continue;
    }
    const zone = matchDepZone(zones, dep.name, dep.dev);
    const id = ulid();
    db.prepare(
      `INSERT INTO nodes (id, repo_id, kind, key, label, state, alive, in_zone, critical, zone_id, first_seen_session, state_changed_at, created_at)
       VALUES (?, ?, 'dependency', ?, ?, 'unknown', 1, ?, ?, ?, ?, ?, ?)`,
    ).run(id, repo.id, key, dep.name, zone?.stance === 'keep_sharp' ? 1 : 0, isCriticalDep(dep.name) ? 1 : 0, zone?.id ?? null, sessionId, now, now);
    db.prepare("INSERT INTO node_states (id, node_id, from_state, to_state, cause, rep_id, at) VALUES (?, ?, NULL, 'unknown', 'ingest', NULL, ?)").run(ulid(), id, now);
    for (const site of findCallSites(repo.root, files, dep.ecosystem, dep.name)) {
      insSite.run(id, site.path, site.line, site.snippet);
    }
    deps++;
  }

  // in-zone artifacts at HEAD
  for (const f of files) {
    if (!isSourceFile(f)) continue;
    const zone = matchPathZone(zones, f);
    if (!zone || zone.stance !== 'keep_sharp') continue;
    let content: string;
    try {
      content = readFileSync(join(repo.root, f), 'utf8');
    } catch {
      continue;
    }
    for (const sym of exportedSymbols(f, content)) {
      const key = `${f}#${sym.name}`;
      const exists = db.prepare("SELECT id FROM nodes WHERE repo_id = ? AND kind = 'artifact' AND key = ?").get(repo.id, key);
      if (exists) continue;
      const id = ulid();
      db.prepare(
        `INSERT INTO nodes (id, repo_id, kind, key, label, state, alive, in_zone, critical, zone_id, content_hash, first_seen_session, state_changed_at, created_at)
         VALUES (?, ?, 'artifact', ?, ?, 'unknown', 1, 1, ?, ?, ?, ?, ?, ?)`,
      ).run(id, repo.id, key, sym.name, zone.critical, zone.id, sym.hash, sessionId, now, now);
      db.prepare("INSERT INTO node_states (id, node_id, from_state, to_state, cause, rep_id, at) VALUES (?, ?, NULL, 'unknown', 'ingest', NULL, ?)").run(ulid(), id, now);
      artifacts++;
    }
  }
  return { deps, artifacts };
}

/** Generate dossiers for every dependency node still missing one. Degrades per node. */
export async function generatePendingDossiers(
  ctx: Ctx,
  repo: Repo,
  limit = 24,
  nodeIds?: string[],
): Promise<{ generated: number; failed: number }> {
  // With nodeIds, generate for exactly those nodes (the digest's five), so the
  // user never sits through fleet-wide generation before the first question.
  const filter = nodeIds && nodeIds.length > 0
    ? `AND n.id IN (${nodeIds.map(() => '?').join(',')})`
    : '';
  const rows = ctx.db
    .prepare(
      `SELECT n.id FROM nodes n
       LEFT JOIN dossiers d ON d.node_id = n.id
       WHERE n.repo_id = ? AND n.kind = 'dependency' AND n.alive = 1 AND n.in_zone = 1
         AND (d.id IS NULL OR d.body_json IS NULL) ${filter}
       ORDER BY n.critical DESC, n.created_at DESC LIMIT ?`,
    )
    .all(repo.id, ...(nodeIds ?? []), limit) as { id: string }[];
  let generated = 0;
  let failed = 0;
  await mapLimit(rows, 2, async (r) => {
    try {
      await generateDossier(ctx.db, repo, ctx.backend, r.id);
      generated++;
    } catch {
      failed++; // extraction failure degrades, never blocks (spec §6)
    }
  });
  return { generated, failed };
}

export interface Route {
  method: string;
  pattern: RegExp;
  handler: (ctx: Ctx, params: Record<string, string>, body: any, query: URLSearchParams) => Promise<any>;
}

export const routes: Route[] = [
  {
    method: 'GET', pattern: /^\/health$/,
    handler: async () => ({ ok: true, pid: process.pid, version: DAEMON_VERSION }),
  },
  {
    method: 'POST', pattern: /^\/repos$/,
    handler: async (ctx, _p, body) => {
      if (!body?.root || !body?.name) throw new HttpError(400, 'root and name required');
      return upsertRepo(ctx.db, body.root, body.name);
    },
  },
  {
    method: 'GET', pattern: /^\/repos$/,
    handler: async (ctx) => ctx.db.prepare('SELECT id, root, name FROM repos').all(),
  },
  {
    method: 'GET', pattern: /^\/status$/,
    handler: async (ctx, _p, _b, q) => {
      const repo = requireRepo(ctx, q.get('root') ?? undefined);
      const decayed = refresh(ctx.db, repo.id); // lazy sweep: see decay.ts
      const pending = buildDigest(ctx.db, repo.id).length;
      const depTotals = ctx.db.prepare(
        `SELECT SUM(CASE WHEN in_zone = 1 THEN 1 ELSE 0 END) AS inZone,
                SUM(CASE WHEN in_zone = 0 THEN 1 ELSE 0 END) AS outsourced
         FROM nodes WHERE repo_id = ? AND kind = 'dependency' AND alive = 1`,
      ).get(repo.id);
      return {
        repo: repo.name,
        vouchedPct: vouchedPct(ctx.db, repo.id),
        gapPerZone: gapPerZone(ctx.db, repo.id),
        calibration: calibration(ctx.db, repo.id),
        decayedNow: decayed,
        dueCards: dueCards(ctx.db, repo.id).length,
        pendingDigestItems: pending,
        dependencies: depTotals,
        extraction: extractionCost(ctx.db),
      };
    },
  },
  {
    method: 'POST', pattern: /^\/session\/tick$/,
    handler: async (ctx, _p, body) => {
      const repo = requireRepo(ctx, body?.root);
      const r = await tick(ctx.db, repo);
      // Briefs are generated off the hot path: the git hook already
      // backgrounds this call, and a failure must never affect a commit.
      if (r.closed) {
        await generatePendingDossiers(ctx, repo).catch(() => null);
        await generateBriefs(ctx.db, repo, ctx.backend, r.closed).catch(() => null);
      }
      return r;
    },
  },
  {
    method: 'POST', pattern: /^\/session\/start$/,
    handler: async (ctx, _p, body) => ({ sessionId: await explicitStart(ctx.db, requireRepo(ctx, body?.root)) }),
  },
  {
    method: 'POST', pattern: /^\/session\/end$/,
    handler: async (ctx, _p, body) => {
      const repo = requireRepo(ctx, body?.root);
      const closed = await explicitEnd(ctx.db, repo);
      if (closed) {
        await generatePendingDossiers(ctx, repo);
        await generateBriefs(ctx.db, repo, ctx.backend, closed).catch(() => null);
      }
      return { closed };
    },
  },
  {
    method: 'POST', pattern: /^\/briefs\/generate$/,
    handler: async (ctx, _p, body) => {
      const repo = requireRepo(ctx, body?.root);
      // Sessions that closed without a brief pass yet, newest first.
      const sessions = ctx.db
        .prepare(
          `SELECT s.id FROM sessions s
           WHERE s.repo_id = ? AND s.ended_at IS NOT NULL AND s.head_after IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM briefs b WHERE b.session_id = s.id)
           ORDER BY s.started_at DESC LIMIT ?`,
        )
        .all(repo.id, body?.limit ?? 3) as { id: string }[];
      let created = 0;
      let failed = 0;
      for (const s of sessions) {
        const r = await generateBriefs(ctx.db, repo, ctx.backend, s.id).catch(() => ({ created: 0, failed: 1 }));
        created += r.created;
        failed += r.failed;
      }
      return { created, failed, sessionsScanned: sessions.length };
    },
  },
  {
    method: 'POST', pattern: /^\/ingest\/backfill$/,
    handler: async (ctx, _p, body) => backfill(ctx, requireRepo(ctx, body?.root)),
  },
  {
    method: 'POST', pattern: /^\/dossiers\/generate$/,
    handler: async (ctx, _p, body) =>
      generatePendingDossiers(ctx, requireRepo(ctx, body?.root), body?.limit ?? 24, body?.nodeIds),
  },
  {
    method: 'GET', pattern: /^\/digest$/,
    handler: async (ctx, _p, _b, q) => {
      const repo = requireRepo(ctx, q.get('root') ?? undefined);
      refresh(ctx.db, repo.id);
      return buildDigest(ctx.db, repo.id);
    },
  },
  {
    method: 'GET', pattern: /^\/cards$/,
    handler: async (ctx, _p, _b, q) => {
      const repo = requireRepo(ctx, q.get('root') ?? undefined);
      refresh(ctx.db, repo.id);
      return dueCards(ctx.db, repo.id, Number(q.get('limit') ?? 5));
    },
  },
  {
    method: 'POST', pattern: /^\/cards\/ask$/,
    handler: async (ctx, _p, body) => {
      const repo = requireRepo(ctx, body?.root);
      const card = buildCard(ctx.db, repo.id, body?.nodeId);
      if (!card) throw new HttpError(404, 'no card available for that node');
      return card;
    },
  },
  {
    method: 'POST', pattern: /^\/reps\/(?<id>[A-Z0-9]+)\/card$/,
    handler: async (ctx, p, body) => {
      if (typeof body?.confidenceBefore !== 'number' || typeof body?.choice !== 'string') {
        throw new HttpError(400, 'confidenceBefore (1..7) and choice required');
      }
      return answerCard(ctx.db, p.id, body.confidenceBefore, body.choice);
    },
  },
  {
    method: 'GET', pattern: /^\/trend$/,
    handler: async (ctx, _p, _b, q) => {
      const repo = requireRepo(ctx, q.get('root') ?? undefined);
      refresh(ctx.db, repo.id);
      return {
        vouched: vouchedOverTime(ctx.db, repo.id),
        gap: gapOverTime(ctx.db, repo.id),
      };
    },
  },
  {
    // Withhold before reveal: this route serializes ONLY the RepQuestion view.
    method: 'POST', pattern: /^\/reps\/ask$/,
    handler: async (ctx, _p, body) => {
      if (!body?.nodeId) throw new HttpError(400, 'nodeId required');
      const question = askRep(ctx.db, body.nodeId);
      if (!question) throw new HttpError(404, 'node not eligible for a rep');
      return question;
    },
  },
  {
    method: 'POST', pattern: /^\/reps\/(?<id>[A-Z0-9]+)\/answer$/,
    handler: async (ctx, p, body) => {
      if (typeof body?.confidenceBefore !== 'number' || typeof body?.answer !== 'string') {
        throw new HttpError(400, 'confidenceBefore (1..7) and answer required');
      }
      return answerRep(ctx.db, ctx.backend, p.id, body.confidenceBefore, body.answer);
    },
  },
  {
    method: 'POST', pattern: /^\/reps\/(?<id>[A-Z0-9]+)\/defend$/,
    handler: async (ctx, p, body) => {
      if (typeof body?.confidenceBefore !== 'number' || typeof body?.reconstruction !== 'string'
          || typeof body?.flowChoice !== 'string') {
        throw new HttpError(400, 'confidenceBefore (1..7), reconstruction and flowChoice required');
      }
      return answerDefend(ctx.db, ctx.backend, p.id, body.confidenceBefore, body.reconstruction, body.flowChoice);
    },
  },
  {
    method: 'POST', pattern: /^\/reps\/(?<id>[A-Z0-9]+)\/after$/,
    handler: async (ctx, p, body) => {
      recordConfidenceAfter(ctx.db, p.id, body?.confidenceAfter);
      return { ok: true };
    },
  },
  {
    method: 'POST', pattern: /^\/reps\/(?<id>[A-Z0-9]+)\/override$/,
    handler: async (ctx, p, body) => {
      overrideVerdict(ctx.db, p.id, body?.verdict);
      return { ok: true };
    },
  },
  {
    method: 'POST', pattern: /^\/zones\/propose$/,
    handler: async (ctx, _p, body) => {
      const repo = requireRepo(ctx, body?.root);
      return proposeZones(await listFiles(repo.root));
    },
  },
  {
    method: 'GET', pattern: /^\/zones$/,
    handler: async (ctx, _p, _b, q) => loadZones(ctx.db, requireRepo(ctx, q.get('root') ?? undefined).id),
  },
  {
    method: 'POST', pattern: /^\/zones$/,
    handler: async (ctx, _p, body) => {
      const repo = requireRepo(ctx, body?.root);
      const id = addZone(ctx.db, repo.id, {
        kind: body.kind, pattern: body.pattern, name: body.name ?? body.pattern,
        stance: body.stance, critical: body.critical ? 1 : 0,
      });
      if (typeof body.decayDays === 'number') {
        ctx.db.prepare('UPDATE sharp_zones SET decay_days = ? WHERE id = ?').run(body.decayDays, id);
      }
      return { id };
    },
  },
  {
    method: 'GET', pattern: /^\/nodes$/,
    handler: async (ctx, _p, _b, q) => {
      const repo = requireRepo(ctx, q.get('root') ?? undefined);
      return ctx.db
        .prepare('SELECT id, kind, key, label, state, alive, in_zone, critical FROM nodes WHERE repo_id = ? AND alive = 1')
        .all(repo.id);
    },
  },
  {
    method: 'GET', pattern: /^\/deps\/classified$/,
    handler: async (ctx, _p, _b, q) => {
      // DoD #2: every direct dependency either has a dossier or an explicit classification.
      const repo = requireRepo(ctx, q.get('root') ?? undefined);
      return ctx.db
        .prepare(
          `SELECT n.label, n.in_zone, n.critical, z.name AS zone, (d.id IS NOT NULL) AS hasDossier, (d.body_json IS NOT NULL) AS hasBody
           FROM nodes n
           LEFT JOIN sharp_zones z ON z.id = n.zone_id
           LEFT JOIN dossiers d ON d.node_id = n.id
           WHERE n.repo_id = ? AND n.kind = 'dependency' AND n.alive = 1
           ORDER BY n.in_zone DESC, n.critical DESC, n.label`,
        )
        .all(repo.id);
    },
  },
  {
    method: 'GET', pattern: /^\/map\/model$/,
    handler: async (ctx, _p, _b, q) => {
      const repo = requireRepo(ctx, q.get('root') ?? undefined);
      refresh(ctx.db, repo.id);
      const w = Number(q.get('w') ?? 960);
      const h = Number(q.get('h') ?? 560);
      return buildMapModel(ctx.db, repo.id, w, h);
    },
  },
  {
    method: 'GET', pattern: /^\/map\/svg$/,
    handler: async (ctx, _p, _b, q) => {
      const repo = requireRepo(ctx, q.get('root') ?? undefined);
      const w = Number(q.get('w') ?? 960);
      const h = Number(q.get('h') ?? 600);
      const model = buildMapModel(ctx.db, repo.id, w, h - 34);
      return { svg: renderMapSvg(model, { width: w, height: h }) };
    },
  },
  {
    method: 'GET', pattern: /^\/map\/png$/,
    handler: async (ctx, _p, _b, q) => {
      const repo = requireRepo(ctx, q.get('root') ?? undefined);
      const out = q.get('out');
      if (!out) throw new HttpError(400, 'out path required');
      const model = buildMapModel(ctx.db, repo.id, 720, 500);
      const gaps = gapPerZone(ctx.db, repo.id);
      const svg = renderShareSvg(model, repo.name, gaps[0] && gaps[0].gap > 0 ? gaps[0] : null);
      svgToPngFile(svg, out);
      return { written: out };
    },
  },
  {
    method: 'POST', pattern: /^\/callsites\/rescan$/,
    handler: async (ctx, _p, body) => {
      const repo = requireRepo(ctx, body?.root);
      const files = await listFiles(repo.root);
      const deps = ctx.db
        .prepare("SELECT id, key FROM nodes WHERE repo_id = ? AND kind = 'dependency' AND alive = 1")
        .all(repo.id) as { id: string; key: string }[];
      const clear = ctx.db.prepare('DELETE FROM call_sites WHERE node_id = ?');
      const ins = ctx.db.prepare('INSERT OR IGNORE INTO call_sites (node_id, path, line, snippet) VALUES (?, ?, ?, ?)');
      let found = 0;
      for (const d of deps) {
        const [ecosystem, name] = d.key.split(/:(.+)/) as ['npm' | 'pypi', string];
        clear.run(d.id);
        for (const site of findCallSites(repo.root, files, ecosystem, name)) {
          ins.run(d.id, site.path, site.line, site.snippet);
          found++;
        }
      }
      return { dependencies: deps.length, callSites: found };
    },
  },
  {
    method: 'GET', pattern: /^\/unused$/,
    handler: async (ctx, _p, _b, q) =>
      findUnused(ctx.db, requireRepo(ctx, q.get('root') ?? undefined).id),
  },
  {
    method: 'GET', pattern: /^\/concepts$/,
    handler: async (ctx, _p, _b, q) => {
      // The "what should I actually study" view: nodes by Gap descending.
      const repo = requireRepo(ctx, q.get('root') ?? undefined);
      return ctx.db
        .prepare(
          `SELECT n.id, n.kind, n.label, n.state, COALESCE(z.name,'(unzoned)') AS zone,
                  AVG(r.confidence_before - CASE r.verdict WHEN 'pass' THEN 7 WHEN 'partial' THEN 4 WHEN 'fail' THEN 1 END) AS gap,
                  COUNT(r.id) AS reps
           FROM nodes n
           LEFT JOIN sharp_zones z ON z.id = n.zone_id
           JOIN reps r ON r.node_id = n.id AND r.verdict IN ('pass','partial','fail')
           WHERE n.repo_id = ? AND n.alive = 1 AND n.in_zone = 1
           GROUP BY n.id ORDER BY gap DESC`,
        )
        .all(repo.id);
    },
  },
  {
    method: 'POST', pattern: /^\/purge$/,
    handler: async (ctx, _p, body) => {
      if (body?.confirm !== true) throw new HttpError(400, 'confirm: true required');
      return { purge: 'handled by CLI after daemon shutdown' };
    },
  },
];
