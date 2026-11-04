import { EditorSelection, Prec, type ChangeSpec, type StateCommand } from "@codemirror/state";
import { isolateHistory } from "@codemirror/commands";
import { keymap } from "@codemirror/view";
import { collectInlineStyles } from "./inlineStyles";

function toggleInlineStyle(style: "strong" | "emphasis"): StateCommand {
  return ({ state, dispatch }) => {
    // Claim the shortcut even when the document cannot be formatted.
    if (state.readOnly || state.selection.ranges.length !== 1) return true;
    const range = state.selection.main;
    const text = state.doc.toString();
    const styles = collectInlineStyles(text);
    if (styles.code.some((code) => range.empty
      ? range.from >= code.from && range.from < code.to
      : range.from < code.to && range.to > code.from)) return true;

    const marker = style === "strong" ? "**" : "*";
    const containingStyle = (from: number, to: number) => styles[style].filter((span) =>
      (from >= span.from && to <= span.to && from <= span.contentTo && to >= span.contentFrom) ||
      (from <= span.from && to >= span.to &&
        /^[*_\s]*$/.test(state.sliceDoc(from, span.from)) && /^[*_\s]*$/.test(state.sliceDoc(span.to, to)))
    ).sort((a, b) => (a.to - a.from) - (b.to - b.from))[0];
    const containing = containingStyle(range.from, range.to);
    // Existing source can contain cross-line emphasis. Removing its enclosing
    // style is safe; partially restyling it would require splitting Markdown.
    if (!containing && styles[style].some((span) => span.from < range.to && span.to > range.from &&
      state.doc.lineAt(span.from).number !== state.doc.lineAt(span.to).number)) return true;
    const changes: ChangeSpec[] = [];
    let emptyCaret: number | null = null;

    if (containing) {
      changes.push(
        { from: containing.from, to: containing.contentFrom },
        { from: containing.contentTo, to: containing.to }
      );
    } else if (range.empty) {
      const before = state.sliceDoc(range.from - Math.min(range.from, marker.length), range.from);
      const after = state.sliceDoc(range.from, range.from + marker.length);
      if (before === marker && after === marker) {
        changes.push({ from: range.from - marker.length, to: range.from + marker.length });
        emptyCaret = range.from - marker.length;
      } else {
        changes.push({ from: range.from, insert: marker + marker });
        emptyCaret = range.from + marker.length;
      }
    } else {
      const segments: Array<{ from: number; to: number; lineFrom: number; lineTo: number }> = [];
      for (let number = state.doc.lineAt(range.from).number; number <= state.doc.lineAt(range.to).number; number++) {
        const line = state.doc.line(number);
        // Preserve source structure when a selection includes whole lines.
        const prefix = /^(?:[ \t]*(?:>|#{1,6}|[-+*]|\d+[.)])(?:[ \t]+|$))*[ \t]*(?:\[[ xX]\][ \t]+)?/.exec(line.text)![0].length;
        const start = Math.max(range.from, line.from + prefix);
        const closingHeading = /^[ \t]*(?:>[ \t]*)*#{1,6}[ \t]+/.test(line.text)
          ? /[ \t]+#+[ \t]*$/.exec(line.text)?.[0].length ?? 0 : 0;
        const end = Math.min(range.to, line.to - closingHeading);
        if (start >= end) continue;
        const selected = state.sliceDoc(start, end);
        const from = start + selected.length - selected.trimStart().length;
        const to = end - (selected.length - selected.trimEnd().length);
        if (from >= to) continue;
        segments.push({ from, to, lineFrom: line.from, lineTo: line.to });
      }
      const allStyled = segments.every(({ from, to }) => containingStyle(from, to));
      for (const segment of segments) {
        let { from, to } = segment;
        if (allStyled) {
          const span = containingStyle(from, to)!;
          changes.push({ from: span.from, to: span.contentFrom }, { from: span.contentTo, to: span.to });
          continue;
        }
        // Joining styled and plain text should extend the existing style,
        // rather than introduce adjacent, ambiguous runs of asterisks.
        for (const span of styles[style]) {
          if (span.from < to && span.to > from && span.from >= segment.lineFrom && span.to <= segment.lineTo) {
            from = Math.min(from, span.from);
            to = Math.max(to, span.to);
          }
        }
        const opening = { from, to: from, insert: marker };
        const closing = { from: to, to, insert: marker };
        for (const span of styles[style]) {
          if (span.from < from || span.to > to) continue;
          if (span.from === from) opening.to = span.contentFrom;
          else changes.push({ from: span.from, to: span.contentFrom });
          if (span.to === to) closing.from = span.contentTo;
          else changes.push({ from: span.contentTo, to: span.to });
        }
        changes.push(opening, closing);
      }
    }
    if (!changes.length) return true;
    const changeSet = state.changes(changes);
    const from = changeSet.mapPos(range.from, 1);
    const to = changeSet.mapPos(range.to, -1);
    dispatch(state.update({
      changes: changeSet,
      selection: emptyCaret !== null ? EditorSelection.cursor(emptyCaret)
        : range.empty ? EditorSelection.cursor(from)
        : EditorSelection.range(range.anchor <= range.head ? from : to, range.anchor <= range.head ? to : from),
      scrollIntoView: true,
      userEvent: "input.format",
      annotations: isolateHistory.of("full")
    }));
    return true;
  };
}

export const toggleBold = toggleInlineStyle("strong");
export const toggleItalics = toggleInlineStyle("emphasis");

export function inlineFormattingExtension() {
  return Prec.highest(keymap.of([
    { key: "Mod-b", run: toggleBold },
    { key: "Mod-i", run: toggleItalics }
  ]));
}
