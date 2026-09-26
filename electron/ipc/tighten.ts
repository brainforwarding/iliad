import { app, ipcMain } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import { normalizeAgentError } from "../writing/errors.js";
import { WritingAiService } from "../writing/writingAiService.js";
import {
  TIGHTEN_TIMEOUT_MS,
  cleanTightenOutput,
  isTightenUnchanged,
  looksLikePreambleEcho,
  looksLikeTightenContextEcho,
  mergeTightenSelectionRewrite,
  normalizeTightenLanguage,
  normalizeTightenMode,
  normalizeTightenSelectionRange,
  tightenSelectedText,
  tightenReasonFromAgentError,
  validateTightenInstruction,
  validateTightenText,
  type TightenLanguage,
  type TightenMode,
  type TightenSelectionRange,
  type TightenResult
} from "../writing/tighten.js";
import { isTrustedIpcSender } from "./trust.js";

type TightenIpcEvent = Pick<IpcMainInvokeEvent, "sender" | "senderFrame">;

interface TightenRequest {
  requestId?: unknown;
  text?: unknown;
  language?: unknown;
  selection?: unknown;
  mode?: unknown;
  instruction?: unknown;
}

interface TightenRuntimeService {
  tightenSelection(request: {
    requestId: string;
    text: string;
    selection: TightenSelectionRange;
    language: TightenLanguage;
    mode?: TightenMode;
    instruction?: string;
    signal: AbortSignal;
  }): Promise<string>;
}

interface RegisterTightenIpcOptions {
  service?: TightenRuntimeService;
}

function senderControllerKey(senderId: number, requestId: unknown): string {
  const id = typeof requestId === "string" && requestId ? requestId : "anon";
  return `${senderId}:${id}`;
}

export function registerTightenIpc({
  service = new WritingAiService(app.getPath("userData"))
}: RegisterTightenIpcOptions = {}) {
  const controllers = new Map<string, AbortController>();

  ipcMain.handle("tighten:run", (event, request: TightenRequest) =>
    handleTightenIpc(event, request, { service, controllers })
  );

  ipcMain.handle("tighten:cancel", (event, requestId: unknown) => handleTightenCancelIpc(event, requestId, controllers));
}

/** Same checks as `autocomplete:cancel`: trusted sender and a non-empty request id (never the "anon" slot). */
export function handleTightenCancelIpc(event: TightenIpcEvent, requestId: unknown, controllers: Map<string, AbortController>) {
  if (!isTrustedIpcSender(event) || typeof requestId !== "string" || !requestId.trim()) {
    return;
  }

  controllers.get(senderControllerKey(event.sender.id, requestId))?.abort();
}

export async function handleTightenIpc(
  event: TightenIpcEvent,
  request: TightenRequest,
  deps: {
    service: TightenRuntimeService;
    controllers: Map<string, AbortController>;
  }
): Promise<TightenResult> {
  if (!isTrustedIpcSender(event)) {
    return { ok: false, reason: "untrusted" };
  }

  const validation = validateTightenText(request?.text);

  if (!validation.ok) {
    return { ok: false, reason: validation.reason };
  }

  const language = normalizeTightenLanguage(request?.language);
  const mode = normalizeTightenMode(request?.mode);
  const instruction =
    mode === "edit" ? validateTightenInstruction(request?.instruction) : ({ ok: true, instruction: undefined } as const);

  if (!instruction.ok) {
    return { ok: false, reason: instruction.reason };
  }

  const text = validation.text;
  const key = senderControllerKey(event.sender.id, request?.requestId);
  const requestId = typeof request?.requestId === "string" && request.requestId ? request.requestId : "anon";

  // Single-flight per sender: a new tighten supersedes any prior one in flight.
  for (const [existingKey, existing] of deps.controllers) {
    if (existingKey.startsWith(`${event.sender.id}:`)) {
      existing.abort();
      deps.controllers.delete(existingKey);
    }
  }

  const controller = new AbortController();
  deps.controllers.set(key, controller);
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, TIGHTEN_TIMEOUT_MS);

  try {
    const selection = normalizeTightenSelectionRange(text, request?.selection);
    const selectedText = tightenSelectedText(text, selection);
    const selectedRewrite = cleanTightenOutput(
      await deps.service.tightenSelection({
        requestId,
        text,
        selection,
        language,
        mode,
        instruction: instruction.instruction,
        signal: controller.signal
      }),
      selectedText
    );
    const rewrite = mergeTightenSelectionRewrite(text, selection, selectedRewrite);

    if (
      !selectedRewrite.trim() ||
      looksLikePreambleEcho(selectedRewrite, selectedText) ||
      looksLikeTightenContextEcho(selectedRewrite, text, selection)
    ) {
      return { ok: false, reason: "provider" };
    }

    return { ok: true, rewrite, unchanged: isTightenUnchanged(rewrite, text) };
  } catch (error) {
    const agentError = normalizeAgentError(error, { wasCanceled: controller.signal.aborted });
    const reason = tightenReasonFromAgentError(agentError, timedOut);
    // `resetAt` (from the proxy) reaches the renderer only with the "out" reason.
    return reason === "free_exhausted" && agentError.resetAt ? { ok: false, reason, resetAt: agentError.resetAt } : { ok: false, reason };
  } finally {
    clearTimeout(timeout);

    // Delete only if still current (a superseding request may have replaced us).
    if (deps.controllers.get(key) === controller) {
      deps.controllers.delete(key);
    }
  }
}
