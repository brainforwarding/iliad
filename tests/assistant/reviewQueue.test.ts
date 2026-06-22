import { describe, expect, it } from "vitest";
import {
  buildReviewQueueItems,
  buildReviewQueueSummary,
  internalReviewProposals,
  pendingFileTreeChangesFromQueue
} from "../../src/assistant/reviewQueue";
import type { AgentChangeProposal, AgentProposalFileChange } from "../../src/types/iliad";

function editFile(overrides: Partial<Extract<AgentProposalFileChange, { kind: "edit_file" }>> = {}) {
  return {
    id: "edit-file",
    kind: "edit_file" as const,
    status: "pending" as const,
    relativePath: "doc.md",
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

function proposal(overrides: Partial<AgentChangeProposal> = {}): AgentChangeProposal {
  return {
    id: "proposal-1",
    runId: "run-1",
    workspaceRoot: "/workspace",
    title: "Edit doc.md",
    summary: "Prepared changes.",
    createdAt: "2026-06-21T10:00:00.000Z",
    updatedAt: "2026-06-21T10:00:00.000Z",
    model: "test",
    source: { kind: "openai_response" },
    status: "pending",
    files: [editFile()],
    ...overrides
  };
}

function externalProposal(overrides: Partial<AgentChangeProposal> = {}) {
  return proposal({
    id: "external-1",
    runId: "external-run-1",
    source: { kind: "tool_call" },
    metadata: {
      kind: "external_filesystem",
      baselineId: "baseline",
      snapshotId: "snapshot",
      liveDisk: true,
      sessionScoped: true
    },
    ...overrides
  });
}

describe("review queue", () => {
  it("keeps external filesystem proposals out of internal assistant proposal groups", () => {
    const internal = proposal({ id: "internal" });
    const external = externalProposal({ id: "external" });

    expect(internalReviewProposals([internal, external]).map((item) => item.id)).toEqual(["internal"]);
  });

  it("groups same-run same-path duplicate files into one queue item", () => {
    const items = buildReviewQueueItems([
      proposal({
        files: [
          editFile({ id: "first", relativePath: "notes/doc.md" }),
          editFile({ id: "duplicate", relativePath: "notes/doc.md" })
        ]
      })
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      proposalId: "proposal-1",
      fileId: "first",
      normalizedRelativePath: "notes/doc.md",
      duplicateFileIds: ["duplicate"]
    });
  });

  it("keeps different-run same-path proposals separately reachable but shows one file-tree target", () => {
    const newer = proposal({
      id: "newer",
      runId: "run-newer",
      updatedAt: "2026-06-21T10:02:00.000Z"
    });
    const older = proposal({
      id: "older",
      runId: "run-older",
      updatedAt: "2026-06-21T10:01:00.000Z"
    });

    const summary = buildReviewQueueSummary([older, newer]);

    expect(summary.internalItems).toHaveLength(2);
    expect(summary.visibleItems).toHaveLength(1);
    expect(summary.firstTarget).toEqual({ proposalId: "newer", fileId: "edit-file" });
  });

  it("lets external filesystem review own a mixed-source same-path file-tree target", () => {
    const internal = proposal({ id: "internal", runId: "run-internal" });
    const external = externalProposal({ id: "external", runId: "run-external" });

    const summary = buildReviewQueueSummary([internal, external]);

    expect(summary.visibleItems).toHaveLength(1);
    expect(summary.visibleItems[0]?.source).toBe("external_filesystem");
    expect(summary.internalItems[0]?.blockedReason).toBe("external_drift_same_path");
    expect(summary.stripBulkAction).toBe("restore_external");
  });

  it("chooses source-aware sidebar bulk behavior", () => {
    expect(
      buildReviewQueueSummary([
        proposal({ id: "one", runId: "run-one", files: [editFile({ relativePath: "one.md" })] }),
        proposal({ id: "two", runId: "run-two", files: [editFile({ relativePath: "two.md" })] })
      ]).stripBulkAction
    ).toBe("discard_internal");

    expect(buildReviewQueueSummary([externalProposal()]).stripBulkAction).toBe("restore_external");

    expect(
      buildReviewQueueSummary([
        proposal({ id: "internal", runId: "run-internal", files: [editFile({ relativePath: "one.md" })] }),
        externalProposal({
          id: "external",
          runId: "run-external",
          files: [editFile({ relativePath: "two.md" })]
        })
      ]).stripBulkAction
    ).toBeNull();
  });

  it("builds file-tree changes only from visible queue items", () => {
    const summary = buildReviewQueueSummary([
      proposal({ id: "internal", runId: "run-internal" }),
      externalProposal({ id: "external", runId: "run-external" })
    ]);

    expect(pendingFileTreeChangesFromQueue(summary.items)).toEqual([
      expect.objectContaining({
        proposalId: "external",
        kind: "edit_file",
        normalizedRelativePath: "doc.md"
      })
    ]);
  });
});
