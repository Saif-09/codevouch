export declare function enableGatewayHost(host: string): void;
export declare function isAllowedHost(host: string): boolean;
export declare function assertAllowed(url: string): URL;
export declare function safeFetch(url: string, init?: RequestInit): Promise<Response>;
/**
 * OSV batch queries go over HTTP/2 because HTTP/1.1 caps responses at 32 MiB
 * (RESEARCH §6.2).
 */
export declare function osvBatchPost(path: string, body: unknown): Promise<any>;
