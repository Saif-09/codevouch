import ignoreFactory from 'ignore';
import { readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { entropy } from './util.js';

/**
 * Spec §11. Redaction runs before EVERY model call. The never-send list is
 * not overridable by config, .vouchignore unions with it, and a hunk that is
 * more than 40% redacted is dropped rather than sent mangled.
 */

// Not overridable. Matched against the basename and the full relative path.
const NEVER_SEND = [
  /^\.env$/i,
  /^\.env\..+/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /^id_rsa/i,
  /\.keystore$/i,
  /secret/i,
  /credential/i,
];

export function neverSend(relPath: string): boolean {
  const base = basename(relPath);
  return NEVER_SEND.some((re) => re.test(base) || re.test(relPath));
}

interface Scrubber { kind: string; re: RegExp }

const SCRUBBERS: Scrubber[] = [
  { kind: 'anthropic-key', re: /sk-ant-[A-Za-z0-9_-]{8,}/g },
  { kind: 'secret-key', re: /sk-[A-Za-z0-9_-]{16,}/g },
  { kind: 'github-token', re: /ghp_[A-Za-z0-9]{20,}/g },
  { kind: 'github-pat', re: /github_pat_[A-Za-z0-9_]{20,}/g },
  { kind: 'aws-key', re: /AKIA[0-9A-Z]{16}/g },
  { kind: 'google-key', re: /AIza[0-9A-Za-z_-]{30,}/g },
  { kind: 'slack-token', re: /xox[bpars]-[A-Za-z0-9-]{10,}/g },
  { kind: 'jwt', re: /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  {
    kind: 'pem-block',
    re: /-----BEGIN [A-Z ]*(?:PRIVATE KEY|CERTIFICATE)-----[\s\S]*?-----END [A-Z ]*(?:PRIVATE KEY|CERTIFICATE)-----/g,
  },
  {
    kind: 'credentialled-url',
    re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@[^\s"']+/gi,
  },
];

// High-entropy catch-all: contiguous token-ish runs over 32 chars whose
// Shannon entropy says "random", not "prose" or "identifierCase".
const LONG_TOKEN = /[A-Za-z0-9+/=_-]{33,}/g;
const ENTROPY_THRESHOLD = 4.2;

export function scrubText(text: string): { text: string; redactions: number; redactedChars: number } {
  let out = text;
  let count = 0;
  let redactedChars = 0;
  for (const { kind, re } of SCRUBBERS) {
    out = out.replace(re, (m) => {
      count++;
      redactedChars += m.length;
      return `[REDACTED:${kind}]`;
    });
  }
  out = out.replace(LONG_TOKEN, (m) => {
    if (m.startsWith('[REDACTED')) return m;
    if (entropy(m) < ENTROPY_THRESHOLD) return m;
    count++;
    redactedChars += m.length;
    return '[REDACTED:high-entropy]';
  });
  return { text: out, redactions: count, redactedChars };
}

export interface RedactInput { path: string; content: string }
export interface RedactResult {
  kept: RedactInput[];
  dropped: { path: string; reason: string }[];
}

export function loadVouchignore(repoRoot: string): ReturnType<typeof ignoreFactory> {
  const ig = ignoreFactory();
  const p = join(repoRoot, '.vouchignore');
  if (existsSync(p)) ig.add(readFileSync(p, 'utf8'));
  return ig;
}

/** The single gate everything model-bound passes through. */
export function redactFiles(repoRoot: string, files: RedactInput[]): RedactResult {
  const ig = loadVouchignore(repoRoot);
  const kept: RedactInput[] = [];
  const dropped: { path: string; reason: string }[] = [];

  for (const f of files) {
    if (neverSend(f.path)) {
      dropped.push({ path: f.path, reason: 'never-send list' });
      continue;
    }
    if (f.path && ig.ignores(f.path)) {
      dropped.push({ path: f.path, reason: '.vouchignore' });
      continue;
    }
    const { text, redactedChars } = scrubText(f.content);
    // If more than 40% of the content got replaced, drop the hunk entirely.
    const originalNonWs = f.content.replace(/\s+/g, '').length || 1;
    if (redactedChars / originalNonWs > 0.4) {
      dropped.push({ path: f.path, reason: 'over 40% redacted' });
      continue;
    }
    kept.push({ path: f.path, content: text });
  }
  return { kept, dropped };
}
