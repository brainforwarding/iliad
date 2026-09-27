/**
 * What every window mirrors about app updates (spec 2026-09-27 in-app
 * updates). Main owns it; `src/types/iliad.ts` (`AppUpdateState`) repeats the
 * shape for the renderer.
 *
 * idle → checking → current | available → downloading(percent) → ready →
 * installing; plus error (only manual checks surface it) and unsupported
 * (this copy can't update itself: the DMG download, like before 0.6.0).
 */
export type AppUpdateStatus =
  | "idle"
  | "checking"
  | "current"
  | "available"
  | "downloading"
  | "ready"
  | "installing"
  | "error"
  | "unsupported";

export interface AppUpdateState {
  status: AppUpdateStatus;
  /** The running app's version. */
  currentVersion: string;
  /** The newer version (available … installing, unsupported). */
  version?: string;
  /** Download progress, 0–100 (downloading). */
  percent?: number;
  /** The GitHub release page of `version`. */
  releaseUrl?: string;
  /** The DMG to download by hand (unsupported only). */
  downloadUrl?: string;
  /** The writer clicked Update before the download finished: restart when it does. */
  installWhenReady: boolean;
  /** Windows are being asked to save (and maybe confirm) before the restart. */
  restartPending: boolean;
}

export const releasePageBaseUrl = "https://github.com/brainforwarding/iliad/releases/tag/";

export function releaseUrlForVersion(version: string) {
  return `${releasePageBaseUrl}v${version.replace(/^v/i, "")}`;
}

export function initialAppUpdateState(currentVersion: string): AppUpdateState {
  return { status: "idle", currentVersion, installWhenReady: false, restartPending: false };
}

/** Channels (kept together so main, preload and tests agree). */
export const updateChannels = {
  getState: "updates:get-state",
  check: "updates:check",
  install: "updates:install",
  state: "updates:state",
  checkRequested: "updates:check-requested",
  consumePendingCheckRequest: "updates:consume-pending-check-request",
  prepareRestart: "updates:prepare-restart",
  prepareRestartResponse: "updates:prepare-restart-response"
} as const;

/** What main asks before quitting for an update: "restart" (Update clicked) or "quit" (normal Quit). */
export type PrepareRestartMode = "restart" | "quit";

export interface PrepareRestartRequest {
  requestId: string;
  mode: PrepareRestartMode;
}

/**
 * A window's answer. `waiting` means "saved; the writer is deciding in the
 * confirmation" and lifts the 10 s timeout for that window.
 */
export type PrepareRestartResponse = { ok: true } | { ok: false; reason: string } | { waiting: true };
