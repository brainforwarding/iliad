import { EditorState, Text } from "@codemirror/state";
import { EditorView, type Decoration, type DecorationSet } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { collectInlineMarkdownRanges } from "../../src/editor/visualMarkdown/inline";
import { visualMarkdown } from "../../src/editor/visualMarkdown";
import { collectDisplayMathBlocks } from "../../src/editor/visualMarkdown/math";

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

function createVisualMarkdownState(doc: string, anchor: number) {
  return EditorState.create({
    doc,
    selection: { anchor },
    extensions: [
      visualMarkdown({
        documentPath: "/ws/doc.md",
        initialEditorFocused: true,
        labels: {
          markdownImage: "image",
          youtubeVideo: "video",
          markTaskIncomplete: "incomplete",
          markTaskComplete: "complete"
        },
        onOpenLink: () => undefined
      })
    ]
  });
}

function classDecorations(state: EditorState, className: string) {
  return collectDecorations(state).filter((entry) => (entry.value.spec as { class?: string }).class === className);
}

function widgetDecorations(state: EditorState) {
  return collectDecorations(state).filter((entry) => Boolean((entry.value.spec as { widget?: unknown }).widget));
}

describe("visual Markdown inline ranges", () => {
  it("keeps a bold-wrapped link renderable as both strong text and a link", () => {
    const ranges = collectInlineMarkdownRanges("**[example.com](https://example.com)**");

    expect(ranges.strong).toEqual([
      {
        from: 0,
        to: 38,
        contentFrom: 2,
        contentTo: 36
      }
    ]);
    expect(ranges.links).toEqual([
      {
        from: 2,
        to: 36,
        labelFrom: 3,
        labelTo: 14,
        href: "https://example.com"
      }
    ]);
  });

  it("keeps strong markers inside a link label renderable", () => {
    const ranges = collectInlineMarkdownRanges("[**Android**](https://play.google.com/store/apps)");

    expect(ranges.links).toHaveLength(1);
    expect(ranges.links[0]).toMatchObject({
      from: 0,
      labelFrom: 1,
      labelTo: 12,
      href: "https://play.google.com/store/apps"
    });
    expect(ranges.strong).toEqual([
      {
        from: 1,
        to: 12,
        contentFrom: 3,
        contentTo: 10
      }
    ]);
  });

  it("does not parse link-looking text inside inline code", () => {
    const ranges = collectInlineMarkdownRanges("`[not a link](https://example.test)`");

    expect(ranges.code).toHaveLength(1);
    expect(ranges.links).toEqual([]);
  });

  it("collects inline and display math separately", () => {
    const inlineRanges = collectInlineMarkdownRanges("Use $x^2 + y^2$ here.");
    const displayBlocks = collectDisplayMathBlocks(Text.of(["Intro", "$$", "x^2 + y^2", "$$", "Done"]));

    expect(inlineRanges.math).toEqual([
      {
        from: 4,
        to: 15,
        contentFrom: 5,
        contentTo: 14,
        tex: "x^2 + y^2"
      }
    ]);
    expect(displayBlocks.get(2)).toMatchObject({
      fromLine: 2,
      toLine: 4,
      tex: "x^2 + y^2"
    });
  });

  it("treats backslash-escaped Markdown punctuation as literal text", () => {
    const ranges = collectInlineMarkdownRanges("\\*not emphasis\\* and 2\\. section and \\=PROMEDIO(B1:E1)");

    expect(ranges.strong).toEqual([]);
    expect(ranges.emphasis).toEqual([]);
    expect(ranges.escapes).toEqual([
      { from: 0, to: 2, markerFrom: 0, markerTo: 1, contentFrom: 1, contentTo: 2 },
      { from: 14, to: 16, markerFrom: 14, markerTo: 15, contentFrom: 15, contentTo: 16 },
      { from: 22, to: 24, markerFrom: 22, markerTo: 23, contentFrom: 23, contentTo: 24 },
      { from: 37, to: 39, markerFrom: 37, markerTo: 38, contentFrom: 38, contentTo: 39 }
    ]);
  });

  it("hides Markdown escape backslashes on inactive lines", () => {
    const doc = "Intro\n\\=PROMEDIO(B1:E1)\n2\\. Funciones";
    const state = EditorState.create({
      doc,
      selection: { anchor: 0 },
      extensions: [
        visualMarkdown({
          documentPath: "/ws/doc.md",
          initialEditorFocused: true,
          labels: {
            markdownImage: "image",
            youtubeVideo: "video",
            markTaskIncomplete: "incomplete",
            markTaskComplete: "complete"
          },
          onOpenLink: () => undefined
        })
      ]
    });

    const formulaBackslash = doc.indexOf("\\=PROMEDIO");
    const sectionBackslash = doc.indexOf("\\. Funciones");
    const hiddenBackslashes = collectDecorations(state).filter(
      (entry) =>
        Boolean((entry.value.spec as { widget?: unknown }).widget) &&
        ((entry.from === formulaBackslash && entry.to === formulaBackslash + 1) ||
          (entry.from === sectionBackslash && entry.to === sectionBackslash + 1))
    );

    expect(hiddenBackslashes).toHaveLength(2);
  });

  it("keeps Markdown source visible on the active line when initialized focused", () => {
    const state = createVisualMarkdownState("A **bold** statement", 4);

    expect(widgetDecorations(state)).toHaveLength(0);
    expect(classDecorations(state, "cm-md-strong")).toMatchObject([{ from: 4, to: 8 }]);
  });

  it("updates active-line emphasis immediately when the closing marker is typed", () => {
    const initialDoc = "Iliad is built around *that";
    let state = createVisualMarkdownState(initialDoc, initialDoc.length);

    state = state.update({ changes: { from: initialDoc.length, insert: "*" }, selection: { anchor: initialDoc.length + 1 } }).state;

    const contentFrom = "Iliad is built around *".length;
    const contentTo = contentFrom + "that".length;
    expect(classDecorations(state, "cm-md-emphasis")).toMatchObject([{ from: contentFrom, to: contentTo }]);
    expect(widgetDecorations(state)).toHaveLength(0);
  });

  it("updates active-line strong styling immediately when the closing marker is typed", () => {
    const initialDoc = "Iliad is built around **that";
    let state = createVisualMarkdownState(initialDoc, initialDoc.length);

    state = state.update({ changes: { from: initialDoc.length, insert: "**" }, selection: { anchor: initialDoc.length + 2 } }).state;

    const contentFrom = "Iliad is built around **".length;
    const contentTo = contentFrom + "that".length;
    expect(classDecorations(state, "cm-md-strong")).toMatchObject([{ from: contentFrom, to: contentTo }]);
    expect(widgetDecorations(state)).toHaveLength(0);
  });
});
