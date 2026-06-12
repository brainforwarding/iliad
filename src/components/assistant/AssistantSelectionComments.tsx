import { X } from "lucide-react";
import { useEffect, useState } from "react";
import type { AppStrings } from "../../i18n/strings";

export interface AssistantSelectionCommentItem {
  id: string;
  excerpt: string;
  comment: string;
  anchored: boolean;
}

interface AssistantSelectionCommentsChipProps {
  count: number;
  documentName: string;
  /** The open document's path; the expanded list closes on document switch. */
  documentPath: string;
  items: AssistantSelectionCommentItem[];
  labels: AppStrings["assistant"]["selectionComments"];
  /** Initial expanded state (static rendering/tests only; defaults collapsed). */
  initiallyExpanded?: boolean;
  onDiscardItem: (id: string) => void;
  onSelectItem: (id: string) => void;
}

/**
 * The one composer chip for pending selection comments. It is deliberately NOT
 * an AssistantContextAttachmentChip: it must never enter the contextAttachments
 * array (active-file rejection, the 4-attachment limit, dedupe, Backspace
 * removal, and the startRun file-attachment mapping are all wrong for
 * comments). The chip's × opens the list — there is no blind bulk discard.
 *
 * The expanded list is rendered as a SIBLING of the chip span, not a child:
 * chips are `position: relative` (tooltip anchoring), so a nested absolutely
 * positioned list would resolve its offsets against the chip and collapse to a
 * sliver. As a sibling it anchors to `.assistant-composer-control`, exactly
 * like `.assistant-context-picker`.
 */
export function AssistantSelectionCommentsChip({
  count,
  documentName,
  documentPath,
  items,
  labels,
  initiallyExpanded = false,
  onDiscardItem,
  onSelectItem
}: AssistantSelectionCommentsChipProps) {
  const [expanded, setExpanded] = useState(initiallyExpanded);

  useEffect(() => {
    setExpanded(false);
  }, [documentPath]);

  if (count === 0) {
    return null;
  }

  return (
    <>
      <span className="assistant-context-chip assistant-comments-chip">
        <button
          type="button"
          className="assistant-comments-chip-toggle"
          aria-expanded={expanded}
          aria-label={labels.chip(count, documentName)}
          onClick={() => setExpanded((open) => !open)}
        >
          {/* Two spans so the count never truncates; only the document name may ellipsize. */}
          <span className="assistant-comments-chip-count">{labels.disclosure(count)}</span>
          <span className="assistant-comments-chip-doc">{` · ${documentName}`}</span>
        </button>
        <button
          type="button"
          className="assistant-context-chip-remove"
          aria-label={labels.openList}
          onClick={() => setExpanded(true)}
        >
          <X size={12} />
        </button>
      </span>
      {expanded ? (
        <div className="assistant-comments-list" role="list" aria-label={labels.listLabel}>
          {items.map((item) => (
            <div className={`assistant-comments-row${item.anchored ? "" : " is-orphan"}`} role="listitem" key={item.id}>
              <button
                type="button"
                className="assistant-comments-row-main"
                aria-label={labels.scrollTo(item.excerpt)}
                onClick={() => onSelectItem(item.id)}
              >
                <small>{item.anchored ? item.excerpt : `${labels.noAnchor} · ${item.excerpt}`}</small>
                <span>{item.comment}</span>
              </button>
              <button
                type="button"
                className="assistant-comments-row-remove"
                aria-label={labels.discard}
                onClick={() => onDiscardItem(item.id)}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}
