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
    const external = externalProposal({ id: "external", files: [editFile({ relativePath: "external.md" })] });

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

  it("supersedes older same-path internal proposals with the newest proposal", () => {
    const newer = proposal({
      id: "newer",
      runId: "run-newer",
      createdAt: "2026-06-21T10:02:00.000Z",
      updatedAt: "2026-06-21T11:00:00.000Z"
    });
    const older = proposal({
      id: "older",
      runId: "run-older",
      createdAt: "2026-06-21T10:01:00.000Z",
      updatedAt: "2026-06-21T12:00:00.000Z"
    });

    const summary = buildReviewQueueSummary([older, newer]);

    expect(summary.internalItems).toHaveLength(2);
    expect(summary.visibleItems).toHaveLength(1);
    expect(summary.firstTarget).toEqual({ proposalId: "newer", fileId: "edit-file" });
    expect(summary.internalItems.find((item) => item.proposalId === "older")?.blockedReason).toBe(
      "superseded_same_path"
    );
  });

  it("does not resurrect an older same-path proposal after the newest proposal is terminal", () => {
    const newer = proposal({
      id: "newer",
      runId: "run-newer",
      createdAt: "2026-06-21T10:02:00.000Z",
      status: "applied",
      files: [
        editFile({
          status: "applied",
          hunks: [
            {
              id: "hunk-1",
              status: "applied",
              anchorLine: 1,
              oldStartLine: 1,
              oldLines: ["old"],
              newLines: ["new"]
            }
          ]
        })
      ]
    });
    const older = proposal({
      id: "older",
      runId: "run-older",
      createdAt: "2026-06-21T10:01:00.000Z"
    });

    const summary = buildReviewQueueSummary([older, newer]);

    expect(summary.internalItems).toHaveLength(1);
    expect(summary.internalItems[0]?.proposalId).toBe("older");
    expect(summary.internalItems[0]?.blockedReason).toBe("superseded_same_path");
    expect(summary.visibleItems).toHaveLength(0);
    expect(internalReviewProposals([older, newer])).toEqual([]);
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

  it("filters assistant proposals to queue-visible files and grouped duplicates", () => {
    const mixed = proposal({
      id: "mixed",
      runId: "run-mixed",
      createdAt: "2026-06-21T10:02:00.000Z",
      files: [
        editFile({ id: "first", relativePath: "visible.md" }),
        editFile({ id: "duplicate", relativePath: "visible.md" }),
        editFile({ id: "other", relativePath: "other.md" })
      ]
    });
    const newerOther = proposal({
      id: "newer-other",
      runId: "run-newer-other",
      createdAt: "2026-06-21T10:03:00.000Z",
      files: [editFile({ id: "newer-other-file", relativePath: "other.md" })]
    });

    const visible = internalReviewProposals([mixed, newerOther]);

    expect(visible).toHaveLength(2);
    expect(visible.find((item) => item.id === "mixed")?.files.map((file) => file.id)).toEqual([
      "first",
      "duplicate"
    ]);
    expect(visible.find((item) => item.id === "newer-other")?.files.map((file) => file.id)).toEqual([
      "newer-other-file"
    ]);
  });
});
