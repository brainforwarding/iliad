import type { Text } from "@codemirror/state";
import { isDisplayLatexCloseLine, isDisplayLatexOpenLine, matchOneLineDisplayLatex } from "../../markdown/mathDelimiters";

export interface DisplayMathBlock {
  from: number;
  fromLine: number;
  tex: string;
  to: number;
  toLine: number;
}

function oneLineDollarMath(text: string) {
  const match = /^\s*\$\$(.+?)\$\$\s*$/.exec(text);
  return match?.[1].trim() ? match[1].trim() : null;
}

/** A `$$`/`\[` opener line returns its matching closer predicate; otherwise null. */
function displayBlockCloser(text: string): ((line: string) => boolean) | null {
  if (text.trim() === "$$") {
    return (line) => line.trim() === "$$";
  }

  if (isDisplayLatexOpenLine(text)) {
    return (line) => isDisplayLatexCloseLine(line);
  }

  return null;
}

export function collectDisplayMathBlocks(document: Text, fencedLines?: Set<number>) {
  const blocks = new Map<number, DisplayMathBlock>();
  let lineNumber = 1;

  while (lineNumber <= document.lines) {
    if (fencedLines?.has(lineNumber)) {
      lineNumber += 1;
      continue;
    }

    const line = document.line(lineNumber);
    const oneLineTex = oneLineDollarMath(line.text) ?? matchOneLineDisplayLatex(line.text);

    if (oneLineTex) {
      blocks.set(lineNumber, {
        from: line.from,
        fromLine: lineNumber,
        tex: oneLineTex,
        to: line.to,
        toLine: lineNumber
      });
      lineNumber += 1;
      continue;
    }

    const isClose = displayBlockCloser(line.text);

    if (!isClose) {
      lineNumber += 1;
      continue;
    }

    let closeLineNumber = lineNumber + 1;
    let matched = false;

    while (closeLineNumber <= document.lines) {
      if (fencedLines?.has(closeLineNumber)) {
        closeLineNumber += 1;
        continue;
      }

      const closeLine = document.line(closeLineNumber);

      if (isClose(closeLine.text)) {
        const texLines: string[] = [];

        for (let texLineNumber = lineNumber + 1; texLineNumber < closeLineNumber; texLineNumber += 1) {
          texLines.push(document.line(texLineNumber).text);
        }

        const tex = texLines.join("\n");

        if (tex.trim()) {
          blocks.set(lineNumber, {
            from: line.from,
            fromLine: lineNumber,
            tex,
            to: closeLine.to,
            toLine: closeLineNumber
          });
        }

        lineNumber = closeLineNumber + 1;
        matched = true;
        break;
      }

      closeLineNumber += 1;
    }

    if (!matched) {
      lineNumber += 1;
    }
  }

  return blocks;
}
