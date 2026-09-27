import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  FileTree,
  PendingReviewStrip,
  fileTreeNodeShowsPendingIndicator,
  shouldShowPendingReviewStrip
} from "../../src/components/FileTree";
import { appStrings } from "../../src/i18n/strings";
import type { FileTreeDisplayNode, PendingFileTreeChange } from "../../src/review/pendingFileTree";
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
      renamingPath={null}
      onOpenNode={() => undefined}
      onOpenPendingChange={() => undefined}
      onCreateFile={() => undefined}
      onCreateFolder={() => undefined}
      onOpenFolder={() => undefined}
      onOpenRecent={() => undefined}
      onRevealWorkspace={() => undefined}
      onSelectNode={() => undefined}
      onSelectWorkspaceRoot={() => undefined}
      onAcceptPendingChanges={() => undefined}
      onRejectPendingChanges={() => undefined}
      onMoveNode={async () => null}
      onShowContextMenu={() => undefined}
      onCancelRename={() => undefined}
      onCommitRename={() => undefined}
      {...overrides}
    />
  );
}

describe("FileTree pending review strip", () => {
  it("shows the all-documents row only when documents other than the open one are pending", () => {
    expect(shouldShowPendingReviewStrip(0, false)).toBe(false);
    expect(shouldShowPendingReviewStrip(1, true)).toBe(false);
    expect(shouldShowPendingReviewStrip(1, false)).toBe(true);
    expect(shouldShowPendingReviewStrip(2, true)).toBe(true);
    expect(shouldShowPendingReviewStrip(3, false)).toBe(true);
  });

  it("renders one light review row under the header when review items exist", () => {
    const html = renderFileTree();

    expect(html).toContain("has-pending-review");
    expect(html).toContain('class="file-tree-pending-review"');
    expect(html).toContain(">2 changed<");
    expect(html).toContain(">Keep all<");
    expect(html).toContain(">Restore all<");
    expect(html).toContain("new");
    expect(html.indexOf("file-tree-pending-review")).toBeGreaterThan(html.indexOf("sidebar-header"));
    expect(html.indexOf("file-tree-pending-review")).toBeLessThan(html.indexOf("tree-scroll"));
  });

  it("hides the row and reserves no grid row when there are no pending review items", () => {
    const html = renderFileTree({ pendingReviewCount: 0, pendingChanges: [] });

    expect(html).not.toContain("file-tree-pending-review");
    expect(html).not.toContain("has-pending-review");
    expect(html).not.toContain(" changed<");
  });

  it("hides the row and its grid row when the only pending item is the open document", () => {
    const html = renderFileTree({ pendingReviewCount: 1, pendingReviewActive: true });

    expect(html).not.toContain("file-tree-pending-review");
    expect(html).not.toContain("has-pending-review");
    expect(html).not.toContain(">Keep all<");
    expect(html).not.toContain(">Restore all<");
  });

  it("shows the row for a single pending item that is not the open document", () => {
    const html = renderFileTree({ pendingReviewCount: 1, pendingReviewActive: false });

    expect(html).toContain("has-pending-review");
    expect(html).toContain(">1 changed<");
    expect(html).toContain(">Keep all<");
  });

  it("keeps the row for multiple pending items even when one item is open", () => {
    const html = renderFileTree({ pendingReviewCount: 2, pendingReviewActive: true });

    expect(html).toContain(">2 changed<");
    expect(html).toContain(">Keep all<");
    expect(html).toContain(">Restore all<");
  });

  it("uses Spanish copy", () => {
    const html = renderFileTree({ labels: appStrings.es.sidebar });

    expect(html).toContain(">2 con cambios<");
    expect(html).toContain(">Conservar todo<");
    expect(html).toContain(">Restaurar todo<");
    expect(html).toContain(">Ajustes<");
  });

  it("disables both row actions while a pending review action is busy", () => {
    const html = renderFileTree({ pendingReviewBusy: true });

    expect(html).toContain(">2 changed<");
    expect(html.match(/disabled=\"\"/g)).toHaveLength(2);
  });

  it("calls the reject handler from the row without requiring a real file node", () => {
    const onReject = vi.fn();
    const element = PendingReviewStrip({
      count: 2,
      labels: appStrings.en.sidebar,
      onAccept: () => undefined,
      onReject
    }) as ReactElement;
    const [, actions] = element.props.children as ReactElement[];
    const [, rejectButton] = actions.props.children as ReactElement[];

    rejectButton.props.onClick();

    expect(onReject).toHaveBeenCalledTimes(1);
  });
});

describe("FileTree sidebar chrome", () => {
  const folderNodes: FileTreeNode[] = [
    {
      name: "drafts",
      path: "/workspace/drafts",
      relativePath: "drafts",
      kind: "directory",
      children: [{ name: "inner.md", path: "/workspace/drafts/inner.md", relativePath: "drafts/inner.md", kind: "markdown" }]
    },
    ...nodes,
    { name: "photo.png", path: "/workspace/photo.png", relativePath: "photo.png", kind: "external" }
  ];

  it("has only search and new document in the header; new folder lives in the menus", () => {
    const html = renderFileTree({ pendingChanges: [], pendingReviewCount: 0 });
    const header = html.slice(html.indexOf("sidebar-header"), html.indexOf("tree-scroll"));

    expect(header.match(/class="icon-button"/g)).toHaveLength(2);
    expect(header).toContain('aria-label="Find in file tree"');
    expect(header).toContain("lucide-square-pen");
    expect(header).not.toContain("New folder");
  });

  it("draws folders with a chevron and aria-expanded, files without icons", () => {
    const html = renderFileTree({ nodes: folderNodes, pendingChanges: [], pendingReviewCount: 0 });

    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("lucide-chevron-right");
    expect(html).not.toContain("lucide-folder");
    expect(html).not.toContain("lucide-file");
    expect(html.match(/<span class="tree-icon"><\/span>/g)).toHaveLength(2);
  });

  it("marks pending creates through the dot, not an icon", () => {
    const html = renderFileTree();

    expect(html).toContain("tree-pending-dot is-create");
    expect(html).not.toContain("lucide-file-plus");
  });

  it("renders the Settings footer row with its selected state and the footer accessory (no amber dot)", () => {
    const plain = renderFileTree({ pendingChanges: [], pendingReviewCount: 0 });

    expect(plain).toContain('class="sidebar-footer"');
    expect(plain).toContain(">Settings<");
    expect(plain).toContain("lucide-settings");
    expect(plain).not.toContain("sidebar-settings-dot");
    expect(plain.indexOf("sidebar-footer")).toBeGreaterThan(plain.indexOf("tree-scroll"));

    const open = renderFileTree({
      pendingChanges: [],
      pendingReviewCount: 0,
      settingsOpen: true,
      onOpenSettings: () => undefined,
      footerAccessory: <span className="footer-accessory-probe" />
    });

    expect(open).toContain("sidebar-settings-row is-open");
    expect(open).toContain('aria-expanded="true"');
    expect(open).not.toContain("sidebar-settings-dot");
    expect(open).toMatch(/sidebar-settings-row[\s\S]*footer-accessory-probe/);
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
