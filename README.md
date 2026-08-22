# Vouch

**You shipped it. Can you explain it?**

```sh
npm install -g codevouch
```

---

## The problem this solves

You asked AI for a feature. It worked. You merged it and moved on.

Three months later it breaks at 2am, and you are reading code with your name on the commit like a stranger wrote it. You do not know why that package is there. You do not know what happens when that call fails. You built it, and you cannot defend it.

That gap is invisible until it costs you: in an outage, in a code review, in an interview, or the moment someone asks "why did you do it this way?" and you realise you do not know.

Vouch makes the gap visible while it is still cheap to fix.

**It never blocks you and never stops you using AI.** It is not a linter or a code reviewer. Other tools explain your codebase *to* you, which feels like understanding and is not. Vouch asks *you* to produce the answer first, then shows you the difference.

---

## What you actually get

### 1. A twenty-second audit of everything you depend on

```sh
vouch audit
```

No setup, no AI, no account. It checks every direct dependency against the OSV advisory database **at the version in your lockfile**, not the latest published one, because a project pinned to a vulnerable release would otherwise be reported clean.

Real output from a production Next.js app:

```
92 direct dependencies, 518.0 MB installed

5 deprecated by their own authors
  @nextui-org/react, @storybook/testing-library, critters, ...

4 with no release in over two years
  8.9 years  slick-carousel
  6.1 years  platform

16 that nothing imports (101 MB)
  @prisma/client, react-icons, zod, next-themes, pg, ...

heaviest
  176.1 MB  next            +50 transitive
   84.2 MB  react-icons     (and nothing imports it)
```

On a repo with real problems it reads like this instead:

```
2 with known vulnerabilities
  CRITICAL  minimist  Prototype Pollution in minimist
      HIGH  lodash    Command Injection in lodash
```

Severity is quoted from the advisory database, never invented here. `vouch audit --png` writes a shareable card with the numbers and no package names or code.

### 2. Packages you are shipping for nothing

Run one command in any repo. No setup, no AI key, no account.

```sh
vouch unused
```

Real output from a production Next.js app:

```
16 dependencies nothing imports  (10.7 MB installed)
  unused? @prisma/client            8.0 MB
  unused? @growthbook/growthbook    2.7 MB
  unused? zod, react-icons, next-themes, pg, critters, ...
```

Every one verified by hand: no false positives. That is 10.7 MB of install weight, supply-chain surface, and dependency updates you were carrying for no reason.

### 3. How to have written better prompts

```sh
vouch prompts
```

Reads back the prompts you actually sent in a Claude Code session and tells you which ones should not have been needed. Real output:

```
6 prompts in that session

[2] correction  (this prompt should not have been needed)
  you sent: no i meant it should save to localStorage not the server
  The first prompt didn't specify the storage mechanism.
  instead: Incorporate into prompt [1]: 'save items to localStorage not the server'

[6] two asks in one
  you sent: now add a remove button and also refactor the store and update the docs
  Bundles three unrelated tasks: UI feature, architecture refactor, documentation.

3 of 6 prompts were avoidable
  roughly 8,515 tokens, about 47% of the session
```

Every rewrite is a prompt you could paste, using your own subject matter, not "be more specific".

The token figure is an **estimate and says so**: hooks do not report usage, so Vouch counts prompt length at four characters per token, assumes a fixed assistant turn, and charges each avoidable prompt the whole conversation up to that point, because every turn re-sends it. The count of avoidable round trips is the real measurement.

Needs the Claude Code plugin (`vouch plugin`), which records prompts through the documented hook. Vouch never reads your transcript files.

### 4. Questions about your own code that you cannot answer

After a work session:

```sh
vouch digest
```

It picks the important things that landed and asks you one real question each. You rate your confidence 1 to 7 first, so you find out where you were wrong about yourself:

```
zod
  where it lives in your code:
    src/api/env.ts:1  import { z } from 'zod';

How well do you understand what zod does here? [1..7]  6
> What happens at boot when an env var fails validation?
```

Answer it, and you get the real answer plus install size, licence, known vulnerabilities, and for paid services, what it costs at 10k users and what breaks when it goes down.

### 5. A check on features you shipped but cannot describe

```sh
vouch defend
```

It shows you only the filenames and asks you to reconstruct, from memory, what your change does and what it assumes. Then it reveals the brief it wrote when the code landed.

On a real wishlist feature, that brief surfaced things the author had not noticed:

```
where it breaks first
  SSR execution throws ReferenceError: window.localStorage in readLocal()
  Rapid add() calls create duplicates, no client-side dedup
  localStorage quota exceeded leaves the cache diverged from storage
```

Three real bugs, found by being asked to explain your own code.

### 6. One honest number

```
the gap: you rated 6/7, you demonstrated 4/7
```

**The Gap** is how far your confidence runs ahead of what you can actually produce, per area of your codebase. It is specific, personal, and very hard to argue with. Watching it shrink is the point of the whole tool.

---

## How you would actually use it

**Day one (20 seconds).** `vouch audit` in your main repo. You will find out what is vulnerable, what is abandoned, and what you are installing for no reason. That alone pays for the install.

**Day one, part two (90 seconds).** `vouch init`. It shows you areas of your code and you press one key each: keep sharp, or outsourced. Be honest and lean toward outsourced. Nobody needs to stay sharp on CSS scaffolding. Auth and payments are a different story.

**Every few days (3 minutes).** `vouch digest` after you finish work. Five questions, maximum. You will get some wrong. That is the entire value.

**Occasionally (seconds).** `vouch cards` re-tests things you learned weeks ago, free and instant. Knowledge you stop using visibly fades, so you can see it going.

**Before a review or an interview.** `vouch map` shows your whole repo coloured by what you can defend. The dark red is where you would struggle if someone asked.

---

## Who this is for

- You ship fast with AI and have a quiet suspicion you are getting worse
- You inherited a codebase, or you *are* the person who wrote it and it feels inherited
- You are going into interviews and want to know your real gaps, not your imagined ones
- You have to be on call for code you did not fully read

**Not for you if** you want a tool that reviews your code or explains it for you. That is the opposite of what this does.

---

## Everything else

| Command | What it does |
|---|---|
| `vouch audit` | Vulnerabilities, deprecated, stale, unused, heaviest, in one pass |
| `vouch prompts` | Review your prompts from a session, and how to send fewer |
| `vouch unused` | Just the packages nothing imports |
| `vouch init` | Set up a repo, choose what to stay sharp at |
| `vouch digest` | End-of-session review, five items maximum |
| `vouch defend` | Reconstruct a change you shipped, then see the real brief |
| `vouch cards` | Free re-tests of what you already learned |
| `vouch map` | Dashboard, or `--png` for a shareable image |
| `vouch trend` | Your progress over weeks |
| `vouch status` | Where you stand, and the one useful next thing |
| `vouch plugin` | Predictions inside Claude Code, before it answers |
| `vouch purge` | Delete everything, leave nothing behind |

Needs **Node 24+**. Nothing compiles at install.

The AI parts (writing questions, grading answers) use your own `claude` CLI if you have Claude Code, or an AI Gateway key. **`vouch unused`, the map, and cards need no AI at all.** Typical cost is a few dollars a month; `vouch status` shows the running total.

**Your code stays yours.** No account, no server, no telemetry. Redacted excerpts go to Anthropic through your own CLI; package names go to three public registries for licence and vulnerability data. `.env` files, keys and certificates are never sent, and the outbound host list is enforced in code. `vouch purge` leaves nothing behind.

**[Full usage guide](docs/USAGE.md)**

---

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
