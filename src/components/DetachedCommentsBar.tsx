import { useState } from "react";
import type { SelectionComment } from "../types/iliad";
import type { SelectionCommentsEditorLabels } from "../editor/selectionComments/overlay";

interface DetachedCommentsBarProps {
  comments: SelectionComment[];
  labels: SelectionCommentsEditorLabels;
  onDelete: (id: string) => void;
}

function quotePreview(quote: string) {
  const flat = quote.replace(/\s+/g, " ").trim();
  return flat.length > 90 ? `${flat.slice(0, 87)}…` : flat;
}

/**
 * "N detached comments" (spec V18): comments whose passage is no longer found
 * in the document, listed with their quote and text. Delete only.
 */
export function DetachedCommentsBar({ comments, labels, onDelete }: DetachedCommentsBarProps) {
  const [open, setOpen] = useState(false);
  const title = labels.detached ? labels.detached(comments.length) : `${comments.length}`;

  return (
    <div className="editor-review-toolbar editor-detached-comments" role="status">
      <button
        type="button"
        className="editor-detached-comments__toggle"
        aria-expanded={open}
        title={labels.detachedHint}
        onClick={() => setOpen((value) => !value)}
      >
        {title}
      </button>
      {open ? (
        <ul className="editor-detached-comments__list">
          {comments.map((comment) => (
            <li key={comment.id}>
              <div className="editor-detached-comments__text">
                {comment.quote ? <q>{quotePreview(comment.quote)}</q> : null}
                <span>{comment.comment}</span>
              </div>
              <button type="button" onClick={() => onDelete(comment.id)}>
                {labels.delete}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
