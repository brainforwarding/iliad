import type { AgentError } from "./errors.js";
import { NAME_MAX_INPUT_CHARS, NAME_MAX_OUTPUT_CHARS } from "./groq/prompts/limits.js";
import type { WritingLanguage } from "./groq/prompts/v1.js";

// Names an untitled document from its opening text (prompt v2 `name` task).
// Pure helpers only; the IPC wiring (trust gate, abort map) lives in
// electron/ipc/documentName.ts and the Groq request in writingAiService.ts.
// Spec: specs/2026-09-27-name-untitled-documents.md.

export { NAME_MAX_INPUT_CHARS, NAME_MAX_OUTPUT_CHARS } from "./groq/prompts/limits.js";

/** A title is a short answer; don't let a slow route hold the naming attempt. */
export const DOCUMENT_NAME_TIMEOUT_MS = 10000;

export type DocumentNameLanguage = WritingLanguage;

export type DocumentNameFailureReason =
  | "invalid_api_key"
  /** Free route: today's quota is used up; `resetAt` says when it returns. */
  | "free_exhausted"
  | "free_unavailable"
  /** Free route: the proxy does not serve prompt v2 yet (or this app is below its minimum). */
  | "client_outdated"
  | "key_unreadable"
  | "unreachable"
  | "rate_limited"
  | "timeout"
  | "aborted"
  | "empty"
  | "too_long"
  | "untrusted"
  /** Provider error, or no usable title (empty, multi-line, overlong, control characters). */
  | "failed";

export type DocumentNameResult =
  | { ok: true; title: string }
  | { ok: false; reason: DocumentNameFailureReason; resetAt?: string };

export function normalizeDocumentNameLanguage(language: unknown): DocumentNameLanguage {
  return language === "es" ? "es" : "en";
}

/** Main is the authority for the input cap (the renderer slices to it already). */
export function validateDocumentNameText(text: unknown): { ok: true; text: string } | { ok: false; reason: "empty" | "too_long" } {
  if (typeof text !== "string" || !text.trim()) {
    return { ok: false, reason: "empty" };
  }

  if (text.length > NAME_MAX_INPUT_CHARS) {
    return { ok: false, reason: "too_long" };
  }

  return { ok: true, text };
}

const QUOTE_PAIRS: Array<[string, string]> = [
  ['"', '"'],
  ["'", "'"],
  ["`", "`"],
  ["“", "”"],
  ["‘", "’"],
  ["«", "»"],
  ["„", "“"],
  ["*", "*"],
  ["_", "_"]
];

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const TRAILING_PUNCTUATION = /[\s.,;:!?¡¿…。、，；：！？·\-–—]+$/u;

/**
 * The AI's title, or null when it is not usable. One line only; surrounding
 * quotes/backticks and trailing punctuation are stripped, whitespace is
 * collapsed; control characters, an empty result or more than
 * NAME_MAX_OUTPUT_CHARS characters reject it.
 */
export function cleanDocumentNameOutput(raw: string): string | null {
  const trimmed = raw.replace(/\r\n?/g, "\n").trim();

  if (!trimmed || trimmed.includes("\n")) {
    return null;
  }

  let title = trimmed.replace(/[ \t\u00a0]+/g, " ");

  if (CONTROL_CHARS.test(title)) {
    return null;
  }

  for (let changed = true; changed; ) {
    changed = false;
    title = title.replace(TRAILING_PUNCTUATION, "").trim();

    for (const [open, close] of QUOTE_PAIRS) {
      if (title.length > open.length + close.length && title.startsWith(open) && title.endsWith(close)) {
        title = title.slice(open.length, title.length - close.length).trim();
        changed = true;
      }
    }
  }

  title = title.replace(/\s+/g, " ").trim();

  if (!title || title.length > NAME_MAX_OUTPUT_CHARS || !/[\p{L}\p{N}]/u.test(title)) {
    return null;
  }

  return title;
}

export function documentNameReasonFromAgentError(error: AgentError, timedOut: boolean): DocumentNameFailureReason {
  if (timedOut || error.code === "request_timeout") {
    return "timeout";
  }

  switch (error.code) {
    case "invalid_api_key":
      return "invalid_api_key";
    case "rate_limited":
      return "rate_limited";
    case "request_canceled":
      return "aborted";
    case "free_quota_exhausted":
    case "free_global_cap":
      return "free_exhausted";
    case "free_unavailable":
      return "free_unavailable";
    case "client_outdated":
      return "client_outdated";
    case "key_unreadable":
      return "key_unreadable";
    case "network_unreachable":
    case "dns_failure":
      return "unreachable";
    case "provider_unavailable":
    case "model_not_found":
    case "malformed_provider_response":
    case "output_truncated":
    case "content_blocked":
    case "unknown":
      return "failed";
  }
}
