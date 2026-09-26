import { describe, expect, it } from "vitest";
import * as mainHelpers from "../../electron/fs/companionFiles";
import {
  companionKindOf,
  companionNameMessage,
  companionPathsFor,
  documentNamesForCompanion,
  documentStemOf,
  isCompanionPath
} from "../../src/files/companionFiles";

describe("companion file naming", () => {
  it("recognises companions by name shape only", () => {
    expect(isCompanionPath("dir/chapter.comments.md")).toBe(true);
    expect(isCompanionPath("/abs/dir/Chapter.COMMENTS.MD")).toBe(true);
    expect(companionKindOf("a/b.comments.md")).toBe("comments");
    expect(isCompanionPath("chapter.md")).toBe(false);
    expect(isCompanionPath("comments.md")).toBe(false);
    expect(isCompanionPath(".comments.md")).toBe(false);
    expect(isCompanionPath("chapter.comments.markdown")).toBe(false);
    expect(isCompanionPath("dir.comments.md/chapter.md")).toBe(false);
  });

  it("treats name.notes.md as an ordinary document since notes were removed (2026-09-25)", () => {
    expect(isCompanionPath("chapter.notes.md")).toBe(false);
    expect(companionKindOf("a/b.notes.md")).toBeNull();
    expect(documentStemOf("a/chapter.notes.md")).toBe("chapter.notes");
    expect(companionPathsFor("a/chapter.notes.md")).toEqual({ comments: "a/chapter.notes.comments.md" });
    expect(documentNamesForCompanion("chapter.notes.md")).toEqual([]);
    expect(companionNameMessage).not.toContain(".notes.md");
    expect(companionNameMessage).toContain(".comments.md");
  });

  it("derives companion paths from any Markdown extension", () => {
    expect(companionPathsFor("dir/chapter.md")).toEqual({
      comments: "dir/chapter.comments.md"
    });
    expect(companionPathsFor("/abs/Book.markdown")).toEqual({
      comments: "/abs/Book.comments.md"
    });
    expect(companionPathsFor("draft.v2.mkd")?.comments).toBe("draft.v2.comments.md");
  });

  it("has no companions of companions or of non-Markdown files", () => {
    expect(companionPathsFor("chapter.comments.md")).toBeNull();
    expect(companionPathsFor("image.png")).toBeNull();
  });

  it("lists the documents a companion can belong to", () => {
    expect(documentNamesForCompanion("chapter.comments.md")).toEqual([
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
