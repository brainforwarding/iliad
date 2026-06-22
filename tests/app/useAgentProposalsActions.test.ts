import { describe, expect, it, vi } from "vitest";
import {
  editorReviewActionLabelsForMode,
  externalActiveFileAutoSelectionDecision,
  externalReviewTargetForActiveFile,
  rejectProposalWithoutSaving,
  reviewTargetAfterActiveFileChange,
  shouldFlushBeforeSelectingReviewTarget
} from "../../src/app/useAgentProposals";
import { appStrings } from "../../src/i18n/strings";
import type { AgentChangeProposal, AgentProposalFileChange } from "../../src/types/iliad";

function proposal(): AgentChangeProposal {
  return {
    id: "proposal-1",
    runId: "run-1",
    workspaceRoot: "/workspace",
    title: "Proposal",
    summary: "Summary",
    createdAt: "2026-06-18T00:00:00.000Z",
    updatedAt: "2026-06-18T00:00:00.000Z",
    model: "test",
    source: { kind: "external_agent" },
    status: "pending",
    files: []
  };
}

function externalEditProposal(): AgentChangeProposal {
  return {
    ...proposal(),
    workspaceRoot: "/workspace",
    metadata: {
      kind: "external_filesystem",
      baselineId: "baseline-1",
      snapshotId: "snapshot-1",
      liveDisk: true,
      sessionScoped: true
    },
    files: [
      {
        id: "file-1",
        kind: "edit_file",
        status: "pending",
        relativePath: "novel/lighthouse.md",
        baseHash: "base",
        baseContent: "Old\n",
        replacement: "New\n",
        unifiedDiff: "",
        hunks: [
          {
            id: "hunk-1",
            status: "pending",
            anchorLine: 1,
            oldStartLine: 1,
            oldLines: [],
            newLines: ["New"]
          }
        ]
      }
    ]
  };
}

function externalMultiFileProposal(): AgentChangeProposal {
  const base = externalEditProposal();

  return {
    ...base,
    files: [
      {
        ...(base.files[0] as Extract<AgentProposalFileChange, { kind: "edit_file" }>),
        id: "first-file",
        relativePath: "novel/lighthouse.md"
      },
      {
        ...(base.files[0] as Extract<AgentProposalFileChange, { kind: "edit_file" }>),
        id: "active-file",
        relativePath: "README.md"
      }
    ]
  };
}

function deleteFile(overrides: Partial<Extract<AgentProposalFileChange, { kind: "delete_file" }>> = {}) {
  return {
    id: "delete-file",
    kind: "delete_file" as const,
    status: "pending" as const,
    relativePath: "new-note.md",
    baseHash: "base",
    baseContent: "# New Note\n\nDeleted content.\n",
    unifiedDiff: "",
    ...overrides
  };
}

describe("useAgentProposals actions", () => {
  it("rejects a proposal without requiring a save callback", async () => {
    const rejectProposal = vi.fn().mockResolvedValue(proposal());
    const result = await rejectProposalWithoutSaving({
      agent: { rejectProposal },
      workspaceRoot: "/workspace",
      proposalId: "proposal-1"
    });

    expect(result.id).toBe("proposal-1");
    expect(rejectProposal).toHaveBeenCalledOnce();
    expect(rejectProposal).toHaveBeenCalledWith({
      workspaceRoot: "/workspace",
      proposalId: "proposal-1"
    });
  });

  it("does not flush editor saves before selecting a live external review", () => {
    const externalProposal: AgentChangeProposal = {
      ...proposal(),
      metadata: {
        kind: "external_filesystem",
        baselineId: "baseline-1",
        snapshotId: "snapshot-1",
        liveDisk: true,
        sessionScoped: true
      }
    };

    expect(shouldFlushBeforeSelectingReviewTarget(externalProposal)).toBe(false);
    expect(shouldFlushBeforeSelectingReviewTarget(proposal())).toBe(true);
  });

  it("recovers the active-file target for a pending external edit", () => {
    expect(externalReviewTargetForActiveFile([externalEditProposal()], "/workspace", "novel/lighthouse.md")).toEqual({
      proposalId: "proposal-1",
      fileId: "file-1"
    });
  });

  it("targets the active file in a multi-file external batch instead of the first changed file", () => {
    expect(externalReviewTargetForActiveFile([externalMultiFileProposal()], "/workspace", "README.md")).toEqual({
      proposalId: "proposal-1",
      fileId: "active-file"
    });
  });

  it("does not recover unrelated or non-external active-file targets", () => {
    expect(externalReviewTargetForActiveFile([externalEditProposal()], "/workspace", "other.md")).toBeNull();
    expect(externalReviewTargetForActiveFile([proposal()], "/workspace", "novel/lighthouse.md")).toBeNull();
  });

  it("only auto-selects external active-file reviews when no review is already active", () => {
    expect(
      externalActiveFileAutoSelectionDecision({
        hasActiveReview: false,
        alreadyReviewingFile: false
      })
    ).toBe("allow");
    expect(
      externalActiveFileAutoSelectionDecision({
        hasActiveReview: true,
        alreadyReviewingFile: false
      })
    ).toBe("block_different_target");
    expect(
      externalActiveFileAutoSelectionDecision({
        hasActiveReview: true,
        alreadyReviewingFile: true
      })
    ).toBe("noop_same_target");
  });

  it("blocks active-file recovery while a different created or deleted review item is selected", () => {
    expect(
      externalActiveFileAutoSelectionDecision({
        hasActiveReview: true,
        alreadyReviewingFile: false
      })
    ).toBe("block_different_target");
  });

  it("clears a stale pending delete review when active file navigation moves elsewhere", () => {
    const pendingDeleteProposal = {
      ...proposal(),
      files: [deleteFile()]
    };

    expect(
      reviewTargetAfterActiveFileChange({
        activeRelativePath: "teaching/workshop-plan.md",
        currentTarget: { proposalId: pendingDeleteProposal.id, fileId: "delete-file" },
        proposals: [pendingDeleteProposal]
      })
    ).toBeNull();
  });

  it("keeps a pending delete review when active file navigation still matches the delete target", () => {
    const pendingDeleteProposal = {
      ...proposal(),
      files: [deleteFile()]
    };
    const currentTarget = { proposalId: pendingDeleteProposal.id, fileId: "delete-file" };

    expect(
      reviewTargetAfterActiveFileChange({
        activeRelativePath: "new-note.md",
        currentTarget,
        proposals: [pendingDeleteProposal]
      })
    ).toEqual(currentTarget);
  });

  it("uses accept/reject language for file-scoped editor review actions", () => {
    const toolbar = appStrings.en.editor.reviewToolbar;

    expect(editorReviewActionLabelsForMode("edit_file", toolbar)).toEqual({
      acceptAll: "Accept changes",
      rejectAll: "Reject changes",
      rejectRemaining: "Reject changes"
    });
    expect(editorReviewActionLabelsForMode("create_file", toolbar)).toEqual({
      create: "Accept changes",
      discard: "Reject changes"
    });
    expect(editorReviewActionLabelsForMode("delete_file", toolbar)).toEqual({
      delete: "Accept changes",
      discard: "Reject changes"
    });
  });
});
