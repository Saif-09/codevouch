import { Project, ts } from 'ts-morph';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isSourceFile } from './symbols.js';
/**
 * Real references only, never inferred (spec §7.1 step 2). Import statements
 * are the honest, verifiable call sites for a dependency. If none are found,
 * the caller says so explicitly rather than guessing.
 */
export function findCallSites(repoRoot, files, ecosystem, dep, limit = 3) {
    const out = [];
    if (ecosystem === 'npm') {
        // JSX must be parsed as JSX. It happens to survive a .ts filename because
        // TypeScript's parser is error tolerant and imports sit above the JSX, but
        // relying on that is luck, not design.
        const project = new Project({
            useInMemoryFileSystem: true,
            compilerOptions: { allowJs: true, jsx: ts.JsxEmit.Preserve },
        });
        for (const rel of files) {
            if (out.length >= limit)
                break;
            if (!isSourceFile(rel))
                continue;
            let content;
            try {
                content = readFileSync(join(repoRoot, rel), 'utf8');
            }
            catch {
                continue;
            }
            if (!content.includes(dep))
                continue; // cheap pre-filter before parsing
            try {
                const ext = /\.(tsx|jsx)$/.test(rel) ? 'tsx' : 'ts';
                const sf = project.createSourceFile(`probe.${ext}`, content, { overwrite: true });
                for (const imp of sf.getImportDeclarations()) {
                    const spec = imp.getModuleSpecifierValue();
                    if (spec === dep || spec.startsWith(`${dep}/`)) {
                        out.push({
                            path: rel,
                            line: imp.getStartLineNumber(),
                            snippet: imp.getText().split('\n')[0].slice(0, 160),
                        });
                        if (out.length >= limit)
                            break;
                    }
                }
            }
            catch {
                continue;
            }
        }
    }
    else {
        const mod = dep.replace(/-/g, '_');
        const re = new RegExp(`^\\s*(from\\s+${mod}[\\s.]|import\\s+${mod}\\b)`);
        for (const rel of files) {
            if (out.length >= limit)
                break;
            if (!rel.endsWith('.py'))
                continue;
            let content;
            try {
                content = readFileSync(join(repoRoot, rel), 'utf8');
            }
            catch {
                continue;
            }
            content.split('\n').forEach((lineText, i) => {
                if (out.length < limit && re.test(lineText)) {
                    out.push({ path: rel, line: i + 1, snippet: lineText.trim().slice(0, 160) });
                }
            });
        }
    }
    return out;
}
