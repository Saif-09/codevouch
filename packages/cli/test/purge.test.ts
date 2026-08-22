import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CLI = resolve(__dirname, '..', 'dist', 'main.js');

describe('purge leaves nothing behind (DoD #14)', () => {
  it('deletes the home dir and strips the git hook even with a live daemon running', () => {
    const home = mkdtempSync(join(tmpdir(), 'vouch-purge-live-'));
    const repo = mkdtempSync(join(tmpdir(), 'vouch-purge-livrepo-'));
    execFileSync('git', ['init', '-q'], { cwd: repo });
    execFileSync('git', ['config', 'user.email', 't@t.co'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 'T'], { cwd: repo });
    writeFileSync(join(repo, 'package.json'), '{"dependencies":{"nanoid":"^5.0.0"}}');
    execFileSync('git', ['add', '-A'], { cwd: repo });
    execFileSync('git', ['commit', '-qm', 'init'], { cwd: repo });
    const env = { ...process.env, VOUCH_HOME: home };

    // `status` spawns a real daemon and creates the database
    spawnSync(process.execPath, ['--no-warnings', CLI, 'status'], { cwd: repo, env, encoding: 'utf8' });
    expect(existsSync(join(home, 'vouch.db'))).toBe(true);
    const info = JSON.parse(readFileSync(join(home, 'daemon.json'), 'utf8'));

    // register the repo and install the hook the way init does
    spawnSync('curl', ['-s', '-X', 'POST', `localhost:${info.port}/repos`, '-d',
      JSON.stringify({ root: repo, name: 'livrepo' })]);
    const hookMod = resolve(__dirname, '..', 'dist', 'hook.js');
    spawnSync(process.execPath, ['--input-type=module', '-e',
      `import {installPostCommitHook} from ${JSON.stringify(hookMod)}; installPostCommitHook(${JSON.stringify(repo)});`],
      { env });
    const hookPath = join(repo, '.git', 'hooks', 'post-commit');
    expect(readFileSync(hookPath, 'utf8')).toContain('vouch-tick');

    const res = spawnSync(process.execPath, ['--no-warnings', CLI, 'purge', '--yes'], { cwd: repo, env, encoding: 'utf8' });
    expect(res.stdout).toMatch(/nothing left behind/);
    // the daemon was stopped first, so nothing recreates the home directory
    expect(existsSync(home)).toBe(false);
    expect(readFileSync(hookPath, 'utf8')).not.toContain('vouch-tick');
  });
});

describe('destructive and interactive commands refuse without a terminal', () => {
  it('purge without a TTY refuses and deletes nothing', () => {
    const home = mkdtempSync(join(tmpdir(), 'vouch-purge-home-'));
    const repo = mkdtempSync(join(tmpdir(), 'vouch-purge-repo-'));
    execFileSync('git', ['init', '-q'], { cwd: repo });
    writeFileSync(join(repo, 'package.json'), '{}');
    const env = { ...process.env, VOUCH_HOME: home };

    const res = spawnSync(process.execPath, ['--no-warnings', CLI, 'purge'], { cwd: repo, env, input: 'y', encoding: 'utf8' });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/interactive terminal/);
    expect(existsSync(home)).toBe(true); // refused means nothing was touched
  });

  it('digest without a TTY refuses BEFORE spending an extraction call', () => {
    const home = mkdtempSync(join(tmpdir(), 'vouch-tty-home-'));
    const repo = mkdtempSync(join(tmpdir(), 'vouch-tty-repo-'));
    execFileSync('git', ['init', '-q'], { cwd: repo });
    const env = { ...process.env, VOUCH_HOME: home };

    const res = spawnSync(process.execPath, ['--no-warnings', CLI, 'digest'], { cwd: repo, env, encoding: 'utf8' });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/interactive terminal/);
    // refused before the daemon was ever contacted, so no database exists yet
    expect(existsSync(join(home, 'vouch.db'))).toBe(false);
  });
});
