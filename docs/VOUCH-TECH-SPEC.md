# Vouch: Technical Specification

**Product:** a local tool that makes a developer demonstrably able to defend the code, concepts, packages and services that AI put into their repository.
**Not:** a blocker, a linter, a code reviewer, or a tool that explains your codebase to you.
**Audience:** solo developers shipping with AI.
**Rev:** A. Companion to `docs/RESEARCH.md`, which is the evidence base and is cited by section throughout.

---

## 0. The thesis in one paragraph

The illusion of explanatory depth says people rate their understanding of a mechanism at 5 or 6 out of 7, and that rating collapses the moment they try to explain it (RESEARCH §1). The confidence study says trust in the AI displaces critical thinking while trust in yourself restores it (RESEARCH §2.1). Put together: the intervention is not to restrict AI, it is to make the developer attempt production on their own code, and to show them the gap between what they thought they knew and what they could produce. Everything below is machinery for delivering that one moment cheaply and often.

---

## 1. Hard rules

These are not preferences. A build that violates one of them has failed.

1. **Nothing blocks.** Vouch never prevents an AI call, a commit, or a push. No exceptions, no opt-in strict mode in Wave 1.
2. **Confidence before the rep, always.** Every rep opens with a 1-to-7 self-rating and closes by showing the delta. This is the product, not telemetry. A rep implemented without the rating is not a rep.
3. **Withhold before reveal.** Briefs and dossier answers are generated when the code lands and are not serialized to any client until the user has submitted an attempt. Enforced by test, not by convention.
4. **Keep-sharp zones gate everything.** No node outside a declared zone ever generates a rep, enters the score, or decays.
5. **At most one free-text answer per rep, and at most one Defend rep per digest.** Everything else is recognition-based. The undesirable-difficulty boundary is real for high-element-interactivity material (RESEARCH §3), and a multi-file feature is exactly that, so the Defend rep asks for one short reconstruction and then switches to recognition items. A Dossier probe about a single package is low-interactivity, so its one-line free-text answer stays. (Rev A said "one free-text answer per session", which read as one per digest and contradicted the Dossier flow that Phase 0 shipped. The research constrains blank-page effort on *interactive* material, not the count of short answers, so this is the wording that matches the evidence.)
6. **The digest caps at five items.** Un-actioned items age into `decayed` and colour the map. Vouch never nags, never counts a streak against the user, and never shows a growing backlog.
7. **Never parse transcript JSONL.** The format is explicitly internal and unstable (RESEARCH §7.2). Provenance comes from git and from documented hook payloads.
8. **Redaction runs before every model call**, and the egress allowlist is enforced in code.
9. **Grading is secondary.** IOED works through attempted production, not feedback (RESEARCH §1). A rep where the grader is uncertain still counts as a rep; it just does not promote the node.

---

## 2. Architecture

| Concern | Choice | Note |
|---|---|---|
| CLI | Node 24 + TypeScript, binary `vouch` | The only interface in Phase 0 |
| Daemon | One Node process, HTTP on `127.0.0.1`, ephemeral port written to `~/.vouch/daemon.json` | Every client is thin |
| Store | SQLite via `better-sqlite3` at `~/.vouch/vouch.db` | WAL mode. Single writer is the daemon |
| Diff source | `git` through `simple-git` | The only diff source, in both ingest paths |
| Call sites | `ts-morph` for TS and JS, tree-sitter for everything else | Real references only, never inferred |
| Extraction | `ExtractionBackend` interface, two adapters | `claude -p` default, AI Gateway alternate. See §6 |
| Dashboard | Next.js App Router, started by `vouch dashboard`, bound to localhost | Node runtime only, never Edge. Reads the daemon API, never SQLite directly |
| Package data | deps.dev, OSV, npm registry | All keyless. See §8 |
| Plugin | Claude Code plugin bundling hooks plus a monitor | Wave 2 only. See §13 |

```
                    ┌──────────────┐
   git repo ───────>│   INGEST     │  session boundary, diff, lockfile diff
                    └──────┬───────┘
                           v
                    ┌──────────────┐
                    │  EXTRACTION  │  claude -p --json-schema, redacted input
                    └──────┬───────┘
                           v
   deps.dev ──────> ┌──────────────┐
   OSV      ──────> │    GRAPH     │  nodes, edges, states  (SQLite)
   npm      ──────> └──────┬───────┘
                           v
                    ┌──────────────┐      ┌──────────┐
                    │     REPS     │<────>│  DIGEST  │  max 5 items
                    └──────┬───────┘      └──────────┘
                           v
                    ┌──────────────┐
                    │   MAP + PNG  │  Vouched %, The Gap
                    └──────────────┘
```

---

## 3. Data model

SQLite. Times are ISO 8601 UTC strings. Ids are ULIDs.

```sql
CREATE TABLE repos (
  id TEXT PRIMARY KEY,
  root TEXT NOT NULL UNIQUE,          -- absolute path
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE sharp_zones (             -- rule 4: nothing happens outside these
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repos(id),
  kind TEXT NOT NULL,                  -- 'path' | 'topic' | 'dependency_class'
  pattern TEXT NOT NULL,               -- glob, topic slug, or class name
  stance TEXT NOT NULL,                -- 'keep_sharp' | 'outsourced'
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repos(id),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  head_before TEXT NOT NULL,           -- commit SHA
  head_after TEXT,
  ai_authored INTEGER NOT NULL DEFAULT 0,  -- from git trailers, RESEARCH 2.4
  digest_shown_at TEXT
);

CREATE TABLE nodes (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repos(id),
  kind TEXT NOT NULL,                  -- 'concept' | 'artifact' | 'dependency' | 'decision'
  key TEXT NOT NULL,                   -- stable identity, see 3.1
  label TEXT NOT NULL,
  state TEXT NOT NULL,                 -- see section 4
  alive INTEGER NOT NULL DEFAULT 1,    -- 0 once the code is gone; excluded from scoring
  in_zone INTEGER NOT NULL DEFAULT 0,  -- cached zone match
  critical INTEGER NOT NULL DEFAULT 0, -- weight 3 instead of 1, see section 9
  first_seen_session TEXT REFERENCES sessions(id),
  state_changed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (repo_id, kind, key)
);

CREATE TABLE edges (
  from_node TEXT NOT NULL REFERENCES nodes(id),
  to_node   TEXT NOT NULL REFERENCES nodes(id),
  rel TEXT NOT NULL,                   -- 'uses' | 'introduced_by' | 'replaces' | 'depends_on' | 'about'
  PRIMARY KEY (from_node, to_node, rel)
);

CREATE TABLE reps (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES nodes(id),
  type TEXT NOT NULL,                  -- 'dossier' | 'defend' | 'hunch' | 'card'
  confidence_before INTEGER,           -- 1..7, rule 2. NULL only if the user skipped
  prompt_json TEXT NOT NULL,           -- what was asked
  answer_text TEXT,                    -- what the user produced
  verdict TEXT,                        -- 'pass' | 'partial' | 'fail' | 'ungraded'
  gap_text TEXT,                       -- the specific thing they could not produce
  confidence_after INTEGER,            -- 1..7, captured after the reveal
  asked_at TEXT NOT NULL,
  answered_at TEXT,
  revealed_at TEXT                     -- rule 3: NULL means nothing was revealed yet
);

CREATE TABLE node_states (             -- full audit trail; never overwritten
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES nodes(id),
  from_state TEXT,
  to_state TEXT NOT NULL,
  cause TEXT NOT NULL,                 -- 'ingest' | 'rep_pass' | 'rep_fail' | 'decay' | 'manual'
  rep_id TEXT REFERENCES reps(id),
  at TEXT NOT NULL
);

CREATE TABLE briefs (                  -- withheld until reps.revealed_at is set
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES nodes(id),
  session_id TEXT NOT NULL REFERENCES sessions(id),
  body_json TEXT NOT NULL,             -- schema in 7.2
  created_at TEXT NOT NULL
);

CREATE TABLE dossiers (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES nodes(id),   -- kind='dependency'
  body_json TEXT NOT NULL,             -- schema in 7.1
  impact_json TEXT NOT NULL,           -- the keyless-feed data, section 8
  fetched_at TEXT NOT NULL
);

CREATE TABLE call_sites (
  node_id TEXT NOT NULL REFERENCES nodes(id),
  path TEXT NOT NULL,
  line INTEGER NOT NULL,
  snippet TEXT NOT NULL,
  PRIMARY KEY (node_id, path, line)
);
```

### 3.1 Node identity

`key` must be stable across refactors or the graph resets itself constantly and every score is noise.

| Kind | `key` |
|---|---|
| `dependency` | `<ecosystem>:<name>` , for example `npm:drizzle-orm`. Never version-pinned |
| `concept` | slugified canonical label from a fixed vocabulary plus a free tail, for example `concept:optimistic-locking` |
| `artifact` | `<path>#<exported-symbol>` where a symbol exists, else `<path>` . On rename, match by symbol first and content hash second, then rewrite the key and log it |
| `decision` | `decision:<sha-of-session>:<slug>` , anchored to the session that made it |

Artifact churn is the known weak point. When a rename cannot be matched with confidence, create a new node and mark the old one `alive = 0`. Never silently merge.

---

## 4. The comprehension state machine

Five states. `alive` and `in_zone` are flags, not states, because a deleted or out-of-zone node has no comprehension status worth arguing about.

```
                  ┌──────── rep_fail ────────┐
                  v                          │
  (ingest) → unknown → explained → predicted → defended
                  ^         ^                     │
                  │         └──── decay ──────────┘
                  └───────── rep_fail ────────────┘
```

Transition rules, exhaustively:

| From | Event | To |
|---|---|---|
| none | node created by ingest | `unknown` |
| `unknown` | brief or dossier revealed after an attempt | `explained` |
| `explained` | Hunch prediction judged correct | `predicted` |
| `explained` or `predicted` | rep verdict `pass` | `defended` |
| any | rep verdict `partial` | unchanged, gap recorded |
| `defended` | rep verdict `fail` | `explained` |
| `explained` or `predicted` | rep verdict `fail` | `unknown` |
| `defended` | no passing rep within the decay window | `decayed` |
| `decayed` | rep verdict `pass` | `defended` |
| any | verdict `ungraded` | unchanged |

Constraints, all unit tested:

- **Demotion is one step at a time.** Never below `unknown`.
- **Decay only applies to nodes with `alive = 1` and `in_zone = 1`.** A node the user declared outsourced never decays, never scores, and never generates a rep.
- **Only `defended` decays.** Lower states are already honest about themselves.
- **Every transition writes a `node_states` row.** The table is append-only and is the source of truth for every chart. Never derive history from the current state.
- **Decay window default 90 days**, configurable per zone. `critical` nodes use half the window.

---

## 5. Ingest

Editor-agnostic on purpose. Works whether Fable, Claude Code, Cursor, Copilot or a human wrote the code.

### 5.1 Session boundaries

A session is a window of work, not a commit. Boundaries come from, in priority order:

1. An explicit `vouch session start` / `vouch session end`.
2. A `post-commit` git hook installed by `vouch init`, which closes any session older than the idle timeout and opens a new one.
3. Idle timeout, default 90 minutes of no commits, closed lazily on next contact.

`head_before` and `head_after` bound the diff. A session with no diff is discarded, not stored.

### 5.2 AI authorship

Detected using the method from RESEARCH §2.4, which is documented, reusable, and needs no editor integration: `Co-authored-by` trailers, bot actor logins, and known author emails and names. Stored as `sessions.ai_authored`.

**Authorship is a label, not a filter.** For a solo dev shipping with AI, most code is AI-touched, and code the user wrote themselves is equally worth defending. Wave 1 treats all new in-zone code as in scope and uses the label only for reporting.

### 5.3 What ingest produces

For each session: the unified diff, per-file hunks, the lockfile delta, and the set of new or changed exported symbols. Lockfile parsing covers `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `requirements.txt`, `pyproject.toml` and `uv.lock`. New direct dependencies produce `dependency` nodes immediately, with no model call required: **the Dossier's existence never depends on extraction succeeding.**

---

## 6. Extraction

One interface, two adapters, from the first commit. The subscription-terms question in RESEARCH §7.5 is unresolved, and the interface is what stops that from ever blocking distribution.

```ts
interface ExtractionBackend {
  run<T>(spec: {
    task: 'concepts' | 'dossier' | 'brief' | 'grade';
    system: string;
    input: string;          // already redacted, see section 11
    schema: object;         // JSON Schema, enforced
    maxUsd?: number;
  }): Promise<{ value: T; costUsd?: number }>;
}
```

**`ClaudeCliBackend`** (default). Shells out to:

```
claude -p --output-format json --json-schema '<schema>' \
       --append-system-prompt '<system>' --max-budget-usd 0.25
```

All four flags verified against Claude Code 2.1.238 (RESEARCH §7.4). Parse `cost_usd` from the result and accumulate it in a local meter that `vouch status` prints. Set `--max-budget-usd` on every call without exception.

**`GatewayBackend`** (alternate). AI Gateway with a `"provider/model"` string, never a provider-specific SDK. Selected by config or by the presence of a key.

Rules:

- **Extraction is batch, at session end.** Never in the hot loop.
- **Extraction failure degrades, never blocks.** A failed concept extraction leaves the diff unprocessed and retries next session. Dossiers still generate from the keyless feeds.
- **Every call is schema-enforced.** No free-text parsing anywhere.
- **Concurrency capped at 4**, with backoff. Rate limits are undocumented (RESEARCH §7.5), so behave conservatively.

---

## 7. The three rep types

Every rep obeys rule 2 (confidence first) and rule 3 (withhold before reveal). The client receives the question and nothing else. `POST /reps/:id/answer` is what unlocks the reveal payload.

### 7.1 Dossier: one per new dependency or service

Generated from the keyless feeds plus one extraction call. Schema:

```json
{
  "type": "object",
  "required": ["what_it_does_here", "if_it_vanished", "probe_question", "probe_expected"],
  "properties": {
    "what_it_does_here": { "type": "string", "description": "Its role in THIS repo, grounded in the provided call sites. Never the README pitch." },
    "replaced": { "type": ["string", "null"], "description": "What it displaced, if the diff shows something removed" },
    "if_it_vanished": { "type": "string", "description": "The concrete work required to remove it" },
    "probe_question": { "type": "string", "description": "One question that cannot be answered without understanding its role here" },
    "probe_expected": { "type": "string", "description": "What a correct answer must contain. Withheld until reveal." }
  }
}
```

The rep shown to the user: the package name, its real call sites from `call_sites` (never invented, §2), a 1-to-7 confidence rating, then `probe_question`. Reveal shows `what_it_does_here`, `if_it_vanished`, the impact block from §8, and the graded delta.

**Provenance.** "Why it entered" is the session and commit that introduced it, from git. Where the Wave 2 plugin captured a stated reason live, show it. Never reconstruct it by mining transcripts (rule 7).

### 7.2 Defend: one per shipped feature

A feature is a cluster of same-session artifact nodes sharing call graph edges. The brief is generated at session end and withheld.

```json
{
  "type": "object",
  "required": ["approach", "concepts", "rejected", "assumptions", "breaks_first"],
  "properties": {
    "approach":     { "type": "array", "items": { "type": "string" }, "minItems": 3, "maxItems": 5 },
    "concepts":     { "type": "array", "items": { "type": "string" } },
    "rejected":     { "type": "array", "items": { "type": "object", "required": ["option", "why_not"],
                        "properties": { "option": {"type":"string"}, "why_not": {"type":"string"} } } },
    "assumptions":  { "type": "array", "items": { "type": "string" }, "description": "Load-bearing. If false, the feature is wrong, not just buggy." },
    "breaks_first": { "type": "array", "items": { "type": "string" }, "minItems": 3, "maxItems": 3 }
  }
}
```

The rep: confidence rating, then **one free-text answer** (rule 5), "in one or two sentences, what does this feature do and what is it assuming?", then recognition items only. Recognition items are generated alongside the brief: pick the correct data-flow summary from four, and match each new dependency to its role. Distractors must be plausible and drawn from the same repo, or the item teaches nothing.

Reveal diffs the free-text answer against `assumptions` and `breaks_first` and names the specific gap into `reps.gap_text`.

### 7.3 Hunch: predict before reveal

Wave 1 form: spaced and deliberate. `vouch hunch` presents a past decision or artifact and asks for a prediction before showing what was actually done.

Wave 2 form: real time, via the mechanism in RESEARCH §7.1. The hook allows the prompt and injects `additionalContext` instructing Claude to ask for a one-line prediction, wait, answer, then name the delta. Vouch records the exchange through a companion tool call. **The hook must never block a prompt**, both because of rule 1 and because exit code 2 erases the user's typed prompt.

### 7.4 Cards

Spaced re-tests drawn from any node in `defended` approaching its decay window, and from any node with a recorded `gap_text`. A card is the cheapest rep: confidence, one recognition item, reveal. Failing a card demotes per §4, which is what makes decay real rather than cosmetic.

---

## 8. Impact data

All keyless, all verified (RESEARCH §6). Cached in `dossiers.impact_json` with `fetched_at`; refetch after 7 days.

| Field | Source |
|---|---|
| Install size | npm registry `dist.unpackedSize`. Labelled **install size**, never bundle size |
| Download volume | `api.npmjs.org/downloads/point/last-week/<pkg>` |
| Maintenance recency | npm `time.modified` |
| Licence, advisories | deps.dev `GetVersion` |
| Transitive count | deps.dev `GetDependencies`, the resolved graph |
| Blast radius | deps.dev `GetDependents` |
| Malware, deprecation | deps.dev `GetFindings` |
| Maintenance signal | deps.dev `GetProject`, OpenSSF Scorecard |
| Vulnerabilities | OSV `POST /v1/querybatch` over **HTTP/2**, since HTTP/1.1 caps responses at 32 MiB |

Use the batch endpoints; deps.dev accepts up to 5,000 requests per call, so a lockfile resolves in one or two round trips. Rate limits are undocumented, so cache aggressively and back off.

**Services are a curated local table**, not an API: pricing at 10k users, failure mode when down, what data leaves the machine, whether it reads secrets. Seeded by hand for the providers that actually show up in AI-built apps. This table is shared surface with launch-readiness and belongs in one package used by both, not written twice.

---

## 9. The two numbers

Explicability beats precision. A user must be able to see why a number moved.

**Weight.** 1 for a normal node, 3 for `critical`. A node is `critical` if it touches authentication, payments, data deletion, secrets handling, or external egress. Nothing else affects weight. No logarithms, no churn coefficients.

**Vouched %**

```
vouched = Σ weight(n) for n where state = 'defended'
        ─────────────────────────────────────────────  × 100
          Σ weight(n) for n where alive = 1 AND in_zone = 1
```

**The Gap** (the flagship, from RESEARCH §1)

```
gap = mean( confidence_before − demonstrated )   over graded reps in the window

demonstrated = 7 for 'pass', 4 for 'partial', 1 for 'fail'
```

A positive Gap is overconfidence. It is reported per zone, because the aggregate is useless and the per-zone breakdown is the actionable artifact: "you are calibrated on data modelling and two points overconfident on auth."

**Calibration** arrives with real-time Hunch in Wave 2: share of predictions matching the answer's shape. Not in Wave 1.

Never show a streak. Never show a leaderboard. Never show a total that only goes down.

---

## 10. The map

A **treemap of the repository**, area by weight, colour by state. A treemap because area maps directly to "share of your codebase", it reads at a glance, and it survives being screenshotted.

Palette. Editorial, not a dashboard default. No saturated blue, purple, green, orange or neon.

| Token | Hex | Use |
|---|---|---|
| `paper` | `#F4F0E8` | Ground |
| `ink` | `#1B1A17` | Text, borders |
| `oxblood` | `#7A2E28` | `unknown`, `decayed` |
| `brass` | `#B08A4A` | `explained`, `predicted` |
| `verdigris` | `#4E7B77` | `defended` |
| `chalk` | `#D7D0C4` | Out of zone, deliberately inert |

These hexes are validator-locked, not aesthetic suggestions. The first draft used a dark olive for `defended`; the dataviz validator showed it merging with oxblood at ΔE 4.2 under protanopia, which would have made `defended` versus `unknown`, the one distinction that is the product, invisible to a protanopic reader. The state scale is an ordinal lightness ladder (dark oxblood, mid brass, lighter verdigris, palest chalk) because lightness survives every kind of colour-vision difference. All pairs clear ΔE 11.4 under CVD and 16.1 in normal vision. Chalk deliberately sits near the paper; its relief is ink borders, labels, and the concept-list table view. Every state must be distinguishable without relying on hue alone: pair colour with a fill pattern for `decayed` so the map survives greyscale and colour-vision differences. AA contrast throughout, 320px to 4K, keyboard navigable, `prefers-reduced-motion` respected.

Second view: the concept list, sorted by Gap descending, which is the "what should I actually study" screen.

**PNG export.** Composites at 1200x630 with the treemap, Vouched %, the Gap, and room for a wordmark. No account, no upload, no network call. The file is written locally and the path is printed.

---

## 11. Privacy and egress

The single most load-bearing section for a tool that reads every diff.

**What leaves the machine.** Redacted diffs and file excerpts go to Anthropic through the local `claude` binary, which is where they already go when the user builds. Package and service *names* go to the three keyless feeds in §8. Nothing else, ever.

**Redaction runs before every model call.** Not after, not optionally.

1. **Never-send list, not overridable by config:** `.env`, `.env.*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa*`, `*.keystore`, anything matching `*secret*` or `*credential*`.
2. `.vouchignore`, same syntax as `.gitignore`, unions with the above.
3. **Content scrub** over everything that survives: known key prefixes (`sk-`, `sk-ant-`, `ghp_`, `github_pat_`, `AKIA`, `AIza`, `xoxb-`), JWT shapes, PEM blocks, `postgres://` and similar credentialled URLs, and high-entropy strings over 32 characters. Replaced with `[REDACTED:<kind>]`.
4. If a hunk is more than 40% redacted, drop it rather than send a mangled fragment.

**Egress allowlist, enforced in code:** the local `claude` binary, `api.deps.dev`, `api.osv.dev`, `registry.npmjs.org`, `api.npmjs.org`. Any other outbound host is a bug and a failing test.

**Local only.** No account, no telemetry, no crash reporting, no hosted backend in Wave 1. `vouch purge` deletes the database and every cached artifact.

---

## 12. Failure modes to design against

| Risk | Mitigation |
|---|---|
| It becomes a chore and gets uninstalled | Rules 4, 5 and 6. Three-minute digest budget as a tested requirement |
| It becomes a scold | No streaks, no backlog, no down-only totals. Every number ships with a rep that addresses it |
| Grading is wrong and the user loses trust | `partial` and `ungraded` are first-class. A rep never promotes on a low-confidence grade, and the user can override a verdict, which logs `cause = 'manual'` |
| The graph churns on refactors and scores become noise | §3.1 identity rules. Unmatched renames create new nodes and retire old ones, never silent merges |
| Extraction cost surprises the user | `--max-budget-usd` on every call, a local cost meter in `vouch status` |
| Recognition items teach nothing | Distractors must come from the same repo and be plausible. Spot-checked in fixtures |
| Reps on trivial code | Weight and zones. Boilerplate is `outsourced` by default in onboarding |

---

## 13. Wave 2, specified only far enough to not paint us into a corner

- **Claude Code plugin**: bundles the `UserPromptSubmit` hook for real-time Hunch (§7.3, RESEARCH §7.1), a `SessionEnd` hook to close sessions precisely, and a monitor to surface the digest. Monitors are stdout-only with no two-way IPC, so all interaction stays in the CLI, the dashboard, or a slash command.
- **Provenance capture**: stated reasons recorded live from documented hook payloads. Never from transcripts.
- **VS Code and Cursor extension**: a thin client over the same daemon HTTP API. No new logic.
- **Bundle size**: the one Dossier field deferred for lack of a keyless source.
- **Skill decay curves** over the `node_states` audit trail, which is why that table is append-only from day one.

Out of scope entirely: team dashboards, hosted accounts, leaderboards, public profiles, and any form of blocking.
