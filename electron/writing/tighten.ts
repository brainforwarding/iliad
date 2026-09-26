import type { AgentError } from "./errors.js";
import { TIGHTEN_MAX_INPUT_CHARS, TIGHTEN_MAX_INSTRUCTION_CHARS } from "./groq/prompts/limits.js";
import {
  TIGHTEN_SELECTION_END,
  TIGHTEN_SELECTION_START,
  normalizeTightenSelectionRange,
  type SelectionMode,
  type SelectionRange,
  type WritingLanguage
} from "./groq/prompts/v1.js";

// On-demand, selection-scoped concise rewrite (ADR-0020). Pure helpers only;
// the IPC wiring (trust gate, abort map) lives in electron/ipc/tighten.ts and
// the Groq request in electron/writing/writingAiService.ts.

export { TIGHTEN_MAX_INPUT_CHARS, TIGHTEN_MAX_INSTRUCTION_CHARS } from "./groq/prompts/limits.js";
// Markers, range normalization and the prompt builders live in the pure,
// versioned prompt module shared with the Iliad AI proxy (Groq spec §2), so it
// never imports back from this file; re-exported here.
export {
  TIGHTEN_SELECTION_END,
  TIGHTEN_SELECTION_START,
  editInstruction,
  normalizeTightenSelectionRange,
  selectionTransformInstruction,
  selectionTransformMaxOutputTokens,
  tightenInstruction,
  tightenMaxOutputTokens,
  tightenModelInput,
  tightenSelectedText
} from "./groq/prompts/v1.js";
/** 30 s so a full 4,000-char edit is not cut off by the app before the proxy's own limits (Groq spec §2). */
export const TIGHTEN_TIMEOUT_MS = 30000;

export type TightenLanguage = WritingLanguage;
export type TightenMode = SelectionMode;
export type TightenSelectionRange = SelectionRange;

export type TightenFailureReason =
  | "invalid_api_key"
  | "free_exhausted"
  | "free_unavailable"
  | "client_outdated"
  | "key_unreadable"
  | "unreachable"
  | "rate_limited"
  | "too_long"
  | "empty"
  | "timeout"
  | "provider"
  | "incomplete"
  | "blocked"
  | "aborted"
  | "untrusted";

export type TightenResult =
  | { ok: true; rewrite: string; unchanged: boolean }
  | { ok: false; reason: TightenFailureReason; resetAt?: string };

export function normalizeTightenLanguage(language: unknown): TightenLanguage {
  return language === "es" ? "es" : "en";
}

export type TightenTextValidation = { ok: true; text: string } | { ok: false; reason: "empty" | "too_long" };
export type TightenInstructionValidation =
  | { ok: true; instruction: string }
  | { ok: false; reason: "empty" | "too_long" };

/** Main is the authority for the length cap (the renderer gate is UX only). */
export function validateTightenText(text: unknown): TightenTextValidation {
  if (typeof text !== "string" || !text.trim()) {
    return { ok: false, reason: "empty" };
  }

  if (text.length > TIGHTEN_MAX_INPUT_CHARS) {
    return { ok: false, reason: "too_long" };
  }

  return { ok: true, text };
}

export function normalizeTightenMode(mode: unknown): TightenMode {
  return mode === "edit" ? "edit" : "tighten";
}

export function validateTightenInstruction(instruction: unknown): TightenInstructionValidation {
  if (typeof instruction !== "string") {
    return { ok: false, reason: "empty" };
  }

  const trimmed = instruction.trim();

  if (!trimmed) {
    return { ok: false, reason: "empty" };
  }

  if (trimmed.length > TIGHTEN_MAX_INSTRUCTION_CHARS) {
    return { ok: false, reason: "too_long" };
  }

  return { ok: true, instruction: trimmed };
}

export function mergeTightenSelectionRewrite(text: string, selection: TightenSelectionRange, selectedRewrite: string): string {
  const focus = normalizeTightenSelectionRange(text, selection);
  return `${text.slice(0, focus.from)}${selectedRewrite}${text.slice(focus.to)}`;
}

function originalIsFenced(originalText: string): boolean {
  const firstLine = originalText
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  return Boolean(firstLine && /^[`~]{3,}/.test(firstLine));
}

/**
 * Unwrap a single outer code fence ONLY when it wraps the entire output and the
 * original selection was not itself a fenced block — otherwise a selection that
 * legitimately contains a code block would be corrupted.
 */
function unwrapOuterFence(text: string, originalText: string): string {
  if (originalIsFenced(originalText)) {
    return text;
  }

  const lines = text.split("\n");
  let first = 0;
  while (first < lines.length && lines[first].trim() === "") first += 1;
  let last = lines.length - 1;
  while (last >= 0 && lines[last].trim() === "") last -= 1;

  if (first >= last) {
    return text;
  }

  const fenceMatch = /^([`~]{3,})[A-Za-z0-9]*$/.exec(lines[first].trim());

  if (!fenceMatch || lines[last].trim() !== fenceMatch[1]) {
    return text;
  }

  const inner = lines.slice(first + 1, last);

  // A same-marker fence inside means the outer fence does not wrap the whole
  // output (multiple code blocks): leave it untouched.
  if (inner.some((line) => line.trim() === fenceMatch[1])) {
    return text;
  }

  return inner.join("\n");
}

/** Strip matched surrounding quotes only when the selection wasn't itself quoted. */
function unwrapSurroundingQuotes(text: string, originalText: string): string {
  const trimmed = text.trim();
  const originalStart = originalText.trimStart();
  const pairs: Array<[string, string]> = [
    ['"', '"'],
    ["“", "”"],
    ["'", "'"]
  ];

  for (const [open, close] of pairs) {
    if (
      trimmed.length > open.length + close.length &&
      trimmed.startsWith(open) &&
      trimmed.endsWith(close) &&
      !originalStart.startsWith(open)
    ) {
      return trimmed.slice(open.length, trimmed.length - close.length);
    }
  }

  return text;
}

/**
 * Conservative cleaning of the provider output. Preserves interior whitespace
 * and leading spaces (Markdown-significant), but removes provider-added leading
 * and trailing blank lines because the renderer's safe range excludes surrounding
 * blank lines. Never strips arbitrary preamble — that is caught as a failure by
 * looksLikePreambleEcho.
 */
export function cleanTightenOutput(raw: string, originalText: string): string {
  const normalized = raw.replace(/\r\n/g, "\n");
  const unfenced = unwrapOuterFence(normalized, originalText);
  const unquoted = unwrapSurroundingQuotes(unfenced, originalText);
  const withoutMarkers = removeTightenMarkers(unquoted);
  // Drop surrounding newlines (model artifact) but keep spaces (Markdown-significant).
  return restoreOriginalLineEndings(withoutMarkers.replace(/^\n+/, "").replace(/\n+$/, ""), originalText);
}

/**
 * Detect a model that echoed the original verbatim plus extra prose (unstripped
 * preamble/commentary). Conservative: only for longer originals, where a verbatim
 * containment is unlikely to be coincidental.
 */
export function looksLikePreambleEcho(rewrite: string, originalText: string): boolean {
  const original = originalText.trim();

  if (original.length < 60) {
    return false;
  }

  const cleaned = rewrite.trim();
  const at = cleaned.indexOf(original);

  if (cleaned === original || at < 0) {
    return false;
  }

  // Wrapping the passage in Markdown formatting (italics, bold, a quote) is a
  // real edit; only added words count as echoed preamble or commentary.
  const added = cleaned.slice(0, at) + cleaned.slice(at + original.length);
  return /[\p{L}\p{N}]/u.test(added);
}

export function looksLikeTightenContextEcho(rewrite: string, originalText: string, selection: TightenSelectionRange): boolean {
  const focus = normalizeTightenSelectionRange(originalText, selection);
  const cleaned = rewrite.trim();
  const prefixContext = originalText.slice(Math.max(0, focus.from - 80), focus.from).trim();
  const suffixContext = originalText.slice(focus.to, Math.min(originalText.length, focus.to + 80)).trim();

  return contextSnippetEchoed(cleaned, prefixContext, "end") || contextSnippetEchoed(cleaned, suffixContext, "start");
}

/**
 * Trailing-whitespace/line-ending normalization only — interior whitespace
 * (including hard-break trailing spaces) is significant and never collapsed.
 */
export function isTightenUnchanged(rewrite: string, originalText: string): boolean {
  const normalize = (value: string) => value.replace(/\r\n/g, "\n").trimEnd();
  return normalize(rewrite) === normalize(originalText);
}

export function tightenReasonFromAgentError(error: AgentError, timedOut: boolean): TightenFailureReason {
  // New codes are mapped explicitly before the `provider_unavailable` detail
  // regex below (Groq spec §5); proxy-derived details never match it.
  switch (error.code) {
    case "invalid_api_key":
      return "invalid_api_key";
    case "rate_limited":
      return "rate_limited";
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
      if (isTightenRateLimitDetail(error.detail)) {
        return "rate_limited";
      }

      if (isTightenAuthDetail(error.detail)) {
        return "invalid_api_key";
      }

      return "provider";
    // Proxy/provider timeouts (spec §5: upstream_timeout → timeout). `timedOut`
    // only tells a local timeout from a user cancel below.
    case "request_timeout":
      return "timeout";
    case "request_canceled":
      return timedOut ? "timeout" : "aborted";
    case "output_truncated":
      return "incomplete";
    case "content_blocked":
      return "blocked";
    case "model_not_found":
    case "malformed_provider_response":
    case "unknown":
      return "provider";
  }
}

function isTightenRateLimitDetail(detail: string | undefined) {
  return Boolean(detail && /billing|credit|fund|insufficient|limit|quota|rate|usage/i.test(detail));
}

function isTightenAuthDetail(detail: string | undefined) {
  return Boolean(detail && /auth|forbidden|login|permission|session|unauthori[sz]ed/i.test(detail));
}

function contextSnippetEchoed(rewrite: string, context: string, side: "start" | "end") {
  if (context.length < 30) {
    return false;
  }

  const snippet = side === "start" ? context.slice(0, 30) : context.slice(-30);
  return rewrite.includes(snippet);
}

function removeTightenMarkers(text: string) {
  return text.split(TIGHTEN_SELECTION_START).join("").split(TIGHTEN_SELECTION_END).join("");
}

function restoreOriginalLineEndings(text: string, originalText: string) {
  const lineEnding = originalLineEnding(originalText);

  if (lineEnding === "\n") {
    return text;
  }

  return text.replace(/\n/g, lineEnding);
}

function originalLineEnding(text: string) {
  if (text.includes("\r\n")) {
    return "\r\n";
  }

  if (text.includes("\r")) {
    return "\r";
  }

  return "\n";
}

