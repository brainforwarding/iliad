import { describe, expect, it } from "vitest";
import {
  buildFileTreeContentResultTree,
  clampContentSearchActiveIndex,
  contentSearchPreviewSnippet,
  contentSearchFileRows,
  contentSearchRequestKey,
  contentSearchResponseMatchesCurrent,
  contentSearchSnippetParts,
  expandedContentSearchIds,
  flattenContentSearchPreviewRows,
  isLatestContentSearchRequest,
  markLatestContentSearchRequestId,
  moveContentSearchActiveIndex,
  validateContentSearchRegex
} from "../../src/assistant/fileTreeContentSearch";
import type { MarkdownContentSearchFileResult } from "../../src/types/iliad";

function file(relativePath: string, matches: Array<{ id: string; lineNumber: number; lineText: string; startColumn: number; endColumn: number }>): MarkdownContentSearchFileResult {
  return {
    filePath: `/workspace/${relativePath}`,
    relativePath,
    name: relativePath.split("/").pop() ?? relativePath,
    returnedMatchCount: matches.length,
    matches: matches.map((match, index) => ({
      id: match.id,
      lineNumber: match.lineNumber,
      lineText: match.lineText,
      matchedText: match.lineText.slice(match.startColumn, match.endColumn),
      startOffset: index * 10 + match.startColumn,
      endOffset: index * 10 + match.endColumn,
      startColumn: match.startColumn,
      endColumn: match.endColumn,
      ranges: [{ startColumn: match.startColumn, endColumn: match.endColumn }]
    }))
  };
}

describe("file tree content search helpers", () => {
  it("builds a folder/file result tree, hides empty ancestors, and computes descendant counts", () => {
    const tree = buildFileTreeContentResultTree([
      file("drafts/act-one/scene.md", [{ id: "m1", lineNumber: 2, lineText: "alpha beta", startColumn: 6, endColumn: 10 }]),
      file("drafts/notes.md", [
        { id: "m2", lineNumber: 1, lineText: "beta", startColumn: 0, endColumn: 4 },
        { id: "m3", lineNumber: 3, lineText: "more beta", startColumn: 5, endColumn: 9 }
      ]),
      file("empty/hidden.md", [])
    ]);

    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ kind: "folder", relativePath: "drafts", matchCount: 3 });
    expect(tree[0]?.kind === "folder" ? tree[0].children.map((child) => child.kind === "folder" ? child.relativePath : child.file.relativePath) : []).toEqual([
      "drafts/act-one",
      "drafts/notes.md"
    ]);
  });

  it("flattens navigable preview rows in stable order and respects expanded ids", () => {
    const tree = buildFileTreeContentResultTree([
      file("folder/b.md", [{ id: "b1", lineNumber: 1, lineText: "beta", startColumn: 0, endColumn: 4 }]),
      file("a.md", [{ id: "a1", lineNumber: 1, lineText: "alpha", startColumn: 0, endColumn: 5 }])
    ]);
    const expanded = expandedContentSearchIds(tree);
    const flattened = flattenContentSearchPreviewRows(tree, expanded);

    expect(flattened.map((row) => row.file.relativePath)).toEqual(["folder/b.md", "a.md"]);

    expanded.delete("content-folder:folder");
    expect(flattenContentSearchPreviewRows(tree, expanded).map((row) => row.file.relativePath)).toEqual(["a.md"]);
  });

  it("clamps and moves active preview indexes", () => {
    expect(clampContentSearchActiveIndex(4, 2)).toBe(1);
    expect(clampContentSearchActiveIndex(-1, 2)).toBe(0);
    expect(clampContentSearchActiveIndex(0, 0)).toBe(-1);
    expect(moveContentSearchActiveIndex(-1, 3, 1)).toBe(0);
    expect(moveContentSearchActiveIndex(-1, 3, -1)).toBe(2);
    expect(moveContentSearchActiveIndex(2, 3, 1)).toBe(0);
  });

  it("limits rendered previews per file and creates non-focusable more rows", () => {
    const result = file(
      "many.md",
      Array.from({ length: 10 }, (_, index) => ({
        id: `m${index}`,
        lineNumber: index + 1,
        lineText: `hit ${index}`,
        startColumn: 0,
        endColumn: 3
      }))
    );

    const rows = contentSearchFileRows(result, 3);

    expect(rows.filter((row) => row.kind === "match")).toHaveLength(3);
    expect(rows[3]).toEqual({ kind: "more", id: "many.md:more", count: 7 });
  });

  it("builds snippet highlight parts", () => {
    expect(
      contentSearchSnippetParts("alpha beta gamma", [
        { startColumn: 6, endColumn: 10 },
        { startColumn: 11, endColumn: 16 }
      ])
    ).toEqual([
      { text: "alpha ", highlighted: false },
      { text: "beta", highlighted: true },
      { text: " ", highlighted: false },
      { text: "gamma", highlighted: true }
    ]);
  });

  it("centers long-line previews near the first match so the highlight is visible", () => {
    const lineText = `${"prefix ".repeat(30)}NEEDLE${" suffix".repeat(30)}`;
    const startColumn = "prefix ".repeat(30).length;
    const snippet = contentSearchPreviewSnippet(lineText, [{ startColumn, endColumn: startColumn + 6 }]);
    const parts = contentSearchSnippetParts(snippet.lineText, snippet.ranges);

    expect(snippet.lineText.startsWith("...")).toBe(true);
    expect(snippet.lineText.length).toBeLessThan(lineText.length);
    expect(parts).toContainEqual({ text: "NEEDLE", highlighted: true });
    expect(snippet.ranges[0]?.startColumn).toBeLessThanOrEqual(15);
  });

  it("validates regex before IPC and exposes a stale request helper", () => {
    expect(validateContentSearchRegex("beta-\\d+", true, false).valid).toBe(true);
    expect(validateContentSearchRegex("(", true, false).valid).toBe(false);
    expect(validateContentSearchRegex("(", false, false).valid).toBe(true);
    expect(isLatestContentSearchRequest(2, 2)).toBe(true);
    expect(isLatestContentSearchRequest(1, 2)).toBe(false);
  });

  it("keys responses to the exact query/options and monotonically marks latest requests", () => {
    const firstKey = contentSearchRequestKey({
      query: "alpha",
      matchCase: false,
      wholeWord: false,
      regex: false
    });
    const nextKey = contentSearchRequestKey({
      query: "alpha",
      matchCase: true,
      wholeWord: false,
      regex: false
    });

    expect(contentSearchResponseMatchesCurrent(firstKey, firstKey)).toBe(true);
    expect(contentSearchResponseMatchesCurrent(firstKey, nextKey)).toBe(false);
    expect(contentSearchResponseMatchesCurrent(null, firstKey)).toBe(false);
    expect(markLatestContentSearchRequestId(4, 3)).toBe(4);
    expect(markLatestContentSearchRequestId(4, 5)).toBe(5);
  });
});
