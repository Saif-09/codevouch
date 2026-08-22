#!/usr/bin/env -S node --no-warnings
/**
 * Minimal stdio MCP server exposing the one tool Claude needs to report a
 * Hunch exchange back to Vouch.
 *
 * This exists because the prediction and its outcome live only in the
 * conversation, and hard rule 7 forbids reading transcripts. An MCP tool is
 * the documented, permissioned channel for Claude to hand that back.
 */
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { loadCore, dbFile } from './lib.mjs';

const TOOLS = [
  {
    name: 'vouch_record_hunch',
    description:
      'Record the outcome of a Vouch prediction step. Call this exactly once, after you have answered the user\'s original request, whenever a VOUCH instruction block asked you to run a prediction step.',
    inputSchema: {
      type: 'object',
      required: ['repo_root', 'topic', 'prediction', 'matched'],
      properties: {
        repo_root: { type: 'string', description: 'Absolute path of the repository the user is working in' },
        topic: { type: 'string', description: 'Short name for what the question was about, 2 to 6 words' },
        prediction: { type: 'string', description: "The user's prediction, verbatim. Use \"skip\" if they declined." },
        matched: { type: 'boolean', description: "Whether their prediction matched the shape of your answer" },
        note: { type: 'string', description: 'One line naming the difference between the prediction and the answer' },
      },
    },
  },
];

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function result(id, payload) {
  send({ jsonrpc: '2.0', id, result: payload });
}

function failure(id, message) {
  send({ jsonrpc: '2.0', id, error: { code: -32603, message } });
}

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    result(id, {
      protocolVersion: params?.protocolVersion ?? '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'vouch', version: '0.1.0' },
    });
    return;
  }
  if (method === 'notifications/initialized' || method?.startsWith('notifications/')) return;
  if (method === 'tools/list') {
    result(id, { tools: TOOLS });
    return;
  }
  if (method === 'tools/call') {
    const args = params?.arguments ?? {};
    if (params?.name !== 'vouch_record_hunch') {
      failure(id, `unknown tool: ${params?.name}`);
      return;
    }
    if (!existsSync(dbFile())) {
      result(id, { content: [{ type: 'text', text: 'Vouch is not set up on this machine; nothing recorded.' }] });
      return;
    }
    try {
      const core = await loadCore();
      const db = core.openDb(dbFile());
      try {
        const res = core.recordHunch(db, {
          repoRoot: args.repo_root,
          topic: args.topic,
          prediction: args.prediction,
          matched: Boolean(args.matched),
          note: args.note,
        });
        const cal = res.calibration === null ? 'n/a' : `${Math.round(res.calibration)}%`;
        result(id, {
          content: [{ type: 'text', text: `Recorded. Calibration now ${cal}.` }],
        });
      } finally {
        db.close();
      }
    } catch (e) {
      // Never surface a Vouch failure as a tool error the user has to deal with.
      result(id, { content: [{ type: 'text', text: `Not recorded: ${e.message}` }] });
    }
    return;
  }
  if (id !== undefined) failure(id, `unknown method: ${method}`);
}

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const text = line.trim();
  if (!text) return;
  let msg;
  try {
    msg = JSON.parse(text);
  } catch {
    return;
  }
  handle(msg).catch(() => {
    if (msg?.id !== undefined) failure(msg.id, 'internal error');
  });
});
