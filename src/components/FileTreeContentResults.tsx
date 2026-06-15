import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen } from "lucide-react";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import {
  contentSearchFileRows,
  contentSearchPreviewSnippet,
  contentSearchSnippetParts,
  type FileTreeContentFileNode,
  type FileTreeContentFlatMatch,
  type FileTreeContentFolderNode,
  type FileTreeContentMatchTarget,
  type FileTreeContentTreeNode
} from "../assistant/fileTreeContentSearch";

interface FileTreeContentResultsLabels {
  contentSearchCount: (matches: number, files: number) => string;
  contentSearchMoreInFile: (count: number) => string;
  contentSearchMatchAria: (path: string, line: number, current: number, total: number) => string;
  fileTreeDescendantMatches: (count: number) => string;
}

interface FileTreeContentResultsProps {
  nodes: FileTreeContentTreeNode[];
  labels: FileTreeContentResultsLabels;
  activeRowId: string | null;
  expandedIds: ReadonlySet<string>;
  flatMatches: FileTreeContentFlatMatch[];
  onToggleExpanded: (id: string) => void;
  onOpenMatch: (match: FileTreeContentMatchTarget) => void | Promise<void>;
  onPreviewFocus: (rowId: string) => void;
  onPreviewKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  registerPreviewRow: (rowId: string, element: HTMLButtonElement | null) => void;
  onShowPathPeek: (path: string, element: HTMLElement) => void;
  onHidePathPeek: (path?: string) => void;
}

function targetForMatch(row: Pick<FileTreeContentFlatMatch, "file" | "match">): FileTreeContentMatchTarget {
  return {
    filePath: row.file.filePath,
    relativePath: row.file.relativePath,
    startOffset: row.match.startOffset,
    endOffset: row.match.endOffset,
    startColumn: row.match.startColumn,
    endColumn: row.match.endColumn,
    lineNumber: row.match.lineNumber,
    matchedText: row.match.matchedText
  };
}

function depthStyle(depth: number) {
  return { "--content-depth": Math.min(depth, 4) } as CSSProperties;
}

function renderSnippet(lineText: string, ranges: FileTreeContentFlatMatch["match"]["ranges"]) {
  const parts: ReactNode[] = [];
  const snippet = contentSearchPreviewSnippet(lineText, ranges);

  contentSearchSnippetParts(snippet.lineText, snippet.ranges).forEach((part, index) => {
    if (!part.highlighted) {
      parts.push(part.text);
      return;
    }

    parts.push(
      <mark key={`${part.text}:${index}`} className="content-search-mark">
        {part.text}
      </mark>
    );
  });

  return parts;
}

function ContentFolderRow({
  node,
  depth,
  labels,
  expanded,
  onToggleExpanded
}: {
  node: FileTreeContentFolderNode;
  depth: number;
  labels: FileTreeContentResultsLabels;
  expanded: boolean;
  onToggleExpanded: (id: string) => void;
}) {
  return (
    <div className="content-search-row is-folder" style={depthStyle(depth)}>
      <button
        type="button"
        className="content-search-disclosure"
        aria-expanded={expanded}
        aria-label={node.relativePath}
        onClick={() => onToggleExpanded(node.id)}
      >
        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </button>
      <button
        type="button"
        className="content-search-folder-button"
        aria-expanded={expanded}
        aria-label={`${node.relativePath}. ${labels.fileTreeDescendantMatches(node.matchCount)}`}
        onClick={() => onToggleExpanded(node.id)}
      >
        <span className="content-search-icon" aria-hidden="true">
          {expanded ? <FolderOpen size={15} /> : <Folder size={15} />}
        </span>
        <span className="content-search-name">{node.name}</span>
        <span className="content-search-count-badge" title={labels.fileTreeDescendantMatches(node.matchCount)}>
          {node.matchCount}
        </span>
      </button>
    </div>
  );
}

function ContentFileRow({
  node,
  depth,
  labels,
  expanded,
  onToggleExpanded,
  onOpenMatch,
  onShowPathPeek,
  onHidePathPeek
}: {
  node: FileTreeContentFileNode;
  depth: number;
  labels: FileTreeContentResultsLabels;
  expanded: boolean;
  onToggleExpanded: (id: string) => void;
  onOpenMatch: (match: FileTreeContentMatchTarget) => void | Promise<void>;
  onShowPathPeek: (path: string, element: HTMLElement) => void;
  onHidePathPeek: (path?: string) => void;
}) {
  const firstMatch = node.file.matches[0];

  return (
    <div
      className="content-search-row is-file"
      style={depthStyle(depth)}
      onPointerEnter={(event) => onShowPathPeek(node.file.relativePath, event.currentTarget)}
      onPointerLeave={() => onHidePathPeek(node.file.relativePath)}
    >
      <button
        type="button"
        className="content-search-disclosure"
        aria-expanded={expanded}
        aria-label={node.file.relativePath}
        onClick={() => onToggleExpanded(node.id)}
      >
        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </button>
      <button
        type="button"
        className="content-search-file-button"
        title={node.file.relativePath}
        aria-label={`${node.file.relativePath}. ${labels.contentSearchCount(node.matchCount, 1)}`}
        onFocus={(event) => onShowPathPeek(node.file.relativePath, event.currentTarget)}
        onBlur={() => onHidePathPeek(node.file.relativePath)}
        onClick={() => {
          if (firstMatch) {
            void onOpenMatch(targetForMatch({ file: node.file, match: firstMatch }));
          }
        }}
      >
        <span className="content-search-icon" aria-hidden="true">
          <FileText size={15} strokeWidth={1.5} />
        </span>
        <span className="content-search-name">{node.displayName}</span>
        <span className="content-search-count-badge" title={labels.contentSearchCount(node.matchCount, 1)}>
          {node.matchCount}
        </span>
      </button>
    </div>
  );
}

function ContentFileChildren({
  node,
  depth,
  labels,
  activeRowId,
  flatMatches,
  onOpenMatch,
  onPreviewFocus,
  onPreviewKeyDown,
  registerPreviewRow
}: {
  node: FileTreeContentFileNode;
  depth: number;
  labels: FileTreeContentResultsLabels;
  activeRowId: string | null;
  flatMatches: FileTreeContentFlatMatch[];
  onOpenMatch: (match: FileTreeContentMatchTarget) => void | Promise<void>;
  onPreviewFocus: (rowId: string) => void;
  onPreviewKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  registerPreviewRow: (rowId: string, element: HTMLButtonElement | null) => void;
}) {
  const orderByRowId = new Map(flatMatches.map((match, index) => [match.rowId, index + 1]));

  return (
    <>
      {contentSearchFileRows(node.file).map((row) => {
        if (row.kind === "more") {
          return (
            <div
              key={row.id}
              className="content-search-more-row"
              style={depthStyle(depth + 1)}
              aria-hidden="true"
            >
              {labels.contentSearchMoreInFile(row.count)}
            </div>
          );
        }

        const current = orderByRowId.get(row.id) ?? 1;
        const isActive = activeRowId === row.id;

        return (
          <button
            key={row.id}
            ref={(element) => registerPreviewRow(row.id, element)}
            type="button"
            className={isActive ? "content-search-preview-row is-active-match" : "content-search-preview-row"}
            style={depthStyle(depth + 1)}
            aria-current={isActive ? "true" : undefined}
            aria-label={labels.contentSearchMatchAria(row.file.relativePath, row.match.lineNumber, current, flatMatches.length)}
            onFocus={() => onPreviewFocus(row.id)}
            onKeyDown={onPreviewKeyDown}
            onClick={() => void onOpenMatch(targetForMatch(row))}
          >
            <span className="content-search-line-number">{row.match.lineNumber}</span>
            <span className="content-search-snippet">{renderSnippet(row.match.lineText, row.match.ranges)}</span>
          </button>
        );
      })}
    </>
  );
}

export function FileTreeContentResults({
  nodes,
  labels,
  activeRowId,
  expandedIds,
  flatMatches,
  onToggleExpanded,
  onOpenMatch,
  onPreviewFocus,
  onPreviewKeyDown,
  registerPreviewRow,
  onShowPathPeek,
  onHidePathPeek
}: FileTreeContentResultsProps) {
  const renderNode = (node: FileTreeContentTreeNode, depth: number): ReactNode => {
    const expanded = expandedIds.has(node.id);

    if (node.kind === "folder") {
      return (
        <div key={node.id}>
          <ContentFolderRow
            node={node}
            depth={depth}
            labels={labels}
            expanded={expanded}
            onToggleExpanded={onToggleExpanded}
          />
          {expanded ? node.children.map((child) => renderNode(child, depth + 1)) : null}
        </div>
      );
    }

    return (
      <div key={node.id}>
        <ContentFileRow
          node={node}
          depth={depth}
          labels={labels}
          expanded={expanded}
          onToggleExpanded={onToggleExpanded}
          onOpenMatch={onOpenMatch}
          onShowPathPeek={onShowPathPeek}
          onHidePathPeek={onHidePathPeek}
        />
        {expanded ? (
          <ContentFileChildren
            node={node}
            depth={depth}
            labels={labels}
            activeRowId={activeRowId}
            flatMatches={flatMatches}
            onOpenMatch={onOpenMatch}
            onPreviewFocus={onPreviewFocus}
            onPreviewKeyDown={onPreviewKeyDown}
            registerPreviewRow={registerPreviewRow}
          />
        ) : null}
      </div>
    );
  };

  return <div className="content-search-results">{nodes.map((node) => renderNode(node, 0))}</div>;
}
