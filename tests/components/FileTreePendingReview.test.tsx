import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { FileTree, PendingReviewStrip, fileTreeNodeShowsPendingIndicator } from "../../src/components/FileTree";
import { appStrings } from "../../src/i18n/strings";
import type { FileTreeDisplayNode, PendingFileTreeChange } from "../../src/assistant/pendingFileTree";
import type { FileTreeNode, WorkspaceInfo } from "../../src/types/iliad";

const workspace: WorkspaceInfo = {
  name: "workspace",
  path: "/workspace",
  sessionId: "workspace-session"
};

const nodes: FileTreeNode[] = [
  {
    name: "doc.md",
    path: "/workspace/doc.md",
    relativePath: "doc.md",
    kind: "markdown"
  }
];

const pendingChanges: PendingFileTreeChange[] = [
  {
    proposalId: "proposal-create",
    fileId: "file-create",
    kind: "create_file",
    relativePath: "new.md",
    normalizedRelativePath: "new.md",
    status: "pending"
  }
];

function renderFileTree(overrides: Partial<Parameters<typeof FileTree>[0]> = {}) {
  return renderToStaticMarkup(
    <FileTree
      workspace={workspace}
      recentWorkspaces={[]}
      nodes={nodes}
      activePath={undefined}
      selectedPath={null}
      pendingChanges={pendingChanges}
      pendingReviewCount={2}
      pendingReviewActive={false}
      pendingReviewBusy={false}
      creatingFile={false}
      creatingFolder={false}
      labels={appStrings.en.sidebar}
      updateLabels={appStrings.en.updates}
      updateStatus={null}
      updateChecking={false}
      renamingPath={null}
      onOpenNode={() => undefined}
      onOpenPendingChange={() => undefined}
      onCreateFile={() => undefined}
      onCreateFolder={() => undefined}
      onOpenFolder={() => undefined}
      onOpenRecent={() => undefined}
      onRevealWorkspace={() => undefined}
      onCheckForUpdates={() => undefined}
      onDownloadUpdate={() => undefined}
      onViewUpdateRelease={() => undefined}
      onSelectNode={() => undefined}
      onSelectWorkspaceRoot={() => undefined}
      onReviewPendingChanges={() => undefined}
      onDiscardPendingChanges={() => undefined}
      onMoveNode={async () => null}
      onShowContextMenu={() => undefined}
      onCancelRename={() => undefined}
      onCommitRename={() => undefined}
      {...overrides}
    />
  );
}

describe("FileTree pending review strip", () => {
  it("renders pending review actions above the tree when review items exist", () => {
    const html = renderFileTree();

    expect(html).toContain("file-tree-pending-review");
    expect(html).toContain("2 pending review items");
    expect(html).toContain(">Review<");
    expect(html).toContain(">Restore all...<");
    expect(html).toContain("new");
  });

  it("hides the strip when there are no pending review items", () => {
    const html = renderFileTree({ pendingReviewCount: 0, pendingChanges: [] });

    expect(html).not.toContain("file-tree-pending-review");
    expect(html).not.toContain("pending review items");
  });

  it("hides strip actions when the only pending review item is already visible", () => {
    const html = renderFileTree({ pendingReviewCount: 1, pendingReviewActive: true });

    expect(html).toContain("file-tree-pending-review is-current-review");
    expect(html).toContain("1 pending review item");
    expect(html).not.toContain(">Review<");
    expect(html).not.toContain(">Restore all...<");
  });

  it("keeps strip actions for multiple pending items even when one item is visible", () => {
    const html = renderFileTree({ pendingReviewCount: 2, pendingReviewActive: true });

    expect(html).toContain("2 pending review items");
    expect(html).toContain(">Review<");
    expect(html).toContain(">Restore all...<");
  });

  it("disables both strip actions while a pending review action is busy", () => {
    const html = renderFileTree({ pendingReviewBusy: true });

    expect(html).toContain("2 pending review items");
    expect(html.match(/disabled=\"\"/g)).toHaveLength(2);
  });

  it("calls the discard handler from the strip without requiring a real file node", () => {
    const onDiscard = vi.fn();
    const element = PendingReviewStrip({
      count: 2,
      labels: appStrings.en.sidebar,
      onReview: () => undefined,
      onDiscard
    }) as ReactElement;
    const [, actions] = element.props.children as ReactElement[];
    const [, discardButton] = actions.props.children as ReactElement[];

    discardButton.props.onClick();

    expect(onDiscard).toHaveBeenCalledTimes(1);
  });
});

describe("FileTree pending review indicators", () => {
  const changedFile: FileTreeDisplayNode = {
    source: "real",
    node: nodes[0]!,
    pendingTarget: pendingChanges[0]!
  };
  const visibleChangedFolder: FileTreeDisplayNode = {
    source: "real",
    node: {
      name: "workspace",
      path: "/workspace/workspace",
      relativePath: "workspace",
      kind: "directory",
      children: []
    },
    children: [changedFile],
    hasPendingDescendant: true
  };
  const virtualDeletedFile: FileTreeDisplayNode = {
    source: "pending-delete",
    pendingTarget: {
      proposalId: "proposal-delete",
      fileId: "file-delete",
      kind: "delete_file",
      relativePath: "workspace/inbox/move-me-to-drafts.md",
      normalizedRelativePath: "workspace/inbox/move-me-to-drafts.md",
      status: "pending"
    },
    name: "move-me-to-drafts.md",
    path: "iliad-review://workspace/inbox/move-me-to-drafts.md",
    relativePath: "workspace/inbox/move-me-to-drafts.md"
  };

  it("shows file review dots but hides expanded folder breadcrumb dots", () => {
    expect(fileTreeNodeShowsPendingIndicator(changedFile, false)).toBe(true);
    expect(fileTreeNodeShowsPendingIndicator(virtualDeletedFile, false)).toBe(true);
    expect(fileTreeNodeShowsPendingIndicator(visibleChangedFolder, true)).toBe(false);
    expect(fileTreeNodeShowsPendingIndicator(visibleChangedFolder, false)).toBe(true);
  });
});
