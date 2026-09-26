import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { IpcRendererEvent } from "electron";
import type { MarkdownContentSearchRequest } from "./fs/contentSearch.js";

let workspaceReadRequestId = 0;

const REMOTE_METHOD_PREFIX = /^Error invoking remote method '[^']*': (?:Error: )?/;

/**
 * `ipcRenderer.invoke` wraps a handler's error message as
 * "Error invoking remote method 'channel': Error: <message>". The renderer
 * shows messages to the writer verbatim, so unwrap them here, once.
 */
function invoke(channel: string, ...args: unknown[]): Promise<any> {
  return ipcRenderer.invoke(channel, ...args).catch((error: unknown) => {
    if (error instanceof Error && REMOTE_METHOD_PREFIX.test(error.message)) {
      const unwrapped = new Error(error.message.replace(REMOTE_METHOD_PREFIX, ""));
      unwrapped.name = error.name;
      throw unwrapped;
    }

    throw error;
  });
}

const api = {
  getLaunchWorkspace: () => invoke("workspace:get-launch-workspace"),
  openWorkspaceDialog: (language?: string) => invoke("workspace:open-dialog", language),
  readDirectory: (workspaceRoot: string) =>
    invoke("workspace:read-directory", {
      workspaceRoot,
      requestId: ++workspaceReadRequestId
    }),
  watchWorkspace: (
    workspaceRoot: string,
    listener: (event: {
      workspaceRoot: string;
      treeChanged?: boolean;
      markdownChanged?: boolean;
      changedMarkdownPaths?: string[];
      watcherDegraded?: boolean;
    }) => void
  ) => {
    const handler = (_event: IpcRendererEvent, payload: unknown) => {
      if (
        payload &&
        typeof payload === "object" &&
        "workspaceRoot" in payload &&
        typeof payload.workspaceRoot === "string" &&
        payload.workspaceRoot === workspaceRoot
      ) {
        listener({
          workspaceRoot: payload.workspaceRoot,
          treeChanged: "treeChanged" in payload && typeof payload.treeChanged === "boolean" ? payload.treeChanged : true,
          markdownChanged:
            "markdownChanged" in payload && typeof payload.markdownChanged === "boolean" ? payload.markdownChanged : false,
          changedMarkdownPaths:
            "changedMarkdownPaths" in payload && Array.isArray(payload.changedMarkdownPaths)
              ? payload.changedMarkdownPaths.filter((item): item is string => typeof item === "string")
              : [],
          watcherDegraded: "watcherDegraded" in payload && payload.watcherDegraded === true
        });
      }
    };

    ipcRenderer.on("workspace:changed", handler);
    void invoke("workspace:watch", workspaceRoot).catch(() => {
      ipcRenderer.removeListener("workspace:changed", handler);
    });

    return () => {
      ipcRenderer.removeListener("workspace:changed", handler);
      void invoke("workspace:unwatch");
    };
  },
  readMarkdown: (workspaceRoot: string, filePath: string) =>
    invoke("file:read-markdown", workspaceRoot, filePath),
  writeMarkdown: (workspaceRoot: string, filePath: string, content: string, expected?: unknown) =>
    invoke("file:write-markdown", workspaceRoot, filePath, content, expected),
  createMarkdown: (workspaceRoot: string, directoryPath: string, requestedName: string) =>
    invoke("file:create-markdown", workspaceRoot, directoryPath, requestedName),
  createFolder: (workspaceRoot: string, directoryPath: string, requestedName: string) =>
    invoke("folder:create", workspaceRoot, directoryPath, requestedName),
  renamePath: (workspaceRoot: string, filePath: string, requestedName: string) =>
    invoke("file:rename", workspaceRoot, filePath, requestedName),
  movePath: (workspaceRoot: string, sourcePath: string, targetDirectoryPath: string) =>
    invoke("file:move", workspaceRoot, sourcePath, targetDirectoryPath),
  duplicatePath: (workspaceRoot: string, filePath: string) =>
    invoke("file:duplicate", workspaceRoot, filePath),
  moveToTrash: (workspaceRoot: string, filePath: string) =>
    invoke("file:trash", workspaceRoot, filePath),
  searchMarkdownContent: (request: MarkdownContentSearchRequest) =>
    invoke("file:search-markdown-content", request),
  openUrl: (url: string) => invoke("shell:open-url", url),
  diagnostics: {
    log: (request: unknown) => invoke("diagnostics:log", request)
  },
  updates: {
    check: () => invoke("updates:check"),
    consumePendingCheckRequest: () => invoke("updates:consume-pending-check-request"),
    onCheckRequested: (listener: () => void) => {
      const handler = () => listener();

      ipcRenderer.on("updates:check-requested", handler);

      return () => {
        ipcRenderer.removeListener("updates:check-requested", handler);
      };
    }
  },
  // Bridge for the `iliad` CLI (electron/cli): active document and open requests.
  cli: {
    setActiveDocument: (documentPath: string | null) => invoke("window:set-active-document", documentPath),
    takeOpenRequest: () => invoke("cli:take-open-request"),
    completeOpenRequest: (requestId: string, result: { ok: true } | { ok: false; error: string }) =>
      invoke("cli:complete-open-request", requestId, result),
    onOpenRequested: (listener: () => void) => {
      const handler = () => listener();

      ipcRenderer.on("cli:open-requested", handler);

      return () => {
        ipcRenderer.removeListener("cli:open-requested", handler);
      };
    }
  },
  openExternalFile: (workspaceRoot: string, filePath: string) =>
    invoke("file:open-external", workspaceRoot, filePath),
  revealInFinder: (workspaceRoot: string, filePath: string) =>
    invoke("file:reveal", workspaceRoot, filePath),
  saveImageAsset: (request: {
    workspaceRoot: string;
    documentPath: string;
    dataUrl: string;
    originalName?: string;
  }) => invoke("asset:save-image", request),
  referenceImageAsset: (request: {
    workspaceRoot: string;
    documentPath: string;
    imagePath: string;
  }) => invoke("asset:reference-image", request),
  referenceImageAssetByRelativePath: (request: {
    workspaceSessionId: string;
    documentPath: string;
    imageRelativePath: string;
  }) => invoke("asset:reference-image-relative", request),
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  assetUrl: (absolutePath: string) => `iliad-file://local/${encodeURIComponent(absolutePath)}`,
  tightenSelection: (request: {
    requestId: string;
    mode?: "tighten" | "edit";
    text: string;
    selection?: { from: number; to: number };
    instruction?: string;
    language: string;
  }) => invoke("tighten:run", request),
  cancelTighten: (requestId: string) => {
    void invoke("tighten:cancel", requestId);
  },
  autocompleteIdea: (request: {
    requestId: string;
    workspaceSessionId: string;
    documentRelativePath: string;
    language: "en" | "es";
    cursor: number;
    prefix: string;
    suffix: string;
    headingPath: string[];
    documentTitle: string;
    nearbyHeadings: string[];
    suggestionKind?: "sentence" | "paragraph" | "idea";
    extend?: boolean;
    direction?: string;
    avoid?: string[];
  }) => invoke("autocomplete:run", request),
  onAutocompletePartial: (listener: (event: { requestId: string; insert: string }) => void) => {
    const handler = (_event: IpcRendererEvent, event: { requestId: string; insert: string }) => listener(event);
    ipcRenderer.on("autocomplete:partial", handler);
    return () => ipcRenderer.removeListener("autocomplete:partial", handler);
  },
  cancelAutocompleteIdea: (requestId: string) => {
    void invoke("autocomplete:cancel", requestId);
  },
  getWritingAssistStatus: () => invoke("writing-assist:status"),
  getGeminiKeyState: () => invoke("writing:get-gemini-key-state"),
  setGeminiApiKey: (key: string | null) => invoke("writing:set-gemini-key", key),
  companions: {
    read: (workspaceRoot: string, filePath: string) => invoke("file:read-companion", workspaceRoot, filePath),
    remove: (workspaceRoot: string, filePath: string, expectedHash: string) =>
      invoke("file:remove-companion", workspaceRoot, filePath, expectedHash)
  },
  writingCorrectorMemory: {
    get: (request: {
      workspaceSessionId: string;
      documentRelativePath: string;
      language: "en" | "es";
    }) => invoke("writing-corrector-memory:get", request),
    ignoreIssue: (request: {
      workspaceSessionId: string;
      documentRelativePath: string;
      language: "en" | "es";
      fingerprint: string;
    }) => invoke("writing-corrector-memory:ignore", request),
    addDictionaryWord: (request: { language: "en" | "es"; word: string }) =>
      invoke("writing-corrector-memory:add-dictionary-word", request)
  },
  // Outside-change review. Channel names keep their historical `agent:` prefix.
  agent: {
    getExternalReview: (request: unknown) => invoke("agent:get-external-review", request),
    onExternalReviewChanged: (listener: (snapshot: unknown) => void) => {
      const handler = (_event: IpcRendererEvent, snapshot: unknown) => {
        listener(snapshot);
      };

      ipcRenderer.on("agent:external-review-changed", handler);

      return () => {
        ipcRenderer.removeListener("agent:external-review-changed", handler);
      };
    },
    applyProposalFile: (request: unknown) => invoke("agent:apply-proposal-file", request),
    rejectProposalFile: (request: unknown) => invoke("agent:reject-proposal-file", request),
    rejectProposal: (request: unknown) => invoke("agent:reject-proposal", request),
    keepChunk: (request: unknown) => invoke("agent:keep-chunk", request),
    restoreChunk: (request: unknown) => invoke("agent:restore-chunk", request)
  }
};

contextBridge.exposeInMainWorld("iliad", api);
