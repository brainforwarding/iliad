import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TreeContextMenu, clampContextMenuPosition } from "../../src/components/TreeContextMenu";
import { appStrings } from "../../src/i18n/strings";
import type { FileTreeNode } from "../../src/types/iliad";

const folder: FileTreeNode = { name: "drafts", path: "/ws/drafts", relativePath: "drafts", kind: "directory", children: [] };
const doc: FileTreeNode = { name: "a.md", path: "/ws/a.md", relativePath: "a.md", kind: "markdown" };

function renderMenu(node: FileTreeNode, onNewFolder?: (node: FileTreeNode) => void, lang: "en" | "es" = "en") {
  const noop = () => undefined;
  return renderToStaticMarkup(
    <TreeContextMenu
      labels={appStrings[lang].treeContextMenu}
      menu={{ node, x: 10, y: 10 }}
      menuRef={{ current: null }}
      onCopyPath={noop}
      onDuplicate={noop}
      onMoveToTrash={noop}
      onNewFolder={onNewFolder}
      onRename={noop}
      onRevealInFinder={noop}
    />
  );
}

describe("tree context menu", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("offers New folder first on folders, never on files", () => {
    vi.stubGlobal("window", { innerWidth: 1000, innerHeight: 800 });
    const folderHtml = renderMenu(folder, () => undefined);

    expect(folderHtml).toContain(">New folder<");
    expect(folderHtml.indexOf(">New folder<")).toBeLessThan(folderHtml.indexOf(">Rename<"));
    expect(renderMenu(doc, () => undefined)).not.toContain(">New folder<");
    expect(renderMenu(folder)).not.toContain(">New folder<");
    expect(renderMenu(folder, () => undefined, "es")).toContain(">Nueva carpeta<");
  });

  it("clamps the menu inside the viewport using its measured size", () => {
    const viewport = { width: 1000, height: 600 };
    const size = { width: 178, height: 220 };

    expect(clampContextMenuPosition({ x: 100, y: 100 }, size, viewport)).toEqual({ left: 100, top: 100 });
    expect(clampContextMenuPosition({ x: 950, y: 590 }, size, viewport)).toEqual({ left: 814, top: 372 });
    // Taller than the viewport: pinned to the top edge instead of going negative.
    expect(clampContextMenuPosition({ x: 0, y: 300 }, { width: 178, height: 900 }, viewport)).toEqual({ left: 8, top: 8 });
  });
});
