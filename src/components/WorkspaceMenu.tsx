import { ChevronDown, FolderOpen } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { WorkspaceInfo } from "../types/iliad";

interface WorkspaceMenuLabels {
  changeFolder: string;
  openFolder: string;
  recent: string;
}

interface WorkspaceMenuProps {
  workspace: WorkspaceInfo;
  recentWorkspaces: WorkspaceInfo[];
  labels: WorkspaceMenuLabels;
  onOpenFolder: () => void | Promise<void>;
  onOpenRecent: (workspace: WorkspaceInfo) => void | Promise<void>;
  onRevealWorkspace: () => void | Promise<void>;
}

// Show the meaningful tail of a path (…/parent/folder) so the current route is
// readable without scrolling. Full path is exposed via title on hover.
function shortPath(path: string) {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments.length <= 2 ? path : `…/${segments.slice(-2).join("/")}`;
}

// Stamped at build/dev-server start (vite.config.ts define), so it identifies
// the running build — the static package version alone cannot.
const appBuildLabel = `Iliad ${[__APP_VERSION__, __APP_BUILD_HASH__, __APP_BUILD_DATE__].filter(Boolean).join(" · ")}`;

export function WorkspaceMenu({
  workspace,
  recentWorkspaces,
  labels,
  onOpenFolder,
  onOpenRecent,
  onRevealWorkspace
}: WorkspaceMenuProps) {
  const [open, setOpen] = useState(false);
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
        <ChevronDown size={14} className="workspace-chevron" aria-hidden="true" />
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
            <FolderOpen size={15} aria-hidden="true" />
            <span>{labels.openFolder}</span>
            <kbd>⌘O</kbd>
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

          <div className="workspace-divider" />
          <div className="workspace-version">{appBuildLabel}</div>
        </div>
      ) : null}
    </div>
  );
}
