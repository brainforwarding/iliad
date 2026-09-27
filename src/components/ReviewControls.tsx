import { ChevronDown, ChevronUp } from "lucide-react";
import { hunkNavigationAvailable } from "../editor/aiReview/navigation";
import type { EditorReviewState } from "../editor/aiReview/types";
import { Icon } from "./Icon";

interface ReviewControlsProps {
  review: EditorReviewState;
  /** edit_file only: the review no longer matches the document (or the file is stale). */
  stale: boolean;
  /** edit_file only: unresolved hunks on display. */
  hunkCount: number;
  onPrevious: () => void;
  onNext: () => void;
}

/**
 * The document's outside-review controls, shown on the right of the window's
 * top row (EditorPane portals them there): "{n} changes · ↑ ↓ · Keep all ·
 * Restore all", the stale label with Restore all, or the create/delete
 * decision. Same handlers and disabled rules as the old band above the text.
 */
export function ReviewControls({ review, stale, hunkCount, onPrevious, onNext }: ReviewControlsProps) {
  if (review.mode === "edit_file") {
    const navigable = hunkNavigationAvailable({ stale, hunkCount });

    return (
      <div className="review-controls" role="group" aria-label={review.file.relativePath}>
        <span className="review-controls__count">{stale ? review.labels.stale : review.labels.changes(hunkCount)}</span>
        {stale ? null : (
          <>
            <span className="review-controls__nav">
              <button
                type="button"
                className="icon-button review-controls__arrow"
                data-tooltip={review.labels.previous}
                aria-label={review.labels.previous}
                disabled={!navigable}
                onClick={onPrevious}
              >
                <Icon icon={ChevronUp} />
              </button>
              <button
                type="button"
                className="icon-button review-controls__arrow"
                data-tooltip={review.labels.next}
                aria-label={review.labels.next}
                disabled={!navigable}
                onClick={onNext}
              >
                <Icon icon={ChevronDown} />
              </button>
            </span>
            <button
              type="button"
              className="review-controls__button is-primary"
              disabled={review.actionBusy || hunkCount === 0}
              onClick={review.onAcceptFile}
            >
              {review.labels.acceptAll}
            </button>
          </>
        )}
        <button type="button" className="review-controls__button" disabled={review.actionBusy} onClick={review.onRejectFile}>
          {review.labels.rejectAll}
        </button>
      </div>
    );
  }

  const decision =
    review.mode === "create_file"
      ? { label: review.labels.pendingDocument(review.file.relativePath), accept: review.labels.create, discard: review.labels.discard }
      : {
          label: review.labels.pendingDeleteDocument(review.file.relativePath),
          accept: review.labels.delete,
          discard: review.labels.discard
        };

  return (
    <div
      className="review-controls"
      role="group"
      aria-label={decision.label}
    >
      <button type="button" className="review-controls__button is-primary" disabled={review.actionBusy} onClick={review.onAcceptFile}>
        {decision.accept}
      </button>
      <button type="button" className="review-controls__button" disabled={review.actionBusy} onClick={review.onRejectFile}>
        {decision.discard}
      </button>
    </div>
  );
}
