# Wave 1: Build Spec

**Product:** Vouch, a local tool that makes you demonstrably able to defend what AI put in your repo. Name settled; the npm publish name and domain are not (RESEARCH §8).
**Scope:** CLI, daemon, graph, Dossier, Defend, digest, cards, map. All local, all editor-agnostic.
**Audience:** solo developers shipping with AI.
**Rev:** A. Source of truth for architecture is `docs/VOUCH-TECH-SPEC.md`. Source of truth for every factual claim is `docs/RESEARCH.md`.

---

## 0. Why this scope and nothing else

Wave 1 ships only what runs off **git plus three keyless APIs plus one batched model call**. No editor integration, no hosted backend, no account, no plugin. Everything that needs the Claude Code hook surface waits for Wave 2, because RESEARCH §7 established that the one thing hooks cannot do is collect interactive input, and the one thing hook payloads do not contain is a diff. Neither limitation affects Wave 1, which is the point of ordering it this way.

Every Wave 1 feature must satisfy three tests:

1. **It produces the IOED moment.** Confidence stated, attempt made, gap shown. A feature that skips any of the three is decoration.
2. **It survives the user not caring today.** Nothing blocks, nothing nags, nothing accumulates a visible backlog.
3. **It works with any AI tool**, or none. If it needs Claude Code installed, it is Wave 2.

If a proposed feature fails any of the three, it belongs in Wave 2.

---

## 1. Onboarding, which is the whole retention problem

Keep-sharp zones gate everything (tech spec rule 4), so the setup that declares them is the highest-stakes minute in the product. It must take about a minute and must not present a blank page.

```
vouch init
   │
   ├─ 1. detect         scan the repo: stack, lockfiles, directory roles, detected topics
   ├─ 2. propose        8 to 12 candidate zones, derived from what is actually there
   ├─ 3. sort           one keypress each: keep sharp  /  outsourced  /  skip
   └─ 4. install        post-commit hook, ~/.vouch, first ingest of HEAD
```

Proposed zones come from real evidence in the repo, never a generic checklist: detected auth code, data modelling and migrations, payment or billing paths, state management, build and config, styling, generated code, tests, infrastructure. Each candidate shows the file count and one example path so the choice is concrete.

**Defaults that must be right, because most users will accept them:**

- Generated code, lockfiles, build config, styling scaffolding: **outsourced**.
- Auth, payments, data deletion, secrets handling, external egress: **keep sharp** and marked `critical`.
- Everything else: **keep sharp** only if the user says so. Silence means out of scope, not in.

Erring toward outsourced is deliberate. An over-inclusive zone list is the fastest route to uninstallation, and zones can be added later from the map, which is where the user will actually feel the absence.

---

## 2. CLI surface

The only interface in Phase 0. Every command is also a daemon API route, since the dashboard and the later extension are thin clients over the same routes.

| Command | Does |
|---|---|
| `vouch init` | §1. Idempotent, safe to re-run |
| `vouch status` | Vouched %, the Gap per zone, pending reps, extraction cost to date |
| `vouch digest` | The end-of-session review, max 5 items (§3) |
| `vouch dossier [pkg]` | The next pending Dossier, or a named one on demand |
| `vouch defend [feature]` | The next pending Defend session |
| `vouch cards` | Due spaced cards |
| `vouch hunch` | A deliberate predict-then-reveal on a past decision |
| `vouch map [--png <path>]` | Opens the dashboard, or writes the PNG and prints the path |
| `vouch zones` | Review and edit keep-sharp zones |
| `vouch session start\|end` | Explicit boundaries when the git hook is not enough |
| `vouch purge` | Deletes the database and every cached artifact. Requires confirmation |

`vouch` with no arguments prints status and the single most useful next action, never a menu.

---

## 3. The digest

Fires when a session closes. Delivered by the CLI in Phase 0, and by the dashboard and a plugin monitor later. **It is a notification the user opts into reading, never an interruption.**

- **Five items maximum**, selected by weight then recency. `critical` nodes first.
- **Ordering within the digest:** Dossiers before Defend sessions, because they are cheaper and build momentum.
- Each item: confidence rating, the attempt, the reveal, the named gap.
- **Un-actioned items are not carried forward as a queue.** They age per the decay window and colour the map. The digest is always regenerated from the current graph, never from a backlog table.
- Target: a full digest for a normal working day completes in **under three minutes**, and that is a tested requirement, not an aspiration.

The end-of-day framing matters. Not "you have 5 tasks", but "here is what landed today, and here is what you could not explain about it."

---

## 4. The map

Full design in tech spec §10. What Wave 1 must get right:

- Treemap of the repo, area by weight, colour by state, with the editorial palette in tech spec §10. No saturated blue, purple, green, orange or neon anywhere.
- State must be readable without hue alone. `decayed` carries a fill pattern so the map survives greyscale and colour-vision differences.
- The second view, **concepts sorted by Gap descending**, is the "what should I actually study" screen and is not optional.
- PNG export at 1200x630 with the treemap, Vouched %, the Gap and room for a wordmark. Written locally, no network call, path printed.
- Load the `dataviz` skill before building the map and validate the palette against it.

The map is the artifact a user would screenshot, so it is the one screen where visual investment is justified. Everything else in Wave 1 can be plain.

---

## 5. Phase map

| Phase | Scope | Why this order |
|---|---|---|
| **0** | CLI, daemon, SQLite graph, git ingest, `init` onboarding, **Dossier end to end**, digest, map, PNG export | Proves ingest to node to rep to state to map on the one rep type whose value does not depend on extraction quality. Dependency nodes come straight from the lockfile, so the loop is testable before a single model call works well |
| **1** | Withheld build brief, Defend session, recognition-item generation (**built**) | The heart of the product and the heaviest extraction work. Needs Phase 0's graph to exist |
| **2** | Spaced cards, decay, the Gap over time (**built**) | Retention layer. Untestable without a populated graph and real state history |
| **3** | Claude Code plugin, real-time Hunch (**built**); VS Code and Cursor extension (deferred) | Gated on RESEARCH §7. The `additionalContext` delegation was validated against a live session and works. The editor extension is deferred: it is a thin client over routes the dashboard already exposes, so it adds packaging surface rather than capability |

---

## 6. Definition of done for Wave 1

Numbered so it can be checked rather than felt.

1. `vouch init` on a cold repo completes in under 90 seconds including the first ingest, and proposes zones drawn from the repo's real contents.
2. Run against real local repositories as the first fixtures, including at least one large production app. Every direct dependency in each lockfile either produces a Dossier or is explicitly classified out of zone. No silent omissions.
3. **Call-site accuracy.** For a fixture repo with a hand-labelled dependency set, reported call sites match the labels. Zero invented call sites: an assertion, not a hope.
4. **Withholding is enforced in code.** An automated test proves no brief body, `probe_expected`, or reveal payload is ever serialized to a client before `reps.answered_at` is set. Same enforcement posture as launch-readiness uses for its free-versus-gated split.
5. **Redaction.** A test asserting a diff containing an API key, a `.env` file, a PEM block and a credentialled database URL never reaches the extraction backend. The never-send list is not overridable by config.
6. **Egress.** A test asserting the only outbound hosts are `api.deps.dev`, `api.osv.dev`, `registry.npmjs.org`, `api.npmjs.org` and the local `claude` binary. Any other host fails the build.
7. **State machine.** Every transition in tech spec §4 unit tested, including: demotion is one step, decay touches only `alive = 1` and `in_zone = 1` nodes, only `defended` decays, and every transition writes a `node_states` row.
8. **Identity stability.** A fixture exercising a file rename and a symbol rename asserts nodes are re-keyed rather than duplicated, and that unmatched renames retire the old node instead of merging.
9. **Every rep captures `confidence_before` and `confidence_after`**, and the reveal screen shows the delta. A rep without the rating is a failing test.
10. **Three-minute digest.** A scripted run over a realistic day's diff on a fixture repo completes in under three minutes of interaction.
11. **Extraction is resilient.** With the backend forced to fail, ingest still completes, Dossiers still generate from the keyless feeds, and nothing crashes or blocks.
12. **Cost.** `--max-budget-usd` set on every extraction call; `vouch status` reports cumulative cost; a full session on a large repo stays under a stated ceiling.
13. Map renders and exports to PNG with no account, reads correctly from 320px to 4K, AA contrast, keyboard navigable, `prefers-reduced-motion` respected.
14. `vouch purge` leaves nothing behind, verified by test.

---

## 7. Out of scope for Wave 1, restated

No blocking of anything. No hosted backend, account, leaderboard, public profile or streak. No team or manager dashboard. No editor extension. No transcript parsing under any circumstance. No bundle-size field. No overlap creep into launch-readiness: that product audits the artifact, Vouch trains the human, and the shared service-impact table belongs in one package consumed by both.
