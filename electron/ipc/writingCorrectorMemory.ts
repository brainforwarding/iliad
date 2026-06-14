import { app, ipcMain } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import path from "node:path";
import {
  WritingCorrectorMemoryStore,
  type WritingCorrectorMemorySnapshot
} from "../writingCorrector/writingCorrectorMemoryStore.js";
import { ensureMarkdownFile } from "../fs/pathSafety.js";
import { isInsideAllowedWorkspace } from "../fs/workspaceRegistry.js";
import { canonicalizeWorkspaceDirectory } from "../launch/workspace.js";
import { isTrustedAgentIpcSender } from "./agent.js";

type WritingCorrectorMemoryIpcEvent = Pick<IpcMainInvokeEvent, "sender" | "senderFrame">;
type WorkspaceSessionResolver = (
  event: WritingCorrectorMemoryIpcEvent,
  workspaceSessionId: string
) => Promise<string | null> | string | null;

interface RegisterWritingCorrectorMemoryIpcOptions {
  resolveWorkspaceRootForSession?: WorkspaceSessionResolver;
  store?: WritingCorrectorMemoryStore;
}

interface WritingCorrectorMemoryRequest {
  workspaceSessionId?: unknown;
  documentRelativePath?: unknown;
  language?: unknown;
}

interface WritingCorrectorMemoryIgnoreRequest extends WritingCorrectorMemoryRequest {
  fingerprint?: unknown;
}

interface WritingCorrectorDictionaryRequest {
  language?: unknown;
  word?: unknown;
}

const emptyMemory: WritingCorrectorMemorySnapshot = {
  ignoredIssueFingerprints: [],
  customWords: []
};

const emptyDictionary = {
  customWords: [] as string[]
};

export function registerWritingCorrectorMemoryIpc({
  resolveWorkspaceRootForSession,
  store = new WritingCorrectorMemoryStore(app.getPath("userData"))
}: RegisterWritingCorrectorMemoryIpcOptions = {}) {
  ipcMain.handle("writing-corrector-memory:get", (event, request: WritingCorrectorMemoryRequest) =>
    handleGetWritingCorrectorMemoryIpc(event, request, store, resolveWorkspaceRootForSession)
  );
  ipcMain.handle("writing-corrector-memory:ignore", (event, request: WritingCorrectorMemoryIgnoreRequest) =>
    handleIgnoreWritingCorrectorIssueIpc(event, request, store, resolveWorkspaceRootForSession)
  );
  ipcMain.handle("writing-corrector-memory:add-dictionary-word", (event, request: WritingCorrectorDictionaryRequest) =>
    handleAddWritingCorrectorDictionaryWordIpc(event, request, store)
  );
}

export async function handleGetWritingCorrectorMemoryIpc(
  event: WritingCorrectorMemoryIpcEvent,
  request: WritingCorrectorMemoryRequest,
  store: Pick<WritingCorrectorMemoryStore, "getForDocument">,
  resolveWorkspaceRootForSession: WorkspaceSessionResolver = defaultWorkspaceSessionResolver
): Promise<WritingCorrectorMemorySnapshot> {
  if (!isTrustedAgentIpcSender(event)) {
    return emptyMemory;
  }

  const normalized = await normalizeMemoryRequest(event, request, resolveWorkspaceRootForSession);

  if (!normalized) {
    return emptyMemory;
  }

  return store.getForDocument(normalized.workspaceRoot, normalized.documentRelativePath, normalized.language);
}

export async function handleIgnoreWritingCorrectorIssueIpc(
  event: WritingCorrectorMemoryIpcEvent,
  request: WritingCorrectorMemoryIgnoreRequest,
  store: Pick<WritingCorrectorMemoryStore, "ignoreIssue">,
  resolveWorkspaceRootForSession: WorkspaceSessionResolver = defaultWorkspaceSessionResolver
): Promise<WritingCorrectorMemorySnapshot> {
  if (!isTrustedAgentIpcSender(event)) {
    return emptyMemory;
  }

  const normalized = await normalizeMemoryRequest(event, request, resolveWorkspaceRootForSession);

  if (!normalized) {
    return emptyMemory;
  }

  return store.ignoreIssue(
    normalized.workspaceRoot,
    normalized.documentRelativePath,
    normalized.language,
    request?.fingerprint
  );
}

export async function handleAddWritingCorrectorDictionaryWordIpc(
  event: WritingCorrectorMemoryIpcEvent,
  request: WritingCorrectorDictionaryRequest,
  store: Pick<WritingCorrectorMemoryStore, "addDictionaryWord">
): Promise<{ customWords: string[] }> {
  if (!isTrustedAgentIpcSender(event)) {
    return emptyDictionary;
  }

  return {
    customWords: await store.addDictionaryWord(normalizeLanguage(request?.language), request?.word)
  };
}

async function normalizeMemoryRequest(
  event: WritingCorrectorMemoryIpcEvent,
  request: WritingCorrectorMemoryRequest,
  resolveWorkspaceRootForSession: WorkspaceSessionResolver
) {
  const workspaceSessionId = typeof request?.workspaceSessionId === "string" ? request.workspaceSessionId.trim() : "";
  const workspaceRoot = workspaceSessionId ? await resolveWorkspaceRootForSession(event, workspaceSessionId) : null;

  if (!workspaceRoot) {
    return null;
  }

  const documentRelativePath = validateMemoryDocumentPath(workspaceRoot, request.documentRelativePath);

  return {
    workspaceRoot: path.resolve(workspaceRoot),
    documentRelativePath,
    language: normalizeLanguage(request.language)
  };
}

function normalizeLanguage(language: unknown) {
  return language === "es" ? ("es" as const) : ("en" as const);
}

export function validateMemoryDocumentPath(workspaceRoot: string, documentRelativePath: unknown): string {
  if (typeof documentRelativePath !== "string") {
    throw new Error("Corrector memory document paths must be strings.");
  }

  if (path.isAbsolute(documentRelativePath) || /^[\\/]/.test(documentRelativePath)) {
    throw new Error("Corrector memory document paths must be relative Markdown paths.");
  }

  const normalized = documentRelativePath
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\.\//, "")
    .trim();
  const segments = normalized.split("/");

  if (!normalized || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("Corrector memory document paths must be relative Markdown paths.");
  }

  ensureMarkdownFile(workspaceRoot, path.join(workspaceRoot, normalized));
  return normalized;
}

async function defaultWorkspaceSessionResolver(_event: WritingCorrectorMemoryIpcEvent, workspaceSessionId: string) {
  if (!path.isAbsolute(workspaceSessionId)) {
    return null;
  }

  try {
    const workspace = await canonicalizeWorkspaceDirectory(workspaceSessionId);
    return isInsideAllowedWorkspace(workspace.path) ? workspace.path : null;
  } catch {
    return null;
  }
}
