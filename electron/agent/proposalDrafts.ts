import { unifiedDiff } from "./diff.js";
import type { AgentDraftFileChange, AgentRunRequest } from "./types.js";

function extractFullReplacement(text: string) {
  return findLegacyMarkdownBlock(text, "FULL_REPLACEMENT")?.content ?? null;
}

function extractNewDocument(text: string) {
  const block = findLegacyMarkdownBlock(text, "NEW_DOCUMENT");

  if (!block?.path) {
    return null;
  }

  return {
    relativePath: block.path,
    content: block.content
  };
}

interface LegacyMarkdownBlock {
  start: number;
  end: number;
  path?: string;
  content: string;
}

// Anchored-edit transport (ADR-0019): Aider-style SEARCH/REPLACE blocks.
// Markers are line-anchored and case-insensitive (the /gi convention shared
// with the legacy labels and the streaming cutoff).
const anchoredOpenPattern = /^<{7} search[ \t]*$/i;
const anchoredClosePattern = /^>{7} replace[ \t]*$/i;
const anchoredDividerPattern = /^={7}[ \t]*$/;

export interface AnchoredEditBlock {
  start: number;
  end: number;
  /**
   * Candidate (search, replace) splits: a Markdown setext underline is itself
   * a line-anchored `=======`, so each divider line inside the block is a
   * candidate; application accepts a block only when exactly one candidate's
   * SEARCH matches the working text exactly once.
   */
  splits: Array<{ search: string; replace: string }>;
}

export function parseAnchoredEditBlocks(text: string): AnchoredEditBlock[] {
  const lines = text.split("\n");
  const blocks: AnchoredEditBlock[] = [];
  const offsets: number[] = [];
  let offset = 0;

  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }

  let index = 0;

  while (index < lines.length) {
    if (!anchoredOpenPattern.test(lines[index])) {
      index += 1;
      continue;
    }

    const openIndex = index;
    const dividerIndexes: number[] = [];
    let closeIndex = -1;

    for (let cursor = openIndex + 1; cursor < lines.length; cursor += 1) {
      if (anchoredOpenPattern.test(lines[cursor])) {
        break;
      }

      if (anchoredClosePattern.test(lines[cursor])) {
        closeIndex = cursor;
        break;
      }

      if (anchoredDividerPattern.test(lines[cursor])) {
        dividerIndexes.push(cursor);
      }
    }

    if (closeIndex === -1 || dividerIndexes.length === 0) {
      // Malformed/unterminated structure: nothing parses (fail closed).
      return [];
    }

    const splits = dividerIndexes
      .map((dividerIndex) => ({
        search: lines.slice(openIndex + 1, dividerIndex).join("\n"),
        replace: lines.slice(dividerIndex + 1, closeIndex).join("\n")
      }))
      // Empty SEARCH is malformed (no insert semantics in v1).
      .filter((split) => split.search.length > 0);

    if (splits.length === 0) {
      return [];
    }

    blocks.push({
      start: offsets[openIndex],
      end: Math.min(text.length, offsets[closeIndex] + lines[closeIndex].length + 1),
      splits
    });
    index = closeIndex + 1;
  }

  return blocks;
}

export type AnchoredEditResult =
  | { ok: true; replacement: string }
  | { ok: false; reason: "not_found" | "ambiguous"; blockIndex: number };

function occurrences(haystack: string, needle: string) {
  let count = 0;
  let from = 0;

  while (count < 2) {
    const found = haystack.indexOf(needle, from);

    if (found === -1) {
      break;
    }

    count += 1;
    from = found + 1;
  }

  return count;
}

export function applyAnchoredEdits(baseContent: string, blocks: AnchoredEditBlock[]): AnchoredEditResult {
  let working = baseContent;

  for (const [blockIndex, block] of blocks.entries()) {
    const viable = block.splits.filter((split) => occurrences(working, split.search) === 1);

    if (viable.length !== 1) {
      const anyMatch = block.splits.some((split) => occurrences(working, split.search) > 0);
      return { ok: false, reason: anyMatch ? "ambiguous" : "not_found", blockIndex };
    }

    const split = viable[0];
    const at = working.indexOf(split.search);
    working = working.slice(0, at) + split.replace + working.slice(at + split.search.length);
  }

  return { ok: true, replacement: working };
}

function findLegacyMarkdownBlock(text: string, label: "FULL_REPLACEMENT" | "NEW_DOCUMENT"): LegacyMarkdownBlock | null {
  const labelPattern = label === "FULL_REPLACEMENT" ? /FULL_REPLACEMENT:/gi : /NEW_DOCUMENT:\s*([^\n]+)/gi;
  const matches = [...text.matchAll(labelPattern)];
  const match = matches.at(-1);

  if (!match || match.index === undefined) {
    return null;
  }

  const labelStart = match.index;
  const labelEnd = labelStart + match[0].length;
  const nextLabelIndex = nextTransportLabelIndex(text, labelEnd);
  const sectionEnd = nextLabelIndex ?? text.length;
  const section = text.slice(labelEnd, sectionEnd);
  const fenceMatch = /^([`~]{3,})(?:markdown|md)?[ \t]*$/im.exec(section);

  if (!fenceMatch || fenceMatch.index === undefined) {
    return null;
  }

  const fence = fenceMatch[1];
  const openingFenceStart = labelEnd + fenceMatch.index;
  const contentStart = openingFenceStart + fenceMatch[0].length + newlineLength(text, openingFenceStart + fenceMatch[0].length);
  const closingFence = findLastFenceLine(text, contentStart, sectionEnd, fence);
  const contentEnd = closingFence?.start ?? sectionEnd;
  const transportEnd = closingFence?.end ?? sectionEnd;

  return {
    start: labelStart,
    end: transportEnd,
    path: match[1]?.trim().replace(/^["']|["']$/g, ""),
    content: text.slice(contentStart, contentEnd).replace(/\n$/, "")
  };
}

function nextTransportLabelIndex(text: string, from: number) {
  const rest = text.slice(from);
  const fullReplacement = rest.search(/FULL_REPLACEMENT:/i);
  const newDocument = rest.search(/NEW_DOCUMENT:\s*[^\n]+/i);
  // Anchored blocks are a section boundary too: a NEW_DOCUMENT fence scan must
  // never swallow a trailing anchored block whose body contains ``` fences.
  const anchored = rest.search(/^<{7} search[ \t]*$/im);
  const candidates = [fullReplacement, newDocument, anchored].filter((index) => index >= 0);

  return candidates.length > 0 ? from + Math.min(...candidates) : null;
}

function newlineLength(text: string, index: number) {
  if (text[index] === "\r" && text[index + 1] === "\n") {
    return 2;
  }

  return text[index] === "\n" ? 1 : 0;
}

function findLastFenceLine(text: string, from: number, to: number, fence: string) {
  const fenceLine = new RegExp(`^${escapeRegExp(fence)}[ \\t]*(?:\\r?\\n|$)`, "gm");
  fenceLine.lastIndex = from;
  let last: { start: number; end: number } | null = null;
  let match: RegExpExecArray | null;

  while ((match = fenceLine.exec(text)) && match.index < to) {
    last = {
      start: match.index,
      end: Math.min(fenceLine.lastIndex, to)
    };
  }

  return last;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractSummary(text: string) {
  const firstLine = text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("```"));

  return firstLine?.replace(/^#+\s*/, "").slice(0, 160) || "Proposed Markdown replacement";
}

function hasLegacyProposalTransport(text: string) {
  return Boolean(
    findLegacyMarkdownBlock(text, "FULL_REPLACEMENT") ??
      findLegacyMarkdownBlock(text, "NEW_DOCUMENT") ??
      (parseAnchoredEditBlocks(text).length > 0 ? true : null)
  );
}

function stripLegacyTransport(text: string, stripDiffBlocks: boolean) {
  const ranges = [
    findLegacyMarkdownBlock(text, "FULL_REPLACEMENT"),
    findLegacyMarkdownBlock(text, "NEW_DOCUMENT"),
    ...parseAnchoredEditBlocks(text)
  ]
    .filter((range): range is LegacyMarkdownBlock | AnchoredEditBlock => range !== null)
    .sort((a, b) => b.start - a.start);
  let clean = text;

  for (const range of ranges) {
    clean = `${clean.slice(0, range.start)}${clean.slice(range.end)}`;
  }

  if (stripDiffBlocks) {
    clean = stripDiffTransportBlocks(clean);
  }

  return clean
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripDiffTransportBlocks(text: string) {
  return text.replace(/^([`~]{3,})diff[ \t]*\r?\n[\s\S]*?^\1[ \t]*(?:\r?\n|$)/gim, "");
}

function stripLeakedTransportSentences(text: string) {
  const transportSentencePatterns = [
    /\b(?:below|here)\s+is\s+the\s+diff\b[^.!?\n]*(?:[.!?]|$)/gi,
    /\b(?:then\s+)?(?:below|here)\s+is\s+the\s+full\s+replacement\b[^.!?\n]*(?:[.!?]|$)/gi,
    /\bhere\s+is\s+the\s+complete\s+document\b[^.!?\n]*(?:[.!?]|$)/gi,
    /\b(?:incluyo|aquí\s+está)\s+(?:el\s+)?diff\b[^.!?\n]*(?:[.!?]|$)/gi,
    /\b(?:luego\s+)?(?:incluyo|aquí\s+está)\s+(?:el\s+)?(?:reemplazo\s+completo|documento\s+completo)\b[^.!?\n]*(?:[.!?]|$)/gi
  ];

  return transportSentencePatterns.reduce((clean, pattern) => clean.replace(pattern, ""), text);
}

function draftEditFromResponse(request: AgentRunRequest, text: string): AgentDraftFileChange | null {
  const activeFile = request.activeFile;
  const replacement = extractFullReplacement(text);

  if (!activeFile || replacement === null || replacement === activeFile.content) {
    return null;
  }

  return {
    kind: "edit_file",
    relativePath: activeFile.relativePath,
    baseHash: activeFile.baseHash,
    baseContent: activeFile.content,
    replacement,
    summary: extractSummary(text),
    unifiedDiff: unifiedDiff(activeFile.content, replacement, activeFile.relativePath)
  };
}

function draftCreateFromResponse(text: string): AgentDraftFileChange | null {
  const newDocument = extractNewDocument(text);

  if (!newDocument || !newDocument.relativePath || !newDocument.content.trim()) {
    return null;
  }

  return {
    kind: "create_file",
    relativePath: newDocument.relativePath,
    content: newDocument.content,
    summary: extractSummary(text),
    unifiedDiff: unifiedDiff("", newDocument.content, newDocument.relativePath)
  };
}

function draftAnchoredEditFromResponse(
  request: AgentRunRequest,
  text: string
): { draft: AgentDraftFileChange | null; failed: boolean } {
  const activeFile = request.activeFile;
  const blocks = parseAnchoredEditBlocks(text);

  if (blocks.length === 0 || !activeFile) {
    // No active file: nothing was promised; blocks just strip.
    return { draft: null, failed: false };
  }

  const result = applyAnchoredEdits(activeFile.content, blocks);

  if (!result.ok) {
    return { draft: null, failed: true };
  }

  if (result.replacement === activeFile.content) {
    // No-op result follows the FULL_REPLACEMENT-identical convention: silent.
    return { draft: null, failed: false };
  }

  return {
    draft: {
      kind: "edit_file",
      relativePath: activeFile.relativePath,
      baseHash: activeFile.baseHash,
      baseContent: activeFile.content,
      replacement: result.replacement,
      summary: extractSummary(stripLegacyTransport(text, false)),
      unifiedDiff: unifiedDiff(activeFile.content, result.replacement, activeFile.relativePath)
    },
    failed: false
  };
}

export interface ParsedProposalDrafts {
  drafts: AgentDraftFileChange[];
  anchoredEditFailed: boolean;
}

export function parseProposalDrafts(request: AgentRunRequest, rawText: string): ParsedProposalDrafts {
  // CRLF from the model normalizes once; CRLF-on-disk documents fail anchored
  // matching closed (documented limitation).
  const text = rawText.replace(/\r\n/g, "\n");
  const fullReplacementEdit = draftEditFromResponse(request, text);
  const createDraft = draftCreateFromResponse(text);

  // Precedence: a parseable FULL_REPLACEMENT wins; anchored blocks are ignored.
  if (extractFullReplacement(text) !== null) {
    return {
      drafts: [fullReplacementEdit, createDraft].filter((draft): draft is AgentDraftFileChange => draft !== null),
      anchoredEditFailed: false
    };
  }

  const anchored = draftAnchoredEditFromResponse(request, text);

  return {
    drafts: [anchored.draft, createDraft].filter((draft): draft is AgentDraftFileChange => draft !== null),
    anchoredEditFailed: anchored.failed
  };
}

export function parseLegacyProposalDrafts(request: AgentRunRequest, text: string): AgentDraftFileChange[] {
  return parseProposalDrafts(request, text).drafts;
}

export function sanitizeLegacyAssistantText(
  text: string,
  hasProposalDrafts: boolean,
  language: AgentRunRequest["language"] = "en",
  anchoredEditFailed = false
) {
  const clean = stripLeakedTransportSentences(
    stripLegacyTransport(text, hasProposalDrafts || hasLegacyProposalTransport(text))
  )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const failureSentence =
    language === "es"
      ? "No pude aplicar la edición propuesta — pídeme que lo intente de nuevo."
      : "I could not apply the proposed edit — ask me to try again.";
  const proposalSentence =
    language === "es"
      ? "Preparé una propuesta. Revísala en el documento."
      : "I prepared a proposal. Review it in the document.";

  if (hasProposalDrafts) {
    // The failure+NEW_DOCUMENT cross product must not swallow the failure.
    return anchoredEditFailed ? `${proposalSentence}\n\n${failureSentence}` : proposalSentence;
  }

  if (anchoredEditFailed) {
    // Replaces the model's mandated one-liner: appending would self-contradict.
    return failureSentence;
  }

  return clean;
}
