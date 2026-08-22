/** Extraction schemas and system prompts (tech spec §7.1, §7.2 shapes). */
export declare const DOSSIER_SCHEMA: {
    readonly type: "object";
    readonly required: readonly ["what_it_does_here", "if_it_vanished", "probe_question", "probe_expected"];
    readonly properties: {
        readonly what_it_does_here: {
            readonly type: "string";
            readonly description: "Its role in THIS repo, grounded in the provided call sites. Never the README pitch.";
        };
        readonly replaced: {
            readonly type: readonly ["string", "null"];
            readonly description: "What it displaced, if the diff shows something removed";
        };
        readonly if_it_vanished: {
            readonly type: "string";
            readonly description: "The concrete work required to remove it";
        };
        readonly probe_question: {
            readonly type: "string";
            readonly description: "One question that cannot be answered without understanding its role here";
        };
        readonly probe_expected: {
            readonly type: "string";
            readonly description: "What a correct answer must contain. Withheld until reveal.";
        };
    };
};
export declare const DOSSIER_SYSTEM = "You are writing a dependency dossier for a developer who must be able to defend every package in their own repository. You are given the package name and its REAL call sites from their code. Ground every sentence in those call sites. Never recite the package's marketing pitch. The probe_question must be answerable only by someone who understands what this package does in THIS codebase, and probe_expected must state concretely what a correct answer contains. Write plainly. Never use an em-dash.";
export declare const GRADE_SCHEMA: {
    readonly type: "object";
    readonly required: readonly ["verdict", "gap", "grader_confidence"];
    readonly properties: {
        readonly verdict: {
            readonly type: "string";
            readonly enum: readonly ["pass", "partial", "fail"];
        };
        readonly gap: {
            readonly type: "string";
            readonly description: "The specific thing the answer failed to produce. Empty string when verdict is pass.";
        };
        readonly grader_confidence: {
            readonly type: "string";
            readonly enum: readonly ["high", "low"];
        };
    };
};
export declare const GRADE_SYSTEM = "You are grading one piece of text against another. The EXPECTED text is the sole ground truth; the developer's ANSWER either demonstrates that understanding or it does not. You have no filesystem, no repository, and no tools, and you need none: never attempt to read files, never say you cannot verify something, never require access to anything. Compare the two texts and grade the substance, not the wording. pass: the answer demonstrates the understanding the expected text describes. partial: some of it, with a real gap. fail: the answer is wrong or empty of the required understanding. Set grader_confidence to low whenever a fair human grader might disagree; a low-confidence grade never promotes, so err toward low. In gap, name the specific missing piece in one sentence, quoting only from the expected text. Never use an em-dash.";
export declare const CONCEPTS_SCHEMA: {
    readonly type: "object";
    readonly required: readonly ["concepts"];
    readonly properties: {
        readonly concepts: {
            readonly type: "array";
            readonly maxItems: 8;
            readonly items: {
                readonly type: "object";
                readonly required: readonly ["label", "paths"];
                readonly properties: {
                    readonly label: {
                        readonly type: "string";
                        readonly description: "Canonical name of the technique or concept, 2 to 5 words";
                    };
                    readonly paths: {
                        readonly type: "array";
                        readonly items: {
                            readonly type: "string";
                        };
                        readonly description: "Files in the diff where it appears";
                    };
                };
            };
        };
    };
};
export declare const CONCEPTS_SYSTEM = "You extract the genuinely load-bearing concepts from a code diff: the techniques a developer must understand to defend this change (for example: optimistic locking, JWT refresh rotation, debounced writes, cursor pagination). Skip trivia and framework boilerplate. At most 8, fewer is better. Never use an em-dash.";
export declare const BRIEF_SCHEMA: {
    readonly type: "object";
    readonly required: readonly ["name", "approach", "concepts", "rejected", "assumptions", "breaks_first", "flow_correct", "flow_distractors"];
    readonly properties: {
        readonly name: {
            readonly type: "string";
            readonly description: "Short name for what this change accomplishes, 2 to 6 words";
        };
        readonly approach: {
            readonly type: "array";
            readonly minItems: 3;
            readonly maxItems: 5;
            readonly items: {
                readonly type: "string";
            };
        };
        readonly concepts: {
            readonly type: "array";
            readonly items: {
                readonly type: "string";
            };
        };
        readonly rejected: {
            readonly type: "array";
            readonly items: {
                readonly type: "object";
                readonly required: readonly ["option", "why_not"];
                readonly properties: {
                    readonly option: {
                        readonly type: "string";
                    };
                    readonly why_not: {
                        readonly type: "string";
                    };
                };
            };
        };
        readonly assumptions: {
            readonly type: "array";
            readonly minItems: 1;
            readonly items: {
                readonly type: "string";
            };
            readonly description: "Load-bearing. If false, the feature is wrong, not merely buggy.";
        };
        readonly breaks_first: {
            readonly type: "array";
            readonly minItems: 3;
            readonly maxItems: 3;
            readonly items: {
                readonly type: "string";
            };
        };
        readonly flow_correct: {
            readonly type: "string";
            readonly description: "One sentence describing how data actually moves through this change.";
        };
        readonly flow_distractors: {
            readonly type: "array";
            readonly minItems: 3;
            readonly maxItems: 3;
            readonly items: {
                readonly type: "string";
            };
            readonly description: "Three WRONG one-sentence flow descriptions. Each must be plausible for THIS repository and reference real files or symbols from the diff, wrong only in the direction, ordering, or responsibility of the flow. Never obviously absurd.";
        };
    };
};
export declare const BRIEF_SYSTEM = "You are writing a build brief for a change a developer just shipped, so that later they can be asked to reconstruct it from memory. Work only from the diff you are given. Be concrete and name real files and symbols. \"assumptions\" must be load-bearing: things that, if false, make the feature wrong rather than merely buggy. \"breaks_first\" names exactly three places this will fail first in production. The distractors are teaching material: each must be plausible enough that someone who skimmed the code could pick it, and wrong in a way that matters. You have no filesystem and no tools, and you need none. Never use an em-dash.";
export declare const DEFEND_GRADE_SCHEMA: {
    readonly type: "object";
    readonly required: readonly ["verdict", "gap", "grader_confidence"];
    readonly properties: {
        readonly verdict: {
            readonly type: "string";
            readonly enum: readonly ["pass", "partial", "fail"];
        };
        readonly gap: {
            readonly type: "string";
            readonly description: "The specific thing the reconstruction missed. Empty string when verdict is pass.";
        };
        readonly grader_confidence: {
            readonly type: "string";
            readonly enum: readonly ["high", "low"];
        };
    };
};
export declare const DEFEND_GRADE_SYSTEM = "You are grading one piece of text against another. The developer was asked to reconstruct, from memory, what a change they shipped does and what it assumes. You are given the real brief (ground truth) and their reconstruction. You have no filesystem, no repository, and no tools, and you need none: never attempt to read files, never say you cannot verify something, never require access to anything. Grade whether their reconstruction demonstrates the understanding in the brief's approach and assumptions. pass: they captured what it does and at least one load-bearing assumption. partial: they captured what it does but no real assumption, or the reverse. fail: the reconstruction is wrong or empty of the required understanding. Set grader_confidence to low whenever a fair human grader might disagree; a low-confidence grade never promotes, so err toward low. In gap, name the single most important thing they missed, in one sentence, quoting only from the brief. Never use an em-dash.";
