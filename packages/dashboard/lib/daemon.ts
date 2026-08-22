import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Server-side only: the dashboard is a thin client over the daemon API (spec §2). */
export async function daemon<T = any>(path: string): Promise<T> {
  const home = process.env.VOUCH_HOME ?? join(homedir(), '.vouch');
  const { port } = JSON.parse(readFileSync(join(home, 'daemon.json'), 'utf8'));
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`daemon ${res.status} for ${path}`);
  return res.json() as Promise<T>;
}

export async function repoRoot(): Promise<string> {
  if (process.env.VOUCH_REPO_ROOT) return process.env.VOUCH_REPO_ROOT;
  const repos = await daemon<{ root: string }[]>('/repos');
  if (repos.length === 0) throw new Error('no repos registered; run vouch init');
  return repos[0].root;
}
