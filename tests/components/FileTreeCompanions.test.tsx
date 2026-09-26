import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FileTree } from "../../src/components/FileTree";
import { TreeContextMenu } from "../../src/components/TreeContextMenu";
import { appStrings } from "../../src/i18n/strings";
import { buildFileTreeDisplayNodes, displayNodeChildren, displayNodeCompanionKind, displayNodePath } from "../../src/review/pendingFileTree";
import type { FileTreeNode, WorkspaceInfo } from "../../src/types/iliad";

const workspace: WorkspaceInfo = { name: "ws", path: "/ws", sessionId: "s" };

function file(name: string, companion?: FileTreeNode["companion"]): FileTreeNode {
  return { name, path: `/ws/${name}`, relativePath: name, kind: "markdown", ...(companion ? { companion } : {}) };
}

const nodes: FileTreeNode[] = [
  file("chapter.comments.md", { kind: "comments", documentPath: "/ws/chapter.md" }),
  file("chapter.md"),
  // Since 2026-09-25 `name.notes.md` is an ordinary document (main never marks it).
  file("chapter.notes.md"),
  file("lonely.comments.md"),
  file("other.md")
];

function renderTree(overrides: Partial<Parameters<typeof FileTree>[0]> = {}) {
  const noop = () => undefined;
  return renderToStaticMarkup(
    <FileTree
      workspace={workspace} recentWorkspaces={[]} nodes={nodes} activePath={undefined} selectedPath={null}
      pendingChanges={[]} pendingReviewCount={0} creatingFile={false} creatingFolder={false}
      labels={appStrings.en.sidebar} updateLabels={appStrings.en.updates} updateStatus={null} updateChecking={false}
      renamingPath={null} onOpenNode={noop} onOpenPendingChange={noop} onCreateFile={noop} onCreateFolder={noop}
      onOpenFolder={noop} onOpenRecent={noop} onRevealWorkspace={noop} onCheckForUpdates={noop} onDownloadUpdate={noop}
      onViewUpdateRelease={noop} onSelectNode={noop} onSelectWorkspaceRoot={noop} onAcceptPendingChanges={noop}
      onRejectPendingChanges={noop} onMoveNode={async () => null} onShowContextMenu={noop} onCancelRename={noop}
      onCommitRename={noop} {...overrides}
    />
  );
}

describe("companion rows in the file tree", () => {
  it("groups the comments companion under its document; notes files and orphans stay ordinary rows", () => {
    const display = buildFileTreeDisplayNodes(nodes, []);

    expect(display.map(displayNodePath)).toEqual(["/ws/chapter.md", "/ws/chapter.notes.md", "/ws/lonely.comments.md", "/ws/other.md"]);
    const chapter = display[0];
    expect(displayNodeChildren(chapter)?.map(displayNodeCompanionKind)).toEqual(["comments"]);
    expect(displayNodeCompanionKind(display[1])).toBeNull();
    expect(displayNodeChildren(display[1])).toBeUndefined();
    expect(displayNodeCompanionKind(display[2])).toBeNull();
  });

  it("shows companion rows only under the active document", () => {
    const hidden = renderTree({ activePath: "/ws/other.md" });
    expect(hidden).not.toContain("Comments");
    expect(hidden).toContain("chapter.notes");

    const shown = renderTree({ activePath: "/ws/chapter.md", companionCommentCount: { documentPath: "/ws/chapter.md", count: 3 } });
    expect(shown).not.toContain(">Notes<");
    expect(shown).toContain(">Comments · 3<");
    expect(shown).toContain("is-companion");

    const unknownCount = renderTree({ activePath: "/ws/chapter.comments.md" });
    expect(unknownCount).toContain(">Comments<");
  });

  it("offers only Open, Reveal in Finder, and Move to Trash for a companion", () => {
    vi.stubGlobal("window", { innerWidth: 1000, innerHeight: 800 });
    const labels = appStrings.en.treeContextMenu;
    const noop = () => undefined;
    const html = renderToStaticMarkup(
      <TreeContextMenu
        labels={labels} menu={{ node: nodes[0], x: 0, y: 0 }} menuRef={{ current: null }}
        onCopyPath={noop} onOpen={noop} onDuplicate={noop} onMoveToTrash={noop} onRename={noop} onRevealInFinder={noop}
      />
    );

    expect(html).toContain(">Open<");
    expect(html).toContain(">Reveal in Finder<");
    expect(html).toContain(">Move to Trash<");
    expect(html).not.toContain(">Rename<");
    expect(html).not.toContain(">Duplicate<");
    vi.unstubAllGlobals();
  });
});
