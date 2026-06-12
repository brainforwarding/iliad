import { app, ipcMain } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import path from "node:path";
import { SelectionCommentsStore, type SelectionComment } from "../agent/selectionCommentsStore.js";
import { ensureMarkdownFile } from "../fs/pathSafety.js";
import { isInsideAllowedWorkspace } from "../fs/workspaceRegistry.js";
import { canonicalizeWorkspaceDirectory } from "../launch/workspace.js";
import { isTrustedAgentIpcSender } from "./agent.js";

type SelectionCommentsIpcEvent = Pick<IpcMainInvokeEvent, "sender" | "senderFrame">;
type WorkspaceSessionResolver = (
  event: SelectionCommentsIpcEvent,
  workspaceSessionId: string
) => Promise<string | null> | string | null;

interface RegisterSelectionCommentsIpcOptions {
  resolveWorkspaceRootForSession?: WorkspaceSessionResolver;
  store?: SelectionCommentsStore;
}

export function registerSelectionCommentsIpc({
  resolveWorkspaceRootForSession,
  store = new SelectionCommentsStore(app.getPath("userData"))
}: RegisterSelectionCommentsIpcOptions = {}) {
  ipcMain.handle("selection-comments:list", (event, workspaceSessionId: unknown) =>
    handleListSelectionCommentsIpc(event, workspaceSessionId, store, resolveWorkspaceRootForSession)
  );
  ipcMain.handle(
    "selection-comments:save",
    (event, workspaceSessionId: unknown, documentRelativePath: unknown, comments: unknown) =>
      handleSaveSelectionCommentsIpc(
        event,
        workspaceSessionId,
        documentRelativePath,
        comments,
        store,
        resolveWorkspaceRootForSession
      )
  );
}

export async function handleListSelectionCommentsIpc(
  event: SelectionCommentsIpcEvent,
  workspaceSessionId: unknown,
  store: Pick<SelectionCommentsStore, "listForWorkspace">,
  resolveWorkspaceRootForSession: WorkspaceSessionResolver = defaultWorkspaceSessionResolver
): Promise<SelectionComment[]> {
  if (!isTrustedAgentIpcSender(event)) {
    return [];
  }

  const workspaceRoot = await resolveWorkspaceRoot(event, workspaceSessionId, resolveWorkspaceRootForSession);

  if (!workspaceRoot) {
    return [];
  }

  return store.listForWorkspace(workspaceRoot);
}

export async function handleSaveSelectionCommentsIpc(
  event: SelectionCommentsIpcEvent,
  workspaceSessionId: unknown,
  documentRelativePath: unknown,
  comments: unknown,
  store: Pick<SelectionCommentsStore, "replaceForDocument">,
  resolveWorkspaceRootForSession: WorkspaceSessionResolver = defaultWorkspaceSessionResolver
): Promise<SelectionComment[]> {
  if (!isTrustedAgentIpcSender(event)) {
    return [];
  }

  const workspaceRoot = await resolveWorkspaceRoot(event, workspaceSessionId, resolveWorkspaceRootForSession);

  if (!workspaceRoot) {
    return [];
  }

  const relativePath = validateSelectionCommentDocumentPath(workspaceRoot, documentRelativePath);
  return store.replaceForDocument(workspaceRoot, relativePath, Array.isArray(comments) ? comments : []);
}

/**
 * Normalizes and validates a renderer-supplied document relative path against
 * the resolved workspace root: rejects empty, absolute, `..`, and hidden paths,
 * and requires a Markdown file (reuses the `pathSafety` helpers).
 */
export function validateSelectionCommentDocumentPath(workspaceRoot: string, documentRelativePath: unknown): string {
  if (typeof documentRelativePath !== "string") {
    throw new Error("Selection comment document paths must be strings.");
  }

  if (path.isAbsolute(documentRelativePath) || /^[\\/]/.test(documentRelativePath)) {
    throw new Error("Selection comment document paths must be relative Markdown paths.");
  }

  const normalized = documentRelativePath
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\.\//, "")
    .trim();
  const segments = normalized.split("/");

  if (!normalized || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("Selection comment document paths must be relative Markdown paths.");
  }

  ensureMarkdownFile(workspaceRoot, path.join(workspaceRoot, normalized));
  return normalized;
}

async function resolveWorkspaceRoot(
  event: SelectionCommentsIpcEvent,
  workspaceSessionId: unknown,
  resolveWorkspaceRootForSession: WorkspaceSessionResolver
) {
  if (typeof workspaceSessionId !== "string" || !workspaceSessionId.trim()) {
    return null;
  }

  const workspaceRoot = await resolveWorkspaceRootForSession(event, workspaceSessionId.trim());

  return typeof workspaceRoot === "string" && workspaceRoot.trim() ? path.resolve(workspaceRoot) : null;
}

async function defaultWorkspaceSessionResolver(_event: SelectionCommentsIpcEvent, workspaceSessionId: string) {
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
