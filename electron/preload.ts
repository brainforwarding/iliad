import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";

let workspaceReadRequestId = 0;

const api = {
  getLaunchWorkspace: () => ipcRenderer.invoke("workspace:get-launch-workspace"),
  openWorkspaceDialog: (language?: string) => ipcRenderer.invoke("workspace:open-dialog", language),
  readDirectory: (workspaceRoot: string) =>
    ipcRenderer.invoke("workspace:read-directory", {
      workspaceRoot,
      requestId: ++workspaceReadRequestId
    }),
  readMarkdown: (workspaceRoot: string, filePath: string) =>
    ipcRenderer.invoke("file:read-markdown", workspaceRoot, filePath),
  writeMarkdown: (workspaceRoot: string, filePath: string, content: string) =>
    ipcRenderer.invoke("file:write-markdown", workspaceRoot, filePath, content),
  createMarkdown: (workspaceRoot: string, directoryPath: string, requestedName: string) =>
    ipcRenderer.invoke("file:create-markdown", workspaceRoot, directoryPath, requestedName),
  createFolder: (workspaceRoot: string, directoryPath: string, requestedName: string) =>
    ipcRenderer.invoke("folder:create", workspaceRoot, directoryPath, requestedName),
  renamePath: (workspaceRoot: string, filePath: string, requestedName: string) =>
    ipcRenderer.invoke("file:rename", workspaceRoot, filePath, requestedName),
  duplicatePath: (workspaceRoot: string, filePath: string) =>
    ipcRenderer.invoke("file:duplicate", workspaceRoot, filePath),
  moveToTrash: (workspaceRoot: string, filePath: string) =>
    ipcRenderer.invoke("file:trash", workspaceRoot, filePath),
  openUrl: (url: string) => ipcRenderer.invoke("shell:open-url", url),
  openExternalFile: (workspaceRoot: string, filePath: string) =>
    ipcRenderer.invoke("file:open-external", workspaceRoot, filePath),
  revealInFinder: (workspaceRoot: string, filePath: string) =>
    ipcRenderer.invoke("file:reveal", workspaceRoot, filePath),
  saveImageAsset: (request: {
    workspaceRoot: string;
    documentPath: string;
    dataUrl: string;
    originalName?: string;
  }) => ipcRenderer.invoke("asset:save-image", request),
  listMarkdownContextDocuments: (workspaceSessionId: string) =>
    ipcRenderer.invoke("agent:list-markdown-context-documents", workspaceSessionId),
  normalizeContextDrop: (workspaceSessionId: string, absolutePath: string) =>
    ipcRenderer.invoke("agent:normalize-context-drop", workspaceSessionId, absolutePath),
  assetUrl: (absolutePath: string) => `iliad-file://local/${encodeURIComponent(absolutePath)}`,
  tightenSelection: (request: {
    requestId: string;
    mode?: "tighten" | "edit";
    text: string;
    selection?: { from: number; to: number };
    instruction?: string;
    language: string;
  }) => ipcRenderer.invoke("tighten:run", request),
  cancelTighten: (requestId: string) => {
    void ipcRenderer.invoke("tighten:cancel", requestId);
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
    trigger?: "automatic" | "manual";
    suggestionKind?: "inline" | "paragraph";
    autocompleteApiFallbackEnabled: boolean;
  }) => ipcRenderer.invoke("autocomplete:run", request),
  cancelAutocompleteIdea: (requestId: string) => {
    void ipcRenderer.invoke("autocomplete:cancel", requestId);
  },
  getWritingAssistStatus: (request: { autocompleteApiFallbackEnabled: boolean }) =>
    ipcRenderer.invoke("writing-assist:status", request),
  selectionComments: {
    list: (workspaceSessionId: string) => ipcRenderer.invoke("selection-comments:list", workspaceSessionId),
    save: (workspaceSessionId: string, documentRelativePath: string, comments: unknown) =>
      ipcRenderer.invoke("selection-comments:save", workspaceSessionId, documentRelativePath, comments)
  },
  writingCorrectorMemory: {
    get: (request: {
      workspaceSessionId: string;
      documentRelativePath: string;
      language: "en" | "es";
    }) => ipcRenderer.invoke("writing-corrector-memory:get", request),
    ignoreIssue: (request: {
      workspaceSessionId: string;
      documentRelativePath: string;
      language: "en" | "es";
      fingerprint: string;
    }) => ipcRenderer.invoke("writing-corrector-memory:ignore", request),
    addDictionaryWord: (request: { language: "en" | "es"; word: string }) =>
      ipcRenderer.invoke("writing-corrector-memory:add-dictionary-word", request)
  },
  agent: {
    getSettings: () => ipcRenderer.invoke("agent:get-settings"),
    updateSettings: (update: unknown) => ipcRenderer.invoke("agent:update-settings", update),
    probeCodexCli: (request?: unknown) => ipcRenderer.invoke("agent:probe-codex-cli", request),
    codexStatus: () => ipcRenderer.invoke("agent:codex-status"),
    startCodexDeviceLogin: () => ipcRenderer.invoke("agent:codex-start-device-login"),
    cancelCodexLogin: () => ipcRenderer.invoke("agent:codex-cancel-login"),
    logoutCodex: () => ipcRenderer.invoke("agent:codex-logout"),
    openCodexDeviceLogin: () => ipcRenderer.invoke("agent:codex-open-device-login"),
    startRun: (request: unknown) => ipcRenderer.invoke("agent:start-run", request),
    transcribeAudio: (request: unknown) => ipcRenderer.invoke("agent:transcribe-audio", request),
    onRunEvent: (listener: (event: unknown) => void) => {
      const handler = (_event: IpcRendererEvent, runEvent: unknown) => {
        listener(runEvent);
      };

      ipcRenderer.on("agent:run-event", handler);

      return () => {
        ipcRenderer.removeListener("agent:run-event", handler);
      };
    },
    cancelRun: (runId: string) => ipcRenderer.invoke("agent:cancel-run", runId),
    applyPatch: (request: unknown) => ipcRenderer.invoke("agent:apply-patch", request),
    applyNewDocument: (request: unknown) => ipcRenderer.invoke("agent:apply-new-document", request),
    listProposals: (workspaceRoot: string) => ipcRenderer.invoke("agent:list-proposals", workspaceRoot),
    applyProposalFile: (request: unknown) => ipcRenderer.invoke("agent:apply-proposal-file", request),
    rejectProposalFile: (request: unknown) => ipcRenderer.invoke("agent:reject-proposal-file", request),
    rejectProposal: (request: unknown) => ipcRenderer.invoke("agent:reject-proposal", request),
    resolveProposalHunk: (request: unknown) => ipcRenderer.invoke("agent:resolve-proposal-hunk", request),
    listChatThreads: (workspaceRoot: string) => ipcRenderer.invoke("agent:list-chat-threads", workspaceRoot),
    getChatThread: (request: unknown) => ipcRenderer.invoke("agent:get-chat-thread", request),
    saveChatThread: (request: unknown) => ipcRenderer.invoke("agent:save-chat-thread", request),
    clearChatHistory: (workspaceRoot: string) => ipcRenderer.invoke("agent:clear-chat-history", workspaceRoot),
    generateChatThreadTitle: (request: unknown) => ipcRenderer.invoke("agent:generate-chat-thread-title", request)
  },
  remote: {
    getSettings: () => ipcRenderer.invoke("remote:get-settings"),
    startPairing: () => ipcRenderer.invoke("remote:start-pairing"),
    updateSettings: (update: unknown) => ipcRenderer.invoke("remote:update-settings", update),
    revokeSettings: () => ipcRenderer.invoke("remote:revoke-settings")
  }
};

contextBridge.exposeInMainWorld("iliad", api);
