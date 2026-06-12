import { EditorState } from "@codemirror/state";
import { EditorView, type Decoration, type DecorationSet } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { aiReviewExtension } from "../../src/editor/aiReview/extension";
import type { DisplayReviewHunk } from "../../src/editor/aiReview/diff";

function createReviewState(doc: string, hunks: DisplayReviewHunk[]) {
  return EditorState.create({
    doc,
    extensions: [
      aiReviewExtension({
        mode: "edit_file",
        hunks,
        activeHunkId: null,
        createLineCount: 0,
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
    expect(decorations.some(({ value }) => value.spec.class === "cm-ai-review-removed-text")).toBe(false);
  });
});
