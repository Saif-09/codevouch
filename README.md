# Vouch

Own what you shipped. Vouch watches the code, packages, and services that land in your repository (AI-written or not) and makes you demonstrably able to defend them: the approach, the logic, why each dependency is there, and what it costs you.

It never blocks anything. It is not a linter, a code reviewer, or a tool that explains your codebase to you. Every adjacent tool answers questions *for* you, which is precisely the condition under which the illusion of understanding survives. Vouch asks you to produce the answer, then shows you the gap between what you thought you knew and what you produced.

**[Usage guide](docs/USAGE.md)** starts here. Also: `docs/RESEARCH.md` (evidence base), `docs/VOUCH-TECH-SPEC.md` (architecture), `docs/WAVE-1-SPEC.md` (scope).

## Quick start

```sh
pnpm install && pnpm build
cd ~/your-repo
vouch init        # pick what you want to stay sharp at, about 90 seconds
vouch digest      # after a work session: 5 items, under 3 minutes
vouch unused      # packages nothing in your source imports
```

| Command | What it does |
|---|---|
| `vouch init` | Register a repo, choose keep-sharp zones, install the commit hook |
| `vouch digest` | End-of-session review, five items maximum |
| `vouch defend` | Reconstruct a change you shipped, then see the real brief |
| `vouch cards` | Free re-tests of what you already learned |
| `vouch unused` | Dependencies nothing imports |
| `vouch map` | Dashboard, or `--png` for the shareable image |
| `vouch trend` | Vouched % and the gap over time |
| `vouch status` | Where you stand |
| `vouch plugin` | Install real-time predictions into Claude Code |
| `vouch purge` | Delete everything, leave nothing behind |

## Unused dependencies

`vouch unused` lists packages nothing in your source imports. This was not in the spec: it fell out of Dossiers being grounded in real call sites, and the first run against a real repo surfaced one, so it is now explicit.

It rescans imports before every run, separates packages that legitimately have no import site (`@types/*`, eslint plugins, postcss, storybook) into their own list that never inflates the headline number, and ships a caveat, because zero imports is a question to answer rather than an instruction to delete.

Verified against a real Next.js app: 16 findings, 10.7 MB installed, independently confirmed 16 for 16 with zero false positives.

## Phase 3 (built)

- **Claude Code plugin** at `packages/plugin`. Run `vouch plugin` for install instructions.
- **Real-time Hunch**: before Claude answers a substantive question in a repo you are keeping sharp, it asks you to predict the shape of the answer first. You can always reply "skip".
- **Calibration**: the share of your predictions that matched, shown in `vouch status`.
- The hook **cannot block and cannot fail your session**: exit code 2 would erase the prompt you just typed, so it is never used, and every error path exits 0 with no output.
- Sampling and a cooldown keep it rare (1 in 3 substantive prompts, at most one every 45 minutes, tunable with `VOUCH_HUNCH_SAMPLE` and `VOUCH_HUNCH_COOLDOWN`, off entirely with `VOUCH_HUNCH=off`).
- A `SessionEnd` hook closes the Vouch session precisely, so the digest is ready when you next look.

How it works, since hooks cannot ask questions: a `UserPromptSubmit` hook is one-shot, JSON in and JSON out, so it can never hold a conversation. Instead it injects `additionalContext` asking **Claude** to run the prediction step, and Claude reports the exchange back through a bundled MCP tool. Nothing reads a transcript, ever.

## Phase 2 (built)

- **Spaced cards**: `vouch cards`. Recognition re-tests of things you already learned, with distractors drawn from your own repo (other packages' real roles, the brief's own rejected designs), so re-testing forever costs **zero AI calls**. A wrong card demotes the node, which is what makes decay real rather than cosmetic.
- **Decay**: `defended` fades to `decayed` after its window (90 days by default, per zone, halved for critical code). The sweep is lazy, evaluated whenever you look, because a local daemon that was switched off for a week would simply miss a timer.
- **Trends**: `vouch trend` rebuilds Vouched % from the append-only audit trail and shows the gap by week.
- **The score is winnable.** Passing a Defend rep now promotes the files that feature is made of, and concepts are excluded from Vouched % (they are study material, not units of ownership). Before this, artifacts sat in the denominator with no rep that could ever promote them, capping a large repo near 11%.
- **Schema migrations**, so an existing install survives an upgrade, and a **daemon version check**, so an old background process never keeps serving stale logic.

## Phase 1 (built)

- **Defend reps**: after you ship a change across a couple of files, Vouch asks you to reconstruct from memory what it does and what it assumes, then one recognition question about the real data flow, then reveals the withheld brief. `vouch defend`, or it appears as the last item in a digest.
- **Build briefs**, generated when a session closes and withheld until you attempt: the approach, load-bearing assumptions, the three places it breaks first, and the roads not taken.
- **Concept nodes** minted from each brief, so the graph holds techniques as well as files and packages.
- Recognition distractors are generated alongside the brief from the same diff, so a wrong option is plausible rather than absurd. Picking right can only pull a passing reconstruction down, never lift a failing one: choosing a sentence from four is weak evidence next to producing the answer yourself.

## Phase 0 (built)

- `vouch init`: keep-sharp zones proposed from what is actually in the repo, one keypress each, post-commit hook, first ingest of HEAD.
- Dossiers per dependency: real call sites, impact data from deps.dev, OSV, and the npm registry (all keyless), a curated service table (pricing at 10k users, failure modes, data egress), and one probe question you must answer to own it.
- The rep loop: rate your confidence 1 to 7, answer the probe, then the reveal with the delta. Withheld until you attempt: enforced in code and by test.
- The digest: five items max after a work session, regenerated from the graph, never a backlog.
- The map: a treemap of the repo, area by weight, colour by comprehension state, plus a 1200x630 PNG export. Local dashboard via `vouch map`.
- Two numbers: Vouched % and the Gap (confidence minus demonstrated, per zone).

## Layout

| Package | What |
|---|---|
| `packages/core` | Daemon, SQLite graph, git ingest, state machine, redaction, egress allowlist, extraction backends, dossiers, briefs, feature clustering, cards, decay, reps, scoring, map |
| `packages/cli` | The `vouch` binary: thin client over the daemon HTTP API |
| `packages/dashboard` | Next.js dashboard, also a thin client |
| `packages/plugin` | Claude Code plugin: the real-time Hunch hook, a SessionEnd hook, and the MCP tool Claude reports through |
| `packages/services` | Curated service-impact table, shared surface with launch-readiness |

## Privacy

Redaction runs before every model call: a non-overridable never-send list (`.env`, keys, PEM, anything matching secret/credential), `.vouchignore`, a content scrub for key shapes and high-entropy strings, and hunks over 40% redacted are dropped. Outbound network is allowlisted in code to `api.deps.dev`, `api.osv.dev`, `registry.npmjs.org`, `api.npmjs.org`; extraction goes through the local `claude` binary (haiku by default). `vouch purge` deletes everything.

## Dev

```
pnpm install
pnpm build          # core + services + cli
pnpm test           # 85 tests: state machine, redaction, egress, withholding, identity, scoring, defend
node packages/cli/dist/main.js --help
```

Extraction backend: `claude -p` with `--json-schema` and `--max-budget-usd` (default), or AI Gateway via `VOUCH_BACKEND=gateway` + `AI_GATEWAY_API_KEY`. Extraction model override: `VOUCH_EXTRACT_MODEL` (default `haiku`).
