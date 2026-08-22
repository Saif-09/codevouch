import type { Db } from './db.js';
export interface Zone {
    id: string;
    kind: 'path' | 'topic' | 'dependency_class';
    pattern: string;
    name: string;
    stance: 'keep_sharp' | 'outsourced';
    critical: number;
}
export declare function loadZones(db: Db, repoId: string): Zone[];
/**
 * First matching zone wins; silence means out of scope (Wave 1 spec §1).
 * 'path' zones are user-authored globs; 'topic' zones are the rule-derived
 * regexes proposed at init.
 */
export declare function matchPathZone(zones: Zone[], path: string): Zone | null;
export declare function dependencyClass(name: string, dev: boolean): string;
export declare function isCriticalDep(name: string): boolean;
export declare function matchDepZone(zones: Zone[], name: string, dev: boolean): Zone | null;
export declare function addZone(db: Db, repoId: string, z: Omit<Zone, 'id'>): string;
export interface ZoneCandidate {
    name: string;
    kind: 'path' | 'topic' | 'dependency_class';
    pattern: string;
    fileCount: number;
    example: string;
    defaultStance: 'keep_sharp' | 'outsourced';
    critical: boolean;
}
/** Candidates derived from what is actually in the repo, never a generic checklist. */
export declare function proposeZones(files: string[]): ZoneCandidate[];
