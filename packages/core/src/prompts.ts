/** Extraction schemas and system prompts (tech spec §7.1, §7.2 shapes). */

export const DOSSIER_SCHEMA = {
  type: 'object',
  required: ['what_it_does_here', 'if_it_vanished', 'probe_question', 'probe_expected'],
  properties: {
    what_it_does_here: {
      type: 'string',
      description: 'Its role in THIS repo, grounded in the provided call sites. Never the README pitch.',
    },
    replaced: { type: ['string', 'null'], description: 'What it displaced, if the diff shows something removed' },
    if_it_vanished: { type: 'string', description: 'The concrete work required to remove it' },
    probe_question: {
      type: 'string',
      description: 'One question that cannot be answered without understanding its role here',
    },
    probe_expected: {
      type: 'string',
      description:
        'The answer itself, stated plainly enough to show the developer verbatim after they attempt the probe. Withheld until reveal.',
    },
  },
} as const;

export const DOSSIER_SYSTEM = `You are writing a dependency dossier for a developer who must be able to defend every package in their own repository. You are given the package name and its REAL call sites from their code. Ground every sentence in those call sites. Never recite the package's marketing pitch. The probe_question must be answerable only by someone who understands what this package does in THIS codebase, and probe_expected must state concretely what a correct answer contains, written as the answer itself so it can be shown to the developer verbatim after they attempt it. When you are told no call sites were found, the package is not used here: say so in what_it_does_here, and do NOT ask where it is imported or instantiated, because that question has no answer in this repository and teaches nothing. Ask instead why it is in the manifest, what would have to change to remove it, or what it was brought in to do. Write plainly. Never use an em-dash.`;

export const GRADE_SCHEMA = {
  type: 'object',
  required: ['verdict', 'gap', 'grader_confidence'],
  properties: {
    verdict: { type: 'string', enum: ['pass', 'partial', 'fail'] },
    gap: {
      type: 'string',
      description:
        'The missing piece, stated as the fact the developer should now learn, not as what they failed to write. Empty string when verdict is pass.',
    },
    grader_confidence: { type: 'string', enum: ['high', 'low'] },
  },
} as const;

export const GRADE_SYSTEM = `You are grading one piece of text against another. The EXPECTED text is the sole ground truth; the developer's ANSWER either demonstrates that understanding or it does not. You have no filesystem, no repository, and no tools, and you need none: never attempt to read files, never say you cannot verify something, never require access to anything. Compare the two texts and grade the substance, not the wording. pass: the answer demonstrates the understanding the expected text describes. partial: some of it, with a real gap. fail: the answer is wrong or empty of the required understanding. Set grader_confidence to low whenever a fair human grader might disagree; a low-confidence grade never promotes, so err toward low. In gap, TEACH the missing piece: state it as the fact itself, in one sentence, drawn only from the expected text. Never write the gap as a complaint about what the developer failed to do, and never phrase it in the third person: "the boot sequence exits before the server binds" not "did not mention the boot sequence" or "the developer did not provide a file path". If the answer is an explicit admission of not knowing, the verdict is fail with high confidence, and the gap is simply the answer. Never use an em-dash.`;

export const CONCEPTS_SCHEMA = {
  type: 'object',
  required: ['concepts'],
  properties: {
    concepts: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        required: ['label', 'paths'],
        properties: {
          label: { type: 'string', description: 'Canonical name of the technique or concept, 2 to 5 words' },
          paths: { type: 'array', items: { type: 'string' }, description: 'Files in the diff where it appears' },
        },
      },
    },
  },
} as const;

export const CONCEPTS_SYSTEM = `You extract the genuinely load-bearing concepts from a code diff: the techniques a developer must understand to defend this change (for example: optimistic locking, JWT refresh rotation, debounced writes, cursor pagination). Skip trivia and framework boilerplate. At most 8, fewer is better. Never use an em-dash.`;

// ---------- Phase 1: build briefs and recognition items (tech spec §7.2) ----------

export const BRIEF_SCHEMA = {
  type: 'object',
  required: ['name', 'approach', 'concepts', 'rejected', 'assumptions', 'breaks_first', 'flow_correct', 'flow_distractors'],
  properties: {
    name: { type: 'string', description: 'Short name for what this change accomplishes, 2 to 6 words' },
    approach: { type: 'array', minItems: 3, maxItems: 5, items: { type: 'string' } },
    concepts: { type: 'array', items: { type: 'string' } },
    rejected: {
      type: 'array',
      items: {
        type: 'object',
        required: ['option', 'why_not'],
        properties: { option: { type: 'string' }, why_not: { type: 'string' } },
      },
    },
    assumptions: {
      type: 'array',
      minItems: 1,
      items: { type: 'string' },
      description: 'Load-bearing. If false, the feature is wrong, not merely buggy.',
    },
    breaks_first: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'string' } },
    flow_correct: {
      type: 'string',
      description: 'One sentence describing how data actually moves through this change.',
    },
    flow_distractors: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: { type: 'string' },
      description:
        'Three WRONG one-sentence flow descriptions. Each must be plausible for THIS repository and reference real files or symbols from the diff, wrong only in the direction, ordering, or responsibility of the flow. Never obviously absurd.',
    },
  },
} as const;

export const BRIEF_SYSTEM = `You are writing a build brief for a change a developer just shipped, so that later they can be asked to reconstruct it from memory. Work only from the diff you are given. Be concrete and name real files and symbols. "assumptions" must be load-bearing: things that, if false, make the feature wrong rather than merely buggy. "breaks_first" names exactly three places this will fail first in production. The distractors are teaching material: each must be plausible enough that someone who skimmed the code could pick it, and wrong in a way that matters. You have no filesystem and no tools, and you need none. Never use an em-dash.`;

export const DEFEND_GRADE_SCHEMA = {
  type: 'object',
  required: ['verdict', 'gap', 'grader_confidence'],
  properties: {
    verdict: { type: 'string', enum: ['pass', 'partial', 'fail'] },
    gap: {
      type: 'string',
      description:
        'What the reconstruction missed, stated as the fact itself rather than as a shortfall. Empty string when verdict is pass.',
    },
    grader_confidence: { type: 'string', enum: ['high', 'low'] },
  },
} as const;

export const DEFEND_GRADE_SYSTEM = `You are grading one piece of text against another. The developer was asked to reconstruct, from memory, what a change they shipped does and what it assumes. You are given the real brief (ground truth) and their reconstruction. You have no filesystem, no repository, and no tools, and you need none: never attempt to read files, never say you cannot verify something, never require access to anything. Grade whether their reconstruction demonstrates the understanding in the brief's approach and assumptions. pass: they captured what it does and at least one load-bearing assumption. partial: they captured what it does but no real assumption, or the reverse. fail: the reconstruction is wrong or empty of the required understanding. Set grader_confidence to low whenever a fair human grader might disagree; a low-confidence grade never promotes, so err toward low. In gap, TEACH the single most important thing they missed: state it as the fact itself, in one sentence, drawn only from the brief, never as a complaint about what they failed to write and never in the third person. Never use an em-dash.`;
