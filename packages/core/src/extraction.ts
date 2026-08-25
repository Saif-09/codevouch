import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validate } from './validate.js';
import { safeFetch, enableGatewayHost } from './egress.js';
import { ulid, nowIso } from './util.js';
import type { Db } from './db.js';

/**
 * Spec §6. One interface, two adapters, from the first commit, because batch
 * use of a subscription via `claude -p` is neither prohibited nor explicitly
 * permitted (RESEARCH §7.5). ClaudeCliBackend is the default for personal
 * use; GatewayBackend exists so distribution never depends on resolving
 * someone else's subscription terms.
 *
 * Extraction is batch, at session end, never in the hot loop. Failure
 * DEGRADES, never blocks: callers catch ExtractionError and carry on.
 */

export type ExtractionTask = 'concepts' | 'dossier' | 'brief' | 'grade';

export interface ExtractionSpec {
  task: ExtractionTask;
  system: string;
  input: string; // already redacted by the caller
  schema: object;
  maxUsd?: number;
}

export interface ExtractionResult<T> {
  value: T;
  costUsd: number | null;
}

export class ExtractionError extends Error {}

export interface ExtractionBackend {
  run<T>(spec: ExtractionSpec): Promise<ExtractionResult<T>>;
}

const DEFAULT_MAX_USD = 0.25;
const TIMEOUT_MS = 180_000;

export class ClaudeCliBackend implements ExtractionBackend {
  /**
   * Extraction defaults to haiku: measured on 2.1.238, the Claude Code
   * system-prompt overhead alone costs ~$0.74 per cold call on a frontier
   * model and ~$0.05 on haiku, and dossier extraction does not need a
   * frontier model. (--bare would shed the overhead but skips the keychain
   * read, losing subscription auth entirely.)
   */
  constructor(private bin = 'claude', private model = process.env.VOUCH_EXTRACT_MODEL || 'haiku') {}

  async run<T>(spec: ExtractionSpec): Promise<ExtractionResult<T>> {
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
    const raw = await new Promise<string>((resolve, reject) => {
      const child = spawn(this.bin, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new ExtractionError(`claude -p timed out after ${TIMEOUT_MS / 1000}s`));
      }, TIMEOUT_MS);
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (err += d));
      child.on('error', (e: any) => {
        clearTimeout(timer);
        // ENOENT means the CLI is not on PATH, which is how this fails on a
        // fresh machine or under a node install without one. Extraction is
        // caught and degraded by most callers, so the message is the only
        // trace a user ever sees: it has to name the fix.
        reject(new ExtractionError(e.code === 'ENOENT'
          ? `${this.bin} is not on PATH. Install the Claude Code CLI, or point VOUCH_CLAUDE_BIN at the binary.`
          : `spawn ${this.bin}: ${e.message}`));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(out);
        else reject(new ExtractionError(`claude -p exited ${code}: ${err.slice(0, 400)}`));
      });
      child.stdin.write(spec.input);
      child.stdin.end();
    });

    let doc: any;
    try {
      doc = JSON.parse(raw);
    } catch {
      throw new ExtractionError('claude -p returned non-JSON output');
    }
    if (doc.is_error) throw new ExtractionError(`claude -p error: ${String(doc.result).slice(0, 400)}`);

    // Structured output location varies by CLI version; try the known spots.
    let value: any = doc.structured_output ?? doc.structured_result ?? null;
    if (value == null && typeof doc.result === 'string') {
      try {
        value = JSON.parse(doc.result);
      } catch {
        throw new ExtractionError('no structured output in claude -p result');
      }
    }
    const problems = validate(spec.schema, value);
    if (problems.length > 0) {
      throw new ExtractionError(`schema mismatch: ${problems.slice(0, 3).join('; ')}`);
    }
    return { value: value as T, costUsd: doc.total_cost_usd ?? doc.cost_usd ?? null };
  }
}

const GATEWAY_HOST = 'ai-gateway.vercel.sh';

export class GatewayBackend implements ExtractionBackend {
  constructor(private apiKey: string, private model = 'anthropic/claude-sonnet-5') {
    enableGatewayHost(GATEWAY_HOST); // joins the allowlist only when configured
  }

  async run<T>(spec: ExtractionSpec): Promise<ExtractionResult<T>> {
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
    if (!res.ok) throw new ExtractionError(`gateway ${res.status}`);
    const doc: any = await res.json();
    const text = doc?.choices?.[0]?.message?.content;
    if (typeof text !== 'string') throw new ExtractionError('gateway returned no content');
    let value: any;
    try {
      value = JSON.parse(text);
    } catch {
      throw new ExtractionError('gateway returned non-JSON content');
    }
    const problems = validate(spec.schema, value);
    if (problems.length > 0) {
      throw new ExtractionError(`schema mismatch: ${problems.slice(0, 3).join('; ')}`);
    }
    return { value: value as T, costUsd: null };
  }
}

export function chooseBackend(): ExtractionBackend {
  const key = process.env.VOUCH_GATEWAY_KEY ?? process.env.AI_GATEWAY_API_KEY;
  if (process.env.VOUCH_BACKEND === 'gateway' && key) {
    return new GatewayBackend(key, process.env.VOUCH_GATEWAY_MODEL || undefined);
  }
  return new ClaudeCliBackend(process.env.VOUCH_CLAUDE_BIN || 'claude');
}

/** Wraps a backend with the local cost meter (`vouch status` prints it). */
export function metered(db: Db, backend: ExtractionBackend): ExtractionBackend {
  return {
    async run<T>(spec: ExtractionSpec): Promise<ExtractionResult<T>> {
      try {
        const result = await backend.run<T>(spec);
        db.prepare('INSERT INTO extraction_calls (id, task, ok, cost_usd, at) VALUES (?, ?, 1, ?, ?)')
          .run(ulid(), spec.task, result.costUsd, nowIso());
        return result;
      } catch (e) {
        db.prepare('INSERT INTO extraction_calls (id, task, ok, cost_usd, at) VALUES (?, ?, 0, NULL, ?)')
          .run(ulid(), spec.task, nowIso());
        throw e;
      }
    },
  };
}
