// Shared recognition of LaTeX math delimiters (\( … \) inline, \[ … \] display).
// Pure string utilities with no editor/React dependencies so the CodeMirror
// decorations and the react-markdown preview agree on what counts as math.
//
// Tradeoff (intentional): a paired, unescaped `\( … \)` is treated as math even
// though CommonMark would read `\(` as an escaped paren. In practice that pairing
// only appears in authored math.

export interface TextRange {
  from: number;
  to: number;
}

export interface LatexMathRange extends TextRange {
  kind: "inline" | "display";
  contentFrom: number;
  contentTo: number;
  tex: string;
}

/** A backslash at `index` is "real" (not itself escaped) when an even number of backslashes precede it. */
function backslashIsUnescaped(text: string, index: number) {
  let count = 0;
  let cursor = index - 1;

  while (cursor >= 0 && text[cursor] === "\\") {
    count += 1;
    cursor -= 1;
  }

  return count % 2 === 0;
}

function overlapsAny(ranges: TextRange[], from: number, to: number) {
  return ranges.some((range) => from < range.to && to > range.from);
}

/** Inline code spans (backtick runs) in a single line — used to protect math detection. */
export function findInlineCodeRanges(text: string): TextRange[] {
  const ranges: TextRange[] = [];
  let index = 0;

  while (index < text.length) {
    if (text[index] !== "`") {
      index += 1;
      continue;
    }

    const openStart = index;
    let openCount = 0;
    while (text[index] === "`") {
      openCount += 1;
      index += 1;
    }

    let cursor = index;
    let closeEnd = -1;
    while (cursor < text.length) {
      if (text[cursor] !== "`") {
        cursor += 1;
        continue;
      }

      let runCount = 0;
      while (text[cursor] === "`") {
        runCount += 1;
        cursor += 1;
      }

      if (runCount === openCount) {
        closeEnd = cursor;
        break;
      }
    }

    if (closeEnd === -1) {
      break; // unterminated run: leave the rest as plain text
    }

    ranges.push({ from: openStart, to: closeEnd });
    index = closeEnd;
  }

  return ranges;
}

/** `\( … \)` inline math on a single line, skipping protected (code) ranges. */
export function findLatexInlineMath(text: string, protectedRanges: TextRange[] = []): LatexMathRange[] {
  const ranges: LatexMathRange[] = [];
  let index = 0;

  while (index < text.length - 1) {
    const isOpener = text[index] === "\\" && text[index + 1] === "(" && backslashIsUnescaped(text, index);

    if (!isOpener) {
      index += 1;
      continue;
    }

    let cursor = index + 2;
    let closer = -1;
    while (cursor < text.length - 1) {
      if (text[cursor] === "\n") {
        break; // same line only
      }

      if (text[cursor] === "\\" && text[cursor + 1] === ")" && backslashIsUnescaped(text, cursor)) {
        closer = cursor;
        break;
      }

      cursor += 1;
    }

    if (closer === -1) {
      index += 1;
      continue;
    }

    const from = index;
    const to = closer + 2;
    const contentFrom = index + 2;
    const contentTo = closer;
    const tex = text.slice(contentFrom, contentTo).trim();

    if (tex && !overlapsAny(protectedRanges, from, to)) {
      ranges.push({ kind: "inline", from, to, contentFrom, contentTo, tex });
      index = to;
      continue;
    }

    index += 1;
  }

  return ranges;
}

/** A whole line that is exactly `\[ … \]` (display). Returns the inner TeX or null. */
export function matchOneLineDisplayLatex(text: string): string | null {
  const match = /^\s*\\\[([^\n]+?)\\\]\s*$/.exec(text);
  return match?.[1].trim() ? match[1].trim() : null;
}

/** A standalone `\[` opener line (multiline display block). */
export function isDisplayLatexOpenLine(text: string) {
  return /^\s*\\\[\s*$/.test(text);
}

/** A standalone `\]` closer line. */
export function isDisplayLatexCloseLine(text: string) {
  return /^\s*\\\]\s*$/.test(text);
}

/** A fenced-code delimiter line (``` or ~~~). */
export function isFenceLine(text: string) {
  return /^\s*(```|~~~)/.test(text);
}

/**
 * Rewrite LaTeX math delimiters to dollar math for the react-markdown preview,
 * skipping fenced code and inline code. Display `\[ … \]` is block-only.
 */
export function latexMathToDollar(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let inFence = false;

  for (const line of lines) {
    if (isFenceLine(line)) {
      inFence = !inFence;
      out.push(line);
      continue;
    }

    if (inFence) {
      out.push(line);
      continue;
    }

    const displayTex = matchOneLineDisplayLatex(line);
    if (displayTex) {
      out.push(`$$${displayTex}$$`);
      continue;
    }

    if (isDisplayLatexOpenLine(line) || isDisplayLatexCloseLine(line)) {
      out.push("$$");
      continue;
    }

    const codeRanges = findInlineCodeRanges(line);
    const mathRanges = findLatexInlineMath(line, codeRanges);

    if (mathRanges.length === 0) {
      out.push(line);
      continue;
    }

    let rewritten = line;
    // Rewrite from the end so earlier offsets stay valid.
    for (let i = mathRanges.length - 1; i >= 0; i -= 1) {
      const range = mathRanges[i];
      rewritten = `${rewritten.slice(0, range.from)}$${range.tex}$${rewritten.slice(range.to)}`;
    }
    out.push(rewritten);
  }

  return out.join("\n");
}
