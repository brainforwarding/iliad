// Pure module (no Node, Electron or DOM imports): shared by the app and the
// Iliad AI proxy Worker, so request limits, pinned model parameters and output
// budgets have one source. Spec: specs/2026-09-25-groq-ai-free-tier.md §2, §4.

/** The single model behind all built-in writing AI (owner decision). */
export const GROQ_MODEL = "openai/gpt-oss-120b";
export const GROQ_REASONING_EFFORT = "low";

/**
 * Parameters pinned on every chat-completions request, on both routes (the
 * Worker sets them itself on the free route). No tools, no response_format,
 * no stop, default temperature.
 */
export const GROQ_PINNED_PARAMS = {
  model: GROQ_MODEL,
  reasoning_effort: GROQ_REASONING_EFFORT,
  include_reasoning: false,
  stream: true,
  stream_options: { include_usage: true },
  n: 1
} as const;

// Request limits (UTF-16 code units, i.e. JS string length). Main enforces
// them before a request; the Worker rejects anything beyond them.
export const AUTOCOMPLETE_MAX_PREFIX_CHARS = 2500;
export const AUTOCOMPLETE_MAX_SUFFIX_CHARS = 1000;
export const AUTOCOMPLETE_MAX_HEADING_COUNT = 8;
export const AUTOCOMPLETE_MAX_TITLE_CHARS = 120;
/** Each heading in `headingPath` / `nearbyHeadings`. */
export const AUTOCOMPLETE_MAX_HEADING_CHARS = 120;
export const AUTOCOMPLETE_MAX_DIRECTION_CHARS = 240;
/** `avoid` holds the previous candidates for "Another"; at most this many. */
export const AUTOCOMPLETE_MAX_AVOID_COUNT = 3;

// Output caps per suggestion kind (chars). The app's cleaner rejects longer
// output, and the SSE reader / Worker stop forwarding past them.
export const AUTOCOMPLETE_MAX_SENTENCE_OUTPUT_CHARS = 420;
export const AUTOCOMPLETE_MAX_PARAGRAPH_OUTPUT_CHARS = 700;
export const AUTOCOMPLETE_MAX_IDEA_OUTPUT_CHARS = 2400;
/** Each `avoid` entry is a previous candidate, so it is at most an idea long. */
export const AUTOCOMPLETE_MAX_AVOID_CHARS = AUTOCOMPLETE_MAX_IDEA_OUTPUT_CHARS;

export const TIGHTEN_MAX_INPUT_CHARS = 4000;
export const TIGHTEN_MAX_INSTRUCTION_CHARS = 1000;

/** Selection output cap: max(400, 3 × selected text), at most 12,000 chars. */
export const SELECTION_MIN_OUTPUT_CHARS = 400;
export const SELECTION_MAX_OUTPUT_CHARS = 12000;

/**
 * `max_completion_tokens` per autocomplete kind. On gpt-oss it bounds billed
 * reasoning + content (Phase 0 gate, passed 2026-09-25), so each budget is
 * reasoning headroom plus the kind's longest accepted answer.
 */
export const GROQ_AUTOCOMPLETE_MAX_COMPLETION_TOKENS = {
  sentence: 768,
  paragraph: 1024,
  idea: 2048
} as const;

/** Reasoning headroom added to a selection transform's answer budget. */
export const GROQ_SELECTION_REASONING_TOKENS = 1024;
export const GROQ_SELECTION_MAX_COMPLETION_TOKENS = 4096;

/**
 * Chat-template overhead Groq bills on top of the message bytes, measured by
 * `npm run benchmark:autocomplete -- --budget-probe` (Phase 0, 2026-09-25,
 * prompt v1, gpt-oss-120b): 71 tokens. The Worker's reservation bound is
 * `UTF-8 bytes + PROMPT_OVERHEAD_TOKENS`, configured at ≥ 2× the measurement;
 * re-measure when a prompt version or the model changes.
 */
export const MEASURED_PROMPT_OVERHEAD_TOKENS = 71;
export const MIN_PROMPT_OVERHEAD_TOKENS = 150;
