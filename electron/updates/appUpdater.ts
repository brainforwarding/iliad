import {
  initialAppUpdateState,
  releaseUrlForVersion,
  type AppUpdateState,
  type PrepareRestartMode
} from "./appUpdateState.js";
import { compareVersions, parseVersion, type UpdateCheckResult } from "./updateService.js";

/** The part of electron-updater's `AppUpdater` Iliad uses (a fake in tests). */
export interface UpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  allowDowngrade: boolean;
  /** MacUpdater: relaunch after installing (true) or just quit (false). */
  autoRunAppAfterInstall: boolean;
  logger: UpdaterLogger | null;
  on(event: string, listener: (...args: any[]) => void): unknown;
  checkForUpdates(): Promise<{ downloadPromise?: Promise<unknown> | null } | null>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

export interface UpdaterLogger {
  info(message?: unknown): void;
  warn(message?: unknown): void;
  error(message?: unknown): void;
  debug?(message: string): void;
}

/** The notify-only GitHub check, kept for copies that can't update themselves. */
export interface FallbackUpdateChecker {
  checkForUpdates(): Promise<UpdateCheckResult>;
}

type Timer = ReturnType<typeof setTimeout>;

export interface AppUpdateControllerOptions {
  currentVersion: string;
  /** Packaged builds check on a schedule; development stays idle. */
  isPackaged: boolean;
  /** Resolved once, on the first check. */
  canSelfUpdate: () => Promise<boolean>;
  /** Called at most once, only when this copy can update itself. */
  createUpdater: () => UpdaterLike;
  fallback: FallbackUpdateChecker;
  /** Push the state to every window. */
  broadcast: (state: AppUpdateState) => void;
  /** Ask every window to save (and for "restart" maybe confirm); true when all answered OK. */
  prepareWindows: (mode: PrepareRestartMode) => Promise<boolean>;
  /** A plain quit, when installing on quit failed. */
  quitApp: () => void;
  logger?: UpdaterLogger;
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => Timer;
  clearTimer?: (timer: Timer) => void;
  setRepeating?: (callback: () => void, ms: number) => Timer;
  clearRepeating?: (timer: Timer) => void;
  firstCheckDelayMs?: number;
  /** Automatic checks happen at most this often. */
  checkIntervalMs?: number;
  /** How often the schedule looks whether a check is due. */
  tickMs?: number;
}

export const defaultFirstCheckDelayMs = 10_000;
export const defaultCheckIntervalMs = 6 * 60 * 60 * 1000;
const defaultTickMs = 10 * 60 * 1000;

interface UpdateInfoLike {
  version?: unknown;
}

function versionOf(info: unknown) {
  const version = (info as UpdateInfoLike | null)?.version;
  return typeof version === "string" ? version.replace(/^v/i, "") : "";
}

/**
 * In-app updates (spec 2026-09-27): wraps electron-updater, owns the state
 * every window mirrors, the check schedule, and the guarded restart. The
 * update never installs without a click on Update or a Quit, and both go
 * through the windows' save preflight first (`autoInstallOnAppQuit` is off).
 */
export class AppUpdateController {
  private state: AppUpdateState;
  private readonly options: AppUpdateControllerOptions;
  private readonly now: () => number;
  private updater: UpdaterLike | null = null;
  private selfUpdate: Promise<boolean> | null = null;
  private inFlight: Promise<AppUpdateState> | null = null;
  private inFlightManual = false;
  private lastCheckAt: number | null = null;
  private firstTimer: Timer | null = null;
  private tickTimer: Timer | null = null;
  /** quitAndInstall was called: the next before-quit belongs to the updater. */
  private quittingForUpdate = false;
  /** Installing on quit failed: let the plain quit through. */
  private quitPassThrough = false;
  private quitPreflightRunning = false;
  private installMode: PrepareRestartMode | null = null;

  constructor(options: AppUpdateControllerOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
    this.state = initialAppUpdateState(options.currentVersion);
  }

  getState() {
    return this.state;
  }

  /** First check ~10 s after launch, then whenever 6 hours passed since the last one. */
  start() {
    if (!this.options.isPackaged || this.firstTimer || this.tickTimer) {
      return;
    }

    const setTimer = this.options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    const setRepeating = this.options.setRepeating ?? ((callback, ms) => setInterval(callback, ms));

    this.firstTimer = setTimer(() => {
      this.firstTimer = null;
      void this.check({ manual: false });
    }, this.options.firstCheckDelayMs ?? defaultFirstCheckDelayMs);
    this.tickTimer = setRepeating(() => {
      void this.check({ manual: false });
    }, this.options.tickMs ?? defaultTickMs);
  }

  dispose() {
    if (this.firstTimer) {
      (this.options.clearTimer ?? clearTimeout)(this.firstTimer);
      this.firstTimer = null;
    }

    if (this.tickTimer) {
      (this.options.clearRepeating ?? clearInterval)(this.tickTimer);
      this.tickTimer = null;
    }
  }

  /**
   * Manual checks always run (and surface errors); automatic ones run at most
   * once per interval and fail silently. Never while a download or restart is
   * under way.
   */
  check({ manual }: { manual: boolean }): Promise<AppUpdateState> {
    if (this.inFlight) {
      if (manual && !this.inFlightManual) {
        this.inFlightManual = true;
        this.showChecking();
      }

      return this.inFlight;
    }

    const { status, restartPending } = this.state;

    if (status === "available" || status === "downloading" || status === "installing" || restartPending) {
      return Promise.resolve(this.state);
    }

    if (!manual && !this.options.isPackaged) {
      return Promise.resolve(this.state);
    }

    const interval = this.options.checkIntervalMs ?? defaultCheckIntervalMs;

    if (!manual && this.lastCheckAt !== null && this.now() - this.lastCheckAt < interval) {
      return Promise.resolve(this.state);
    }

    this.lastCheckAt = this.now();
    this.inFlightManual = manual;

    if (manual) {
      this.showChecking();
    }

    const run = this.runCheck().finally(() => {
      this.inFlight = null;
      this.inFlightManual = false;
    });
    this.inFlight = run;
    return run;
  }

  /** Update clicked: restart now when ready, or as soon as the download finishes. */
  async install() {
    const { status, restartPending } = this.state;

    if (restartPending || status === "installing") {
      return;
    }

    if (status === "available" || status === "downloading") {
      if (!this.state.installWhenReady) {
        this.set({ installWhenReady: true });
      }
      return;
    }

    if (status === "ready") {
      await this.restart("restart");
    }
  }

  /**
   * `before-quit`: "allow" lets the quit (and its cleanup) proceed. With an
   * update ready, the first Quit is held while every window saves; then the
   * update installs on the way out (no relaunch). A failed save cancels the quit.
   */
  beforeQuit(): "allow" | "prevent" {
    if (this.quittingForUpdate || this.quitPassThrough) {
      return "allow";
    }

    if (this.quitPreflightRunning || this.state.restartPending) {
      return "prevent";
    }

    if (this.state.status !== "ready") {
      return "allow";
    }

    this.quitPreflightRunning = true;
    void this.restart("quit").finally(() => {
      this.quitPreflightRunning = false;
    });
    return "prevent";
  }

  private showChecking() {
    const { status } = this.state;

    if (status === "idle" || status === "current" || status === "error") {
      this.set({ status: "checking" });
    }
  }

  private async runCheck(): Promise<AppUpdateState> {
    const prior = this.state;
    let selfUpdate = false;

    try {
      selfUpdate = await this.resolveSelfUpdate();
    } catch {
      selfUpdate = false;
    }

    if (!selfUpdate) {
      return this.runFallbackCheck(prior);
    }

    try {
      const updater = this.getUpdater();
      const result = await updater.checkForUpdates();
      // The download reports through events; never leave its rejection unhandled.
      void result?.downloadPromise?.catch(() => undefined);

      if (this.state.status === "checking" || this.state.status === "idle" || this.state.status === "error") {
        this.set({ status: "current", version: undefined, percent: undefined });
      }
    } catch (error) {
      this.log("warn", error);
      this.checkFailed(prior);
    }

    return this.state;
  }

  private async runFallbackCheck(prior: AppUpdateState) {
    let result: UpdateCheckResult;

    try {
      result = await this.options.fallback.checkForUpdates();
    } catch (error) {
      result = { status: "error", currentVersion: this.options.currentVersion, message: String(error) };
    }

    if (result.status === "available") {
      this.set({
        status: "unsupported",
        version: result.latestVersion,
        releaseUrl: result.releaseUrl,
        downloadUrl: result.downloadUrl,
        percent: undefined
      });
    } else if (result.status === "current") {
      this.set({ status: "current", version: undefined, releaseUrl: undefined, downloadUrl: undefined });
    } else {
      this.checkFailed(prior);
    }

    return this.state;
  }

  /** Manual → "Couldn't check"; automatic → silently back to what it was. */
  private checkFailed(prior: AppUpdateState) {
    if (this.inFlightManual) {
      if (this.state.status === "checking" || this.state.status === "idle" || this.state.status === "current") {
        this.set({ status: "error", version: undefined, percent: undefined });
      }
      return;
    }

    if (this.state.status === "checking") {
      this.set({ status: prior.status === "checking" ? "idle" : prior.status });
    }
  }

  private resolveSelfUpdate() {
    this.selfUpdate ??= this.options.canSelfUpdate();
    return this.selfUpdate;
  }

  private getUpdater() {
    if (this.updater) {
      return this.updater;
    }

    const updater = this.options.createUpdater();
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    updater.logger = this.options.logger ?? console;

    updater.on("update-available", (info: unknown) => this.onUpdateAvailable(versionOf(info)));
    updater.on("download-progress", (progress: { percent?: unknown }) => this.onProgress(progress?.percent));
    updater.on("update-downloaded", (info: unknown) => this.onDownloaded(versionOf(info)));
    updater.on("update-not-available", () => this.onNotAvailable());
    updater.on("error", (error: unknown) => this.onError(error));

    this.updater = updater;
    return updater;
  }

  private isNewer(version: string) {
    return Boolean(parseVersion(version)) && compareVersions(version, this.options.currentVersion) > 0;
  }

  private onUpdateAvailable(version: string) {
    if (!this.isNewer(version) || this.state.status === "installing") {
      return;
    }

    // Already downloaded: electron-updater re-announces it on the next check.
    if (this.state.status === "ready" && this.state.version === version) {
      return;
    }

    // A newer release replaces a ready one (downloaded again).
    this.set({
      status: "available",
      version,
      percent: 0,
      releaseUrl: releaseUrlForVersion(version),
      downloadUrl: undefined
    });
  }

  private onProgress(percent: unknown) {
    if (this.state.status !== "available" && this.state.status !== "downloading") {
      return;
    }

    const value = typeof percent === "number" && Number.isFinite(percent) ? Math.max(0, Math.min(100, Math.floor(percent))) : 0;

    if (this.state.status === "downloading" && this.state.percent === value) {
      return;
    }

    this.set({ status: "downloading", percent: value });
  }

  private onDownloaded(version: string) {
    if (this.state.status === "installing") {
      return;
    }

    const readyVersion = version || this.state.version;

    if (!readyVersion || !this.isNewer(readyVersion)) {
      return;
    }

    const installNow = this.state.installWhenReady;
    this.set({
      status: "ready",
      version: readyVersion,
      percent: undefined,
      releaseUrl: releaseUrlForVersion(readyVersion),
      installWhenReady: false
    });

    if (installNow) {
      void this.restart("restart");
    }
  }

  private onNotAvailable() {
    const { status } = this.state;

    if (status === "checking" || status === "idle" || status === "error") {
      this.set({ status: "current", version: undefined, percent: undefined });
    }
  }

  private onError(error: unknown) {
    this.log("warn", error);
    const { status } = this.state;

    if (status === "available" || status === "downloading") {
      // A clicked Update surfaces the failure; a background download retries at the next check.
      const clicked = this.state.installWhenReady;
      this.lastCheckAt = clicked ? this.lastCheckAt : null;
      this.set({
        status: clicked ? "error" : "idle",
        version: undefined,
        percent: undefined,
        releaseUrl: undefined,
        installWhenReady: false
      });
      return;
    }

    if (status === "installing") {
      this.installFailed();
    }
  }

  private installFailed() {
    const mode = this.installMode;
    this.quittingForUpdate = false;
    this.installMode = null;

    if (mode === "quit") {
      // Saves already succeeded; finish the quit the writer asked for.
      this.set({ status: "error", version: undefined, installWhenReady: false });
      this.quitPassThrough = true;
      this.options.quitApp();
      return;
    }

    this.set({ status: "error", version: undefined, percent: undefined, installWhenReady: false });
  }

  private async restart(mode: PrepareRestartMode) {
    if (this.state.status !== "ready" || this.state.restartPending) {
      return false;
    }

    this.set({ restartPending: true, installWhenReady: false });
    let ok = false;

    try {
      ok = await this.options.prepareWindows(mode);
    } catch (error) {
      this.log("warn", error);
      ok = false;
    }

    if (!ok || this.state.status !== "ready" || !this.updater) {
      this.set({ restartPending: false });
      return false;
    }

    this.installMode = mode;
    this.quittingForUpdate = true;
    this.set({ status: "installing", restartPending: false });

    try {
      this.updater.autoRunAppAfterInstall = mode === "restart";
      this.updater.quitAndInstall(mode === "quit", mode === "restart");
    } catch (error) {
      this.log("warn", error);
      this.installFailed();
      return false;
    }

    return true;
  }

  private set(patch: Partial<AppUpdateState>) {
    this.state = { ...this.state, ...patch };
    this.options.broadcast(this.state);
  }

  private log(level: "warn" | "info", message: unknown) {
    const logger = this.options.logger ?? console;
    logger[level](`[updates] ${message instanceof Error ? message.message : String(message)}`);
  }
}
