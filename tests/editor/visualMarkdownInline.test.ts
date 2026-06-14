import { EditorState, Text } from "@codemirror/state";
import { EditorView, type DecorationSet } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { collectInlineMarkdownRanges } from "../../src/editor/visualMarkdown/inline";
import { visualMarkdown } from "../../src/editor/visualMarkdown";
import { collectDisplayMathBlocks } from "../../src/editor/visualMarkdown/math";

function collectDecorationSpecs(state: EditorState) {
  const specs: unknown[] = [];

  for (const decorationSet of state.facet(EditorView.decorations)) {
    if (typeof decorationSet === "function") {
      continue;
    }

    (decorationSet as DecorationSet).between(0, state.doc.length, (_from, _to, value) => {
      specs.push(value.spec);
    });
  }

  return specs;
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

  it("keeps Markdown source visible on the active line when initialized focused", () => {
    const state = EditorState.create({
      doc: "A **bold** statement",
      selection: { anchor: 4 },
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

    expect(collectDecorationSpecs(state).some((spec) => Boolean((spec as { widget?: unknown }).widget))).toBe(false);
  });
});
