import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  File,
  FilePlus,
  FileText,
  FileX,
  Folder,
  FolderOpen,
  FolderPlus,
  Search,
  X
} from "lucide-react";
import type { CSSProperties, DragEvent, FormEvent, KeyboardEvent, MouseEvent, ReactNode, RefObject } from "react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { WorkspaceMenu } from "./WorkspaceMenu";
import { FileTreeContentResults } from "./FileTreeContentResults";
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
import {
  buildFileTreeContentResultTree,
  clampContentSearchActiveIndex,
  contentSearchRequestKey,
  contentSearchResponseMatchesCurrent,
  expandedContentSearchIds,
  flattenContentSearchPreviewRows,
  isLatestContentSearchRequest,
  moveContentSearchActiveIndex,
  validateContentSearchRegex,
  type FileTreeContentFlatMatch,
  type FileTreeContentMatchTarget,
  type FileTreeContentSearchProvider,
  type FileTreeSearchScope
} from "../assistant/fileTreeContentSearch";
import { findNode } from "../files/fileTree";
import {
  createFileTreeMoveDragPayload,
  fileTreeMoveDragMimeType,
  readFileTreeMoveDragPayload,
  resolveFileTreeDropTarget,
  type FileTreeMoveDropTarget
} from "../files/fileTreeMove";
import { createImageReferenceDragPayload, imageReferenceDragMimeType } from "../files/imageReferenceDrag";
import type { FileTreeNode, MarkdownContentSearchResponse, UpdateCheckResult, WorkspaceInfo } from "../types/iliad";

interface FileTreeProps {
  workspace: WorkspaceInfo;
  recentWorkspaces: WorkspaceInfo[];
  nodes: FileTreeNode[];
  activePath?: string;
  selectedPath?: string | null;
  pendingChanges: PendingFileTreeChange[];
  pendingReviewCount: number;
  pendingReviewActive?: boolean;
  pendingReviewBusy?: boolean;
  creatingFile: boolean;
  creatingFolder: boolean;
  labels: FileTreeLabels;
  updateLabels: FileTreeUpdateLabels;
  updateStatus: UpdateCheckResult | null;
  updateChecking: boolean;
  renamingPath: string | null;
  revealPath?: string | null;
  onRevealComplete?: (path: string) => void;
  onRevealFailed?: (path: string, reason: "missing_ancestors" | "missing_row") => void;
  onOpenNode: (node: FileTreeNode) => void;
  onOpenPendingChange: (target: PendingFileTreeChange) => void | Promise<void>;
  onCreateFile: () => void;
  onCreateFolder: () => void;
  onOpenFolder: () => void | Promise<void>;
  onOpenRecent: (workspace: WorkspaceInfo) => void | Promise<void>;
  onRevealWorkspace: () => void | Promise<void>;
  onCheckForUpdates: () => void | Promise<void>;
  onDownloadUpdate: () => void | Promise<void>;
  onViewUpdateRelease: () => void | Promise<void>;
  onSelectNode: (node: FileTreeNode) => void;
  onSelectWorkspaceRoot: () => void;
  onAcceptPendingChanges: () => void | Promise<void>;
  onRejectPendingChanges: () => void | Promise<void>;
  onMoveNode: (node: FileTreeNode, targetDirectoryPath: string) => Promise<FileTreeNode | null>;
  onShowContextMenu: (node: FileTreeNode, position: { x: number; y: number }) => void;
  contextMenuOpen?: boolean;
  onCloseContextMenu?: () => void;
  onCancelRename: () => void;
  onCommitRename: (node: FileTreeNode, requestedName: string) => void;
  contentSearchProvider?: FileTreeContentSearchProvider;
}

interface FileTreeUpdateLabels {
  checkForUpdates: string;
  checking: string;
  available: (version: string) => string;
  current: (version: string) => string;
  checkFailed: string;
  download: string;
  viewRelease: string;
}

interface FileTreeLabels {
  newDocument: string;
  newDocumentIn: (target: string) => string;
  newFolder: string;
  newFolderIn: (target: string) => string;
  changeFolder: string;
  openFolder: string;
  recent: string;
  noFiles: string;
  workspaceRoot: string;
  fileTreeMoveStarted: (path: string) => string;
  fileTreeMoveTarget: (path: string) => string;
  fileTreeMoveRootTarget: string;
  fileTreeMoveCanceled: string;
  fileTreeMoveCompleted: (path: string) => string;
  fileTreeMoveFailed: string;
  pendingEdit: (path: string) => string;
  proposedNewDocument: (path: string) => string;
  pendingDelete: (path: string) => string;
  pendingReviewSummary: (count: number) => string;
  acceptPendingChanges: string;
  rejectPendingChanges: string;
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
  searchScope: string;
  searchNames: string;
  searchText: string;
  fileTreeContentSearchPlaceholder: string;
  matchCase: string;
  matchWholeWord: string;
  useRegularExpression: string;
  contentSearchSearching: string;
  contentSearchNoMatches: string;
  contentSearchCount: (matches: number, files: number) => string;
  contentSearchInvalidRegex: string;
  contentSearchFailed: string;
  contentSearchUsesSavedText: string;
  contentSearchTruncated: (shown: number) => string;
  contentSearchMoreInFile: (count: number) => string;
  contentSearchMatchAria: (path: string, line: number, current: number, total: number) => string;
  contentSearchSkippedOversized: (count: number) => string;
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
  onShowPathPeek: (path: string, element: HTMLElement, options?: TreePathPeekOptions) => void;
  onHidePathPeek: (path?: string) => void;
  draggingRelativePath: string | null;
  dropTargetKey: string | null;
  onMoveDragStart: (node: FileTreeNode, event: DragEvent<HTMLDivElement>) => void;
  onMoveDragOver: (target: FileTreeMoveDropTarget, event: DragEvent<HTMLElement>, expandPath?: string) => void;
  onMoveDragLeave: (targetKey: string, event: DragEvent<HTMLElement>) => void;
  onMoveDrop: (target: FileTreeMoveDropTarget, event: DragEvent<HTMLElement>) => void;
  onMoveDragEnd: (event: DragEvent<HTMLDivElement>) => void;
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
  searchScope: FileTreeSearchScope;
  nameSearchMode: FileTreeSearchMode;
  filter: boolean;
  nameMatchCount: number;
  nameActiveMatchIndex: number;
  nameActiveMatchPath: string | null;
  textMatchCount: number;
  textStatusText: string;
  textLiveText: string;
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
  onQueryChange: (query: string) => void;
  onClose: () => void;
  onClear: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onSearchScopeChange: (scope: FileTreeSearchScope) => void;
  onToggleMode: () => void;
  onToggleFilter: () => void;
  onToggleMatchCase: () => void;
  onToggleWholeWord: () => void;
  onToggleRegex: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
}

interface TreePathPeek {
  path: string;
  top: number;
  left: number;
  maxWidth: number;
}

interface TreePathPeekOptions {
  delayMs?: number;
}

function isAssetNode(node: FileTreeNode) {
  return node.name === "assets" || node.relativePath.split(/[\\/]/).includes("assets");
}

function isImageNode(node: FileTreeNode) {
  return /\.(png|jpe?g|gif|webp|svg)$/i.test(node.name);
}

function pendingLabel(node: FileTreeDisplayNode, labels: FileTreeLabels) {
  const target =
    node.source === "real"
      ? node.pendingTarget
      : node.source === "pending-create" || node.source === "pending-delete"
        ? node.pendingTarget
        : null;

  if (!target) {
    return null;
  }

  if (target.kind === "edit_file") {
    return labels.pendingEdit(target.relativePath);
  }

  if (target.kind === "delete_file") {
    return labels.pendingDelete(target.relativePath);
  }

  return labels.proposedNewDocument(target.relativePath);
}

export function fileTreeNodeShowsPendingIndicator(node: FileTreeDisplayNode, isExpanded: boolean) {
  if (node.source === "pending-create" || node.source === "pending-delete") {
    return true;
  }

  if (node.source === "pending-dir") {
    return !isExpanded && Boolean(node.hasPendingDescendant);
  }

  if (node.source !== "real") {
    return false;
  }

  if (node.pendingTarget) {
    return true;
  }

  return displayNodeKind(node) === "directory" && !isExpanded && Boolean(node.hasPendingDescendant);
}

function FileIcon({ node, isExpanded }: { node: FileTreeDisplayNode; isExpanded: boolean }) {
  if (node.source === "pending-create" || (node.source === "real" && node.pendingTarget?.kind === "create_file")) {
    return <FilePlus size={16} />;
  }

  if (node.source === "pending-delete" || (node.source === "real" && node.pendingTarget?.kind === "delete_file")) {
    return <FileX size={16} />;
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

export function PendingReviewStrip({
  count,
  active,
  busy,
  labels,
  onAccept,
  onReject
}: {
  count: number;
  active?: boolean;
  busy?: boolean;
  labels: FileTreeLabels;
  onAccept: () => void | Promise<void>;
  onReject: () => void | Promise<void>;
}) {
  if (count === 0) {
    return null;
  }

  const showActions = !(active && count === 1);

  return (
    <div
      className={`file-tree-pending-review${showActions ? "" : " is-current-review"}`}
      role="region"
      aria-label={labels.pendingReviewSummary(count)}
    >
      <span>{labels.pendingReviewSummary(count)}</span>
      {showActions ? (
        <div className="file-tree-pending-review-actions">
          <button type="button" disabled={busy} onClick={() => void onAccept()}>
            {labels.acceptPendingChanges}
          </button>
          <button type="button" disabled={busy} onClick={() => void onReject()}>
            {labels.rejectPendingChanges}
          </button>
        </div>
      ) : null}
    </div>
  );
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

function moveDropTargetKey(target: FileTreeMoveDropTarget) {
  return target.kind === "root" ? "root" : `folder:${target.relativePath}`;
}

function normalizeDisplayRelativePath(relativePath: string) {
  return relativePath.replace(/\\/g, "/");
}

function parentPathFromAbsolutePath(filePath: string) {
  const normalized = filePath.replace(/\\/g, "/");
  const slashIndex = normalized.lastIndexOf("/");

  return slashIndex > 0 ? normalized.slice(0, slashIndex) : normalized;
}

function collectBlockedMoveRelativePaths(nodes: FileTreeDisplayNode[], paths = new Set<string>()) {
  for (const node of nodes) {
    if (node.source === "real" && (node.pendingTarget || node.hasPendingDescendant)) {
      paths.add(normalizeDisplayRelativePath(node.node.relativePath));
    }

    const children = displayNodeChildren(node);

    if (children) {
      collectBlockedMoveRelativePaths(children, paths);
    }
  }

  return paths;
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
  searchScope,
  nameSearchMode,
  filter,
  nameMatchCount,
  nameActiveMatchIndex,
  nameActiveMatchPath,
  textMatchCount,
  textStatusText,
  textLiveText,
  matchCase,
  wholeWord,
  regex,
  onQueryChange,
  onClose,
  onClear,
  onPrevious,
  onNext,
  onSearchScopeChange,
  onToggleMode,
  onToggleFilter,
  onToggleMatchCase,
  onToggleWholeWord,
  onToggleRegex,
  onKeyDown
}: FileTreeSearchControlProps) {
  const hasQuery = query.trim().length > 0;
  const nameCurrentMatch = nameMatchCount > 0 ? nameActiveMatchIndex + 1 : 0;
  const statusText =
    searchScope === "names"
      ? nameMatchCount > 0
        ? labels.fileTreeSearchCount(nameCurrentMatch, nameMatchCount)
        : hasQuery
          ? labels.fileTreeSearchNoResults
          : ""
      : textStatusText;
  const liveText =
    searchScope === "names"
      ? nameMatchCount > 0 && nameActiveMatchPath
        ? labels.fileTreeSearchMatchAria(nameActiveMatchPath, nameCurrentMatch, nameMatchCount)
        : statusText
      : textLiveText;
  const activeNavigationCount = searchScope === "names" ? nameMatchCount : textMatchCount;
  const placeholder =
    searchScope === "names" ? labels.fileTreeSearchPlaceholder : labels.fileTreeContentSearchPlaceholder;

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
            placeholder={placeholder}
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
        <div className="file-tree-search-control-row file-tree-search-scope-row">
          <div className="file-tree-search-scope" role="group" aria-label={labels.searchScope}>
            <button
              type="button"
              className="file-tree-search-scope-button"
              aria-pressed={searchScope === "text"}
              onClick={() => onSearchScopeChange("text")}
            >
              {labels.searchText}
            </button>
            <button
              type="button"
              className="file-tree-search-scope-button"
              aria-pressed={searchScope === "names"}
              onClick={() => onSearchScopeChange("names")}
            >
              {labels.searchNames}
            </button>
          </div>
          <span className="file-tree-search-count" aria-hidden="true">
            {statusText}
          </span>
        </div>
        <div className="file-tree-search-control-row file-tree-search-nav-row">
          {searchScope === "names" ? (
            <>
              <button
                type="button"
                className="file-tree-search-toggle"
                data-tooltip={nameSearchMode === "fuzzy" ? labels.fileTreeFuzzyOn : labels.fileTreeFuzzyOff}
                aria-label={labels.toggleFileTreeFuzzy}
                aria-pressed={nameSearchMode === "fuzzy"}
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
            </>
          ) : (
            <>
              <button
                type="button"
                className="file-tree-search-toggle is-text-option"
                data-tooltip={labels.matchCase}
                aria-label={labels.matchCase}
                aria-pressed={matchCase}
                onClick={onToggleMatchCase}
              >
                Aa
              </button>
              <button
                type="button"
                className="file-tree-search-toggle is-text-option"
                data-tooltip={labels.matchWholeWord}
                aria-label={labels.matchWholeWord}
                aria-pressed={wholeWord}
                onClick={onToggleWholeWord}
              >
                ab
              </button>
              <button
                type="button"
                className="file-tree-search-toggle is-text-option"
                data-tooltip={labels.useRegularExpression}
                aria-label={labels.useRegularExpression}
                aria-pressed={regex}
                onClick={onToggleRegex}
              >
                .*
              </button>
            </>
          )}
          <button
            type="button"
            className="file-tree-search-icon-button"
            data-tooltip={labels.previousFileTreeMatch}
            aria-label={labels.previousFileTreeMatch}
            disabled={activeNavigationCount === 0}
            onClick={onPrevious}
          >
            <ChevronUp size={14} />
          </button>
          <button
            type="button"
            className="file-tree-search-icon-button"
            data-tooltip={labels.nextFileTreeMatch}
            aria-label={labels.nextFileTreeMatch}
            disabled={activeNavigationCount === 0}
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
  draggingRelativePath,
  dropTargetKey,
  onMoveDragStart,
  onMoveDragOver,
  onMoveDragLeave,
  onMoveDrop,
  onMoveDragEnd,
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
  const hasPendingIndicator = fileTreeNodeShowsPendingIndicator(node, isExpanded);
  const pendingIndicatorClass =
    node.source === "pending-delete" || (node.source === "real" && node.pendingTarget?.kind === "delete_file")
      ? "is-delete"
      : node.source === "pending-create" ||
          node.source === "pending-dir" ||
          (node.source === "real" && node.pendingTarget?.kind === "create_file")
        ? "is-create"
        : "is-edit";
  const canDragContextFile = node.source === "real" && nodeKind === "markdown";
  const canDragImageReference = node.source === "real" && nodeKind === "external" && isImageNode(node.node);
  const canDragMove = node.source === "real" && !node.pendingTarget && !node.hasPendingDescendant;
  const isDragging = node.source === "real" && draggingRelativePath === normalizeDisplayRelativePath(node.node.relativePath);
  const rowDropTargetKey =
    node.source === "real" && node.node.kind === "directory"
      ? moveDropTargetKey({ kind: "folder", relativePath: node.node.relativePath })
      : null;
  const isDropTarget = Boolean(rowDropTargetKey && dropTargetKey === rowDropTargetKey);
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
    node.source === "pending-create" || (node.source === "real" && node.pendingTarget?.kind === "create_file")
      ? "is-pending-create"
      : "",
    node.source === "pending-delete" ? "is-pending-delete" : "",
    node.source === "pending-dir" ? "is-pending-dir" : "",
    hasPendingIndicator ? "has-pending-indicator" : "",
    isActive ? "is-active" : "",
    isSelected ? "is-selected" : "",
    isSearchActiveMatch ? "is-search-active-match" : "",
    isDragging ? "is-dragging" : "",
    isDropTarget ? "is-drop-target" : "",
    isRenaming ? "is-renaming" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <div
        ref={(element) => registerRow(nodePath, element)}
        className={rowClassName}
        draggable={canDragContextFile || canDragImageReference || canDragMove}
        style={{ "--tree-depth": depth } as CSSProperties}
        onDragStart={(event) => {
          if (node.source !== "real" || (!canDragContextFile && !canDragImageReference && !canDragMove)) {
            event.preventDefault();
            return;
          }

          event.dataTransfer.effectAllowed =
            (canDragContextFile || canDragImageReference) && canDragMove ? "copyMove" : canDragMove ? "move" : "copy";

          if (canDragContextFile) {
            event.dataTransfer.setData(
              contextFileDragMimeType,
              JSON.stringify(createContextFileDragPayload(workspaceSessionId, node.node.relativePath))
            );
          }

          if (canDragImageReference) {
            const payload = createImageReferenceDragPayload(workspaceSessionId, node.node.relativePath);

            if (payload) {
              event.dataTransfer.setData(imageReferenceDragMimeType, JSON.stringify(payload));
            }
          }

          if (canDragMove) {
            onMoveDragStart(node.node, event);
          }
        }}
        onDragOver={(event) => {
          if (node.source === "real" && node.node.kind === "directory") {
            onMoveDragOver({ kind: "folder", relativePath: node.node.relativePath }, event, nodePath);
          }
        }}
        onDragLeave={(event) => {
          if (rowDropTargetKey) {
            onMoveDragLeave(rowDropTargetKey, event);
          }
        }}
        onDrop={(event) => {
          if (node.source === "real" && node.node.kind === "directory") {
            onMoveDrop({ kind: "folder", relativePath: node.node.relativePath }, event);
          }
        }}
        onDragEnd={(event) => {
          if (canDragMove) {
            onMoveDragEnd(event);
          }
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
              aria-label={pendingTitle ?? undefined}
              aria-describedby={pathDescriptionId}
              aria-current={isSearchActiveMatch ? "true" : undefined}
              onBlur={() => onHidePathPeek(fullRelativePath)}
              onFocus={(event) => onShowPathPeek(fullRelativePath, event.currentTarget, { delayMs: 350 })}
              onKeyDown={onSearchRowKeyDown}
              onClick={() => {
                if (node.source === "pending-create" || node.source === "pending-delete") {
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
              draggingRelativePath={draggingRelativePath}
              dropTargetKey={dropTargetKey}
              onMoveDragStart={onMoveDragStart}
              onMoveDragOver={onMoveDragOver}
              onMoveDragLeave={onMoveDragLeave}
              onMoveDrop={onMoveDrop}
              onMoveDragEnd={onMoveDragEnd}
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

function isTreeBackgroundTarget(target: EventTarget | null, currentTarget: HTMLElement) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target === currentTarget) {
    return true;
  }

  if (!currentTarget.contains(target)) {
    return false;
  }

  return !target.closest(
    [
      ".tree-item",
      ".content-search-row",
      ".content-search-preview-row",
      ".content-search-more-row",
      ".tree-rename-form",
      "button",
      "input",
      "textarea",
      "select",
      "[role='button']",
      "[role='menu']",
      "[role='menuitem']"
    ].join(",")
  );
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
  pendingReviewCount,
  pendingReviewActive = false,
  pendingReviewBusy = false,
  creatingFile,
  creatingFolder,
  labels,
  updateLabels,
  updateStatus,
  updateChecking,
  renamingPath,
  revealPath,
  onRevealComplete,
  onRevealFailed,
  onOpenNode,
  onOpenPendingChange,
  onCreateFile,
  onCreateFolder,
  onOpenFolder,
  onOpenRecent,
  onRevealWorkspace,
  onCheckForUpdates,
  onDownloadUpdate,
  onViewUpdateRelease,
  onSelectNode,
  onSelectWorkspaceRoot,
  onAcceptPendingChanges,
  onRejectPendingChanges,
  onMoveNode,
  onShowContextMenu,
  contextMenuOpen = false,
  onCloseContextMenu,
  onCancelRename,
  onCommitRename,
  contentSearchProvider
}: FileTreeProps) {
  const [durableExpanded, setDurableExpanded] = useState<Set<string>>(new Set());
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchScope, setSearchScope] = useState<FileTreeSearchScope>("text");
  const [searchQuery, setSearchQuery] = useState("");
  const [nameSearchMode, setNameSearchMode] = useState<FileTreeSearchMode>("fuzzy");
  const [searchFilter, setSearchFilter] = useState(false);
  const [activeMatchIndex, setActiveMatchIndex] = useState(-1);
  const [activeContentMatchIndex, setActiveContentMatchIndex] = useState(-1);
  const [contentMatchCase, setContentMatchCase] = useState(false);
  const [contentWholeWord, setContentWholeWord] = useState(false);
  const [contentRegex, setContentRegex] = useState(false);
  const [contentSearchStatus, setContentSearchStatus] = useState<
    "idle" | "searching" | "ready" | "invalid_regex" | "error"
  >("idle");
  const [contentSearchResponse, setContentSearchResponse] = useState<MarkdownContentSearchResponse | null>(null);
  const [contentSearchResponseKey, setContentSearchResponseKey] = useState<string | null>(null);
  const [contentSearchUsesSavedFallback, setContentSearchUsesSavedFallback] = useState(false);
  const [contentExpandedIds, setContentExpandedIds] = useState<Set<string>>(() => new Set());
  const [pathPeek, setPathPeek] = useState<TreePathPeek | null>(null);
  const [draggingMoveRelativePath, setDraggingMoveRelativePath] = useState<string | null>(null);
  const [moveDropTargetKeyState, setMoveDropTargetKeyState] = useState<string | null>(null);
  const [moveStatusText, setMoveStatusText] = useState("");
  const pathPeekTimerRef = useRef<number | null>(null);
  const dragExpandTimerRef = useRef<number | null>(null);
  const draggingMoveRelativePathRef = useRef<string | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const rowButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const contentPreviewRowRefs = useRef(new Map<string, HTMLButtonElement>());
  const contentSearchRequestIdRef = useRef(0);
  const searchButtonRef = useRef<HTMLButtonElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchReturnFocusRef = useRef<HTMLElement | null>(null);
  const generatedId = useId();
  const treeListId = `${generatedId}-file-tree`;
  const searchInputId = `${generatedId}-file-tree-search-input`;
  const searchStatusId = `${generatedId}-file-tree-search-status`;
  const displayNodes = useMemo(() => buildFileTreeDisplayNodes(nodes, pendingChanges), [nodes, pendingChanges]);
  const hasPendingReview = pendingReviewCount > 0;
  const pendingCreateRelativePaths = useMemo(
    () =>
      new Set(
        pendingChanges
          .filter((change) => change.kind === "create_file")
          .map((change) => normalizeDisplayRelativePath(change.normalizedRelativePath))
      ),
    [pendingChanges]
  );
  const blockedMoveRelativePaths = useMemo(() => collectBlockedMoveRelativePaths(displayNodes), [displayNodes]);
  const selectedTreeNode = useMemo(
    () => (selectedPath && selectedPath !== workspace.path ? findNode(nodes, selectedPath) : null),
    [nodes, selectedPath, workspace.path]
  );
  const creationTargetLabel = useMemo(() => {
    if (selectedPath === workspace.path) {
      return labels.workspaceRoot;
    }

    if (selectedTreeNode?.kind === "directory") {
      return selectedTreeNode.name;
    }

    if (selectedTreeNode) {
      const parentNode = findNode(nodes, parentPathFromAbsolutePath(selectedTreeNode.path));
      return parentNode?.name ?? labels.workspaceRoot;
    }

    if (activePath) {
      const parentNode = findNode(nodes, parentPathFromAbsolutePath(activePath));
      return parentNode?.name ?? labels.workspaceRoot;
    }

    return labels.workspaceRoot;
  }, [activePath, labels.workspaceRoot, nodes, selectedPath, selectedTreeNode, workspace.path]);
  const newDocumentLabel = creationTargetLabel ? labels.newDocumentIn(creationTargetLabel) : labels.newDocument;
  const newFolderLabel = creationTargetLabel ? labels.newFolderIn(creationTargetLabel) : labels.newFolder;
  const searchResult = useMemo(
    () => searchFileTreeDisplayNodes(displayNodes, searchQuery, nameSearchMode),
    [displayNodes, nameSearchMode, searchQuery]
  );
  const hasNameSearchQuery = searchOpen && searchScope === "names" && Boolean(searchResult.normalizedQuery);
  const contentHasQuery = searchOpen && searchScope === "text" && searchQuery.trim().length > 0;
  const contentRegexValidation = useMemo(
    () => validateContentSearchRegex(searchQuery, contentRegex, contentWholeWord),
    [contentRegex, contentWholeWord, searchQuery]
  );
  const currentContentSearchKey = useMemo(
    () =>
      contentSearchRequestKey({
        query: searchQuery,
        matchCase: contentMatchCase,
        wholeWord: contentWholeWord,
        regex: contentRegex
      }),
    [contentMatchCase, contentRegex, contentWholeWord, searchQuery]
  );
  const visibleContentSearchResponse = contentSearchResponseMatchesCurrent(
    contentSearchResponseKey,
    currentContentSearchKey
  )
    ? contentSearchResponse
    : null;
  const activeMatchIndexSafe = clampFileTreeSearchActiveIndex(activeMatchIndex, searchResult.matches.length);
  const activeMatch = hasNameSearchQuery && activeMatchIndexSafe >= 0 ? searchResult.matches[activeMatchIndexSafe] : null;
  const activeSearchMatchId = activeMatch?.id ?? null;
  const renderedNodes = useMemo(
    () =>
      hasNameSearchQuery && searchFilter
        ? filterFileTreeDisplayNodesForSearch(displayNodes, searchResult)
        : displayNodes,
    [displayNodes, hasNameSearchQuery, searchFilter, searchResult]
  );
  const contentResultTree = useMemo(
    () => (visibleContentSearchResponse ? buildFileTreeContentResultTree(visibleContentSearchResponse.files) : []),
    [visibleContentSearchResponse]
  );
  const contentFlatMatches = useMemo(
    () => flattenContentSearchPreviewRows(contentResultTree, contentExpandedIds),
    [contentExpandedIds, contentResultTree]
  );
  const activeContentMatchIndexSafe = clampContentSearchActiveIndex(activeContentMatchIndex, contentFlatMatches.length);
  const activeContentMatch =
    contentHasQuery && activeContentMatchIndexSafe >= 0 ? contentFlatMatches[activeContentMatchIndexSafe] : null;
  const activeContentRowId = activeContentMatch?.rowId ?? null;
  const showContentResults =
    contentHasQuery &&
    visibleContentSearchResponse !== null &&
    visibleContentSearchResponse.files.length > 0;
  const showContentNoMatches =
    contentHasQuery &&
    contentSearchStatus === "ready" &&
    visibleContentSearchResponse !== null &&
    visibleContentSearchResponse.files.length === 0 &&
    contentRegexValidation.valid;
  const contentEmptyStateText =
    contentSearchStatus === "searching"
      ? labels.contentSearchSearching
      : contentSearchStatus === "error"
        ? labels.contentSearchFailed
        : !contentRegexValidation.valid || contentSearchStatus === "invalid_regex"
          ? labels.contentSearchInvalidRegex
          : "";
  const contentStatusText = useMemo(() => {
    if (!contentHasQuery) {
      return "";
    }

    if (!contentRegexValidation.valid || contentSearchStatus === "invalid_regex") {
      return labels.contentSearchInvalidRegex;
    }

    if (contentSearchStatus === "searching") {
      return labels.contentSearchSearching;
    }

    if (contentSearchStatus === "error") {
      return labels.contentSearchFailed;
    }

    if (contentSearchUsesSavedFallback) {
      return labels.contentSearchUsesSavedText;
    }

    if (!visibleContentSearchResponse) {
      return "";
    }

    if (visibleContentSearchResponse.truncated && visibleContentSearchResponse.returnedMatches > 0) {
      return labels.contentSearchTruncated(visibleContentSearchResponse.returnedMatches);
    }

    if (visibleContentSearchResponse.returnedMatches === 0) {
      return labels.contentSearchNoMatches;
    }

    return labels.contentSearchCount(
      visibleContentSearchResponse.returnedMatches,
      visibleContentSearchResponse.returnedFiles
    );
  }, [
    contentHasQuery,
    contentRegexValidation.valid,
    contentSearchStatus,
    contentSearchUsesSavedFallback,
    labels,
    visibleContentSearchResponse
  ]);
  const contentLiveText = useMemo(() => {
    const details = [contentStatusText].filter(Boolean);

    if (contentSearchUsesSavedFallback && contentStatusText !== labels.contentSearchUsesSavedText) {
      details.push(labels.contentSearchUsesSavedText);
    }

    if (visibleContentSearchResponse?.truncated) {
      details.push(labels.contentSearchTruncated(visibleContentSearchResponse.returnedMatches));
    }

    if (visibleContentSearchResponse && visibleContentSearchResponse.skippedOversizedFiles > 0) {
      details.push(labels.contentSearchSkippedOversized(visibleContentSearchResponse.skippedOversizedFiles));
    }

    return details.join(". ");
  }, [contentSearchUsesSavedFallback, contentStatusText, labels, visibleContentSearchResponse]);
  const contentRowIndexById = useMemo(
    () => new Map(contentFlatMatches.map((match, index) => [match.rowId, index])),
    [contentFlatMatches]
  );
  const searchForcedExpanded = useMemo(() => {
    const forcedExpanded = new Set<string>();

    if (hasNameSearchQuery && searchFilter) {
      for (const path of searchResult.filterAncestorPaths) {
        forcedExpanded.add(path);
      }
    }

    if (hasNameSearchQuery) {
      for (const path of activeMatch?.ancestorPaths ?? []) {
        forcedExpanded.add(path);
      }
    }

    return forcedExpanded;
  }, [activeMatch, hasNameSearchQuery, searchFilter, searchResult.filterAncestorPaths]);
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
    setSearchScope("text");
    setSearchQuery("");
    setNameSearchMode("fuzzy");
    setSearchFilter(false);
    setActiveMatchIndex(-1);
    setActiveContentMatchIndex(-1);
    setContentSearchStatus("idle");
    setContentSearchResponse(null);
    setContentSearchResponseKey(null);
    setContentSearchUsesSavedFallback(false);
    setContentExpandedIds(new Set());
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

    setActiveContentMatchIndex((current) => clampContentSearchActiveIndex(current, contentFlatMatches.length));
  }, [contentFlatMatches.length, searchOpen]);

  useEffect(() => {
    setContentExpandedIds(expandedContentSearchIds(contentResultTree));
    setActiveContentMatchIndex(-1);
  }, [contentResultTree]);

  useEffect(() => {
    const requestId = contentSearchRequestIdRef.current + 1;
    contentSearchRequestIdRef.current = requestId;
    contentSearchProvider?.markLatestRequest(requestId);

    if (!contentHasQuery) {
      setContentSearchStatus("idle");
      setContentSearchUsesSavedFallback(false);
      setActiveContentMatchIndex(-1);
      return;
    }

    if (!contentRegexValidation.valid) {
      setContentSearchStatus("invalid_regex");
      setContentSearchUsesSavedFallback(false);
      setActiveContentMatchIndex(-1);
      return;
    }

    if (!contentSearchProvider) {
      setContentSearchStatus("error");
      setContentSearchUsesSavedFallback(false);
      return;
    }

    setContentSearchStatus("idle");
    setContentSearchUsesSavedFallback(false);
    setActiveContentMatchIndex(-1);

    const searchingTimer = window.setTimeout(() => {
      if (isLatestContentSearchRequest(requestId, contentSearchRequestIdRef.current)) {
        setContentSearchStatus("searching");
      }
    }, 120);

    const debounceTimer = window.setTimeout(() => {
      if (!isLatestContentSearchRequest(requestId, contentSearchRequestIdRef.current)) {
        return;
      }

      setContentSearchStatus("searching");

      void contentSearchProvider
        .search(requestId, {
          query: searchQuery,
          matchCase: contentMatchCase,
          wholeWord: contentWholeWord,
          regex: contentRegex
        })
        .then(({ response, usedSavedTextFallback }) => {
          if (!isLatestContentSearchRequest(requestId, contentSearchRequestIdRef.current)) {
            return;
          }

          if (response.status === "invalid_regex") {
            setContentSearchStatus("invalid_regex");
            setContentSearchUsesSavedFallback(false);
            return;
          }

          setContentSearchResponse(response);
          setContentSearchResponseKey(currentContentSearchKey);
          setContentSearchUsesSavedFallback(usedSavedTextFallback);
          setContentSearchStatus("ready");
          setActiveContentMatchIndex(response.returnedMatches > 0 ? 0 : -1);
        })
        .catch(() => {
          if (!isLatestContentSearchRequest(requestId, contentSearchRequestIdRef.current)) {
            return;
          }

          setContentSearchStatus("error");
          setContentSearchUsesSavedFallback(false);
        });
    }, 200);

    return () => {
      window.clearTimeout(searchingTimer);
      window.clearTimeout(debounceTimer);
    };
  }, [
    contentHasQuery,
    contentMatchCase,
    contentRegex,
    contentRegexValidation.valid,
    contentSearchProvider,
    contentWholeWord,
    currentContentSearchKey,
    searchQuery
  ]);

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
    if (!activeContentRowId) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      contentPreviewRowRefs.current.get(activeContentRowId)?.scrollIntoView({ block: "nearest" });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [activeContentRowId]);

  useEffect(() => {
    if (renamingPath && searchOpen) {
      setSearchOpen(false);
      setActiveMatchIndex(-1);
      setActiveContentMatchIndex(-1);
    }
  }, [renamingPath, searchOpen]);

  useEffect(() => {
    if (!revealPath) {
      return;
    }

    const ancestorPaths = fileTreeRevealAncestorPaths(displayNodes, revealPath);

    if (!ancestorPaths) {
      onRevealFailed?.(revealPath, "missing_ancestors");
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
        onRevealFailed?.(revealPath, "missing_row");
        return;
      }

      row.scrollIntoView({ block: "center" });
      onRevealComplete?.(revealPath);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [displayNodes, onRevealComplete, onRevealFailed, revealPath]);

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

  const registerContentPreviewRow = useCallback((rowId: string, element: HTMLButtonElement | null) => {
    if (element) {
      contentPreviewRowRefs.current.set(rowId, element);
    } else {
      contentPreviewRowRefs.current.delete(rowId);
    }
  }, []);

  const clearPathPeekTimer = useCallback(() => {
    if (pathPeekTimerRef.current !== null) {
      window.clearTimeout(pathPeekTimerRef.current);
      pathPeekTimerRef.current = null;
    }
  }, []);

  useEffect(() => clearPathPeekTimer, [clearPathPeekTimer]);

  const clearDragExpandTimer = useCallback(() => {
    if (dragExpandTimerRef.current !== null) {
      window.clearTimeout(dragExpandTimerRef.current);
      dragExpandTimerRef.current = null;
    }
  }, []);

  useEffect(() => clearDragExpandTimer, [clearDragExpandTimer]);

  const showPathPeek = useCallback((path: string, element: HTMLElement, options: TreePathPeekOptions = {}) => {
    clearPathPeekTimer();

    if (!path) {
      return;
    }

    const label = element.querySelector<HTMLElement>(".tree-name-text, .content-search-name");
    const isClipped = label
      ? label.scrollWidth > label.clientWidth + 1
      : element.scrollWidth > element.clientWidth + 1;

    if (!isClipped) {
      setPathPeek((current) => (current?.path === path ? null : current));
      return;
    }

    pathPeekTimerRef.current = window.setTimeout(() => {
      if (!element.isConnected) {
        return;
      }

      const rect = element.getBoundingClientRect();
      const margin = 8;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const maxWidth = Math.max(1, Math.min(520, viewportWidth - margin * 2));
      const left = Math.min(Math.max(margin, rect.left + 22), Math.max(margin, viewportWidth - margin - maxWidth));
      const top = Math.min(Math.max(margin, rect.bottom + 5), Math.max(margin, viewportHeight - margin - 64));

      pathPeekTimerRef.current = null;
      setPathPeek({ path, top, left, maxWidth });
    }, options.delayMs ?? 700);
  }, [clearPathPeekTimer]);

  const hidePathPeek = useCallback((path?: string) => {
    clearPathPeekTimer();
    setPathPeek((current) => {
      if (!current || (path && current.path !== path)) {
        return current;
      }

      return null;
    });
  }, [clearPathPeekTimer]);

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
        setSearchScope("text");
        setActiveContentMatchIndex(-1);
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
      setActiveContentMatchIndex(-1);

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

  const focusContentMatchAtIndex = useCallback(
    (index: number) => {
      const match = contentFlatMatches[index];

      if (!match) {
        return;
      }

      setActiveContentMatchIndex(index);
      const frame = window.requestAnimationFrame(() => {
        contentPreviewRowRefs.current.get(match.rowId)?.focus();
      });

      return () => window.cancelAnimationFrame(frame);
    },
    [contentFlatMatches]
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

  const moveActiveContentMatch = useCallback(
    (direction: 1 | -1, focusRow = false) => {
      const nextIndex = moveContentSearchActiveIndex(
        activeContentMatchIndexSafe,
        contentFlatMatches.length,
        direction
      );

      if (nextIndex < 0) {
        return;
      }

      setActiveContentMatchIndex(nextIndex);

      if (focusRow) {
        const nextRowId = contentFlatMatches[nextIndex]?.rowId;

        if (nextRowId) {
          const frame = window.requestAnimationFrame(() => {
            contentPreviewRowRefs.current.get(nextRowId)?.focus();
          });

          return () => window.cancelAnimationFrame(frame);
        }
      }
    },
    [activeContentMatchIndexSafe, contentFlatMatches]
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
        if (searchScope === "text") {
          moveActiveContentMatch(event.shiftKey ? -1 : 1);
        } else {
          moveActiveMatch(event.shiftKey ? -1 : 1);
        }
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        if (searchScope === "text") {
          focusContentMatchAtIndex(activeContentMatchIndexSafe >= 0 ? activeContentMatchIndexSafe : 0);
        } else {
          focusMatchAtIndex(activeMatchIndexSafe >= 0 ? activeMatchIndexSafe : 0);
        }
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        if (searchScope === "text") {
          const previousContentIndex =
            contentFlatMatches.length === 0
              ? -1
              : activeContentMatchIndexSafe > 0
                ? activeContentMatchIndexSafe - 1
                : contentFlatMatches.length - 1;
          focusContentMatchAtIndex(previousContentIndex);
        } else {
          const previousIndex =
            searchResult.matches.length === 0
              ? -1
              : activeMatchIndexSafe > 0
                ? activeMatchIndexSafe - 1
                : searchResult.matches.length - 1;
          focusMatchAtIndex(previousIndex);
        }
      }
    },
    [
      activeContentMatchIndexSafe,
      activeMatchIndexSafe,
      closeSearch,
      contentFlatMatches.length,
      focusContentMatchAtIndex,
      focusMatchAtIndex,
      moveActiveContentMatch,
      moveActiveMatch,
      searchResult.matches.length,
      searchScope
    ]
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

      if (searchScope !== "names" || !hasNameSearchQuery) {
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
    [focusSearchInput, hasNameSearchQuery, moveActiveMatch, searchOpen, searchScope]
  );

  const handleContentPreviewKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        focusSearchInput();
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        moveActiveContentMatch(1, true);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        moveActiveContentMatch(-1, true);
      }
    },
    [focusSearchInput, moveActiveContentMatch]
  );

  const resolveMoveDrop = useCallback(
    (target: FileTreeMoveDropTarget, sourceRelativePath = draggingMoveRelativePathRef.current) =>
      resolveFileTreeDropTarget({
        nodes,
        sourceRelativePath,
        target,
        blockedRelativePaths: blockedMoveRelativePaths,
        pendingCreateRelativePaths
      }),
    [blockedMoveRelativePaths, nodes, pendingCreateRelativePaths]
  );

  const moveSourceFromDataTransfer = useCallback(
    (dataTransfer: DataTransfer) => {
      const payload = dataTransfer.getData(fileTreeMoveDragMimeType);

      if (!payload) {
        return draggingMoveRelativePathRef.current;
      }

      return readFileTreeMoveDragPayload(payload, workspaceSessionId)?.relativePath ?? null;
    },
    [workspaceSessionId]
  );

  const clearMoveDragState = useCallback(
    (statusText = "") => {
      clearDragExpandTimer();
      draggingMoveRelativePathRef.current = null;
      setDraggingMoveRelativePath(null);
      setMoveDropTargetKeyState(null);
      setMoveStatusText(statusText);
    },
    [clearDragExpandTimer]
  );

  const handleMoveDragStart = useCallback(
    (node: FileTreeNode, event: DragEvent<HTMLDivElement>) => {
      const relativePath = normalizeDisplayRelativePath(node.relativePath);
      const payload = createFileTreeMoveDragPayload(workspaceSessionId, relativePath);

      draggingMoveRelativePathRef.current = payload.relativePath;
      setDraggingMoveRelativePath(payload.relativePath);
      setMoveDropTargetKeyState(null);
      setMoveStatusText(labels.fileTreeMoveStarted(payload.relativePath));
      event.dataTransfer.setData(fileTreeMoveDragMimeType, JSON.stringify(payload));
    },
    [labels, workspaceSessionId]
  );

  const handleMoveDragOver = useCallback(
    (target: FileTreeMoveDropTarget, event: DragEvent<HTMLElement>, expandPath?: string) => {
      const sourceRelativePath = draggingMoveRelativePathRef.current;

      if (!sourceRelativePath && !Array.from(event.dataTransfer.types).includes(fileTreeMoveDragMimeType)) {
        return;
      }

      const result = resolveMoveDrop(target, sourceRelativePath);

      if (!result.valid) {
        event.dataTransfer.dropEffect = "none";
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";

      const targetKey = moveDropTargetKey(target);
      setMoveDropTargetKeyState(targetKey);
      setMoveStatusText(
        target.kind === "root"
          ? labels.fileTreeMoveRootTarget
          : labels.fileTreeMoveTarget(result.targetDirectoryRelativePath)
      );

      clearDragExpandTimer();

      if (expandPath && target.kind === "folder" && !effectiveExpanded.has(expandPath)) {
        dragExpandTimerRef.current = window.setTimeout(() => {
          setDurableExpanded((current) => {
            const next = new Set(current);
            next.add(expandPath);
            return next;
          });
          dragExpandTimerRef.current = null;
        }, 500);
      }
    },
    [clearDragExpandTimer, effectiveExpanded, labels, resolveMoveDrop]
  );

  const handleMoveDragLeave = useCallback((targetKey: string, event: DragEvent<HTMLElement>) => {
    const relatedTarget = event.relatedTarget;

    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) {
      return;
    }

    setMoveDropTargetKeyState((current) => (current === targetKey ? null : current));
  }, []);

  const handleMoveDrop = useCallback(
    (target: FileTreeMoveDropTarget, event: DragEvent<HTMLElement>) => {
      const sourceRelativePath = moveSourceFromDataTransfer(event.dataTransfer);
      const result = resolveMoveDrop(target, sourceRelativePath);

      if (!result.valid) {
        clearMoveDragState(labels.fileTreeMoveFailed);
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      hidePathPeek();
      clearDragExpandTimer();
      draggingMoveRelativePathRef.current = null;
      setDraggingMoveRelativePath(null);
      setMoveDropTargetKeyState(null);

      const targetDirectoryPath = result.targetDirectoryNode?.path ?? workspace.path;

      void onMoveNode(result.sourceNode, targetDirectoryPath).then((movedNode) => {
        clearMoveDragState(
          movedNode ? labels.fileTreeMoveCompleted(movedNode.relativePath) : labels.fileTreeMoveFailed
        );
      });
    },
    [
      clearDragExpandTimer,
      clearMoveDragState,
      hidePathPeek,
      labels,
      moveSourceFromDataTransfer,
      onMoveNode,
      resolveMoveDrop,
      workspace.path
    ]
  );

  const handleMoveDragEnd = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (draggingMoveRelativePathRef.current) {
      clearMoveDragState(event.dataTransfer.dropEffect === "copy" ? "" : labels.fileTreeMoveCanceled);
    }
  }, [clearMoveDragState, labels.fileTreeMoveCanceled]);

  const handleSidebarKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (
        event.key === "Escape" &&
        !searchOpen &&
        !renamingPath &&
        !contextMenuOpen &&
        !isEditableTarget(event.target)
      ) {
        if (sidebarRef.current && sidebarRef.current.contains(document.activeElement)) {
          event.preventDefault();
          event.stopPropagation();
          onSelectWorkspaceRoot();
        }
        return;
      }

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
    [contextMenuOpen, onSelectWorkspaceRoot, openSearch, renamingPath, searchOpen]
  );

  const updateSearchQuery = useCallback(
    (query: string) => {
      onCloseContextMenu?.();
      setSearchQuery(query);
      setActiveMatchIndex(-1);
      setActiveContentMatchIndex(-1);
    },
    [onCloseContextMenu]
  );

  const updateSearchScope = useCallback(
    (scope: FileTreeSearchScope) => {
      onCloseContextMenu?.();
      setSearchScope(scope);
      setActiveMatchIndex(-1);
      setActiveContentMatchIndex(-1);
    },
    [onCloseContextMenu]
  );

  const toggleSearchMode = useCallback(() => {
    onCloseContextMenu?.();
    setNameSearchMode((current) => (current === "fuzzy" ? "continuous" : "fuzzy"));
    setActiveMatchIndex(-1);
  }, [onCloseContextMenu]);

  const toggleSearchFilter = useCallback(() => {
    onCloseContextMenu?.();
    setSearchFilter((current) => !current);
  }, [onCloseContextMenu]);

  const toggleContentExpanded = useCallback((id: string) => {
    setContentExpandedIds((current) => {
      const next = new Set(current);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });
  }, []);

  const openContentMatch = useCallback(
    (match: FileTreeContentMatchTarget) => {
      void contentSearchProvider?.onOpenMatch(match);
    },
    [contentSearchProvider]
  );

  const setContentActiveByRowId = useCallback(
    (rowId: string) => {
      const index = contentRowIndexById.get(rowId);

      if (index !== undefined) {
        setActiveContentMatchIndex(index);
      }
    },
    [contentRowIndexById]
  );

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
  const rootDropTargetKey = moveDropTargetKey({ kind: "root" });
  const treeScrollClassName = [
    "tree-scroll",
    moveDropTargetKeyState === rootDropTargetKey ? "is-root-drop-target" : ""
  ]
    .filter(Boolean)
    .join(" ");

  const handleTreeBackgroundClick = (event: MouseEvent<HTMLDivElement>) => {
    if (searchOpen || !isTreeBackgroundTarget(event.target, event.currentTarget)) {
      return;
    }

    onSelectWorkspaceRoot();
  };

  const handleTreeBackgroundDragOver = (event: DragEvent<HTMLDivElement>) => {
    const isMoveDrag = Array.from(event.dataTransfer.types).includes(fileTreeMoveDragMimeType);

    if (searchOpen) {
      if (isMoveDrag) {
        clearDragExpandTimer();
        setMoveDropTargetKeyState(null);
      }
      return;
    }

    if (isTreeBackgroundTarget(event.target, event.currentTarget)) {
      handleMoveDragOver({ kind: "root" }, event);
      return;
    }

    if (isMoveDrag) {
      clearDragExpandTimer();
      setMoveDropTargetKeyState(null);
    }
  };

  const handleTreeBackgroundDrop = (event: DragEvent<HTMLDivElement>) => {
    if (searchOpen || !isTreeBackgroundTarget(event.target, event.currentTarget)) {
      return;
    }

    handleMoveDrop({ kind: "root" }, event);
  };

  return (
    <aside
      ref={sidebarRef}
      className={[
        "sidebar",
        searchOpen ? "has-file-tree-search" : "",
        hasPendingReview ? "has-pending-review" : ""
      ]
        .filter(Boolean)
        .join(" ")}
      onKeyDown={handleSidebarKeyDown}
    >
      <div className="sidebar-header">
        <WorkspaceMenu
          workspace={workspace}
          recentWorkspaces={recentWorkspaces}
          labels={labels}
          updateLabels={updateLabels}
          updateStatus={updateStatus}
          updateChecking={updateChecking}
          onOpenFolder={onOpenFolder}
          onOpenRecent={onOpenRecent}
          onRevealWorkspace={onRevealWorkspace}
          onCheckForUpdates={onCheckForUpdates}
          onDownloadUpdate={onDownloadUpdate}
          onViewUpdateRelease={onViewUpdateRelease}
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
            data-tooltip={newDocumentLabel}
            aria-label={newDocumentLabel}
            disabled={creatingFile}
            onClick={onCreateFile}
          >
            <FilePlus size={17} />
          </button>
          <button
            type="button"
            className="icon-button"
            data-tooltip={newFolderLabel}
            aria-label={newFolderLabel}
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
          searchScope={searchScope}
          nameSearchMode={nameSearchMode}
          filter={searchFilter}
          nameMatchCount={searchResult.matches.length}
          nameActiveMatchIndex={activeMatchIndexSafe}
          nameActiveMatchPath={activeMatch?.relativePath ?? null}
          textMatchCount={contentFlatMatches.length}
          textStatusText={contentStatusText}
          textLiveText={contentLiveText}
          matchCase={contentMatchCase}
          wholeWord={contentWholeWord}
          regex={contentRegex}
          onQueryChange={updateSearchQuery}
          onClose={() => closeSearch()}
          onClear={() => updateSearchQuery("")}
          onPrevious={() => (searchScope === "text" ? moveActiveContentMatch(-1) : moveActiveMatch(-1))}
          onNext={() => (searchScope === "text" ? moveActiveContentMatch(1) : moveActiveMatch(1))}
          onSearchScopeChange={updateSearchScope}
          onToggleMode={toggleSearchMode}
          onToggleFilter={toggleSearchFilter}
          onToggleMatchCase={() => {
            setContentMatchCase((current) => !current);
            setActiveContentMatchIndex(-1);
          }}
          onToggleWholeWord={() => {
            setContentWholeWord((current) => !current);
            setActiveContentMatchIndex(-1);
          }}
          onToggleRegex={() => {
            setContentRegex((current) => !current);
            setActiveContentMatchIndex(-1);
          }}
          onKeyDown={handleSearchInputKeyDown}
        />
      ) : null}

      <PendingReviewStrip
        count={pendingReviewCount}
        active={pendingReviewActive}
        busy={pendingReviewBusy}
        labels={labels}
        onAccept={onAcceptPendingChanges}
        onReject={onRejectPendingChanges}
      />

      <div
        id={treeListId}
        className={treeScrollClassName}
        onClick={handleTreeBackgroundClick}
        onDragOver={handleTreeBackgroundDragOver}
        onDragLeave={(event) => handleMoveDragLeave(rootDropTargetKey, event)}
        onDrop={handleTreeBackgroundDrop}
        onScroll={() => hidePathPeek()}
      >
        {showContentResults ? (
          <FileTreeContentResults
            nodes={contentResultTree}
            labels={labels}
            activeRowId={activeContentRowId}
            expandedIds={contentExpandedIds}
            flatMatches={contentFlatMatches}
            onToggleExpanded={toggleContentExpanded}
            onOpenMatch={openContentMatch}
            onPreviewFocus={setContentActiveByRowId}
            onPreviewKeyDown={handleContentPreviewKeyDown}
            registerPreviewRow={registerContentPreviewRow}
            onShowPathPeek={showPathPeek}
            onHidePathPeek={hidePathPeek}
          />
        ) : showContentNoMatches ? (
          <div className="empty-tree">{labels.contentSearchNoMatches}</div>
        ) : contentHasQuery ? (
          <div className="empty-tree">{contentEmptyStateText}</div>
        ) : renderedNodes.length > 0 ? (
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
              searchOpen={hasNameSearchQuery}
              onToggle={toggle}
              registerRow={registerRow}
              registerRowButton={registerRowButton}
              onShowPathPeek={showPathPeek}
              onHidePathPeek={hidePathPeek}
              draggingRelativePath={draggingMoveRelativePath}
              dropTargetKey={moveDropTargetKeyState}
              onMoveDragStart={handleMoveDragStart}
              onMoveDragOver={handleMoveDragOver}
              onMoveDragLeave={handleMoveDragLeave}
              onMoveDrop={handleMoveDrop}
              onMoveDragEnd={handleMoveDragEnd}
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
            {hasNameSearchQuery && searchFilter ? labels.fileTreeSearchNoResults : labels.noFiles}
          </div>
        )}
      </div>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {moveStatusText}
      </span>
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
