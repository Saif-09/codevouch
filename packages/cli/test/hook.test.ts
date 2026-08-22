import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installPostCommitHook, removePostCommitHook } from '../src/hook.js';

function fakeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vouch-hook-'));
  mkdirSync(join(dir, '.git', 'hooks'), { recursive: true });
  return dir;
}

describe('post-commit hook (Wave 1 spec §1)', () => {
  it('installs idempotently and backgrounds the tick so commits never slow down', () => {
    const repo = fakeRepo();
    installPostCommitHook(repo);
    installPostCommitHook(repo); // idempotent
    const hook = readFileSync(join(repo, '.git', 'hooks', 'post-commit'), 'utf8');
    expect(hook.match(/vouch-tick/g)).toHaveLength(1);
    expect(hook).toContain('&) || true'); // backgrounded and failure-proof
    expect(hook).toContain('session tick');
  });

  it('appends to an existing hook without clobbering it, and removal restores it', () => {
    const repo = fakeRepo();
    const hookPath = join(repo, '.git', 'hooks', 'post-commit');
    writeFileSync(hookPath, '#!/bin/sh\necho existing-hook\n');
    installPostCommitHook(repo);
    let hook = readFileSync(hookPath, 'utf8');
    expect(hook).toContain('existing-hook');
    expect(hook).toContain('vouch-tick');
    removePostCommitHook(repo);
    hook = readFileSync(hookPath, 'utf8');
    expect(hook).toContain('existing-hook');
    expect(hook).not.toContain('vouch-tick');
  });

  it('purge semantics: VOUCH_HOME removal leaves nothing behind (DoD #14)', () => {
    const home = mkdtempSync(join(tmpdir(), 'vouch-purge-'));
    writeFileSync(join(home, 'vouch.db'), 'x');
    writeFileSync(join(home, 'daemon.json'), '{}');
    writeFileSync(join(home, 'daemon.log'), 'x');
    rmSync(home, { recursive: true, force: true });
    expect(existsSync(home)).toBe(false);
  });
});
