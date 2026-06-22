import { describe, expect, it } from "vitest";
import {
  buildMarkdownChangeProposal,
  markdownChangeProposalSummary,
  markdownChangeProposalTitle
} from "../../electron/agent/markdownChangeContract";
import { codexFinalAssistantText } from "../../electron/agent/runtime/codexAppServerProvider";
import type { AgentDraftFileChange, AgentRunRequest } from "../../electron/agent/types";

const request: AgentRunRequest = {
  runId: "run-contract",
  workspaceRoot: "/workspace",
  activeFile: null,
  messages: [],
  prompt: "Update the course files",
  mode: "balanced",
  language: "en"
};

const clock = () => new Date("2026-05-24T12:00:00.000Z");

function editDraft(overrides: Partial<Extract<AgentDraftFileChange, { kind: "edit_file" }>> = {}): AgentDraftFileChange {
  return {
    kind: "edit_file",
    relativePath: "doc.md",
    baseHash: "base-hash",
    baseContent: "Old\n",
    replacement: "New\n",
    unifiedDiff: "--- a/doc.md\n+++ b/doc.md\n",
    summary: "Improve doc",
    ...overrides
  };
}

function createDraft(
  overrides: Partial<Extract<AgentDraftFileChange, { kind: "create_file" }>> = {}
): AgentDraftFileChange {
  return {
    kind: "create_file",
    relativePath: "annex.md",
    content: "# Annex\n",
    unifiedDiff: "--- a/annex.md\n+++ b/annex.md\n",
    summary: "Create annex",
    ...overrides
  };
}

function deleteDraft(
  overrides: Partial<Extract<AgentDraftFileChange, { kind: "delete_file" }>> = {}
): AgentDraftFileChange {
  return {
    kind: "delete_file",
    relativePath: "old.md",
    baseHash: "base-hash",
    baseContent: "Old\n",
    unifiedDiff: "--- a/old.md\n+++ /dev/null\n",
    summary: "Delete old",
    ...overrides
  };
}

function build(draftFileChanges: AgentDraftFileChange[]) {
  return buildMarkdownChangeProposal({
    request,
    model: "gpt-5.5",
    responseId: "resp-contract",
    source: { kind: "codex_app_server" },
    draftFileChanges,
    clock
  });
}

describe("Markdown change contract", () => {
  it("returns null for empty draft operations", () => {
    expect(build([])).toBeNull();
  });

  it("turns one edit_file draft into one edit_file proposal change", () => {
    const proposal = build([editDraft()]);

    expect(proposal).toMatchObject({
      id: "proposal-run-contract",
      runId: "run-contract",
      responseId: "resp-contract",
      workspaceRoot: "/workspace",
      title: "Edit doc.md",
      summary: "Improve doc",
      createdAt: "2026-05-24T12:00:00.000Z",
      updatedAt: "2026-05-24T12:00:00.000Z",
      status: "pending",
      files: [
        {
          id: "edit_file-run-contract-1",
          kind: "edit_file",
          status: "pending",
          relativePath: "doc.md",
          baseHash: "base-hash",
          baseContent: "Old\n",
          replacement: "New\n",
          unifiedDiff: "--- a/doc.md\n+++ b/doc.md\n"
        }
      ]
    });
  });

  it("turns one create_file draft into one create_file proposal change", () => {
    const proposal = build([createDraft()]);

    expect(proposal?.files).toEqual([
      {
        id: "create_file-run-contract-1",
        kind: "create_file",
        status: "pending",
        relativePath: "annex.md",
        content: "# Annex\n",
        unifiedDiff: "--- a/annex.md\n+++ b/annex.md\n"
      }
    ]);
  });

  it("keeps mixed edit/create drafts in one proposal with explicit file operation kinds", () => {
    const proposal = build([editDraft(), createDraft(), deleteDraft()]);

    expect(proposal?.id).toBe("proposal-run-contract");
    expect(proposal?.title).toBe("Update 3 files");
    expect(proposal?.files).toHaveLength(3);
    expect(proposal?.files.map((file) => file.kind)).toEqual(["edit_file", "create_file", "delete_file"]);
  });

  it("coalesces duplicate same-run file targets into one failed review file", () => {
    const proposal = build([
      editDraft({ relativePath: "notes/doc.md" }),
      editDraft({ relativePath: "notes/./doc.md", replacement: "Different\n" })
    ]);

    expect(proposal?.files).toHaveLength(1);
    expect(proposal?.files[0]).toMatchObject({
      kind: "edit_file",
      status: "failed",
      relativePath: "notes/doc.md",
      error: "Multiple proposed changes targeted this file. Ask the assistant to regenerate the proposal."
    });
  });

  it("turns one delete_file draft into one delete_file proposal change", () => {
    const proposal = build([deleteDraft()]);

    expect(proposal?.title).toBe("Delete old.md");
    expect(proposal?.files).toEqual([
      {
        id: "delete_file-run-contract-1",
        kind: "delete_file",
        status: "pending",
        relativePath: "old.md",
        baseHash: "base-hash",
        baseContent: "Old\n",
        unifiedDiff: "--- a/old.md\n+++ /dev/null\n"
      }
    ]);
  });

  it("never converts create_file operations into edit_file operations", () => {
    const proposal = build([createDraft({ relativePath: "new-session.mkd" })]);
    const file = proposal?.files[0];

    expect(file?.kind).toBe("create_file");
    expect(file && "baseHash" in file).toBe(false);
    expect(file && "replacement" in file).toBe(false);
  });

  it("keeps proposal titles and summaries stable", () => {
    expect(markdownChangeProposalTitle([editDraft()])).toBe("Edit doc.md");
    expect(markdownChangeProposalTitle([createDraft()])).toBe("Create annex.md");
    expect(markdownChangeProposalTitle([deleteDraft()])).toBe("Delete old.md");
    expect(markdownChangeProposalTitle([editDraft(), createDraft()])).toBe("Update 2 files");
    expect(markdownChangeProposalSummary([editDraft({ summary: "" }), createDraft({ summary: "Create annex" })])).toBe(
      "Create annex"
    );
    expect(markdownChangeProposalSummary([])).toBe("Prepared changes for review.");
  });

  it("uses singular Codex proposal copy for multi-file draft operations", () => {
    expect(
      codexFinalAssistantText({
        language: "en",
        rawText: "Changed files.",
        draftCount: 2,
        notes: []
      })
    ).toBe("I prepared a proposal. Review it in the document.");
  });

  it("does not append deterministic notes when a proposal exists", () => {
    expect(
      codexFinalAssistantText({
        language: "en",
        rawText: "Changed files.",
        draftCount: 1,
        notes: ["Codex protocol and disk changes disagreed for doc.md; using the disk change."]
      })
    ).toBe("I prepared a proposal. Review it in the document.");

    expect(
      codexFinalAssistantText({
        language: "es",
        rawText: "Archivos cambiados.",
        draftCount: 1,
        notes: ["Codex delete for doc.md is not supported."]
      })
    ).toBe("Preparé una propuesta. Revísala en el documento.");
  });

  it("uses deterministic notes only as the fallback when no proposal or text exists", () => {
    expect(
      codexFinalAssistantText({
        language: "en",
        rawText: "",
        draftCount: 0,
        notes: ["No reviewable Markdown changes were produced."]
      })
    ).toBe("No reviewable Markdown changes were produced.");
  });
});
