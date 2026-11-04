import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { visualMarkdown } from "../../src/editor/visualMarkdown";
import { hiddenFormatClickPosition } from "../../src/editor/visualMarkdown/clickPlacement";

function fixture(line: string, hit: number, active = false) {
  const state = EditorState.create({
    doc: `Intro\n${line}`,
    selection: { anchor: active ? 6 : 0 },
    extensions: [visualMarkdown({
      documentPath: "/qa/sample.md", initialEditorFocused: active,
      labels: { markdownImage: "image", youtubeVideo: "video", markTaskIncomplete: "incomplete", markTaskComplete: "complete" },
      onOpenLink: () => undefined
    })]
  });
  let nativeHit = hit;
  const view = {
    state,
    posAtCoords: () => nativeHit,
    coordsAtPos: () => ({ left: 100, right: 100, top: 0, bottom: 20 })
  } as unknown as EditorView;
  return { view, moveNativeHit: (pos: number) => { nativeHit = pos; } };
}

const click = (x = 100, overrides: Partial<MouseEvent> = {}) => ({
  clientX: x, clientY: 10, button: 0, detail: 1,
  shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...overrides
}) as MouseEvent;

describe("hidden formatting click placement", () => {
  for (const marker of ["*", "**", "***"]) {
    it(`${marker}: groups hidden markers and applies the space rule`, () => {
      const start = fixture(`${marker}word${marker} here`, 6 + marker.length);
      expect(hiddenFormatClickPosition(start.view, click())).toBe(6);
      const inside = fixture(`Some ${marker}word${marker} here`, 11);
      expect(hiddenFormatClickPosition(inside.view, click())).toBe(11 + marker.length);
      const end = 6 + marker.length + 4;
      const right = fixture(`${marker}word${marker} here`, end + marker.length);
      expect(hiddenFormatClickPosition(right.view, click())).toBe(end);
    });
  }

  it("preserves the original click after a following space when markers reveal", () => {
    const { view, moveNativeHit } = fixture("**word** here", 15);
    const event = click(130);
    const style = view.state.facet(EditorView.mouseSelectionStyle)[0](view, event)!;
    // Revealed ** markers move a second coordinate hit back into the word.
    moveNativeHit(12);
    expect(style.get(event, false, false).main).toMatchObject({ anchor: 15, head: 15 });
    expect(style.get(click(150), false, false).main).toMatchObject({ anchor: 15, head: 12 });
  });

  it("leaves literal source, modifier clicks, and double clicks to CodeMirror", () => {
    const visible = fixture("**word** here", 7, true);
    expect(hiddenFormatClickPosition(visible.view, click())).toBeNull();
    const { view } = fixture("**word** here", 8);
    const makeStyle = view.state.facet(EditorView.mouseSelectionStyle)[0];
    for (const overrides of [{ detail: 2 }, { detail: 3 }, { shiftKey: true }, { metaKey: true }, { button: 2 }]) {
      expect(makeStyle(view, click(100, overrides))).toBeNull();
    }
  });
});
