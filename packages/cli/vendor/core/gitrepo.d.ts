import { type SimpleGit } from 'simple-git';
export interface ChangedFile {
    status: 'A' | 'M' | 'D' | 'R';
    path: string;
    oldPath?: string;
}
export declare function git(root: string): SimpleGit;
export declare function headSha(root: string): Promise<string>;
export declare function parentOf(root: string, sha: string): Promise<string | null>;
/** name-status with rename detection between two revs. */
export declare function changedFiles(root: string, before: string, after: string): Promise<ChangedFile[]>;
export declare function fileAt(root: string, rev: string, path: string): Promise<string | null>;
export declare function unifiedDiff(root: string, before: string, after: string): Promise<string>;
export declare function aiAuthored(root: string, before: string, after: string): Promise<boolean>;
export declare function listFiles(root: string): Promise<string[]>;
