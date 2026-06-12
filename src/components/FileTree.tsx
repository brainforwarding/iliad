import {
  ExternalLink,
  File,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus
} from "lucide-react";
import type { CSSProperties, FormEvent, KeyboardEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WorkspaceMenu } from "./WorkspaceMenu";
import {
  contextFileDragMimeType,
  createContextFileDragPayload,
  workspaceContextDragSessionId
} from "../assistant/contextAttachments";
import {
  buildFileTreeDisplayNodes,
  type FileTreeDisplayNode,
  type PendingFileTreeChange
} from "../assistant/pendingFileTree";
import type { FileTreeNode, WorkspaceInfo } from "../types/iliad";

interface FileTreeProps {
  workspace: WorkspaceInfo;
  recentWorkspaces: WorkspaceInfo[];
  nodes: FileTreeNode[];
  activePath?: string;
  selectedPath?: string | null;
  pendingChanges: PendingFileTreeChange[];
  creatingFile: boolean;
  creatingFolder: boolean;
  labels: FileTreeLabels;
  renamingPath: string | null;
  revealPath?: string | null;
  onRevealComplete?: (path: string) => void;
  onOpenNode: (node: FileTreeNode) => void;
  onOpenPendingChange: (target: PendingFileTreeChange) => void | Promise<void>;
  onCreateFile: () => void;
  onCreateFolder: () => void;
  onOpenFolder: () => void | Promise<void>;
  onOpenRecent: (workspace: WorkspaceInfo) => void | Promise<void>;
  onRevealWorkspace: () => void | Promise<void>;
  onSelectNode: (node: FileTreeNode) => void;
  onShowContextMenu: (node: FileTreeNode, position: { x: number; y: number }) => void;
  onCancelRename: () => void;
  onCommitRename: (node: FileTreeNode, requestedName: string) => void;
}

interface FileTreeLabels {
  newDocument: string;
  newFolder: string;
  changeFolder: string;
  openFolder: string;
  recent: string;
  noFiles: string;
  pendingEdit: (path: string) => string;
  proposedNewDocument: (path: string) => string;
  rename: (name: string) => string;
}

interface TreeRowProps {
  node: FileTreeDisplayNode;
  depth: number;
  activePath?: string;
  selectedPath?: string | null;
  workspaceSessionId: string;
  renamingPath: string | null;
  expanded: Set<string>;
  labels: FileTreeLabels;
  onToggle: (path: string) => void;
  registerRow: (path: string, element: HTMLDivElement | null) => void;
  onOpenNode: (node: FileTreeNode) => void;
  onOpenPendingChange: (target: PendingFileTreeChange) => void | Promise<void>;
  onSelectNode: (node: FileTreeNode) => void;
  onShowContextMenu: (node: FileTreeNode, position: { x: number; y: number }) => void;
  onCancelRename: () => void;
  onCommitRename: (node: FileTreeNode, requestedName: string) => void;
}

function isAssetNode(node: FileTreeNode) {
  return node.name === "assets" || node.relativePath.split(/[\\/]/).includes("assets");
}

function displayNodePath(node: FileTreeDisplayNode) {
  return node.source === "real" ? node.node.path : node.path;
}

function displayNodeRelativePath(node: FileTreeDisplayNode) {
  return node.source === "real" ? node.node.relativePath : node.relativePath;
}

function displayNodeName(node: FileTreeDisplayNode) {
  return node.source === "real" ? node.node.name : node.name;
}

function displayNodeKind(node: FileTreeDisplayNode) {
  if (node.source === "pending-dir") {
    return "directory";
  }

  if (node.source === "pending-create") {
    return "markdown";
  }

  return node.node.kind;
}

function displayNodeChildren(node: FileTreeDisplayNode) {
  if (node.source === "pending-create") {
    return undefined;
  }

  return node.children;
}

export function fileTreeRevealAncestorPaths(nodes: FileTreeDisplayNode[], targetPath: string): string[] | null {
  const visit = (treeNodes: FileTreeDisplayNode[], ancestors: string[]): string[] | null => {
    for (const node of treeNodes) {
      const nodePath = displayNodePath(node);

      if (nodePath === targetPath) {
        return ancestors;
      }

      const children = displayNodeChildren(node);
      const childResult = children ? visit(children, [...ancestors, nodePath]) : null;

      if (childResult) {
        return childResult;
      }
    }

    return null;
  };

  return visit(nodes, []);
}

function pendingLabel(node: FileTreeDisplayNode, labels: FileTreeLabels) {
  const target = node.source === "real" ? node.pendingTarget : node.source === "pending-create" ? node.pendingTarget : null;

  if (!target) {
    return null;
  }

  return target.kind === "edit_file"
    ? labels.pendingEdit(target.relativePath)
    : labels.proposedNewDocument(target.relativePath);
}

function FileIcon({ node, isExpanded }: { node: FileTreeDisplayNode; isExpanded: boolean }) {
  if (node.source === "pending-create") {
    return <FilePlus size={16} />;
  }

  const kind = displayNodeKind(node);

  if (kind === "directory") {
    return isExpanded ? <FolderOpen size={16} /> : <Folder size={16} />;
  }

  if (kind === "markdown") {
    return <FileText size={16} strokeWidth={1.5} />;
  }

  return <File size={16} strokeWidth={1.6} />;
}

function RealFileIcon({ node, isExpanded }: { node: FileTreeNode; isExpanded: boolean }) {
  if (node.kind === "directory") {
    return isExpanded ? <FolderOpen size={16} /> : <Folder size={16} />;
  }

  if (node.kind === "markdown") {
    return <FileText size={16} strokeWidth={1.5} />;
  }

  return <File size={16} strokeWidth={1.6} />;
}

function markdownStem(name: string) {
  return name.replace(/\.(md|markdown|mdown|mkd)$/i, "");
}

function nodeFileNameFromInput(node: FileTreeNode, value: string) {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return "";
  }

  return node.kind === "markdown" ? `${markdownStem(trimmedValue)}.md` : trimmedValue;
}

function displayName(node: FileTreeNode) {
  return node.kind === "markdown" ? markdownStem(node.name) : node.name;
}

function displayTreeName(node: FileTreeDisplayNode) {
  const name = displayNodeName(node);
  return displayNodeKind(node) === "markdown" ? markdownStem(name) : name;
}

function RenameInput({
  node,
  isExpanded,
  labels,
  onCancelRename,
  onCommitRename
}: {
  node: FileTreeNode;
  isExpanded: boolean;
  labels: FileTreeLabels;
  onCancelRename: () => void;
  onCommitRename: (node: FileTreeNode, requestedName: string) => void;
}) {
  const [value, setValue] = useState(displayName(node));
  const committed = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const finish = () => {
    if (committed.current) {
      return;
    }

    committed.current = true;
    const nextName = nodeFileNameFromInput(node, value);

    if (!nextName || nextName === node.name) {
      onCancelRename();
      return;
    }

    onCommitRename(node, nextName);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    finish();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      committed.current = true;
      onCancelRename();
    }
  };

  return (
    <form className="tree-rename-form" onSubmit={onSubmit}>
      <span className="tree-icon">
        <RealFileIcon node={node} isExpanded={isExpanded} />
      </span>
      <input
        ref={inputRef}
        aria-label={labels.rename(node.name)}
        className="tree-rename-input"
        value={value}
        onBlur={finish}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={onKeyDown}
      />
    </form>
  );
}

function TreeRow({
  node,
  depth,
  activePath,
  selectedPath,
  workspaceSessionId,
  renamingPath,
  expanded,
  labels,
  onToggle,
  registerRow,
  onOpenNode,
  onOpenPendingChange,
  onSelectNode,
  onShowContextMenu,
  onCancelRename,
  onCommitRename
}: TreeRowProps) {
  const nodePath = displayNodePath(node);
  const nodeKind = displayNodeKind(node);
  const isDirectory = nodeKind === "directory";
  const opensExternally = node.source === "real" && nodeKind !== "directory" && nodeKind !== "markdown";
  const children = displayNodeChildren(node);
  const isExpanded = expanded.has(nodePath);
  const isActive = activePath === nodePath;
  const isSelected = node.source === "real" && selectedPath === node.node.path && !isActive;
  const isRenaming = node.source === "real" && renamingPath === node.node.path;
  const pendingTitle = pendingLabel(node, labels);
  const hasPendingIndicator =
    node.source === "pending-create" ||
    node.source === "pending-dir" ||
    Boolean(node.source === "real" && (node.pendingTarget || node.hasPendingDescendant));
  const pendingIndicatorClass =
    node.source === "pending-create" || node.source === "pending-dir" ? "is-create" : "is-edit";
  const canDragContextFile = node.source === "real" && nodeKind === "markdown";
  const rowClassName = [
    "tree-item",
    `is-${displayNodeKind(node)}`,
    node.source === "real" && isAssetNode(node.node) ? "is-asset" : "",
    node.source === "pending-create" ? "is-pending-create" : "",
    node.source === "pending-dir" ? "is-pending-dir" : "",
    hasPendingIndicator ? "has-pending-indicator" : "",
    isActive ? "is-active" : "",
    isSelected ? "is-selected" : "",
    isRenaming ? "is-renaming" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <div
        ref={(element) => registerRow(nodePath, element)}
        className={rowClassName}
        draggable={canDragContextFile}
        style={{ "--tree-depth": depth } as CSSProperties}
        onDragStart={(event) => {
          if (!canDragContextFile || node.source !== "real") {
            event.preventDefault();
            return;
          }

          event.dataTransfer.effectAllowed = "copy";
          event.dataTransfer.setData(
            contextFileDragMimeType,
            JSON.stringify(createContextFileDragPayload(workspaceSessionId, node.node.relativePath))
          );
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          if (node.source !== "real") {
            return;
          }

          onSelectNode(node.node);
          onShowContextMenu(node.node, { x: event.clientX, y: event.clientY });
        }}
      >
        {isRenaming && node.source === "real" ? (
          <RenameInput
            node={node.node}
            isExpanded={isExpanded}
            labels={labels}
            onCancelRename={onCancelRename}
            onCommitRename={onCommitRename}
          />
        ) : (
          <>
            <button
              className="tree-open-button"
              type="button"
              title={pendingTitle ?? (displayNodeRelativePath(node) || displayNodeName(node))}
              aria-label={pendingTitle ?? undefined}
              onClick={() => {
                if (node.source === "pending-create") {
                  void onOpenPendingChange(node.pendingTarget);
                  return;
                }

                if (isDirectory) {
                  if (node.source === "real") {
                    onSelectNode(node.node);
                  }

                  onToggle(nodePath);
                  return;
                }

                if (node.source !== "real") {
                  return;
                }

                onSelectNode(node.node);

                if (node.pendingTarget) {
                  void onOpenPendingChange(node.pendingTarget);
                } else {
                  onOpenNode(node.node);
                }
              }}
            >
              <span className="tree-icon">
                <FileIcon node={node} isExpanded={isExpanded} />
              </span>
              <span className="tree-name">{displayTreeName(node)}</span>
              {opensExternally && !hasPendingIndicator ? (
                <span className="tree-external-hint" aria-hidden="true">
                  <ExternalLink size={13} strokeWidth={1.7} />
                </span>
              ) : null}
              {hasPendingIndicator ? (
                <span className={`tree-pending-dot ${pendingIndicatorClass}`} aria-hidden="true" />
              ) : null}
            </button>
          </>
        )}
      </div>

      {isDirectory && isExpanded
        ? children?.map((child) => (
            <TreeRow
              key={displayNodePath(child)}
              node={child}
              depth={depth + 1}
              activePath={activePath}
              selectedPath={selectedPath}
              workspaceSessionId={workspaceSessionId}
              renamingPath={renamingPath}
              expanded={expanded}
              labels={labels}
              onToggle={onToggle}
              registerRow={registerRow}
              onOpenNode={onOpenNode}
              onOpenPendingChange={onOpenPendingChange}
              onSelectNode={onSelectNode}
              onShowContextMenu={onShowContextMenu}
              onCancelRename={onCancelRename}
              onCommitRename={onCommitRename}
            />
          ))
        : null}
    </>
  );
}

export function FileTree({
  workspace,
  recentWorkspaces,
  nodes,
  activePath,
  selectedPath,
  pendingChanges,
  creatingFile,
  creatingFolder,
  labels,
  renamingPath,
  revealPath,
  onRevealComplete,
  onOpenNode,
  onOpenPendingChange,
  onCreateFile,
  onCreateFolder,
  onOpenFolder,
  onOpenRecent,
  onRevealWorkspace,
  onSelectNode,
  onShowContextMenu,
  onCancelRename,
  onCommitRename
}: FileTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const displayNodes = useMemo(() => buildFileTreeDisplayNodes(nodes, pendingChanges), [nodes, pendingChanges]);
  const workspaceSessionId = useMemo(
    () => workspaceContextDragSessionId(workspace),
    [workspace.path, workspace.sessionId]
  );
  const pendingChangesKey = useMemo(
    () =>
      pendingChanges
        .map((change) => `${change.proposalId}:${change.fileId}:${change.normalizedRelativePath}:${change.status}`)
        .join("|"),
    [pendingChanges]
  );

  useEffect(() => {
    setExpanded(new Set());
  }, [workspace.path]);

  useEffect(() => {
    if (!revealPath) {
      return;
    }

    const ancestorPaths = fileTreeRevealAncestorPaths(displayNodes, revealPath);

    if (!ancestorPaths) {
      return;
    }

    setExpanded((current) => {
      const next = new Set(current);
      const targetNode = rowRefs.current.get(revealPath);

      for (const path of ancestorPaths) {
        next.add(path);
      }

      if (targetNode?.classList.contains("is-directory")) {
        next.add(revealPath);
      }

      return next;
    });

    const frame = window.requestAnimationFrame(() => {
      const row = rowRefs.current.get(revealPath);

      if (!row) {
        return;
      }

      row.scrollIntoView({ block: "center" });
      onRevealComplete?.(revealPath);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [displayNodes, onRevealComplete, revealPath]);

  const registerRow = useCallback((path: string, element: HTMLDivElement | null) => {
    if (element) {
      rowRefs.current.set(path, element);
    } else {
      rowRefs.current.delete(path);
    }
  }, []);

  useEffect(() => {
    if (!pendingChangesKey) {
      return;
    }

    const pendingAncestorPaths: string[] = [];
    const collectPendingAncestorPaths = (treeNodes: FileTreeDisplayNode[]) => {
      for (const node of treeNodes) {
        const children = displayNodeChildren(node);

        if (children && (node.source === "pending-dir" || (node.source === "real" && node.hasPendingDescendant))) {
          pendingAncestorPaths.push(displayNodePath(node));
          collectPendingAncestorPaths(children);
        }
      }
    };

    collectPendingAncestorPaths(displayNodes);

    if (pendingAncestorPaths.length === 0) {
      return;
    }

    setExpanded((current) => {
      const next = new Set(current);

      for (const path of pendingAncestorPaths) {
        next.add(path);
      }

      return next;
    });
  }, [displayNodes, pendingChangesKey]);

  const toggle = (path: string) => {
    setExpanded((current) => {
      const next = new Set(current);

      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }

      return next;
    });
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <WorkspaceMenu
          workspace={workspace}
          recentWorkspaces={recentWorkspaces}
          labels={labels}
          onOpenFolder={onOpenFolder}
          onOpenRecent={onOpenRecent}
          onRevealWorkspace={onRevealWorkspace}
        />
        <div className="sidebar-actions">
          <button
            type="button"
            className="icon-button"
            data-tooltip={labels.newDocument}
            aria-label={labels.newDocument}
            disabled={creatingFile}
            onClick={onCreateFile}
          >
            <FilePlus size={17} />
          </button>
          <button
            type="button"
            className="icon-button"
            data-tooltip={labels.newFolder}
            aria-label={labels.newFolder}
            disabled={creatingFolder}
            onClick={onCreateFolder}
          >
            <FolderPlus size={17} />
          </button>
        </div>
      </div>

      <div className="tree-scroll">
        {displayNodes.length > 0 ? (
          displayNodes.map((node) => (
            <TreeRow
              key={displayNodePath(node)}
              node={node}
              depth={0}
              activePath={activePath}
              selectedPath={selectedPath}
              workspaceSessionId={workspaceSessionId}
              renamingPath={renamingPath}
              expanded={expanded}
              labels={labels}
              onToggle={toggle}
              registerRow={registerRow}
              onOpenNode={onOpenNode}
              onOpenPendingChange={onOpenPendingChange}
              onSelectNode={onSelectNode}
              onShowContextMenu={onShowContextMenu}
              onCancelRename={onCancelRename}
              onCommitRename={onCommitRename}
            />
          ))
        ) : (
          <div className="empty-tree">{labels.noFiles}</div>
        )}
      </div>
    </aside>
  );
}
