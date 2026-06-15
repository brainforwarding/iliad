import { describe, expect, it } from "vitest";
import {
  createFileTreeMoveDragPayload,
  readFileTreeMoveDragPayload,
  resolveCreationDirectoryPath,
  resolveFileTreeDropTarget
} from "../../src/files/fileTreeMove";
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

const tree: FileTreeNode[] = [
  fileNode("drafts", "directory", [
    fileNode("drafts/chapter.md"),
    fileNode("drafts/notes", "directory", [fileNode("drafts/notes/source.md")])
  ]),
  fileNode("archive", "directory", [fileNode("archive/old.md")]),
  fileNode("root.md"),
  fileNode("chapter.md")
];

describe("resolveCreationDirectoryPath", () => {
  it("uses an explicit workspace root selection before active document fallback", () => {
    expect(
      resolveCreationDirectoryPath({
        workspacePath: "/workspace",
        selectedTreePath: "/workspace",
        selectedTreeNode: null,
        activeFile: fileNode("drafts/chapter.md")
      })
    ).toBe("/workspace");
  });

  it("uses selected directories, selected file parents, active file parents, then root", () => {
    expect(
      resolveCreationDirectoryPath({
        workspacePath: "/workspace",
        selectedTreePath: "/workspace/drafts",
        selectedTreeNode: tree[0]!,
        activeFile: null
      })
    ).toBe("/workspace/drafts");

    expect(
      resolveCreationDirectoryPath({
        workspacePath: "/workspace",
        selectedTreePath: "/workspace/drafts/chapter.md",
        selectedTreeNode: tree[0]!.children![0]!,
        activeFile: null
      })
    ).toBe("/workspace/drafts");

    expect(
      resolveCreationDirectoryPath({
        workspacePath: "/workspace",
        selectedTreePath: null,
        selectedTreeNode: null,
        activeFile: fileNode("archive/old.md")
      })
    ).toBe("/workspace/archive");

    expect(
      resolveCreationDirectoryPath({
        workspacePath: "/workspace",
        selectedTreePath: null,
        selectedTreeNode: null,
        activeFile: null
      })
    ).toBe("/workspace");
  });
});

describe("file tree move drag payloads", () => {
  it("round-trips visible relative paths for the current workspace", () => {
    const payload = createFileTreeMoveDragPayload("workspace-session", "drafts\\chapter.md");

    expect(payload.relativePath).toBe("drafts/chapter.md");
    expect(readFileTreeMoveDragPayload(JSON.stringify(payload), "workspace-session")).toEqual(payload);
  });

  it("rejects malformed, wrong-workspace, absolute, hidden, and parent traversal payloads", () => {
    expect(readFileTreeMoveDragPayload("{", "workspace-session")).toBeNull();
    expect(
      readFileTreeMoveDragPayload(
        JSON.stringify(createFileTreeMoveDragPayload("workspace-session", "drafts/chapter.md")),
        "other-session"
      )
    ).toBeNull();
    expect(
      readFileTreeMoveDragPayload(
        JSON.stringify({ type: "iliad/file-tree-move", workspaceSessionId: "workspace-session", relativePath: "/tmp/x.md" }),
        "workspace-session"
      )
    ).toBeNull();
    expect(
      readFileTreeMoveDragPayload(
        JSON.stringify({ type: "iliad/file-tree-move", workspaceSessionId: "workspace-session", relativePath: ".hidden/x.md" }),
        "workspace-session"
      )
    ).toBeNull();
    expect(
      readFileTreeMoveDragPayload(
        JSON.stringify({ type: "iliad/file-tree-move", workspaceSessionId: "workspace-session", relativePath: "../x.md" }),
        "workspace-session"
      )
    ).toBeNull();
  });
});

describe("resolveFileTreeDropTarget", () => {
  it("allows moving files and folders to valid folders and root", () => {
    expect(
      resolveFileTreeDropTarget({
        nodes: tree,
        sourceRelativePath: "drafts/chapter.md",
        target: { kind: "folder", relativePath: "archive" }
      })
    ).toMatchObject({
      valid: true,
      targetDirectoryRelativePath: "archive",
      destinationRelativePath: "archive/chapter.md"
    });

    expect(
      resolveFileTreeDropTarget({
        nodes: tree,
        sourceRelativePath: "drafts/notes",
        target: { kind: "root" }
      })
    ).toMatchObject({
      valid: true,
      targetDirectoryRelativePath: "",
      destinationRelativePath: "notes"
    });
  });

  it("rejects missing sources, file targets, no-op moves, self/descendant targets, blocked rows, and collisions", () => {
    expect(
      resolveFileTreeDropTarget({ nodes: tree, sourceRelativePath: "missing.md", target: { kind: "root" } })
    ).toMatchObject({ valid: false, reason: "missing-source" });
    expect(
      resolveFileTreeDropTarget({
        nodes: tree,
        sourceRelativePath: "drafts/chapter.md",
        target: { kind: "folder", relativePath: "root.md" }
      })
    ).toMatchObject({ valid: false, reason: "invalid-target" });
    expect(
      resolveFileTreeDropTarget({
        nodes: tree,
        sourceRelativePath: "drafts/chapter.md",
        target: { kind: "folder", relativePath: "drafts" }
      })
    ).toMatchObject({ valid: false, reason: "same-parent" });
    expect(
      resolveFileTreeDropTarget({
        nodes: tree,
        sourceRelativePath: "drafts",
        target: { kind: "folder", relativePath: "drafts/notes" }
      })
    ).toMatchObject({ valid: false, reason: "target-inside-source" });
    expect(
      resolveFileTreeDropTarget({
        nodes: tree,
        sourceRelativePath: "drafts",
        target: { kind: "root" },
        blockedRelativePaths: ["drafts"]
      })
    ).toMatchObject({ valid: false, reason: "blocked-source" });
    expect(
      resolveFileTreeDropTarget({
        nodes: tree,
        sourceRelativePath: "drafts/chapter.md",
        target: { kind: "folder", relativePath: "archive" },
        pendingCreateRelativePaths: ["archive/chapter.md"]
      })
    ).toMatchObject({ valid: false, reason: "pending-create-collision" });
    expect(
      resolveFileTreeDropTarget({
        nodes: tree,
        sourceRelativePath: "drafts/chapter.md",
        target: { kind: "root" }
      })
    ).toMatchObject({ valid: false, reason: "destination-exists" });
  });
});
