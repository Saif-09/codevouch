import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { neverSend, scrubText, redactFiles } from '../src/redact.js';

describe('redaction (spec §11, DoD #5)', () => {
  it('never-send list is matched on path and is not empty-able', () => {
    for (const p of ['.env', '.env.local', 'certs/server.pem', 'keys/deploy.key', 'id_rsa', 'app/secrets.ts', 'aws-credentials.json', 'release.keystore', 'a/b/.env.production']) {
      expect(neverSend(p), p).toBe(true);
    }
    expect(neverSend('src/index.ts')).toBe(false);
  });

  it('scrubs API keys, JWTs, PEM blocks, and credentialled URLs', () => {
    const dirty = [
      'const k = "sk-ant-abc123def456ghi789";',
      'token: "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456"',
      'aws: AKIAIOSFODNN7EXAMPLE',
      'jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"',
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n-----END RSA PRIVATE KEY-----',
      'db: postgres://admin:hunter2secret@db.example.com:5432/app',
    ].join('\n');
    const { text } = scrubText(dirty);
    expect(text).not.toContain('sk-ant-abc123');
    expect(text).not.toContain('ghp_ABCDEFGH');
    expect(text).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(text).not.toContain('hunter2secret');
    expect(text).not.toContain('BEGIN RSA PRIVATE KEY');
    expect(text).not.toMatch(/eyJhbGciOiJIUzI1NiJ9\.eyJzdWIi/);
    expect(text).toContain('[REDACTED:');
  });

  it('DoD #5: a diff containing a key, a .env file, a PEM block and a credentialled URL never reaches the backend input', () => {
    const root = mkdtempSync(join(tmpdir(), 'vouch-redact-'));
    const result = redactFiles(root, [
      { path: '.env', content: 'STRIPE_SECRET_KEY=sk-live_abc123def456ghi789jkl' },
      { path: 'src/pay.ts', content: 'const stripe = new Stripe("sk-live_abc123def456ghi789jklmno");\nexport const pay = () => stripe.charges.create();' },
      { path: 'certs/x.pem', content: '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----' },
      { path: 'src/db.ts', content: 'export const url = "postgres://u:sup3rs3cretpass@host/db";\nexport function connect() { return url; }' },
    ]);
    const serialized = JSON.stringify(result.kept);
    expect(serialized).not.toContain('sk-live_abc123');
    expect(serialized).not.toContain('sup3rs3cret');
    expect(serialized).not.toContain('STRIPE_SECRET_KEY');
    expect(result.dropped.map((d) => d.path)).toContain('.env');
    expect(result.dropped.map((d) => d.path)).toContain('certs/x.pem');
  });

  it('drops hunks that are over 40% redacted', () => {
    const root = mkdtempSync(join(tmpdir(), 'vouch-redact-'));
    const keyDump = Array.from({ length: 6 }, (_, i) => `sk-ant-key${i}abcdefghijklmnopqrstuvwx`).join('\n');
    const result = redactFiles(root, [{ path: 'dump.txt', content: keyDump }]);
    expect(result.kept).toHaveLength(0);
    expect(result.dropped[0].reason).toBe('over 40% redacted');
  });

  it('.vouchignore unions with the never-send list', () => {
    const root = mkdtempSync(join(tmpdir(), 'vouch-redact-'));
    writeFileSync(join(root, '.vouchignore'), 'internal/\n');
    const result = redactFiles(root, [
      { path: 'internal/plan.ts', content: 'export const a = 1;' },
      { path: 'src/ok.ts', content: 'export const b = 2;' },
    ]);
    expect(result.kept.map((f) => f.path)).toEqual(['src/ok.ts']);
    expect(result.dropped[0].reason).toBe('.vouchignore');
  });

  it('high-entropy strings are scrubbed, prose and identifiers are not', () => {
    const { text } = scrubText('const supabaseAnonKey = "b64XkQ9pLmVt2RwZa7HcJfN3TgYs5DqBnE8UvA4MiKo";');
    expect(text).toContain('[REDACTED:high-entropy]');
    const clean = scrubText('export function calculateMonthlyRecurringRevenue(subscriptions) { return subscriptions.length; }');
    expect(clean.redactions).toBe(0);
  });
});
