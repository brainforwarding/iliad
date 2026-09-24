import { randomUUID } from "node:crypto";

export interface CliOpenDocumentRequest {
  id: string;
  path: string;
  line: number | null;
}

export type CliOpenResult = { ok: true } | { ok: false; error: string };

interface PendingOpen {
  request: CliOpenDocumentRequest;
  timer: NodeJS.Timeout;
  resolve: (result: CliOpenResult) => void;
}

interface WindowQueue {
  /** Handed to the renderer and not yet acknowledged. */
  inFlight: PendingOpen | null;
  /** Waiting, oldest first. */
  waiting: PendingOpen[];
}

export interface CliOpenRequestQueueOptions {
  /** Tells the window's renderer that a request is waiting (it then pulls it). */
  notify: (webContentsId: number) => void;
  timeoutMs?: number;
  createId?: () => string;
}

export const defaultCliOpenTimeoutMs = 10_000;

/**
 * `iliad open` requests per window, handled one at a time in arrival order.
 * The renderer pulls a request once its workspace has loaded (like
 * `getLaunchWorkspace`) or when notified, opens the document, reveals the line
 * and acknowledges; each CLI reply waits for its own acknowledgement. A request
 * the renderer took is never replaced: later ones wait until it is settled.
 */
export class CliOpenRequestQueue {
  private readonly queuesByWebContentsId = new Map<number, WindowQueue>();
  private readonly timeoutMs: number;
  private readonly createId: () => string;

  constructor(private readonly options: CliOpenRequestQueueOptions) {
    this.timeoutMs = options.timeoutMs ?? defaultCliOpenTimeoutMs;
    this.createId = options.createId ?? randomUUID;
  }

  request(webContentsId: number, { path, line }: { path: string; line: number | null }): Promise<CliOpenResult> {
    return new Promise((resolve) => {
      const request: CliOpenDocumentRequest = { id: this.createId(), path, line };
      const timer = setTimeout(() => {
        this.settle(webContentsId, request.id, { ok: false, error: "Iliad did not open the document in time." });
      }, this.timeoutMs);
      timer.unref?.();

      this.queueFor(webContentsId).waiting.push({ request, timer, resolve });
      this.options.notify(webContentsId);
    });
  }

  /**
   * Hands the oldest waiting request to the renderer, unless one is still in
   * flight. `accepts` lets the caller hold it back until the window shows a
   * workspace containing the file.
   */
  take(webContentsId: number, accepts: (request: CliOpenDocumentRequest) => boolean = () => true) {
    const queue = this.queuesByWebContentsId.get(webContentsId);
    const next = queue?.waiting[0];

    if (!queue || queue.inFlight || !next || !accepts(next.request)) {
      return null;
    }

    queue.waiting.shift();
    queue.inFlight = next;
    return next.request;
  }

  complete(webContentsId: number, requestId: string, result: CliOpenResult) {
    return this.settle(webContentsId, requestId, result);
  }

  dropWindow(webContentsId: number) {
    const queue = this.queuesByWebContentsId.get(webContentsId);

    if (!queue) {
      return;
    }

    this.queuesByWebContentsId.delete(webContentsId);
    const error: CliOpenResult = { ok: false, error: "The Iliad window closed before the document opened." };

    for (const pending of [...(queue.inFlight ? [queue.inFlight] : []), ...queue.waiting]) {
      clearTimeout(pending.timer);
      pending.resolve(error);
    }
  }

  private queueFor(webContentsId: number) {
    let queue = this.queuesByWebContentsId.get(webContentsId);

    if (!queue) {
      queue = { inFlight: null, waiting: [] };
      this.queuesByWebContentsId.set(webContentsId, queue);
    }

    return queue;
  }

  private settle(webContentsId: number, requestId: string, result: CliOpenResult) {
    const queue = this.queuesByWebContentsId.get(webContentsId);

    if (!queue) {
      return false;
    }

    let pending: PendingOpen | undefined;

    if (queue.inFlight?.request.id === requestId) {
      pending = queue.inFlight;
      queue.inFlight = null;
    } else {
      const index = queue.waiting.findIndex((item) => item.request.id === requestId);
      pending = index >= 0 ? queue.waiting.splice(index, 1)[0] : undefined;
    }

    if (!pending) {
      return false;
    }

    clearTimeout(pending.timer);
    pending.resolve(result);

    if (!queue.inFlight && queue.waiting.length === 0) {
      this.queuesByWebContentsId.delete(webContentsId);
    } else if (!queue.inFlight) {
      // The next request can go now.
      this.options.notify(webContentsId);
    }

    return true;
  }
}

export function normalizeCliOpenResult(value: unknown): CliOpenResult {
  if (value && typeof value === "object" && "ok" in value && value.ok === true) {
    return { ok: true };
  }

  const error =
    value && typeof value === "object" && "error" in value && typeof value.error === "string" && value.error.trim()
      ? value.error
      : "Iliad could not open the document.";
  return { ok: false, error };
}
