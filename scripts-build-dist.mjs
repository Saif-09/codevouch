#!/usr/bin/env node
/**
 * Produce a single self-contained publishable package.
 *
 * The monorepo splits core/services/cli for development, but a user should
 * install ONE thing. This copies the built output of the internal packages
 * into the CLI package as `vendor/`, rewrites the workspace imports to
 * relative paths, and copies the Claude Code plugin alongside.
 */
import { cpSync, rmSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';

const root = process.cwd();
const cli = join(root, 'packages', 'cli');
const vendor = join(cli, 'vendor');

rmSync(vendor, { recursive: true, force: true });
mkdirSync(vendor, { recursive: true });
cpSync(join(root, 'packages', 'core', 'dist'), join(vendor, 'core'), { recursive: true });
cpSync(join(root, 'packages', 'services', 'dist'), join(vendor, 'services'), { recursive: true });

// the plugin ships with the CLI so `vouch plugin` can point at a real path
rmSync(join(cli, 'plugin'), { recursive: true, force: true });
cpSync(join(root, 'packages', 'plugin'), join(cli, 'plugin'), {
  recursive: true,
  filter: (src) => !src.includes('node_modules'),
});

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

// rewrite bare workspace specifiers to relative paths inside the bundle
let rewritten = 0;
for (const file of [...walk(join(cli, 'dist')), ...walk(vendor)]) {
  let text = readFileSync(file, 'utf8');
  const before = text;
  const toCore = relative(dirname(file), join(vendor, 'core', 'index.js')).replace(/\\/g, '/');
  const toCoreDaemon = relative(dirname(file), join(vendor, 'core', 'daemon')).replace(/\\/g, '/');
  const toServices = relative(dirname(file), join(vendor, 'services', 'index.js')).replace(/\\/g, '/');
  text = text
    .replace(/(['"])@vouch\/core\/daemon-version\1/g, (_m, q) => `${q}${toCoreDaemon}/version.js${q}`)
    .replace(/(['"])@vouch\/core\/daemon\1/g, (_m, q) => `${q}${toCoreDaemon}/main.js${q}`)
    .replace(/(['"])@vouch\/core\1/g, (_m, q) => `${q}${toCore.startsWith('.') ? toCore : './' + toCore}${q}`)
    .replace(/(['"])@vouch\/services\1/g, (_m, q) => `${q}${toServices.startsWith('.') ? toServices : './' + toServices}${q}`);
  if (text !== before) {
    writeFileSync(file, text);
    rewritten++;
  }
}

// the published package depends only on real npm packages
const pkgPath = join(cli, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const corePkg = JSON.parse(readFileSync(join(root, 'packages', 'core', 'package.json'), 'utf8'));
pkg.dependencies = { ...pkg.dependencies, ...corePkg.dependencies };
delete pkg.dependencies['@vouch/core'];
delete pkg.dependencies['@vouch/services'];
pkg.optionalDependencies = { ...(corePkg.optionalDependencies ?? {}) };
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

console.log(`bundled: ${rewritten} files rewritten`);
console.log('dependencies:', Object.keys(pkg.dependencies).join(', '));
console.log('optional:', Object.keys(pkg.optionalDependencies).join(', ') || '(none)');
