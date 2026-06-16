import type { EditorState, Range } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import { findLatexInlineMath } from "../../markdown/mathDelimiters";
import { resolveMarkdownAssetPath } from "../paths";
import {
  addBlockedRange,
  addInlineDecorations,
  rangeOverlapsBlocked,
  selectionIntersectsRange,
  type BlockedRange
} from "./activeRanges";
import { parseYouTubeVideoUrl } from "./media";
import { HiddenSyntaxWidget, ImageWidget, InlineMathWidget, YouTubeVideoWidget } from "./widgets";

export interface InlineCodeRange {
  from: number;
  to: number;
  contentFrom: number;
  contentTo: number;
}

export interface InlineMathRange extends InlineCodeRange {
  tex: string;
}

export interface InlineLinkRange {
  from: number;
  to: number;
  labelFrom: number;
  labelTo: number;
  href: string;
}

export interface InlineStyleRange extends InlineCodeRange {}

export interface InlineEscapeRange {
  from: number;
  to: number;
  markerFrom: number;
  markerTo: number;
  contentFrom: number;
  contentTo: number;
}

export interface InlineMarkdownRanges {
  code: InlineCodeRange[];
  math: InlineMathRange[];
  links: InlineLinkRange[];
  strong: InlineStyleRange[];
  emphasis: InlineStyleRange[];
  escapes: InlineEscapeRange[];
}

function assetUrlFor(documentPath: string, markdownPath: string) {
  const assetPath = resolveMarkdownAssetPath(documentPath, markdownPath);

  if (/^(https?:|data:|blob:)/i.test(assetPath)) {
    return assetPath;
  }

  return window.iliad.assetUrl(assetPath);
}

function overlapsRange(ranges: Array<{ from: number; to: number }>, from: number, to: number) {
  return ranges.some((range) => from < range.to && to > range.from);
}

function backslashIsUnescaped(text: string, index: number) {
  let count = 0;
  let cursor = index - 1;

  while (cursor >= 0 && text[cursor] === "\\") {
    count += 1;
    cursor -= 1;
  }

  return count % 2 === 0;
}

function isEscapableMarkdownPunctuation(character: string | undefined) {
  return Boolean(character && /^[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]$/.test(character));
}

function collectEscapedPunctuationRanges(text: string, protectedRanges: Array<{ from: number; to: number }> = []) {
  const ranges: InlineEscapeRange[] = [];

  for (let index = 0; index < text.length - 1; index += 1) {
    if (
      text[index] !== "\\" ||
      !backslashIsUnescaped(text, index) ||
      !isEscapableMarkdownPunctuation(text[index + 1]) ||
      overlapsRange(protectedRanges, index, index + 2)
    ) {
      continue;
    }

    ranges.push({
      from: index,
      to: index + 2,
      markerFrom: index,
      markerTo: index + 1,
      contentFrom: index + 1,
      contentTo: index + 2
    });
  }

  return ranges;
}

function collectInlineCodeRanges(text: string): InlineCodeRange[] {
  const ranges: InlineCodeRange[] = [];
  const codePattern = /`([^`]+)`/g;

  for (let match = codePattern.exec(text); match; match = codePattern.exec(text)) {
    ranges.push({
      from: match.index,
      to: match.index + match[0].length,
      contentFrom: match.index + 1,
      contentTo: match.index + match[0].length - 1
    });
  }

  return ranges;
}

function collectInlineMathRanges(text: string, blockedRanges: InlineCodeRange[]): InlineMathRange[] {
  const ranges: InlineMathRange[] = [];
  let index = 0;

  while (index < text.length) {
    const marker = text.indexOf("$", index);

    if (marker === -1) {
      break;
    }

    if (text[marker - 1] === "\\" || text[marker + 1] === "$" || overlapsRange(blockedRanges, marker, marker + 1)) {
      index = marker + 1;
      continue;
    }

    let close = marker + 1;

    while (close < text.length) {
      close = text.indexOf("$", close);

      if (close === -1) {
        break;
      }

      if (text[close - 1] !== "\\" && text[close + 1] !== "$") {
        break;
      }

      close += 1;
    }

    if (close === -1) {
      break;
    }

    const to = close + 1;
    const tex = text.slice(marker + 1, close);

    if (tex.trim() && !overlapsRange(blockedRanges, marker, to)) {
      ranges.push({
        from: marker,
        to,
        contentFrom: marker + 1,
        contentTo: close,
        tex
      });
    }

    index = to;
  }

  return ranges;
}

function collectLinkRanges(text: string, hardBlockers: Array<{ from: number; to: number }>): InlineLinkRange[] {
  const ranges: InlineLinkRange[] = [];
  let index = 0;

  while (index < text.length) {
    const open = text.indexOf("[", index);

    if (open === -1) {
      break;
    }

    if (open > 0 && text[open - 1] === "!") {
      index = open + 1;
      continue;
    }

    const closeLabel = text.indexOf("]", open + 1);

    if (closeLabel === -1 || text[closeLabel + 1] !== "(") {
      index = open + 1;
      continue;
    }

    const closeHref = text.indexOf(")", closeLabel + 2);

    if (closeHref === -1) {
      index = open + 1;
      continue;
    }

    const to = closeHref + 1;
    const labelFrom = open + 1;
    const labelTo = closeLabel;
    const href = text.slice(closeLabel + 2, closeHref).trim();
    const blockingRange = hardBlockers.find((range) => open < range.to && to > range.from);
    const blockedOutsideLabel = blockingRange
      ? hardBlockers.some((range) => open < range.to && to > range.from && (range.from < labelFrom || range.to > labelTo))
      : false;

    if (labelFrom < labelTo && href && !blockedOutsideLabel) {
      ranges.push({
        from: open,
        to,
        labelFrom,
        labelTo,
        href
      });
    }

    index = to;
  }

  return ranges;
}

function collectStrongRanges(text: string, hardBlockers: Array<{ from: number; to: number }>): InlineStyleRange[] {
  const ranges: InlineStyleRange[] = [];
  const strongPattern = /\*\*([^*]+)\*\*/g;

  for (let match = strongPattern.exec(text); match; match = strongPattern.exec(text)) {
    const from = match.index;
    const to = from + match[0].length;

    if (overlapsRange(hardBlockers, from, to)) {
      continue;
    }

    ranges.push({
      from,
      to,
      contentFrom: from + 2,
      contentTo: to - 2
    });
  }

  return ranges;
}

function collectEmphasisRanges(
  text: string,
  hardBlockers: Array<{ from: number; to: number }>,
  strongRanges: InlineStyleRange[]
): InlineStyleRange[] {
  const ranges: InlineStyleRange[] = [];
  const emphasisPattern = /(^|[^\*])\*([^\s*][^*]*?)\*/g;

  for (let match = emphasisPattern.exec(text); match; match = emphasisPattern.exec(text)) {
    const leadingOffset = match[1] ? match[1].length : 0;
    const from = match.index + leadingOffset;
    const to = match.index + match[0].length;

    if (overlapsRange(hardBlockers, from, to) || overlapsRange(strongRanges, from, to)) {
      continue;
    }

    ranges.push({
      from,
      to,
      contentFrom: from + 1,
      contentTo: to - 1
    });
  }

  return ranges;
}

export function collectInlineMarkdownRanges(text: string): InlineMarkdownRanges {
  const code = collectInlineCodeRanges(text);
  const escapes = collectEscapedPunctuationRanges(text, code);
  const dollarMath = collectInlineMathRanges(text, code);
  const latexMath: InlineMathRange[] = findLatexInlineMath(text, [...code, ...dollarMath]).map((range) => ({
    from: range.from,
    to: range.to,
    contentFrom: range.contentFrom,
    contentTo: range.contentTo,
    tex: range.tex
  }));
  const math = [...dollarMath, ...latexMath].sort((a, b) => a.from - b.from);
  const hardBlockers = [...code, ...math, ...escapes];
  const links = collectLinkRanges(text, hardBlockers);
  const strong = collectStrongRanges(text, hardBlockers);
  const emphasis = collectEmphasisRanges(text, hardBlockers, strong);

  return {
    code,
    math,
    links,
    strong,
    emphasis,
    escapes
  };
}

export function addEscapeDecorations(
  ranges: Range<Decoration>[],
  lineFrom: number,
  text: string,
  blockedRanges: BlockedRange[]
) {
  for (const escapeRange of collectInlineMarkdownRanges(text).escapes) {
    const markerFrom = lineFrom + escapeRange.markerFrom;
    const markerTo = lineFrom + escapeRange.markerTo;

    if (rangeOverlapsBlocked(blockedRanges, markerFrom, markerTo)) {
      continue;
    }

    ranges.push(Decoration.replace({ widget: new HiddenSyntaxWidget() }).range(markerFrom, markerTo));
  }
}

export function addImageDecorations(
  ranges: Range<Decoration>[],
  lineFrom: number,
  text: string,
  documentPath: string,
  blockedRanges: BlockedRange[],
  labels: {
    markdownImage: string;
    youtubeVideo: string;
  }
) {
  addInlineDecorations(ranges, lineFrom, text, /!\[([^\]]*)\]\(([^)]+)\)/g, (match, from, to) => {
    if (rangeOverlapsBlocked(blockedRanges, from, to)) {
      return;
    }

    const youtubeVideo = parseYouTubeVideoUrl(match[2]);

    ranges.push(
      Decoration.replace({
        widget: youtubeVideo
          ? new YouTubeVideoWidget(youtubeVideo.embedSrc, match[1], labels.youtubeVideo)
          : new ImageWidget(assetUrlFor(documentPath, match[2]), match[1], labels.markdownImage)
      }).range(from, to)
    );
    addBlockedRange(blockedRanges, from, to);
  });
}

export function addStrongDecorations(
  ranges: Range<Decoration>[],
  lineFrom: number,
  text: string,
  blockedRanges: BlockedRange[],
  options: { hideSyntax?: boolean } = {}
) {
  const hideSyntax = options.hideSyntax ?? true;

  for (const strongRange of collectInlineMarkdownRanges(text).strong) {
    const from = lineFrom + strongRange.from;
    const to = lineFrom + strongRange.to;

    if (rangeOverlapsBlocked(blockedRanges, from, to)) {
      continue;
    }

    const contentFrom = lineFrom + strongRange.contentFrom;
    const contentTo = lineFrom + strongRange.contentTo;
    if (hideSyntax) {
      ranges.push(Decoration.replace({ widget: new HiddenSyntaxWidget() }).range(from, contentFrom));
    }
    ranges.push(Decoration.mark({ class: "cm-md-strong" }).range(contentFrom, contentTo));
    if (hideSyntax) {
      ranges.push(Decoration.replace({ widget: new HiddenSyntaxWidget() }).range(contentTo, to));
    }
  }
}

export function addEmphasisDecorations(
  ranges: Range<Decoration>[],
  lineFrom: number,
  text: string,
  blockedRanges: BlockedRange[],
  options: { hideSyntax?: boolean } = {}
) {
  const hideSyntax = options.hideSyntax ?? true;

  for (const emphasisRange of collectInlineMarkdownRanges(text).emphasis) {
    const markerFrom = lineFrom + emphasisRange.from;
    const to = lineFrom + emphasisRange.to;

    if (rangeOverlapsBlocked(blockedRanges, markerFrom, to)) {
      continue;
    }

    const contentFrom = lineFrom + emphasisRange.contentFrom;
    const contentTo = lineFrom + emphasisRange.contentTo;
    if (hideSyntax) {
      ranges.push(Decoration.replace({ widget: new HiddenSyntaxWidget() }).range(markerFrom, contentFrom));
    }
    ranges.push(Decoration.mark({ class: "cm-md-emphasis" }).range(contentFrom, contentTo));
    if (hideSyntax) {
      ranges.push(Decoration.replace({ widget: new HiddenSyntaxWidget() }).range(contentTo, to));
    }
  }
}

export function addInlineCodeDecorations(
  ranges: Range<Decoration>[],
  lineFrom: number,
  text: string,
  blockedRanges: BlockedRange[],
  options: { hideSyntax?: boolean } = {}
) {
  const hideSyntax = options.hideSyntax ?? true;

  for (const codeRange of collectInlineMarkdownRanges(text).code) {
    const from = lineFrom + codeRange.from;
    const to = lineFrom + codeRange.to;

    if (rangeOverlapsBlocked(blockedRanges, from, to)) {
      continue;
    }

    if (hideSyntax) {
      ranges.push(Decoration.replace({ widget: new HiddenSyntaxWidget() }).range(from, from + 1));
    }
    ranges.push(Decoration.mark({ class: "cm-md-inline-code" }).range(from + 1, to - 1));
    if (hideSyntax) {
      ranges.push(Decoration.replace({ widget: new HiddenSyntaxWidget() }).range(to - 1, to));
      addBlockedRange(blockedRanges, from, to);
    }
  }
}

export function addInlineMathDecorations(
  ranges: Range<Decoration>[],
  state: EditorState,
  lineFrom: number,
  text: string,
  blockedRanges: BlockedRange[],
  editorFocused = true,
  editorInteracted = editorFocused
) {
  for (const mathRange of collectInlineMarkdownRanges(text).math) {
    const from = lineFrom + mathRange.from;
    const to = lineFrom + mathRange.to;

    if (
      rangeOverlapsBlocked(blockedRanges, from, to) ||
      selectionIntersectsRange(state, from, to, editorFocused, editorInteracted)
    ) {
      continue;
    }

    ranges.push(
      Decoration.replace({
        widget: new InlineMathWidget(mathRange.tex)
      }).range(from, to)
    );
    addBlockedRange(blockedRanges, from, to);
  }
}

export function addLinkDecorations(
  ranges: Range<Decoration>[],
  state: EditorState,
  lineFrom: number,
  text: string,
  blockedRanges: BlockedRange[],
  _onOpenLink: (href: string) => void | Promise<void>,
  editorFocused = true,
  editorInteracted = editorFocused
) {
  for (const linkRange of collectInlineMarkdownRanges(text).links) {
    const from = lineFrom + linkRange.from;
    const to = lineFrom + linkRange.to;

    if (rangeOverlapsBlocked(blockedRanges, from, to)) {
      const labelFrom = lineFrom + linkRange.labelFrom;
      const labelTo = lineFrom + linkRange.labelTo;
      const blockedOutsideLabel = blockedRanges.some(
        (range) => from < range.to && to > range.from && (range.from < labelFrom || range.to > labelTo)
      );

      if (blockedOutsideLabel) {
        continue;
      }
    }

    if (selectionIntersectsRange(state, from, to, editorFocused, editorInteracted)) {
      continue;
    }

    const labelFrom = lineFrom + linkRange.labelFrom;
    const labelTo = lineFrom + linkRange.labelTo;
    ranges.push(Decoration.replace({ widget: new HiddenSyntaxWidget() }).range(from, labelFrom));
    ranges.push(
      Decoration.mark({
        class: "cm-md-link",
        attributes: {
          "data-cm-md-link-href": linkRange.href,
          title: linkRange.href
        }
      }).range(labelFrom, labelTo)
    );
    ranges.push(Decoration.replace({ widget: new HiddenSyntaxWidget() }).range(labelTo, to));
  }
}
