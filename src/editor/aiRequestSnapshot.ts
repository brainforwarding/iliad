import { isCompanionPath } from "../files/companionFiles";

/**
 * Whole-document snapshots for the built-in AI (spec 2026-09-27). The renderer
 * captures the full current document from CodeMirror at request time; main
 * trims it to the byte budget and builds the outline.
 */

export interface AutocompleteDocumentSnapshot {
  text: string;
  cursor: number;
}

export interface SelectionDocumentSnapshot {
  text: string;
  selectionFrom: number;
  selectionTo: number;
}

/**
 * Built-in assists (autocomplete, ✦ AI edits) are off while a comments
 * companion (`*.comments.md`) is itself the open document, so a companion is
 * never sent as context.
 */
export function builtInAiAssistsAllowed(documentPath: string | null | undefined) {
  return Boolean(documentPath) && !isCompanionPath(documentPath as string);
}

export function autocompleteDocumentSnapshot(text: string, cursor: number): AutocompleteDocumentSnapshot | null {
  if (!Number.isInteger(cursor) || cursor < 0 || cursor > text.length) return null;
  return { text, cursor };
}

/**
 * An answer belongs to the document it was asked about: any change to the
 * document or the cursor since the request discards it.
 */
export function autocompleteSnapshotIsCurrent(
  snapshot: AutocompleteDocumentSnapshot,
  current: { text: string; cursor: number; selectionEmpty: boolean }
) {
  return current.selectionEmpty && current.cursor === snapshot.cursor && current.text === snapshot.text;
}

/**
 * The ✦ AI edit snapshot: the full document with the absolute selection
 * range. `passage` is the safe unit sent as the editable text (offsets are
 * relative to `passage.from`); it must still match the document, or no
 * snapshot is sent (the edit then goes out with its passage only).
 */
export function selectionDocumentSnapshot(
  text: string,
  passage: { from: number; to: number; originalText: string; selectedFrom: number; selectedTo: number }
): SelectionDocumentSnapshot | undefined {
  const { from, to, originalText, selectedFrom, selectedTo } = passage;
  if (from < 0 || to > text.length || from > to || text.slice(from, to) !== originalText) return undefined;
  if (selectedFrom < 0 || selectedTo > originalText.length || selectedFrom > selectedTo) return undefined;
  return { text, selectionFrom: from + selectedFrom, selectionTo: from + selectedTo };
}
