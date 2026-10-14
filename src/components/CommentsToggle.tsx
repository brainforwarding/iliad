import { MessageSquare } from "lucide-react";
import type { AppStrings } from "../i18n/strings";
import { Icon } from "./Icon";

export const COMMENTS_MARGIN_SHORTCUT_LABEL = "⌃⌘M";

/** ⌃⌘M (spec 2026-10-14). Reserved in the custom-shortcut validator too. */
export function isCommentsMarginShortcut(event: KeyboardEvent) {
  return event.metaKey && event.ctrlKey && !event.shiftKey && !event.altKey && (event.key === "m" || event.key === "M");
}

interface CommentsToggleProps {
  count: number;
  shown: boolean;
  /** False when the editor is too narrow for the margin. */
  fits: boolean;
  labels: AppStrings["topbar"]["comments"];
  onToggle: () => void;
}

/** Top-bar toggle for comments in the right margin: icon, "Comments", count. */
export function CommentsToggle({ count, shown, fits, labels, onToggle }: CommentsToggleProps) {
  const tooltip = shown && !fits ? labels.tooNarrow : shown ? labels.hide : labels.show;

  return (
    <button
      type="button"
      className="comments-toggle"
      aria-pressed={shown}
      aria-label={`${labels.label} (${count})`}
      data-tooltip={tooltip}
      data-tooltip-shortcut={COMMENTS_MARGIN_SHORTCUT_LABEL}
      onClick={onToggle}
    >
      <Icon icon={MessageSquare} />
      <span>{labels.label}</span>
      <span className="comments-toggle__count">{count}</span>
    </button>
  );
}
