import { describe, expect, it } from "vitest";
import { buildFileTreeDisplayNodes } from "../../src/assistant/pendingFileTree";
import { fileTreeRevealAncestorPaths } from "../../src/components/FileTree";
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

describe("fileTreeRevealAncestorPaths", () => {
  it("returns real ancestor row paths for a real file target", () => {
    const displayTree = buildFileTreeDisplayNodes(
      [
        fileNode("notes", "directory", [
          fileNode("notes/week-1", "directory", [fileNode("notes/week-1/plan.md")])
        ])
      ],
      []
    );

    expect(fileTreeRevealAncestorPaths(displayTree, "/workspace/notes/week-1/plan.md")).toEqual([
      "/workspace/notes",
      "/workspace/notes/week-1"
    ]);
  });

  it("returns virtual ancestor row paths for a pending create target", () => {
    const displayTree = buildFileTreeDisplayNodes([], [
      {
        proposalId: "proposal-1",
        fileId: "file-1",
        kind: "create_file",
        relativePath: "drafts/new-doc.md",
        normalizedRelativePath: "drafts/new-doc.md",
        status: "pending"
      }
    ]);

    expect(fileTreeRevealAncestorPaths(displayTree, "iliad-review://drafts/new-doc.md")).toEqual([
      "iliad-review-dir://drafts"
    ]);
  });

  it("does not consume reveal intent for missing rows", () => {
    const displayTree = buildFileTreeDisplayNodes([fileNode("notes.md")], []);

    expect(fileTreeRevealAncestorPaths(displayTree, "iliad-review://missing.md")).toBeNull();
  });
});
