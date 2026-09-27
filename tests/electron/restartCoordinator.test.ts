import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RestartCoordinator } from "../../electron/updates/restartCoordinator";

describe("RestartCoordinator (updates:prepare-restart)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function coordinator() {
    let next = 0;
    return new RestartCoordinator({ timeoutMs: 10_000, waitingTimeoutMs: 60_000, createId: () => `r${++next}` });
  }

  it("resolves true only when every window answers OK", async () => {
    const restart = coordinator();
    const sent: Array<{ id: number; requestId: string; mode: string }> = [];
    const targets = [1, 2].map((id) => ({ id, send: (request: { requestId: string; mode: string }) => sent.push({ id, ...request }) }));
    const result = restart.prepare(targets, "restart");
    expect(sent).toEqual([
      { id: 1, requestId: "r1", mode: "restart" },
      { id: 2, requestId: "r2", mode: "restart" }
    ]);
    restart.respond(1, "r1", { ok: true });
    restart.respond(2, "r2", { ok: true });
    await expect(result).resolves.toBe(true);
  });

  it("cancels when any window says no (a failed save, or Not now)", async () => {
    const restart = coordinator();
    const result = restart.prepare([{ id: 1, send: () => undefined }, { id: 2, send: () => undefined }], "restart");
    restart.respond(1, "r1", { ok: true });
    restart.respond(2, "r2", { ok: false, reason: "save-failed" });
    await expect(result).resolves.toBe(false);
  });

  it("cancels when a window doesn't answer within 10 s", async () => {
    const restart = coordinator();
    const result = restart.prepare([{ id: 1, send: () => undefined }], "quit");
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(result).resolves.toBe(false);
    // A late answer changes nothing.
    restart.respond(1, "r1", { ok: true });
  });

  it("lets a window that is waiting for the writer's confirmation answer later", async () => {
    const restart = coordinator();
    const result = restart.prepare([{ id: 1, send: () => undefined }], "restart");
    restart.respond(1, "r1", { waiting: true });
    await vi.advanceTimersByTimeAsync(30_000);
    restart.respond(1, "r1", { ok: true });
    await expect(result).resolves.toBe(true);
  });

  it("ignores answers from another window, and a window that can't be reached is a no", async () => {
    const restart = coordinator();
    const result = restart.prepare([{ id: 1, send: () => undefined }], "restart");
    restart.respond(9, "r1", { ok: true });
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(result).resolves.toBe(false);

    const broken = coordinator().prepare(
      [
        {
          id: 1,
          send: () => {
            throw new Error("destroyed");
          }
        }
      ],
      "restart"
    );
    await expect(broken).resolves.toBe(false);
  });

  it("resolves true with no windows open", async () => {
    await expect(coordinator().prepare([], "quit")).resolves.toBe(true);
  });
});
