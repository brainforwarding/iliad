import { ChevronDown, FolderOpen, FolderPlus } from "lucide-react";
import { Icon } from "./Icon";
import { useEffect, useRef, useState } from "react";
import type { WorkspaceInfo } from "../types/iliad";

interface WorkspaceMenuLabels {
  changeFolder: string;
  openFolder: string;
  newFolder: string;
  recent: string;
}

interface WorkspaceMenuProps {
  workspace: WorkspaceInfo;
  recentWorkspaces: WorkspaceInfo[];
  labels: WorkspaceMenuLabels;
  creatingFolder?: boolean;
  /** Full "New folder in X" description, shown as the item's title. */
  newFolderTitle?: string;
  onOpenFolder: () => void | Promise<void>;
  /** Uses the tree's creation target rules (selected folder, else the open document's folder). */
  onCreateFolder: () => void | Promise<void>;
  onOpenRecent: (workspace: WorkspaceInfo) => void | Promise<void>;
  onRevealWorkspace: () => void | Promise<void>;
  /** Starts open (static-render tests). */
  defaultOpen?: boolean;
}

// Show the meaningful tail of a path (…/parent/folder) so the current route is
// readable without scrolling. Full path is exposed via title on hover.
function shortPath(path: string) {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments.length <= 2 ? path : `…/${segments.slice(-2).join("/")}`;
}

export function WorkspaceMenu({
  workspace,
  recentWorkspaces,
  labels,
  creatingFolder = false,
  newFolderTitle,
  onOpenFolder,
  onCreateFolder,
  onOpenRecent,
  onRevealWorkspace,
  defaultOpen = false
}: WorkspaceMenuProps) {
  const [open, setOpen] = useState(defaultOpen);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Don't list the folder you're already in.
  const recents = recentWorkspaces.filter((item) => item.path.toLowerCase() !== workspace.path.toLowerCase());

  return (
    <div className="workspace-menu" ref={ref}>
      <button
        type="button"
        className="workspace-switch"
        aria-expanded={open}
        aria-label={labels.changeFolder}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="workspace-name" title={workspace.path}>
          {workspace.name}
        </span>
        <Icon icon={ChevronDown} className="workspace-chevron" />
      </button>

      {open ? (
        <div className="workspace-popover" role="menu">
          <button
            type="button"
            role="menuitem"
            className="workspace-path"
            title={workspace.path}
            onClick={() => {
              setOpen(false);
              void onRevealWorkspace();
            }}
          >
            {shortPath(workspace.path)}
          </button>

          <div className="workspace-divider" />

          <button
            type="button"
            role="menuitem"
            className="workspace-action"
            onClick={() => {
              setOpen(false);
              void onOpenFolder();
            }}
          >
            <Icon icon={FolderOpen} />
            <span>{labels.openFolder}</span>
            <kbd>⌘O</kbd>
          </button>

          <button
            type="button"
            role="menuitem"
            className="workspace-action"
            title={newFolderTitle}
            disabled={creatingFolder}
            onClick={() => {
              setOpen(false);
              void onCreateFolder();
            }}
          >
            <Icon icon={FolderPlus} />
            <span>{labels.newFolder}</span>
          </button>

          {recents.length > 0 ? (
            <>
              <div className="workspace-divider" />
              <div className="workspace-recent-label">{labels.recent}</div>
              {recents.map((item) => (
                <button
                  type="button"
                  role="menuitem"
                  className="workspace-recent"
                  key={item.path}
                  title={item.path}
                  onClick={() => {
                    setOpen(false);
                    void onOpenRecent(item);
                  }}
                >
                  <span className="workspace-recent-name">{item.name}</span>
                  <span className="workspace-recent-path">{shortPath(item.path)}</span>
                </button>
              ))}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
