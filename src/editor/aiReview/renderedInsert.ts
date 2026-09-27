import { commonmarkLanguage } from "@codemirror/lang-markdown";
import type { SyntaxNode, Tree } from "@lezer/common";
import type { IntralineRange } from "./intralineDiff";

/**
 * Rendering model for added text in a review (outside review and ✦ AI
 * review). The added lines are parsed with the same Markdown parser the editor
 * loads (`markdown()` = CommonMark) and shown the way visual Markdown shows an
 * inactive line: syntax marks are hidden and their spans styled with the
 * `cm-md-*` classes. Text characters are never rewritten.
 *
 * Safety (spec 2026-09-27-premium-pass, "Rejected"): a line falls back to raw
 * source when a changed range touches hidden syntax, so no change can hide
 * inside a syntax mark. On a wholly new line the markers' effect is visible as
 * styling (heading, quote, bold, code, bullet) and they may be hidden, but a
 * hidden link destination is never visible, so a new or changed URL is always
 * shown as source. Code blocks, HTML, images, setext headings, rules and
 * anything else the parser gives that is not plain prose render as source, and
 * any failure renders every line as source.
 */

export interface RenderedInsertSegment {
  text: string;
  /** Classes for the span (`cm-md-*`, changed-token class); empty = plain text. */
  classes: string[];
  changed: boolean;
}

export type InsertedLineRender =
  | { kind: "raw"; text: string; changedRanges: IntralineRange[] }
  | { kind: "rendered"; lineClasses: string[]; segments: RenderedInsertSegment[] };

type HiddenKind = "marker" | "destination";

interface CharInfo {
  hidden: HiddenKind | null;
  /** Visible replacement for a hidden character (the list bullet). */
  replacement: string | null;
  classes: Set<string>;
}

export interface RenderInsertOptions {
  /** Render every line as source (e.g. the lines are added inside a code fence). */
  forceRaw?: boolean;
  /** Parser override for tests. */
  parse?: (text: string) => Tree;
}

const RAW_NODE_TYPES = new Set([
  "FencedCode",
  "CodeBlock",
  "HTMLBlock",
  "CommentBlock",
  "ProcessingInstructionBlock",
  "LinkReference",
  "SetextHeading1",
  "SetextHeading2",
  "HorizontalRule",
  "Image",
  "Autolink",
  "HTMLTag",
  "Comment",
  "ProcessingInstruction"
]);

const INLINE_STYLE_CLASSES: Record<string, string> = {
  StrongEmphasis: "cm-md-strong",
  Emphasis: "cm-md-emphasis"
};

export function renderInsertedLines(
  lines: string[],
  changedRangesByLine: IntralineRange[][],
  options: RenderInsertOptions = {}
): InsertedLineRender[] {
  const raw = () => lines.map((text, index) => rawLine(text, changedRangesByLine[index] ?? []));

  if (options.forceRaw) {
    return raw();
  }

  try {
    return renderParsed(lines, changedRangesByLine, options.parse ?? ((text) => commonmarkLanguage.parser.parse(text)));
  } catch {
    return raw();
  }
}

function rawLine(text: string, changedRanges: IntralineRange[]): InsertedLineRender {
  return { kind: "raw", text, changedRanges };
}

function renderParsed(lines: string[], changedRangesByLine: IntralineRange[][], parse: (text: string) => Tree) {
  const text = lines.join("\n");
  const tree = parse(text);
  const lineStarts: number[] = [];
  let offset = 0;

  for (const line of lines) {
    lineStarts.push(offset);
    offset += line.length + 1;
  }

  const lineAt = (position: number) => {
    let low = 0;
    let high = lineStarts.length - 1;

    while (low < high) {
      const middle = (low + high + 1) >> 1;

      if (lineStarts[middle] <= position) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }

    return low;
  };

  const chars: CharInfo[] = Array.from({ length: text.length }, () => ({ hidden: null, replacement: null, classes: new Set() }));
  const rawLines = new Set<number>();
  const lineClasses = lines.map(() => new Set<string>());

  const markRawLines = (from: number, to: number) => {
    const last = lineAt(Math.max(from, to - 1));

    for (let line = lineAt(from); line <= last; line += 1) {
      rawLines.add(line);
    }
  };
  const hide = (from: number, to: number, kind: HiddenKind = "marker") => {
    for (let position = Math.max(0, from); position < Math.min(to, text.length); position += 1) {
      chars[position].hidden = kind;
    }
  };
  const style = (from: number, to: number, className: string) => {
    for (let position = Math.max(0, from); position < Math.min(to, text.length); position += 1) {
      chars[position].classes.add(className);
    }
  };
  const hideFollowingSpace = (position: number) => {
    if (text[position] === " " || text[position] === "\t") {
      hide(position, position + 1);
    }
  };
  const children = (node: SyntaxNode) => {
    const result: SyntaxNode[] = [];

    for (let child = node.firstChild; child; child = child.nextSibling) {
      result.push(child);
    }

    return result;
  };

  const visit = (node: SyntaxNode) => {
    const name = node.name;

    if (node.type.isError || RAW_NODE_TYPES.has(name)) {
      markRawLines(node.from, node.to);
      return;
    }

    const heading = /^ATXHeading([1-6])$/.exec(name);

    if (heading) {
      lineClasses[lineAt(node.from)].add("cm-md-heading-line").add(`cm-md-heading-${heading[1]}`);

      for (const child of children(node)) {
        if (child.name === "HeaderMark") {
          hide(child.from, child.to);

          if (child.from === node.from) {
            hideFollowingSpace(child.to);
          }
        }
      }
    }

    if (name === "Blockquote") {
      const last = lineAt(Math.max(node.from, node.to - 1));

      for (let line = lineAt(node.from); line <= last; line += 1) {
        lineClasses[line].add("cm-md-blockquote-line");
      }
    }

    if (name === "QuoteMark") {
      hide(node.from, node.to);
      hideFollowingSpace(node.to);
      return;
    }

    if (name === "ListMark") {
      lineClasses[lineAt(node.from)].add("cm-md-list-line");

      if (node.parent?.parent?.name === "BulletList") {
        hide(node.from, node.to);
        chars[node.from].replacement = "•";
      }

      return;
    }

    if (name === "Escape") {
      hide(node.from, node.from + 1);
      return;
    }

    const inlineClass = INLINE_STYLE_CLASSES[name];

    if (inlineClass) {
      const marks = children(node).filter((child) => child.name === "EmphasisMark");

      if (marks.length < 2) {
        markRawLines(node.from, node.to);
        return;
      }

      hide(marks[0].from, marks[0].to);
      hide(marks[marks.length - 1].from, marks[marks.length - 1].to);
      style(marks[0].to, marks[marks.length - 1].from, inlineClass);
    }

    if (name === "InlineCode") {
      const marks = children(node).filter((child) => child.name === "CodeMark");

      if (marks.length < 2) {
        markRawLines(node.from, node.to);
        return;
      }

      hide(marks[0].from, marks[0].to);
      hide(marks[marks.length - 1].from, marks[marks.length - 1].to);
      style(marks[0].to, marks[marks.length - 1].from, "cm-md-inline-code");
      return;
    }

    if (name === "Link") {
      const nodeChildren = children(node);
      const linkMarks = nodeChildren.filter((child) => child.name === "LinkMark");
      const hasDestination = nodeChildren.some((child) => child.name === "URL");

      // Reference-style or bare `[text]`: nothing is hidden, shown as written.
      if (!hasDestination || linkMarks.length < 2 || linkMarks[0].from !== node.from) {
        return;
      }

      const closeBracket = linkMarks[1];
      hide(node.from, linkMarks[0].to);
      hide(closeBracket.from, node.to, "destination");
      style(linkMarks[0].to, closeBracket.from, "cm-md-link");

      for (const child of nodeChildren) {
        if (child.from >= linkMarks[0].to && child.to <= closeBracket.from) {
          visit(child);
        }
      }

      return;
    }

    for (const child of children(node)) {
      visit(child);
    }
  };

  visit(tree.topNode);

  return lines.map((line, index): InsertedLineRender => {
    const changedRanges = changedRangesByLine[index] ?? [];
    const changed = changedMask(line.length, changedRanges);
    const wholeLineNew = isWholeLineChanged(line, changed);
    // A wholly new line is already marked by the green block; per-word
    // emphasis would only make it choppy, so it is kept for edited lines.
    const emphasisRanges = wholeLineNew ? [] : changedRanges;

    if (rawLines.has(index)) {
      return rawLine(line, emphasisRanges);
    }

    const lineFrom = lineStarts[index];

    for (let column = 0; column < line.length; column += 1) {
      const hidden = chars[lineFrom + column].hidden;

      if (hidden && changed[column] && (hidden === "destination" || !wholeLineNew)) {
        return rawLine(line, emphasisRanges);
      }
    }

    return {
      kind: "rendered",
      lineClasses: [...lineClasses[index]],
      segments: lineSegments(chars, lineFrom, line, wholeLineNew ? changed.map(() => false) : changed)
    };
  });
}

function changedMask(length: number, ranges: IntralineRange[]) {
  const mask = Array<boolean>(length).fill(false);

  for (const range of ranges) {
    for (let column = Math.max(0, range.from); column < Math.min(range.to, length); column += 1) {
      mask[column] = true;
    }
  }

  return mask;
}

function isWholeLineChanged(line: string, changed: boolean[]) {
  for (let column = 0; column < line.length; column += 1) {
    if (!changed[column] && !/\s/.test(line[column])) {
      return false;
    }
  }

  return true;
}

function lineSegments(chars: CharInfo[], lineFrom: number, line: string, changed: boolean[]) {
  const segments: RenderedInsertSegment[] = [];
  let current: RenderedInsertSegment | null = null;
  let currentKey = "";

  for (let column = 0; column < line.length; column += 1) {
    const info = chars[lineFrom + column];

    if (info.hidden && !info.replacement) {
      continue;
    }

    if (info.replacement) {
      segments.push({ text: info.replacement, classes: ["cm-list-bullet"], changed: false });
      current = null;
      currentKey = "";
      continue;
    }

    const classes = [...info.classes].sort();
    const key = `${classes.join(" ")}|${changed[column] ? 1 : 0}`;

    if (current && key === currentKey) {
      current.text += line[column];
      continue;
    }

    current = { text: line[column], classes, changed: changed[column] };
    currentKey = key;
    segments.push(current);
  }

  return segments;
}

/**
 * Line numbers (1-based) of `doc` that sit inside a fenced code block: the
 * opening fence and its content, not the closing fence. Added lines anchored
 * after such a line belong to the code block and must render as source.
 */
export function fencedCodeLines(lines: readonly string[]) {
  const inside = new Set<number>();
  let fence: { char: string; length: number } | null = null;

  lines.forEach((line, index) => {
    const match = /^ {0,3}(`{3,}|~{3,})/.exec(line);

    if (fence) {
      if (match && match[1][0] === fence.char && match[1].length >= fence.length && /^ {0,3}[`~]+\s*$/.test(line)) {
        fence = null;
        return;
      }

      inside.add(index + 1);
      return;
    }

    if (match && !(match[1][0] === "`" && line.slice(line.indexOf(match[1]) + match[1].length).includes("`"))) {
      fence = { char: match[1][0], length: match[1].length };
      inside.add(index + 1);
    }
  });

  return inside;
}
