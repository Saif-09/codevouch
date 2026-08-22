import ignoreFactory from 'ignore';
export declare function neverSend(relPath: string): boolean;
export declare function scrubText(text: string): {
    text: string;
    redactions: number;
    redactedChars: number;
};
export interface RedactInput {
    path: string;
    content: string;
}
export interface RedactResult {
    kept: RedactInput[];
    dropped: {
        path: string;
        reason: string;
    }[];
}
export declare function loadVouchignore(repoRoot: string): ReturnType<typeof ignoreFactory>;
/** The single gate everything model-bound passes through. */
export declare function redactFiles(repoRoot: string, files: RedactInput[]): RedactResult;
