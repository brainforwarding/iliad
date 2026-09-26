import type { AgentError } from "./errors.js";
import {
  AUTOCOMPLETE_MAX_IDEA_OUTPUT_CHARS,
  AUTOCOMPLETE_MAX_PARAGRAPH_OUTPUT_CHARS,
  AUTOCOMPLETE_MAX_SENTENCE_OUTPUT_CHARS
} from "./groq/prompts/limits.js";
import type { AutocompleteKind, WritingLanguage } from "./groq/prompts/v1.js";

export {
  AUTOCOMPLETE_MAX_HEADING_COUNT,
  AUTOCOMPLETE_MAX_IDEA_OUTPUT_CHARS,
  AUTOCOMPLETE_MAX_PARAGRAPH_OUTPUT_CHARS,
  AUTOCOMPLETE_MAX_PREFIX_CHARS,
  AUTOCOMPLETE_MAX_SENTENCE_OUTPUT_CHARS,
  AUTOCOMPLETE_MAX_SUFFIX_CHARS,
  AUTOCOMPLETE_MAX_TITLE_CHARS
} from "./groq/prompts/limits.js";
// Prompt builders live in the pure, versioned prompt module shared with the
// Iliad AI proxy (spec 2026-09-25 Groq AI free tier, §2); re-exported here.
export { autocompleteInstructions, autocompleteModelInput } from "./groq/prompts/v1.js";
export const AUTOCOMPLETE_TIMEOUT_MS = 18000;
/** A full idea is several paragraphs; give it room without letting it hang. */
export const AUTOCOMPLETE_IDEA_TIMEOUT_MS = 30000;

export type IdeaAutocompleteLanguage = WritingLanguage;
/** Suggestions only come from the length keys (spec 2026-09-25 writing assists): no automatic or inline kind. */
export type IdeaAutocompleteSuggestionKind = AutocompleteKind;

export interface IdeaAutocompleteTextRequest {
  requestId: string;
  language: IdeaAutocompleteLanguage;
  prefix: string;
  suffix: string;
  headingPath: string[];
  documentTitle: string;
  nearbyHeadings: string[];
  suggestionKind: IdeaAutocompleteSuggestionKind;
  /** The prefix ends with a visible, unaccepted suggestion that should be continued. */
  extend?: boolean;
  direction?: string;
  avoid?: string[];
  onPartial?: (raw: string) => void;
  signal: AbortSignal;
}

export type AutocompleteFailureReason =
  | "disabled"
  | "no_key"
  | "invalid_api_key"
  | "rate_limited"
  | "too_long"
  | "empty"
  | "timeout"
  | "provider"
  | "no_suggestion"
  | "aborted"
  | "untrusted";

export type IdeaAutocompleteResult =
  | { ok: true; insert: string }
  | { ok: false; reason: AutocompleteFailureReason };

export function normalizeAutocompleteLanguage(language: unknown): IdeaAutocompleteLanguage {
  return language === "es" ? "es" : "en";
}

function unwrapSingleLineQuotes(text: string) {
  const trimmed = text.trim();
  const pairs: Array<[string, string]> = [
    ['"', '"'],
    ["'", "'"]
  ];

  for (const [open, close] of pairs) {
    if (trimmed.length > open.length + close.length && trimmed.startsWith(open) && trimmed.endsWith(close)) {
      return trimmed.slice(open.length, trimmed.length - close.length);
    }
  }

  return text;
}

function removeEchoedPrefix(text: string, prefix: string) {
  const trimmedPrefix = prefix.trim();

  if (trimmedPrefix.length < 20) {
    return text;
  }

  const tail = trimmedPrefix.slice(Math.max(0, trimmedPrefix.length - 80));

  if (text.startsWith(tail)) {
    return text.slice(tail.length).replace(/^\s+/, " ");
  }

  return text;
}

function normalizeInsertionBoundary(text: string, prefix: string) {
  if (!text) {
    return text;
  }

  const prefixLast = prefix[prefix.length - 1] ?? "";
  const insertFirst = text[0] ?? "";

  if (/[\p{L}\p{N}.!?:;…\u201d\u2019"')\]]/u.test(prefixLast) && /[\p{L}\p{N}\u201c\u2018"']/u.test(insertFirst)) {
    return ` ${text}`;
  }

  if (/\s/.test(prefixLast)) {
    return text.replace(/^\s+/, "");
  }

  return text;
}

type AutocompleteCleanContext = { prefix: string; suffix: string; suggestionKind?: IdeaAutocompleteSuggestionKind; extend?: boolean };

function cleanInlineAutocompleteOutput(raw: string, context: AutocompleteCleanContext) {
  let text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/^\n+/, "").replace(/\n+$/, "");
  text = unwrapSingleLineQuotes(text);
  text = removeEchoedPrefix(text, context.prefix);
  text = text.replace(/[ \t]+\n/g, "\n");

  const maxChars = context.suggestionKind === "paragraph" ? AUTOCOMPLETE_MAX_PARAGRAPH_OUTPUT_CHARS
    : AUTOCOMPLETE_MAX_SENTENCE_OUTPUT_CHARS;
  if (text.startsWith("```") || /^#{1,6}\s/.test(text) || text.includes("\n") || text.length > maxChars) {
    return "";
  }

  const firstLine = text.split("\n")[0] ?? "";
  const cleaned = normalizeInsertionBoundary(firstLine, context.prefix);

  if (!cleaned.trim()) {
    return "";
  }

  const suffixStart = context.suffix.trimStart().slice(0, 40).toLowerCase();

  if (suffixStart.length > 10 && cleaned.trimStart().toLowerCase().startsWith(suffixStart)) {
    return "";
  }

  if (/^(sure|here|of course|i can|you can)\b/i.test(cleaned.trimStart())) {
    return "";
  }

  return cleaned;
}

function normalizeParagraphBoundary(text: string, prefix: string, multiple = false, extendDraft = false) {
  const trimmed = text.replace(/[ \t]+\n/g, "\n").replace(/[ \t]+$/g, "");

  if (!trimmed.trim()) {
    return "";
  }

  const body = trimmed.replace(/^\n+/, "").trim().replace(/\n{3,}/g, "\n\n");

  if (multiple
    ? body.length > AUTOCOMPLETE_MAX_IDEA_OUTPUT_CHARS || /(^|\n)\s*(?:```|~~~|#{1,6}\s)/.test(body)
    : /\n\s*\n/.test(body) || body.length > AUTOCOMPLETE_MAX_PARAGRAPH_OUTPUT_CHARS) {
    return "";
  }

  if (body.startsWith("```") || /^#{1,6}\s/.test(body)) {
    return "";
  }

  // Extending a visible draft: keep going inline unless the model deliberately
  // started a new block after it.
  if (multiple && extendDraft && !/^[ \t]*\n/.test(text)) {
    return normalizeInsertionBoundary(body, prefix);
  }

  if (/\n\s*\n/.test(prefix.slice(-4)) || /^\s*$/.test(prefix.slice(prefix.lastIndexOf("\n") + 1))) {
    return body;
  }

  if (/\n[ \t]*$/.test(prefix)) {
    return `\n${body}`;
  }

  // On a list item (even an empty "4. "), continue inside that item: the marker's
  // own period must not read as a finished sentence that starts a new paragraph.
  const currentLine = prefix.slice(prefix.lastIndexOf("\n") + 1);
  const listItem = /^\s*(?:[-*+]|\d+[.)])(?:\s+\[[ xX]\])?(\s+|$)(.*)$/.exec(currentLine);
  if (listItem) {
    // The model opening the next item ("4. …") starts a new line; anything else
    // continues the current item.
    if (/^(?:[-*+]|\d+[.)])\s/.test(body)) {
      return `\n${multiple ? body : body.split("\n")[0]}`;
    }
    const inline = multiple ? body : body.replace(/\s*\n\s*/g, " ");
    return listItem[2].trim() ? normalizeInsertionBoundary(inline, prefix) : /\s$/.test(prefix) ? inline : ` ${inline}`;
  }

  const lastLine = currentLine.trim();
  return /[.!?:;…]["'\u201d\u2019)\]]?$/.test(lastLine) || /^#{1,6}\s/.test(lastLine)
    ? `\n\n${body}`
    : normalizeInsertionBoundary(body, prefix);
}

function cleanParagraphAutocompleteOutput(raw: string, context: AutocompleteCleanContext) {
  let text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n+$/g, "");
  text = unwrapSingleLineQuotes(text);
  text = removeEchoedPrefix(text, context.prefix);
  const cleaned = normalizeParagraphBoundary(text, context.prefix, context.suggestionKind === "idea", context.extend === true);

  if (!cleaned.trim()) {
    return "";
  }

  const suffixStart = context.suffix.trimStart().slice(0, 40).toLowerCase();
  const comparable = cleaned.trimStart().toLowerCase();

  if (suffixStart.length > 10 && comparable.startsWith(suffixStart)) {
    return "";
  }

  if (/^(sure|here|of course|i can|you can)\b/i.test(cleaned.trimStart())) {
    return "";
  }

  return cleaned;
}

export function cleanAutocompleteOutput(raw: string, context: AutocompleteCleanContext) {
  // An extended paragraph continues the visible draft inline, so it is cleaned
  // like a (longer) single-line insertion.
  return context.suggestionKind === "idea" || (context.suggestionKind === "paragraph" && !context.extend)
    ? cleanParagraphAutocompleteOutput(raw, context)
    : cleanInlineAutocompleteOutput(raw, context);
}

export function autocompleteReasonFromAgentError(error: AgentError, timedOut: boolean): AutocompleteFailureReason {
  if (timedOut || error.code === "request_timeout") {
    return "timeout";
  }

  switch (error.code) {
    case "missing_api_key":
      return "no_key";
    case "invalid_api_key":
      return "invalid_api_key";
    case "rate_limited":
      return "rate_limited";
    case "request_canceled":
      return "aborted";
    case "provider_unavailable":
    case "network_unreachable":
    case "dns_failure":
    case "model_not_found":
    case "malformed_provider_response":
    case "output_truncated":
    case "content_blocked":
    case "unknown":
      return "provider";
  }
}
