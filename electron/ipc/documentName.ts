import { app, ipcMain } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import {
  DOCUMENT_NAME_TIMEOUT_MS,
  cleanDocumentNameOutput,
  documentNameReasonFromAgentError,
  normalizeDocumentNameLanguage,
  validateDocumentNameText,
  type DocumentNameLanguage,
  type DocumentNameResult
} from "../writing/documentName.js";
import { normalizeAgentError } from "../writing/errors.js";
import { WritingAiService } from "../writing/writingAiService.js";
import { isTrustedIpcSender } from "./trust.js";

// `ai-name:run` / `ai-name:cancel`: one short title for an untitled document
// (spec 2026-09-27-name-untitled-documents). Same shape as tighten.ts:
// trusted sender, abort map keyed `sender:requestId`, single flight per
// window, a local timeout.

type DocumentNameIpcEvent = Pick<IpcMainInvokeEvent, "sender" | "senderFrame">;

interface DocumentNameRequest {
  requestId?: unknown;
  language?: unknown;
  text?: unknown;
}

interface DocumentNameRuntimeService {
  suggestName(request: { language: DocumentNameLanguage; text: string }, signal: AbortSignal): Promise<string>;
}

interface RegisterDocumentNameIpcOptions {
  service?: DocumentNameRuntimeService;
}

function senderControllerKey(senderId: number, requestId: string): string {
  return `${senderId}:${requestId}`;
}

export function registerDocumentNameIpc({
  service = new WritingAiService(app.getPath("userData"))
}: RegisterDocumentNameIpcOptions = {}) {
  const controllers = new Map<string, AbortController>();

  ipcMain.handle("ai-name:run", (event, request: DocumentNameRequest) =>
    handleDocumentNameIpc(event, request, { service, controllers })
  );

  ipcMain.handle("ai-name:cancel", (event, requestId: unknown) => handleDocumentNameCancelIpc(event, requestId, controllers));
}

/** Trusted sender and a non-empty request id only. */
export function handleDocumentNameCancelIpc(
  event: DocumentNameIpcEvent,
  requestId: unknown,
  controllers: Map<string, AbortController>
) {
  if (!isTrustedIpcSender(event) || typeof requestId !== "string" || !requestId.trim()) {
    return;
  }

  controllers.get(senderControllerKey(event.sender.id, requestId.trim()))?.abort();
}

export async function handleDocumentNameIpc(
  event: DocumentNameIpcEvent,
  request: DocumentNameRequest,
  deps: {
    service: DocumentNameRuntimeService;
    controllers: Map<string, AbortController>;
    timeoutMs?: number;
  }
): Promise<DocumentNameResult> {
  if (!isTrustedIpcSender(event)) {
    return { ok: false, reason: "untrusted" };
  }

  const requestId = typeof request?.requestId === "string" ? request.requestId.trim() : "";

  if (!requestId) {
    return { ok: false, reason: "empty" };
  }

  const validation = validateDocumentNameText(request?.text);

  if (!validation.ok) {
    return { ok: false, reason: validation.reason };
  }

  const language = normalizeDocumentNameLanguage(request?.language);

  // Single flight per sender: a new naming request supersedes any prior one.
  for (const [existingKey, existing] of deps.controllers) {
    if (existingKey.startsWith(`${event.sender.id}:`)) {
      existing.abort();
      deps.controllers.delete(existingKey);
    }
  }

  const key = senderControllerKey(event.sender.id, requestId);
  const controller = new AbortController();
  deps.controllers.set(key, controller);
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, deps.timeoutMs ?? DOCUMENT_NAME_TIMEOUT_MS);

  try {
    const raw = await deps.service.suggestName({ language, text: validation.text }, controller.signal);
    controller.signal.throwIfAborted();
    const title = cleanDocumentNameOutput(raw);
    return title ? { ok: true, title } : { ok: false, reason: "failed" };
  } catch (error) {
    const agentError = normalizeAgentError(error, { wasCanceled: controller.signal.aborted });
    const reason = documentNameReasonFromAgentError(agentError, timedOut);
    // `resetAt` (from the proxy) reaches the renderer only with the "out" reason.
    return reason === "free_exhausted" && agentError.resetAt ? { ok: false, reason, resetAt: agentError.resetAt } : { ok: false, reason };
  } finally {
    clearTimeout(timeout);

    if (deps.controllers.get(key) === controller) {
      deps.controllers.delete(key);
    }
  }
}
