import type { EditorState, Range } from "@codemirror/state";
import type { Decoration } from "@codemirror/view";

export interface BlockedRange {
  from: number;
  to: number;
}

export function isActiveLine(state: EditorState, lineNumber: number, editorFocused = true, editorInteracted = editorFocused) {
  return state.selection.ranges.some((range) => {
    if (range.empty && !editorFocused && !editorInteracted) {
      return false;
    }

    const fromLine = state.doc.lineAt(range.from).number;
    const toLine = state.doc.lineAt(range.to).number;

    return lineNumber >= fromLine && lineNumber <= toLine;
  });
}

export function selectionIntersectsRange(
  state: EditorState,
  from: number,
  to: number,
  editorFocused = true,
  editorInteracted = editorFocused
) {
  return state.selection.ranges.some((range) => {
    if (range.empty) {
      return (editorFocused || editorInteracted) && range.from >= from && range.from < to;
    }

    return range.from < to && range.to > from;
  });
}

export function addInlineDecorations(
  ranges: Range<Decoration>[],
  lineFrom: number,
  text: string,
  expression: RegExp,
  addMatch: (match: RegExpExecArray, from: number, to: number) => void
) {
  expression.lastIndex = 0;

  for (let match = expression.exec(text); match; match = expression.exec(text)) {
    const from = lineFrom + match.index;
    const to = from + match[0].length;
    addMatch(match, from, to);
  }
}

export function rangeOverlapsBlocked(blockedRanges: BlockedRange[], from: number, to: number) {
  return blockedRanges.some((range) => from < range.to && to > range.from);
}

export function addBlockedRange(blockedRanges: BlockedRange[], from: number, to: number) {
  blockedRanges.push({ from, to });
}
