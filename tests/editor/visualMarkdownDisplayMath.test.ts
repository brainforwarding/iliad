import { EditorState } from "@codemirror/state";
import { EditorView, type Decoration, type DecorationSet } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { visualMarkdown } from "../../src/editor/visualMarkdown";
import { DisplayMathWidget } from "../../src/editor/visualMarkdown/widgets";

const labels = {
  markdownImage: "image",
  youtubeVideo: "video",
  markTaskIncomplete: "todo",
  markTaskComplete: "done"
};

function createState(doc: string, anchor = 0, blockedLineRanges?: Array<{ from: number; to: number }>) {
  return EditorState.create({
    doc,
    selection: { anchor },
    extensions: [
      visualMarkdown({
        documentPath: "doc.md",
        blockedLineRanges,
        labels,
        onOpenLink: () => {}
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

function displayMathDecorations(state: EditorState) {
  return collectDecorations(state).filter(
    (entry) => (entry.value.spec as { block?: boolean }).block && entry.value.spec.widget instanceof DisplayMathWidget
  );
}

describe("visual markdown display math", () => {
  it("renders an inactive fenced block as a block widget (the legal, state-derived source)", () => {
    const state = createState("Intro\n$$\nx^2 + y^2\n$$\nDone", 0);
    const blocks = displayMathDecorations(state);

    expect(blocks).toHaveLength(1);
    expect((blocks[0].value.spec.widget as DisplayMathWidget).eq(new DisplayMathWidget("x^2 + y^2"))).toBe(true);
  });

  it("shows source (no block widget) when the cursor is inside the block", () => {
    // anchor inside the "x^2 + y^2" line
    const doc = "Intro\n$$\nx^2 + y^2\n$$\nDone";
    const insideAnchor = doc.indexOf("x^2");
    expect(displayMathDecorations(createState(doc, insideAnchor))).toHaveLength(0);
  });

  it("renders a one-line $$x$$ block when inactive", () => {
    expect(displayMathDecorations(createState("Text\n$$a^2$$\nMore", 0))).toHaveLength(1);
  });

  it("does not emit a block widget for review-blocked math lines", () => {
    const doc = "Intro\n$$\nx^2\n$$\nDone";
    // block spans document lines 2..4
    const blocked = [{ from: 2, to: 4 }];
    expect(displayMathDecorations(createState(doc, 0, blocked))).toHaveLength(0);
  });

  it("renders a one-line LaTeX \\[ … \\] display block", () => {
    expect(displayMathDecorations(createState("Text\n\\[ a^2 + b^2 \\]\nMore", 0))).toHaveLength(1);
  });

  it("renders a multiline LaTeX \\[ … \\] display block", () => {
    expect(displayMathDecorations(createState("Intro\n\\[\nx^2\n\\]\nDone", 0))).toHaveLength(1);
  });

  it("does not treat $$ inside a fenced code block as display math", () => {
    expect(displayMathDecorations(createState("```\n$$\nx^2\n$$\n```", 0))).toHaveLength(0);
  });
});
