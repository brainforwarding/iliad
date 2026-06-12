import { describe, expect, it } from "vitest";
import {
  buildFileTreeDisplayNodes,
  buildPendingFileTreeChanges,
  pendingFileTreePath,
  sameRelativePath,
  type FileTreeDisplayNode
} from "../../src/assistant/pendingFileTree";
import type { AgentChangeProposal, AgentProposalFileChange, FileTreeNode } from "../../src/types/iliad";

function proposal(overrides: Partial<AgentChangeProposal>): AgentChangeProposal {
  return {
    id: "proposal-test",
    runId: "run-test",
    workspaceRoot: "/workspace",
    title: "Test proposal",
    summary: "Test",
    createdAt: "2026-05-25T00:00:00.000Z",
    updatedAt: "2026-05-25T00:00:00.000Z",
    model: "test",
    source: { kind: "legacy_marker_adapter" },
    status: "pending",
    files: [],
    ...overrides
  };
}

function editFile(overrides: Partial<Extract<AgentProposalFileChange, { kind: "edit_file" }>>) {
  return {
    id: "edit-file",
    kind: "edit_file" as const,
    status: "pending" as const,
    relativePath: "doc.md",
    baseHash: "hash",
    baseContent: "old\n",
    replacement: "new\n",
    unifiedDiff: "",
    hunks: [
      {
        id: "hunk-1",
        status: "pending" as const,
        anchorLine: 1,
        oldStartLine: 1,
        oldLines: ["old"],
        newLines: ["new"]
      }
    ],
    ...overrides
  };
}

function createFile(overrides: Partial<Extract<AgentProposalFileChange, { kind: "create_file" }>>) {
  return {
    id: "create-file",
    kind: "create_file" as const,
    status: "pending" as const,
    relativePath: "new.md",
    content: "new\n",
    unifiedDiff: "",
    ...overrides
  };
}

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

function findDisplayNode(nodes: FileTreeDisplayNode[], relativePath: string): FileTreeDisplayNode | null {
  for (const node of nodes) {
    const nodeRelativePath = node.source === "real" ? node.node.relativePath : node.relativePath;

    if (nodeRelativePath === relativePath) {
      return node;
    }

    const children = node.source === "pending-create" ? undefined : node.children;
    const childMatch = children ? findDisplayNode(children, relativePath) : null;

    if (childMatch) {
      return childMatch;
    }
  }

  return null;
}

describe("pending file tree changes", () => {
  it("derives mutable pending files, normalizes paths, filters terminal files, and keeps the newest duplicate", () => {
    const changes = buildPendingFileTreeChanges([
      proposal({
        id: "older",
        updatedAt: "2026-05-25T00:00:00.000Z",
        files: [editFile({ id: "older-file", relativePath: "notes\\s2.md" })]
      }),
      proposal({
        id: "newer",
        updatedAt: "2026-05-25T01:00:00.000Z",
        files: [
          editFile({ id: "newer-file", relativePath: "notes//s2.md" }),
          createFile({ id: "applied-create", relativePath: "done.md", status: "applied" }),
          createFile({ id: "pending-create", relativePath: "session-4/rubrica.md" })
        ]
      })
    ]);

    expect(changes).toHaveLength(2);
    expect(changes).toContainEqual(
      expect.objectContaining({
        proposalId: "newer",
        fileId: "newer-file",
        kind: "edit_file",
        normalizedRelativePath: "notes/s2.md"
      })
    );
    expect(changes).toContainEqual(
      expect.objectContaining({
        proposalId: "newer",
        fileId: "pending-create",
        kind: "create_file",
        normalizedRelativePath: "session-4/rubrica.md"
      })
    );
  });

  it("does not derive tree changes for unsafe relative paths", () => {
    const changes = buildPendingFileTreeChanges([
      proposal({
        files: [
          createFile({ id: "parent-create", relativePath: "../outside.md" }),
          createFile({ id: "nested-parent-create", relativePath: "notes/../outside.md" }),
          createFile({ id: "absolute-create", relativePath: "/outside.md" }),
          createFile({ id: "drive-create", relativePath: "C:\\outside.md" })
        ]
      })
    ]);

    expect(changes).toHaveLength(0);
  });

  it("does not consider invalid relative paths equivalent", () => {
    expect(sameRelativePath("notes\\s2.md", "notes//s2.md")).toBe(true);
    expect(sameRelativePath("", "../outside.md")).toBe(false);
    expect(sameRelativePath("../outside.md", "/outside.md")).toBe(false);
  });
});

describe("pending file tree display nodes", () => {
  it("decorates existing edit files and their parent folders", () => {
    const tree = [fileNode("notes", "directory", [fileNode("notes/s2.md")])];
    const changes = buildPendingFileTreeChanges([
      proposal({ id: "proposal-edit", files: [editFile({ id: "edit-s2", relativePath: "notes/s2.md" })] })
    ]);

    const displayTree = buildFileTreeDisplayNodes(tree, changes);
    const folder = findDisplayNode(displayTree, "notes");
    const file = findDisplayNode(displayTree, "notes/s2.md");

    expect(folder?.source).toBe("real");
    expect(folder?.source === "real" ? folder.hasPendingDescendant : false).toBe(true);
    expect(file?.source).toBe("real");
    expect(file?.source === "real" ? file.pendingTarget?.fileId : null).toBe("edit-s2");
  });

  it("inserts a virtual create file under an existing folder", () => {
    const tree = [fileNode("session-4", "directory", [])];
    const changes = buildPendingFileTreeChanges([
      proposal({ id: "proposal-create", files: [createFile({ id: "create-rubric", relativePath: "session-4/rubrica.md" })] })
    ]);

    const displayTree = buildFileTreeDisplayNodes(tree, changes);
    const folder = findDisplayNode(displayTree, "session-4");
    const file = findDisplayNode(displayTree, "session-4/rubrica.md");

    expect(folder?.source).toBe("real");
    expect(folder?.source === "real" ? folder.hasPendingDescendant : false).toBe(true);
    expect(file).toMatchObject({
      source: "pending-create",
      name: "rubrica.md",
      path: pendingFileTreePath("session-4/rubrica.md")
    });
  });

  it("inserts missing virtual parent folders for nested proposed files", () => {
    const changes = buildPendingFileTreeChanges([
      proposal({ id: "proposal-create", files: [createFile({ id: "create-annex", relativePath: "annexes/new-annex.md" })] })
    ]);

    const displayTree = buildFileTreeDisplayNodes([], changes);
    const folder = findDisplayNode(displayTree, "annexes");
    const file = findDisplayNode(displayTree, "annexes/new-annex.md");

    expect(folder).toMatchObject({ source: "pending-dir", name: "annexes" });
    expect(file).toMatchObject({ source: "pending-create", name: "new-annex.md" });
  });

  it("does not insert a virtual create file when the real path already exists", () => {
    const tree = [fileNode("new.md")];
    const changes = buildPendingFileTreeChanges([
      proposal({ id: "proposal-collision", files: [createFile({ id: "create-existing", relativePath: "new.md" })] })
    ]);

    const displayTree = buildFileTreeDisplayNodes(tree, changes);
    const newFileRows = displayTree.filter((node) => {
      const relativePath = node.source === "real" ? node.node.relativePath : node.relativePath;
      return relativePath === "new.md";
    });

    expect(newFileRows).toHaveLength(1);
    expect(newFileRows[0]?.source).toBe("real");
  });
});
