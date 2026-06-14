import type { RefObject } from "react";
import type { FileTreeNode } from "../types/iliad";

export interface TreeContextMenuState {
  node: FileTreeNode;
  x: number;
  y: number;
}

interface TreeContextMenuProps {
  labels: {
    duplicate: string;
    rename: string;
    copyPath: string;
    revealInFinder: string;
    moveToTrash: string;
  };
  menu: TreeContextMenuState | null;
  menuRef: RefObject<HTMLDivElement>;
  onCopyPath: (node: FileTreeNode) => void | Promise<void>;
  onDuplicate: (node: FileTreeNode) => void | Promise<void>;
  onMoveToTrash: (node: FileTreeNode) => void | Promise<void>;
  onRename: (node: FileTreeNode) => void;
  onRevealInFinder: (node: FileTreeNode) => void | Promise<void>;
}

function contextMenuPosition(menu: TreeContextMenuState) {
  const width = 178;
  const height = menu.node.kind === "directory" ? 164 : 200;

  return {
    left: Math.min(menu.x, Math.max(8, window.innerWidth - width - 8)),
    top: Math.min(menu.y, Math.max(8, window.innerHeight - height - 8))
  };
}

export function TreeContextMenu({
  labels,
  menu,
  menuRef,
  onCopyPath,
  onDuplicate,
  onMoveToTrash,
  onRename,
  onRevealInFinder
}: TreeContextMenuProps) {
  if (!menu) {
    return null;
  }

  return (
    <div
      ref={menuRef}
      className="tree-context-menu"
      role="menu"
      style={contextMenuPosition(menu)}
    >
      {menu.node.kind !== "directory" ? (
        <button
          type="button"
          role="menuitem"
          onClick={() => void onDuplicate(menu.node)}
        >
          {labels.duplicate}
        </button>
      ) : null}
      <button type="button" role="menuitem" onClick={() => onRename(menu.node)}>
        {labels.rename}
      </button>
      <button type="button" role="menuitem" onClick={() => void onCopyPath(menu.node)}>
        {labels.copyPath}
      </button>
      <button type="button" role="menuitem" onClick={() => void onRevealInFinder(menu.node)}>
        {labels.revealInFinder}
      </button>
      <button
        type="button"
        role="menuitem"
        className="is-danger"
        onClick={() => void onMoveToTrash(menu.node)}
      >
        {labels.moveToTrash}
      </button>
    </div>
  );
}
