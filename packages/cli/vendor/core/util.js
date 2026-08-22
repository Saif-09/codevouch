import { randomBytes, createHash } from 'node:crypto';
// Crockford base32, monotonic-enough ULID for a single-writer local tool.
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function ulid(now = Date.now()) {
    let t = now;
    const time = new Array(10);
    for (let i = 9; i >= 0; i--) {
        time[i] = B32[t % 32];
        t = Math.floor(t / 32);
    }
    const rand = randomBytes(16);
    let out = time.join('');
    for (let i = 0; i < 16; i++)
        out += B32[rand[i] % 32];
    return out;
}
export function nowIso() {
    return new Date().toISOString();
}
export function sha256(text) {
    return createHash('sha256').update(text).digest('hex');
}
/** Shannon entropy in bits per character. */
export function entropy(s) {
    if (s.length === 0)
        return 0;
    const freq = new Map();
    for (const ch of s)
        freq.set(ch, (freq.get(ch) ?? 0) + 1);
    let h = 0;
    for (const n of freq.values()) {
        const p = n / s.length;
        h -= p * Math.log2(p);
    }
    return h;
}
export function slugify(s) {
    return s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64);
}
export async function mapLimit(items, limit, fn) {
    const out = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const i = next++;
            out[i] = await fn(items[i], i);
        }
    });
    await Promise.all(workers);
    return out;
}
