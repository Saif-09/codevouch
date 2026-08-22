export declare function ulid(now?: number): string;
export declare function nowIso(): string;
export declare function sha256(text: string): string;
/** Shannon entropy in bits per character. */
export declare function entropy(s: string): number;
export declare function slugify(s: string): string;
export declare function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]>;
