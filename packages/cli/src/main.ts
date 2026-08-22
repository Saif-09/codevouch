#!/usr/bin/env -S node --no-warnings
import './quiet.js';
import { Command } from 'commander';
import { basename, resolve } from 'node:path';
import { existsSync, rmSync, readFileSync } from 'node:fs';
import { api } from './client.js';
import { keypress, confidence, textInput, paint, hr } from './ui.js';
import { runRep, runCard } from './rep-runner.js';
import { installPostCommitHook, removePostCommitHook } from './hook.js';
import { vouchHome, daemonInfoPath, dbPath } from '@vouch/core';

function pkgVersion(): string {
  try {
    const url = new URL('../package.json', import.meta.url);
    return JSON.parse(readFileSync(url, 'utf8')).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const program = new Command();

function bar(value: number, max: number, width = 24): string {
  const filled = Math.round((Math.max(0, Math.min(value, max)) / max) * width);
  return `${'#'.repeat(filled)}${'.'.repeat(width - filled)}`;
}
const root = () => resolve(process.cwd());

/**
 * Reps need a real terminal. Check BEFORE generating cards so a scripted or
 * piped run never spends an extraction call it cannot use.
 */
function requireTty(): void {
  if (!process.stdin.isTTY) {
    console.error(paint.warn('This command asks you questions, so it needs an interactive terminal.'));
    console.error(paint.dim('Run it directly in your shell rather than from a script or a pipe.'));
    process.exit(1);
  }
}

program
  .name('vouch')
  .description('Own what you shipped. Vouch shows you which parts of your own codebase you can actually defend.')
  .version(pkgVersion());

// `vouch` with no arguments: status plus the single most useful next action.
program.action(async () => {
  await printStatus();
});

async function printStatus(): Promise<void> {
  let s: any;
  try {
    s = await api('GET', `/status?root=${encodeURIComponent(root())}`);
  } catch (e: any) {
    console.log(paint.dim(e.message.includes('not registered') ? 'This repo is not initialised. Run: vouch init' : e.message));
    return;
  }
  hr();
  console.log(`${paint.title(s.repo)}   vouched ${s.vouchedPct === null ? 'n/a' : `${Math.floor(s.vouchedPct)}%`}`);
  if (s.gapPerZone.length > 0) {
    console.log(paint.dim('the gap (confidence minus demonstrated, per zone):'));
    for (const z of s.gapPerZone) {
      const sign = z.gap > 0 ? '+' : '';
      const painted = z.gap > 1 ? paint.bad : z.gap < -0.5 ? paint.good : paint.warn;
      console.log(`  ${painted(`${sign}${z.gap.toFixed(1)}`)}  ${z.zoneName} ${paint.dim(`(${z.reps} reps)`)}`);
    }
  }
  if (s.calibration !== null && s.calibration !== undefined) {
    console.log(paint.dim(`calibration: ${Math.round(s.calibration)}% of your predictions matched`));
  }
  if (s.decayedNow > 0) {
    console.log(paint.warn(`${s.decayedNow} thing${s.decayedNow === 1 ? '' : 's'} faded since you last looked.`));
  }
  const cost = s.extraction;
  console.log(paint.dim(`extraction: ${cost.calls} calls, $${cost.totalUsd.toFixed(2)}${cost.failures ? `, ${cost.failures} failed` : ''}`));
  if (s.dueCards > 0) {
    console.log(`\n${paint.em('next')}: vouch cards ${paint.dim(`(${s.dueCards} due, free, about a minute)`)}`);
  } else if (s.pendingDigestItems > 0) {
    console.log(`\n${paint.em('next')}: vouch digest ${paint.dim(`(${s.pendingDigestItems} items, under 3 minutes)`)}`);
  } else {
    console.log(`\n${paint.dim('nothing pending. build something.')}`);
  }
}

program
  .command('init')
  .description('Register this repo, sort keep-sharp zones, install the post-commit hook, run the first ingest.')
  .action(async () => {
    requireTty();
    const t0 = Date.now();
    if (!existsSync(resolve(root(), '.git'))) {
      console.error('not a git repository');
      process.exit(1);
    }
    const repo = await api('POST', '/repos', { root: root(), name: basename(root()) });

    const existing = await api('GET', `/zones?root=${encodeURIComponent(root())}`);
    if (existing.length === 0) {
      console.log(paint.title('\nKeep-sharp zones'));
      console.log(paint.dim('What do you want to stay good at? Vouch only ever quizzes inside these.'));
      console.log(paint.dim('k = keep sharp   o = outsourced (no reps, ever)   s = skip\n'));

      const candidates = await api('POST', '/zones/propose', { root: root() });
      for (const c of candidates) {
        const marker = c.critical ? paint.bad(' critical') : '';
        const def = c.defaultStance === 'keep_sharp' ? 'k' : 'o';
        process.stdout.write(
          `${paint.title(c.name)}${marker}  ${paint.dim(`${c.fileCount} files, e.g. ${c.example}`)}\n  [k/o/s, enter=${def}] `,
        );
        const ch = await keypress(['k', 'o', 's', 'return', '\r']);
        const choice = ch === 'return' || ch === '\r' ? def : ch;
        process.stdout.write(`${choice}\n`);
        if (choice === 's') continue;
        await api('POST', '/zones', {
          root: root(), kind: c.kind, pattern: c.pattern, name: c.name,
          stance: choice === 'k' ? 'keep_sharp' : 'outsourced', critical: c.critical,
        });
      }
      // dependency stances: runtime in, dev out — the defaults most users should accept
      await api('POST', '/zones', { root: root(), kind: 'dependency_class', pattern: 'runtime', name: 'dependencies', stance: 'keep_sharp', critical: false });
      await api('POST', '/zones', { root: root(), kind: 'dependency_class', pattern: 'dev', name: 'dev dependencies', stance: 'outsourced', critical: false });
    }

    installPostCommitHook(root());
    process.stdout.write(paint.dim('first ingest... '));
    const bf = await api('POST', '/ingest/backfill', { root: root() });
    console.log(paint.dim(`${bf.deps} dependencies, ${bf.artifacts} artifacts, ${((Date.now() - t0) / 1000).toFixed(1)}s`));
    console.log(`\n${paint.good('vouch is watching this repo.')} Next: ${paint.em('vouch digest')} after your next work session, or ${paint.em('vouch dossier')} now.`);
  });

program
  .command('status')
  .description('Vouched %, the gap per zone, pending reps, extraction cost.')
  .action(printStatus);

program
  .command('digest')
  .description('The end-of-session review: five items, under three minutes.')
  .action(async () => {
    requireTty();
    await api('POST', '/briefs/generate', { root: root() }).catch(() => null);
    const items = await api('GET', `/digest?root=${encodeURIComponent(root())}`);
    if (items.length === 0) {
      console.log(paint.dim('nothing to review. the map is the long view: vouch map'));
      return;
    }
    process.stdout.write(paint.dim(`writing question cards for ${items.length} item${items.length > 1 ? 's' : ''}... `));
    await api('POST', '/dossiers/generate', { root: root(), nodeIds: items.map((i: any) => i.nodeId) }).catch(() => null);
    console.log(paint.dim('ready.'));
    console.log(paint.title(`\nHere is what landed, and what you could not explain about it. ${items.length} item${items.length > 1 ? 's' : ''}.`));
    let done = 0;
    for (const item of items) {
      if (await runRep(item.nodeId)) done++;
    }
    hr();
    console.log(paint.good(`${done}/${items.length} reps done.`));
    await printStatus();
  });

program
  .command('dossier [pkg]')
  .description('Run the next pending dependency dossier, or a named one.')
  .action(async (pkg?: string) => {
    requireTty();
    let nodeId: string;
    if (pkg) {
      const nodes = await api('GET', `/nodes?root=${encodeURIComponent(root())}`);
      const node = nodes.find((n: any) => n.kind === 'dependency' && n.label === pkg);
      if (!node) {
        console.error(`no dependency named ${pkg}`);
        process.exit(1);
      }
      nodeId = node.id;
    } else {
      const items = await api('GET', `/digest?root=${encodeURIComponent(root())}`);
      const dep = items.find((i: any) => i.kind === 'dependency');
      if (!dep) {
        console.log(paint.dim('no pending dossiers.'));
        return;
      }
      nodeId = dep.nodeId;
    }
    await api('POST', '/dossiers/generate', { root: root(), nodeIds: [nodeId] }).catch(() => null);
    await runRep(nodeId);
  });

program
  .command('audit')
  .description('Everything Vouch knows about your dependencies: vulnerabilities, deprecated, stale, unused, heaviest.')
  .option('--png <path>', 'also write a shareable card')
  .action(async (opts: { png?: string }) => {
    process.stdout.write(paint.dim('checking every dependency against the advisory databases... '));
    const r = await api('POST', '/audit', { root: root() });
    console.log(paint.dim('done.\n'));

    const mb = (b: number) => `${(b / 1048576).toFixed(1)} MB`;
    const sev = (s: string) =>
      s === 'CRITICAL' || s === 'HIGH' ? paint.bad(s) : s === 'MODERATE' ? paint.warn(s) : paint.dim(s);

    console.log(paint.title(`${r.repo}: ${r.scanned} direct dependencies, ${mb(r.totalInstallBytes)} installed`));

    if (r.vulnerable.length > 0) {
      console.log(`\n${paint.bad(`${r.vulnerable.length} with known vulnerabilities`)}`);
      for (const f of r.vulnerable.slice(0, 8)) {
        for (const a of f.advisories.slice(0, 2)) {
          console.log(`  ${sev(a.severity)}  ${f.name}  ${paint.dim(a.summary.slice(0, 72))}`);
        }
      }
    }
    if (r.deprecated.length > 0) {
      console.log(`\n${paint.bad(`${r.deprecated.length} deprecated by their own authors`)}`);
      console.log(paint.dim(`  ${r.deprecated.map((f: any) => f.name).join(', ')}`));
    }
    if (r.stale.length > 0) {
      console.log(`\n${paint.warn(`${r.stale.length} with no release in over two years`)}`);
      for (const f of r.stale.slice(0, 6)) {
        console.log(`  ${paint.dim(`${f.yearsSincePublish.toFixed(1)} years`)}  ${f.name}`);
      }
      console.log(paint.dim('  (a fact, not a verdict: plenty of good packages are simply finished)'));
    }
    if (r.unused.length > 0) {
      console.log(`\n${paint.warn(`${r.unused.length} that nothing imports`)} ${paint.dim(`(${mb(r.unusedInstallBytes)})`)}`);
      console.log(paint.dim(`  ${r.unused.map((f: any) => f.name).join(', ')}`));
    }
    if (r.heaviest.length > 0) {
      console.log(`\n${paint.em('heaviest')}`);
      for (const f of r.heaviest) {
        console.log(`  ${mb(f.installSizeBytes).padStart(8)}  ${f.name}${f.transitiveCount ? paint.dim(` +${f.transitiveCount} transitive`) : ''}`);
      }
    }
    const clean = r.vulnerable.length === 0 && r.deprecated.length === 0 && r.unused.length === 0;
    if (clean) console.log(`\n${paint.good('nothing vulnerable, deprecated or unimported. Genuinely clean.')}`);
    for (const n of r.notes) console.log(`\n${paint.dim(n)}`);
    console.log(paint.dim(`\nChecked ${r.versionPinned}/${r.scanned} against the version in your lockfile${r.versionPinned < r.scanned ? ', the rest against the latest published version' : ''}.`));
    console.log(paint.dim('Sources: OSV advisory database, deps.dev, the npm registry. No AI, nothing sent anywhere.'));

    if (opts.png) {
      const out = resolve(opts.png);
      const res = await api('GET', `/audit/png?root=${encodeURIComponent(root())}&out=${encodeURIComponent(out)}`);
      console.log(`\n${res.written ?? paint.warn(res.fallback)}`);
    }
  });

program
  .command('unused')
  .description('Dependencies nothing in your source imports.')
  .action(async () => {
    process.stdout.write(paint.dim('scanning imports and sizes... '));
    await api('POST', '/callsites/rescan', { root: root() }).catch(() => null);
    // without fresh impact data the megabyte total silently under-reports,
    // because only packages that had a Dossier carry an install size
    await api('POST', '/audit', { root: root() }).catch(() => null);
    console.log(paint.dim('done.'));
    const r = await api('GET', `/unused?root=${encodeURIComponent(root())}`);
    const mb = (b: number) => `${(b / 1048576).toFixed(1)} MB`;
    if (r.likelyUnused.length === 0 && r.configOnly.length === 0) {
      console.log(paint.dim(`every one of the ${r.scanned} dependencies is imported somewhere.`));
      return;
    }
    if (r.likelyUnused.length > 0) {
      console.log(paint.title(`${r.likelyUnused.length} dependencies nothing imports`) +
        paint.dim(`  (${mb(r.bytesLikelyUnused)} installed)`));
      for (const f of r.likelyUnused) {
        const size = f.installSizeBytes ? paint.dim(` ${mb(f.installSizeBytes)}`) : '';
        console.log(`  ${paint.bad('unused?')} ${f.name}${size}`);
        if (f.ifItVanished) console.log(paint.dim(`      ${f.ifItVanished.slice(0, 110)}`));
      }
    }
    if (r.configOnly.length > 0) {
      console.log(`\n${paint.dim(`${r.configOnly.length} more have no import site, but that is normal for what they are:`)}`);
      console.log(paint.dim(`  ${r.configOnly.map((f: any) => f.name).join(', ')}`));
    }
    console.log(`\n${paint.dim(r.caveat)}`);
  });

program
  .command('plugin')
  .description('Print how to install the Claude Code plugin for real-time predictions.')
  .action(async () => {
    const { fileURLToPath } = await import('node:url');
    const here = fileURLToPath(new URL('.', import.meta.url));
    const dir = resolve(here, '..', '..', 'plugin');
    console.log(paint.title('Vouch for Claude Code'));
    console.log(paint.dim('Before Claude answers, it asks you to guess the shape of the answer first.'));
    console.log(`\n${paint.em('try it for one session')}`);
    console.log(`  claude --plugin-dir ${dir}`);
    console.log(`\n${paint.em('or install it permanently')}`);
    console.log(`  mkdir -p ~/.claude/skills && ln -s ${dir} ~/.claude/skills/vouch`);
    console.log(`\n${paint.em('allow the recorder once')} ${paint.dim('(otherwise Claude asks every time)')}`);
    console.log('  add to ~/.claude/settings.json under permissions.allow:');
    console.log(paint.dim('    "mcp__plugin_vouch_vouch__vouch_record_hunch"'));
    console.log(`\n${paint.dim('tuning: VOUCH_HUNCH=off disables it, VOUCH_HUNCH_COOLDOWN (minutes, default 45), VOUCH_HUNCH_SAMPLE (1 in N, default 3)')}`);
  });

program
  .command('cards')
  .description('Re-test what you already learned. Free, no AI call.')
  .action(async () => {
    requireTty();
    const cards = await api('GET', `/cards?root=${encodeURIComponent(root())}`);
    if (cards.length === 0) {
      console.log(paint.dim('nothing due. cards appear as knowledge ages, or after a rep leaves a gap.'));
      return;
    }
    console.log(paint.title(`\n${cards.length} due.`));
    for (const card of cards) await runCard(card);
    hr();
    await printStatus();
  });

program
  .command('trend')
  .description('Vouched % and the gap over time.')
  .action(async () => {
    const t = await api('GET', `/trend?root=${encodeURIComponent(root())}`);
    if (t.vouched.length === 0 && t.gap.length === 0) {
      console.log(paint.dim('no history yet. run a digest first.'));
      return;
    }
    if (t.vouched.length > 0) {
      console.log(paint.title('vouched % over time'));
      for (const p of t.vouched) console.log(`  ${p.date}  ${bar(p.vouched, 100)} ${p.vouched.toFixed(0)}%`);
    }
    if (t.gap.length > 0) {
      console.log(paint.title('\nthe gap, by week (lower is better calibrated)'));
      for (const p of t.gap) {
        const sign = p.gap > 0 ? '+' : '';
        console.log(`  ${p.week}  ${sign}${p.gap.toFixed(1)}  ${paint.dim(`(${p.reps} reps)`)}`);
      }
    }
  });

program
  .command('defend')
  .description('Reconstruct something you shipped, then see the real brief.')
  .action(async () => {
    requireTty();
    process.stdout.write(paint.dim('looking for recent work... '));
    await api('POST', '/briefs/generate', { root: root() }).catch(() => null);
    console.log(paint.dim('ready.'));
    const items = await api('GET', `/digest?root=${encodeURIComponent(root())}`);
    const feature = items.find((i: any) => i.kind === 'decision');
    if (!feature) {
      console.log(paint.dim('nothing to defend yet. Ship a change across a couple of files, then close the session with: vouch session end'));
      return;
    }
    await runRep(feature.nodeId);
  });

program
  .command('map')
  .description('Open the dashboard, or export the share PNG.')
  .option('--png <path>', 'write the 1200x630 PNG and print the path')
  .action(async (opts: { png?: string }) => {
    if (opts.png) {
      const out = resolve(opts.png);
      const r = await api('GET', `/map/png?root=${encodeURIComponent(root())}&out=${encodeURIComponent(out)}`);
      console.log(r.written ?? paint.warn(r.fallback));
      return;
    }
    const { spawn } = await import('node:child_process');
    const dashDir = new URL('../../dashboard', import.meta.url).pathname;
    console.log(paint.dim('starting dashboard on http://localhost:4477 ...'));
    const child = spawn('npx', ['next', 'dev', '-p', '4477'], {
      cwd: dashDir,
      stdio: 'inherit',
      env: { ...process.env, VOUCH_REPO_ROOT: root() },
    });
    child.on('exit', (code) => process.exit(code ?? 0));
  });

program
  .command('zones')
  .description('List keep-sharp zones.')
  .action(async () => {
    const zones = await api('GET', `/zones?root=${encodeURIComponent(root())}`);
    for (const z of zones) {
      const stance = z.stance === 'keep_sharp' ? paint.good('keep sharp') : paint.dim('outsourced');
      console.log(`${stance}  ${z.name}${z.critical ? paint.bad(' critical') : ''} ${paint.dim(`(${z.kind}: ${z.pattern.slice(0, 60)})`)}`);
    }
  });

const session = program.command('session').description('Explicit session boundaries.');
session.command('start').action(async () => {
  await api('POST', '/session/start', { root: root() });
  console.log('session started');
});
session.command('end').action(async () => {
  const r = await api('POST', '/session/end', { root: root() });
  console.log(r.closed ? `session closed. Next: ${paint.em('vouch digest')}` : 'no work in this session');
});
session.command('tick').action(async () => {
  await api('POST', '/session/tick', { root: root() }).catch(() => null); // silent: runs from the git hook
});

program
  .command('purge')
  .description('Delete the vouch database and every cached artifact. Asks first.')
  .option('--yes', 'skip the confirmation prompt')
  .action(async (opts: { yes?: boolean }) => {
    const home = vouchHome();
    if (!opts.yes) {
      requireTty();
      process.stdout.write(`This deletes ${home} and removes vouch git hooks. Type y to confirm: `);
      const ch = await keypress(['y', 'n']);
      process.stdout.write(`${ch}\n`);
      if (ch !== 'y') {
        console.log('left alone.');
        return;
      }
    }

    // Stop the daemon FIRST and wait for it to actually exit. Talking to it
    // here would respawn one, and a fresh daemon recreates the home directory
    // the moment it opens the database, resurrecting what we just deleted.
    try {
      const { pid } = JSON.parse(readFileSync(daemonInfoPath(), 'utf8'));
      process.kill(pid, 'SIGTERM');
      for (let i = 0; i < 40; i++) {
        try {
          process.kill(pid, 0); // still alive
          await new Promise((r) => setTimeout(r, 50));
        } catch {
          break; // gone
        }
      }
    } catch { /* no daemon running */ }

    // Read repo roots straight from SQLite so no daemon is needed.
    const roots: string[] = [];
    try {
      const { openDb } = await import('@vouch/core');
      const db = openDb(dbPath());
      for (const r of db.prepare('SELECT root FROM repos').all() as { root: string }[]) roots.push(r.root);
      db.close();
    } catch { /* unreadable db; still remove the home dir */ }
    for (const r of roots) {
      try {
        removePostCommitHook(r);
      } catch { /* repo may be gone */ }
    }

    rmSync(home, { recursive: true, force: true });
    console.log(`purged. removed ${roots.length} git hook${roots.length === 1 ? '' : 's'}, nothing left behind.`);
  });

// Errors reach the user as one plain sentence, never a stack trace.
program.parseAsync(process.argv).catch((e: Error) => {
  if (e.message.includes('not registered')) {
    console.error(paint.warn('This repo is not initialised yet.'));
    console.error(`Run ${paint.em('vouch init')} here first, then try again.`);
  } else if (e.message.includes('no commits yet')) {
    console.error(paint.warn('This repo has no commits yet. Make one commit, then run vouch init.'));
  } else {
    console.error(paint.bad(e.message));
  }
  process.exit(1);
});
