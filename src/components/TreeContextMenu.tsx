import { useEffect, useLayoutEffect, type RefObject } from "react";
import type { FileTreeNode } from "../types/iliad";

export interface TreeContextMenuState {
  node: FileTreeNode;
  x: number;
  y: number;
}

interface TreeContextMenuProps {
  labels: {
    open: string;
    duplicate: string;
    rename: string;
    moveToWorkspaceRoot: string;
    copyPath: string;
    revealInFinder: string;
    moveToTrash: string;
    newFolder: string;
  };
  menu: TreeContextMenuState | null;
  menuRef: RefObject<HTMLDivElement>;
  canMoveToRoot?: (node: FileTreeNode) => boolean;
  onCopyPath: (node: FileTreeNode) => void | Promise<void>;
  /** Opens a companion file (comments); companions have no other file actions. */
  onOpen?: (node: FileTreeNode) => void | Promise<unknown>;
  onDuplicate: (node: FileTreeNode) => void | Promise<void>;
  onMoveToRoot?: (node: FileTreeNode) => void | Promise<unknown>;
  onMoveToTrash: (node: FileTreeNode) => void | Promise<void>;
  /** Folders only: creates a folder inside this folder (explicit target, not the selection). */
  onNewFolder?: (node: FileTreeNode) => void | Promise<unknown>;
  onRename: (node: FileTreeNode) => void;
  onRevealInFinder: (node: FileTreeNode) => void | Promise<void>;
}

// Layout effect in the app; plain effect in server-rendered tests (no document).
const useMeasureEffect = typeof document === "undefined" ? useEffect : useLayoutEffect;

const MENU_WIDTH = 178;
const MENU_EDGE = 8;
// First-paint estimate: 6px padding + ~32px per item. The real height is
// measured after mount (below) and the menu is re-clamped to the viewport.
const MENU_ITEM_HEIGHT = 32;
const MENU_PADDING = 12;

export function clampContextMenuPosition(
  point: { x: number; y: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number }
) {
  return {
    left: Math.max(MENU_EDGE, Math.min(point.x, viewport.width - size.width - MENU_EDGE)),
    top: Math.max(MENU_EDGE, Math.min(point.y, viewport.height - size.height - MENU_EDGE))
  };
}

function contextMenuPosition(menu: TreeContextMenuState, itemCount: number) {
  return clampContextMenuPosition(
    menu,
    { width: MENU_WIDTH, height: itemCount * MENU_ITEM_HEIGHT + MENU_PADDING },
    { width: window.innerWidth, height: window.innerHeight }
  );
}

export function TreeContextMenu({
  labels,
  menu,
  menuRef,
  canMoveToRoot,
  onCopyPath,
  onOpen,
  onDuplicate,
  onMoveToRoot,
  onMoveToTrash,
  onNewFolder,
  onRename,
  onRevealInFinder
}: TreeContextMenuProps) {
  // Re-clamp with the rendered size so the menu never runs off the bottom
  // edge, whatever items it ends up with.
  useMeasureEffect(() => {
    const element = menuRef.current;

    if (!menu || !element) {
      return;
    }

    const rect = element.getBoundingClientRect();
    const position = clampContextMenuPosition(
      menu,
      { width: rect.width, height: rect.height },
      { width: window.innerWidth, height: window.innerHeight }
    );

    element.style.left = `${position.left}px`;
    element.style.top = `${position.top}px`;
  }, [menu, menuRef]);

  if (!menu) {
    return null;
  }

  const showMoveToRoot = Boolean(onMoveToRoot && canMoveToRoot?.(menu.node));
  const isDirectory = menu.node.kind === "directory";
  const showNewFolder = isDirectory && Boolean(onNewFolder);

  // Companion files follow their document: Open, Reveal in Finder, Move to Trash (spec V11).
  if (menu.node.companion) {
    return (
      <div ref={menuRef} className="tree-context-menu" role="menu" style={contextMenuPosition(menu, 3)}>
        <button type="button" role="menuitem" onClick={() => void onOpen?.(menu.node)}>
          {labels.open}
        </button>
        <button type="button" role="menuitem" onClick={() => void onRevealInFinder(menu.node)}>
          {labels.revealInFinder}
        </button>
        <button type="button" role="menuitem" className="is-danger" onClick={() => void onMoveToTrash(menu.node)}>
          {labels.moveToTrash}
        </button>
      </div>
    );
  }

  return (
    <div
      ref={menuRef}
      className="tree-context-menu"
      role="menu"
      style={contextMenuPosition(menu, 4 + (showNewFolder || !isDirectory ? 1 : 0) + (showMoveToRoot ? 1 : 0))}
    >
      {showNewFolder ? (
        <button type="button" role="menuitem" onClick={() => void onNewFolder?.(menu.node)}>
          {labels.newFolder}
        </button>
      ) : null}
      {!isDirectory ? (
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
      {showMoveToRoot ? (
        <button type="button" role="menuitem" onClick={() => void onMoveToRoot?.(menu.node)}>
          {labels.moveToWorkspaceRoot}
        </button>
      ) : null}
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
