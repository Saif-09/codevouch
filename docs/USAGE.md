# Vouch: usage

## In one paragraph

You build with AI, it works, you move on. Later you cannot explain your own code: why that package is there, what happens when that call fails, what the thing you shipped actually assumes. Vouch finds those gaps by asking you questions about your own repository and showing you where your confidence ran ahead of what you could actually produce. It never blocks you and never stops you using AI.

Start with `vouch audit`. It takes about twenty seconds, needs no setup and no AI, and tells you which of your dependencies are vulnerable, deprecated, unmaintained or imported by nothing at all. Advisories are checked against the version in your lockfile, not the latest release, because that is the code you are actually running.

Vouch never runs on its own schedule. You call it, or it appears at the end of a work session. If you ignore it for a week, nothing breaks and nothing nags.

---

## 1. Install

```sh
npm install -g codevouch
vouch --version
```

Needs **Node 24 or newer**. Nothing compiles at install time: Vouch uses Node's built-in SQLite, so there is no C++ toolchain requirement.

For the AI parts (writing question cards and grading answers) Vouch shells out to your own `claude` CLI if you have Claude Code installed. If you do not, set an AI Gateway key instead:

```sh
export VOUCH_BACKEND=gateway
export AI_GATEWAY_API_KEY=...
```

Everything except question-writing and grading works with no AI at all, including `vouch unused`, the map, and cards.

---

## 2. Set up a repository

Run this inside any git repository you want to stay sharp on.

```sh
cd ~/code/your-project
vouch init
```

It scans the repo and proposes 8 to 12 areas drawn from what is actually there, one keypress each:

| Key | Meaning |
|---|---|
| `k` | **keep sharp.** Vouch will quiz you on this area. |
| `o` | **outsourced.** Vouch never asks about this again, and it never counts against you. |
| `s` | skip for now |
| `enter` | accept the suggested default |

**Be honest here, and lean toward `o`.** Nobody wants to stay sharp at everything, and an over-inclusive list is the fastest way to end up ignoring the tool. Auth, payments and data deletion default to keep-sharp and are marked critical. Styling, tests, config and generated code default to outsourced.

`vouch init` also installs a `post-commit` hook so Vouch notices your work. It is backgrounded and silenced, and it cannot slow down or fail a commit. `vouch purge` removes it.

Takes about 90 seconds on a large repo.

---

## 3. The daily loop

### After a work session

```sh
vouch digest
```

Up to five items, under three minutes. For each one: rate your confidence 1 to 7, answer a question, then see the real answer and the gap between them.

The first digest pauses for a minute or two while it writes question cards. It only does that once per item.

### The reps you will see

**Dossier** (one per dependency). Shows a package and the real places it appears in your code, then asks one question that needs actual understanding. The reveal includes install size, transitive dependency count, licence, known advisories, and for services, what it costs at 10k users and what happens when it goes down.

**Defend** (one per feature you shipped). Shows only the filenames and asks you to reconstruct, from memory, what the change does and what it assumes. Then one multiple-choice question about the real data flow. Then the withheld brief: the approach, the load-bearing assumptions, the three places it breaks first, and the designs that were rejected.

```sh
vouch defend      # run one on demand
```

**Cards** (re-tests). Free, no AI call, a few seconds each. These appear as knowledge ages, or after a rep leaves a gap.

```sh
vouch cards
```

### Anytime

```sh
vouch status              # where you stand, and the one useful next action
vouch map                 # the dashboard at localhost:4477
vouch map --png out.png   # the shareable 1200x630 image
vouch trend               # progress over weeks
vouch unused              # packages nothing imports
vouch zones               # review what you chose to keep sharp
```

---

## 4. Reading the numbers

**Vouched %** is the share of your in-zone code you have demonstrated you can defend. It starts at 0 and that is not an insult, it means nothing has been tested yet. Passing a Defend rep promotes the whole feature, so it moves in real jumps rather than by fractions.

**The Gap** is your confidence minus what you actually demonstrated, per area. Positive means overconfident. This is the number that matters: it is specific, personal, and hard to argue with. A gap of `+3.4` in dependencies means you consistently believe you understand your packages about three points better than you can show.

**Calibration** (needs the plugin) is the share of your predictions that matched.

Nothing here is a streak, and no total only goes down.

---

## 5. The colours on the map

Area is weight, critical code counts triple. Colour is state.

| | Meaning |
|---|---|
| dark red | nobody has asked you about this yet |
| brass | you have seen the explanation |
| verdigris | you demonstrated you can defend it |
| hatched | it faded: you knew it once and the window lapsed |
| pale | you chose to outsource it |

---

## 6. Real-time predictions in Claude Code

```sh
vouch plugin      # prints the install lines
```

With the plugin installed, when you ask Claude something substantive in a keep-sharp repo, it asks you to predict the shape of the answer before showing you. You can always reply "skip".

It fires on roughly one in three substantive prompts, at most once every 45 minutes.

```sh
VOUCH_HUNCH=off              # turn it off entirely
VOUCH_HUNCH_SAMPLE=6         # rarer: 1 in 6
VOUCH_HUNCH_COOLDOWN=120     # at most once every 2 hours
```

Allow the recorder once in `~/.claude/settings.json`, or Claude will ask permission each time:

```json
{ "permissions": { "allow": ["mcp__plugin_vouch_vouch__vouch_record_hunch"] } }
```

---

## 7. What leaves your machine

Redacted code excerpts go to Anthropic through your local `claude` CLI, which is where they already go when you build with it. Package **names** go to three public registries (deps.dev, OSV, npm) for licence and vulnerability data.

Nothing else. There is no Vouch server, no account, and no telemetry.

Before anything reaches the model, Vouch drops `.env` files, keys, certificates and anything matching `secret` or `credential`, then scrubs API-key shapes, JWTs, PEM blocks and credentialled URLs from what remains. A hunk more than 40% redacted is dropped rather than sent mangled. Add a `.vouchignore` (same syntax as `.gitignore`) for anything else you want excluded.

```sh
vouch purge      # delete everything, remove the git hooks, leave nothing behind
```

---

## 8. Cost

Vouch uses your `claude` CLI on the cheapest model for extraction. A dossier costs roughly $0.05 and is written once. Cards and the map cost nothing at all. `vouch status` shows the running total.

A realistic first month on one repo is a few dollars.

---

## 9. When something looks wrong

| Symptom | Cause |
|---|---|
| "This repo is not initialised yet" | Run `vouch init` in that directory. |
| "This repository has no commits yet" | Vouch reads your git history. Make one commit first. |
| A package you use is listed by `vouch unused` | Vouch finds imports in TS, JS and Python source. Anything used only from a config file, a CLI script or a bundler plugin has no import site. That list is a set of questions, not instructions. |
| The digest keeps offering the same kind of thing | It works through the highest-weight items first. Critical code comes first by design. |
| A grade seems unfair | `partial` and `ungraded` are normal. A shaky grade never promotes anything, and the reveal is still the point. |
