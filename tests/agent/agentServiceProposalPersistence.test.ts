import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentService } from "../../electron/agent/agentService";
import type {
  AgentChangeProposal,
  AgentDraftFileChange,
  AgentProposalSource,
  AgentRunRequest
} from "../../electron/agent/types";

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

function runRequest(workspaceRoot: string): AgentRunRequest {
  return {
    runId: "run-service-proposals",
    workspaceRoot,
    activeFile: null,
    messages: [],
    prompt: "Prepare mixed changes",
    mode: "balanced",
    language: "en"
  };
}

const draftFileChanges: AgentDraftFileChange[] = [
  {
    kind: "edit_file",
    relativePath: "lesson.md",
    baseHash: "base-hash",
    baseContent: "Old lesson\n",
    replacement: "New lesson\n",
    unifiedDiff: "--- a/lesson.md\n+++ b/lesson.md\n@@ -1 +1 @@\n-Old lesson\n+New lesson",
    summary: "Updated lesson."
  },
  {
    kind: "create_file",
    relativePath: "rubric.md",
    content: "# Rubric\n",
    unifiedDiff: "--- /dev/null\n+++ b/rubric.md\n@@ -0,0 +1 @@\n+# Rubric",
    summary: "Created rubric."
  }
];

describe("AgentService proposal persistence", () => {
  it("persists mixed Markdown draft changes as one proposal with explicit file operations", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "iliad-service-proposals-workspace-"));
    const userData = await mkdtemp(path.join(os.tmpdir(), "iliad-service-proposals-userdata-"));
    tempDirs.push(workspaceRoot, userData);
    const service = new AgentService(userData);
    const saveDraftProposals = (
      service as unknown as {
        saveDraftProposals(options: {
          request: AgentRunRequest;
          responseId?: string;
          model: string;
          draftFileChanges: AgentDraftFileChange[];
          source: AgentProposalSource;
        }): Promise<AgentChangeProposal[]>;
      }
    ).saveDraftProposals.bind(service);

    try {
      const proposals = await saveDraftProposals({
        request: runRequest(workspaceRoot),
        responseId: "response-service-proposals",
        model: "gpt-5.5",
        draftFileChanges,
        source: { kind: "codex_app_server" }
      });
      const stored = await service.listProposals(workspaceRoot);

      expect(proposals).toHaveLength(1);
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({
        id: "proposal-run-service-proposals",
        responseId: "response-service-proposals",
        title: "Update 2 files",
        summary: "Updated lesson.",
        source: { kind: "codex_app_server" },
        status: "pending"
      });
      expect(stored[0].files.map((file) => file.kind)).toEqual(["edit_file", "create_file"]);
      expect(stored[0].files).toHaveLength(2);
    } finally {
      service.dispose();
    }
  });

  it("hydrates delete drafts from the current Markdown file before persisting", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "iliad-service-delete-workspace-"));
    const userData = await mkdtemp(path.join(os.tmpdir(), "iliad-service-delete-userdata-"));
    tempDirs.push(workspaceRoot, userData);
    await writeFile(path.join(workspaceRoot, "delete-me.md"), "# Delete Me\n\nOld text.\n", "utf8");
    const service = new AgentService(userData);
    const saveDraftProposals = (
      service as unknown as {
        saveDraftProposals(options: {
          request: AgentRunRequest;
          responseId?: string;
          model: string;
          draftFileChanges: AgentDraftFileChange[];
          source: AgentProposalSource;
        }): Promise<AgentChangeProposal[]>;
      }
    ).saveDraftProposals.bind(service);

    try {
      const proposals = await saveDraftProposals({
        request: runRequest(workspaceRoot),
        responseId: "response-service-delete",
        model: "gpt-5.5",
        draftFileChanges: [
          {
            kind: "delete_file",
            relativePath: "delete-me.md",
            baseHash: "",
            baseContent: "",
            summary: "Delete delete-me.md",
            unifiedDiff: ""
          }
        ],
        source: { kind: "openai_response" }
      });
      const stored = await service.listProposals(workspaceRoot);

      expect(proposals).toHaveLength(1);
      expect(stored[0].files).toEqual([
        expect.objectContaining({
          kind: "delete_file",
          relativePath: "delete-me.md",
          baseContent: "# Delete Me\n\nOld text.\n",
          baseHash: expect.any(String),
          unifiedDiff: expect.stringContaining("--- a/delete-me.md")
        })
      ]);
    } finally {
      service.dispose();
    }
  });
});
