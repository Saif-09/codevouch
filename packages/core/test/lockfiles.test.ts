import { describe, it, expect } from 'vitest';
import { parseDirectDeps, newDirectDeps } from '../src/lockfiles.js';

describe('lockfile parsing (spec §5.3)', () => {
  it('package.json + pnpm-lock.yaml: direct deps with resolved versions and dev flags', () => {
    const files = new Map<string, string>([
      ['package.json', JSON.stringify({
        dependencies: { zod: '^4.0.0', '@clerk/nextjs': '^6.0.0' },
        devDependencies: { vitest: '^3.0.0' },
      })],
      ['pnpm-lock.yaml', [
        'lockfileVersion: 9.0',
        'importers:',
        '  .:',
        '    dependencies:',
        '      zod:',
        "        specifier: ^4.0.0",
        "        version: 4.4.3",
        "      '@clerk/nextjs':",
        "        specifier: ^6.0.0",
        "        version: 6.31.4(react@19.0.0)",
        '    devDependencies:',
        '      vitest:',
        "        specifier: ^3.0.0",
        "        version: 3.2.0",
      ].join('\n')],
    ]);
    const deps = parseDirectDeps(files);
    expect(deps).toContainEqual({ ecosystem: 'npm', name: 'zod', version: '4.4.3', dev: false });
    expect(deps).toContainEqual({ ecosystem: 'npm', name: '@clerk/nextjs', version: '6.31.4', dev: false });
    expect(deps).toContainEqual({ ecosystem: 'npm', name: 'vitest', version: '3.2.0', dev: true });
  });

  it('package-lock.json v3 fills versions', () => {
    const files = new Map<string, string>([
      ['package.json', JSON.stringify({ dependencies: { express: '^5.0.0' } })],
      ['package-lock.json', JSON.stringify({
        lockfileVersion: 3,
        packages: { '': { dependencies: { express: '^5.0.0' } }, 'node_modules/express': { version: '5.1.0' } },
      })],
    ]);
    expect(parseDirectDeps(files)).toContainEqual({ ecosystem: 'npm', name: 'express', version: '5.1.0', dev: false });
  });

  it('requirements.txt and pyproject.toml + uv.lock', () => {
    const files = new Map<string, string>([
      ['requirements.txt', 'fastapi==0.115.0\n# comment\nhttpx>=0.27\n-r other.txt\n'],
      ['pyproject.toml', ['[project]', 'name = "app"', 'dependencies = ["pydantic>=2.0", "SQLAlchemy"]'].join('\n')],
      ['uv.lock', ['[[package]]', 'name = "pydantic"', 'version = "2.9.2"', '[[package]]', 'name = "sqlalchemy"', 'version = "2.0.36"'].join('\n')],
    ]);
    const deps = parseDirectDeps(files);
    expect(deps).toContainEqual({ ecosystem: 'pypi', name: 'fastapi', version: '0.115.0', dev: false });
    expect(deps).toContainEqual({ ecosystem: 'pypi', name: 'httpx', version: null, dev: false });
    expect(deps).toContainEqual({ ecosystem: 'pypi', name: 'pydantic', version: '2.9.2', dev: false });
    expect(deps).toContainEqual({ ecosystem: 'pypi', name: 'sqlalchemy', version: '2.0.36', dev: false });
  });

  it('newDirectDeps: only additions trigger dossiers', () => {
    const before = [{ ecosystem: 'npm' as const, name: 'zod', version: '4.0.0', dev: false }];
    const after = [
      { ecosystem: 'npm' as const, name: 'zod', version: '4.4.3', dev: false },
      { ecosystem: 'npm' as const, name: 'drizzle-orm', version: '0.44.0', dev: false },
    ];
    expect(newDirectDeps(before, after)).toEqual([{ ecosystem: 'npm', name: 'drizzle-orm', version: '0.44.0', dev: false }]);
  });

  it('a malformed manifest yields nothing rather than throwing', () => {
    expect(parseDirectDeps(new Map([['package.json', '{not json']]))).toEqual([]);
  });
});
