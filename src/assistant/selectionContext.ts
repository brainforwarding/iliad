export interface EditorSelectionRange {
  from: number;
  to: number;
}

export function selectionRangesEqual(a: EditorSelectionRange | null, b: EditorSelectionRange | null) {
  if (a === null || b === null) {
    return a === b;
  }

  return a.from === b.from && a.to === b.to;
}

/** 1-based line range of a selection within the given text. */
export function lineRangeOf(text: string, from: number, to: number) {
  const lineStart = text.slice(0, from).split("\n").length;
  const lineEnd = text.slice(0, Math.max(from, to - 1)).split("\n").length;
  return { lineStart, lineEnd };
}
