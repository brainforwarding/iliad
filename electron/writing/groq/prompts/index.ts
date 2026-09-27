// Pure entry point of the versioned prompt module (no Node, Electron or DOM
// imports). The app sends each task with the version `promptVersionFor`
// picks for its route (not always the newest: on the free route autocomplete
// and selection stay on v1 until a Worker serving v2 is deployed); the Iliad
// AI proxy Worker serves every version it still lists in
// SUPPORTED_PROMPT_VERSIONS.
// Spec: specs/2026-09-25-groq-ai-free-tier.md §2, §4;
// specs/2026-09-27-name-untitled-documents.md (prompt v2, versions per task);
// specs/2026-09-27-ai-context-and-preferences.md (versions per route).

import { GROQ_PINNED_PARAMS } from "./limits.js";
import { buildPromptV1, parseWritingAiTaskV1, type TaskValidation, type WritingAiPrompt, type WritingAiTaskV1 } from "./v1.js";
import { buildPromptV2, parseWritingAiTaskV2, type WritingAiTaskV2 } from "./v2.js";

export * from "./limits.js";
export {
  CONTEXT_CURSOR_MARKER,
  CONTEXT_OMISSION,
  CONTEXT_PASSAGE_MARKER,
  OUTLINE_CURSOR_MARK,
  buildDocumentOutline,
  collectOutlineHeadings,
  containsPromptDelimiter,
  jsonStringUtf8Bytes,
  neutralizePromptDelimiters,
  safeBoundary,
  trimDocumentForContext,
  type OutlineHeading,
  type TrimDocumentInput,
  type TrimmedDocument
} from "./context.js";
export {
  autocompleteMaxOutputChars,
  buildPromptV1,
  parseWritingAiTaskV1,
  selectionMaxCompletionTokens,
  selectionMaxOutputChars,
  type AutocompleteKind,
  type AutocompleteTaskV1,
  type ChatMessage,
  type SelectionMode,
  type SelectionRange,
  type SelectionTaskV1,
  type TaskValidation,
  type WritingAiPrompt,
  type WritingAiTaskV1,
  type WritingLanguage
} from "./v1.js";
export {
  autocompleteModelInputV2,
  buildPromptV2,
  selectionModelInputV2,
  nameInstruction,
  nameModelInput,
  parseWritingAiTaskV2,
  type AutocompleteTaskV2,
  type NameTaskV2,
  type SelectionTaskV2,
  type WritingAiTaskV2
} from "./v2.js";

/** Every task shape of every version still served. */
export type WritingAiTask = WritingAiTaskV1 | WritingAiTaskV2;
export type PromptVersion = WritingAiTask["v"];

export const LATEST_PROMPT_VERSION = 2 as const satisfies PromptVersion;

export type WritingAiTaskKind = WritingAiTask["task"];
export type WritingAiRouteKind = "free" | "own-key";

/**
 * TEMPORARY — removed at release, once the Worker serving v2 is deployed
 * (docs/release.md): then every route sends v2 and `promptVersionFor` goes.
 *
 * The version the free route sends per task. Only `name` (new in v2) is sent
 * as v2 there, so the deployed Worker (v1 prompts for autocomplete/selection)
 * keeps working and a Worker without v2 disables only document naming
 * (specs 2026-09-27 name-untitled-documents and ai-context-and-preferences).
 */
export const FREE_ROUTE_PROMPT_VERSIONS = Object.freeze({
  autocomplete: 1,
  selection: 1,
  name: 2
} as const satisfies Record<WritingAiTaskKind, PromptVersion>);

/**
 * The prompt version for a task, resolved after the route (spec 2026-09-27
 * Review "Versions"): the own-key route builds prompts locally, so it always
 * sends the newest; the free route follows FREE_ROUTE_PROMPT_VERSIONS.
 * TEMPORARY: removed at release when everything is v2.
 */
export function promptVersionFor(route: WritingAiRouteKind, task: WritingAiTaskKind): PromptVersion {
  return route === "own-key" ? LATEST_PROMPT_VERSION : FREE_ROUTE_PROMPT_VERSIONS[task];
}

const BUILDERS: { [V in PromptVersion]: (task: Extract<WritingAiTask, { v: V }>) => WritingAiPrompt } = {
  1: buildPromptV1,
  2: buildPromptV2
};

const PARSERS: { [V in PromptVersion]: (input: unknown) => TaskValidation<Extract<WritingAiTask, { v: V }>> } = {
  1: parseWritingAiTaskV1,
  2: parseWritingAiTaskV2
};

export const PROMPT_VERSIONS: readonly PromptVersion[] = Object.freeze(Object.keys(BUILDERS).map(Number) as PromptVersion[]);

export function isPromptVersion(value: unknown): value is PromptVersion {
  return typeof value === "number" && Object.prototype.hasOwnProperty.call(BUILDERS, value);
}

/** Messages, completion budget and output cap for a task, by its own `v`. */
export function buildWritingAiPrompt(task: WritingAiTask): WritingAiPrompt {
  return task.v === 2 ? BUILDERS[2](task) : BUILDERS[1](task);
}

/**
 * Strict parse of an untrusted task: unknown `v` → `{ ok: false, field: "v" }`
 * (the Worker answers `client_outdated`), anything else invalid → the first
 * offending field (`bad_request`). Unknown fields are rejected.
 */
export function parseWritingAiTask(input: unknown): TaskValidation<WritingAiTask> {
  const v = typeof input === "object" && input !== null ? (input as { v?: unknown }).v : undefined;
  if (!isPromptVersion(v)) return { ok: false, field: "v" };
  return v === 2 ? PARSERS[2](input) : PARSERS[1](input);
}

/**
 * The OpenAI-compatible chat-completions body for Groq: the prompt plus the
 * pinned params. Both routes send exactly this (the Worker builds it itself).
 */
export function groqChatCompletionBody(prompt: WritingAiPrompt) {
  return {
    ...GROQ_PINNED_PARAMS,
    messages: prompt.messages.map((message) => ({ role: message.role, content: message.content })),
    max_completion_tokens: prompt.maxCompletionTokens
  };
}

export type GroqChatCompletionBody = ReturnType<typeof groqChatCompletionBody>;

/** UTF-8 bytes of every message's content: the input side of the Worker's reservation bound. */
export function promptUtf8Bytes(prompt: Pick<WritingAiPrompt, "messages">): number {
  let bytes = 0;
  for (const message of prompt.messages) bytes += utf8ByteLength(message.content);
  return bytes;
}

/** Pure UTF-8 length (no TextEncoder, so it needs no DOM or Node lib). Lone surrogates count as U+FFFD (3 bytes). */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else bytes += 3;
  }
  return bytes;
}
