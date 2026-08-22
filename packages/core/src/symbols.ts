import { Project, ts } from 'ts-morph';
import { sha256 } from './util.js';

export interface ExportedSymbol {
  name: string;
  hash: string; // content hash of the declaration text, for rename matching (spec §3.1)
}

const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

export function isSourceFile(path: string): boolean {
  return SOURCE_EXT.test(path) && !path.includes('node_modules/');
}

/** Exported declarations of one file, parsed in isolation. */
export function exportedSymbols(path: string, content: string): ExportedSymbol[] {
  if (!isSourceFile(path)) return [];
  try {
    const project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: { allowJs: true, jsx: ts.JsxEmit.Preserve },
    });
    const file = project.createSourceFile(path.endsWith('x') ? 'f.tsx' : 'f.ts', content);
    const out: ExportedSymbol[] = [];
    const seen = new Set<string>();
    for (const [name, decls] of file.getExportedDeclarations()) {
      if (seen.has(name)) continue;
      seen.add(name);
      const text = decls.map((d) => d.getText()).join('\n');
      out.push({ name, hash: sha256(text) });
    }
    return out;
  } catch {
    return []; // unparseable files contribute no artifact nodes
  }
}
