import { describe, expect, it } from "vitest";
import { relocateHistoryStackPaths } from "../../src/app/useDocumentHistory";

describe("relocateHistoryStackPaths", () => {
  it("relocates only entries inside the moved path", () => {
    expect(
      relocateHistoryStackPaths(
        [
          "/workspace/drafts/one.md",
          "/workspace/drafts/section/two.md",
          "/workspace/drafts-old/three.md",
          "/workspace/root.md"
        ],
        "/workspace/drafts",
        "/workspace/archive/drafts"
      )
    ).toEqual([
      "/workspace/archive/drafts/one.md",
      "/workspace/archive/drafts/section/two.md",
      "/workspace/drafts-old/three.md",
      "/workspace/root.md"
    ]);
  });
});
