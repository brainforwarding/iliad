import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FileTree } from "../../src/components/FileTree";
import { appStrings } from "../../src/i18n/strings";
import type { FileTreeNode, WorkspaceInfo } from "../../src/types/iliad";

const workspace: WorkspaceInfo = { name: "ws", path: "/ws", sessionId: "s" };
const nodes: FileTreeNode[] = [
  { name: "plan-de-sesion.md", path: "/ws/plan-de-sesion.md", relativePath: "plan-de-sesion.md", kind: "markdown" },
  { name: "other.md", path: "/ws/other.md", relativePath: "other.md", kind: "markdown" }
];

function renderTree(overrides: Partial<Parameters<typeof FileTree>[0]> = {}) {
  const noop = () => undefined;
  return renderToStaticMarkup(
    <FileTree
      workspace={workspace} recentWorkspaces={[]} nodes={nodes} activePath="/ws/plan-de-sesion.md" selectedPath={null}
      pendingChanges={[]} pendingReviewCount={0} creatingFile={false} creatingFolder={false}
      labels={appStrings.en.sidebar}
      renamingPath={null} onOpenNode={noop} onOpenPendingChange={noop} onCreateFile={noop} onCreateFolder={noop}
      onOpenFolder={noop} onOpenRecent={noop} onRevealWorkspace={noop}
      onSelectNode={noop} onSelectWorkspaceRoot={noop} onAcceptPendingChanges={noop}
      onRejectPendingChanges={noop} onMoveNode={async () => null} onShowContextMenu={noop} onCancelRename={noop}
      onCommitRename={noop} onStartRename={noop} {...overrides}
    />
  );
}

describe("auto-named rows", () => {
  it("types the new name only in the renamed row", () => {
    const html = renderTree({ namingAnimation: { path: "/ws/plan-de-sesion.md", id: 1 } });
    expect(html.match(/typed-name-spark/g)).toHaveLength(1);
    expect(html).toContain('<span class="sr-only">plan-de-sesion</span>');
    expect(html).toContain(">other<");
  });

  it("shows plain names without an animation", () => {
    expect(renderTree()).not.toContain("typed-name");
  });

  it("opens the existing rename field for the renaming path", () => {
    const html = renderTree({ renamingPath: "/ws/other.md" });
    expect(html).toContain('class="tree-rename-input"');
    expect(html).toContain('value="other"');
  });
});
