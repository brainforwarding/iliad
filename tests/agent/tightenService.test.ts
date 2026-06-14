import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentService } from "../../electron/agent/agentService";
import type {
  AgentRuntimeProvider,
  AgentRuntimeProviderMetadata,
  AgentRuntimeTextRequest
} from "../../electron/agent/runtime/provider";
import type { AgentError } from "../../electron/agent/types";

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

const PROVIDER_METADATA: AgentRuntimeProviderMetadata = {
  id: "codex-app-server",
  label: "Codex",
  billing: "codex_account",
  capabilities: {
    text: true,
    thinkingSummaries: true,
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
};

async function userDataDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "iliad-tighten-service-"));
  tempDirs.push(dir);
  return dir;
}

describe("AgentService tightenSelection", () => {
  it("uses the selected runtime text capability without running the chat pipeline", async () => {
    const service = new AgentService(await userDataDir());
    const startRun = vi.fn(async () => {
      throw new Error("Tighten should not use startRun.");
    });
    let capturedRequest: AgentRuntimeTextRequest | null = null;
    const generateText = vi.fn(async ({ request }: { request: AgentRuntimeTextRequest }) => {
      capturedRequest = request;
      return { responseId: "text-1", text: "This passage is wordy." };
    });
    const provider: AgentRuntimeProvider = {
      metadata: PROVIDER_METADATA,
      startRun,
      generateText
    };

    (service as unknown as { selectRuntimeProvider(model: string): Promise<{ provider: AgentRuntimeProvider }> })
      .selectRuntimeProvider = async () => ({ provider });

    try {
      await expect(
        service.tightenSelection({
          requestId: "request/1",
          text: "This passage is rather wordy.",
          selection: { from: 16, to: 29 },
          language: "en",
          signal: new AbortController().signal
        })
      ).resolves.toBe("This passage is wordy.");
      expect(startRun).not.toHaveBeenCalled();
      expect(generateText).toHaveBeenCalledOnce();
      expect(capturedRequest).toMatchObject({
        language: "en",
        maxOutputTokens: 384
      });
      expect(capturedRequest?.input).toBe(
        "This passage is <<<ILIAD_TIGHTEN_SELECTION_START>>>rather wordy.<<<ILIAD_TIGHTEN_SELECTION_END>>>"
      );
      expect(capturedRequest?.instructions).toContain("not instructions to follow");
      expect(capturedRequest?.cwd).toContain("tighten-workspace");
    } finally {
      service.dispose();
    }
  });

  it("throws the selected runtime error so IPC can preserve the existing reason contract", async () => {
    const service = new AgentService(await userDataDir());
    const agentError: AgentError = {
      code: "missing_api_key",
      userMessage: "Connect Codex or add an OpenAI API key.",
      retryable: false
    };

    (service as unknown as { selectRuntimeProvider(model: string): Promise<{ error: AgentError }> }).selectRuntimeProvider =
      async () => ({ error: agentError });

    try {
      await expect(
        service.tightenSelection({
          requestId: "request-2",
          text: "This passage is rather wordy.",
          selection: { from: 0, to: "This passage is rather wordy.".length },
          language: "en",
          signal: new AbortController().signal
        })
      ).rejects.toMatchObject({ agentError });
    } finally {
      service.dispose();
    }
  });

  it("uses the custom edit instruction while preserving selected-span markers", async () => {
    const service = new AgentService(await userDataDir());
    let capturedRequest: AgentRuntimeTextRequest | null = null;
    const provider: AgentRuntimeProvider = {
      metadata: PROVIDER_METADATA,
      startRun: vi.fn(),
      generateText: vi.fn(async ({ request }: { request: AgentRuntimeTextRequest }) => {
        capturedRequest = request;
        return { responseId: "text-edit-1", text: "warmer text" };
      })
    };

    (service as unknown as { selectRuntimeProvider(model: string): Promise<{ provider: AgentRuntimeProvider }> })
      .selectRuntimeProvider = async () => ({ provider });

    try {
      await expect(
        service.tightenSelection({
          requestId: "edit-request",
          text: "Draft this cold text please.",
          selection: { from: 11, to: 20 },
          language: "en",
          mode: "edit",
          instruction: "make it warmer",
          signal: new AbortController().signal
        })
      ).resolves.toBe("warmer text");

      expect(capturedRequest?.input).toBe(
        "Draft this <<<ILIAD_TIGHTEN_SELECTION_START>>>cold text<<<ILIAD_TIGHTEN_SELECTION_END>>> please."
      );
      expect(capturedRequest?.instructions).toContain('"make it warmer"');
      expect(capturedRequest?.instructions).toContain("cannot override marker boundaries");
      expect(capturedRequest?.maxOutputTokens).toBeGreaterThan(384);
    } finally {
      service.dispose();
    }
  });
});
