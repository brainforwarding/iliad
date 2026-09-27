import { EditorState } from "@codemirror/state";
import { EditorView, type Decoration, type DecorationSet } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { aiReviewExtension, reviewSourceLineClasses } from "../../src/editor/aiReview/extension";
import type { DisplayReviewHunk } from "../../src/editor/aiReview/diff";
import {
  fencedCodeLines,
  renderInsertedLines,
  type InsertedLineRender
} from "../../src/editor/aiReview/renderedInsert";

function visibleText(line: InsertedLineRender) {
  return line.kind === "raw" ? line.text : line.segments.map((segment) => segment.text).join("");
}

function wholeLines(lines: string[]) {
  return lines.map((line) => [{ from: 0, to: line.length }]);
}

function rendered(line: InsertedLineRender) {
  if (line.kind !== "rendered") {
    throw new Error(`expected a rendered line, got raw: ${line.text}`);
  }

  return line;
}

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
  it("classifies raw-source fallback rows without hiding syntax", () => {
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

  it("renders added lines through the widget as Markdown without syntax characters", () => {
    const hunk: DisplayReviewHunk = {
      id: "hunk-1",
      status: "pending",
      anchorLine: 1,
      oldStartLine: 1,
      oldLines: [],
      newLines: ["## Added title", "> A **bold** quote", "- Added *item*"],
      displayOldStartLine: 1,
      displayOldEndLine: 0,
      displayAnchorLine: 1
    };

    const decorations = collectDecorations(createReviewState("Body", [hunk]));
    const widget = decorations.find(({ value }) => value.spec.widget)?.value.spec.widget as unknown as {
      renderedLines(): InsertedLineRender[];
    };
    const lines = widget.renderedLines();

    expect(lines.map(visibleText)).toEqual(["Added title", "A bold quote", "• Added item"]);
    expect(rendered(lines[0]).lineClasses).toEqual(expect.arrayContaining(["cm-md-heading-line", "cm-md-heading-2"]));
    expect(rendered(lines[1]).lineClasses).toContain("cm-md-blockquote-line");
    expect(rendered(lines[1]).segments).toContainEqual({ text: "bold", classes: ["cm-md-strong"], changed: false });
    // Wholly new lines get no per-word emphasis: the green block already marks them.
    expect(rendered(lines[1]).segments.every((segment) => !segment.changed)).toBe(true);
    expect(rendered(lines[2]).lineClasses).toContain("cm-md-list-line");
    expect(rendered(lines[2]).segments[0]).toEqual({ text: "•", classes: ["cm-list-bullet"], changed: false });
    expect(rendered(lines[2]).segments).toContainEqual({ text: "item", classes: ["cm-md-emphasis"], changed: false });
  });

  it("keeps changed-word emphasis inside rendered spans", () => {
    const line = "Keep **the new words** here";
    const changedFrom = line.indexOf("new");
    const [result] = renderInsertedLines([line], [[{ from: changedFrom, to: changedFrom + "new".length }]]);

    expect(rendered(result).segments).toEqual([
      { text: "Keep ", classes: [], changed: false },
      { text: "the ", classes: ["cm-md-strong"], changed: false },
      { text: "new", classes: ["cm-md-strong"], changed: true },
      { text: " words", classes: ["cm-md-strong"], changed: false },
      { text: " here", classes: [], changed: false }
    ]);
  });

  it("renders links as their text when the destination is unchanged", () => {
    const line = "See [the guide](https://example.com) now";
    const changedFrom = line.indexOf("now");
    const [result] = renderInsertedLines([line], [[{ from: changedFrom, to: line.length }]]);

    expect(visibleText(result)).toBe("See the guide now");
    expect(rendered(result).segments).toContainEqual({ text: "the guide", classes: ["cm-md-link"], changed: false });
  });

  it("shows a line as source when a change touches hidden syntax", () => {
    const url = "See [the guide](https://example.com/new) now";
    const urlFrom = url.indexOf("https");
    const heading = "## Title";
    const bold = "Hello **world** again";
    const boldFrom = bold.indexOf("**world**");

    const [urlLine, headingLine, boldLine] = renderInsertedLines(
      [url, heading, bold],
      [[{ from: urlFrom, to: url.indexOf(")") + 1 }], [{ from: 0, to: 2 }], [{ from: boldFrom, to: boldFrom + "**world**".length }]]
    );

    expect(urlLine).toEqual({ kind: "raw", text: url, changedRanges: [{ from: urlFrom, to: url.indexOf(")") + 1 }] });
    expect(headingLine.kind).toBe("raw");
    expect(boldLine.kind).toBe("raw");
  });

  it("shows a wholly new line with a link as source so the destination stays visible", () => {
    const line = "Read [this](https://example.com)";
    const [result] = renderInsertedLines([line], wholeLines([line]));

    expect(result).toMatchObject({ kind: "raw", text: line });
  });

  it("shows fenced code, HTML and setext headings as source", () => {
    const lines = ["```js", "const **x** = 1;", "```", "", "<div>hi</div>", "", "Title", "====="];
    const result = renderInsertedLines(lines, wholeLines(lines));

    expect(result[0].kind).toBe("raw");
    expect(result[1]).toMatchObject({ kind: "raw", text: "const **x** = 1;" });
    expect(result[2].kind).toBe("raw");
    expect(result[4].kind).toBe("raw");
    expect(result[6].kind).toBe("raw");
    expect(result[7].kind).toBe("raw");
  });

  it("falls back to source for every line when parsing fails", () => {
    const lines = ["# Title", "**bold**"];
    const result = renderInsertedLines(lines, wholeLines(lines), {
      parse: () => {
        throw new Error("parser exploded");
      }
    });

    expect(result).toEqual([
      { kind: "raw", text: "# Title", changedRanges: [{ from: 0, to: 7 }] },
      { kind: "raw", text: "**bold**", changedRanges: [{ from: 0, to: 8 }] }
    ]);
  });

  it("shows lines added inside an existing code fence as source", () => {
    expect([...fencedCodeLines(["Intro", "```", "# not a heading", "```", "After"])]).toEqual([2, 3]);

    const hunk: DisplayReviewHunk = {
      id: "hunk-1",
      status: "pending",
      anchorLine: 2,
      oldStartLine: 3,
      oldLines: [],
      newLines: ["# comment in code"],
      displayOldStartLine: 3,
      displayOldEndLine: 2,
      displayAnchorLine: 2
    };

    const decorations = collectDecorations(createReviewState("Intro\n```\ncode\n```", [hunk]));
    const widget = decorations.find(({ value }) => value.spec.widget)?.value.spec.widget as unknown as {
      renderedLines(): InsertedLineRender[];
    };

    expect(widget.renderedLines()).toEqual([
      { kind: "raw", text: "# comment in code", changedRanges: [{ from: 0, to: "# comment in code".length }] }
    ]);
  });
});
