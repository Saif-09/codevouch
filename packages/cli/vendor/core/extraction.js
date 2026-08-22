import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validate } from './validate.js';
import { safeFetch, enableGatewayHost } from './egress.js';
import { ulid, nowIso } from './util.js';
export class ExtractionError extends Error {
}
const DEFAULT_MAX_USD = 0.25;
const TIMEOUT_MS = 180_000;
export class ClaudeCliBackend {
    bin;
    model;
    /**
     * Extraction defaults to haiku: measured on 2.1.238, the Claude Code
     * system-prompt overhead alone costs ~$0.74 per cold call on a frontier
     * model and ~$0.05 on haiku, and dossier extraction does not need a
     * frontier model. (--bare would shed the overhead but skips the keychain
     * read, losing subscription auth entirely.)
     */
    constructor(bin = 'claude', model = process.env.VOUCH_EXTRACT_MODEL || 'haiku') {
        this.bin = bin;
        this.model = model;
    }
    async run(spec) {
        // Empty cwd: no project context to wander into, and faster startup.
        const cwd = mkdtempSync(join(tmpdir(), 'vouch-extract-'));
        const args = [
            '-p',
            '--model', this.model,
            '--output-format', 'json',
            '--json-schema', JSON.stringify(spec.schema),
            '--append-system-prompt', spec.system,
            '--max-budget-usd', String(spec.maxUsd ?? DEFAULT_MAX_USD),
        ];
        const raw = await new Promise((resolve, reject) => {
            const child = spawn(this.bin, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
            let out = '';
            let err = '';
            const timer = setTimeout(() => {
                child.kill('SIGKILL');
                reject(new ExtractionError(`claude -p timed out after ${TIMEOUT_MS / 1000}s`));
            }, TIMEOUT_MS);
            child.stdout.on('data', (d) => (out += d));
            child.stderr.on('data', (d) => (err += d));
            child.on('error', (e) => { clearTimeout(timer); reject(new ExtractionError(`spawn claude: ${e.message}`)); });
            child.on('close', (code) => {
                clearTimeout(timer);
                if (code === 0)
                    resolve(out);
                else
                    reject(new ExtractionError(`claude -p exited ${code}: ${err.slice(0, 400)}`));
            });
            child.stdin.write(spec.input);
            child.stdin.end();
        });
        let doc;
        try {
            doc = JSON.parse(raw);
        }
        catch {
            throw new ExtractionError('claude -p returned non-JSON output');
        }
        if (doc.is_error)
            throw new ExtractionError(`claude -p error: ${String(doc.result).slice(0, 400)}`);
        // Structured output location varies by CLI version; try the known spots.
        let value = doc.structured_output ?? doc.structured_result ?? null;
        if (value == null && typeof doc.result === 'string') {
            try {
                value = JSON.parse(doc.result);
            }
            catch {
                throw new ExtractionError('no structured output in claude -p result');
            }
        }
        const problems = validate(spec.schema, value);
        if (problems.length > 0) {
            throw new ExtractionError(`schema mismatch: ${problems.slice(0, 3).join('; ')}`);
        }
        return { value: value, costUsd: doc.total_cost_usd ?? doc.cost_usd ?? null };
    }
}
const GATEWAY_HOST = 'ai-gateway.vercel.sh';
export class GatewayBackend {
    apiKey;
    model;
    constructor(apiKey, model = 'anthropic/claude-sonnet-5') {
        this.apiKey = apiKey;
        this.model = model;
        enableGatewayHost(GATEWAY_HOST); // joins the allowlist only when configured
    }
    async run(spec) {
        const res = await safeFetch(`https://${GATEWAY_HOST}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                authorization: `Bearer ${this.apiKey}`,
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                model: this.model,
                messages: [
                    {
                        role: 'system',
                        content: `${spec.system}\n\nRespond with ONLY a JSON object matching this schema, no prose:\n${JSON.stringify(spec.schema)}`,
                    },
                    { role: 'user', content: spec.input },
                ],
                response_format: { type: 'json_object' },
            }),
        });
        if (!res.ok)
            throw new ExtractionError(`gateway ${res.status}`);
        const doc = await res.json();
        const text = doc?.choices?.[0]?.message?.content;
        if (typeof text !== 'string')
            throw new ExtractionError('gateway returned no content');
        let value;
        try {
            value = JSON.parse(text);
        }
        catch {
            throw new ExtractionError('gateway returned non-JSON content');
        }
        const problems = validate(spec.schema, value);
        if (problems.length > 0) {
            throw new ExtractionError(`schema mismatch: ${problems.slice(0, 3).join('; ')}`);
        }
        return { value: value, costUsd: null };
    }
}
export function chooseBackend() {
    const key = process.env.VOUCH_GATEWAY_KEY ?? process.env.AI_GATEWAY_API_KEY;
    if (process.env.VOUCH_BACKEND === 'gateway' && key) {
        return new GatewayBackend(key, process.env.VOUCH_GATEWAY_MODEL || undefined);
    }
    return new ClaudeCliBackend(process.env.VOUCH_CLAUDE_BIN || 'claude');
}
/** Wraps a backend with the local cost meter (`vouch status` prints it). */
export function metered(db, backend) {
    return {
        async run(spec) {
            try {
                const result = await backend.run(spec);
                db.prepare('INSERT INTO extraction_calls (id, task, ok, cost_usd, at) VALUES (?, ?, 1, ?, ?)')
                    .run(ulid(), spec.task, result.costUsd, nowIso());
                return result;
            }
            catch (e) {
                db.prepare('INSERT INTO extraction_calls (id, task, ok, cost_usd, at) VALUES (?, ?, 0, NULL, ?)')
                    .run(ulid(), spec.task, nowIso());
                throw e;
            }
        },
    };
}
