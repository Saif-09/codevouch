/** Small glob matcher: supports **, *, ? — enough for zone path patterns. */
export declare function globToRegex(pattern: string): RegExp;
export declare function globMatch(pattern: string, path: string): boolean;
