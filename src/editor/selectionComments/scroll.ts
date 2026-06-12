import { EditorView } from "@codemirror/view";

/**
 * Scrolls the editor so the given document position is visible (used by the
 * composer chip list: clicking a row brings its highlight into view).
 * CodeMirror's scrollIntoView walks scrollable ancestors, so this works with
 * `.editor-surface` as the scroll owner (`.cm-scroller` never scrolls here).
 */
export function scrollEditorToPosition(view: EditorView, position: number) {
  const clamped = Math.max(0, Math.min(position, view.state.doc.length));
  view.dispatch({
    effects: EditorView.scrollIntoView(clamped, { y: "center" })
  });
}
