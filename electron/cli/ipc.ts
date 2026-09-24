import { ipcMain } from "electron";
import { isTrustedIpcSender } from "../ipc/trust.js";
import { normalizeCliOpenResult, type CliOpenDocumentRequest } from "./openRequests.js";

export const cliOpenRequestedChannel = "cli:open-requested";

export interface CliIpcOptions {
  setActiveDocument: (webContentsId: number, documentPath: string | null) => void;
  takeOpenRequest: (webContentsId: number) => CliOpenDocumentRequest | null;
  completeOpenRequest: (webContentsId: number, requestId: string, result: ReturnType<typeof normalizeCliOpenResult>) => void;
}

/** Renderer side of the `iliad` CLI: active document push and open requests. */
export function registerCliIpc({ setActiveDocument, takeOpenRequest, completeOpenRequest }: CliIpcOptions) {
  ipcMain.handle("window:set-active-document", (event, documentPath: unknown) => {
    if (!isTrustedIpcSender(event)) {
      return;
    }

    setActiveDocument(event.sender.id, typeof documentPath === "string" && documentPath ? documentPath : null);
  });

  ipcMain.handle("cli:take-open-request", (event): CliOpenDocumentRequest | null => {
    if (!isTrustedIpcSender(event)) {
      return null;
    }

    return takeOpenRequest(event.sender.id);
  });

  ipcMain.handle("cli:complete-open-request", (event, requestId: unknown, result: unknown) => {
    if (!isTrustedIpcSender(event) || typeof requestId !== "string") {
      return;
    }

    completeOpenRequest(event.sender.id, requestId, normalizeCliOpenResult(result));
  });
}
