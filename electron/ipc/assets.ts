import { ipcMain, net, protocol } from "electron";
import { pathToFileURL } from "node:url";
import { saveImageAsset, type SaveImageAssetRequest } from "../fs/fileOps.js";
import { isInsideAllowedWorkspace } from "../fs/workspaceRegistry.js";

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

export function registerAssetIpc() {
  ipcMain.handle("asset:save-image", async (_event, request: SaveImageAssetRequest) => {
    return saveImageAsset(request);
  });
}
