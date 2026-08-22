import type { Db } from './db.js';
export declare function isConfigOnly(name: string): boolean;
export interface UnusedFinding {
    nodeId: string;
    name: string;
    installSizeBytes: number | null;
    inZone: boolean;
    /** true when the package plausibly has no import site by design */
    configOnly: boolean;
    /** what the dossier concluded, when one exists */
    ifItVanished: string | null;
}
export interface UnusedReport {
    likelyUnused: UnusedFinding[];
    configOnly: UnusedFinding[];
    bytesLikelyUnused: number;
    scanned: number;
    caveat: string;
}
export declare const CAVEAT = "Vouch finds imports in TypeScript, JavaScript and Python source. Packages used only through config files, CLI scripts, bundler plugins or generated code have no import site and will appear here. Treat each one as a question to answer, not an instruction to delete.";
export declare function findUnused(db: Db, repoId: string): UnusedReport;
