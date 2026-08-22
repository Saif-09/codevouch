import http2 from 'node:http2';
/**
 * Spec §11. The ONLY module in the codebase allowed to open a network
 * connection. Every other file goes through safeFetch / osvBatchPost, and a
 * test greps the source tree to keep it that way.
 *
 * The AI Gateway host joins the allowlist only when the user has explicitly
 * configured the GatewayBackend (spec §6); the default posture is the four
 * hosts plus the local `claude` binary, which is a process, not a socket.
 */
const BASE_ALLOWED = new Set([
    'api.deps.dev',
    'api.osv.dev',
    'registry.npmjs.org',
    'api.npmjs.org',
]);
let gatewayHost = null;
export function enableGatewayHost(host) {
    gatewayHost = host;
}
export function isAllowedHost(host) {
    return BASE_ALLOWED.has(host) || (gatewayHost !== null && host === gatewayHost);
}
export function assertAllowed(url) {
    const u = new URL(url);
    if (u.protocol !== 'https:')
        throw new Error(`egress blocked (not https): ${url}`);
    if (!isAllowedHost(u.hostname))
        throw new Error(`egress blocked (host not allowlisted): ${u.hostname}`);
    return u;
}
export async function safeFetch(url, init) {
    assertAllowed(url);
    return fetch(url, { ...init, redirect: 'error' });
}
/**
 * OSV batch queries go over HTTP/2 because HTTP/1.1 caps responses at 32 MiB
 * (RESEARCH §6.2).
 */
export function osvBatchPost(path, body) {
    const origin = 'https://api.osv.dev';
    assertAllowed(origin + path);
    return new Promise((resolve, reject) => {
        const client = http2.connect(origin);
        client.on('error', reject);
        const req = client.request({
            ':method': 'POST',
            ':path': path,
            'content-type': 'application/json',
        });
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
            client.close();
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
            }
            catch (e) {
                reject(e);
            }
        });
        req.on('error', reject);
        req.setTimeout(20000, () => req.close(http2.constants.NGHTTP2_CANCEL));
        req.end(JSON.stringify(body));
    });
}
