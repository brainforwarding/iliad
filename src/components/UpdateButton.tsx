import { ArrowDown } from "lucide-react";
import { useEffect, useRef, type CSSProperties } from "react";
import type { AppStrings } from "../i18n/strings";
import type { AppUpdateState } from "../types/iliad";
import { Icon } from "./Icon";

type UpdateButtonLabels = Pick<
  AppStrings["updates"],
  | "update"
  | "updateTooltip"
  | "updateAria"
  | "downloadTooltip"
  | "downloading"
  | "downloadingAria"
  | "restarting"
  | "restartingAria"
>;

export type UpdateButtonMode = "hidden" | "update" | "downloading" | "restarting";

/**
 * What the footer button shows. "update" is the 22px circle that grows into
 * "↓ Update" on hover/focus; after a click it stays expanded as "Downloading
 * 42%" (clicked before the download finished) or "Restarting…". A confirmation
 * on screen keeps it as "↓ Update" (Figma frame 6).
 */
export function updateButtonMode(state: AppUpdateState | null, confirming = false): UpdateButtonMode {
  if (!state) {
    return "hidden";
  }

  switch (state.status) {
    case "unsupported":
      return "update";
    case "available":
    case "downloading":
      return state.installWhenReady ? "downloading" : "update";
    case "ready":
      return state.restartPending && !confirming ? "restarting" : "update";
    case "installing":
      return "restarting";
    default:
      return "hidden";
  }
}

interface UpdateButtonProps {
  state: AppUpdateState | null;
  labels: UpdateButtonLabels;
  /** The review confirmation is open in this window. */
  confirming?: boolean;
  onInstall: () => void;
  /** Unsupported copies: open the DMG download instead. */
  onOpenDownload: () => void;
}

/**
 * The update button at the right end of the sidebar footer (spec 2026-09-27,
 * Figma frames 2–6). It replaces the amber dot and the "is available" toast.
 */
export function UpdateButton({ state, labels, confirming = false, onInstall, onOpenDownload }: UpdateButtonProps) {
  const mode = updateButtonMode(state, confirming);

  if (mode === "hidden" || !state) {
    return null;
  }

  const version = state.version ?? "";
  const percent = state.percent ?? 0;

  if (mode === "downloading") {
    return (
      <span
        className="sidebar-update-button is-expanded is-busy"
        role="status"
        aria-label={labels.downloadingAria(percent)}
        style={{ "--update-progress": `${percent}%` } as CSSProperties}
      >
        <span className="sidebar-update-progress" aria-hidden="true" />
        <span className="sidebar-update-text" aria-hidden="true">
          {labels.downloading(percent)}
        </span>
      </span>
    );
  }

  if (mode === "restarting") {
    return (
      <span className="sidebar-update-button is-expanded is-busy" role="status" aria-label={labels.restartingAria}>
        <span className="sidebar-update-text" aria-hidden="true">
          {labels.restarting}
        </span>
      </span>
    );
  }

  const unsupported = state.status === "unsupported";

  return (
    <button
      type="button"
      className={`sidebar-update-button${confirming ? " is-expanded" : ""}`}
      aria-label={labels.updateAria(version)}
      data-tooltip={unsupported ? labels.downloadTooltip(version) : labels.updateTooltip(version)}
      onClick={() => (unsupported ? onOpenDownload() : onInstall())}
    >
      <Icon icon={ArrowDown} size={12} className="sidebar-update-arrow" />
      <span className="sidebar-update-label" aria-hidden="true">
        {labels.update}
      </span>
    </button>
  );
}

interface UpdateConfirmPopoverProps {
  labels: Pick<AppStrings["updates"], "confirmTitle" | "confirmBody" | "confirmCancel" | "confirmRestart">;
  onResolve: (restart: boolean) => void;
}

/**
 * "Restart to update?" — only when an outside-change review is pending in
 * this window (restarting ends that review). Esc or Not now declines.
 */
export function UpdateConfirmPopover({ labels, onResolve }: UpdateConfirmPopoverProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const restartRef = useRef<HTMLButtonElement | null>(null);
  const resolveRef = useRef(onResolve);
  resolveRef.current = onResolve;

  useEffect(() => {
    restartRef.current?.focus();

    // Clicking away is "Not now" (Figma frame 6).
    const onPointerDown = (event: PointerEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        resolveRef.current(false);
      }
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, []);

  return (
    <div
      ref={popoverRef}
      className="update-confirm-popover"
      role="alertdialog"
      aria-modal="false"
      aria-labelledby="update-confirm-title"
      aria-describedby="update-confirm-body"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onResolve(false);
        }
      }}
    >
      <h2 id="update-confirm-title">{labels.confirmTitle}</h2>
      <p id="update-confirm-body">{labels.confirmBody}</p>
      <div className="update-confirm-actions">
        <button type="button" className="update-confirm-cancel" onClick={() => onResolve(false)}>
          {labels.confirmCancel}
        </button>
        <button
          type="button"
          className="update-confirm-restart"
          ref={restartRef}
          onClick={() => onResolve(true)}
        >
          {labels.confirmRestart}
        </button>
      </div>
    </div>
  );
}
