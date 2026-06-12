import { EditorState } from "@codemirror/state";
import { EditorView, type Decoration, type DecorationSet } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import {
  buildSelectionCommentDecorations,
  mergeWashSpans,
  selectionCommentMappingForChanges,
  selectionCommentsExtension,
  type SelectionCommentWashRange
} from "../../src/editor/selectionComments/extension";
import { visualMarkdown } from "../../src/editor/visualMarkdown";

function createState(doc: string, ranges: SelectionCommentWashRange[], provisional: { from: number; to: number } | null = null) {
  return EditorState.create({
    doc,
    extensions: [
      selectionCommentsExtension({
        documentPath: "/ws/doc.md",
        ranges,
        provisionalRange: provisional
      })
    ]
  });
}

function collectWashes(state: EditorState) {
  const decorations: Array<{ from: number; to: number; value: Decoration }> = [];

  for (const decorationSet of state.facet(EditorView.decorations)) {
    if (typeof decorationSet === "function") {
      continue;
    }

    (decorationSet as DecorationSet).between(0, state.doc.length, (from, to, value) => {
      if (typeof value.spec.class === "string" && value.spec.class.includes("cm-comment-wash")) {
        decorations.push({ from, to, value });
      }
    });
  }

  return decorations;
}

describe("selection comment decorations", () => {
  it("builds washes from props on a headless EditorState", () => {
    const doc = "hello brave world";
    const from = doc.indexOf("brave");
    const state = createState(doc, [{ id: "c1", from, to: from + 5 }]);
    const washes = collectWashes(state);

    expect(washes).toHaveLength(1);
    expect(washes[0]).toMatchObject({ from, to: from + 5 });
    expect(washes[0].value.spec.class).toBe("cm-comment-wash");
  });

  it("marks the provisional composing range with the same wash", () => {
    const state = createState("hello brave world", [], { from: 0, to: 5 });
    const washes = collectWashes(state);

    expect(washes).toHaveLength(1);
    expect(washes[0]).toMatchObject({ from: 0, to: 5 });
  });

  it("merges overlapping comments into a single non-compounding layer", () => {
    const state = createState("abcdefghijklmnopqrst", [
      { id: "c1", from: 3, to: 10 },
      { id: "c2", from: 7, to: 14 }
    ]);
    const washes = collectWashes(state);

    expect(washes).toHaveLength(1);
    expect(washes[0]).toMatchObject({ from: 3, to: 14 });
  });

  it("maps wash positions through edits between React rebuilds", () => {
    const doc = "hello brave world";
    const from = doc.indexOf("brave");
    const state = createState(doc, [{ id: "c1", from, to: from + 5 }]);
    const next = state.update({ changes: { from: 0, to: 0, insert: "XX" } }).state;
    const washes = collectWashes(next);

    expect(washes).toHaveLength(1);
    expect(washes[0]).toMatchObject({ from: from + 2, to: from + 7 });
  });

  it("keeps a wash spanning a bold span coherent whether syntax is hidden or revealed", () => {
    const doc = "first line\nsome **bold** text";
    const from = doc.indexOf("**bold**");
    const to = from + "**bold**".length;
    const extensions = (anchor: number) => [
      visualMarkdown({
        documentPath: "/ws/doc.md",
        labels: {
          markdownImage: "image",
          youtubeVideo: "video",
          markTaskIncomplete: "incomplete",
          markTaskComplete: "complete"
        },
        onOpenLink: () => undefined
      }),
      selectionCommentsExtension({
        documentPath: "/ws/doc.md",
        ranges: [{ id: "c1", from, to }],
        provisionalRange: null
      })
    ];

    // Inactive line: visualMarkdown hides the ** syntax.
    const hidden = EditorState.create({ doc, selection: { anchor: 0 }, extensions: extensions(0) });
    // Active line: cursor inside the bold span reveals the ** syntax.
    const revealed = EditorState.create({ doc, selection: { anchor: from + 3 }, extensions: extensions(from + 3) });

    for (const state of [hidden, revealed]) {
      const washes = collectWashes(state);
      expect(washes).toHaveLength(1);
      expect(washes[0]).toMatchObject({ from, to });
    }
  });
});

describe("mergeWashSpans", () => {
  it("clips fading spans against pending spans so washes never stack", () => {
    const spans = mergeWashSpans(
      [
        { id: "pending", from: 5, to: 15 },
        { id: "sent", from: 0, to: 20, fading: true }
      ],
      null,
      40
    );

    expect(spans).toEqual([
      { from: 0, to: 5, fading: true },
      { from: 5, to: 15, fading: false },
      { from: 15, to: 20, fading: true }
    ]);
  });

  it("clamps ranges to the document length defensively", () => {
    const spans = mergeWashSpans([{ id: "c1", from: 2, to: 99 }], null, 10);

    expect(spans).toEqual([{ from: 2, to: 10, fading: false }]);
  });

  it("falls back to no decorations instead of crashing", () => {
    const state = EditorState.create({ doc: "short" });
    const decorations = buildSelectionCommentDecorations(
      state,
      [{ id: "c1", from: Number.NaN, to: Number.NaN }],
      null
    );

    expect(decorations.size).toBe(0);
  });
});

describe("selectionCommentMappingForChanges", () => {
  const doc = "hello brave world";
  const from = doc.indexOf("brave");
  const range = { id: "c1", from, to: from + 5 };

  function changesFor(spec: { from: number; to?: number; insert?: string }) {
    const state = EditorState.create({ doc });
    return state.update({ changes: spec });
  }

  it("shifts both positions for inserts before the range", () => {
    const transaction = changesFor({ from: 0, insert: "AB" });
    const mapping = selectionCommentMappingForChanges(transaction.changes, doc.length, [range]);

    expect(mapping).toEqual({ type: "mapped", updates: [{ id: "c1", from: from + 2, to: from + 7 }] });
  });

  it("grows the range for inserts inside it", () => {
    const transaction = changesFor({ from: from + 2, insert: "ZZ" });
    const mapping = selectionCommentMappingForChanges(transaction.changes, doc.length, [range]);

    expect(mapping).toEqual({ type: "mapped", updates: [{ id: "c1", from, to: from + 7 }] });
  });

  it("does not extend the range for inserts at its boundaries or after it", () => {
    const atStart = changesFor({ from, insert: "Q" });
    const startMapping = selectionCommentMappingForChanges(atStart.changes, doc.length, [range]);
    expect(startMapping).toEqual({ type: "mapped", updates: [{ id: "c1", from: from + 1, to: from + 6 }] });

    const atEnd = changesFor({ from: range.to, insert: "Q" });
    expect(selectionCommentMappingForChanges(atEnd.changes, doc.length, [range])).toEqual({ type: "none" });

    const after = changesFor({ from: doc.length, insert: "Q" });
    expect(selectionCommentMappingForChanges(after.changes, doc.length, [range])).toEqual({ type: "none" });
  });

  it("collapses to sin ancla when the commented text is deleted", () => {
    const transaction = changesFor({ from: range.from, to: range.to, insert: "" });
    const mapping = selectionCommentMappingForChanges(transaction.changes, doc.length, [range]);

    expect(mapping).toEqual({ type: "mapped", updates: [{ id: "c1", from, to: from }] });
  });

  it("disables mapping across full-document replacements (document swap)", () => {
    const transaction = changesFor({ from: 0, to: doc.length, insert: "a completely different document" });
    const mapping = selectionCommentMappingForChanges(transaction.changes, doc.length, [range]);

    expect(mapping).toEqual({ type: "full-replacement" });
  });
});
