import { describe, expect, it } from "vitest";
import {
  firstMutableReviewTarget,
  mutableReviewFileCount,
  mutableReviewProposalIds,
  mutableReviewProposals
} from "../../src/assistant/pendingReviewState";
import type { AgentChangeProposal, AgentProposalFileChange } from "../../src/types/iliad";

function proposal(overrides: Partial<AgentChangeProposal>): AgentChangeProposal {
  return {
    id: "proposal-test",
    runId: "run-test",
    workspaceRoot: "/workspace",
    title: "Test proposal",
    summary: "Test",
    createdAt: "2026-06-18T00:00:00.000Z",
    updatedAt: "2026-06-18T00:00:00.000Z",
    model: "test",
    source: { kind: "external_agent" },
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

describe("pending review state", () => {
  it("keeps all mutable proposals even when they target the same path", () => {
    const proposals = [
      proposal({
        id: "newer",
        files: [createFile({ id: "newer-create", relativePath: "same.md" })]
      }),
      proposal({
        id: "older",
        files: [createFile({ id: "older-create", relativePath: "same.md" })]
      })
    ];

    expect(mutableReviewProposalIds(proposals)).toEqual(["newer", "older"]);
    expect(mutableReviewFileCount(proposals)).toBe(2);
  });

  it("ignores terminal files and selects the first mutable review target", () => {
    const proposals = [
      proposal({
        id: "terminal",
        files: [createFile({ id: "applied-create", status: "applied" })]
      }),
      proposal({
        id: "mixed",
        files: [
          editFile({
            id: "rejected-edit",
            status: "rejected",
            hunks: [
              {
                id: "hunk-rejected",
                status: "rejected",
                anchorLine: 1,
                oldStartLine: 1,
                oldLines: ["old"],
                newLines: ["new"]
              }
            ]
          }),
          editFile({ id: "pending-edit" })
        ]
      })
    ];

    expect(mutableReviewProposals(proposals).map((candidate) => candidate.id)).toEqual(["mixed"]);
    expect(mutableReviewFileCount(proposals)).toBe(1);
    expect(firstMutableReviewTarget(proposals)).toEqual({ proposalId: "mixed", fileId: "pending-edit" });
  });
});
