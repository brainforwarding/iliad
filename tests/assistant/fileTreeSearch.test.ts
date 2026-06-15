import { describe, expect, it } from "vitest";
import {
  buildFileTreeDisplayNodes,
  displayNodeId,
  displayNodePath,
  displayTreeName,
  pendingFileTreeDirectoryPath,
  pendingFileTreePath,
  type PendingFileTreeChange
} from "../../src/assistant/pendingFileTree";
import {
  clampFileTreeSearchActiveIndex,
  filterFileTreeDisplayNodesForSearch,
  matchFileTreeSearchRanges,
  moveFileTreeSearchActiveIndex,
  normalizeFileTreeSearchQuery,
  searchFileTreeDisplayNodes
} from "../../src/assistant/fileTreeSearch";
import type { FileTreeNode } from "../../src/types/iliad";

function fileNode(relativePath: string, kind: FileTreeNode["kind"] = "markdown", children?: FileTreeNode[]): FileTreeNode {
  const name = relativePath.split(/[\\/]/).filter(Boolean).pop() ?? relativePath;

  return {
    name,
    path: `/workspace/${relativePath}`,
    relativePath,
    kind,
    children
  };
}

function pendingCreate(relativePath: string): PendingFileTreeChange {
  return {
    proposalId: `proposal-${relativePath}`,
    fileId: `file-${relativePath}`,
    kind: "create_file",
    relativePath,
    normalizedRelativePath: relativePath,
    status: "pending"
  };
}

describe("file tree search matching", () => {
  it("normalizes query whitespace", () => {
    expect(normalizeFileTreeSearchQuery("  chapter   one  ")).toBe("chapter one");
  });

  it("returns continuous match ranges", () => {
    expect(matchFileTreeSearchRanges("Chapter 1", "apt", "continuous")).toEqual([{ start: 2, end: 5 }]);
    expect(matchFileTreeSearchRanges("Chapter 1", "ct1", "continuous")).toEqual([]);
  });

  it("returns fuzzy match ranges without reordering tree results", () => {
    expect(matchFileTreeSearchRanges("Chapter 1", "ct1", "fuzzy")).toEqual([
      { start: 0, end: 1 },
      { start: 4, end: 5 },
      { start: 8, end: 9 }
    ]);

    const tree = buildFileTreeDisplayNodes(
      [
        fileNode("drafts", "directory", [
          fileNode("drafts/chapter-2.md"),
          fileNode("drafts/chapter-10.md")
        ]),
        fileNode("chapter-1.md")
      ],
      []
    );
    const result = searchFileTreeDisplayNodes(tree, "chapter", "fuzzy");

    expect(result.matches.map((match) => match.relativePath)).toEqual([
      "drafts/chapter-10.md",
      "drafts/chapter-2.md",
      "chapter-1.md"
    ]);
  });

  it("matches Markdown display stems and canonical display-node identity", () => {
    const [node] = buildFileTreeDisplayNodes([fileNode("notes/chapter-one.markdown")], []);

    expect(node).toBeDefined();
    expect(displayNodeId(node!)).toBe("/workspace/notes/chapter-one.markdown");
    expect(displayNodePath(node!)).toBe("/workspace/notes/chapter-one.markdown");
    expect(displayTreeName(node!)).toBe("chapter-one");

    const result = searchFileTreeDisplayNodes([node!], "chapter-one", "continuous");

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({
      id: "/workspace/notes/chapter-one.markdown",
      displayName: "chapter-one"
    });
  });

  it("includes pending create files and virtual directories", () => {
    const tree = buildFileTreeDisplayNodes([], [pendingCreate("drafts/new-scene.md")]);
    const pendingDirResult = searchFileTreeDisplayNodes(tree, "drafts", "continuous");
    const pendingFileResult = searchFileTreeDisplayNodes(tree, "new-scene", "continuous");

    expect(pendingDirResult.matches[0]).toMatchObject({
      id: pendingFileTreeDirectoryPath("drafts"),
      relativePath: "drafts"
    });
    expect(pendingFileResult.matches[0]).toMatchObject({
      id: pendingFileTreePath("drafts/new-scene.md"),
      displayName: "new-scene"
    });
  });

  it("computes descendant counts and filter ancestors", () => {
    const tree = buildFileTreeDisplayNodes(
      [
        fileNode("drafts", "directory", [
          fileNode("drafts/act-one", "directory", [fileNode("drafts/act-one/scene.md")])
        ])
      ],
      []
    );
    const result = searchFileTreeDisplayNodes(tree, "scene", "continuous");

    expect(result.metaById.get("/workspace/drafts")?.descendantMatchCount).toBe(1);
    expect(result.metaById.get("/workspace/drafts/act-one")?.descendantMatchCount).toBe(1);
    expect(result.filterAncestorPaths).toEqual(new Set(["/workspace/drafts", "/workspace/drafts/act-one"]));
  });

  it("filters recursively while preserving ancestors and matching directory descendants", () => {
    const tree = buildFileTreeDisplayNodes(
      [
        fileNode("drafts", "directory", [
          fileNode("drafts/outline.md"),
          fileNode("drafts/research.txt", "external")
        ]),
        fileNode("archive", "directory", [fileNode("archive/outline.md")])
      ],
      []
    );

    const leafResult = searchFileTreeDisplayNodes(tree, "outline", "continuous");
    const leafFiltered = filterFileTreeDisplayNodesForSearch(tree, leafResult);

    expect(leafFiltered.map((node) => node.source === "real" ? node.node.relativePath : node.relativePath)).toEqual([
      "archive",
      "drafts"
    ]);
    expect(leafFiltered[0]?.source === "real" ? leafFiltered[0].children?.map((node) => displayTreeName(node)) : []).toEqual([
      "outline"
    ]);

    const directoryResult = searchFileTreeDisplayNodes(tree, "drafts", "continuous");
    const directoryFiltered = filterFileTreeDisplayNodesForSearch(tree, directoryResult);

    expect(directoryFiltered.map((node) => displayTreeName(node))).toEqual(["drafts"]);
    expect(directoryFiltered[0]?.source === "real" ? directoryFiltered[0].children?.map((node) => displayTreeName(node)) : []).toEqual([
      "outline",
      "research.txt"
    ]);
  });

  it("treats slash queries as ordinary display-name characters", () => {
    const tree = buildFileTreeDisplayNodes([fileNode("notes", "directory", [fileNode("notes/plan.md")])], []);
    const result = searchFileTreeDisplayNodes(tree, "notes/plan", "continuous");

    expect(result.matches).toHaveLength(0);
  });

  it("handles empty and no-match results", () => {
    const tree = buildFileTreeDisplayNodes([fileNode("notes.md")], []);
    const emptyResult = searchFileTreeDisplayNodes(tree, "", "fuzzy");
    const noMatchResult = searchFileTreeDisplayNodes(tree, "missing", "fuzzy");

    expect(emptyResult.matches).toHaveLength(0);
    expect(emptyResult.metaById.get("/workspace/notes.md")?.visibleInFilter).toBe(true);
    expect(noMatchResult.matches).toHaveLength(0);
    expect(noMatchResult.metaById.get("/workspace/notes.md")?.visibleInFilter).toBe(false);
  });

  it("clamps and wraps active match indexes", () => {
    expect(clampFileTreeSearchActiveIndex(4, 2)).toBe(1);
    expect(clampFileTreeSearchActiveIndex(-1, 2)).toBe(0);
    expect(clampFileTreeSearchActiveIndex(0, 0)).toBe(-1);
    expect(moveFileTreeSearchActiveIndex(-1, 3, 1)).toBe(0);
    expect(moveFileTreeSearchActiveIndex(-1, 3, -1)).toBe(2);
    expect(moveFileTreeSearchActiveIndex(2, 3, 1)).toBe(0);
  });
});
