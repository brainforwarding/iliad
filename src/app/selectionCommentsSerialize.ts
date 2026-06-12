import type { SelectionComment } from "../types/iliad";
import { isAnchoredSelectionComment } from "./selectionCommentsAnchor";

const QUOTE_DISPLAY_LIMIT = 80;
const SHORT_QUOTE_CONTEXT_THRESHOLD = 30;

// The serialized payload follows the app language. These strings address the
// agent, not the chrome, so they live with the serializer instead of strings.ts.
const payloadStrings = {
  en: {
    header: (name: string) => `Comments on \`${name}\`:`,
    line: (line: number) => `Line ${line}`,
    occurrence: (ordinal: number) => `${ordinalEn(ordinal)} occurrence`,
    context: "Context",
    comment: "Comment",
    orphanNote: "Unanchored (the quoted text no longer appears in the document):",
    footer: "Each comment references the quoted text at the indicated line."
  },
  es: {
    header: (name: string) => `Comentarios sobre \`${name}\`:`,
    line: (line: number) => `Línea ${line}`,
    occurrence: (ordinal: number) => `${ordinal}.ª aparición`,
    context: "Contexto",
    comment: "Comentario",
    orphanNote: "Sin ancla (el texto citado ya no aparece en el documento):",
    footer: "Cada comentario se refiere al texto citado en la línea indicada."
  }
} as const;

function ordinalEn(value: number) {
  const mod100 = value % 100;

  if (mod100 >= 11 && mod100 <= 13) {
    return `${value}th`;
  }

  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
}

/** Newlines become `⏎` before truncation, so multi-block quotes stay one line. */
function displayQuote(quote: string) {
  const flattened = quote.replace(/\r\n|\r|\n/g, "⏎");
  return flattened.length > QUOTE_DISPLAY_LIMIT ? `${flattened.slice(0, QUOTE_DISPLAY_LIMIT - 1)}…` : flattened;
}

function lineNumberAt(documentText: string, position: number) {
  let line = 1;

  for (let index = 0; index < position && index < documentText.length; index += 1) {
    if (documentText.charCodeAt(index) === 10) {
      line += 1;
    }
  }

  return line;
}

function countOccurrences(haystack: string, needle: string) {
  if (!needle) {
    return 0;
  }

  let count = 0;
  let index = haystack.indexOf(needle);

  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + 1);
  }

  return count;
}

function occurrenceOrdinalAt(documentText: string, quote: string, from: number) {
  return countOccurrences(documentText.slice(0, from), quote) + 1;
}

function contextLineAt(documentText: string, from: number) {
  const lineStart = documentText.lastIndexOf("\n", from - 1) + 1;
  const lineEndIndex = documentText.indexOf("\n", from);
  const lineEnd = lineEndIndex === -1 ? documentText.length : lineEndIndex;
  return displayQuote(documentText.slice(lineStart, lineEnd).trim());
}

function indentedCommentText(comment: string) {
  return comment.split(/\r\n|\r|\n/).join("\n   ");
}

export interface SerializeSelectionCommentsOptions {
  comments: SelectionComment[];
  documentText: string;
  documentName: string;
  language: "en" | "es";
  /** When the user typed text, their framing governs: no closing instruction is added. */
  userTypedText: boolean;
}

/**
 * Serializes pending comments into the agent payload block. Line numbers are
 * 1-based and computed at send time from live positions; order is
 * deterministic by position; orphans are listed last with no line numbers.
 */
export function serializeSelectionComments({
  comments,
  documentText,
  documentName,
  language,
  userTypedText
}: SerializeSelectionCommentsOptions): string {
  const t = payloadStrings[language];
  const anchored = comments.filter(isAnchoredSelectionComment).sort((a, b) => a.from - b.from);
  const orphans = comments
    .filter((comment) => !isAnchoredSelectionComment(comment))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const lines: string[] = [t.header(documentName), ""];
  let itemNumber = 0;

  for (const comment of anchored) {
    itemNumber += 1;
    // Positions are authoritative while the document is open, so the quote is
    // the live slice (the stored quote is the re-anchoring fallback).
    const liveQuote = documentText.slice(comment.from, comment.to) || comment.quote;
    const repeated = countOccurrences(documentText, liveQuote) > 1;
    const ordinalSuffix = repeated
      ? ` (${t.occurrence(occurrenceOrdinalAt(documentText, liveQuote, comment.from))})`
      : "";

    lines.push(`${itemNumber}. ${t.line(lineNumberAt(documentText, comment.from))} · "${displayQuote(liveQuote)}"${ordinalSuffix}`);

    if (liveQuote.length < SHORT_QUOTE_CONTEXT_THRESHOLD || repeated) {
      lines.push(`   > ${t.context}: "${contextLineAt(documentText, comment.from)}"`);
    }

    lines.push(`   ${t.comment}: ${indentedCommentText(comment.comment)}`);
    lines.push("");
  }

  if (orphans.length > 0) {
    lines.push(t.orphanNote);
    lines.push("");

    for (const comment of orphans) {
      itemNumber += 1;
      lines.push(`${itemNumber}. "${displayQuote(comment.quote)}"`);
      lines.push(`   ${t.comment}: ${indentedCommentText(comment.comment)}`);
      lines.push("");
    }
  }

  if (!userTypedText) {
    lines.push(t.footer);
  }

  return lines.join("\n").trimEnd();
}
