import { X } from "lucide-react";
import type { CSSProperties } from "react";
import type { AiNotice, AiNoticeLabels } from "../editor/aiNotice";

/**
 * One calm line with an optional action and a dismiss button (Figma 42:2,
 * frames 4–6): used for AI notices in the suggestion bar and the ✦ AI menu.
 * Mouse down never takes focus from the editor.
 */
export function AiNoticeBar({
  notice,
  labels,
  className,
  style,
  onAction,
  onDismiss
}: {
  notice: AiNotice;
  labels: Pick<AiNoticeLabels, "useMyKey" | "updateKey" | "dismiss">;
  className?: string;
  style?: CSSProperties;
  onAction?: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      className={className ? `editor-ai-notice ${className}` : "editor-ai-notice"}
      role="status"
      aria-live="polite"
      style={style}
      onMouseDown={(event) => event.preventDefault()}
    >
      <span className="editor-ai-notice-message">{notice.message}</span>
      {notice.action && onAction ? (
        <button type="button" className="editor-ai-notice-action" onClick={onAction}>
          {notice.action === "use-key" ? labels.useMyKey : labels.updateKey}
        </button>
      ) : null}
      <button type="button" className="editor-ai-notice-dismiss" aria-label={labels.dismiss} onClick={onDismiss}>
        <X size={12} aria-hidden="true" />
      </button>
    </div>
  );
}
