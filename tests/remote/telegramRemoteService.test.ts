import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentService, type AgentStartRunOptions } from "../../electron/agent/agentService";
import { AgentChatHistoryStore } from "../../electron/agent/chatHistoryStore";
import { openAiRequestBody } from "../../electron/agent/openai/request";
import { OPENAI_RESPONSES_PROVIDER_METADATA } from "../../electron/agent/runtime/openaiResponsesProvider";
import type {
  AgentDraftFileChange,
  AgentProviderRunRequest,
  AgentProviderResponse,
  AgentRunContextItem,
  AgentRunContextManifest,
  AgentRunRequest,
  AgentRunResponse
} from "../../electron/agent/types";
import { RemoteSettingsStore } from "../../electron/remote/remoteSettingsStore";
import {
  TELEGRAM_REMOTE_REQUEST_VERSION,
  type RemoteAskRequest,
  type RemoteStatusRequest
} from "../../electron/remote/remoteTypes";
import {
  TELEGRAM_REMOTE_DEFAULT_THREAD_ID,
  TelegramRemoteService,
  type TelegramRemoteAgentRunner
} from "../../electron/remote/telegramRemoteService";

let workspaceRoot = "";
let userData = "";
const now = new Date("2026-05-27T12:00:00.000Z");

beforeEach(async () => {
  workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "iliad-remote-workspace-"));
  userData = await mkdtemp(path.join(os.tmpdir(), "iliad-remote-userdata-"));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(workspaceRoot, { recursive: true, force: true });
  await rm(userData, { recursive: true, force: true });
});

class FakeAgentRunner implements TelegramRemoteAgentRunner {
  readonly requests: AgentRunRequest[] = [];
  readonly options: AgentStartRunOptions[] = [];
  readonly cancelRun = vi.fn();
  nextResponse: AgentRunResponse | Promise<AgentRunResponse> = agentResponse();

  async startRun(
    request: AgentRunRequest,
    _emitRunEvent?: unknown,
    options: AgentStartRunOptions = {}
  ): Promise<AgentRunResponse> {
    this.requests.push(request);
    this.options.push(options);
    return this.nextResponse;
  }
}

describe("TelegramRemoteService", () => {
  it("returns status for the paired chat and persists settings", async () => {
    const settingsStore = new RemoteSettingsStore(userData);
    await settingsStore.update({
      enabled: true,
      relayDeviceId: "device-1",
      deviceSecret: "secret-1",
      pairedChat: pairedChat(),
      boundWorkspaceRoot: workspaceRoot
    });

    const persisted = await new RemoteSettingsStore(userData).snapshot();
    expect(persisted).toMatchObject({
      enabled: true,
      relayDeviceId: "device-1",
      pairedChat: { chatId: "chat-1", username: "sebastian" }
    });

    const service = remoteService({ settingsStore });
    await expect(service.handleRequest(statusRequest())).resolves.toEqual({
      version: TELEGRAM_REMOTE_REQUEST_VERSION,
      id: "status-1",
      ok: true,
      type: "status",
      desktopOnline: true,
      workspaceLabel: "Course Notes",
      remoteChatEnabled: true
    });
  });

  it("rejects asks when the chat is not paired", async () => {
    const settingsStore = new RemoteSettingsStore(userData);
    const agent = new FakeAgentRunner();
    await settingsStore.update({ enabled: true });

    const service = remoteService({ settingsStore, agent });
    const response = await service.handleRequest(askRequest());

    expect(response).toMatchObject({
      ok: false,
      error: { code: "not_paired" }
    });
    expect(agent.requests).toHaveLength(0);
  });

  it("rejects disabled, missing-workspace, empty, and oversized asks before invoking the agent", async () => {
    const agent = new FakeAgentRunner();
    const disabledSettings = new RemoteSettingsStore(userData);
    await disabledSettings.update({ enabled: false, pairedChat: pairedChat() });

    await expect(remoteService({ settingsStore: disabledSettings, agent }).handleRequest(askRequest())).resolves.toMatchObject({
      ok: false,
      error: { code: "remote_disabled" }
    });

    const enabledSettings = await enabledPairedSettings();
    await expect(
      remoteService({ settingsStore: enabledSettings, agent, workspace: null }).handleRequest(askRequest())
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "workspace_unavailable" }
    });

    await expect(remoteService({ settingsStore: enabledSettings, agent }).handleRequest(askRequest({ text: "   " }))).resolves.toMatchObject({
      ok: false,
      error: { code: "empty_question" }
    });

    await expect(
      remoteService({ settingsStore: enabledSettings, agent, maxTextLength: 8 }).handleRequest(
        askRequest({ text: "This question is too long." })
      )
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "question_too_long" }
    });

    expect(agent.requests).toHaveLength(0);
    await expect(new AgentChatHistoryStore(userData).listThreads(workspaceRoot)).resolves.toEqual([]);
  });

  it("rejects a second active ask as busy", async () => {
    const settingsStore = await enabledPairedSettings();
    const agent = new FakeAgentRunner();
    const deferred = createDeferred<AgentRunResponse>();
    agent.nextResponse = deferred.promise;

    const service = remoteService({ settingsStore, agent });
    const first = service.handleRequest(askRequest({ id: "ask-1", text: "What did we decide?" }));
    await waitFor(() => agent.requests.length === 1);

    const second = await service.handleRequest(askRequest({ id: "ask-2", text: "What about the rubric?" }));
    expect(second).toMatchObject({
      ok: false,
      error: { code: "busy" }
    });

    deferred.resolve(agentResponse({ runId: agent.requests[0].runId }));
    await expect(first).resolves.toMatchObject({ ok: true, type: "answer" });
    const thread = await new AgentChatHistoryStore(userData).getThread(workspaceRoot, TELEGRAM_REMOTE_DEFAULT_THREAD_ID);
    expect(thread?.entries).toHaveLength(2);
    expect(JSON.stringify(thread)).not.toContain("What about the rubric?");
  });

  it("rejects a second ask while the first ask is loading remote history", async () => {
    const settingsStore = await enabledPairedSettings();
    const agent = new FakeAgentRunner();
    const chatHistoryStore = new AgentChatHistoryStore(userData);
    const historyRead = createDeferred<void>();
    const originalGetThread = chatHistoryStore.getThread.bind(chatHistoryStore);
    const getThread = vi.spyOn(chatHistoryStore, "getThread").mockImplementation(async (root, threadId) => {
      await historyRead.promise;
      return originalGetThread(root, threadId);
    });

    const service = remoteService({ settingsStore, agent, chatHistoryStore });
    const first = service.handleRequest(askRequest({ id: "ask-loading", text: "First question?" }));
    await waitFor(() => getThread.mock.calls.length === 1);

    const second = await service.handleRequest(askRequest({ id: "ask-loading-second", text: "Second question?" }));
    expect(second).toMatchObject({
      ok: false,
      error: { code: "busy" }
    });
    expect(agent.requests).toHaveLength(0);

    historyRead.resolve();
    await expect(first).resolves.toMatchObject({ ok: true, type: "answer" });
    expect(agent.requests).toHaveLength(1);
  });

  it("rejects expired request deadlines before invoking the agent", async () => {
    const settingsStore = await enabledPairedSettings();
    const agent = new FakeAgentRunner();
    const service = remoteService({ settingsStore, agent });

    const response = await service.handleRequest(
      askRequest({
        deadlineAt: new Date(now.getTime() - 1).toISOString()
      })
    );

    expect(response).toMatchObject({
      ok: false,
      error: { code: "deadline_exceeded" }
    });
    expect(agent.requests).toHaveLength(0);
  });

  it("rejects malformed remote request envelopes before invoking the agent", async () => {
    const settingsStore = await enabledPairedSettings();
    const agent = new FakeAgentRunner();
    const service = remoteService({ settingsStore, agent });

    await expect(service.handleRequest({ version: TELEGRAM_REMOTE_REQUEST_VERSION, id: "bad-type", type: "files" })).resolves.toMatchObject({
      ok: false,
      id: "bad-type",
      error: { code: "unknown" }
    });
    await expect(service.handleRequest({ ...askRequest({ id: "bad-text" }), text: 42 })).resolves.toMatchObject({
      ok: false,
      id: "bad-text",
      error: { code: "unknown" }
    });
    expect(agent.requests).toHaveLength(0);
  });

  it("invokes AgentService read-only with no active file and returns document_read sources", async () => {
    const settingsStore = await enabledPairedSettings();
    const agent = new FakeAgentRunner();
    agent.nextResponse = agentResponse({
      text: "Use the final rubric from the workshop notes.",
      contextManifest: manifest([
        documentReadItem("notes/workshop.md"),
        documentReadItem("rubrics/final.md"),
        documentReadItem("notes/workshop.md"),
        { ...documentReadItem("../secret.md"), id: "bad-source" },
        {
          id: "reference",
          kind: "document_reference",
          label: "Missing",
          inclusion: "excluded",
          reason: "model_directed_document_read_failed",
          relativePath: "missing.md"
        },
        // Compaction summary rows are never citable sources: the kind filter
        // excludes them (ADR-0015), or every long-thread answer would "cite"
        // the conversation itself and neutralize the unverifiable-answer guard.
        {
          id: "conversation-summary",
          kind: "conversation_history",
          label: "Earlier conversation summary",
          inclusion: "full",
          reason: "conversation_summary",
          resultCount: 9
        }
      ])
    });

    const service = remoteService({ settingsStore, agent });
    const response = await service.handleRequest(askRequest({ text: "What did I decide about the final rubric?" }));

    expect(response).toEqual({
      version: TELEGRAM_REMOTE_REQUEST_VERSION,
      id: "ask-1",
      ok: true,
      type: "answer",
      text: "Use the final rubric from the workshop notes.",
      sources: [{ relativePath: "notes/workshop.md" }, { relativePath: "rubrics/final.md" }],
      manifestId: "manifest-remote-run"
    });
    expect(agent.requests).toHaveLength(1);
    expect(agent.requests[0]).toMatchObject({
      workspaceRoot,
      runProfile: "remote_read_only",
      activeFile: null,
      messages: [],
      mode: "balanced",
      language: "en"
    });
    expect(agent.requests[0].prompt).toContain("Question: What did I decide about the final rubric?");
    expect(agent.requests[0].prompt).toContain("Telegram Remote Chat is read-only.");
    expect(agent.options).toEqual([{ proposalPolicy: "suppress" }]);

    const thread = await new AgentChatHistoryStore(userData).getThread(workspaceRoot, TELEGRAM_REMOTE_DEFAULT_THREAD_ID);
    expect(thread?.entries).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^telegram:[a-f0-9]{32}:user$/),
        kind: "user",
        text: "What did I decide about the final rubric?",
        source: "telegram"
      }),
      expect.objectContaining({
        id: expect.stringMatching(/^telegram:[a-f0-9]{32}:assistant$/),
        kind: "assistant",
        text: "Use the final rubric from the workshop notes.\n\nSources:\n- notes/workshop.md\n- rubrics/final.md",
        source: "telegram"
      })
    ]);
    expect(JSON.stringify(thread)).not.toContain("manifest-remote-run");
    expect(JSON.stringify(thread)).not.toContain("chat-1");
    expect(JSON.stringify(thread)).not.toContain("sebastian");
  });

  it("uses the active thread for prior messages and history append", async () => {
    const settingsStore = await enabledPairedSettings();
    await settingsStore.update({
      activeThreadId: "thread-active",
      activeThreadWorkspaceRoot: workspaceRoot
    });
    await new AgentChatHistoryStore(userData).appendThreadEntries({
      workspaceRoot,
      threadId: "thread-active",
      entries: [
        {
          id: "prior-user",
          kind: "user",
          text: "Desktop question",
          createdAt: now.toISOString()
        },
        {
          id: "prior-status",
          kind: "status",
          text: "Working",
          createdAt: now.toISOString()
        },
        {
          id: "prior-assistant",
          kind: "assistant",
          text: "Desktop answer",
          createdAt: now.toISOString()
        },
        {
          id: "prior-error",
          kind: "error",
          text: "Ignored failure",
          createdAt: now.toISOString()
        }
      ]
    });
    const agent = new FakeAgentRunner();
    const service = remoteService({ settingsStore, agent });

    await expect(service.handleRequest(askRequest({ text: "Current Telegram question?" }))).resolves.toMatchObject({
      ok: true
    });

    expect(agent.requests[0].messages).toEqual([
      { role: "user", content: "Desktop question" },
      { role: "assistant", content: "Desktop answer" }
    ]);
    expect(JSON.stringify(agent.requests[0].messages)).not.toContain("Current Telegram question?");
    expect(agent.requests[0].prompt).toContain("Question: Current Telegram question?");

    const activeThread = await new AgentChatHistoryStore(userData).getThread(workspaceRoot, "thread-active");
    expect(activeThread?.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "user", text: "Current Telegram question?", source: "telegram" }),
        expect.objectContaining({ kind: "assistant", text: expect.stringContaining("Answer."), source: "telegram" })
      ])
    );
    await expect(new AgentChatHistoryStore(userData).getThread(workspaceRoot, TELEGRAM_REMOTE_DEFAULT_THREAD_ID)).resolves.toBeNull();
  });

  it("falls back to the default remote thread when no active thread is configured", async () => {
    const settingsStore = await enabledPairedSettings();
    const agent = new FakeAgentRunner();
    const service = remoteService({ settingsStore, agent });

    await expect(service.handleRequest(askRequest({ id: "ask-default-thread" }))).resolves.toMatchObject({
      ok: true
    });

    await expect(new AgentChatHistoryStore(userData).getThread(workspaceRoot, TELEGRAM_REMOTE_DEFAULT_THREAD_ID)).resolves.toMatchObject({
      entries: [
        expect.objectContaining({ kind: "user", source: "telegram" }),
        expect.objectContaining({ kind: "assistant", source: "telegram" })
      ]
    });
  });

  it("captures the target thread before a pending agent run completes", async () => {
    const settingsStore = await enabledPairedSettings();
    await settingsStore.update({
      activeThreadId: "thread-before",
      activeThreadWorkspaceRoot: workspaceRoot
    });
    const agent = new FakeAgentRunner();
    const deferred = createDeferred<AgentRunResponse>();
    agent.nextResponse = deferred.promise;
    const service = remoteService({ settingsStore, agent });

    const pending = service.handleRequest(askRequest({ id: "ask-captured", text: "Captured where?" }));
    await waitFor(() => agent.requests.length === 1);
    await settingsStore.update({
      activeThreadId: "thread-after",
      activeThreadWorkspaceRoot: workspaceRoot
    });
    deferred.resolve(agentResponse({ runId: agent.requests[0].runId }));

    await expect(pending).resolves.toMatchObject({ ok: true });
    await expect(new AgentChatHistoryStore(userData).getThread(workspaceRoot, "thread-before")).resolves.toMatchObject({
      entries: expect.arrayContaining([
        expect.objectContaining({ kind: "user", text: "Captured where?", source: "telegram" })
      ])
    });
    await expect(new AgentChatHistoryStore(userData).getThread(workspaceRoot, "thread-after")).resolves.toBeNull();
  });

  it("does not duplicate or mutate a replayed request id across active thread changes", async () => {
    const settingsStore = await enabledPairedSettings();
    const agent = new FakeAgentRunner();
    const service = remoteService({ settingsStore, agent });

    await expect(service.handleRequest(askRequest({ id: "ask-replay", text: "Original question?" }))).resolves.toMatchObject({
      ok: true
    });
    agent.nextResponse = agentResponse({
      text: "Different answer.",
      contextManifest: manifest([documentReadItem("notes/other.md")])
    });
    await settingsStore.update({
      activeThreadId: "thread-replay-new",
      activeThreadWorkspaceRoot: workspaceRoot
    });
    await expect(service.handleRequest(askRequest({ id: "ask-replay", text: "Changed question?" }))).resolves.toMatchObject({
      ok: true
    });

    const thread = await new AgentChatHistoryStore(userData).getThread(workspaceRoot, TELEGRAM_REMOTE_DEFAULT_THREAD_ID);
    expect(thread?.entries).toHaveLength(2);
    expect(thread?.entries[0]).toMatchObject({ kind: "user", text: "Original question?", source: "telegram" });
    expect(thread?.entries[1]).toMatchObject({ kind: "assistant", text: expect.stringContaining("Answer."), source: "telegram" });
    expect(thread?.entries[1].text).not.toContain("Different answer.");
    await expect(new AgentChatHistoryStore(userData).getThread(workspaceRoot, "thread-replay-new")).resolves.toBeNull();
  });

  it("omits edit proposal instructions from OpenAI remote read-only requests", () => {
    const body = openAiRequestBody("gpt-5.5", {
      runId: "run-remote-openai",
      workspaceRoot,
      runProfile: "remote_read_only",
      activeFile: null,
      messages: [],
      prompt: "What did I decide?",
      mode: "balanced",
      language: "en"
    });

    expect(String(body.instructions)).toContain("read-only Telegram Remote Chat");
    expect(String(body.instructions)).not.toContain("FULL_REPLACEMENT");
    expect(String(body.instructions)).not.toContain("NEW_DOCUMENT");
    expect(String(body.instructions)).not.toContain("DELETE_DOCUMENT");
  });

  it("rejects answers without verified sources and edit-shaped remote answers", async () => {
    const settingsStore = await enabledPairedSettings();
    const agent = new FakeAgentRunner();
    const service = remoteService({ settingsStore, agent });

    agent.nextResponse = agentResponse({
      text: "The rubric says to grade the final reflection.",
      contextManifest: manifest([])
    });
    await expect(service.handleRequest(askRequest({ id: "ask-no-sources" }))).resolves.toMatchObject({
      ok: false,
      error: { code: "agent_unavailable" }
    });
    await expect(new AgentChatHistoryStore(userData).getThread(workspaceRoot, TELEGRAM_REMOTE_DEFAULT_THREAD_ID)).resolves.toMatchObject({
      entries: [
        expect.objectContaining({ id: expect.stringMatching(/:user$/), kind: "user", source: "telegram" }),
        expect.objectContaining({
          id: expect.stringMatching(/:error$/),
          kind: "error",
          text: "Iliad could not verify which Markdown file supports that answer.",
          source: "telegram"
        })
      ]
    });

    agent.nextResponse = agentResponse({
      text: "FULL_REPLACEMENT:\n```markdown\n# Edited\n```",
      contextManifest: manifest([documentReadItem("notes/source.md")])
    });
    await expect(service.handleRequest(askRequest({ id: "ask-marker" }))).resolves.toMatchObject({
      ok: false,
      error: { code: "agent_unavailable" }
    });

    agent.nextResponse = agentResponse({
      text: "DELETE_DOCUMENT: notes/source.md",
      contextManifest: manifest([documentReadItem("notes/source.md")])
    });
    await expect(service.handleRequest(askRequest({ id: "ask-delete-marker" }))).resolves.toMatchObject({
      ok: false,
      error: { code: "agent_unavailable" }
    });

    // A leaked anchored edit block fails closed instead of reaching Telegram
    // as raw conflict machinery.
    agent.nextResponse = agentResponse({
      text: "Done.\n<<<<<<< SEARCH\nold\n=======\nnew\n>>>>>>> REPLACE",
      contextManifest: manifest([documentReadItem("notes/source.md")])
    });
    await expect(service.handleRequest(askRequest({ id: "ask-anchored-marker" }))).resolves.toMatchObject({
      ok: false,
      error: { code: "agent_unavailable" }
    });
  });

  it("persists thrown agent errors and post-start deadline expiry for accepted asks", async () => {
    const settingsStore = await enabledPairedSettings();
    const throwingAgent = new FakeAgentRunner();
    throwingAgent.startRun = async (request: AgentRunRequest) => {
      throwingAgent.requests.push(request);
      throw new Error("provider failed");
    };
    const throwingService = remoteService({ settingsStore, agent: throwingAgent });

    await expect(throwingService.handleRequest(askRequest({ id: "ask-throw" }))).resolves.toMatchObject({
      ok: false,
      error: { code: "unknown" }
    });

    const expiringAgent = new FakeAgentRunner();
    const expiringService = new TelegramRemoteService({
      userDataPath: userData,
      settingsStore,
      agentService: expiringAgent,
      getCurrentWorkspace: () => ({ root: workspaceRoot, label: "Course Notes" }),
      now: (() => {
        let callCount = 0;
        return () => new Date(now.getTime() + (callCount++ > 1 ? 120_000 : 0));
      })()
    });
    await expect(expiringService.handleRequest(askRequest({ id: "ask-expired-after-start" }))).resolves.toMatchObject({
      ok: false,
      error: { code: "deadline_exceeded" }
    });

    const thread = await new AgentChatHistoryStore(userData).getThread(workspaceRoot, TELEGRAM_REMOTE_DEFAULT_THREAD_ID);
    expect(thread?.entries.filter((entry) => entry.kind === "error")).toEqual([
      expect.objectContaining({ text: "Iliad could not complete the remote request.", source: "telegram" }),
      expect.objectContaining({ text: "The remote request deadline expired.", source: "telegram" })
    ]);
  });

  it("rejects asks after the desktop workspace differs from the bound remote workspace", async () => {
    const settingsStore = await enabledPairedSettings();
    await settingsStore.update({ boundWorkspaceRoot: path.join(workspaceRoot, "old") });
    const agent = new FakeAgentRunner();

    const response = await remoteService({ settingsStore, agent }).handleRequest(askRequest());

    expect(response).toMatchObject({
      ok: false,
      error: { code: "workspace_unavailable" }
    });
    expect(agent.requests).toHaveLength(0);
  });

  it("requires remote chat to be bound to the enabled workspace", async () => {
    const settingsStore = new RemoteSettingsStore(userData);
    await settingsStore.update({
      enabled: true,
      relayDeviceId: "device-1",
      deviceSecret: "secret-1",
      pairedChat: pairedChat()
    });
    const agent = new FakeAgentRunner();

    const response = await remoteService({ settingsStore, agent }).handleRequest(askRequest());

    expect(response).toMatchObject({
      ok: false,
      error: { code: "workspace_unavailable" }
    });
    expect(agent.requests).toHaveLength(0);
  });

  it("cancels active remote work when settings are disabled or pairing is revoked", async () => {
    const settingsStore = await enabledPairedSettings();
    const agent = new FakeAgentRunner();
    const deferred = createDeferred<AgentRunResponse>();
    agent.nextResponse = deferred.promise;
    const service = remoteService({ settingsStore, agent });
    const first = service.handleRequest(askRequest({ id: "ask-disable" }));
    await waitFor(() => agent.requests.length === 1);

    await service.updateSettings({ enabled: false });
    expect(agent.cancelRun).toHaveBeenCalledWith(agent.requests[0].runId);
    deferred.resolve(agentResponse({ runId: agent.requests[0].runId }));
    await first;

    await settingsStore.update({ enabled: true, boundWorkspaceRoot: workspaceRoot });
    const secondDeferred = createDeferred<AgentRunResponse>();
    agent.nextResponse = secondDeferred.promise;
    const second = service.handleRequest(askRequest({ id: "ask-revoke" }));
    await waitFor(() => agent.requests.length === 2);

    await service.revokePairing();
    expect(agent.cancelRun).toHaveBeenCalledWith(agent.requests[1].runId);
    secondDeferred.resolve(agentResponse({ runId: agent.requests[1].runId }));
    await second;
  });

  it("suppresses provider draft changes for read-only AgentService runs", async () => {
    const service = new AgentService(userData);
    const draftFileChanges: AgentDraftFileChange[] = [
      {
        kind: "create_file",
        relativePath: "new.md",
        content: "# New\n",
        unifiedDiff: "--- /dev/null\n+++ b/new.md\n@@ -0,0 +1 @@\n+# New",
        summary: "Created a new document."
      }
    ];
    const provider = {
      metadata: OPENAI_RESPONSES_PROVIDER_METADATA,
      startRun: async ({ request }: { request: AgentProviderRunRequest }): Promise<AgentProviderResponse> => ({
        runId: request.runId,
        responseId: "resp-read-only",
        text: "I cannot edit from Telegram Remote Chat.",
        draftFileChanges,
        proposalSource: { kind: "openai_response" }
      })
    };
    (
      service as unknown as {
        selectRuntimeProvider(model: string): Promise<{ provider: typeof provider }>;
      }
    ).selectRuntimeProvider = async () => ({ provider });

    const response = await service.startRun(
      {
        runId: "run-read-only",
        workspaceRoot,
        runProfile: "remote_read_only",
        activeFile: null,
        messages: [],
        prompt: "Create a file",
        mode: "balanced",
        language: "en"
      }
    );

    expect(response.error).toBeUndefined();
    expect(response.proposalIds).toEqual([]);
    expect(response.proposals).toEqual([]);
    await expect(service.listProposals(workspaceRoot)).resolves.toEqual([]);
    service.dispose();
  });
});

async function enabledPairedSettings() {
  const settingsStore = new RemoteSettingsStore(userData);
  await settingsStore.update({
    enabled: true,
    relayDeviceId: "device-1",
    deviceSecret: "secret-1",
    pairedChat: pairedChat(),
    boundWorkspaceRoot: workspaceRoot
  });
  return settingsStore;
}

function remoteService({
  settingsStore,
  agent = new FakeAgentRunner(),
  workspace = { root: workspaceRoot, label: "Course Notes" },
  maxTextLength,
  chatHistoryStore
}: {
  settingsStore: RemoteSettingsStore;
  agent?: TelegramRemoteAgentRunner;
  workspace?: { root: string; label?: string } | null;
  maxTextLength?: number;
  chatHistoryStore?: AgentChatHistoryStore;
}) {
  return new TelegramRemoteService({
    userDataPath: userData,
    settingsStore,
    agentService: agent,
    chatHistoryStore,
    getCurrentWorkspace: () => workspace,
    now: () => now,
    maxTextLength
  });
}

function pairedChat() {
  return {
    chatId: "chat-1",
    username: "sebastian",
    displayName: "Sebastian",
    pairedAt: now.toISOString()
  };
}

function statusRequest(overrides: Partial<RemoteStatusRequest> = {}): RemoteStatusRequest {
  return {
    version: TELEGRAM_REMOTE_REQUEST_VERSION,
    id: "status-1",
    type: "status",
    chatId: "chat-1",
    createdAt: now.toISOString(),
    deadlineAt: new Date(now.getTime() + 60_000).toISOString(),
    ...overrides
  };
}

function askRequest(overrides: Partial<RemoteAskRequest> = {}): RemoteAskRequest {
  return {
    version: TELEGRAM_REMOTE_REQUEST_VERSION,
    id: "ask-1",
    type: "ask",
    chatId: "chat-1",
    createdAt: now.toISOString(),
    deadlineAt: new Date(now.getTime() + 60_000).toISOString(),
    text: "Question?",
    ...overrides
  };
}

function agentResponse(overrides: Partial<AgentRunResponse> = {}): AgentRunResponse {
  const runId = overrides.runId ?? "remote-run";
  return {
    runId,
    responseId: "resp-remote",
    text: "Answer.",
    proposalIds: [],
    proposals: [],
    patch: null,
    newDocument: null,
    contextManifest: manifest([documentReadItem("notes/source.md")], runId),
    ...overrides
  };
}

function manifest(items: AgentRunContextItem[], runId = "remote-run"): AgentRunContextManifest {
  return {
    id: `manifest-${runId}`,
    runId,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    status: "completed",
    workspaceLabel: "Course Notes",
    workspaceId: "workspace-test",
    workspaceRootPersisted: false,
    provider: OPENAI_RESPONSES_PROVIDER_METADATA,
    model: "gpt-5.5",
    mode: "balanced",
    language: "en",
    policy: "auto",
    items,
    estimatedInputTokens: 10,
    proposalIds: []
  };
}

function documentReadItem(relativePath: string): AgentRunContextItem {
  return {
    id: `read-${relativePath}`,
    kind: "document_read",
    label: path.basename(relativePath),
    relativePath,
    inclusion: "full",
    reason: "model_directed_document_read",
    baseHash: "hash",
    estimatedTokens: 10
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throw new Error("Timed out waiting for condition.");
}
