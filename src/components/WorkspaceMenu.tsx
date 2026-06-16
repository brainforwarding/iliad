import { ChevronDown, Download, ExternalLink, FolderOpen, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { UpdateCheckResult, WorkspaceInfo } from "../types/iliad";

interface WorkspaceMenuLabels {
  changeFolder: string;
  openFolder: string;
  recent: string;
}

interface WorkspaceMenuUpdateLabels {
  checkForUpdates: string;
  checking: string;
  available: (version: string) => string;
  current: (version: string) => string;
  checkFailed: string;
  download: string;
  viewRelease: string;
}

interface WorkspaceMenuProps {
  workspace: WorkspaceInfo;
  recentWorkspaces: WorkspaceInfo[];
  labels: WorkspaceMenuLabels;
  updateLabels: WorkspaceMenuUpdateLabels;
  updateStatus: UpdateCheckResult | null;
  updateChecking: boolean;
  onOpenFolder: () => void | Promise<void>;
  onOpenRecent: (workspace: WorkspaceInfo) => void | Promise<void>;
  onRevealWorkspace: () => void | Promise<void>;
  onCheckForUpdates: () => void | Promise<void>;
  onDownloadUpdate: () => void | Promise<void>;
  onViewUpdateRelease: () => void | Promise<void>;
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
  updateLabels,
  updateStatus,
  updateChecking,
  onOpenFolder,
  onOpenRecent,
  onRevealWorkspace,
  onCheckForUpdates,
  onDownloadUpdate,
  onViewUpdateRelease
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

          <button
            type="button"
            role="menuitem"
            className="workspace-action"
            disabled={updateChecking}
            onClick={() => {
              void onCheckForUpdates();
            }}
          >
            <RefreshCw size={15} aria-hidden="true" />
            <span>{updateChecking ? updateLabels.checking : updateLabels.checkForUpdates}</span>
          </button>

          {updateStatus ? (
            <div className={`workspace-update-status is-${updateStatus.status}`}>
              <p>
                {updateStatus.status === "available"
                  ? updateLabels.available(updateStatus.latestVersion)
                  : updateStatus.status === "current"
                    ? updateLabels.current(updateStatus.latestVersion)
                    : updateLabels.checkFailed}
              </p>

              {updateStatus.status === "available" ? (
                <div className="workspace-update-actions">
                  {updateStatus.downloadUrl ? (
                    <button type="button" onClick={() => void onDownloadUpdate()}>
                      <Download size={14} aria-hidden="true" />
                      <span>{updateLabels.download}</span>
                    </button>
                  ) : null}
                  <button type="button" onClick={() => void onViewUpdateRelease()}>
                    <ExternalLink size={14} aria-hidden="true" />
                    <span>{updateLabels.viewRelease}</span>
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
