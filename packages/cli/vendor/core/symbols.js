import { Project, ts } from 'ts-morph';
import { sha256 } from './util.js';
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
export function isSourceFile(path) {
    return SOURCE_EXT.test(path) && !path.includes('node_modules/');
}
/** Exported declarations of one file, parsed in isolation. */
export function exportedSymbols(path, content) {
    if (!isSourceFile(path))
        return [];
    try {
        const project = new Project({
            useInMemoryFileSystem: true,
            compilerOptions: { allowJs: true, jsx: ts.JsxEmit.Preserve },
        });
        const file = project.createSourceFile(path.endsWith('x') ? 'f.tsx' : 'f.ts', content);
        const out = [];
        const seen = new Set();
        for (const [name, decls] of file.getExportedDeclarations()) {
            if (seen.has(name))
                continue;
            seen.add(name);
            const text = decls.map((d) => d.getText()).join('\n');
            out.push({ name, hash: sha256(text) });
        }
        return out;
    }
    catch {
        return []; // unparseable files contribute no artifact nodes
    }
}
