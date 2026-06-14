import { Prec, type StateCommand } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { collectMarkdownExcludedRanges, rangeIntersectsAny } from "./writingAssistContext";

function isMarkdownStructureLine(text: string) {
  return (
    /^\s*$/.test(text) ||
    /^\s*(?:[-*+]|\d+[.)])\s+/.test(text) ||
    /^\s*>\s?/.test(text) ||
    /^\s*(?:```|~~~)/.test(text) ||
    /^\s*\|/.test(text) ||
    /^\s{4,}\S/.test(text)
  );
}

export const insertPlainProseNewline: StateCommand = ({ state, dispatch }) => {
  const selection = state.selection.main;

  if (!selection.empty) {
    return false;
  }

  const line = state.doc.lineAt(selection.from);

  if (isMarkdownStructureLine(line.text)) {
    return false;
  }

  const documentText = state.doc.toString();
  const excludedRanges = collectMarkdownExcludedRanges(documentText);
  const cursorProbeRange = {
    from: Math.max(0, selection.from - 1),
    to: Math.min(documentText.length, selection.from + 1)
  };

  if (rangeIntersectsAny(cursorProbeRange, excludedRanges)) {
    return false;
  }

  dispatch(
    state.update({
      changes: { from: selection.from, insert: "\n" },
      selection: { anchor: selection.from + 1 },
      scrollIntoView: true,
      userEvent: "input.type"
    })
  );

  return true;
};

export function proseEnterExtension() {
  return Prec.highest(
    keymap.of([
      {
        key: "Enter",
        run: insertPlainProseNewline
      }
    ])
  );
}
