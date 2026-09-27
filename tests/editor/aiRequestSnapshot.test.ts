import { EditorState, type TransactionSpec } from "@codemirror/state";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  autocompleteDocumentSnapshot,
  autocompleteSnapshotIsCurrent,
  builtInAiAssistsAllowed,
  selectionDocumentSnapshot
} from "../../src/editor/aiRequestSnapshot";
import {
  ideaAutocompleteExtension,
  resetSharedAutocompleteCooldownForTests,
  type IdeaAutocompleteExtensionOptions,
  type IdeaAutocompleteRequestPayload
} from "../../src/editor/ideaAutocomplete/extension";
import { safeTightenRangeForSelection } from "../../src/editor/tightenSafeRange";
import type { IdeaAutocompleteResult } from "../../src/types/iliad";

// The actual plugin against real CodeMirror transactions, without a DOM renderer.
function harness(doc: string, cursor: number, options: Partial<IdeaAutocompleteExtensionOptions> = {}) {
  let resolve!: (result: IdeaAutocompleteResult) => void;
  const request = vi.fn<(payload: IdeaAutocompleteRequestPayload) => Promise<IdeaAutocompleteResult>>()
    .mockImplementation(() => new Promise((done) => { resolve = done; }));
  const extensions = ideaAutocompleteExtension({
    enabled: true, language: "en", workspaceSessionId: "session", documentRelativePath: "draft.md",
    documentTitle: "Draft", requestAutocomplete: request, cancelAutocomplete: vi.fn(), ...options
  });
  const view = {
    hasFocus: true,
    state: EditorState.create({ doc, selection: { anchor: cursor } }),
    dispatch(spec: TransactionSpec) {
      const transaction = view.state.update(spec);
      view.state = transaction.state;
      plugin.update({ state: view.state, transactions: [transaction], docChanged: transaction.docChanged,
        selectionSet: Boolean(transaction.selection), focusChanged: false, changes: transaction.changes } as ViewUpdate);
    }
  };
  const plugin = (extensions[0] as unknown as { create(view: EditorView): {
    suggestion: { insert: string } | null;
    update(update: ViewUpdate): void;
    triggerManual(kind?: "sentence" | "paragraph" | "idea"): boolean;
    extend(): boolean;
    destroy(): void;
  } }).create(view as unknown as EditorView);
  return { view, plugin, request, resolve: (result: IdeaAutocompleteResult) => resolve(result) };
}

beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal("window", globalThis); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); resetSharedAutocompleteCooldownForTests(); });

const LONG_DOC = "# Opening\n\nMara lit the lamp.\n\n# Later\n\nShe walked into the \n\n# End\n\nThe tide came in.";
const CURSOR = LONG_DOC.indexOf("into the ") + "into the ".length;

describe("autocomplete document snapshot", () => {
  it("captures the full document and cursor, rejecting impossible cursors", () => {
    expect(autocompleteDocumentSnapshot("abc", 2)).toEqual({ text: "abc", cursor: 2 });
    expect(autocompleteDocumentSnapshot("abc", 4)).toBeNull();
    expect(autocompleteDocumentSnapshot("abc", -1)).toBeNull();
  });

  it("is current only for the same text, cursor and an empty selection", () => {
    const snapshot = { text: "one two", cursor: 3 };
    expect(autocompleteSnapshotIsCurrent(snapshot, { text: "one two", cursor: 3, selectionEmpty: true })).toBe(true);
    expect(autocompleteSnapshotIsCurrent(snapshot, { text: "one two!", cursor: 3, selectionEmpty: true })).toBe(false);
    expect(autocompleteSnapshotIsCurrent(snapshot, { text: "one two", cursor: 4, selectionEmpty: true })).toBe(false);
    expect(autocompleteSnapshotIsCurrent(snapshot, { text: "one two", cursor: 3, selectionEmpty: false })).toBe(false);
  });

  it("sends the whole document, the cursor and trimmed preferences with the existing fields", () => {
    const { plugin, request } = harness(LONG_DOC, CURSOR, { writingPreferences: () => "Short sentences." });
    plugin.triggerManual("sentence");
    const payload = request.mock.calls[0][0];
    expect(payload.document).toEqual({ text: LONG_DOC, cursor: CURSOR });
    expect(payload.preferences).toBe("Short sentences.");
    // v1 fields stay: the section prefix, the heading path.
    expect(payload.prefix.endsWith("She walked into the ")).toBe(true);
    expect(payload.prefix).not.toContain("Mara");
    expect(payload.headingPath).toEqual(["Later"]);
    expect(payload.extend).toBe(false);
    plugin.destroy();
  });

  it("omits preferences when there are none", () => {
    const { plugin, request } = harness(LONG_DOC, CURSOR, { writingPreferences: () => undefined });
    plugin.triggerManual("sentence");
    expect(request.mock.calls[0][0]).not.toHaveProperty("preferences", expect.anything());
    plugin.destroy();
  });

  it("discards an answer when the document changed outside the current section", async () => {
    const { view, plugin, resolve } = harness(LONG_DOC, CURSOR);
    plugin.triggerManual("sentence");
    // A change the plugin did not see (e.g. elsewhere in the document), far from the cursor section.
    view.state = view.state.update({ changes: { from: view.state.doc.length, insert: " Again." } }).state;
    resolve({ ok: true, insert: "quiet room." });
    await vi.advanceTimersByTimeAsync(0);
    expect(plugin.suggestion).toBeNull();
    plugin.destroy();
  });

  it("keeps an answer when nothing changed", async () => {
    const { plugin, resolve } = harness(LONG_DOC, CURSOR);
    plugin.triggerManual("sentence");
    resolve({ ok: true, insert: "quiet room." });
    await vi.advanceTimersByTimeAsync(0);
    expect(plugin.suggestion?.insert).toBe("quiet room.");
    plugin.destroy();
  });

  it("extending a visible draft sends the unchanged document and the draft in the prefix", async () => {
    const { plugin, request, resolve } = harness(LONG_DOC, CURSOR);
    plugin.triggerManual("sentence");
    resolve({ ok: true, insert: "quiet room." });
    await vi.advanceTimersByTimeAsync(0);
    expect(plugin.extend()).toBe(true);
    const payload = request.mock.calls[1][0];
    expect(payload.extend).toBe(true);
    expect(payload.document).toEqual({ text: LONG_DOC, cursor: CURSOR });
    expect(payload.prefix.endsWith("into the quiet room.")).toBe(true);
    plugin.destroy();
  });

  it("still offers no completion with the cursor inside fenced code", () => {
    const doc = "Intro text here.\n\n```js\nconst a = \n```\n";
    const { plugin, request } = harness(doc, doc.indexOf("const a = ") + "const a = ".length);
    plugin.triggerManual("sentence");
    expect(request).not.toHaveBeenCalled();
    plugin.destroy();
  });
});

describe("✦ AI edit document snapshot", () => {
  const doc = "# Notes\n\nMara lit the lamp. It was late and the room was very very cold.\n\nThe tide came in.";

  it("carries the whole document with the absolute selection range", () => {
    const from = doc.indexOf("It was");
    const to = doc.indexOf("cold.") + "cold.".length;
    const range = safeTightenRangeForSelection(doc, { from, to });
    expect(range).not.toBeNull();
    const snapshot = selectionDocumentSnapshot(doc, range!);
    expect(snapshot).toEqual({ text: doc, selectionFrom: from, selectionTo: to });
    expect(snapshot!.text.slice(snapshot!.selectionFrom, snapshot!.selectionTo)).toBe("It was late and the room was very very cold.");
  });

  it("sends no snapshot when the passage no longer matches the document", () => {
    const from = doc.indexOf("It was");
    const range = safeTightenRangeForSelection(doc, { from, to: from + 10 })!;
    expect(selectionDocumentSnapshot(doc.replace("Mara", "Nora!"), range)).toBeUndefined();
  });

  it("still allows a selected fenced block to be edited, with the document", () => {
    const fenced = "Intro.\n\n```js\nconst a = 1;\nconst b = 2;\n```\n\nOutro.";
    const from = fenced.indexOf("```js");
    const to = fenced.lastIndexOf("```") + 3;
    const range = safeTightenRangeForSelection(fenced, { from, to });
    expect(range).not.toBeNull();
    expect(selectionDocumentSnapshot(fenced, range!)?.text).toBe(fenced);
  });
});

describe("companion gating", () => {
  it("turns built-in assists off inside a comments companion", () => {
    expect(builtInAiAssistsAllowed("/w/chapter.md")).toBe(true);
    expect(builtInAiAssistsAllowed("/w/chapter.comments.md")).toBe(false);
    expect(builtInAiAssistsAllowed("C:\\w\\Chapter.COMMENTS.md")).toBe(false);
    // Notes are ordinary documents now (ADR-0022).
    expect(builtInAiAssistsAllowed("/w/chapter.notes.md")).toBe(true);
    expect(builtInAiAssistsAllowed(null)).toBe(false);
  });
});
