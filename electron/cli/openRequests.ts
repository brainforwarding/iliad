import { randomUUID } from "node:crypto";

export interface CliOpenDocumentRequest {
  id: string;
  path: string;
  line: number | null;
}

export type CliOpenResult = { ok: true } | { ok: false; error: string };

interface PendingOpen {
  request: CliOpenDocumentRequest;
  taken: boolean;
  timer: NodeJS.Timeout;
  resolve: (result: CliOpenResult) => void;
}

export interface CliOpenRequestQueueOptions {
  /** Tells the window's renderer that a request is waiting (it then pulls it). */
  notify: (webContentsId: number) => void;
  timeoutMs?: number;
  createId?: () => string;
}

export const defaultCliOpenTimeoutMs = 10_000;

/**
 * One pending `iliad open` per window. The renderer pulls the request once its
 * workspace has loaded (like `getLaunchWorkspace`) or when notified, opens the
 * document, reveals the line and acknowledges; the CLI reply waits for that
 * acknowledgement. A newer request for the same window replaces the older one.
 */
export class CliOpenRequestQueue {
  private readonly pendingByWebContentsId = new Map<number, PendingOpen>();
  private readonly timeoutMs: number;
  private readonly createId: () => string;

  constructor(private readonly options: CliOpenRequestQueueOptions) {
    this.timeoutMs = options.timeoutMs ?? defaultCliOpenTimeoutMs;
    this.createId = options.createId ?? randomUUID;
  }

  request(webContentsId: number, { path, line }: { path: string; line: number | null }): Promise<CliOpenResult> {
    this.settle(webContentsId, { ok: false, error: "A newer `iliad open` replaced this request." });

    return new Promise((resolve) => {
      const request: CliOpenDocumentRequest = { id: this.createId(), path, line };
      const timer = setTimeout(() => {
        this.settle(webContentsId, { ok: false, error: "Iliad did not open the document in time." }, request.id);
      }, this.timeoutMs);
      timer.unref?.();

      this.pendingByWebContentsId.set(webContentsId, { request, taken: false, timer, resolve });
      this.options.notify(webContentsId);
    });
  }

  /**
   * Hands the waiting request to the renderer once. `accepts` lets the caller
   * hold it back until the window shows a workspace containing the file.
   */
  take(webContentsId: number, accepts: (request: CliOpenDocumentRequest) => boolean = () => true) {
    const pending = this.pendingByWebContentsId.get(webContentsId);

    if (!pending || pending.taken || !accepts(pending.request)) {
      return null;
    }

    pending.taken = true;
    return pending.request;
  }

  complete(webContentsId: number, requestId: string, result: CliOpenResult) {
    return this.settle(webContentsId, result, requestId);
  }

  dropWindow(webContentsId: number) {
    this.settle(webContentsId, { ok: false, error: "The Iliad window closed before the document opened." });
  }

  private settle(webContentsId: number, result: CliOpenResult, requestId?: string) {
    const pending = this.pendingByWebContentsId.get(webContentsId);

    if (!pending || (requestId !== undefined && pending.request.id !== requestId)) {
      return false;
    }

    clearTimeout(pending.timer);
    this.pendingByWebContentsId.delete(webContentsId);
    pending.resolve(result);
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
