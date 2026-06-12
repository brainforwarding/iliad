import { describe, expect, it } from "vitest";
import { chooseInitialReviewTarget } from "../../src/assistant/reviewNavigation";
import type { AgentChangeProposal, AgentProposalFileChange } from "../../src/types/iliad";

function proposal(overrides: Partial<AgentChangeProposal>): AgentChangeProposal {
  return {
    id: "proposal-test",
    runId: "run-test",
    workspaceRoot: "/workspace",
    title: "Test proposal",
    summary: "Test",
    createdAt: "2026-05-27T00:00:00.000Z",
    updatedAt: "2026-05-27T00:00:00.000Z",
    model: "test",
    source: { kind: "tool_call" },
    status: "pending",
    files: [],
    ...overrides
  };
}

function editFile(overrides: Partial<Extract<AgentProposalFileChange, { kind: "edit_file" }>>) {
  return {
    id: "edit-file",
    kind: "edit_file" as const,
    status: "pending" as const,
    relativePath: "current.md",
    baseHash: "hash",
    baseContent: "old\n",
    replacement: "new\n",
    unifiedDiff: "",
    hunks: [
      {
        id: "hunk-1",
        status: "pending" as const,
        anchorLine: 1,
        oldStartLine: 1,
        oldLines: ["old"],
        newLines: ["new"]
      }
    ],
    ...overrides
  };
}

function createFile(overrides: Partial<Extract<AgentProposalFileChange, { kind: "create_file" }>>) {
  return {
    id: "create-file",
    kind: "create_file" as const,
    status: "pending" as const,
    relativePath: "new.md",
    content: "new\n",
    unifiedDiff: "",
    ...overrides
  };
}

describe("chooseInitialReviewTarget", () => {
  it("suppresses auto-open after user navigation during the run", () => {
    const result = chooseInitialReviewTarget({
      proposals: [proposal({ files: [createFile({ id: "created" })] })],
      runId: "run-test",
      runActiveRelativePath: null,
      currentActiveRelativePath: null,
      editorNavigationChangedDuringRun: true
    });

    expect(result).toBeNull();
  });

  it("considers only proposals from the completed run", () => {
    const result = chooseInitialReviewTarget({
      proposals: [
        proposal({ id: "old", runId: "old-run", files: [createFile({ id: "old-created" })] }),
        proposal({ id: "current", runId: "run-test", files: [createFile({ id: "current-created" })] })
      ],
      runId: "run-test",
      runActiveRelativePath: null,
      currentActiveRelativePath: null,
      editorNavigationChangedDuringRun: false
    });

    expect(result).toEqual({ proposalId: "current", fileId: "current-created" });
  });

  it("prioritizes an edit to the run-start active file over a create", () => {
    const result = chooseInitialReviewTarget({
      proposals: [
        proposal({
          id: "mixed",
          files: [
            createFile({ id: "created", relativePath: "other.md" }),
            editFile({ id: "current-edit", relativePath: "current.md" })
          ]
        })
      ],
      runId: "run-test",
      runActiveRelativePath: "current.md",
      currentActiveRelativePath: "current.md",
      editorNavigationChangedDuringRun: false
    });

    expect(result).toEqual({ proposalId: "mixed", fileId: "current-edit" });
  });

  it("opens a single pending create", () => {
    const result = chooseInitialReviewTarget({
      proposals: [proposal({ id: "create-proposal", files: [createFile({ id: "created" })] })],
      runId: "run-test",
      runActiveRelativePath: "current.md",
      currentActiveRelativePath: "current.md",
      editorNavigationChangedDuringRun: false
    });

    expect(result).toEqual({ proposalId: "create-proposal", fileId: "created" });
  });

  it("opens a single non-current edit", () => {
    const result = chooseInitialReviewTarget({
      proposals: [proposal({ id: "edit-proposal", files: [editFile({ id: "other-edit", relativePath: "other.md" })] })],
      runId: "run-test",
      runActiveRelativePath: "current.md",
      currentActiveRelativePath: "current.md",
      editorNavigationChangedDuringRun: false
    });

    expect(result).toEqual({ proposalId: "edit-proposal", fileId: "other-edit" });
  });

  it("refuses multi-file auto-jump when there is no current-file edit", () => {
    const result = chooseInitialReviewTarget({
      proposals: [
        proposal({
          files: [
            createFile({ id: "created", relativePath: "new.md" }),
            editFile({ id: "other-edit", relativePath: "other.md" })
          ]
        })
      ],
      runId: "run-test",
      runActiveRelativePath: "current.md",
      currentActiveRelativePath: "current.md",
      editorNavigationChangedDuringRun: false
    });

    expect(result).toBeNull();
  });
});
