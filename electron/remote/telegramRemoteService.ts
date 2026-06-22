import crypto from "node:crypto";
import path from "node:path";
import { AgentService, type AgentStartRunOptions } from "../agent/agentService.js";
import { AgentChatHistoryStore } from "../agent/chatHistoryStore.js";
import { markdownExtensions } from "../fs/pathSafety.js";
import type {
  AgentChatHistoryEntry,
  AgentRunContextItem,
  AgentRunContextManifest,
  AgentRunEventListener,
  AgentRunRequest,
  AgentRunResponse
} from "../agent/types.js";
import { RemoteSettingsStore } from "./remoteSettingsStore.js";
import {
  TELEGRAM_REMOTE_MAX_TEXT_LENGTH,
  TELEGRAM_REMOTE_REQUEST_VERSION,
  type RemoteAnswerSource,
  type RemoteAskRequest,
  type RemoteErrorCode,
  type RemoteRequest,
  type RemoteResponse,
  type RemoteStatusRequest,
  type RemoteWorkspaceContext,
  type TelegramRemoteSettings,
  type TelegramRemoteSettingsUpdate
} from "./remoteTypes.js";

export const TELEGRAM_REMOTE_DEFAULT_THREAD_ID = "telegram-remote";

export interface TelegramRemoteAgentRunner {
  startRun(
    request: AgentRunRequest,
    emitRunEvent?: AgentRunEventListener,
    options?: AgentStartRunOptions
  ): Promise<AgentRunResponse>;
  cancelRun?(runId: string): void;
}

export interface TelegramRemoteServiceOptions {
  userDataPath: string;
  getCurrentWorkspace: () => RemoteWorkspaceContext | null | Promise<RemoteWorkspaceContext | null>;
  settingsStore?: RemoteSettingsStore;
  agentService?: TelegramRemoteAgentRunner;
  chatHistoryStore?: AgentChatHistoryStore;
  now?: () => Date;
  maxTextLength?: number;
  language?: AgentRunRequest["language"];
}

interface ValidRemoteContext {
  workspace: RemoteWorkspaceContext;
  settings: TelegramRemoteSettings;
}

export class TelegramRemoteService {
  private readonly settingsStore: RemoteSettingsStore;
  private readonly agentService: TelegramRemoteAgentRunner;
  private readonly chatHistoryStore: AgentChatHistoryStore;
  private readonly now: () => Date;
  private readonly maxTextLength: number;
  private readonly language: AgentRunRequest["language"];
  private activeRemoteRunId: string | null = null;

  constructor(private readonly options: TelegramRemoteServiceOptions) {
    this.settingsStore = options.settingsStore ?? new RemoteSettingsStore(options.userDataPath);
    this.chatHistoryStore = options.chatHistoryStore ?? new AgentChatHistoryStore(options.userDataPath);
    this.agentService =
      options.agentService ?? new AgentService(options.userDataPath, { chatHistoryStore: this.chatHistoryStore });
    this.now = options.now ?? (() => new Date());
    this.maxTextLength = options.maxTextLength ?? TELEGRAM_REMOTE_MAX_TEXT_LENGTH;
    this.language = options.language ?? "en";
  }

  settings() {
    return this.settingsStore.snapshot();
  }

  async updateSettings(update: TelegramRemoteSettingsUpdate) {
    if (update.enabled === false) {
      this.cancelActiveRemoteRun();
    }

    return this.settingsStore.update(update);
  }

  async revokePairing() {
    this.cancelActiveRemoteRun();
    return this.settingsStore.revokePairing();
  }

  async handleRequest(input: unknown): Promise<RemoteResponse> {
    const request = normalizeRemoteRequest(input);

    if (!request.ok) {
      return remoteError({ id: request.id }, "unknown", request.message);
    }

    if (request.value.type === "status") {
      return this.status(request.value);
    }

    return this.ask(request.value);
  }

  async status(request: RemoteStatusRequest): Promise<RemoteResponse> {
    const validation = await this.validateRemoteContext(request);

    if ("error" in validation) {
      return validation.error;
    }

    return {
      version: TELEGRAM_REMOTE_REQUEST_VERSION,
      id: request.id,
      ok: true,
      type: "status",
      desktopOnline: true,
      workspaceLabel: workspaceLabel(validation.workspace),
      remoteChatEnabled: true
    };
  }

  async ask(request: RemoteAskRequest): Promise<RemoteResponse> {
    const validation = await this.validateRemoteContext(request);

    if ("error" in validation) {
      return validation.error;
    }

    const text = normalizeQuestion(request.text);

    if (!text) {
      return remoteError(request, "empty_question", "Send a question to ask Iliad about this workspace.");
    }

    if (text.length > this.maxTextLength) {
      return remoteError(request, "question_too_long", `Remote questions must be ${this.maxTextLength} characters or fewer.`);
    }

    if (this.activeRemoteRunId) {
      return remoteError(request, "busy", "Iliad is already answering a remote question. Try again in a moment.");
    }

    const targetThreadId = resolveRemoteTargetThreadId(validation.settings, validation.workspace.root);
    const runId = remoteRunId(request.id);
    const deadlineTimer = this.scheduleDeadlineCancellation(request, runId);
    this.activeRemoteRunId = runId;

    try {
      const priorMessages = await this.loadRemoteThreadMessages(validation.workspace.root, targetThreadId);
      const response = await this.agentService.startRun(
        {
          runId,
          workspaceRoot: validation.workspace.root,
          runProfile: "remote_read_only",
          activeFile: null,
          messages: priorMessages,
          prompt: remoteAskPrompt(text),
          mode: "balanced",
          language: this.language
        },
        undefined,
        { proposalPolicy: "suppress" }
      );

      if (this.isPastDeadline(request)) {
        const error = remoteError(request, "deadline_exceeded", "The remote request deadline expired.");
        await this.persistAcceptedAskFailure(validation.workspace.root, targetThreadId, request, text, error);
        return error;
      }

      if (response.error) {
        const error = remoteError(request, remoteErrorCodeForAgentError(response.error.code), remoteAgentErrorMessage(response.error.code));
        await this.persistAcceptedAskFailure(validation.workspace.root, targetThreadId, request, text, error);
        return error;
      }

      if (containsProposalMarker(response.text)) {
        const error = remoteError(request, "agent_unavailable", "Iliad rejected an edit-shaped answer from a read-only remote run.");
        await this.persistAcceptedAskFailure(validation.workspace.root, targetThreadId, request, text, error);
        return error;
      }

      const sources = answerSourcesFromContextManifest(response.contextManifest);

      if (sources.length === 0 && !isNoContextAnswer(response.text)) {
        const error = remoteError(request, "agent_unavailable", "Iliad could not verify which Markdown file supports that answer.");
        await this.persistAcceptedAskFailure(validation.workspace.root, targetThreadId, request, text, error);
        return error;
      }

      const answer: RemoteResponse = {
        version: TELEGRAM_REMOTE_REQUEST_VERSION,
        id: request.id,
        ok: true,
        type: "answer",
        text: normalizeAnswerText(response.text),
        sources,
        ...(response.contextManifest?.id ? { manifestId: response.contextManifest.id } : {})
      };
      await this.persistAcceptedAskSuccess(validation.workspace.root, targetThreadId, request, text, answer.text, sources);
      return answer;
    } catch {
      const error = remoteError(request, "unknown", "Iliad could not complete the remote request.");
      await this.persistAcceptedAskFailure(validation.workspace.root, targetThreadId, request, text, error);
      return error;
    } finally {
      clearTimeout(deadlineTimer);
      if (this.activeRemoteRunId === runId) {
        this.activeRemoteRunId = null;
      }
    }
  }

  private async validateRemoteContext(request: RemoteRequest): Promise<ValidRemoteContext | { error: RemoteResponse }> {
    const settings = await this.settingsStore.snapshot();

    if (!settings.enabled) {
      return { error: remoteError(request, "remote_disabled", "Telegram Remote Chat is disabled on this desktop.") };
    }

    if (!settings.pairedChat || settings.pairedChat.chatId !== request.chatId) {
      return { error: remoteError(request, "not_paired", "This Telegram chat is not paired with Iliad.") };
    }

    if (this.isPastDeadline(request)) {
      return { error: remoteError(request, "deadline_exceeded", "The remote request deadline expired.") };
    }

    const workspace = await this.options.getCurrentWorkspace();

    if (!workspace?.root) {
      return { error: remoteError(request, "workspace_unavailable", "No Iliad workspace is open on this desktop.") };
    }

    if (!settings.boundWorkspaceRoot) {
      return {
        error: remoteError(
          request,
          "workspace_unavailable",
          "Telegram Remote Chat is not bound to an Iliad workspace. Re-enable it for this workspace."
        )
      };
    }

    if (path.resolve(settings.boundWorkspaceRoot) !== path.resolve(workspace.root)) {
      return {
        error: remoteError(
          request,
          "workspace_unavailable",
          "Telegram Remote Chat is bound to a different Iliad workspace. Re-enable it for this workspace."
        )
      };
    }

    return { workspace, settings };
  }

  private async loadRemoteThreadMessages(
    workspaceRoot: string,
    threadId: string
  ): Promise<AgentRunRequest["messages"]> {
    const thread = await this.chatHistoryStore.getThread(workspaceRoot, threadId);

    return (thread?.entries ?? [])
      .filter((entry): entry is AgentChatHistoryEntry & { kind: "user" | "assistant" } =>
        entry.kind === "user" || entry.kind === "assistant"
      )
      .map((entry) => ({
        role: entry.kind,
        content: entry.text
      }));
  }

  private isPastDeadline(request: RemoteRequest) {
    if (!request.deadlineAt) {
      return false;
    }

    const deadlineMs = Date.parse(request.deadlineAt);
    return !Number.isFinite(deadlineMs) || deadlineMs <= this.now().getTime();
  }

  private scheduleDeadlineCancellation(request: RemoteRequest, runId: string) {
    if (!request.deadlineAt || !this.agentService.cancelRun) {
      return undefined;
    }

    const deadlineMs = Date.parse(request.deadlineAt);

    if (!Number.isFinite(deadlineMs)) {
      return undefined;
    }

    const delayMs = Math.max(0, deadlineMs - this.now().getTime());
    return setTimeout(() => {
      this.agentService.cancelRun?.(runId);
    }, delayMs);
  }

  private cancelActiveRemoteRun() {
    if (this.activeRemoteRunId) {
      this.agentService.cancelRun?.(this.activeRemoteRunId);
    }
  }

  private async persistAcceptedAskSuccess(
    workspaceRoot: string,
    targetThreadId: string,
    request: RemoteAskRequest,
    question: string,
    answer: string,
    sources: RemoteAnswerSource[]
  ) {
    await this.appendRemoteHistoryTurn(
      workspaceRoot,
      targetThreadId,
      request,
      remoteHistoryEntries(request, question, "assistant", visibleRemoteAnswerText(answer, sources), this.now().toISOString())
    );
  }

  private async persistAcceptedAskFailure(
    workspaceRoot: string,
    targetThreadId: string,
    request: RemoteAskRequest,
    question: string,
    response: RemoteResponse
  ) {
    if (response.ok) {
      return;
    }

    await this.appendRemoteHistoryTurn(
      workspaceRoot,
      targetThreadId,
      request,
      remoteHistoryEntries(request, question, "error", response.error.message, this.now().toISOString())
    );
  }

  private async appendRemoteHistoryTurn(
    workspaceRoot: string,
    targetThreadId: string,
    request: RemoteAskRequest,
    entries: AgentChatHistoryEntry[]
  ) {
    try {
      if (await this.hasPersistedRemoteRequest(workspaceRoot, request)) {
        return;
      }

      await this.chatHistoryStore.appendThreadEntries({
        workspaceRoot,
        threadId: targetThreadId,
        entries
      });
    } catch (error) {
      console.warn("telegram:remote history persistence failed", error);
    }
  }

  private async hasPersistedRemoteRequest(workspaceRoot: string, request: RemoteAskRequest) {
    const requestKey = remoteHistoryRequestKey(request.id);
    const requestEntryPrefix = `telegram:${requestKey}:`;
    const threads = await this.chatHistoryStore.listThreads(workspaceRoot);

    for (const summary of threads) {
      const thread = await this.chatHistoryStore.getThread(workspaceRoot, summary.id);
      if (thread?.entries.some((entry) => entry.id.startsWith(requestEntryPrefix))) {
        return true;
      }
    }

    return false;
  }
}

function resolveRemoteTargetThreadId(settings: TelegramRemoteSettings, workspaceRoot: string) {
  if (
    settings.activeThreadId &&
    settings.activeThreadWorkspaceRoot &&
    settings.boundWorkspaceRoot &&
    path.resolve(settings.activeThreadWorkspaceRoot) === path.resolve(settings.boundWorkspaceRoot) &&
    path.resolve(settings.boundWorkspaceRoot) === path.resolve(workspaceRoot)
  ) {
    return settings.activeThreadId;
  }

  return TELEGRAM_REMOTE_DEFAULT_THREAD_ID;
}

function normalizeRemoteRequest(input: unknown): { ok: true; value: RemoteRequest } | { ok: false; id: string; message: string } {
  const source = isRecord(input) ? input : {};
  const id = typeof source.id === "string" && source.id.trim() ? source.id.trim() : "remote-request";

  if (source.version !== TELEGRAM_REMOTE_REQUEST_VERSION) {
    return { ok: false, id, message: "Unsupported remote request version." };
  }

  const type = source.type;

  if (type !== "status" && type !== "ask") {
    return { ok: false, id, message: "Unsupported remote request type." };
  }

  const chatId = typeof source.chatId === "string" ? source.chatId.trim() : "";
  const createdAt = typeof source.createdAt === "string" ? source.createdAt.trim() : "";
  const deadlineAt = typeof source.deadlineAt === "string" ? source.deadlineAt.trim() : "";

  if (!id || !chatId || !createdAt || !deadlineAt) {
    return { ok: false, id, message: "Invalid remote request envelope." };
  }

  if (type === "status") {
    return {
      ok: true,
      value: {
        version: TELEGRAM_REMOTE_REQUEST_VERSION,
        id,
        type,
        chatId,
        createdAt,
        deadlineAt
      }
    };
  }

  if (typeof source.text !== "string") {
    return { ok: false, id, message: "Invalid remote ask request." };
  }

  return {
    ok: true,
    value: {
      version: TELEGRAM_REMOTE_REQUEST_VERSION,
      id,
      type,
      chatId,
      createdAt,
      deadlineAt,
      text: source.text
    }
  };
}

export function remoteAskPrompt(question: string) {
  return [
    "Telegram Remote Chat is read-only.",
    "Answer the user's question using only this workspace's Markdown documents and Iliad document tools.",
    "Do not edit files, create files, propose document changes, or include edit marker blocks.",
    "If the user asks you to change the workspace, explain that Telegram Remote Chat can only answer questions.",
    "Read the smallest relevant set of Markdown files before giving a content-dependent answer.",
    "Cite the relative Markdown paths you used in the answer text.",
    "If there is not enough relevant Markdown context, say that plainly and ask for a more specific question.",
    "",
    `Question: ${question}`
  ].join("\n");
}

export function answerSourcesFromContextManifest(
  contextManifest: AgentRunContextManifest | undefined
): RemoteAnswerSource[] {
  const sources: RemoteAnswerSource[] = [];
  const seen = new Set<string>();

  for (const item of contextManifest?.items ?? []) {
    const source = answerSourceFromContextItem(item);

    if (!source || seen.has(source.relativePath)) {
      continue;
    }

    seen.add(source.relativePath);
    sources.push(source);
  }

  return sources;
}

function answerSourceFromContextItem(item: AgentRunContextItem): RemoteAnswerSource | null {
  if (item.kind !== "document_read" || !item.relativePath) {
    return null;
  }

  // Workspace rules (ADR-0018) are standing preferences, not the evidence an
  // answer cites; counting them would also permanently neutralize the
  // unverifiable-answer guard.
  if (item.reason === "workspace_rules") {
    return null;
  }

  const relativePath = safeRelativeMarkdownPath(item.relativePath);

  if (!relativePath) {
    return null;
  }

  const line = (item as { line?: unknown }).line;
  return {
    relativePath,
    ...(typeof line === "number" && Number.isFinite(line) && line > 0 ? { line: Math.floor(line) } : {})
  };
}

function safeRelativeMarkdownPath(value: string) {
  if (path.isAbsolute(value)) {
    return null;
  }

  const normalized = value.replace(/\\/g, "/");
  const segments = normalized.split("/");

  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return null;
  }

  return markdownExtensions.has(path.posix.extname(normalized).toLowerCase()) ? normalized : null;
}

function workspaceLabel(workspace: RemoteWorkspaceContext) {
  const label = workspace.label?.trim();
  return label || path.basename(path.resolve(workspace.root)) || "Workspace";
}

function normalizeQuestion(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function normalizeAnswerText(text: string) {
  return text.trim() || "I could not produce an answer from the available workspace context.";
}

export function visibleRemoteAnswerText(text: string, sources: RemoteAnswerSource[]) {
  const answer = normalizeAnswerText(text);

  if (sources.length === 0) {
    return answer;
  }

  return [
    answer,
    "",
    "Sources:",
    ...sources.map((source) => `- ${source.relativePath}${source.line ? `:${source.line}` : ""}`)
  ].join("\n");
}

function remoteHistoryEntries(
  request: RemoteAskRequest,
  question: string,
  terminalKind: "assistant" | "error",
  terminalText: string,
  createdAt: string
): AgentChatHistoryEntry[] {
  const requestKey = remoteHistoryRequestKey(request.id);
  return [
    {
      id: `telegram:${requestKey}:user`,
      kind: "user",
      text: question,
      createdAt,
      source: "telegram"
    },
    {
      id: `telegram:${requestKey}:${terminalKind}`,
      kind: terminalKind,
      text: terminalText,
      createdAt,
      source: "telegram"
    }
  ];
}

function remoteHistoryRequestKey(requestId: string) {
  return crypto.createHash("sha256").update(requestId).digest("hex").slice(0, 32);
}

function containsProposalMarker(text: string) {
  return /\b(?:FULL_REPLACEMENT|NEW_DOCUMENT|DELETE_DOCUMENT)\s*:|^<{7} SEARCH[ \t]*$/im.test(text);
}

function isNoContextAnswer(text: string) {
  return /not enough|could not find|couldn't find|no relevant|no encontre|no encontr[eé]|no hay suficiente/i.test(text);
}

function remoteRunId(requestId: string) {
  return `remote-${requestId.replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 80)}-${Date.now()}`;
}

function remoteError(request: Pick<RemoteRequest, "id">, code: RemoteErrorCode, message: string): RemoteResponse {
  return {
    version: TELEGRAM_REMOTE_REQUEST_VERSION,
    id: request.id,
    ok: false,
    error: {
      code,
      message
    }
  };
}

function remoteErrorCodeForAgentError(agentCode: string): RemoteErrorCode {
  if (agentCode === "rate_limited") {
    return "rate_limited";
  }

  return "agent_unavailable";
}

function remoteAgentErrorMessage(agentCode: string) {
  if (agentCode === "missing_api_key") {
    return "Iliad needs an agent provider configured on the desktop before Telegram Remote Chat can answer.";
  }

  if (agentCode === "rate_limited") {
    return "The agent provider is rate limited. Try again later.";
  }

  return "Iliad could not complete the remote answer.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
