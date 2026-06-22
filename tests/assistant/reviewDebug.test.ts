import { afterEach, describe, expect, it, vi } from "vitest";
import { sanitizeDiagnosticDetails } from "../../electron/diagnostics/logger";
import { classifyPath, logReviewNavigation, safeReviewDiagnosticDetails } from "../../src/assistant/reviewDebug";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("review navigation diagnostics", () => {
  it("flattens targets and keeps safe relative identities", () => {
    const details = safeReviewDiagnosticDetails({
      target: { proposalId: "proposal-1", fileId: "file-2" },
      targetKind: "create_file",
      targetRelativePath: "drafts/new.md",
      activeRelativePath: "review/current.md",
      previousActiveRelativePath: "review/previous.md",
      selectedTreePath: "iliad-review://drafts/new.md",
      nodePath: "/Users/sebastian/dev/iliad-site/my-docs/drafts/new.md",
      path: "/Users/sebastian/private.md",
      prompt: "do not persist"
    });

    expect(details).toEqual({
      activeRel: "review/current.md",
      nodePathKind: "real",
      pathKind: "real",
      previousActiveRel: "review/previous.md",
      selectedTreePathKind: "pending",
      selectedTreeRel: "drafts/new.md",
      targetFileId: "file-2",
      targetKind: "create_file",
      targetProposalId: "proposal-1",
      targetRel: "drafts/new.md"
    });
  });

  it("does not turn absolute paths into relative identities", () => {
    const details = safeReviewDiagnosticDetails({
      targetRelativePath: "/Users/sebastian/dev/private.md",
      nodeRelativePath: "../secret.md",
      revealPath: "iliad-review-dir://workspace/drafts",
      selectedTreeRelativePath: "workspace/drafts/note.md"
    });

    expect(details).toEqual({
      revealPathKind: "pending",
      revealRel: "workspace/drafts",
      selectedTreeRel: "workspace/drafts/note.md"
    });
  });

  it("uses field names that survive the shared diagnostics sanitizer", () => {
    const details = safeReviewDiagnosticDetails({
      targetProposalId: "proposal-1",
      targetFileId: "file-1",
      targetKind: "delete_file",
      targetRel: "teaching/workshop-note.md",
      activeRel: "teaching/workshop-plan.md",
      selectedTreePath: "/Users/sebastian/dev/iliad-site/my-docs/teaching/workshop-note.md"
    });

    expect(sanitizeDiagnosticDetails(details)).toEqual({
      activeRel: "teaching/workshop-plan.md",
      selectedTreePathKind: "real",
      targetFileId: "file-1",
      targetKind: "delete_file",
      targetProposalId: "proposal-1",
      targetRel: "teaching/workshop-note.md"
    });
  });

  it("keeps auto-selection guard fields for review target suppression diagnostics", () => {
    const details = safeReviewDiagnosticDetails({
      autoSelectDecision: "block_different_target",
      hasActiveReview: true,
      activeReviewProposalId: "proposal-1",
      activeReviewFileId: "file-1",
      activeReviewKind: "edit_file",
      activeReviewRel: "writing-assists/tighten-this.md",
      targetProposalId: "proposal-1",
      targetFileId: "file-2",
      targetKind: "create_file",
      targetRel: "workspace/random-jottings.md"
    });

    expect(sanitizeDiagnosticDetails(details)).toEqual({
      activeReviewFileId: "file-1",
      activeReviewKind: "edit_file",
      activeReviewProposalId: "proposal-1",
      activeReviewRel: "writing-assists/tighten-this.md",
      autoSelectDecision: "block_different_target",
      hasActiveReview: true,
      targetFileId: "file-2",
      targetKind: "create_file",
      targetProposalId: "proposal-1",
      targetRel: "workspace/random-jottings.md"
    });
  });

  it("classifies pending, relative, absolute, and empty paths", () => {
    expect(classifyPath("iliad-review://new.md")).toEqual({ kind: "pending", rel: "new.md" });
    expect(classifyPath("folder/note.md")).toEqual({ kind: "relative", rel: "folder/note.md" });
    expect(classifyPath("/Users/sebastian/note.md")).toEqual({ kind: "real" });
    expect(classifyPath(null)).toEqual({ kind: "none" });
  });

  it("persists diagnostics best-effort without throwing when logging rejects", async () => {
    const diagnosticsLog = vi.fn().mockRejectedValue(new Error("disk unavailable"));
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.stubGlobal("window", {
      iliad: {
        diagnostics: {
          log: diagnosticsLog
        }
      },
      localStorage: {
        getItem: () => null
      }
    });

    expect(() => logReviewNavigation("file_tree_open_pending_change", { targetRel: "drafts/new.md" })).not.toThrow();
    await Promise.resolve();

    expect(diagnosticsLog).toHaveBeenCalledWith({
      level: "info",
      area: "review",
      event: "review_navigation.file_tree_open_pending_change",
      details: expect.objectContaining({
        navSeq: expect.any(Number),
        targetRel: "drafts/new.md"
      })
    });
  });
});
