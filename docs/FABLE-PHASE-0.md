# Fable: Phase 0 kickoff prompt (CLI + daemon + graph + Dossier end to end + map)

> Wave 1 has four rep types. This phase builds the **CLI, the daemon, the graph, git ingest, onboarding, the Dossier rep, the digest and the map only**, because dependency nodes come straight from the lockfile and the Dossier's impact data comes from three keyless APIs. That means the entire ingest to node to rep to state to map loop is testable before a single extraction call has to work well. Defend and briefs are Phase 1, cards and decay are Phase 2, the Claude Code plugin is Phase 3. Full context: `docs/VOUCH-TECH-SPEC.md` and `docs/WAVE-1-SPEC.md`. Evidence base: `docs/RESEARCH.md`.

```
Build Phase 0 of Vouch, a local tool that makes a developer demonstrably able to defend the code, packages and services that AI put in their repository. Node 24 + TypeScript. Everything runs locally; there is no hosted backend and no account.

Read docs/VOUCH-TECH-SPEC.md first. It is the source of truth and this prompt only slices it. docs/RESEARCH.md is the source of truth for every factual claim; do not restate research findings from memory.

SCOPE. Build ONLY:
  (a) the `vouch` CLI and the localhost daemon
  (b) the SQLite graph: schema, node identity, the state machine (spec §3, §4)
  (c) git ingest: session boundaries, diffs, lockfile deltas, AI-authorship labelling (spec §5)
  (d) `vouch init` onboarding and keep-sharp zones (Wave 1 spec §1)
  (e) the Dossier rep end to end, including the three keyless impact feeds (spec §7.1, §8)
  (f) the digest, capped at five items (Wave 1 spec §3)
  (g) the map: treemap dashboard plus PNG export (spec §10)
  (h) redaction and the egress allowlist (spec §11)
  (i) the ExtractionBackend interface with BOTH adapters (spec §6)

DO NOT build in this phase: the Defend session, build briefs, recognition-item generation, spaced cards, decay scheduling, Hunch in any form, the Claude Code plugin or any hook, the VS Code or Cursor extension, bundle-size analysis, team features, accounts, sharing, or any hosted service. Do not parse Claude Code transcript JSONL under any circumstance. The format is explicitly internal and unstable (RESEARCH §7.2), and this is a hard rule, not a preference. If a Defend session would be triggered, record the feature cluster in the graph and skip it silently; do not stub a fake brief.

HARD RULES (non-negotiable, from spec §1. A build that violates one has failed):
- NOTHING BLOCKS. Vouch never prevents an AI call, a commit or a push. There is no strict mode.
- CONFIDENCE BEFORE THE REP, ALWAYS. Every rep opens with a 1-to-7 self-rating and closes by showing the delta against what the user could actually produce. This is the product, not telemetry. A rep without the rating is a failing test.
- WITHHOLD BEFORE REVEAL. `probe_expected` and every reveal payload stay server-side until the user submits an attempt. Enforce this in code with a test, the same way launch-readiness enforces its free-versus-gated split.
- KEEP-SHARP ZONES GATE EVERYTHING. No node outside a declared zone generates a rep, enters the score, or decays.
- THE DIGEST CAPS AT FIVE ITEMS and is regenerated from the current graph. Never build a backlog table. No streaks, no leaderboards, no totals that only go down.
- REDACTION RUNS BEFORE EVERY MODEL CALL. The never-send list in spec §11 is not overridable by config.
- GRADING IS SECONDARY. `partial` and `ungraded` are first-class verdicts. A rep never promotes a node on a low-confidence grade, and the user can override a verdict, which logs cause = 'manual'.

PLATFORM RULES:
- SQLite via better-sqlite3, WAL mode, at ~/.vouch/vouch.db. The daemon is the single writer.
- Diffs come from git via simple-git. Git is the ONLY diff source. Call sites come from ts-morph for TS and JS.
- Dashboard is Next.js App Router bound to localhost, started by `vouch dashboard`. Node runtime everywhere; never set runtime = 'edge'. The dashboard reads the daemon HTTP API, never SQLite directly, because the extension later reuses those same routes.
- Impact data from deps.dev, OSV and the npm registry only. All keyless. Use the batch endpoints. Use HTTP/2 for OSV batch queries, since HTTP/1.1 caps responses at 32 MiB. Cache in dossiers.impact_json with a 7-day refetch. Rate limits are undocumented, so cap concurrency and back off politely.
- Label npm dist.unpackedSize as INSTALL SIZE, never bundle size. They are different numbers and conflating them makes the Dossier wrong.
- Extraction via `claude -p --output-format json --json-schema '<schema>' --append-system-prompt '<system>' --max-budget-usd 0.25`. All four flags verified against Claude Code 2.1.238. Set --max-budget-usd on EVERY call. Parse cost_usd and accumulate it into a local meter that `vouch status` prints.
- Build BOTH extraction adapters behind the ExtractionBackend interface from the first commit: ClaudeCliBackend as the default, GatewayBackend via AI Gateway using a "provider/model" string as the alternate. Never pin a provider SDK. The reason is in RESEARCH §7.5: batch use of a subscription is neither prohibited nor explicitly permitted, and this interface is what stops that ambiguity from ever blocking distribution.
- Extraction is batch, at session end, never in the hot loop. Concurrency capped at 4. Extraction failure must DEGRADE, never block: with the backend forced to fail, ingest still completes and Dossiers still generate from the keyless feeds.

=== PART A: CLI, daemon, graph ===

1. `vouch` with no arguments prints status and the single most useful next action. Never a menu.
2. Implement the full schema in spec §3, including the node identity rules in §3.1. Node keys must be stable across refactors: dependencies are `<ecosystem>:<name>` and never version-pinned; artifacts are `<path>#<symbol>` matched by symbol first and content hash second. An unmatched rename creates a new node and sets alive = 0 on the old one. Never silently merge.
3. Implement the state machine in spec §4 exactly, with every transition writing an append-only node_states row. That table is the source of truth for every chart; never derive history from the current state. Demotion is one step at a time and never below `unknown`. Only `defended` decays. Decay touches only nodes with alive = 1 AND in_zone = 1.
4. Commands for this phase: init, status, digest, dossier, map, zones, session start|end, purge. The rest error with "arrives in Phase 1"; do not stub them.

=== PART B: Onboarding (Wave 1 spec §1) ===

`vouch init` scans the repo, then proposes 8 to 12 candidate keep-sharp zones DERIVED FROM WHAT IS ACTUALLY IN THE REPO, never a generic checklist. Each candidate shows a file count and one real example path. One keypress each: keep sharp / outsourced / skip. Then install the post-commit hook and run the first ingest.

Defaults must be right because most users will accept them: generated code, lockfiles, build config and styling scaffolding default to OUTSOURCED. Auth, payments, data deletion, secrets handling and external egress default to KEEP SHARP and are marked critical. Everything else is out of scope unless the user opts it in; silence means out, not in. Erring toward outsourced is deliberate: an over-inclusive zone list is the fastest route to uninstallation.

Target: under 90 seconds on a cold repo including the first ingest.

=== PART C: The Dossier rep (spec §7.1) ===

READ SPEC §7.1 AND §8 BEFORE WRITING ANY OF THIS.

Pipeline:
1. INGEST      new direct dependencies from the lockfile delta become dependency nodes immediately, with NO model call. The Dossier's existence must never depend on extraction succeeding.
2. CALL SITES  locate real references with ts-morph. Cap at three shown. NEVER invent a call site. If none can be found, say so explicitly in the rep rather than guessing.
3. IMPACT      fetch the keyless feeds in spec §8 and cache them.
4. GENERATE    one schema-enforced extraction call producing what_it_does_here, replaced, if_it_vanished, probe_question, probe_expected. "What it does here" must be grounded in the supplied call sites and must NOT be the README pitch.
5. ASK         show the package name and its real call sites, take the 1-to-7 confidence rating, then ask probe_question. Nothing else is sent to the client.
6. REVEAL      only after an attempt is submitted: what_it_does_here, if_it_vanished, the impact block, the graded delta, then capture confidence_after.

Provenance: "why it entered" is the session and commit that introduced it, from git. Never reconstruct it by mining transcripts.

Services (Clerk, Stripe, Upstash and similar) have no registry for pricing, failure modes or data egress. Build a curated local table seeded by hand for the providers that actually appear in AI-built apps. This table is shared surface with launch-readiness, so put it in its own package designed to be consumed by both, and do not fork it.

=== PART D: Digest and map ===

DIGEST: fires when a session closes, five items maximum, selected by weight then recency with critical nodes first. Framed as "here is what landed today, and here is what you could not explain about it", never "you have 5 tasks". Un-actioned items are NOT carried forward as a queue.

MAP: this is the artifact a user would screenshot, so it is the one screen where visual investment is justified. Everything else in this phase can be plain.
- A treemap of the repository, area by weight, colour by state.
- Load the `dataviz` skill BEFORE building it and validate the palette against it.
- Palette exactly as specified in spec §10 (validator-locked): paper #F4F0E8, ink #1B1A17, oxblood #7A2E28 for unknown and decayed, brass #B08A4A for explained and predicted, verdigris #4E7B77 for defended, chalk #D7D0C4 for out of zone. No saturated blue, purple, green, orange or neon anywhere in this product.
- State must be readable without hue alone: pair colour with a fill pattern for `decayed` so the map survives greyscale and colour-vision differences.
- Second view: concepts sorted by the Gap descending. This is the "what should I actually study" screen and it is not optional.
- PNG export composited at 1200x630 with the treemap, Vouched % and the Gap, plus room for a wordmark. Written locally, no network call, path printed. No account, ever.

THE TWO NUMBERS (spec §9). Explicability beats precision, because the user must be able to see why a number moved. Weight is 1, or 3 for critical nodes; nothing else affects it. Vouched % is the weighted share of in-zone live nodes in state `defended`. The Gap is mean(confidence_before − demonstrated) where demonstrated is 7 for pass, 4 for partial, 1 for fail, and it is reported PER ZONE because the aggregate is useless.

=== PRIVACY (spec §11): enforce in code, not documentation ===
- Never-send list, not overridable: .env, .env.*, *.pem, *.key, *.p12, *.pfx, id_rsa*, *.keystore, anything matching *secret* or *credential*.
- .vouchignore, gitignore syntax, unions with the above.
- Content scrub on everything that survives: sk-, sk-ant-, ghp_, github_pat_, AKIA, AIza, xoxb-, JWT shapes, PEM blocks, credentialled URLs, and high-entropy strings over 32 chars. Replace with [REDACTED:<kind>].
- If a hunk is more than 40% redacted, DROP it rather than send a mangled fragment.
- Egress allowlist enforced in code: the local claude binary, api.deps.dev, api.osv.dev, registry.npmjs.org, api.npmjs.org. Any other outbound host is a bug and a failing test.
- `vouch purge` leaves nothing behind.

QUALITY BARS / DEFINITION OF DONE
1. `vouch init` on a cold repo completes in under 90 seconds including first ingest, proposing zones drawn from the repo's real contents.
2. Run it against slate, tread, silai and shoppin before anything else, since our own repos are the first fixtures. Every direct dependency either produces a Dossier or is explicitly classified out of zone. No silent omissions.
3. Call-site accuracy asserted against a hand-labelled fixture repo. Zero invented call sites.
4. An automated test proves no probe_expected or reveal payload is ever serialized to a client before reps.answered_at is set.
5. A test asserts a diff containing an API key, a .env file, a PEM block and a credentialled database URL never reaches the extraction backend.
6. A test asserts the only outbound hosts are the four allowlisted APIs and the local claude binary. Any other host fails the build.
7. Every transition in spec §4 unit tested: one-step demotion, decay only on alive = 1 AND in_zone = 1, only `defended` decays, every transition writes a node_states row.
8. An identity fixture exercising a file rename and a symbol rename asserts nodes are re-keyed rather than duplicated, and unmatched renames retire rather than merge.
9. Every rep captures confidence_before and confidence_after and the reveal shows the delta.
10. With the extraction backend forced to fail: ingest completes, Dossiers still generate from the keyless feeds, nothing crashes and nothing blocks.
11. `vouch status` reports cumulative extraction cost. --max-budget-usd is set on every call.
12. A scripted run over a realistic day's diff on a fixture repo yields a digest completable in under three minutes.
13. Map renders and exports to PNG with no account; 320px to 4K, AA contrast, keyboard navigable, prefers-reduced-motion respected.
14. `vouch purge` verified by test to leave nothing behind.

The product is called Vouch and the binary is `vouch`. Do not rename it, do not add a tagline, and do not buy or suggest a domain. The npm publish name is still open because `vouch` and `vouch-cli` are both taken (RESEARCH §5.4, §8), so publish nothing in this phase and ask me before the first publish.
```

---

## Phase map

| Phase | Scope | Why this order |
|---|---|---|
| **0** | CLI, daemon, graph, git ingest, onboarding, Dossier end to end, digest, map, PNG | Smallest surface that proves the whole loop. Dependency nodes come from the lockfile and impact data from keyless APIs, so the loop is testable before extraction quality matters |
| **1** | Withheld build brief, Defend session, recognition-item generation | The heart of the product and the heaviest extraction work. Needs Phase 0's graph |
| **2** | Spaced cards, decay scheduling, the Gap over time | Retention layer. Untestable without real state history |
| **3** | Claude Code plugin, real-time Hunch, VS Code and Cursor extension | Gated on RESEARCH §7. The additionalContext delegation must be validated against a live session first |
