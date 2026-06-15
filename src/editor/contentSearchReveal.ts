import type { EditorState } from "@codemirror/state";

export interface ContentSearchRevealTarget {
  filePath: string;
  startOffset: number;
  endOffset: number;
  lineNumber: number;
  matchedText: string;
  requestId: number;
}

export type ContentSearchRevealPlan =
  | { kind: "exact"; from: number; to: number }
  | { kind: "line"; from: number; to: number };

function clampOffset(value: number, length: number) {
  return Math.max(0, Math.min(value, length));
}

export function resolveContentSearchReveal(state: EditorState, target: ContentSearchRevealTarget): ContentSearchRevealPlan {
  const length = state.doc.length;
  const from = clampOffset(target.startOffset, length);
  const to = clampOffset(Math.max(target.startOffset, target.endOffset), length);

  if (to > from && state.sliceDoc(from, to) === target.matchedText) {
    return { kind: "exact", from, to };
  }

  const lineNumber = Math.max(1, Math.min(target.lineNumber, state.doc.lines));
  const line = state.doc.line(lineNumber);

  return { kind: "line", from: line.from, to: line.from };
}
