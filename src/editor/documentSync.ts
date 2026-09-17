import { Annotation, type EditorState } from "@codemirror/state";

/**
 * Marks a transaction that replaces the document from app state (a file
 * open, a kept outside version, a review snapshot). The host's update
 * listener skips these so they never echo back through `onChange` as if the
 * writer had typed them.
 */
export const externalDocumentChange = Annotation.define<boolean>();

/**
 * The subset of `EditorView` the document sync needs, so the helper can be
 * exercised against a plain `EditorState` in tests.
 */
export interface DocumentSyncTarget {
  state: EditorState;
  dispatch: (transaction: {
    changes: { from: number; to: number; insert: string };
    annotations: ReturnType<typeof externalDocumentChange.of>[];
  }) => void;
}

/**
 * Replace the editor document with `value` when they differ.
 *
 * Iliad owns this sync instead of relying on `@uiw/react-codemirror`: that
 * wrapper defers external value updates behind a "typing latch" driven by a
 * 1 ms interval counter. Under timer clamping or an occluded window the latch
 * holds for seconds (or minutes), and every keystroke re-arms it, so the
 * editor kept showing a stale buffer while app state (and autosave) had
 * already moved to another document or to a kept outside version.
 */
export function syncEditorDocument(target: DocumentSyncTarget, value: string): boolean {
  const current = target.state.doc.toString();

  if (current === value) {
    return false;
  }

  target.dispatch({
    changes: { from: 0, to: current.length, insert: value },
    annotations: [externalDocumentChange.of(true)]
  });
  return true;
}
