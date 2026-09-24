import { describe, expect, it } from "vitest";
import * as mainHelpers from "../../electron/fs/companionFiles";
import {
  companionKindOf,
  companionPathsFor,
  documentNamesForCompanion,
  isCompanionPath
} from "../../src/files/companionFiles";

describe("companion file naming", () => {
  it("recognises companions by name shape only", () => {
    expect(isCompanionPath("chapter.notes.md")).toBe(true);
    expect(isCompanionPath("dir/chapter.comments.md")).toBe(true);
    expect(isCompanionPath("/abs/dir/Chapter.NOTES.MD")).toBe(true);
    expect(companionKindOf("a/b.comments.md")).toBe("comments");
    expect(companionKindOf("a/b.notes.md")).toBe("notes");
    expect(isCompanionPath("chapter.md")).toBe(false);
    expect(isCompanionPath("notes.md")).toBe(false);
    expect(isCompanionPath("comments.md")).toBe(false);
    expect(isCompanionPath(".notes.md")).toBe(false);
    expect(isCompanionPath("chapter.notes.markdown")).toBe(false);
    expect(isCompanionPath("dir.notes.md/chapter.md")).toBe(false);
  });

  it("derives companion paths from any Markdown extension", () => {
    expect(companionPathsFor("dir/chapter.md")).toEqual({
      notes: "dir/chapter.notes.md",
      comments: "dir/chapter.comments.md"
    });
    expect(companionPathsFor("/abs/Book.markdown")).toEqual({
      notes: "/abs/Book.notes.md",
      comments: "/abs/Book.comments.md"
    });
    expect(companionPathsFor("draft.v2.mkd")?.notes).toBe("draft.v2.notes.md");
  });

  it("has no companions of companions or of non-Markdown files", () => {
    expect(companionPathsFor("chapter.notes.md")).toBeNull();
    expect(companionPathsFor("chapter.comments.md")).toBeNull();
    expect(companionPathsFor("image.png")).toBeNull();
  });

  it("lists the documents a companion can belong to", () => {
    expect(documentNamesForCompanion("chapter.notes.md")).toEqual([
      "chapter.md",
      "chapter.markdown",
      "chapter.mdown",
      "chapter.mkd"
    ]);
    expect(documentNamesForCompanion("chapter.md")).toEqual([]);
  });

  it("is the same module in main and the renderer", () => {
    expect(mainHelpers.isCompanionPath).toBe(isCompanionPath);
    expect(mainHelpers.companionPathsFor).toBe(companionPathsFor);
  });
});
