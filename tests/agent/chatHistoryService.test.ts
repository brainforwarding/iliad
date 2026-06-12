import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentService } from "../../electron/agent/agentService";
import type { AgentRuntimeProvider } from "../../electron/agent/runtime/provider";
import type { AgentProviderRunRequest } from "../../electron/agent/types";

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

describe("AgentService chat history", () => {
  it("generates titles from persisted visible transcript only and updates metadata only", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "iliad-title-workspace-"));
    const userData = await mkdtemp(path.join(os.tmpdir(), "iliad-title-userdata-"));
    tempDirs.push(workspaceRoot, userData);
    const service = new AgentService(userData);
    let capturedRequest: AgentProviderRunRequest | null = null;
    const provider: AgentRuntimeProvider = {
      metadata: {
        id: "openai-api",
        label: "OpenAI API",
        billing: "openai_platform_api",
        capabilities: {
          text: true,
          thinkingSummaries: false,
          reviewableProposals: false,
          workspaceEvents: false,
          managedAccountAuth: false,
          rateLimits: false,
          media: {
            transcription: false,
            images: false,
            realtime: false
          }
        }
      },
      startRun: vi.fn(async ({ request }) => {
        capturedRequest = request;
        return {
          runId: request.runId,
          text: "Diagnostic rubric",
          draftFileChanges: []
        };
      })
    };

    (service as unknown as { selectRuntimeProvider(model: string): Promise<{ provider: AgentRuntimeProvider }> })
      .selectRuntimeProvider = async () => ({ provider });

    try {
      await service.saveChatThread({
        workspaceRoot,
        thread: {
          id: "thread-1",
          title: "Fallback",
          titleSource: "fallback",
          createdAt: "2026-05-25T12:00:00.000Z",
          updatedAt: "2026-05-25T12:00:00.000Z",
          entries: [
            {
              id: "user",
              kind: "user",
              text: "Build a diagnostic rubric",
              createdAt: "2026-05-25T12:00:00.000Z",
              contextManifest: { workspaceId: "secret" }
            } as never,
            {
              id: "assistant",
              kind: "assistant",
              text:
                "Here is a concise rubric.\n```md\nFull document excerpt should not travel.\n```\ndiff --git a/doc.md b/doc.md\n+This is a very long generated patch line that should be stripped before title metadata generation.\nsecretABCDEF123456",
              createdAt: "2026-05-25T12:01:00.000Z"
            }
          ]
        }
      });

      const updated = await service.generateChatThreadTitle({
        workspaceRoot,
        threadId: "thread-1",
        language: "en"
      });

      expect(updated).toMatchObject({ title: "Diagnostic rubric", titleSource: "ai" });
      expect(updated?.entries).toHaveLength(2);
      expect(updated?.entries.map((entry) => entry.kind)).toEqual(["user", "assistant"]);
      expect(JSON.stringify(updated)).not.toContain("contextManifest");
      expect(capturedRequest).toMatchObject({
        activeFile: null,
        prompt: "Write only a brief title for this conversation. Do not add quotes or explanation.",
        messages: [
          { role: "user", content: "Build a diagnostic rubric" },
          { role: "assistant", content: "Here is a concise rubric. [redacted]" }
        ]
      });
      expect(JSON.stringify(capturedRequest)).not.toContain("Full document excerpt");
      expect(JSON.stringify(capturedRequest)).not.toContain("diff --git");
      expect(JSON.stringify(capturedRequest)).not.toContain("secretABCDEF123456");
      expect(capturedRequest?.workspaceRoot).not.toBe(workspaceRoot);
    } finally {
      service.dispose();
    }
  });
});
