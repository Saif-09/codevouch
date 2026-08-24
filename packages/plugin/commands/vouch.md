---
description: Run vouch in this repo and act on what it says. No argument shows status and the next thing worth doing.
argument-hint: "[status | audit | unused | prompts | trend | zones]"
allowed-tools: Bash(vouch:*), Bash(npx -y codevouch:*), Read, Grep, Glob
---

Run vouch for the user, then act on the output. The requested subcommand is: `$ARGUMENTS`

## Which binary

Prefer `vouch` on PATH. If it is missing, use `npx -y codevouch@latest` instead and mention that once, at the end, not before running.

## What to run

**No argument** given: run `vouch status`.

**Safe to run here.** These print and exit:

`status` · `audit` · `unused` · `prompts` · `trend` · `zones` · `map --png <path>`

**Never run these.** They open an interactive rep, and vouch deliberately refuses them without a real terminal (`requireTty`), so running one here only prints "This command asks you questions, so it needs an interactive terminal":

`init` · `digest` · `dossier` · `defend` · `cards`

Say, in one line, that the command needs their own terminal, give them the exact line to paste, and stop. Do not try it "just to see".

**Two more that must never run here, for different reasons:** bare `map` starts a dev server that never exits, and `purge` deletes the whole vouch database (`--yes` skips its confirmation). Hand both to the user.

Anything else: pass it to `vouch` as typed.

## Reporting what happened

Report only what the command actually printed. Never invent a package name, a version, a severity or a count: if it is not in the output you just read, it did not happen. If the output says the repo is not initialised, tell the user to run `vouch init` in their terminal, because that one is interactive too.

## Then be useful, per subcommand

**audit** — Lead with what is actionable: vulnerable first, then deprecated, then unused weight. For anything vulnerable, look up what the fixed version is before proposing an upgrade rather than guessing at `@latest`. Offer the fix, do not apply it unasked.

**unused** — This is where you earn your keep. Vouch finds imports in source only, and says so: a package used from a config file, a build script, a bundler plugin or a dynamic import has no import site and shows up here as a false positive. Before you recommend removing anything, grep the whole repo for each name, config and scripts included, and split the list into "nothing anywhere, safe to drop" and "used here, keep it" with the file that proves it. A list you have verified is worth something; the raw list they can read themselves.

**prompts** — The command has already done the analysis. Do not re-explain every prompt. Surface the one habit worth changing and stop.

**status / trend / zones** — Two or three lines. Say which zone the gap is worst in and what the next command is. Do not narrate every number back to them.

## One thing to keep straight

`vouch prompts` reviews **the prompts the user typed in a Claude Code session**. It is not a request to explain vouch's own internal system prompts. If they want those, they will ask about the source.
