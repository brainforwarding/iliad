export interface SafeTightenRange {
  from: number;
  to: number;
  originalText: string;
  selectedFrom: number;
  selectedTo: number;
}

export interface TightenInlineReview {
  requestId: string;
  range: SafeTightenRange & { filePath: string };
  rewrite: string;
}

interface DocumentLine {
  from: number;
  to: number;
  breakTo: number;
  text: string;
}

interface FenceState {
  lineIndex: number;
  marker: string;
}

const fencePattern = /^\s*(`{3,}|~{3,})/;
const listItemPattern = /^(\s*)(?:[-+*]\s+|\d+[.)]\s+)/;
const tableLinePattern = /^\s*\|.*\|\s*$/;

export function safeTightenRangeForSelection(
  documentText: string,
  selection: { from: number; to: number }
): SafeTightenRange | null {
  if (!documentText) {
    return null;
  }

  const selectionFrom = clamp(Math.min(selection.from, selection.to), 0, documentText.length);
  const selectionTo = clamp(Math.max(selection.from, selection.to), 0, documentText.length);

  if (selectionTo <= selectionFrom || !documentText.slice(selectionFrom, selectionTo).trim()) {
    return null;
  }

  const lines = documentLines(documentText);
  const startLineIndex = lineIndexAt(lines, selectionFrom);
  const endLineIndex = lineIndexAt(lines, Math.max(selectionFrom, selectionTo - 1));
  const fenced = fencedRangeContaining(lines, startLineIndex, endLineIndex);
  const range =
    fenced ??
    tableRangeContaining(lines, startLineIndex, endLineIndex) ??
    listItemRangeContaining(lines, startLineIndex, endLineIndex) ??
    blockRangeContaining(lines, startLineIndex, endLineIndex);

  if (!range || range.to <= range.from) {
    return null;
  }

  return {
    from: range.from,
    to: range.to,
    originalText: documentText.slice(range.from, range.to),
    selectedFrom: clamp(selectionFrom - range.from, 0, range.to - range.from),
    selectedTo: clamp(selectionTo - range.from, 0, range.to - range.from)
  };
}

function documentLines(documentText: string): DocumentLine[] {
  const lines: DocumentLine[] = [];
  let from = 0;

  for (let index = 0; index < documentText.length; index += 1) {
    const char = documentText[index];

    if (char !== "\n" && char !== "\r") {
      continue;
    }

    let lineBreakLength = 1;
    let breakTo = index + 1;
    if (char === "\r" && documentText[index + 1] === "\n") {
      lineBreakLength = 2;
      breakTo = index + 2;
      index += 1;
    }

    lines.push({
      from,
      to: breakTo - lineBreakLength,
      breakTo,
      text: documentText.slice(from, breakTo - lineBreakLength)
    });
    from = breakTo;
  }

  if (from < documentText.length || lines.length === 0) {
    lines.push({
      from,
      to: documentText.length,
      breakTo: documentText.length,
      text: documentText.slice(from)
    });
  }

  return lines;
}

function lineIndexAt(lines: DocumentLine[], position: number) {
  const pos = Math.max(0, position);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (pos >= line.from && pos < line.breakTo) {
      return index;
    }
  }

  return lines.length - 1;
}

function fencedRangeContaining(lines: DocumentLine[], startLineIndex: number, endLineIndex: number) {
  let open: FenceState | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const marker = fenceMarker(lines[index].text);

    if (!marker) {
      continue;
    }

    if (!open) {
      open = { lineIndex: index, marker };
      continue;
    }

    if (marker[0] === open.marker[0] && marker.length >= open.marker.length) {
      if (startLineIndex >= open.lineIndex && endLineIndex <= index) {
        return {
          from: lines[open.lineIndex].from,
          to: lines[index].to
        };
      }

      open = null;
    }
  }

  if (open && startLineIndex >= open.lineIndex) {
    return {
      from: lines[open.lineIndex].from,
      to: lines[lines.length - 1].to
    };
  }

  return null;
}

function blockRangeContaining(lines: DocumentLine[], startLineIndex: number, endLineIndex: number) {
  let start = startLineIndex;
  let end = endLineIndex;

  while (start > 0 && lines[start - 1].text.trim()) {
    start -= 1;
  }

  while (end < lines.length - 1 && lines[end + 1].text.trim()) {
    end += 1;
  }

  return {
    from: lines[start].from,
    to: lines[end].to
  };
}

function tableRangeContaining(lines: DocumentLine[], startLineIndex: number, endLineIndex: number) {
  if (!lines.slice(startLineIndex, endLineIndex + 1).some((line) => isTableLine(line.text))) {
    return null;
  }

  let start = startLineIndex;
  let end = endLineIndex;

  while (start > 0 && isTableLine(lines[start - 1].text)) {
    start -= 1;
  }

  while (end < lines.length - 1 && isTableLine(lines[end + 1].text)) {
    end += 1;
  }

  return {
    from: lines[start].from,
    to: lines[end].to
  };
}

function listItemRangeContaining(lines: DocumentLine[], startLineIndex: number, endLineIndex: number) {
  const startItemIndex = nearestListItemStart(lines, startLineIndex);
  const endItemIndex = nearestListItemStart(lines, endLineIndex);

  if (startItemIndex === null || endItemIndex === null || startItemIndex !== endItemIndex) {
    return null;
  }

  const baseIndent = listItemIndent(lines[startItemIndex].text);
  if (baseIndent === null) {
    return null;
  }

  let end = startItemIndex;

  for (let index = startItemIndex + 1; index < lines.length; index += 1) {
    const text = lines[index].text;

    if (!text.trim()) {
      break;
    }

    const nextItemIndent = listItemIndent(text);

    if (nextItemIndent !== null && nextItemIndent <= baseIndent) {
      break;
    }

    end = index;
  }

  return {
    from: lines[startItemIndex].from,
    to: lines[end].to
  };
}

function nearestListItemStart(lines: DocumentLine[], lineIndex: number) {
  for (let index = lineIndex; index >= 0; index -= 1) {
    const text = lines[index].text;

    if (!text.trim()) {
      return null;
    }

    if (isListItemLine(text)) {
      return index;
    }
  }

  return null;
}

function fenceMarker(line: string) {
  return fencePattern.exec(line)?.[1] ?? "";
}

function isListItemLine(line: string) {
  return listItemPattern.test(line);
}

function listItemIndent(line: string) {
  const match = listItemPattern.exec(line);
  return match ? match[1].length : null;
}

function isTableLine(line: string) {
  return tableLinePattern.test(line);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}
