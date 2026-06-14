import type { AgentError } from "./types.js";

export const AUTOCOMPLETE_MAX_PREFIX_CHARS = 2500;
export const AUTOCOMPLETE_MAX_SUFFIX_CHARS = 1000;
export const AUTOCOMPLETE_MAX_HEADING_COUNT = 8;
export const AUTOCOMPLETE_MAX_TITLE_CHARS = 120;
export const AUTOCOMPLETE_MAX_INLINE_OUTPUT_CHARS = 280;
export const AUTOCOMPLETE_MAX_PARAGRAPH_OUTPUT_CHARS = 700;
export const AUTOCOMPLETE_TIMEOUT_MS = 18000;
export const AUTOCOMPLETE_CODEX_MODEL_PREFERENCES = ["gpt-5.4-mini", "gpt-5.3-codex-spark"] as const;
export const AUTOCOMPLETE_API_MODEL = "gpt-5.4-mini";

export type IdeaAutocompleteLanguage = "en" | "es";
export type IdeaAutocompleteTrigger = "automatic" | "manual";
export type IdeaAutocompleteSuggestionKind = "inline" | "paragraph";

export interface IdeaAutocompleteTextRequest {
  requestId: string;
  language: IdeaAutocompleteLanguage;
  prefix: string;
  suffix: string;
  headingPath: string[];
  documentTitle: string;
  nearbyHeadings: string[];
  trigger: IdeaAutocompleteTrigger;
  suggestionKind: IdeaAutocompleteSuggestionKind;
  allowApiFallback: boolean;
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

export function autocompleteInstructions(language: IdeaAutocompleteLanguage, suggestionKind: IdeaAutocompleteSuggestionKind = "inline") {
  if (suggestionKind === "paragraph") {
    if (language === "es") {
      return [
        "Continúa el texto del usuario con el siguiente párrafo natural en el mismo idioma, voz y estructura Markdown.",
        "Devuelve solo el texto exacto que debe insertarse en el cursor.",
        "Escribe un solo párrafo breve de 1 a 3 oraciones.",
        "Si el cursor aún está al final de un párrafo o título, incluye los saltos de línea Markdown necesarios antes del nuevo párrafo.",
        "No repitas el prefijo, no agregues explicación, no uses bloques de código, no uses encabezados y no escribas más de un párrafo."
      ].join(" ");
    }

    return [
      "Continue the user's text with the next natural paragraph in the same language, voice, and Markdown structure.",
      "Return only the exact text to insert at the cursor.",
      "Write one short paragraph of 1 to 3 sentences.",
      "If the cursor is still at the end of a paragraph or heading, include the Markdown line breaks needed before the new paragraph.",
      "Do not repeat the prefix, do not explain, do not use code fences, do not use headings, and do not write more than one paragraph."
    ].join(" ");
  }

  if (language === "es") {
    return [
      "Continúa el pensamiento actual del usuario en el mismo idioma, voz y estructura Markdown.",
      "Devuelve solo el texto exacto que debe insertarse en el cursor.",
      "Escribe 3 a 15 palabras como máximo una oración corta.",
      "No repitas el prefijo, no agregues explicación, no uses bloques de código y no empieces una nueva sección."
    ].join(" ");
  }

  return [
    "Continue the user's current thought in the same language, voice, and Markdown structure.",
    "Return only the exact text to insert at the cursor.",
    "Write 3 to 15 words, at most one short sentence.",
    "Do not repeat the prefix, do not explain, do not use code fences, and do not start a new section."
  ].join(" ");
}

export function autocompleteModelInput(request: Omit<IdeaAutocompleteTextRequest, "signal" | "allowApiFallback">) {
  const headingPath = request.headingPath.length > 0 ? request.headingPath.join(" > ") : "(none)";
  const nearbyHeadings = request.nearbyHeadings.length > 0 ? request.nearbyHeadings.join(" | ") : "(none)";

  return [
    `Document title: ${request.documentTitle || "(untitled)"}`,
    `Heading path: ${headingPath}`,
    `Nearby headings: ${nearbyHeadings}`,
    `Trigger: ${request.trigger}`,
    `Suggestion kind: ${request.suggestionKind}`,
    "",
    "Text before cursor:",
    "<<<PREFIX>>>",
    request.prefix,
    "<<<END_PREFIX>>>",
    "",
    "Text after cursor:",
    "<<<SUFFIX>>>",
    request.suffix,
    "<<<END_SUFFIX>>>"
  ].join("\n");
}

export function autocompleteMaxOutputTokens(suggestionKind: IdeaAutocompleteSuggestionKind = "inline") {
  return suggestionKind === "paragraph" ? 140 : 48;
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

  if (/[\p{L}\p{N}]/u.test(prefixLast) && /[\p{L}\p{N}]/u.test(insertFirst)) {
    return ` ${text}`;
  }

  if (/\s/.test(prefixLast)) {
    return text.replace(/^\s+/, "");
  }

  return text;
}

function cleanInlineAutocompleteOutput(raw: string, context: { prefix: string; suffix: string }) {
  let text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/^\n+/, "").replace(/\n+$/, "");
  text = unwrapSingleLineQuotes(text);
  text = removeEchoedPrefix(text, context.prefix);
  text = text.replace(/[ \t]+\n/g, "\n");

  if (text.startsWith("```") || text.includes("\n") || text.length > AUTOCOMPLETE_MAX_INLINE_OUTPUT_CHARS) {
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

function normalizeParagraphBoundary(text: string, prefix: string) {
  const trimmed = text.replace(/[ \t]+\n/g, "\n").replace(/[ \t]+$/g, "");

  if (!trimmed.trim()) {
    return "";
  }

  const body = trimmed.replace(/^\n+/, "").trim();

  if (/\n\s*\n/.test(body) || body.length > AUTOCOMPLETE_MAX_PARAGRAPH_OUTPUT_CHARS) {
    return "";
  }

  if (body.startsWith("```") || /^#{1,6}\s/.test(body)) {
    return "";
  }

  if (/\n\s*\n/.test(prefix.slice(-4)) || /^\s*$/.test(prefix.slice(prefix.lastIndexOf("\n") + 1))) {
    return body;
  }

  if (/\n[ \t]*$/.test(prefix)) {
    return `\n${body}`;
  }

  return `\n\n${body}`;
}

function cleanParagraphAutocompleteOutput(raw: string, context: { prefix: string; suffix: string }) {
  let text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n+$/g, "");
  text = unwrapSingleLineQuotes(text);
  text = removeEchoedPrefix(text, context.prefix);
  const cleaned = normalizeParagraphBoundary(text, context.prefix);

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

export function cleanAutocompleteOutput(
  raw: string,
  context: { prefix: string; suffix: string; suggestionKind?: IdeaAutocompleteSuggestionKind }
) {
  return context.suggestionKind === "paragraph"
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
    case "unknown":
      return "provider";
  }
}
