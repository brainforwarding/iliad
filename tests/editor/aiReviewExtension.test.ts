import { EditorState } from "@codemirror/state";
import { EditorView, type Decoration, type DecorationSet } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { aiReviewExtension } from "../../src/editor/aiReview/extension";
import type { DisplayReviewHunk } from "../../src/editor/aiReview/diff";

function createReviewState(
  doc: string,
  hunks: DisplayReviewHunk[],
  options: {
    mode?: "edit_file" | "create_file" | "delete_file";
    createLineCount?: number;
    renderInsertedAsSource?: boolean;
  } = {}
) {
  return EditorState.create({
    doc,
    extensions: [
      aiReviewExtension({
        mode: options.mode ?? "edit_file",
        hunks,
        activeHunkId: null,
        createLineCount: options.createLineCount ?? 0,
        renderInsertedAsSource: options.renderInsertedAsSource,
        labels: {}
      })
    ]
  });
}

function collectDecorations(state: EditorState) {
  const decorations: Array<{ from: number; to: number; value: Decoration }> = [];

  for (const decorationSet of state.facet(EditorView.decorations)) {
    if (typeof decorationSet === "function") {
      continue;
    }

    (decorationSet as DecorationSet).between(0, state.doc.length, (from, to, value) => {
      decorations.push({ from, to, value });
    });
  }

  return decorations;
}

describe("ai review extension", () => {
  it("keeps removed-line decorations when a removed blank line has no text range", () => {
    const blankLineRemoval: DisplayReviewHunk = {
      id: "hunk-1",
      status: "pending",
      anchorLine: 2,
      oldStartLine: 2,
      oldLines: [""],
      newLines: [],
      oldLineBreaks: ["\n"],
      displayOldStartLine: 2,
      displayOldEndLine: 2,
      displayAnchorLine: 2
    };

    const state = createReviewState("alpha\n\nomega", [blankLineRemoval]);
    const decorations = collectDecorations(state);

    expect(decorations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: 6,
          to: 6,
          value: expect.objectContaining({
            spec: expect.objectContaining({ class: "cm-ai-review-line-removed" })
          })
        })
      ])
    );
    expect(decorations.some(({ value }) => value.spec.class === "cm-ai-review-removed-token")).toBe(false);
  });

  it("collapses a one-line pure insertion into one inserted source line", () => {
    const oldLine = '* ¿Qué principios serán "línea roja" (privacidad, transparencia, no reemplazar aprendizaje, equidad)?';
    const newLine = '* ¿Qué principios serán "línea roja" (privacidad, transparencia, no reemplazar el aprendizaje, equidad)?';
    const hunk: DisplayReviewHunk = {
      id: "hunk-1",
      status: "pending",
      anchorLine: 1,
      oldStartLine: 1,
      oldLines: [oldLine],
      newLines: [newLine],
      displayOldStartLine: 1,
      displayOldEndLine: 1,
      displayAnchorLine: 1
    };

    const decorations = collectDecorations(createReviewState(oldLine, [hunk], { renderInsertedAsSource: true }));
    const collapsedSource = decorations.find(({ from, to, value }) => from === 0 && to === oldLine.length && value.spec.widget);

    expect(collapsedSource?.value.spec.widget).toMatchObject({
      baseClassName: "cm-ai-review-line-inserted",
      changedClassName: "cm-ai-review-inserted-token",
      changedRanges: [{ from: 79, to: 82 }],
      text: newLine
    });
    expect(decorations.some(({ value }) => value.spec.class === "cm-ai-review-line-inserted")).toBe(false);
    expect(decorations.some(({ value }) => value.spec.class === "cm-ai-review-line-removed")).toBe(false);
    expect(decorations.some(({ value }) => value.spec.class === "cm-ai-review-removed-token")).toBe(false);
  });

  it("renders delete-file review content as removed lines only", () => {
    const state = createReviewState("alpha\nbeta", [], {
      mode: "delete_file",
      createLineCount: 2
    });
    const decorations = collectDecorations(state);
    const removedLines = decorations.filter(({ value }) => value.spec.class === "cm-ai-review-line-removed");

    expect(removedLines.map(({ from, to }) => ({ from, to }))).toEqual([
      { from: 0, to: 0 },
      { from: 6, to: 6 }
    ]);
    expect(decorations.some(({ value }) => value.spec.class === "cm-ai-review-line-inserted")).toBe(false);
  });
});
