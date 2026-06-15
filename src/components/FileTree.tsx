import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  File,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Search,
  X
} from "lucide-react";
import type { CSSProperties, FormEvent, KeyboardEvent, ReactNode, RefObject } from "react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { WorkspaceMenu } from "./WorkspaceMenu";
import {
  contextFileDragMimeType,
  createContextFileDragPayload,
  workspaceContextDragSessionId
} from "../assistant/contextAttachments";
import {
  buildFileTreeDisplayNodes,
  displayNodeChildren,
  displayNodeId,
  displayNodeKind,
  displayNodeName,
  displayNodePath,
  displayNodeRelativePath,
  displayTreeName,
  fileTreeRevealAncestorPaths,
  markdownStem,
  type FileTreeDisplayNode,
  type PendingFileTreeChange
} from "../assistant/pendingFileTree";
import {
  clampFileTreeSearchActiveIndex,
  filterFileTreeDisplayNodesForSearch,
  moveFileTreeSearchActiveIndex,
  searchFileTreeDisplayNodes,
  type FileTreeSearchMode,
  type FileTreeSearchNodeMeta,
  type FileTreeSearchRange
} from "../assistant/fileTreeSearch";
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
  onCloseContextMenu?: () => void;
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
  findInFileTree: string;
  fileTreeSearchPlaceholder: string;
  clearFileTreeSearch: string;
  closeFileTreeSearch: string;
  fileTreeSearchDone: string;
  previousFileTreeMatch: string;
  nextFileTreeMatch: string;
  toggleFileTreeFilter: string;
  fileTreeFilterLabel: string;
  fileTreeFilterOn: string;
  fileTreeFilterOff: string;
  toggleFileTreeFuzzy: string;
  fileTreeFuzzyLabel: string;
  fileTreeFuzzyOn: string;
  fileTreeFuzzyOff: string;
  fileTreeSearchNoResults: string;
  fileTreeSearchCount: (current: number, total: number) => string;
  fileTreeSearchMatchAria: (name: string, current: number, total: number) => string;
  fileTreeDescendantMatches: (count: number) => string;
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
  searchMeta?: FileTreeSearchNodeMeta;
  searchMetaById: Map<string, FileTreeSearchNodeMeta>;
  activeSearchMatchId?: string | null;
  isSearchActiveMatch: boolean;
  searchOpen: boolean;
  onToggle: (path: string) => void;
  registerRow: (path: string, element: HTMLDivElement | null) => void;
  registerRowButton: (path: string, element: HTMLButtonElement | null) => void;
  onShowPathPeek: (path: string, element: HTMLElement) => void;
  onHidePathPeek: (path?: string) => void;
  onSearchRowKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onOpenNode: (node: FileTreeNode) => void;
  onOpenPendingChange: (target: PendingFileTreeChange) => void | Promise<void>;
  onSelectNode: (node: FileTreeNode) => void;
  onShowContextMenu: (node: FileTreeNode, position: { x: number; y: number }) => void;
  onCancelRename: () => void;
  onCommitRename: (node: FileTreeNode, requestedName: string) => void;
}

interface FileTreeSearchControlProps {
  labels: FileTreeLabels;
  inputId: string;
  inputRef: RefObject<HTMLInputElement>;
  treeListId: string;
  statusId: string;
  query: string;
  mode: FileTreeSearchMode;
  filter: boolean;
  matchCount: number;
  activeMatchIndex: number;
  activeMatchPath: string | null;
  onQueryChange: (query: string) => void;
  onClose: () => void;
  onClear: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onToggleMode: () => void;
  onToggleFilter: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
}

interface TreePathPeek {
  path: string;
  top: number;
  left: number;
  maxWidth: number;
}

function isAssetNode(node: FileTreeNode) {
  return node.name === "assets" || node.relativePath.split(/[\\/]/).includes("assets");
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

function renderSearchHighlightedName(displayName: string, ranges: FileTreeSearchRange[]) {
  if (ranges.length === 0) {
    return displayName;
  }

  const parts: ReactNode[] = [];
  let offset = 0;

  ranges.forEach((range, index) => {
    if (range.start > offset) {
      parts.push(displayName.slice(offset, range.start));
    }

    parts.push(
      <mark key={`${range.start}-${range.end}-${index}`} className="tree-search-mark">
        {displayName.slice(range.start, range.end)}
      </mark>
    );
    offset = range.end;
  });

  if (offset < displayName.length) {
    parts.push(displayName.slice(offset));
  }

  return parts;
}

function FileTreeSearchControl({
  labels,
  inputId,
  inputRef,
  treeListId,
  statusId,
  query,
  mode,
  filter,
  matchCount,
  activeMatchIndex,
  activeMatchPath,
  onQueryChange,
  onClose,
  onClear,
  onPrevious,
  onNext,
  onToggleMode,
  onToggleFilter,
  onKeyDown
}: FileTreeSearchControlProps) {
  const hasQuery = query.trim().length > 0;
  const currentMatch = matchCount > 0 ? activeMatchIndex + 1 : 0;
  const statusText =
    matchCount > 0
      ? labels.fileTreeSearchCount(currentMatch, matchCount)
      : hasQuery
        ? labels.fileTreeSearchNoResults
        : "";
  const liveText =
    matchCount > 0 && activeMatchPath
      ? labels.fileTreeSearchMatchAria(activeMatchPath, currentMatch, matchCount)
      : statusText;

  return (
    <div className="file-tree-search" role="search" aria-label={labels.findInFileTree}>
      <div className="file-tree-search-input-row">
        <div className="file-tree-search-input-wrap">
          <Search size={14} aria-hidden="true" />
          <input
            ref={inputRef}
            id={inputId}
            type="search"
            aria-label={labels.findInFileTree}
            value={query}
            aria-controls={treeListId}
            aria-describedby={statusId}
            placeholder={labels.fileTreeSearchPlaceholder}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <button
            type="button"
            className="file-tree-search-clear"
            data-tooltip={labels.clearFileTreeSearch}
            aria-label={labels.clearFileTreeSearch}
            disabled={!query}
            onClick={onClear}
          >
            <X size={13} />
          </button>
        </div>
      </div>

      <div className="file-tree-search-controls">
        <div className="file-tree-search-control-row file-tree-search-mode-row">
          <span className="file-tree-search-count" aria-hidden="true">
            {statusText}
          </span>
          <button
            type="button"
            className="file-tree-search-toggle"
            data-tooltip={mode === "fuzzy" ? labels.fileTreeFuzzyOn : labels.fileTreeFuzzyOff}
            aria-label={labels.toggleFileTreeFuzzy}
            aria-pressed={mode === "fuzzy"}
            onClick={onToggleMode}
          >
            {labels.fileTreeFuzzyLabel}
          </button>
          <button
            type="button"
            className="file-tree-search-toggle"
            data-tooltip={filter ? labels.fileTreeFilterOn : labels.fileTreeFilterOff}
            aria-label={labels.toggleFileTreeFilter}
            aria-pressed={filter}
            onClick={onToggleFilter}
          >
            {labels.fileTreeFilterLabel}
          </button>
        </div>
        <div className="file-tree-search-control-row file-tree-search-nav-row">
          <span className="file-tree-search-spacer" />
          <button
            type="button"
            className="file-tree-search-icon-button"
            data-tooltip={labels.previousFileTreeMatch}
            aria-label={labels.previousFileTreeMatch}
            disabled={matchCount === 0}
            onClick={onPrevious}
          >
            <ChevronUp size={14} />
          </button>
          <button
            type="button"
            className="file-tree-search-icon-button"
            data-tooltip={labels.nextFileTreeMatch}
            aria-label={labels.nextFileTreeMatch}
            disabled={matchCount === 0}
            onClick={onNext}
          >
            <ChevronDown size={14} />
          </button>
          <button
            type="button"
            className="file-tree-search-done-button"
            data-tooltip={labels.closeFileTreeSearch}
            aria-label={labels.closeFileTreeSearch}
            onClick={onClose}
          >
            {labels.fileTreeSearchDone}
          </button>
        </div>
        <span id={statusId} className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {liveText}
        </span>
      </div>
    </div>
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
  searchMeta,
  searchMetaById,
  activeSearchMatchId,
  isSearchActiveMatch,
  searchOpen,
  onToggle,
  registerRow,
  registerRowButton,
  onShowPathPeek,
  onHidePathPeek,
  onSearchRowKeyDown,
  onOpenNode,
  onOpenPendingChange,
  onSelectNode,
  onShowContextMenu,
  onCancelRename,
  onCommitRename
}: TreeRowProps) {
  const pathDescriptionId = useId();
  const nodePath = displayNodePath(node);
  const nodeKind = displayNodeKind(node);
  const isDirectory = nodeKind === "directory";
  const opensExternally = node.source === "real" && nodeKind !== "directory" && nodeKind !== "markdown";
  const children = displayNodeChildren(node);
  const isExpanded = expanded.has(nodePath);
  const isActive = activePath === nodePath;
  const isSelected = node.source === "real" && selectedPath === node.node.path && !isActive;
  const isRenaming = node.source === "real" && renamingPath === node.node.path;
  const displayedName = displayTreeName(node);
  const fullRelativePath = displayNodeRelativePath(node) || displayNodeName(node);
  const pendingTitle = pendingLabel(node, labels);
  const hasPendingIndicator =
    node.source === "pending-create" ||
    node.source === "pending-dir" ||
    Boolean(node.source === "real" && (node.pendingTarget || node.hasPendingDescendant));
  const pendingIndicatorClass =
    node.source === "pending-create" || node.source === "pending-dir" ? "is-create" : "is-edit";
  const canDragContextFile = node.source === "real" && nodeKind === "markdown";
  const descendantMatchCount = searchMeta?.descendantMatchCount ?? 0;
  const hasDescendantMatchDescription = searchOpen && descendantMatchCount > 0;
  const showDescendantMatchCount =
    searchOpen && descendantMatchCount > 0 && (!searchMeta?.selfMatch || !isExpanded);
  const rowDescription = hasDescendantMatchDescription
    ? `${fullRelativePath}. ${labels.fileTreeDescendantMatches(descendantMatchCount)}`
    : fullRelativePath;
  const rowClassName = [
    "tree-item",
    `is-${displayNodeKind(node)}`,
    node.source === "real" && isAssetNode(node.node) ? "is-asset" : "",
    node.source === "pending-create" ? "is-pending-create" : "",
    node.source === "pending-dir" ? "is-pending-dir" : "",
    hasPendingIndicator ? "has-pending-indicator" : "",
    isActive ? "is-active" : "",
    isSelected ? "is-selected" : "",
    isSearchActiveMatch ? "is-search-active-match" : "",
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
        onPointerEnter={(event) => onShowPathPeek(fullRelativePath, event.currentTarget)}
        onPointerLeave={() => onHidePathPeek(fullRelativePath)}
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
              ref={(element) => registerRowButton(nodePath, element)}
              className="tree-open-button"
              type="button"
              title={pendingTitle ?? fullRelativePath}
              aria-label={pendingTitle ?? undefined}
              aria-describedby={pathDescriptionId}
              aria-current={isSearchActiveMatch ? "true" : undefined}
              onBlur={() => onHidePathPeek(fullRelativePath)}
              onFocus={(event) => onShowPathPeek(fullRelativePath, event.currentTarget)}
              onKeyDown={onSearchRowKeyDown}
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
              <span className="tree-name">
                <span className="tree-name-text">
                  {renderSearchHighlightedName(displayedName, searchMeta?.selfRanges ?? [])}
                </span>
                {showDescendantMatchCount ? (
                  <span
                    className="tree-search-descendant-count"
                    title={labels.fileTreeDescendantMatches(descendantMatchCount)}
                    aria-hidden="true"
                  >
                    {descendantMatchCount}
                  </span>
                ) : null}
              </span>
              {opensExternally && !hasPendingIndicator ? (
                <span className="tree-external-hint" aria-hidden="true">
                  <ExternalLink size={13} strokeWidth={1.7} />
                </span>
              ) : null}
              {hasPendingIndicator ? (
                <span className={`tree-pending-dot ${pendingIndicatorClass}`} aria-hidden="true" />
              ) : null}
              <span id={pathDescriptionId} className="sr-only">
                {rowDescription}
              </span>
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
              searchMeta={searchMetaById.get(displayNodeId(child))}
              searchMetaById={searchMetaById}
              activeSearchMatchId={activeSearchMatchId}
              isSearchActiveMatch={activeSearchMatchId === displayNodeId(child)}
              searchOpen={searchOpen}
              onToggle={onToggle}
              registerRow={registerRow}
              registerRowButton={registerRowButton}
              onShowPathPeek={onShowPathPeek}
              onHidePathPeek={onHidePathPeek}
              onSearchRowKeyDown={onSearchRowKeyDown}
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

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select" || target.isContentEditable;
}

function isFileTreeSearchShortcut(event: KeyboardEvent<HTMLElement>) {
  if (event.key.toLowerCase() !== "f") {
    return false;
  }

  const isMac = navigator.platform.toLowerCase().includes("mac");
  return isMac ? event.metaKey && event.altKey && !event.ctrlKey : event.ctrlKey && event.altKey && !event.metaKey;
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
  onCloseContextMenu,
  onCancelRename,
  onCommitRename
}: FileTreeProps) {
  const [durableExpanded, setDurableExpanded] = useState<Set<string>>(new Set());
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMode, setSearchMode] = useState<FileTreeSearchMode>("fuzzy");
  const [searchFilter, setSearchFilter] = useState(false);
  const [activeMatchIndex, setActiveMatchIndex] = useState(-1);
  const [pathPeek, setPathPeek] = useState<TreePathPeek | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const rowButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const searchButtonRef = useRef<HTMLButtonElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchReturnFocusRef = useRef<HTMLElement | null>(null);
  const generatedId = useId();
  const treeListId = `${generatedId}-file-tree`;
  const searchInputId = `${generatedId}-file-tree-search-input`;
  const searchStatusId = `${generatedId}-file-tree-search-status`;
  const displayNodes = useMemo(() => buildFileTreeDisplayNodes(nodes, pendingChanges), [nodes, pendingChanges]);
  const searchResult = useMemo(
    () => searchFileTreeDisplayNodes(displayNodes, searchQuery, searchMode),
    [displayNodes, searchMode, searchQuery]
  );
  const hasSearchQuery = searchOpen && Boolean(searchResult.normalizedQuery);
  const activeMatchIndexSafe = clampFileTreeSearchActiveIndex(activeMatchIndex, searchResult.matches.length);
  const activeMatch = hasSearchQuery && activeMatchIndexSafe >= 0 ? searchResult.matches[activeMatchIndexSafe] : null;
  const activeSearchMatchId = activeMatch?.id ?? null;
  const renderedNodes = useMemo(
    () =>
      hasSearchQuery && searchFilter
        ? filterFileTreeDisplayNodesForSearch(displayNodes, searchResult)
        : displayNodes,
    [displayNodes, hasSearchQuery, searchFilter, searchResult]
  );
  const searchForcedExpanded = useMemo(() => {
    const forcedExpanded = new Set<string>();

    if (hasSearchQuery && searchFilter) {
      for (const path of searchResult.filterAncestorPaths) {
        forcedExpanded.add(path);
      }
    }

    if (hasSearchQuery) {
      for (const path of activeMatch?.ancestorPaths ?? []) {
        forcedExpanded.add(path);
      }
    }

    return forcedExpanded;
  }, [activeMatch, hasSearchQuery, searchFilter, searchResult.filterAncestorPaths]);
  const effectiveExpanded = useMemo(() => {
    const expanded = new Set(durableExpanded);

    for (const path of searchForcedExpanded) {
      expanded.add(path);
    }

    return expanded;
  }, [durableExpanded, searchForcedExpanded]);
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
    setDurableExpanded(new Set());
    setSearchOpen(false);
    setSearchQuery("");
    setSearchMode("fuzzy");
    setSearchFilter(false);
    setActiveMatchIndex(-1);
    searchReturnFocusRef.current = null;
  }, [workspace.path]);

  useEffect(() => {
    if (!searchOpen) {
      return;
    }

    setActiveMatchIndex((current) => clampFileTreeSearchActiveIndex(current, searchResult.matches.length));
  }, [searchOpen, searchResult.matches.length]);

  useEffect(() => {
    if (!searchOpen) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [searchOpen]);

  useEffect(() => {
    if (!activeSearchMatchId) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      rowRefs.current.get(activeSearchMatchId)?.scrollIntoView({ block: "nearest" });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [activeSearchMatchId]);

  useEffect(() => {
    if (renamingPath && searchOpen) {
      setSearchOpen(false);
      setActiveMatchIndex(-1);
    }
  }, [renamingPath, searchOpen]);

  useEffect(() => {
    if (!revealPath) {
      return;
    }

    const ancestorPaths = fileTreeRevealAncestorPaths(displayNodes, revealPath);

    if (!ancestorPaths) {
      return;
    }

    setDurableExpanded((current) => {
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

  const registerRowButton = useCallback((path: string, element: HTMLButtonElement | null) => {
    if (element) {
      rowButtonRefs.current.set(path, element);
    } else {
      rowButtonRefs.current.delete(path);
    }
  }, []);

  const showPathPeek = useCallback((path: string, element: HTMLElement) => {
    if (!path) {
      return;
    }

    const rect = element.getBoundingClientRect();
    const margin = 8;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const maxWidth = Math.max(1, Math.min(520, viewportWidth - margin * 2));
    const left = Math.min(Math.max(margin, rect.left + 22), Math.max(margin, viewportWidth - margin - maxWidth));
    const top = Math.min(Math.max(margin, rect.bottom + 5), Math.max(margin, viewportHeight - margin - 64));

    setPathPeek({ path, top, left, maxWidth });
  }, []);

  const hidePathPeek = useCallback((path?: string) => {
    setPathPeek((current) => {
      if (!current || (path && current.path !== path)) {
        return current;
      }

      return null;
    });
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

    setDurableExpanded((current) => {
      const next = new Set(current);

      for (const path of pendingAncestorPaths) {
        next.add(path);
      }

      return next;
    });
  }, [displayNodes, pendingChangesKey]);

  const focusRowButton = useCallback((path: string) => {
    const frame = window.requestAnimationFrame(() => {
      rowButtonRefs.current.get(path)?.focus();
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  const focusSearchInput = useCallback(() => {
    const frame = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  const openSearch = useCallback(
    (returnFocusTarget: HTMLElement | null) => {
      onCloseContextMenu?.();

      if (!searchOpen) {
        searchReturnFocusRef.current = returnFocusTarget;
      }

      setSearchOpen(true);
      focusSearchInput();
    },
    [focusSearchInput, onCloseContextMenu, searchOpen]
  );

  const closeSearch = useCallback(
    (restoreFocus = true) => {
      setSearchOpen(false);
      setActiveMatchIndex(-1);

      if (!restoreFocus) {
        return;
      }

      const frame = window.requestAnimationFrame(() => {
        const target = searchReturnFocusRef.current;

        if (target?.isConnected) {
          target.focus();
        } else {
          searchButtonRef.current?.focus();
        }

        searchReturnFocusRef.current = null;
      });

      return () => window.cancelAnimationFrame(frame);
    },
    []
  );

  const focusMatchAtIndex = useCallback(
    (index: number) => {
      const match = searchResult.matches[index];

      if (!match) {
        return;
      }

      setActiveMatchIndex(index);
      focusRowButton(match.id);
    },
    [focusRowButton, searchResult.matches]
  );

  const moveActiveMatch = useCallback(
    (direction: 1 | -1, focusRow = false) => {
      const nextIndex = moveFileTreeSearchActiveIndex(activeMatchIndexSafe, searchResult.matches.length, direction);

      if (nextIndex < 0) {
        return;
      }

      setActiveMatchIndex(nextIndex);

      if (focusRow) {
        focusRowButton(searchResult.matches[nextIndex]?.id ?? "");
      }
    },
    [activeMatchIndexSafe, focusRowButton, searchResult.matches]
  );

  const handleSearchInputKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeSearch();
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        moveActiveMatch(event.shiftKey ? -1 : 1);
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        focusMatchAtIndex(activeMatchIndexSafe >= 0 ? activeMatchIndexSafe : 0);
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        const previousIndex =
          searchResult.matches.length === 0
            ? -1
            : activeMatchIndexSafe > 0
              ? activeMatchIndexSafe - 1
              : searchResult.matches.length - 1;
        focusMatchAtIndex(previousIndex);
      }
    },
    [activeMatchIndexSafe, closeSearch, focusMatchAtIndex, moveActiveMatch, searchResult.matches.length]
  );

  const handleSearchRowKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (!searchOpen) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        focusSearchInput();
        return;
      }

      if (!hasSearchQuery) {
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        moveActiveMatch(1, true);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        moveActiveMatch(-1, true);
      }
    },
    [focusSearchInput, hasSearchQuery, moveActiveMatch, searchOpen]
  );

  const handleSidebarKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (!isFileTreeSearchShortcut(event) || isEditableTarget(event.target) || renamingPath) {
        return;
      }

      if (sidebarRef.current && !sidebarRef.current.contains(document.activeElement)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      openSearch(document.activeElement instanceof HTMLElement ? document.activeElement : searchButtonRef.current);
    },
    [openSearch, renamingPath]
  );

  const updateSearchQuery = useCallback(
    (query: string) => {
      onCloseContextMenu?.();
      setSearchQuery(query);
      setActiveMatchIndex(-1);
    },
    [onCloseContextMenu]
  );

  const toggleSearchMode = useCallback(() => {
    onCloseContextMenu?.();
    setSearchMode((current) => (current === "fuzzy" ? "continuous" : "fuzzy"));
    setActiveMatchIndex(-1);
  }, [onCloseContextMenu]);

  const toggleSearchFilter = useCallback(() => {
    onCloseContextMenu?.();
    setSearchFilter((current) => !current);
  }, [onCloseContextMenu]);

  const toggle = (path: string) => {
    setDurableExpanded((current) => {
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
    <aside ref={sidebarRef} className={`sidebar${searchOpen ? " has-file-tree-search" : ""}`} onKeyDown={handleSidebarKeyDown}>
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
            ref={searchButtonRef}
            type="button"
            className="icon-button"
            data-tooltip={labels.findInFileTree}
            aria-label={labels.findInFileTree}
            onClick={(event) => openSearch(event.currentTarget)}
          >
            <Search size={17} />
          </button>
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

      {searchOpen ? (
        <FileTreeSearchControl
          labels={labels}
          inputId={searchInputId}
          inputRef={searchInputRef}
          treeListId={treeListId}
          statusId={searchStatusId}
          query={searchQuery}
          mode={searchMode}
          filter={searchFilter}
          matchCount={searchResult.matches.length}
          activeMatchIndex={activeMatchIndexSafe}
          activeMatchPath={activeMatch?.relativePath ?? null}
          onQueryChange={updateSearchQuery}
          onClose={() => closeSearch()}
          onClear={() => updateSearchQuery("")}
          onPrevious={() => moveActiveMatch(-1)}
          onNext={() => moveActiveMatch(1)}
          onToggleMode={toggleSearchMode}
          onToggleFilter={toggleSearchFilter}
          onKeyDown={handleSearchInputKeyDown}
        />
      ) : null}

      <div id={treeListId} className="tree-scroll" onScroll={() => hidePathPeek()}>
        {renderedNodes.length > 0 ? (
          renderedNodes.map((node) => (
            <TreeRow
              key={displayNodePath(node)}
              node={node}
              depth={0}
              activePath={activePath}
              selectedPath={selectedPath}
              workspaceSessionId={workspaceSessionId}
              renamingPath={renamingPath}
              expanded={effectiveExpanded}
              labels={labels}
              searchMeta={searchResult.metaById.get(displayNodeId(node))}
              searchMetaById={searchResult.metaById}
              activeSearchMatchId={activeSearchMatchId}
              isSearchActiveMatch={activeSearchMatchId === displayNodeId(node)}
              searchOpen={hasSearchQuery}
              onToggle={toggle}
              registerRow={registerRow}
              registerRowButton={registerRowButton}
              onShowPathPeek={showPathPeek}
              onHidePathPeek={hidePathPeek}
              onSearchRowKeyDown={handleSearchRowKeyDown}
              onOpenNode={onOpenNode}
              onOpenPendingChange={onOpenPendingChange}
              onSelectNode={onSelectNode}
              onShowContextMenu={onShowContextMenu}
              onCancelRename={onCancelRename}
              onCommitRename={onCommitRename}
            />
          ))
        ) : (
          <div className="empty-tree">
            {hasSearchQuery && searchFilter ? labels.fileTreeSearchNoResults : labels.noFiles}
          </div>
        )}
      </div>
      {pathPeek ? (
        <div
          className="tree-path-peek"
          style={
            {
              top: pathPeek.top,
              left: pathPeek.left,
              maxWidth: pathPeek.maxWidth
            } as CSSProperties
          }
        >
          {pathPeek.path}
        </div>
      ) : null}
    </aside>
  );
}
