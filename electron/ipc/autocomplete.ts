import { app, ipcMain } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import path from "node:path";
import {
  AUTOCOMPLETE_MAX_HEADING_COUNT,
  AUTOCOMPLETE_MAX_IDEA_OUTPUT_CHARS,
  AUTOCOMPLETE_MAX_PREFIX_CHARS,
  AUTOCOMPLETE_MAX_SUFFIX_CHARS,
  AUTOCOMPLETE_MAX_TITLE_CHARS,
  AUTOCOMPLETE_IDEA_TIMEOUT_MS,
  AUTOCOMPLETE_TIMEOUT_MS,
  autocompleteReasonFromAgentError,
  cleanAutocompleteOutput,
  normalizeAutocompleteLanguage,
  type AutocompleteFailureReason,
  type IdeaAutocompleteLanguage,
  type IdeaAutocompleteResult,
  type IdeaAutocompleteSuggestionKind,
  type IdeaAutocompleteTrigger
} from "../writing/autocomplete.js";
import { normalizeAgentError } from "../writing/errors.js";
import { WritingAiService } from "../writing/writingAiService.js";
import { ensureMarkdownFile } from "../fs/pathSafety.js";
import { isTrustedIpcSender } from "./trust.js";

type AutocompleteIpcEvent = Pick<IpcMainInvokeEvent, "sender" | "senderFrame">;
type WorkspaceSessionResolver = (
  event: AutocompleteIpcEvent,
  workspaceSessionId: string
) => Promise<string | null> | string | null;

interface AutocompleteIdeaRequest {
  requestId?: unknown;
  workspaceSessionId?: unknown;
  documentRelativePath?: unknown;
  language?: unknown;
  cursor?: unknown;
  prefix?: unknown;
  suffix?: unknown;
  headingPath?: unknown;
  documentTitle?: unknown;
  nearbyHeadings?: unknown;
  trigger?: unknown;
  suggestionKind?: unknown;
  extend?: unknown;
  direction?: unknown;
  guidance?: unknown;
  avoid?: unknown;
}

interface AutocompleteRuntimeService {
  autocompleteIdea(request: {
    requestId: string;
    language: IdeaAutocompleteLanguage;
    prefix: string;
    suffix: string;
    headingPath: string[];
    documentTitle: string;
    nearbyHeadings: string[];
    trigger: IdeaAutocompleteTrigger;
    suggestionKind: IdeaAutocompleteSuggestionKind;
    extend?: boolean;
    direction?: string;
    guidance?: string;
    avoid?: string[];
    onPartial?: (raw: string) => void;
    signal: AbortSignal;
  }): Promise<string>;
}

interface RegisterAutocompleteIpcOptions {
  service?: AutocompleteRuntimeService;
  resolveWorkspaceRootForSession?: WorkspaceSessionResolver;
}

function senderControllerKey(senderId: number, requestId: string): string {
  return `${senderId}:${requestId}`;
}

export function registerAutocompleteIpc({
  service = new WritingAiService(app.getPath("userData")),
  resolveWorkspaceRootForSession = defaultWorkspaceSessionResolver
}: RegisterAutocompleteIpcOptions = {}) {
  const controllers = new Map<string, AbortController>();

  ipcMain.handle("autocomplete:run", (event, request: AutocompleteIdeaRequest) =>
    handleAutocompleteIpc(event, request, { service, controllers, resolveWorkspaceRootForSession })
  );

  ipcMain.handle("autocomplete:cancel", (event, requestId: unknown) => {
    if (!isTrustedIpcSender(event) || typeof requestId !== "string" || !requestId.trim()) {
      return;
    }

    controllers.get(senderControllerKey(event.sender.id, requestId.trim()))?.abort();
  });
}

export async function handleAutocompleteIpc(
  event: AutocompleteIpcEvent,
  request: AutocompleteIdeaRequest,
  deps: {
    service: AutocompleteRuntimeService;
    controllers: Map<string, AbortController>;
    resolveWorkspaceRootForSession: WorkspaceSessionResolver;
  }
): Promise<IdeaAutocompleteResult> {
  if (!isTrustedIpcSender(event)) {
    return { ok: false, reason: "untrusted" };
  }

  const normalized = await normalizeAutocompleteRequest(event, request, deps.resolveWorkspaceRootForSession);

  if (!normalized.ok) {
    return { ok: false, reason: normalized.reason };
  }

  for (const [existingKey, existing] of deps.controllers) {
    if (existingKey.startsWith(`${event.sender.id}:`)) {
      existing.abort();
      deps.controllers.delete(existingKey);
    }
  }

  const key = senderControllerKey(event.sender.id, normalized.request.requestId);
  const controller = new AbortController();
  deps.controllers.set(key, controller);
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, normalized.request.suggestionKind === "idea" ? AUTOCOMPLETE_IDEA_TIMEOUT_MS : AUTOCOMPLETE_TIMEOUT_MS);

  try {
    const rawText = await deps.service.autocompleteIdea({
      ...normalized.request,
      signal: controller.signal,
      onPartial: (raw) => {
        if (controller.signal.aborted || deps.controllers.get(key) !== controller || event.sender.isDestroyed()) return;
        const insert = cleanAutocompleteOutput(raw, normalized.request);
        if (insert) event.sender.send("autocomplete:partial", { requestId: normalized.request.requestId, insert });
      }
    });
    controller.signal.throwIfAborted();
    const insert = cleanAutocompleteOutput(rawText, {
      prefix: normalized.request.prefix,
      suffix: normalized.request.suffix,
      suggestionKind: normalized.request.suggestionKind,
      extend: normalized.request.extend
    });

    return insert ? { ok: true, insert } : { ok: false, reason: "no_suggestion" };
  } catch (error) {
    const agentError = normalizeAgentError(error, { wasCanceled: controller.signal.aborted });
    return { ok: false, reason: autocompleteReasonFromAgentError(agentError, timedOut) };
  } finally {
    clearTimeout(timeout);

    if (deps.controllers.get(key) === controller) {
      deps.controllers.delete(key);
    }
  }
}

async function normalizeAutocompleteRequest(
  event: AutocompleteIpcEvent,
  request: AutocompleteIdeaRequest,
  resolveWorkspaceRootForSession: WorkspaceSessionResolver
): Promise<
  | {
      ok: true;
      request: {
        requestId: string;
        language: IdeaAutocompleteLanguage;
        prefix: string;
        suffix: string;
        headingPath: string[];
        documentTitle: string;
        nearbyHeadings: string[];
        trigger: IdeaAutocompleteTrigger;
        suggestionKind: IdeaAutocompleteSuggestionKind;
        extend: boolean;
            direction?: string;
        guidance?: string;
        avoid?: string[];
      };
    }
  | { ok: false; reason: AutocompleteFailureReason }
> {
  const requestId = typeof request?.requestId === "string" ? request.requestId.trim() : "";

  if (!requestId) {
    return { ok: false, reason: "empty" };
  }

  const workspaceSessionId = typeof request?.workspaceSessionId === "string" ? request.workspaceSessionId.trim() : "";
  const workspaceRoot = workspaceSessionId ? await resolveWorkspaceRootForSession(event, workspaceSessionId) : null;

  if (!workspaceRoot) {
    return { ok: false, reason: "disabled" };
  }

  if (typeof request?.documentRelativePath !== "string" || path.isAbsolute(request.documentRelativePath)) {
    return { ok: false, reason: "disabled" };
  }

  try {
    ensureMarkdownFile(workspaceRoot, path.join(workspaceRoot, request.documentRelativePath));
  } catch {
    return { ok: false, reason: "disabled" };
  }

  if (typeof request?.prefix !== "string" || !request.prefix.trim()) {
    return { ok: false, reason: "empty" };
  }

  if (
    request.prefix.length > AUTOCOMPLETE_MAX_PREFIX_CHARS ||
    (typeof request.suffix === "string" && request.suffix.length > AUTOCOMPLETE_MAX_SUFFIX_CHARS)
  ) {
    return { ok: false, reason: "too_long" };
  }

  const trigger = normalizeAutocompleteTrigger(request.trigger);
  // Automatic suggestions stay short; longer lengths are always explicitly requested.
  const suggestionKind = trigger === "automatic" ? "inline" : normalizeAutocompleteSuggestionKind(request.suggestionKind);
  return {
    ok: true,
    request: {
      requestId,
      language: normalizeAutocompleteLanguage(request.language),
      prefix: request.prefix,
      suffix: typeof request.suffix === "string" ? request.suffix : "",
      headingPath: sanitizeStringList(request.headingPath, AUTOCOMPLETE_MAX_HEADING_COUNT),
      documentTitle: sanitizeString(request.documentTitle, AUTOCOMPLETE_MAX_TITLE_CHARS),
      nearbyHeadings: sanitizeStringList(request.nearbyHeadings, AUTOCOMPLETE_MAX_HEADING_COUNT),
      trigger,
      suggestionKind,
      extend: trigger === "manual" && request.extend === true,
      direction: sanitizeString(request.direction, 240),
      guidance: sanitizeString(request.guidance, 1800),
      avoid: Array.isArray(request.avoid) ? request.avoid.filter((text): text is string => typeof text === "string").slice(-3).map((text) => text.slice(0, AUTOCOMPLETE_MAX_IDEA_OUTPUT_CHARS)) : []
    }
  };
}

function normalizeAutocompleteTrigger(value: unknown): IdeaAutocompleteTrigger {
  return value === "manual" ? "manual" : "automatic";
}

function normalizeAutocompleteSuggestionKind(value: unknown): IdeaAutocompleteSuggestionKind {
  return value === "idea" || value === "paragraph" || value === "sentence" ? value : "inline";
}

function sanitizeString(value: unknown, maxChars: number) {
  return typeof value === "string" ? value.slice(0, maxChars) : "";
}

function sanitizeStringList(value: unknown, maxCount: number) {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.slice(0, AUTOCOMPLETE_MAX_TITLE_CHARS))
        .slice(0, maxCount)
    : [];
}

async function defaultWorkspaceSessionResolver(_event: AutocompleteIpcEvent, _workspaceSessionId: string) {
  return null;
}
