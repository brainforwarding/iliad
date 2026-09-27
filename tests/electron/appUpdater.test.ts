import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppUpdateState } from "../../electron/updates/appUpdateState";
import { AppUpdateController, type UpdaterLike } from "../../electron/updates/appUpdater";
import type { UpdateCheckResult } from "../../electron/updates/updateService";

const HOUR = 60 * 60 * 1000;

class FakeUpdater extends EventEmitter implements UpdaterLike {
  autoDownload = false;
  autoInstallOnAppQuit = true;
  allowPrerelease = true;
  allowDowngrade = true;
  autoRunAppAfterInstall = true;
  logger: UpdaterLike["logger"] = null;
  checks = 0;
  /** What the next check does, after "checking-for-update". */
  nextCheck: (updater: FakeUpdater) => void | Promise<void> = (updater) => {
    updater.emit("update-not-available", { version: "0.6.0" });
  };
  quitAndInstall = vi.fn();

  async checkForUpdates() {
    this.checks += 1;
    this.emit("checking-for-update");
    await this.nextCheck(this);
    return { downloadPromise: Promise.resolve() };
  }
}

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

interface Harness {
  controller: AppUpdateController;
  updater: FakeUpdater;
  states: AppUpdateState[];
  prepareWindows: ReturnType<typeof vi.fn>;
  quitApp: ReturnType<typeof vi.fn>;
  fallback: { checkForUpdates: ReturnType<typeof vi.fn> };
  clock: { now: number };
}

function harness({
  selfUpdate = true,
  isPackaged = true,
  prepareOk = true,
  fallbackResult = { status: "current", currentVersion: "0.6.0", latestVersion: "0.6.0" } as UpdateCheckResult
} = {}): Harness {
  const updater = new FakeUpdater();
  const states: AppUpdateState[] = [];
  const clock = { now: 1_000_000 };
  const prepareWindows = vi.fn(async () => prepareOk);
  const quitApp = vi.fn();
  const fallback = { checkForUpdates: vi.fn(async () => fallbackResult) };
  const controller = new AppUpdateController({
    currentVersion: "0.6.0",
    isPackaged,
    canSelfUpdate: async () => selfUpdate,
    createUpdater: () => updater,
    fallback,
    broadcast: (state) => states.push(state),
    prepareWindows,
    quitApp,
    logger: silentLogger,
    now: () => clock.now
  });
  return { controller, updater, states, prepareWindows, quitApp, fallback, clock };
}

function availableAndDownloading(version = "0.6.1") {
  return (updater: FakeUpdater) => {
    updater.emit("update-available", { version });
    updater.emit("download-progress", { percent: 42.7 });
  };
}

function downloaded(version = "0.6.1") {
  return (updater: FakeUpdater) => {
    updater.emit("update-available", { version });
    updater.emit("download-progress", { percent: 100 });
    updater.emit("update-downloaded", { version });
  };
}

describe("AppUpdateController: state machine", () => {
  it("configures electron-updater: background download, never install on quit by itself, no pre-releases or downgrades", async () => {
    const { controller, updater } = harness();
    await controller.check({ manual: true });
    expect(updater.autoDownload).toBe(true);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(updater.allowPrerelease).toBe(false);
    expect(updater.allowDowngrade).toBe(false);
    expect(updater.logger).toBe(silentLogger);
  });

  it("goes idle → checking → current on a manual check with nothing new", async () => {
    const { controller, states } = harness();
    expect(controller.getState().status).toBe("idle");
    const result = await controller.check({ manual: true });
    expect(states.map((state) => state.status)).toEqual(["checking", "current"]);
    expect(result.status).toBe("current");
  });

  it("goes available → downloading(percent) → ready", async () => {
    const { controller, updater, states } = harness();
    updater.nextCheck = availableAndDownloading();
    await controller.check({ manual: false });
    expect(states.map((state) => state.status)).toEqual(["available", "downloading"]);
    expect(controller.getState()).toMatchObject({ status: "downloading", version: "0.6.1", percent: 42 });
    expect(controller.getState().releaseUrl).toBe("https://github.com/brainforwarding/iliad/releases/tag/v0.6.1");

    updater.emit("update-downloaded", { version: "0.6.1" });
    expect(controller.getState()).toMatchObject({ status: "ready", version: "0.6.1" });
  });

  it("ignores versions that aren't newer (never downgrade)", async () => {
    const { controller, updater } = harness();
    updater.nextCheck = (fake) => {
      fake.emit("update-available", { version: "0.5.9" });
      fake.emit("update-not-available", { version: "0.5.9" });
    };
    await controller.check({ manual: true });
    expect(controller.getState().status).toBe("current");
  });

  it("keeps a ready update when a later check announces the same version", async () => {
    const { controller, updater, clock } = harness();
    updater.nextCheck = downloaded("0.6.1");
    await controller.check({ manual: false });
    expect(controller.getState().status).toBe("ready");

    updater.nextCheck = (fake) => {
      fake.emit("update-available", { version: "0.6.1" });
      fake.emit("update-downloaded", { version: "0.6.1" });
    };
    clock.now += 7 * HOUR;
    await controller.check({ manual: false });
    expect(controller.getState()).toMatchObject({ status: "ready", version: "0.6.1" });
  });

  it("replaces a ready update with a newer release (downloads again)", async () => {
    const { controller, updater, clock } = harness();
    updater.nextCheck = downloaded("0.6.1");
    await controller.check({ manual: false });

    updater.nextCheck = availableAndDownloading("0.6.2");
    clock.now += 7 * HOUR;
    await controller.check({ manual: false });
    expect(controller.getState()).toMatchObject({ status: "downloading", version: "0.6.2" });
  });

  it("surfaces a failed manual check, and stays silent on a failed automatic one", async () => {
    const manual = harness();
    manual.updater.nextCheck = () => {
      throw new Error("offline");
    };
    await manual.controller.check({ manual: true });
    expect(manual.controller.getState().status).toBe("error");

    const automatic = harness();
    automatic.updater.nextCheck = () => {
      throw new Error("offline");
    };
    await automatic.controller.check({ manual: false });
    expect(automatic.controller.getState().status).toBe("idle");
    expect(automatic.states).toEqual([]);
  });

  it("drops a failed background download silently, but reports it when Update was clicked", async () => {
    const quiet = harness();
    quiet.updater.nextCheck = availableAndDownloading();
    await quiet.controller.check({ manual: false });
    quiet.updater.emit("error", new Error("network"));
    expect(quiet.controller.getState().status).toBe("idle");

    const clicked = harness();
    clicked.updater.nextCheck = availableAndDownloading();
    await clicked.controller.check({ manual: false });
    await clicked.controller.install();
    clicked.updater.emit("error", new Error("network"));
    expect(clicked.controller.getState()).toMatchObject({ status: "error", installWhenReady: false });
  });

  it("uses the GitHub check for copies that can't update themselves (unsupported, with the DMG)", async () => {
    const { controller, updater, fallback } = harness({
      selfUpdate: false,
      fallbackResult: {
        status: "available",
        currentVersion: "0.6.0",
        latestVersion: "0.6.1",
        releaseName: "Iliad MD 0.6.1",
        releaseDate: "2026-10-01T00:00:00Z",
        releaseUrl: "https://github.com/brainforwarding/iliad/releases/tag/v0.6.1",
        downloadUrl: "https://github.com/brainforwarding/iliad/releases/download/v0.6.1/Iliad-MD-0.6.1-mac-arm64.dmg"
      }
    });
    await controller.check({ manual: false });
    expect(updater.checks).toBe(0);
    expect(fallback.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(controller.getState()).toMatchObject({
      status: "unsupported",
      version: "0.6.1",
      downloadUrl: "https://github.com/brainforwarding/iliad/releases/download/v0.6.1/Iliad-MD-0.6.1-mac-arm64.dmg"
    });

    // Update in unsupported does nothing in main (the renderer opens the download).
    await controller.install();
    expect(controller.getState().status).toBe("unsupported");
  });

  it("stays inert in development: no schedule, no updater; a manual check uses the GitHub check", async () => {
    vi.useFakeTimers();
    try {
      const { controller, updater, fallback } = harness({ isPackaged: false, selfUpdate: false });
      controller.start();
      await vi.advanceTimersByTimeAsync(24 * HOUR);
      expect(fallback.checkForUpdates).not.toHaveBeenCalled();
      expect(controller.getState().status).toBe("idle");
      await controller.check({ manual: false });
      expect(fallback.checkForUpdates).not.toHaveBeenCalled();
      await controller.check({ manual: true });
      expect(fallback.checkForUpdates).toHaveBeenCalledTimes(1);
      expect(updater.checks).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("AppUpdateController: schedule", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function scheduled() {
    const updater = new FakeUpdater();
    const controller = new AppUpdateController({
      currentVersion: "0.6.0",
      isPackaged: true,
      canSelfUpdate: async () => true,
      createUpdater: () => updater,
      fallback: { checkForUpdates: vi.fn() },
      broadcast: () => undefined,
      prepareWindows: async () => true,
      quitApp: () => undefined,
      logger: silentLogger
    });
    return { controller, updater };
  }

  it("checks ~10 s after launch, then at most once every 6 hours", async () => {
    const { controller, updater } = scheduled();
    controller.start();
    await vi.advanceTimersByTimeAsync(9_000);
    expect(updater.checks).toBe(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(updater.checks).toBe(1);

    // Never again before 6 hours; the schedule looks every 10 minutes.
    await vi.advanceTimersByTimeAsync(6 * HOUR - 20_000);
    expect(updater.checks).toBe(1);
    // First tick at or past 6 hours since the last check.
    await vi.advanceTimersByTimeAsync(20 * 60_000);
    expect(updater.checks).toBe(2);
    await vi.advanceTimersByTimeAsync(5 * HOUR);
    expect(updater.checks).toBe(2);
    await vi.advanceTimersByTimeAsync(1 * HOUR);
    expect(updater.checks).toBe(3);
    controller.dispose();
    await vi.advanceTimersByTimeAsync(12 * HOUR);
    expect(updater.checks).toBe(3);
  });

  it("always runs manual checks, and they count toward the cooldown", async () => {
    const { controller, updater } = scheduled();
    await controller.check({ manual: true });
    await controller.check({ manual: true });
    expect(updater.checks).toBe(2);
    await controller.check({ manual: false });
    expect(updater.checks).toBe(2);
  });

  it("doesn't check while a download is under way", async () => {
    const { controller, updater } = scheduled();
    updater.nextCheck = availableAndDownloading();
    await controller.check({ manual: true });
    await controller.check({ manual: true });
    expect(updater.checks).toBe(1);
  });
});

describe("AppUpdateController: restart", () => {
  it("restarts right away when ready: saves every window first, then quitAndInstall(false, true)", async () => {
    const { controller, updater, prepareWindows, states } = harness();
    updater.nextCheck = downloaded();
    await controller.check({ manual: false });
    await controller.install();
    expect(prepareWindows).toHaveBeenCalledWith("restart");
    expect(states.some((state) => state.status === "ready" && state.restartPending)).toBe(true);
    expect(controller.getState().status).toBe("installing");
    expect(updater.autoRunAppAfterInstall).toBe(true);
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true);
  });

  it("cancels the restart when a window can't save or declines (back to Update)", async () => {
    const { controller, updater } = harness({ prepareOk: false });
    updater.nextCheck = downloaded();
    await controller.check({ manual: false });
    await controller.install();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    expect(controller.getState()).toMatchObject({ status: "ready", restartPending: false });
  });

  it("clicked while downloading: remembers installWhenReady and restarts when the download finishes", async () => {
    const { controller, updater, prepareWindows } = harness();
    updater.nextCheck = availableAndDownloading();
    await controller.check({ manual: false });
    await controller.install();
    await controller.install();
    expect(controller.getState()).toMatchObject({ status: "downloading", installWhenReady: true });
    expect(prepareWindows).not.toHaveBeenCalled();

    updater.emit("update-downloaded", { version: "0.6.1" });
    await vi.waitFor(() => expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true));
    expect(prepareWindows).toHaveBeenCalledTimes(1);
  });

  it("ignores a second click while the windows are preparing", async () => {
    let finish: (ok: boolean) => void = () => undefined;
    const h = harness();
    h.prepareWindows.mockImplementation(() => new Promise<boolean>((resolve) => (finish = resolve)));
    h.updater.nextCheck = downloaded();
    await h.controller.check({ manual: false });
    const first = h.controller.install();
    await h.controller.install();
    expect(h.prepareWindows).toHaveBeenCalledTimes(1);
    finish(true);
    await first;
    expect(h.updater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it("reports an install failure after quitAndInstall", async () => {
    const { controller, updater } = harness();
    updater.nextCheck = downloaded();
    await controller.check({ manual: false });
    await controller.install();
    updater.emit("error", new Error("signature mismatch"));
    expect(controller.getState().status).toBe("error");
    expect(controller.beforeQuit()).toBe("allow");
  });
});

describe("AppUpdateController: normal Quit with an update ready", () => {
  it("lets Quit through when no update is ready", () => {
    const { controller } = harness();
    expect(controller.beforeQuit()).toBe("allow");
  });

  it("holds the first Quit, saves (no review confirmation), then installs without relaunching", async () => {
    const { controller, updater, prepareWindows } = harness();
    updater.nextCheck = downloaded();
    await controller.check({ manual: false });

    expect(controller.beforeQuit()).toBe("prevent");
    // A second ⌘Q while saving is held too.
    expect(controller.beforeQuit()).toBe("prevent");
    await vi.waitFor(() => expect(updater.quitAndInstall).toHaveBeenCalledWith(true, false));
    expect(prepareWindows).toHaveBeenCalledTimes(1);
    expect(prepareWindows).toHaveBeenCalledWith("quit");
    expect(updater.autoRunAppAfterInstall).toBe(false);
    // The updater's own quit then goes through (and main's cleanup runs once).
    expect(controller.beforeQuit()).toBe("allow");
  });

  it("cancels the quit when a save fails, and asks again on the next Quit", async () => {
    const { controller, updater, prepareWindows } = harness({ prepareOk: false });
    updater.nextCheck = downloaded();
    await controller.check({ manual: false });

    expect(controller.beforeQuit()).toBe("prevent");
    await vi.waitFor(() => expect(controller.getState().restartPending).toBe(false));
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    expect(controller.getState().status).toBe("ready");

    expect(controller.beforeQuit()).toBe("prevent");
    await vi.waitFor(() => expect(prepareWindows).toHaveBeenCalledTimes(2));
  });

  it("finishes a plain quit when installing on quit fails", async () => {
    const { controller, updater, quitApp } = harness();
    updater.nextCheck = downloaded();
    await controller.check({ manual: false });
    controller.beforeQuit();
    await vi.waitFor(() => expect(updater.quitAndInstall).toHaveBeenCalled());
    updater.emit("error", new Error("squirrel failed"));
    expect(quitApp).toHaveBeenCalledTimes(1);
    expect(controller.beforeQuit()).toBe("allow");
  });

  it("holds Quit while an Update-click restart is waiting for the windows", async () => {
    const h = harness();
    let finish: (ok: boolean) => void = () => undefined;
    h.prepareWindows.mockImplementation(() => new Promise<boolean>((resolve) => (finish = resolve)));
    h.updater.nextCheck = downloaded();
    await h.controller.check({ manual: false });
    const restart = h.controller.install();
    expect(h.controller.beforeQuit()).toBe("prevent");
    finish(false);
    await restart;
    expect(h.prepareWindows).toHaveBeenCalledTimes(1);
  });
});
