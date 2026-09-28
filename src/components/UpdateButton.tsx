import { ArrowDown, RotateCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { AppStrings } from "../i18n/strings";
import type { AppUpdateState } from "../types/iliad";
import { Icon } from "./Icon";

export type UpdateButtonLabels = Pick<
  AppStrings["updates"],
  | "update"
  | "updateTooltip"
  | "updateAria"
  | "downloadTooltip"
  | "downloading"
  | "downloadingAria"
  | "downloadingTooltip"
  | "readyTooltip"
  | "restarting"
  | "restartingAria"
> &
  /** Settings → General's link, word for word (one i18n key for both). */
  Pick<AppStrings["settings"], "restartToUpdate">;

export type UpdateButtonMode = "hidden" | "update" | "progress" | "ready" | "downloading" | "restarting";

/**
 * What the footer button shows (spec 2026-09-27, 0.6.2 Figma board 156:2).
 * "progress" is the outline circle with a progress ring while the update
 * downloads in the background; it hovers to "Downloading 42%". "ready" is the
 * solid circle with a restart glyph; it hovers to "Restart to update". After
 * a click it stays expanded as "Downloading 42%" (clicked before the download
 * finished) or "Restarting…". "update" is the solid ↓ circle, now only for
 * copies that can't update themselves (it opens the download). A
 * confirmation on screen keeps the ready pill open under it.
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
      return state.installWhenReady ? "downloading" : "progress";
    case "ready":
      return state.restartPending && !confirming ? "restarting" : "ready";
    case "installing":
      return "restarting";
    default:
      return "hidden";
  }
}

/** Download progress as a whole percent in 0–100. */
export function updatePercent(state: AppUpdateState | null) {
  const percent = Math.round(state?.percent ?? 0);
  return Math.min(100, Math.max(0, Number.isFinite(percent) ? percent : 0));
}

/**
 * True when the open pill would run into the Settings label beside it (the
 * Spanish ready pill does at the default sidebar width). The label then fades
 * out while the pill is open. `scrollWidth` is the pill's full width even
 * while it is still the 22px circle.
 */
function pillCrowdsSettingsLabel(pill: HTMLElement) {
  const label = pill.parentElement?.querySelector<HTMLElement>(".sidebar-settings-row > span");

  if (!label) {
    return false;
  }

  // The span fills its grid cell; the words end where the text does.
  const text = document.createRange();
  text.selectNodeContents(label);
  const pillLeft = pill.getBoundingClientRect().right - pill.scrollWidth;
  return pillLeft - 8 < text.getBoundingClientRect().right;
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
 * Figma frames 2–6 and the 0.6.2 board). It says what Settings → General says.
 */
export function UpdateButton({ state, labels, confirming = false, onInstall, onOpenDownload }: UpdateButtonProps) {
  const mode = updateButtonMode(state, confirming);
  const pillRef = useRef<HTMLElement | null>(null);
  const [crowding, setCrowding] = useState(false);
  const version = state?.version ?? "";
  const percent = updatePercent(state);
  const pillText =
    mode === "progress" || mode === "downloading"
      ? labels.downloading(percent)
      : mode === "ready"
        ? labels.restartToUpdate
        : mode === "restarting"
          ? labels.restarting
          : labels.update;

  const setPill = useCallback((element: HTMLElement | null) => {
    pillRef.current = element;
  }, []);

  const measure = useCallback(() => {
    if (pillRef.current) {
      setCrowding(pillCrowdsSettingsLabel(pillRef.current));
    }
  }, []);

  // The pill's text changes with the mode and the percent; measure again.
  useEffect(measure, [measure, mode, pillText]);

  if (mode === "hidden" || !state) {
    return null;
  }

  const crowdClass = crowding ? " is-crowding" : "";

  if (mode === "downloading" || mode === "restarting") {
    const downloading = mode === "downloading";
    return (
      <span
        ref={setPill}
        className={`sidebar-update-button is-expanded is-busy${crowdClass}`}
        role="status"
        aria-label={downloading ? labels.downloadingAria(percent) : labels.restartingAria}
        data-tooltip={downloading ? labels.downloadingTooltip(version) : undefined}
        style={downloading ? ({ "--update-progress": `${percent}%` } as CSSProperties) : undefined}
      >
        {downloading ? <span className="sidebar-update-progress" aria-hidden="true" /> : null}
        <span className="sidebar-update-text" aria-hidden="true">
          {pillText}
        </span>
      </span>
    );
  }

  if (mode === "progress") {
    // Still clickable: a click means "restart as soon as it's ready".
    return (
      <button
        ref={setPill}
        type="button"
        className={`sidebar-update-button is-progress${crowdClass}`}
        aria-label={labels.downloadingAria(percent)}
        data-tooltip={labels.downloadingTooltip(version)}
        style={{ "--update-progress": `${percent}%` } as CSSProperties}
        onPointerEnter={measure}
        onFocus={measure}
        onClick={onInstall}
      >
        <svg className="sidebar-update-ring" viewBox="0 0 22 22" aria-hidden="true" focusable="false">
          <circle className="sidebar-update-ring-track" cx="11" cy="11" r="10" />
          <circle
            className="sidebar-update-ring-arc"
            cx="11"
            cy="11"
            r="10"
            pathLength={100}
            strokeDasharray="100 100"
            style={{ strokeDashoffset: 100 - percent }}
            data-progress={percent}
          />
        </svg>
        <Icon icon={ArrowDown} size={12} className="sidebar-update-arrow" />
        <span className="sidebar-update-progress" aria-hidden="true" />
        <span className="sidebar-update-label" aria-hidden="true">
          {pillText}
        </span>
      </button>
    );
  }

  const ready = mode === "ready";
  const unsupported = state.status === "unsupported";
  const tooltip = ready
    ? labels.readyTooltip(version)
    : unsupported
      ? labels.downloadTooltip(version)
      : labels.updateTooltip(version);

  return (
    <button
      ref={setPill}
      type="button"
      className={`sidebar-update-button${ready ? " is-ready" : ""}${confirming ? " is-expanded" : ""}${crowdClass}`}
      aria-label={ready ? labels.readyTooltip(version) : labels.updateAria(version)}
      data-tooltip={tooltip}
      onPointerEnter={measure}
      onFocus={measure}
      onClick={() => (unsupported ? onOpenDownload() : onInstall())}
    >
      {ready ? (
        <Icon icon={RotateCw} size={12} className="sidebar-update-arrow sidebar-update-restart" />
      ) : (
        <Icon icon={ArrowDown} size={12} className="sidebar-update-arrow" />
      )}
      <span className="sidebar-update-label" aria-hidden="true">
        {pillText}
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
