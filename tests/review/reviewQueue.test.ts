import { describe, expect, it } from "vitest";
import {
  buildReviewQueueItems,
  buildReviewQueueSummary,
  pendingFileTreeChangesFromQueue
} from "../../src/review/reviewQueue";
import { reviewFileRevision } from "../../src/review/reviewFiles";
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
    source: { kind: "external_agent" },
    status: "pending",
    files: [editFile()],
    ...overrides
  };
}

function externalProposal(overrides: Partial<AgentChangeProposal> = {}) {
  return proposal({
    id: "external-1",
    runId: "external-run-1",
    source: { kind: "external_agent" },
    metadata: {
      kind: "external_filesystem",
      baselineId: "baseline",
      snapshotId: "snapshot",
      revision: 1,
      liveDisk: true,
      sessionScoped: true
    },
    ...overrides
  });
}

describe("review queue", () => {
  it("queues only outside-change (external filesystem) proposals", () => {
    const other = proposal({ id: "other" });
    const external = externalProposal();

    expect(buildReviewQueueItems([other, external]).map((item) => item.proposalId)).toEqual(["external-1"]);
  });

  it("groups same-proposal same-path files into one queue item", () => {
    const items = buildReviewQueueItems([
      externalProposal({
        files: [editFile({ id: "first" }), editFile({ id: "duplicate" }), editFile({ id: "other", relativePath: "other.md" })]
      })
    ]);

    expect(items).toHaveLength(2);
    expect(items.find((item) => item.normalizedRelativePath === "doc.md")?.duplicateFileIds).toEqual(["duplicate"]);
  });

  it("carries the revision each queued file was built from, for bulk Keep all / Restore all", () => {
    const [create, remove, edit] = buildReviewQueueItems([
      externalProposal({
        files: [
          editFile({ id: "edit", baselineContentHash: "base-e", reviewedContentHash: "disk-e" }),
          editFile({ id: "edit-dup", baselineContentHash: "base-e", reviewedContentHash: "disk-e2" }),
          {
            id: "create",
            kind: "create_file",
            status: "pending",
            relativePath: "new.md",
            content: "fresh\n",
            unifiedDiff: "",
            reviewedContentHash: "disk-c"
          },
          {
            id: "delete",
            kind: "delete_file",
            status: "pending",
            relativePath: "gone.md",
            baseHash: "base-d",
            baseContent: "gone\n",
            unifiedDiff: "",
            baselineContentHash: "base-d"
          }
        ]
      })
    ]).sort((left, right) => left.fileId.localeCompare(right.fileId));

    expect(create.files).toEqual([{ fileId: "create", baselineHash: null, diskHash: "disk-c" }]);
    expect(remove.files).toEqual([{ fileId: "delete", baselineHash: "base-d", diskHash: null }]);
    expect(edit.files).toEqual([
      { fileId: "edit", baselineHash: "base-e", diskHash: "disk-e" },
      { fileId: "edit-dup", baselineHash: "base-e", diskHash: "disk-e2" }
    ]);
  });

  it("derives a file revision that fails safe when a reviewed hash is missing", () => {
    expect(reviewFileRevision(editFile({ baseHash: "base", reviewedContentHash: undefined }))).toEqual({
      baselineHash: "base",
      diskHash: null
    });
  });

  it("skips files that no longer need a decision", () => {
    const summary = buildReviewQueueSummary([
      externalProposal({
        files: [editFile({ hunks: [], status: "applied" }), editFile({ id: "pending", relativePath: "b.md" })]
      })
    ]);

    expect(summary.items.map((item) => item.relativePath)).toEqual(["b.md"]);
    expect(summary.firstTarget).toEqual({ proposalId: "external-1", fileId: "pending" });
  });

  it("builds file-tree changes from queue items", () => {
    const summary = buildReviewQueueSummary([
      proposal({ id: "other", runId: "run-other" }),
      externalProposal({ id: "external", runId: "run-external" })
    ]);

    expect(pendingFileTreeChangesFromQueue(summary.items)).toEqual([
      expect.objectContaining({
        proposalId: "external",
        kind: "edit_file",
        normalizedRelativePath: "doc.md",
        status: "pending"
      })
    ]);
  });
});
