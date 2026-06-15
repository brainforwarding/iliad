import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { resolveContentSearchReveal } from "../../src/editor/contentSearchReveal";

describe("content search editor reveal", () => {
  it("selects the exact matched range when offsets are current", () => {
    const state = EditorState.create({ doc: "alpha beta" });

    expect(
      resolveContentSearchReveal(state, {
        filePath: "/workspace/doc.md",
        startOffset: 6,
        endOffset: 10,
        lineNumber: 1,
        matchedText: "beta",
        requestId: 1
      })
    ).toEqual({ kind: "exact", from: 6, to: 10 });
  });

  it("falls back to line reveal when the returned range is stale", () => {
    const state = EditorState.create({ doc: "changed\nsecond line" });

    expect(
      resolveContentSearchReveal(state, {
        filePath: "/workspace/doc.md",
        startOffset: 0,
        endOffset: 4,
        lineNumber: 2,
        matchedText: "beta",
        requestId: 2
      })
    ).toEqual({ kind: "line", from: 8, to: 8 });
  });
});
