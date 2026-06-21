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

function deleteFile(overrides: Partial<Extract<AgentProposalFileChange, { kind: "delete_file" }>>) {
  return {
    id: "delete-file",
    kind: "delete_file" as const,
    status: "pending" as const,
    relativePath: "old.md",
    baseHash: "hash",
    baseContent: "old\n",
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

    const children = node.source === "pending-create" || node.source === "pending-delete" ? undefined : node.children;
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
          createFile({ id: "pending-create", relativePath: "session-4/rubrica.md" }),
          deleteFile({ id: "pending-delete", relativePath: "old.md" })
        ]
      })
    ]);

    expect(changes).toHaveLength(3);
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
    expect(changes).toContainEqual(
      expect.objectContaining({
        proposalId: "newer",
        fileId: "pending-delete",
        kind: "delete_file",
        normalizedRelativePath: "old.md"
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

  it("decorates a real create file when the created path exists on disk", () => {
    const tree = [fileNode("session-4", "directory", [fileNode("session-4/rubrica.md")])];
    const changes = buildPendingFileTreeChanges([
      proposal({ id: "proposal-create", files: [createFile({ id: "create-existing", relativePath: "session-4/rubrica.md" })] })
    ]);

    const displayTree = buildFileTreeDisplayNodes(tree, changes);
    const folder = findDisplayNode(displayTree, "session-4");
    const file = findDisplayNode(displayTree, "session-4/rubrica.md");

    expect(folder?.source).toBe("real");
    expect(folder?.source === "real" ? folder.hasPendingDescendant : false).toBe(true);
    expect(file?.source).toBe("real");
    expect(file?.source === "real" ? file.pendingTarget?.kind : null).toBe("create_file");
  });

  it("decorates existing files with pending deletes", () => {
    const tree = [fileNode("old.md")];
    const changes = buildPendingFileTreeChanges([
      proposal({ id: "proposal-delete", files: [deleteFile({ id: "delete-old", relativePath: "old.md" })] })
    ]);

    const displayTree = buildFileTreeDisplayNodes(tree, changes);
    const file = findDisplayNode(displayTree, "old.md");

    expect(file?.source).toBe("real");
    expect(file?.source === "real" ? file.pendingTarget?.kind : null).toBe("delete_file");
  });

  it("inserts a virtual delete row when the target file is missing", () => {
    const changes = buildPendingFileTreeChanges([
      proposal({ id: "proposal-delete", files: [deleteFile({ id: "delete-missing", relativePath: "missing.md" })] })
    ]);

    const displayTree = buildFileTreeDisplayNodes([], changes);
    const file = findDisplayNode(displayTree, "missing.md");

    expect(file).toMatchObject({
      source: "pending-delete",
      name: "missing.md",
      path: pendingFileTreePath("missing.md")
    });
  });

  it("inserts a virtual delete row under an existing folder when the deleted file is missing", () => {
    const tree = [
      fileNode("workspace", "directory", [
        fileNode("workspace/drafts", "directory", [fileNode("workspace/drafts/empty-draft.md")]),
        fileNode("workspace/inbox", "directory", [])
      ])
    ];
    const changes = buildPendingFileTreeChanges([
      proposal({
        id: "proposal-delete",
        files: [deleteFile({ id: "delete-move-me", relativePath: "workspace/inbox/move-me-to-drafts.md" })]
      })
    ]);

    const displayTree = buildFileTreeDisplayNodes(tree, changes);
    const workspace = findDisplayNode(displayTree, "workspace");
    const inbox = findDisplayNode(displayTree, "workspace/inbox");
    const deletedFile = findDisplayNode(displayTree, "workspace/inbox/move-me-to-drafts.md");

    expect(workspace?.source).toBe("real");
    expect(workspace?.source === "real" ? workspace.hasPendingDescendant : false).toBe(true);
    expect(inbox?.source).toBe("real");
    expect(inbox?.source === "real" ? inbox.hasPendingDescendant : false).toBe(true);
    expect(deletedFile).toMatchObject({
      source: "pending-delete",
      name: "move-me-to-drafts.md",
      path: pendingFileTreePath("workspace/inbox/move-me-to-drafts.md")
    });
  });

  it("annotates later pending siblings after an earlier pending child", () => {
    const tree = [
      fileNode("workspace", "directory", [
        fileNode("workspace/drafts", "directory", [fileNode("workspace/drafts/empty-draft.md")]),
        fileNode("workspace/inbox", "directory", []),
        fileNode("workspace/search-field-notes.md")
      ])
    ];
    const changes = buildPendingFileTreeChanges([
      proposal({
        id: "proposal-multiple",
        files: [
          editFile({ id: "edit-empty", relativePath: "workspace/drafts/empty-draft.md" }),
          deleteFile({ id: "delete-move-me", relativePath: "workspace/inbox/move-me-to-drafts.md" }),
          editFile({ id: "edit-search", relativePath: "workspace/search-field-notes.md" })
        ]
      })
    ]);

    const displayTree = buildFileTreeDisplayNodes(tree, changes);
    const drafts = findDisplayNode(displayTree, "workspace/drafts");
    const inbox = findDisplayNode(displayTree, "workspace/inbox");
    const deletedFile = findDisplayNode(displayTree, "workspace/inbox/move-me-to-drafts.md");
    const searchFile = findDisplayNode(displayTree, "workspace/search-field-notes.md");

    expect(drafts?.source === "real" ? drafts.hasPendingDescendant : false).toBe(true);
    expect(inbox?.source === "real" ? inbox.hasPendingDescendant : false).toBe(true);
    expect(deletedFile?.source).toBe("pending-delete");
    expect(searchFile?.source === "real" ? searchFile.pendingTarget?.fileId : null).toBe("edit-search");
  });
});
