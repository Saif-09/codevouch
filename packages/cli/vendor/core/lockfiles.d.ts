/**
 * Spec §5.3. Direct dependencies come from the manifest (package.json,
 * pyproject.toml, requirements.txt); lockfiles supply resolved versions.
 * New direct dependencies become nodes immediately, with no model call.
 */
export interface DirectDep {
    ecosystem: 'npm' | 'pypi';
    name: string;
    version: string | null;
    dev: boolean;
}
export declare const MANIFEST_FILES: readonly ["package.json", "pyproject.toml", "requirements.txt"];
export declare const LOCK_FILES: readonly ["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "uv.lock"];
export declare function isDependencyFile(path: string): boolean;
/** files: relative path → content at a given rev. Missing files are absent keys. */
export declare function parseDirectDeps(files: Map<string, string>): DirectDep[];
/** Deps present after but not before: the Dossier trigger. */
export declare function newDirectDeps(before: DirectDep[], after: DirectDep[]): DirectDep[];
