export interface CallSite {
    path: string;
    line: number;
    snippet: string;
}
/**
 * Real references only, never inferred (spec §7.1 step 2). Import statements
 * are the honest, verifiable call sites for a dependency. If none are found,
 * the caller says so explicitly rather than guessing.
 */
export declare function findCallSites(repoRoot: string, files: string[], ecosystem: 'npm' | 'pypi', dep: string, limit?: number): CallSite[];
