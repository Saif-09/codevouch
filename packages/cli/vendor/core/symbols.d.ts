export interface ExportedSymbol {
    name: string;
    hash: string;
}
export declare function isSourceFile(path: string): boolean;
/** Exported declarations of one file, parsed in isolation. */
export declare function exportedSymbols(path: string, content: string): ExportedSymbol[];
