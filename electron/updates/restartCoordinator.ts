import { randomUUID } from "node:crypto";
import type { PrepareRestartMode, PrepareRestartRequest, PrepareRestartResponse } from "./appUpdateState.js";

export interface PrepareTarget {
  /** webContents id. */
  id: number;
  send: (request: PrepareRestartRequest) => void;
}

interface PendingAnswer {
  targetId: number;
  resolve: (ok: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface RestartCoordinatorOptions {
  /** A window that doesn't answer in time cancels the restart. */
  timeoutMs?: number;
  /** Cap while a window waits for the writer's confirmation. */
  waitingTimeoutMs?: number;
  createId?: () => string;
  setTimer?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

/**
 * Asks every live window to prepare for an update restart (flush saves, and
 * for "restart" confirm a pending outside-change review), and resolves true
 * only when every window answered OK. Never quit with an unknown save state:
 * silence past the timeout is a no.
 */
export class RestartCoordinator {
  private readonly pending = new Map<string, PendingAnswer>();
  private readonly timeoutMs: number;
  private readonly waitingTimeoutMs: number;
  private readonly createId: () => string;
  private readonly setTimer: NonNullable<RestartCoordinatorOptions["setTimer"]>;
  private readonly clearTimer: NonNullable<RestartCoordinatorOptions["clearTimer"]>;

  constructor({
    timeoutMs = 10_000,
    waitingTimeoutMs = 5 * 60_000,
    createId = randomUUID,
    setTimer = (callback, ms) => setTimeout(callback, ms),
    clearTimer = (timer) => clearTimeout(timer)
  }: RestartCoordinatorOptions = {}) {
    this.timeoutMs = timeoutMs;
    this.waitingTimeoutMs = waitingTimeoutMs;
    this.createId = createId;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
  }

  async prepare(targets: PrepareTarget[], mode: PrepareRestartMode): Promise<boolean> {
    const answers = targets.map((target) => this.ask(target, mode));
    const results = await Promise.all(answers);
    return results.every(Boolean);
  }

  /** A renderer's answer (`updates:prepare-restart-response`). Answers from another window are ignored. */
  respond(senderId: number, requestId: unknown, response: unknown) {
    if (typeof requestId !== "string") {
      return;
    }

    const entry = this.pending.get(requestId);

    if (!entry || entry.targetId !== senderId) {
      return;
    }

    if (response && typeof response === "object" && (response as { waiting?: unknown }).waiting === true) {
      this.clearTimer(entry.timer);
      entry.timer = this.setTimer(() => this.settle(requestId, false), this.waitingTimeoutMs);
      return;
    }

    const ok = Boolean(response && typeof response === "object" && (response as PrepareRestartResponse & { ok?: unknown }).ok === true);
    this.settle(requestId, ok);
  }

  private ask(target: PrepareTarget, mode: PrepareRestartMode) {
    return new Promise<boolean>((resolve) => {
      const requestId = this.createId();
      const timer = this.setTimer(() => this.settle(requestId, false), this.timeoutMs);
      this.pending.set(requestId, { targetId: target.id, resolve, timer });

      try {
        target.send({ requestId, mode });
      } catch {
        this.settle(requestId, false);
      }
    });
  }

  private settle(requestId: string, ok: boolean) {
    const entry = this.pending.get(requestId);

    if (!entry) {
      return;
    }

    this.pending.delete(requestId);
    this.clearTimer(entry.timer);
    entry.resolve(ok);
  }
}
