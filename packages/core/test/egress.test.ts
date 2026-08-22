import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { assertAllowed, isAllowedHost } from '../src/egress.js';

describe('egress allowlist (spec §11, DoD #6)', () => {
  it('allows exactly the four hosts', () => {
    for (const host of ['api.deps.dev', 'api.osv.dev', 'registry.npmjs.org', 'api.npmjs.org']) {
      expect(isAllowedHost(host), host).toBe(true);
    }
  });

  it('blocks every other host, lookalikes included', () => {
    for (const url of [
      'https://evil.com/x',
      'https://api.deps.dev.evil.com/x',
      'https://registry.npmjs.org.attacker.io/x',
      'https://example.org/api.deps.dev',
      'https://localhost:9999/x',
    ]) {
      expect(() => assertAllowed(url), url).toThrow(/egress blocked/);
    }
  });

  it('blocks non-https', () => {
    expect(() => assertAllowed('http://api.deps.dev/x')).toThrow(/not https/);
  });

  it('no source file outside egress.ts opens a network connection', () => {
    // "Any other outbound host is a bug and a failing test": enforced by
    // keeping fetch/http2/https usage inside the one audited module.
    const srcDir = join(__dirname, '..', 'src');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (entry.name.endsWith('.ts') && entry.name !== 'egress.ts') {
          const text = readFileSync(p, 'utf8').replace(/safeFetch/g, 'SAFE_CALL');
          if (/\bfetch\s*\(/.test(text)) offenders.push(`${entry.name}: bare fetch(`);
          if (/http2\.connect|https?\.request|net\.connect|tls\.connect|new WebSocket/.test(text)) {
            offenders.push(`${entry.name}: raw socket`);
          }
        }
      }
    };
    walk(srcDir);
    expect(offenders).toEqual([]);
  });
});
