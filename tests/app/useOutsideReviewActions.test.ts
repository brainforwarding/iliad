import { describe, expect, it } from "vitest";
import {
  activeBufferReplacementStep,
  editorReviewActionLabelsForMode,
  externalActiveFileAutoSelectionDecision,
  externalReviewTargetForActiveFile,
  reviewActionMayLoadActiveBuffer,
  reviewTargetAfterActiveFileChange
} from "../../src/app/useOutsideReview";
import { conflictMayResume } from "../../src/app/useDocumentPersistence";
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
      revision: 1,
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

describe("useOutsideReview helpers", () => {
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

  it("uses Keep / Restore language for outside review actions (EN and ES)", () => {
    const toolbar = appStrings.en.editor.reviewToolbar;

    expect(editorReviewActionLabelsForMode("edit_file", toolbar)).toEqual({
      acceptAll: "Keep all",
      rejectAll: "Restore all",
      acceptChange: "Keep",
      rejectChange: "Restore"
    });
    expect(editorReviewActionLabelsForMode("create_file", toolbar)).toEqual({
      create: "Keep file",
      discard: "Move to Trash"
    });
    expect(editorReviewActionLabelsForMode("delete_file", toolbar)).toEqual({
      delete: "Confirm deletion",
      discard: "Restore file"
    });
    expect(editorReviewActionLabelsForMode("edit_file", appStrings.es.editor.reviewToolbar)).toEqual({
      acceptAll: "Conservar todo",
      rejectAll: "Restaurar todo",
      acceptChange: "Conservar",
      rejectChange: "Restaurar"
    });
    expect("rejectRemaining" in toolbar).toBe(false);
    // The tighten inline review keeps its own singular Accept / Reject.
    expect(toolbar.acceptChange).toBe("Accept");
    expect(toolbar.rejectChange).toBe("Reject");
    expect(appStrings.es.editor.reviewToolbar.acceptChange).toBe("Aceptar");
  });

  it("never lets a review action load disk over a conflicted or dirty buffer", () => {
    const base = { activeRelativePath: "doc.md", targetRelativePath: "doc.md" };

    expect(reviewActionMayLoadActiveBuffer({ ...base, wasInConflict: false, canReplaceActiveBuffer: true })).toBe(true);
    // Keep (chunk, file, Keep all, last chunk) in conflict mode: the buffer wins.
    expect(reviewActionMayLoadActiveBuffer({ ...base, wasInConflict: true, canReplaceActiveBuffer: true })).toBe(false);
    expect(reviewActionMayLoadActiveBuffer({ ...base, wasInConflict: false, canReplaceActiveBuffer: false })).toBe(false);
    // Only the conflict banner's confirmed Keep may discard the buffer.
    expect(
      reviewActionMayLoadActiveBuffer({ ...base, wasInConflict: true, canReplaceActiveBuffer: false, discardBuffer: true })
    ).toBe(true);
    expect(
      reviewActionMayLoadActiveBuffer({
        activeRelativePath: "other.md",
        targetRelativePath: "doc.md",
        wasInConflict: false,
        canReplaceActiveBuffer: true
      })
    ).toBe(false);
  });

  it("saves a dirty buffer before Keep file opens another document and never replaces a conflicted one", () => {
    expect(activeBufferReplacementStep({ hasActiveDocument: false, inConflict: false, clean: false })).toBe("replace");
    expect(activeBufferReplacementStep({ hasActiveDocument: true, inConflict: false, clean: true })).toBe("replace");
    expect(activeBufferReplacementStep({ hasActiveDocument: true, inConflict: false, clean: false })).toBe("save_first");
    expect(activeBufferReplacementStep({ hasActiveDocument: true, inConflict: true, clean: true })).toBe("keep");
    expect(activeBufferReplacementStep({ hasActiveDocument: true, inConflict: true, clean: false })).toBe("keep");
  });

  it("resumes autosave after a review action only when disk equals the saved text", async () => {
    expect(await conflictMayResume("same\n", "same\n")).toBe(true);
    expect(await conflictMayResume("kept outside text\n", "writer's saved text\n")).toBe(false);
  });
});
