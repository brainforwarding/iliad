import type { RecentDocumentItem } from "../preferences/recentDocuments";

export const NEW_DOCUMENT_SHORTCUT_LABEL = "⌘N";

export interface EditorEmptyStateLabels {
  emptyTitle: string;
  emptyRecentTitle: string;
  emptyRecentLabel: string;
  emptyNewDocument: string;
}

interface EditorEmptyStateProps {
  labels: EditorEmptyStateLabels;
  /** Existing recent documents, already filtered and capped (empty for none). */
  recentDocuments?: RecentDocumentItem[];
  onOpenRecentDocument?: (relativePath: string) => void;
  onCreateDocument?: () => void;
}

/**
 * Empty state G (no document open): a serif line, up to five recent
 * documents as quiet rows, and "New document ⌘N" as a plain link. With no
 * recents only the line and the link show. Presentational: the list and the
 * open action come from App (`useRecentDocuments` + the tree-click open).
 */
export function EditorEmptyState({
  labels,
  recentDocuments = [],
  onOpenRecentDocument,
  onCreateDocument
}: EditorEmptyStateProps) {
  const recents = onOpenRecentDocument ? recentDocuments : [];

  return (
    <div className="editor-empty">
      <div className="editor-empty__column">
        <h1 className="editor-empty__title">{recents.length > 0 ? labels.emptyRecentTitle : labels.emptyTitle}</h1>
        {recents.length > 0 ? (
          <ul className="editor-empty__recents" aria-label={labels.emptyRecentLabel}>
            {recents.map((item) => (
              <li key={item.relativePath}>
                <button
                  type="button"
                  className="editor-empty__recent"
                  title={item.relativePath}
                  onClick={() => onOpenRecentDocument?.(item.relativePath)}
                >
                  <span className="editor-empty__recent-name">{item.name}</span>
                  {item.folder ? <span className="editor-empty__recent-folder">{item.folder}</span> : null}
                  <span className="editor-empty__recent-day">{item.dayLabel}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {onCreateDocument ? (
          <button
            type="button"
            className="editor-empty__new"
            aria-keyshortcuts="Meta+N"
            onClick={onCreateDocument}
          >
            <span>{labels.emptyNewDocument}</span>
            <span className="editor-empty__shortcut" aria-hidden="true">
              {NEW_DOCUMENT_SHORTCUT_LABEL}
            </span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
