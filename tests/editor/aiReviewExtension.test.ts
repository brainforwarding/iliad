import { EditorState } from "@codemirror/state";
import { EditorView, type Decoration, type DecorationSet } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { aiReviewExtension, reviewSourceLineClasses } from "../../src/editor/aiReview/extension";
import type { DisplayReviewHunk } from "../../src/editor/aiReview/diff";

function createReviewState(
  doc: string,
  hunks: DisplayReviewHunk[],
  options: {
    mode?: "edit_file" | "create_file" | "delete_file";
    createLineCount?: number;
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

function decorationClass(value: Decoration) {
  return (value.spec as { class?: string }).class ?? "";
}

function hasDecorationClass(value: Decoration, className: string) {
  return decorationClass(value).split(/\s+/).includes(className);
}

describe("ai review extension", () => {
  it("classifies review source Markdown without hiding syntax", () => {
    expect(reviewSourceLineClasses("# Title")).toContain("cm-ai-review-source-heading-1");
    expect(reviewSourceLineClasses("## Section")).toContain("cm-ai-review-source-heading-2");
    expect(reviewSourceLineClasses("- item")).toContain("cm-ai-review-source-list");
    expect(reviewSourceLineClasses("> quote")).toContain("cm-ai-review-source-blockquote");
  });

  it("keeps a removed-line marker when a removed blank line has no text range", () => {
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

    const emptyLineMarker = decorations.find(({ from, to, value }) => from === 6 && to === 6 && value.spec.widget);

    expect(emptyLineMarker?.value.spec.widget).toMatchObject({
      className: "cm-ai-review-line-removed"
    });
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

    const decorations = collectDecorations(createReviewState(oldLine, [hunk]));
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

  it("keeps collapsed replacements as replacement widgets without line decorations", () => {
    const oldLine = "# Workshop Plan";
    const newLine = "# Better Workshop Plan";
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

    const decorations = collectDecorations(createReviewState(oldLine, [hunk]));
    const collapsedSource = decorations.find(({ from, to, value }) => from === 0 && to === oldLine.length && value.spec.widget);
    const sourceLineDecoration = decorations.find(
      ({ from, to, value }) => from === 0 && to === 0 && hasDecorationClass(value, "cm-ai-review-source-line")
    );

    expect(collapsedSource?.value.spec.widget).toMatchObject({
      baseClassName: "cm-ai-review-line-inserted",
      text: newLine
    });
    expect(sourceLineDecoration).toBeUndefined();
  });

  it("renders collapsed insertions on blank source lines without replacement decorations", () => {
    const hunk: DisplayReviewHunk = {
      id: "hunk-1",
      status: "pending",
      anchorLine: 1,
      oldStartLine: 1,
      oldLines: [""],
      newLines: ["Inserted line"],
      displayOldStartLine: 1,
      displayOldEndLine: 1,
      displayAnchorLine: 1
    };

    const decorations = collectDecorations(createReviewState("\nNext line", [hunk]));
    const insertedWidget = decorations.find(({ from, to, value }) => from === 0 && to === 0 && value.spec.widget);

    expect(insertedWidget?.value.spec.widget).toMatchObject({
      baseClassName: "cm-ai-review-line-inserted",
      text: "Inserted line"
    });
  });

  it("renders create-file review headings as source-visible inserted Markdown", () => {
    const state = createReviewState("# Title\n\nBody", [], {
      mode: "create_file",
      createLineCount: 3
    });
    const decorations = collectDecorations(state);

    expect(decorations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: 0,
          to: 0,
          value: expect.objectContaining({
            spec: expect.objectContaining({
              class: expect.stringContaining("cm-ai-review-source-heading-1")
            })
          })
        }),
        expect.objectContaining({
          from: 0,
          to: "# Title".length,
          value: expect.objectContaining({
            spec: expect.objectContaining({ class: "cm-ai-review-line-inserted" })
          })
        })
      ])
    );
    expect(decorations.some(({ value }) => hasDecorationClass(value, "cm-md-heading-line"))).toBe(false);
  });

  it("renders delete-file review headings as source-visible removed Markdown", () => {
    const state = createReviewState("# Title\n\nBody", [], {
      mode: "delete_file",
      createLineCount: 3
    });
    const decorations = collectDecorations(state);

    expect(decorations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: 0,
          to: 0,
          value: expect.objectContaining({
            spec: expect.objectContaining({
              class: expect.stringContaining("cm-ai-review-source-heading-1")
            })
          })
        }),
        expect.objectContaining({
          from: 0,
          to: "# Title".length,
          value: expect.objectContaining({
            spec: expect.objectContaining({ class: "cm-ai-review-line-removed" })
          })
        })
      ])
    );
    expect(decorations.some(({ value }) => value.spec.class === "cm-ai-review-line-inserted")).toBe(false);
  });

  it("renders edit-file inserted headings as per-line source rows", () => {
    const hunk: DisplayReviewHunk = {
      id: "hunk-1",
      status: "pending",
      anchorLine: 1,
      oldStartLine: 1,
      oldLines: [],
      newLines: ["# Added title", "- Added item"],
      displayOldStartLine: 1,
      displayOldEndLine: 0,
      displayAnchorLine: 0
    };

    const decorations = collectDecorations(createReviewState("Body", [hunk]));
    const widget = decorations.find(({ value }) => value.spec.widget)?.value.spec.widget;

    expect(widget).toMatchObject({
      lines: ["# Added title", "- Added item"],
      changedRangesByLine: [
        [{ from: 0, to: "# Added title".length }],
        [{ from: 0, to: "- Added item".length }]
      ]
    });
  });
});
