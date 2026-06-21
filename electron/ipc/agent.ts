import { app, BrowserWindow, ipcMain, shell } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import path from "node:path";
import { AgentService } from "../agent/agentService.js";
import {
  AgentDocumentToolError,
  createAgentDocumentTools
} from "../agent/documentTools.js";
import { OPENAI_CODEX_DEVICE_URL } from "../agent/runtime/codexAppServerClient.js";
import {
  normalizeCodexCliProbeRequest,
  probeCodexCli,
  type CodexCliProbeResponse
} from "../agent/runtime/codexProbe.js";
import { requestIdFromTranscriptionRequest, transcriptionFailedResponse } from "../agent/transcription.js";
import { isInsideAllowedWorkspace } from "../fs/workspaceRegistry.js";
import { canonicalizeWorkspaceDirectory } from "../launch/workspace.js";
import type {
  AgentMarkdownContextDocumentListResponse,
  AgentRunRequest,
  AgentSettingsUpdate,
  AgentTranscribeAudioResponse,
  ApplyAgentCreateDocumentRequest,
  ApplyAgentProposalFileRequest,
  ApplyAgentPatchRequest,
  CodexAccountStatusResponse,
  CodexDeviceLoginResponse,
  CodexOpenDeviceLoginResponse,
  NormalizeContextDropResponse,
  RejectAgentProposalFileRequest,
  RejectAgentProposalRequest,
  ResolveAgentProposalHunkRequest
} from "../agent/types.js";

type AgentIpcEvent = Pick<IpcMainInvokeEvent, "sender" | "senderFrame">;
type WorkspaceSessionResolver = (
  event: AgentIpcEvent,
  workspaceSessionId: string
) => Promise<string | null> | string | null;

interface RegisterAgentIpcOptions {
  resolveWorkspaceRootForSession?: WorkspaceSessionResolver;
  service?: AgentService;
}

export function registerAgentIpc({
  resolveWorkspaceRootForSession,
  service = new AgentService(app.getPath("userData"))
}: RegisterAgentIpcOptions = {}) {
  ipcMain.handle("agent:get-settings", () => service.settings());
  ipcMain.handle("agent:update-settings", (_event, update: AgentSettingsUpdate) => service.updateSettings(update));
  ipcMain.handle("agent:probe-codex-cli", (event, request: unknown) => handleCodexCliProbeIpc(event, request));
  ipcMain.handle("agent:codex-status", (event) => handleCodexStatusIpc(event, service));
  ipcMain.handle("agent:codex-start-device-login", (event) => handleCodexStartDeviceLoginIpc(event, service));
  ipcMain.handle("agent:codex-cancel-login", (event) => handleCodexCancelLoginIpc(event, service));
  ipcMain.handle("agent:codex-logout", (event) => handleCodexLogoutIpc(event, service));
  ipcMain.handle("agent:codex-open-device-login", (event) => handleCodexOpenDeviceLoginIpc(event));
  ipcMain.handle("agent:transcribe-audio", (event, request: unknown) =>
    handleTranscribeAudioIpc(event, request, service)
  );
  ipcMain.handle("agent:list-markdown-context-documents", (event, workspaceSessionId: unknown) =>
    handleListMarkdownContextDocumentsIpc(event, workspaceSessionId, resolveWorkspaceRootForSession)
  );
  ipcMain.handle("agent:normalize-context-drop", (event, workspaceSessionId: unknown, absolutePath: unknown) =>
    handleNormalizeContextDropIpc(event, workspaceSessionId, absolutePath, resolveWorkspaceRootForSession)
  );
  ipcMain.handle("agent:start-run", (event, request: AgentRunRequest) =>
    service.startRun(request, (runEvent) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send("agent:run-event", runEvent);
      }
    })
  );
  ipcMain.handle("agent:cancel-run", (_event, runId: string) => {
    service.cancelRun(runId);
  });
  ipcMain.handle("agent:apply-patch", (_event, request: ApplyAgentPatchRequest) => service.applyPatch(request));
  ipcMain.handle("agent:apply-new-document", (_event, request: ApplyAgentCreateDocumentRequest) =>
    service.applyNewDocument(request)
  );
  ipcMain.handle("agent:list-proposals", (_event, workspaceRoot: string) => service.listProposals(workspaceRoot));
  ipcMain.handle("agent:external-capture-start", (event, request: unknown) =>
    handleStartExternalCaptureIpc(event, request, service, resolveWorkspaceRootForSession)
  );
  ipcMain.handle("agent:external-capture-finish", (event, request: unknown) =>
    handleFinishExternalCaptureIpc(event, request, service, resolveWorkspaceRootForSession)
  );
  ipcMain.handle("agent:external-capture-cancel", (event, request: unknown) =>
    handleCancelExternalCaptureIpc(event, request, service, resolveWorkspaceRootForSession)
  );
  ipcMain.handle("agent:apply-proposal-file", (_event, request: ApplyAgentProposalFileRequest) =>
    service.applyProposalFile(request)
  );
  ipcMain.handle("agent:reject-proposal-file", (_event, request: RejectAgentProposalFileRequest) =>
    service.rejectProposalFile(request)
  );
  ipcMain.handle("agent:reject-proposal", (_event, request: RejectAgentProposalRequest) =>
    service.rejectProposal(request)
  );
  ipcMain.handle("agent:resolve-proposal-hunk", (_event, request: ResolveAgentProposalHunkRequest) =>
    service.resolveProposalHunk(request)
  );
  ipcMain.handle("agent:list-chat-threads", (_event, workspaceRoot: string) => service.listChatThreads(workspaceRoot));
  ipcMain.handle("agent:get-chat-thread", (_event, request: { workspaceRoot: string; threadId: string }) =>
    service.getChatThread(request)
  );
  ipcMain.handle("agent:save-chat-thread", (_event, request: Parameters<AgentService["saveChatThread"]>[0]) =>
    service.saveChatThread(request)
  );
  ipcMain.handle("agent:clear-chat-history", (_event, workspaceRoot: string) => service.clearChatHistory(workspaceRoot));
  ipcMain.handle(
    "agent:generate-chat-thread-title",
    (_event, request: { workspaceRoot: string; threadId: string; language: "en" | "es" }) =>
      service.generateChatThreadTitle(request)
  );

  app.on("before-quit", () => {
    service.dispose();
  });
}

export async function handleListMarkdownContextDocumentsIpc(
  event: AgentIpcEvent,
  workspaceSessionId: unknown,
  resolveWorkspaceRootForSession: WorkspaceSessionResolver = defaultWorkspaceSessionResolver
): Promise<AgentMarkdownContextDocumentListResponse> {
  if (!isTrustedAgentIpcSender(event)) {
    return { files: [], truncated: false };
  }

  const workspaceRoot = await resolveWorkspaceRoot(event, workspaceSessionId, resolveWorkspaceRootForSession);

  if (!workspaceRoot) {
    return { files: [], truncated: false };
  }

  const documentTools = createAgentDocumentTools({ workspaceRoot });
  const result = await documentTools.listDocuments({
    depth: documentTools.limits.maxDepth,
    limit: documentTools.limits.maxListResults
  });

  return {
    files: result.files.map((file) => ({
      relativePath: file.relativePath,
      name: file.name,
      sizeBytes: file.sizeBytes,
      estimatedTokens: file.estimatedTokens
    })),
    truncated: result.truncated
  };
}

export async function handleNormalizeContextDropIpc(
  event: AgentIpcEvent,
  workspaceSessionId: unknown,
  absolutePath: unknown,
  resolveWorkspaceRootForSession: WorkspaceSessionResolver = defaultWorkspaceSessionResolver
): Promise<NormalizeContextDropResponse> {
  if (!isTrustedAgentIpcSender(event)) {
    return { ok: false, reason: "unsafe" };
  }

  if (typeof absolutePath !== "string" || !path.isAbsolute(absolutePath)) {
    return { ok: false, reason: "not_found" };
  }

  const workspaceRoot = await resolveWorkspaceRoot(event, workspaceSessionId, resolveWorkspaceRootForSession);

  if (!workspaceRoot) {
    return { ok: false, reason: "not_found" };
  }

  const relativePath = workspaceRelativePosixPath(workspaceRoot, absolutePath);

  if (relativePath === null) {
    return { ok: false, reason: "outside_workspace" };
  }

  try {
    const document = await createAgentDocumentTools({ workspaceRoot }).readDocument({ path: relativePath });
    return { ok: true, relativePath: document.relativePath };
  } catch (error) {
    return { ok: false, reason: normalizeContextDropFailureReason(error) };
  }
}

export function handleTranscribeAudioIpc(
  event: AgentIpcEvent,
  request: unknown,
  service: Pick<AgentService, "transcribeAudio">
) {
  if (!isTrustedAgentIpcSender(event)) {
    return untrustedTranscriptionResponse(request);
  }

  return service.transcribeAudio(request);
}

export function handleCodexCliProbeIpc(event: AgentIpcEvent, request: unknown) {
  if (!isTrustedAgentIpcSender(event)) {
    return untrustedCodexCliProbeResponse(request);
  }

  return probeCodexCli(normalizeCodexCliProbeRequest(request));
}

export async function handleStartExternalCaptureIpc(
  event: AgentIpcEvent,
  request: unknown,
  service: Pick<AgentService, "startExternalCapture">,
  resolveWorkspaceRootForSession: WorkspaceSessionResolver = defaultWorkspaceSessionResolver
) {
  if (!isTrustedAgentIpcSender(event)) {
    throw new Error("The external capture request came from an untrusted window.");
  }

  const workspaceRoot = await resolveWorkspaceRoot(
    event,
    captureWorkspaceSessionId(request),
    resolveWorkspaceRootForSession
  );

  if (!workspaceRoot) {
    throw new Error("External capture requires the current trusted workspace.");
  }

  return service.startExternalCapture({
    workspaceRoot,
    agentName: captureAgentName(request)
  });
}

export async function handleFinishExternalCaptureIpc(
  event: AgentIpcEvent,
  request: unknown,
  service: Pick<AgentService, "finishExternalCapture">,
  resolveWorkspaceRootForSession: WorkspaceSessionResolver = defaultWorkspaceSessionResolver
) {
  if (!isTrustedAgentIpcSender(event)) {
    throw new Error("The external capture request came from an untrusted window.");
  }

  const workspaceRoot = await resolveWorkspaceRoot(
    event,
    captureWorkspaceSessionId(request),
    resolveWorkspaceRootForSession
  );

  if (!workspaceRoot) {
    throw new Error("External capture requires the current trusted workspace.");
  }

  return service.finishExternalCapture({
    workspaceRoot,
    captureId: captureIdFromRequest(request)
  });
}

export async function handleCancelExternalCaptureIpc(
  event: AgentIpcEvent,
  request: unknown,
  service: Pick<AgentService, "cancelExternalCapture">,
  resolveWorkspaceRootForSession: WorkspaceSessionResolver = defaultWorkspaceSessionResolver
) {
  if (!isTrustedAgentIpcSender(event)) {
    throw new Error("The external capture request came from an untrusted window.");
  }

  const workspaceRoot = await resolveWorkspaceRoot(
    event,
    captureWorkspaceSessionId(request),
    resolveWorkspaceRootForSession
  );

  if (!workspaceRoot) {
    throw new Error("External capture requires the current trusted workspace.");
  }

  return service.cancelExternalCapture({
    workspaceRoot,
    captureId: captureIdFromRequest(request)
  });
}

export function handleCodexStatusIpc(
  event: AgentIpcEvent,
  service: Pick<AgentService, "codexStatus">
) {
  if (!isTrustedAgentIpcSender(event)) {
    return untrustedCodexAccountResponse("The Codex account request came from an untrusted window.");
  }

  return service.codexStatus();
}

export function handleCodexStartDeviceLoginIpc(
  event: AgentIpcEvent,
  service: Pick<AgentService, "startCodexDeviceLogin">
) {
  if (!isTrustedAgentIpcSender(event)) {
    return untrustedCodexDeviceLoginResponse("The Codex login request came from an untrusted window.");
  }

  return service.startCodexDeviceLogin();
}

export function handleCodexCancelLoginIpc(
  event: AgentIpcEvent,
  service: Pick<AgentService, "cancelCodexLogin">
) {
  if (!isTrustedAgentIpcSender(event)) {
    return untrustedCodexAccountResponse("The Codex login cancellation came from an untrusted window.");
  }

  return service.cancelCodexLogin();
}

export function handleCodexLogoutIpc(
  event: AgentIpcEvent,
  service: Pick<AgentService, "logoutCodex">
) {
  if (!isTrustedAgentIpcSender(event)) {
    return untrustedCodexAccountResponse("The Codex logout request came from an untrusted window.");
  }

  return service.logoutCodex();
}

export async function handleCodexOpenDeviceLoginIpc(
  event: AgentIpcEvent,
  openExternal: Pick<typeof shell, "openExternal"> = shell
): Promise<CodexOpenDeviceLoginResponse> {
  if (!isTrustedAgentIpcSender(event)) {
    return {
      ok: false,
      error: {
        code: "untrusted_ipc_sender",
        message: "The Codex device-login request came from an untrusted window."
      }
    };
  }

  await openExternal.openExternal(OPENAI_CODEX_DEVICE_URL);
  return { ok: true };
}

export function isTrustedAgentIpcSender(event: AgentIpcEvent) {
  if (!BrowserWindow.fromWebContents(event.sender)) {
    return false;
  }

  return isTrustedAgentSenderFrameUrl(event.senderFrame?.url ?? "", process.env.VITE_DEV_SERVER_URL);
}

export function isTrustedAgentSenderFrameUrl(frameUrl: string, devServerUrl: string | undefined) {
  const parsedFrameUrl = parseUrl(frameUrl);

  if (!parsedFrameUrl) {
    return false;
  }

  if (!devServerUrl) {
    return parsedFrameUrl.protocol === "file:";
  }

  const parsedDevServerUrl = parseUrl(devServerUrl);
  return Boolean(parsedDevServerUrl && parsedFrameUrl.origin === parsedDevServerUrl.origin);
}

function untrustedTranscriptionResponse(request: unknown): AgentTranscribeAudioResponse {
  return transcriptionFailedResponse(requestIdFromTranscriptionRequest(request), {
    code: "unknown",
    userMessage: "The dictation request came from an untrusted window.",
    detail: "untrusted_ipc_sender",
    retryable: false
  });
}

function untrustedCodexCliProbeResponse(request: unknown): CodexCliProbeResponse {
  const normalized = normalizeCodexCliProbeRequest(request);
  return {
    ok: false,
    executablePath: normalized.executablePath?.trim() || "codex",
    error: {
      code: "failed",
      message: "The Codex CLI probe came from an untrusted window.",
      detail: "untrusted_ipc_sender"
    }
  };
}

function untrustedCodexAccountResponse(message: string): CodexAccountStatusResponse {
  return {
    available: false,
    connected: false,
    requiresOpenaiAuth: true,
    pendingLogin: false,
    error: {
      code: "untrusted_ipc_sender",
      message,
      detail: "untrusted_ipc_sender"
    }
  };
}

function untrustedCodexDeviceLoginResponse(message: string): CodexDeviceLoginResponse {
  return untrustedCodexAccountResponse(message);
}

function captureWorkspaceSessionId(request: unknown) {
  return request && typeof request === "object" && "workspaceSessionId" in request
    ? request.workspaceSessionId
    : undefined;
}

function captureIdFromRequest(request: unknown) {
  if (request && typeof request === "object" && "captureId" in request && typeof request.captureId === "string") {
    return request.captureId;
  }

  throw new Error("External capture id is required.");
}

function captureAgentName(request: unknown) {
  if (request && typeof request === "object" && "agentName" in request && typeof request.agentName === "string") {
    return request.agentName;
  }

  return undefined;
}

function parseUrl(url: string) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

async function resolveWorkspaceRoot(
  event: AgentIpcEvent,
  workspaceSessionId: unknown,
  resolveWorkspaceRootForSession: WorkspaceSessionResolver
) {
  if (typeof workspaceSessionId !== "string" || !workspaceSessionId.trim()) {
    return null;
  }

  const workspaceRoot = await resolveWorkspaceRootForSession(event, workspaceSessionId.trim());

  return typeof workspaceRoot === "string" && workspaceRoot.trim() ? path.resolve(workspaceRoot) : null;
}

async function defaultWorkspaceSessionResolver(_event: AgentIpcEvent, workspaceSessionId: string) {
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

function workspaceRelativePosixPath(workspaceRoot: string, absolutePath: string) {
  const root = path.resolve(workspaceRoot);
  const target = path.resolve(absolutePath);
  const relativePath = path.relative(root, target);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return null;
  }

  return relativePath.split(path.sep).join(path.posix.sep);
}

function normalizeContextDropFailureReason(error: unknown): Extract<NormalizeContextDropResponse, { ok: false }>["reason"] {
  if (!(error instanceof AgentDocumentToolError)) {
    return "unsafe";
  }

  switch (error.code) {
    case "not_found":
      return "not_found";
    case "not_markdown":
      return "not_markdown";
    case "invalid_input":
    case "invalid_path":
    case "workspace_unavailable":
    case "not_directory":
    case "not_file":
    case "symlink_path":
    case "oversized":
    case "unreadable":
      return "unsafe";
  }
}
