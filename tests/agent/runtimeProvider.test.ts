import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proposalSourceFromProviderResponse } from "../../electron/agent/agentService";
import { AgentSettingsStore } from "../../electron/agent/settingsStore";
import { OpenAiResponsesRuntimeProvider } from "../../electron/agent/runtime/openaiResponsesProvider";
import type { AgentRunRequest } from "../../electron/agent/types";

let tempDirs: string[] = [];

function providerRequest(overrides: Partial<AgentRunRequest> = {}): AgentRunRequest {
  return {
    runId: `run-runtime-${Math.random().toString(16).slice(2)}`,
    workspaceRoot: "/tmp",
    activeFile: null,
    messages: [],
    prompt: "Say done.",
    mode: "balanced",
    language: "en",
    ...overrides
  };
}

function sseResponse(events: unknown[]) {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" }
  });
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

describe("agent runtime provider seam", () => {
  it("includes active runtime provider capability metadata in settings snapshots", async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), "iliad-provider-settings-"));
    tempDirs.push(userDataPath);

    const snapshot = await new AgentSettingsStore(userDataPath).snapshot();

    expect(snapshot.runtimeProvider).toEqual({
      id: "openai-api",
      label: "OpenAI API",
      billing: "openai_platform_api",
      capabilities: {
        text: true,
        thinkingSummaries: true,
        reviewableProposals: true,
        workspaceEvents: false,
        managedAccountAuth: false,
        rateLimits: false,
        media: {
          transcription: true,
          images: false,
          realtime: false
        }
      }
    });
  });

  it("defaults and normalizes agent models to the Codex-supported list", async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), "iliad-provider-model-settings-"));
    tempDirs.push(userDataPath);
    const store = new AgentSettingsStore(userDataPath);

    await expect(store.snapshot()).resolves.toMatchObject({ model: "gpt-5.5" });

    await mkdir(path.join(userDataPath, "assistant"), { recursive: true });
    await writeFile(
      path.join(userDataPath, "assistant", "settings.json"),
      JSON.stringify({ model: "gpt-5-mini", mode: "balanced" }),
      "utf8"
    );

    await expect(store.snapshot()).resolves.toMatchObject({ model: "gpt-5.5" });
    await expect(store.update({ model: "not-a-codex-model" })).resolves.toMatchObject({ model: "gpt-5.5" });
    await expect(store.update({ model: "gpt-5.3-codex-spark" })).resolves.toMatchObject({
      model: "gpt-5.3-codex-spark"
    });
  });

  it("adapts the existing OpenAI Responses path behind the provider interface", async () => {
    const requestBodies: Array<Record<string, unknown>> = [];

    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      requestBodies.push(JSON.parse(String(init.body)));
      return sseResponse([
        { type: "response.created", response: { id: "resp_provider" } },
        { type: "response.output_text.delta", delta: "Done" },
        { type: "response.completed", response: { id: "resp_provider", output_text: "Done" } }
      ]);
    });

    const provider = new OpenAiResponsesRuntimeProvider({
      apiKey: "test-key",
      model: "gpt-5.5"
    });
    const result = await provider.startRun({
      request: providerRequest(),
      signal: new AbortController().signal
    });

    expect(provider.metadata.id).toBe("openai-api");
    expect(result).toMatchObject({
      responseId: "resp_provider",
      text: "Done",
      draftFileChanges: []
    });
    expect(requestBodies[0]).toMatchObject({
      model: "gpt-5.5",
      stream: true
    });
  });

  it("maps provider metadata and explicit responses to proposal source metadata", () => {
    expect(
      proposalSourceFromProviderResponse(undefined, {
        id: "codex-app-server",
        label: "Codex",
        billing: "codex_account",
        capabilities: {
          text: true,
          thinkingSummaries: false,
          reviewableProposals: true,
          workspaceEvents: true,
          managedAccountAuth: true,
          rateLimits: true,
          media: {
            transcription: false,
            images: false,
            realtime: false
          }
        }
      })
    ).toEqual({ kind: "codex_app_server" });

    expect(
      proposalSourceFromProviderResponse({ kind: "legacy_marker_adapter" }, {
        id: "openai-api",
        label: "OpenAI API",
        billing: "openai_platform_api",
        capabilities: {
          text: true,
          thinkingSummaries: true,
          reviewableProposals: true,
          workspaceEvents: false,
          managedAccountAuth: false,
          rateLimits: false,
          media: {
            transcription: true,
            images: false,
            realtime: false
          }
        }
      })
    ).toEqual({ kind: "legacy_marker_adapter" });
  });
});
