#!/usr/bin/env node
/**
 * Stage the publishable package into build/publish/.
 *
 * The monorepo splits core/services/cli for development; a user installs ONE
 * thing. This assembles a self-contained package OUTSIDE the workspace, so
 * the workspace itself keeps resolving normally (pnpm's strict layout does
 * not hoist core's dependencies into the CLI package, so vendoring in place
 * breaks local runs and tests).
 */
import { cpSync, rmSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';

const root = process.cwd();
const out = join(root, 'build', 'publish');
const req = (p) => {
  if (!existsSync(p)) throw new Error(`missing ${p}. Run \`pnpm build\` first.`);
  return p;
};

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

cpSync(req(join(root, 'packages', 'cli', 'dist')), join(out, 'dist'), { recursive: true });
cpSync(req(join(root, 'packages', 'core', 'dist')), join(out, 'vendor', 'core'), { recursive: true });
cpSync(req(join(root, 'packages', 'services', 'dist')), join(out, 'vendor', 'services'), { recursive: true });
cpSync(join(root, 'packages', 'plugin'), join(out, 'plugin'), {
  recursive: true,
  filter: (src) => !src.includes('node_modules'),
});
for (const f of ['README.md', 'LICENSE']) {
  if (existsSync(join(root, f))) cpSync(join(root, f), join(out, f));
}
mkdirSync(join(out, 'docs'), { recursive: true });
cpSync(join(root, 'docs', 'USAGE.md'), join(out, 'docs', 'USAGE.md'));

function walk(dir) {
  const acc = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) acc.push(...walk(p));
    else if (p.endsWith('.js')) acc.push(p);
  }
  return acc;
}

let rewritten = 0;
for (const file of walk(out)) {
  const text = readFileSync(file, 'utf8');
  const rel = (target) => {
    const r = relative(dirname(file), target).replace(/\\/g, '/');
    return r.startsWith('.') ? r : `./${r}`;
  };
  const next = text
    .replace(/(['"])@vouch\/core\/daemon-version\1/g, (_m, q) => `${q}${rel(join(out, 'vendor', 'core', 'daemon', 'version.js'))}${q}`)
    .replace(/(['"])@vouch\/core\/daemon\1/g, (_m, q) => `${q}${rel(join(out, 'vendor', 'core', 'daemon', 'main.js'))}${q}`)
    .replace(/(['"])@vouch\/core\1/g, (_m, q) => `${q}${rel(join(out, 'vendor', 'core', 'index.js'))}${q}`)
    .replace(/(['"])@vouch\/services\1/g, (_m, q) => `${q}${rel(join(out, 'vendor', 'services', 'index.js'))}${q}`);
  if (next !== text) {
    writeFileSync(file, next);
    rewritten++;
  }
}

const cliPkg = JSON.parse(readFileSync(join(root, 'packages', 'cli', 'package.json'), 'utf8'));
const corePkg = JSON.parse(readFileSync(join(root, 'packages', 'core', 'package.json'), 'utf8'));
const deps = { ...cliPkg.dependencies, ...corePkg.dependencies };
delete deps['@vouch/core'];
delete deps['@vouch/services'];

writeFileSync(join(out, 'package.json'), `${JSON.stringify({
  name: 'codevouch',
  version: '0.4.0',
  description: 'Know what you shipped. Vouch checks whether you can actually defend the code, packages and services in your own repo.',
  license: 'MIT',
  type: 'module',
  bin: { vouch: 'dist/main.js' },
  engines: { node: '>=24.0.0' },
  keywords: ['ai', 'learning', 'code-comprehension', 'dependencies', 'claude', 'technical-debt'],
  files: ['dist', 'vendor', 'plugin', 'docs', 'README.md'],
  dependencies: deps,
  optionalDependencies: corePkg.optionalDependencies ?? {},
  repository: { type: 'git', url: 'git+https://github.com/saif-09/codevouch.git' },
  author: 'saif-09',
}, null, 2)}\n`);

// the published plugin points at the installed CLI, not the dev checkout
const pluginPkgDir = join(out, 'plugin');
if (existsSync(pluginPkgDir)) {
  writeFileSync(join(pluginPkgDir, 'INSTALLED.md'),
    'This directory is the Claude Code plugin shipped with @saifsiddiqui/vouch.\nRun `vouch plugin` for the install command.\n');
}

console.log(`staged build/publish: ${rewritten} import paths rewritten`);
console.log('dependencies:', Object.keys(deps).join(', '));
