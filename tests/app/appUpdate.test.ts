import { describe, expect, it, vi } from "vitest";
import { prepareForUpdateRestart, updateButtonVisible } from "../../src/app/useAppUpdate";
import { updateButtonMode } from "../../src/components/UpdateButton";
import type { AppUpdateState } from "../../src/types/iliad";

function prepare(overrides: Partial<Parameters<typeof prepareForUpdateRestart>[0]> = {}) {
  const calls: string[] = [];
  const options = {
    mode: "restart" as const,
    flushSave: vi.fn(async () => {
      calls.push("flush");
    }),
    hasPendingReview: () => false,
    confirm: vi.fn(async () => {
      calls.push("confirm");
      return true;
    }),
    waitingForWriter: vi.fn(() => {
      calls.push("waiting");
    }),
    onSaveFailed: vi.fn(),
    ...overrides
  };
  return { options, calls, result: prepareForUpdateRestart(options) };
}

describe("prepareForUpdateRestart (renderer answer before an update restart)", () => {
  it("saves, then answers OK", async () => {
    const { result, calls } = prepare();
    await expect(result).resolves.toEqual({ ok: true });
    expect(calls).toEqual(["flush"]);
  });

  it("cancels and shows the save error when a save fails", async () => {
    const error = new Error("disk full");
    const { result, options } = prepare({
      flushSave: vi.fn(async () => {
        throw error;
      }),
      hasPendingReview: () => true
    });
    await expect(result).resolves.toEqual({ ok: false, reason: "save-failed" });
    expect(options.onSaveFailed).toHaveBeenCalledWith(error);
    expect(options.confirm).not.toHaveBeenCalled();
  });

  it("asks first when an outside-change review is pending (after saving)", async () => {
    const restart = prepare({ hasPendingReview: () => true });
    await expect(restart.result).resolves.toEqual({ ok: true });
    expect(restart.calls).toEqual(["flush", "waiting", "confirm"]);

    const declined = prepare({ hasPendingReview: () => true, confirm: vi.fn(async () => false) });
    await expect(declined.result).resolves.toEqual({ ok: false, reason: "declined" });
  });

  it("never asks on a normal Quit (it ends reviews anyway)", async () => {
    const { result, options } = prepare({ mode: "quit", hasPendingReview: () => true });
    await expect(result).resolves.toEqual({ ok: true });
    expect(options.confirm).not.toHaveBeenCalled();
  });
});

function state(patch: Partial<AppUpdateState>): AppUpdateState {
  return { status: "idle", currentVersion: "0.6.0", installWhenReady: false, restartPending: false, ...patch };
}

describe("footer update button", () => {
  it("shows only in available, downloading, ready, installing and unsupported", () => {
    for (const status of ["idle", "checking", "current", "error"] as const) {
      expect(updateButtonVisible(state({ status }))).toBe(false);
      expect(updateButtonMode(state({ status }))).toBe("hidden");
    }

    for (const status of ["available", "downloading", "ready", "installing", "unsupported"] as const) {
      expect(updateButtonVisible(state({ status }))).toBe(true);
    }

    expect(updateButtonMode(null)).toBe("hidden");
  });

  it("walks ring → ready circle → Restarting…, or Downloading → Restarting… after an early click", () => {
    expect(updateButtonMode(state({ status: "available" }))).toBe("progress");
    expect(updateButtonMode(state({ status: "downloading", percent: 42 }))).toBe("progress");
    expect(updateButtonMode(state({ status: "downloading", percent: 42, installWhenReady: true }))).toBe("downloading");
    expect(updateButtonMode(state({ status: "available", installWhenReady: true }))).toBe("downloading");
    expect(updateButtonMode(state({ status: "ready" }))).toBe("ready");
    expect(updateButtonMode(state({ status: "ready", restartPending: true }))).toBe("restarting");
    // The confirmation keeps the ready pill under it (Figma frame 6).
    expect(updateButtonMode(state({ status: "ready", restartPending: true }), true)).toBe("ready");
    expect(updateButtonMode(state({ status: "installing" }))).toBe("restarting");
    expect(updateButtonMode(state({ status: "unsupported" }))).toBe("update");
  });
});
