import { ipcMain, net, protocol } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  referenceWorkspaceImageAsset,
  saveImageAsset,
  type ReferenceImageAssetRequest,
  type SaveImageAssetRequest,
  type SavedImageAsset
} from "../fs/fileOps.js";
import { trackWorkspaceMutation } from "../fs/workspaceMutationMarkers.js";
import { isInsideAllowedWorkspace } from "../fs/workspaceRegistry.js";
import type { WorkspaceInfo } from "../launch/workspace.js";

interface ReferenceImageAssetByRelativePathRequest {
  workspaceSessionId: string;
  documentPath: string;
  imageRelativePath: string;
}

interface RegisterAssetIpcOptions {
  getWindowWorkspace?: (webContentsId: number) => WorkspaceInfo | null;
  resolveWorkspaceRootForSession?: (
    event: Electron.IpcMainInvokeEvent,
    workspaceSessionId: string
  ) => string | null;
}

export function registerAssetProtocol() {
  protocol.handle("iliad-file", (request) => {
    const url = new URL(request.url);
    const absolutePath = decodeURIComponent(url.pathname.slice(1));

    if (!isInsideAllowedWorkspace(absolutePath)) {
      return new Response("Forbidden", { status: 403 });
    }

    return net.fetch(pathToFileURL(absolutePath).toString());
  });
}

function activeWorkspaceRoot(
  event: Electron.IpcMainInvokeEvent,
  requestedWorkspaceRoot: string,
  options: RegisterAssetIpcOptions
) {
  const currentWorkspace = options.getWindowWorkspace?.(event.sender.id);

  if (!currentWorkspace) {
    if (options.getWindowWorkspace) {
      throw new Error("No active workspace is available in this window.");
    }

    return requestedWorkspaceRoot;
  }

  if (path.resolve(currentWorkspace.path) !== path.resolve(requestedWorkspaceRoot)) {
    throw new Error("Requested workspace is not active in this window.");
  }

  return currentWorkspace.path;
}

function imagePathFromWorkspaceRelativePath(workspaceRoot: string, relativePath: string) {
  return path.resolve(workspaceRoot, relativePath);
}

export function registerAssetIpc(options: RegisterAssetIpcOptions = {}) {
  ipcMain.handle("asset:save-image", async (event, request: SaveImageAssetRequest): Promise<SavedImageAsset> => {
    const workspaceRoot = activeWorkspaceRoot(event, request.workspaceRoot, options);

    return trackWorkspaceMutation(workspaceRoot, undefined, () => saveImageAsset({ ...request, workspaceRoot }));
  });

  ipcMain.handle(
    "asset:reference-image",
    async (event, request: ReferenceImageAssetRequest): Promise<SavedImageAsset> => {
      const workspaceRoot = activeWorkspaceRoot(event, request.workspaceRoot, options);
      return referenceWorkspaceImageAsset({ ...request, workspaceRoot });
    }
  );

  ipcMain.handle(
    "asset:reference-image-relative",
    async (event, request: ReferenceImageAssetByRelativePathRequest): Promise<SavedImageAsset> => {
      const workspaceSessionId = typeof request?.workspaceSessionId === "string" ? request.workspaceSessionId.trim() : "";
      const workspaceRoot = workspaceSessionId ? options.resolveWorkspaceRootForSession?.(event, workspaceSessionId) : null;

      if (!workspaceRoot) {
        throw new Error("No active workspace is available in this window.");
      }

      return referenceWorkspaceImageAsset({
        workspaceRoot,
        documentPath: request.documentPath,
        imagePath: imagePathFromWorkspaceRelativePath(workspaceRoot, request.imageRelativePath)
      });
    }
  );
}
