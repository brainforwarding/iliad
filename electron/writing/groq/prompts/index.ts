// Pure entry point of the versioned prompt module (no Node, Electron or DOM
// imports). The app sends every task, on both routes, as the newest version
// (LATEST_PROMPT_VERSION); the Iliad AI proxy Worker serves every version it
// still lists in SUPPORTED_PROMPT_VERSIONS, so older apps keep working.
// Spec: specs/2026-09-25-groq-ai-free-tier.md §2, §4;
// specs/2026-09-27-name-untitled-documents.md (prompt v2, versions per task);
// specs/2026-09-27-writing-rules-prompt-v3.md (prompt v3, one version for all).

import { GROQ_PINNED_PARAMS } from "./limits.js";
import { buildPromptV1, parseWritingAiTaskV1, type TaskValidation, type WritingAiPrompt, type WritingAiTaskV1 } from "./v1.js";
import { buildPromptV2, parseWritingAiTaskV2, type WritingAiTaskV2 } from "./v2.js";
import { buildPromptV3, parseWritingAiTaskV3, type WritingAiTaskV3 } from "./v3.js";

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
export {
  EDIT_INSTRUCTION_STYLE_RULE,
  PREFERENCES_LABEL_V3,
  PREFERENCES_RULE_V3,
  TIGHTEN_STYLE_RULE,
  WRITING_STYLE_RULES,
  buildPromptV3,
  parseWritingAiTaskV3,
  type AutocompleteTaskV3,
  type NameTaskV3,
  type SelectionTaskV3,
  type WritingAiTaskV3
} from "./v3.js";

/** Every task shape of every version still served. */
export type WritingAiTask = WritingAiTaskV1 | WritingAiTaskV2 | WritingAiTaskV3;
export type PromptVersion = WritingAiTask["v"];

/** Every version still served, oldest first (the Worker's SUPPORTED_PROMPT_VERSIONS must be a subset). */
export const PROMPT_VERSIONS: readonly PromptVersion[] = Object.freeze([1, 2, 3] as const);

/** The version both routes send for every task. */
export const LATEST_PROMPT_VERSION = 3 as const satisfies PromptVersion;

export type WritingAiTaskKind = WritingAiTask["task"];

export function isPromptVersion(value: unknown): value is PromptVersion {
  return typeof value === "number" && (PROMPT_VERSIONS as readonly number[]).includes(value);
}

/** Messages, completion budget and output cap for a task, by its own `v`. */
export function buildWritingAiPrompt(task: WritingAiTask): WritingAiPrompt {
  switch (task.v) {
    case 1:
      return buildPromptV1(task);
    case 2:
      return buildPromptV2(task);
    case 3:
      return buildPromptV3(task);
    default:
      return unknownVersion(task);
  }
}

/**
 * Strict parse of an untrusted task: unknown `v` → `{ ok: false, field: "v" }`
 * (the Worker answers `client_outdated`), anything else invalid → the first
 * offending field (`bad_request`). Unknown fields are rejected.
 */
export function parseWritingAiTask(input: unknown): TaskValidation<WritingAiTask> {
  const v = typeof input === "object" && input !== null ? (input as { v?: unknown }).v : undefined;
  if (!isPromptVersion(v)) return { ok: false, field: "v" };
  switch (v) {
    case 1:
      return parseWritingAiTaskV1(input);
    case 2:
      return parseWritingAiTaskV2(input);
    case 3:
      return parseWritingAiTaskV3(input);
    default:
      return unknownVersion(v);
  }
}

/** Exhaustiveness: adding a version without a builder and a parser fails to compile. */
function unknownVersion(value: never): never {
  throw new Error(`unknown prompt version: ${JSON.stringify(value)}`);
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
