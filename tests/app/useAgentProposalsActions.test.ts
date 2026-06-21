import { describe, expect, it, vi } from "vitest";
import {
  externalReviewTargetForActiveFile,
  rejectProposalWithoutSaving,
  shouldFlushBeforeSelectingReviewTarget
} from "../../src/app/useAgentProposals";
import type { AgentChangeProposal } from "../../src/types/iliad";

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

  it("does not recover unrelated or non-external active-file targets", () => {
    expect(externalReviewTargetForActiveFile([externalEditProposal()], "/workspace", "other.md")).toBeNull();
    expect(externalReviewTargetForActiveFile([proposal()], "/workspace", "novel/lighthouse.md")).toBeNull();
  });
});
