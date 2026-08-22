import type { Db } from './db.js';
import type { ExtractionBackend } from './extraction.js';
import { ExtractionError } from './extraction.js';
import { sessionPrompts, type StoredPrompt } from './promptlog.js';

/**
 * `vouch prompts`: read back the prompts you actually sent in a session and
 * say how they could have been fewer and sharper.
 *
 * The division of labour matters for honesty. The MODEL judges each prompt
 * (was this a correction of the last one? was the goal stated?) because that
 * is a judgement. The ARITHMETIC is done here, deterministically, because a
 * model asked to estimate token savings will simply invent a number.
 */

export const PROMPT_REVIEW_SCHEMA = {
  type: 'object',
  required: ['prompts', 'patterns', 'biggest_win'],
  properties: {
    prompts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['seq', 'verdict', 'issue', 'rewrite', 'avoidable'],
        properties: {
          seq: { type: 'number', description: 'The 1-based number of the prompt being judged' },
          verdict: {
            type: 'string',
            enum: ['fine', 'vague', 'correction', 'overloaded', 'missing-context', 'missing-criteria'],
            description: '"correction" means this prompt exists only because an earlier one was underspecified',
          },
          issue: { type: 'string', description: 'What specifically was missing or wrong. One sentence. Empty when the verdict is fine.' },
          rewrite: { type: 'string', description: 'The prompt they should have sent instead. Concrete, using their own details. Empty when the verdict is fine.' },
          avoidable: {
            type: 'boolean',
            description: 'True only when a better EARLIER prompt would have removed the need for this one entirely',
          },
        },
      },
    },
    patterns: {
      type: 'array',
      items: { type: 'string' },
      description: 'Habits visible across the whole session, not single-prompt notes. At most 4.',
    },
    biggest_win: { type: 'string', description: 'The single change that would most improve their next session' },
  },
} as const;

export const PROMPT_REVIEW_SYSTEM = `You review a developer's prompts from one coding session with an AI assistant and tell them how to prompt better. You see only the prompts, never the assistant's replies, so judge what the prompts themselves reveal.

Mark a prompt "correction" only when it exists because an EARLIER prompt was underspecified: it narrows, corrects, re-scopes, or re-asks something that a better first prompt would have covered. Set avoidable=true only in that case. A prompt that moves on to genuinely new work is "fine" even if it is short, and a follow-up that could not reasonably have been anticipated is not avoidable.

Mark a prompt "overloaded" when it bundles work that should have been separate requests: two or more unrelated tasks joined by "and also", a feature plus a refactor, or implementation plus documentation. Those are not avoidable (the work was real), but they cost quality, because a single reply has to split its attention. Say so and show the split.

Be concrete and use their actual subject matter in every rewrite. Never write a generic tip like "be more specific". A rewrite must be a prompt they could paste. Do not flatter, and do not invent problems: if a session was well prompted, say so and mark the prompts fine. Never use an em-dash.`;

export interface PromptVerdict {
  seq: number;
  verdict: 'fine' | 'vague' | 'correction' | 'overloaded' | 'missing-context' | 'missing-criteria';
  issue: string;
  rewrite: string;
  avoidable: boolean;
  text: string;
}

export interface PromptReview {
  claudeSession: string;
  total: number;
  prompts: PromptVerdict[];
  patterns: string[];
  biggestWin: string;
  avoidable: number;
  estimatedTokensWasted: number;
  estimatedPercent: number;
  method: string;
}

/** Rough but standard: about four characters per token for English prose. */
const CHARS_PER_TOKEN = 4;

/**
 * Assumed size of one assistant turn, used only to model how the conversation
 * grows. Stated in the output so the number is never mistaken for a measured
 * one: hooks do not report usage, so Vouch cannot see real token counts.
 */
const ASSUMED_REPLY_TOKENS = 1200;

/**
 * Every turn re-sends the whole conversation. So a prompt that only exists
 * because an earlier one was vague costs the entire context up to that point,
 * not just its own length. That is the arithmetic, done here rather than by
 * the model.
 */
export function estimateWaste(prompts: StoredPrompt[], avoidableSeqs: Set<number>) {
  let context = 0;
  let wasted = 0;
  let total = 0;
  for (const p of prompts) {
    const promptTokens = Math.ceil(p.chars / CHARS_PER_TOKEN);
    const turnCost = context + promptTokens;
    total += turnCost;
    if (avoidableSeqs.has(p.seq)) wasted += turnCost;
    context += promptTokens + ASSUMED_REPLY_TOKENS;
  }
  return {
    wasted,
    total,
    percent: total > 0 ? (100 * wasted) / total : 0,
  };
}

/**
 * Models reach for em-dashes no matter what the system prompt says, and this
 * text is shown to the user as product output. Instruction plus enforcement.
 */
function noDashes(text: string): string {
  return text.replace(/\s+[—–]\s+/g, ', ').replace(/[—–]/g, ', ').replace(/,\s*,/g, ',');
}

export async function reviewPrompts(
  db: Db,
  backend: ExtractionBackend,
  claudeSession: string,
): Promise<PromptReview> {
  const prompts = sessionPrompts(db, claudeSession);
  if (prompts.length === 0) throw new Error('no prompts recorded for that session');

  const input = [
    `Session with ${prompts.length} prompts, in order:`,
    ...prompts.map((p) => `[${p.seq}] ${p.text}`),
    '',
    'Review these prompts now. Respond only through the structured output.',
  ].join('\n\n');

  let value: { prompts: any[]; patterns: string[]; biggest_win: string };
  try {
    ({ value } = await backend.run<typeof value>({
      task: 'grade',
      system: PROMPT_REVIEW_SYSTEM,
      input,
      schema: PROMPT_REVIEW_SCHEMA,
    }));
  } catch (e) {
    if (e instanceof ExtractionError) throw new Error(`prompt review needs the AI backend: ${e.message}`);
    throw e;
  }

  const bySeq = new Map(prompts.map((p) => [p.seq, p]));
  const verdicts: PromptVerdict[] = (value.prompts ?? [])
    .filter((v) => bySeq.has(v.seq))
    .map((v) => ({
      seq: v.seq,
      verdict: v.verdict,
      issue: noDashes(v.issue ?? ''),
      rewrite: noDashes(v.rewrite ?? ''),
      avoidable: Boolean(v.avoidable),
      text: bySeq.get(v.seq)!.text,
    }));

  const avoidableSeqs = new Set(verdicts.filter((v) => v.avoidable).map((v) => v.seq));
  const { wasted, percent } = estimateWaste(prompts, avoidableSeqs);

  return {
    claudeSession,
    total: prompts.length,
    prompts: verdicts,
    patterns: (value.patterns ?? []).slice(0, 4).map(noDashes),
    biggestWin: noDashes(value.biggest_win ?? ''),
    avoidable: avoidableSeqs.size,
    estimatedTokensWasted: wasted,
    estimatedPercent: percent,
    method:
      `Estimate, not a measurement: hooks do not report token usage. Prompt length is counted at ${CHARS_PER_TOKEN} characters per token, each assistant turn is assumed to be ${ASSUMED_REPLY_TOKENS} tokens, and every avoidable prompt is charged the full conversation up to that point, because each turn re-sends it.`,
  };
}
