# Vouch: Research

**Purpose:** establish, with citations, that the problem is real, that the chosen mechanics are the ones the evidence supports, and that the gap in the market is genuine. Every claim here is checked. Claims that did not survive checking were cut, not softened.

**Rev:** A. Researched 21 Aug 2026.

---

## 1. The single most useful finding

**The illusion of explanatory depth (IOED).** Rozenblit and Keil, *The misunderstood limits of folk science: an illusion of explanatory depth*, Cognitive Science 26 (2002) 521-562.

People rate their understanding of a mechanism at roughly 5 to 6 on a 7-point scale. They are then asked to write a detailed explanation of how it works. On re-rating afterwards, self-assessed understanding drops sharply, on the order of 1.5 to 2 points. The act of attempting the explanation is what reveals the gap.

Two details make this the load-bearing citation for Vouch rather than merely a supporting one:

1. **The drop is caused by attempted production, not by feedback.** Nobody tells the participant they were wrong. Being asked to explain is sufficient. This means Vouch does not need to grade well to work. The rep itself does the work, and the grade is secondary.
2. **The effect survives forewarning.** Participants explicitly warned in advance that they would have to explain still showed the drop, reduced but present. This defeats the strongest objection to the whole product: "if I know the quiz is coming, I will just prepare." The evidence says preparation does not close the gap, because the gap is not about anticipation, it is about the difference between recognition and production.

**Design consequence, and it changes the product.** Capture a self-rated confidence *before* every rep, then run the rep, then show the delta. The flagship screen in Vouch is not a score. It is the user's own IOED gap on their own code: "you rated your understanding of this checkout flow 6 out of 7. You could not say what happens when the webhook retries." That screen is the product.

---

## 2. Evidence that the problem exists

### 2.1 Confidence in the tool displaces thinking

Lee, Tankelevitch, Sarkar et al., *The Impact of Generative AI on Critical Thinking: Self-Reported Reductions in Cognitive Effort and Confidence Effects From a Survey of Knowledge Workers*, CHI 2025 (Microsoft Research and Carnegie Mellon). 319 knowledge workers, 936 real workplace uses of generative AI.

- Share of examples reporting less or much less effort: 72% for knowledge work, 79% comprehension, 76% synthesis, 55% evaluation.
- **The finding that matters: higher confidence in the AI correlates with less critical thinking, while higher confidence in one's own ability correlates with more.**

That second clause is the product thesis in one line. The lever is not guilt about AI use, it is rebuilding self-efficacy. It also explains why the sealed-envelope mechanic (record your own approach, compare, see how often yours was equivalent) is a genuine intervention and not a gimmick: it directly targets the variable the study identifies as protective.

### 2.2 Neural and recall effects, with honest caveats

Kosmyna et al., *Your Brain on ChatGPT: Accumulation of Cognitive Debt when Using an AI Assistant for Essay Writing Task*, arXiv:2506.08872.

- 54 participants across sessions 1 to 3, 18 in a fourth crossover session. Groups: LLM, search engine, brain-only, plus LLM-to-brain and brain-to-LLM crossovers.
- EEG: brain-only showed the strongest and most distributed connectivity, search engine moderate, LLM users the weakest.
- **LLM users struggled to accurately quote their own work.** This is the finding that transfers to code, and it is the closest published analogue to "I shipped this and cannot defend it."

**Caveats to state honestly wherever this is cited, including in any marketing copy.** It is a preprint and not peer reviewed. The sample is small. Lead author Nataliya Kosmyna has publicly pushed back on the popular reading, stating they did not find "brain rot." Vouch must not overclaim from this paper. Use it for the recall finding, not for neurological claims.

### 2.3 The artifact-level consequence

GitClear, *AI Copilot Code Quality: 2025 Data Suggests 4x Growth in Code Clones*. 211 million changed lines, 2020 to 2024, including repos at Google, Microsoft and Meta.

- Duplicated code blocks rose roughly eightfold in 2024.
- 2024 was the first year on record in which within-commit copy/paste exceeded moved (refactored) code.
- Code revised within two weeks of commit: 3.1% in 2020 to 5.7% in 2024.
- Moved lines, the signal of reuse and refactoring: roughly 25% of changed lines in 2021 to under 10% in 2024.

Refactoring is the activity that requires holding a system in your head. Its collapse is the closest available proxy for comprehension loss at scale. GitClear also published a 2026 follow-up, *The Maintainability Gap*, which returned HTTP 403 to automated fetching and should be read manually before any figure from it is quoted.

### 2.4 Hard data on what AI-authored commits actually introduce

Liu, Widyasari, Zhao, Irsan, Chen and Lo, *Debt Behind the AI Boom: A Large-Scale Empirical Study of AI-Generated Code in the Wild*, arXiv:2603.28592.

- 302.6K verified AI-authored commits across 6,299 GitHub repositories, across Copilot, Claude, Cursor, Gemini and Devin. Python, JavaScript, TypeScript production code.
- AI authorship identified from explicit git metadata: bot actor logins, author emails, author names, and `Co-authored-by` trailers.
- 484,366 distinct issues found: 89.3% code smells, 6.0% correctness, 4.7% security.
- More than 15% of commits from every assistant introduced at least one issue, from 17.4% (Copilot) to 29.1% (Gemini).
- **22.7% of tracked AI-introduced issues still survive at the latest version of the repository.**
- For correctness and security, AI introduces more than it fixes, roughly 1.5x more security issues introduced than fixed.

Two things Vouch takes from this paper. First, the survival rate is the honest case for the product: these are not transient, they persist because nobody understood them well enough to notice. Second, the AI-authorship detection method is directly reusable. Git metadata trailers give Vouch a defensible way to attribute authorship without needing editor integration, which is exactly what the editor-agnostic Wave 1 ingest requires.

---

## 3. Evidence for the mechanics

The mechanics are not invented. Each maps to an established effect.

| Mechanic | Effect it rests on | Source |
|---|---|---|
| Confidence rating before the rep, delta shown after | Illusion of explanatory depth | Rozenblit and Keil 2002 |
| Predict before reveal (Hunch) | Generation effect, one of the three canonical desirable difficulties | Bjork and Bjork 1994 |
| Reps instead of re-reading the brief | Testing effect and retrieval practice: retrieval produces more durable retention than restudy, while feeling less effective during practice | Roediger and Karpicke |
| Struggle first, brief second (withhold before reveal) | Productive failure: initial unsuccessful generation followed by structured guidance outperforms guidance first | Kapur, *Productive failure in learning from generation and invention activities*, Instructional Science (2012) |
| Spaced cards | Spacing, the third canonical desirable difficulty | Bjork and Bjork 1994 |

One caution worth recording, because it constrains the design. The desirable-difficulty literature has a documented boundary: for material with high element interactivity, added difficulty can become *undesirable* and impair learning (see the work on undesirable difficulty effects in high-element-interactivity material). A multi-file architectural change is high element interactivity. This is direct evidence for the friction controls already in the plan: one free-text answer per session, everything else recognition-based, and reps scoped to a declared keep-sharp zone. Making every rep a blank-page essay would not be a more rigorous version of Vouch, it would be a less effective one.

Retrieval practice also has null results in the literature under some conditions, including a recent failure to replicate the testing effect on an online participant pool. The effect is real and well replicated in general, but Vouch should measure its own outcomes rather than assume them, which is what the calibration score exists for.

---

## 4. What the evidence does and does not license

**Supported.**
- Developers systematically overestimate their understanding of mechanisms, and attempting explanation exposes it. Robust, 2002, replicated.
- Confidence in AI output correlates with reduced critical effort; confidence in self correlates with more. Survey, self-reported, CHI 2025.
- AI-authored commits introduce persistent defects at measurable rates. Large-scale, 2026.
- Predict-then-reveal, retrieval practice, spacing and productive failure improve retention relative to passive exposure. Decades of evidence.

**Not supported, do not claim.**
- That AI use causes measurable cognitive decline or brain damage. The MIT paper is a small preprint and its own lead author disclaims that reading.
- That Vouch will make anyone a better engineer. No study covers this intervention. The honest claim is narrower and still worth paying for: Vouch shows you which parts of your own codebase you cannot explain, and gives you reps that measurably close specific gaps.
- Any causal claim connecting GitClear's duplication figures to individual comprehension. It is a proxy, and should be labelled as one.

---

## 5. Competitive scan

### 5.1 The adjacent category does the opposite

DeepWiki, Sourcegraph, Greptile, Unblocked, Aider and Kilocode all target codebase comprehension, and all of them work by *explaining the code to you on demand*. Unblocked specifically answers "why was this built this way" by linking code to GitHub history, Slack and Jira. Greptile indexes a repo into a graph of files and functions.

This is the positioning gift. Every one of these tools deepens the dependency it claims to relieve: the answer arrives without you ever having to produce it, which by Rozenblit and Keil is precisely the condition under which the illusion of understanding survives intact. They optimise for time-to-answer. Vouch optimises for whether you can produce the answer yourself.

The graph-of-repo indexing work is also a reusable technique rather than a competitive moat, and Vouch needs a version of it to locate call sites.

### 5.2 Learning platforms

Exercism and CodeCrafters teach through exercises on *their* curriculum. Vouch's deck is the user's own repository, which is the entire difference: relevance is guaranteed and the reps defend real shipped code. No overlap in practice.

### 5.3 Team AI-metrics vendors

DX, Faros and Jellyfish measure AI adoption and throughput for engineering leaders. They report on organisations, not on whether a specific person can explain a specific hunk. Different buyer, different unit of analysis. This is where a Wave 3 team product would compete, and it is deliberately out of scope.

### 5.4 The closest thing found, and a naming collision

`vouch-cli` on npm, version 1.0.1, published 16 June 2026 by `nirajpankhania`, repository `github.com/nirajpankhania/vouch`, MIT licensed, 56 kB, roughly 7 downloads per week. Its description: "Intent-aware verification for AI-generated code. You tell it what you asked for; it tells you what you actually got." Dependencies include `@anthropic-ai/sdk`, `simple-git`, `ts-morph`, `parse-diff` and `zod`.

Assessment. It is a **different product**: it verifies that the AI did what you asked, an artifact check, with no comprehension, no state machine and no reps. It is not a competitor to the thesis. But it occupies the word in the same category, and **its `bin` is literally `vouch`**, so both cannot be installed side by side. Its usage is negligible, so the practical collision is near zero and the brand collision is real. See §8.

Its dependency list is also a useful confirmation that the technical approach is sane: `simple-git` plus `parse-diff` plus `ts-morph` is close to the ingest and call-site stack Vouch needs.

### 5.5 Verdict

Nothing found trains the human. The entire adjacent category is built on doing the understanding for you, and the one tool sharing the name checks the artifact rather than the person. The gap is real.

---

## 6. Data feeds for the Dossier

All verified 21 Aug 2026. Every one of these works without an API key, which is what keeps Vouch a local tool with no hosted backend.

### 6.1 deps.dev (Google Open Source Insights), API v3alpha

Ecosystems: npm, PyPI, Go, Maven, Cargo, RubyGems, NuGet. No authentication requirement and no rate limits documented, which means "unspecified", so Vouch must cache aggressively and back off politely rather than assume generosity.

| Endpoint | Gives the Dossier |
|---|---|
| `GetVersion` | Licenses, security advisories, links |
| `GetDependencies` | Resolved transitive dependency graph, so the real transitive count |
| `GetDependents` | How many packages depend on this, a popularity and blast-radius signal |
| `GetFindings` | Malware, deprecation, cooldown, vulnerabilities |
| `GetProject` | OpenSSF Scorecard results, OSS-Fuzz coverage: the maintenance-signal field |
| `GetVersionBatch`, `GetFindingsBatch`, `GetProjectBatch` | Up to 5,000 requests per call, so a whole lockfile resolves in one or two round trips |

### 6.2 OSV

`POST /v1/query` and `POST /v1/querybatch`, plus `GET /v1/vulns/{id}`. No API key, and the docs state there are currently no limits on the API. Response size limit of 32 MiB on HTTP/1.1, removed under HTTP/2, so **use HTTP/2 for batch queries**. Overlaps with deps.dev advisories; use OSV as the authoritative source and deps.dev for everything else.

### 6.3 npm registry directly

Verified working: `dist.unpackedSize` gives authoritative install size, and `https://api.npmjs.org/downloads/point/last-week/<pkg>` gives download volume with no key. Both were used to produce the figures in §5.4. `time.modified` gives the maintenance recency signal.

Note the distinction the Dossier must not blur: **unpacked size is install size, not bundle size.** Bundle impact for a browser target needs a bundler-aware source. Treat bundle size as a Wave 2 field rather than guessing, and label install size as install size.

### 6.4 Services, not packages

No registry exists for "you added Clerk and it costs this at 10k users." Service pricing, failure modes and data egress have to be a curated local table, seeded by hand for the providers that actually appear in AI-generated apps. This is the one Dossier field that cannot be automated, and it is also the highest-value one. It is shared surface with launch-readiness and should be extracted into one package used by both rather than written twice.

---

## 7. Claude Code integration surface

Verified against Claude Code **2.1.238** on 21 Aug 2026. This surface moves fast, so every payload shape must be re-verified against the installed version at implementation time. Nothing in Wave 1 depends on any of it.

### 7.1 The blocker, and the way around it

There are 30-plus documented hook events, including `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `Stop`, `PreToolUse`, `PostToolUse`, `PostToolBatch`, `PreCompact`, `Notification`, `SubagentStart` and `SubagentStop`. Vouch needs at most four.

**`UserPromptSubmit` cannot collect interactive input.** Hooks are strictly one-shot: JSON in, JSON out. A hook can block a prompt (exit code 2 erases it) or allow it while injecting `additionalContext`. It cannot print a question, wait for the user to type an answer, and then release the original prompt. Real-time Hunch as originally conceived is therefore not directly implementable.

**The workaround is better than the original design.** Do not fight the hook model. Have the hook allow the prompt and inject `additionalContext` that instructs Claude itself to run the Hunch: ask the user for a one-line prediction, wait for it, then answer, then name the delta. The interaction is delegated to the model, which is the one component in the loop that *can* hold a conversation. The hook stays one-shot, the user gets a real prediction step, and Vouch records the exchange through a companion tool call.

This also means Hunch degrades gracefully. Where the hook cannot run, the same rep works as a slash command the user invokes deliberately.

### 7.1a Validated live, and one documented field is wrong

The delegation works. Confirmed against Claude Code 2.1.238 on 22 Aug 2026: the hook injects, Claude asks for the prediction and waits, answers on the reply, then reports the exchange through the bundled MCP tool.

Two corrections to what the documentation says, both found only by running it:

1. **The prompt arrives as `prompt`, not `user_input`.** The published hooks reference lists `user_input`; the installed version sends `prompt`. Reading only the documented field means the hook silently never fires, because the text is always empty. Accept both.
2. **A plugin's MCP tools are namespaced `mcp__plugin_<plugin>_<server>__<tool>`.** For Vouch that is `mcp__plugin_vouch_vouch__vouch_record_hunch`, which is the string a user must allow. Without it Claude reports "it needs permission" and the exchange goes unrecorded.

Observed payload fields for `UserPromptSubmit`: `session_id`, `transcript_path`, `cwd`, `prompt_id`, `permission_mode`, `hook_event_name`, `prompt`.

### 7.2 Transcripts are not an integration point

Transcripts live at `~/.claude/projects/<project>/<session-id>.jsonl` and hooks receive a `transcript_path`. The documentation explicitly warns that the entry format is internal and changes between versions, and that scripts parsing it directly will break.

**Consequence, and it is a hard rule for the spec: Vouch must never depend on parsing transcript JSONL.** Provenance comes from git metadata plus data captured live through documented hook payloads. Retroactive transcript mining is forbidden, however tempting the "why did the AI add this package" field makes it.

### 7.3 Hook payloads do not contain diffs

`PostToolUse` on `Edit` and `Write` provides `file_path`, `tool_input.contents` for `Write` only, and a status. It does not provide old and new strings, line numbers, or a diff.

This validates the Wave 1 architecture rather than complicating it: **git is the diff source even when the plugin is installed.** The plugin adds provenance and timing, never the diff itself. The two ingest paths therefore share one diff pipeline.

### 7.4 Headless mode, verified against the installed CLI

| Flag | Status |
|---|---|
| `-p`, `--print` | Confirmed |
| `--output-format text\|json\|stream-json` | Confirmed, print-only |
| `--json-schema <schema>` | Confirmed. "JSON Schema for structured output validation", takes inline JSON. This is what makes schema-enforced extraction real rather than prompt-and-hope |
| `--append-system-prompt` | Confirmed |
| `--continue`, `--resume` | Confirmed |
| `--max-budget-usd <amount>` | Confirmed. A hard spend ceiling per invocation, which the extraction pipeline should set on every call |

The `json` output includes `session_id`, `usage` and `cost_usd`, so the daemon can keep a local extraction cost meter without instrumentation of its own.

### 7.5 The one unresolved question, and it gates distribution only

Rate limits for programmatic use are undocumented. Batch automation against a Pro or Max subscription is **not prohibited, but not explicitly permitted either**. No documented terms were found either way.

**Consequence for the spec: the extraction backend must be pluggable from the first commit.** `claude -p` is the default for personal use, which is what Wave 1 is. An API key path through AI Gateway must exist behind the same interface so that distributing Vouch to other people never depends on resolving someone else's subscription terms. This is one interface and two adapters, not a fork.

### 7.6 Plugins can host the daemon

A plugin can bundle skills, agents, hooks, MCP servers, LSP servers, and **monitors**, which are background processes declared in `monitors/monitors.json` whose stdout surfaces as Claude notifications. Monitors are output-only with no two-way IPC, so the Vouch daemon can be launched and can surface the digest through a monitor, while all real interaction goes through the CLI, the dashboard, or a slash command. Distribution is via marketplace, a skills directory, or CLI flags.

---

## 8. Naming

`vouch` is taken on npm by an unrelated and dormant 2022 JSON-schema package with zero weekly downloads. `vouch-cli` is taken by the adjacent AI-code-verification tool in §5.4, and it claims the `vouch` binary name.

Single-word npm availability was checked for: whetstone (taken, and by a Claude Code skills package), hunch, reckon, steelman, sinew, flint, anvil, grain, defend, custody, quorum, warrant, attest. All taken, nearly all by packages under 15 weekly downloads. `unvouched` is free.

**Decided 21 Aug 2026: the name is Vouch.** The npm package name is a soft constraint, since a scoped package or `vouch-app` solves it, and the binary stays `vouch`. The adjacency to a 7-downloads-per-week tool is an acceptable cost against a product vocabulary that already runs on the word: Vouched %, the Gap, unvouched code. The domain remains open and is not committed here.

---

## 9. Open questions

1. GitClear's 2026 *Maintainability Gap* report blocks automated fetching. Read manually before quoting any 2026 figure.
2. Whether `claude -p` batch use against a subscription is permitted for a distributed tool, as opposed to personal use. This is a licensing question, not a technical one, and it gates distribution rather than Saif's own use. Pending §7.
3. No study measures whether comprehension reps on your own codebase improve engineering outcomes. Vouch should instrument its own calibration data from day one so that this becomes answerable rather than assumed.
4. Bundle-size data source for the Dossier, deferred to Wave 2.

---

## Sources

- Rozenblit and Keil 2002, IOED: https://onlinelibrary.wiley.com/doi/10.1207/s15516709cog2605_1 and PDF at https://cogdevlab.yale.edu/sites/default/files/files/rozenblit%20&%20keil%20%202002.pdf
- Lee et al., CHI 2025, critical thinking: https://dl.acm.org/doi/10.1145/3706598.3713778
- Kosmyna et al., Your Brain on ChatGPT: https://arxiv.org/abs/2506.08872 and https://www.brainonllm.com/
- GitClear 2025 AI code quality: https://www.gitclear.com/ai_assistant_code_quality_2025_research
- GitClear 2026 Maintainability Gap: https://www.gitclear.com/the_ai_code_quality_maintainability_gap
- Debt Behind the AI Boom: https://arxiv.org/html/2603.28592v2
- Kapur, productive failure: https://link.springer.com/article/10.1007/s11251-012-9235-4
- Undesirable difficulty boundary condition: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6099118/
- Testing effect null result: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12894256/
- deps.dev API: https://docs.deps.dev/api/v3alpha/
- OSV API: https://google.github.io/osv.dev/api/
- Human-AI code comprehension survey: https://arxiv.org/html/2504.04553v2
