import type {
  AgentChangeProposal,
  AgentDraftFileChange,
  AgentProposalFileChange,
  AgentProposalSource,
  AgentRunRequest
} from "./types.js";

export type MarkdownChangeOperation = AgentDraftFileChange;

export interface ProposeMarkdownChanges {
  changes: MarkdownChangeOperation[];
}

export interface BuildMarkdownChangeProposalOptions {
  request: AgentRunRequest;
  model: string;
  responseId?: string;
  source: AgentProposalSource;
  draftFileChanges: AgentDraftFileChange[];
  clock?: () => Date;
}

export function buildMarkdownChangeProposal({
  request,
  model,
  responseId,
  source,
  draftFileChanges,
  clock
}: BuildMarkdownChangeProposalOptions): AgentChangeProposal | null {
  if (draftFileChanges.length === 0) {
    return null;
  }

  const now = (clock?.() ?? new Date()).toISOString();

  return {
    id: `proposal-${request.runId}`,
    runId: request.runId,
    responseId,
    workspaceRoot: request.workspaceRoot,
    title: markdownChangeProposalTitle(draftFileChanges),
    summary: markdownChangeProposalSummary(draftFileChanges),
    createdAt: now,
    updatedAt: now,
    model,
    source,
    status: "pending",
    files: draftFileChanges.map((draft, index) => markdownChangeProposalFile(request.runId, draft, index))
  };
}

export function markdownChangeProposalTitle(drafts: AgentDraftFileChange[]) {
  if (drafts.length === 1) {
    if (drafts[0].kind === "edit_file") {
      return `Edit ${drafts[0].relativePath}`;
    }

    if (drafts[0].kind === "delete_file") {
      return `Delete ${drafts[0].relativePath}`;
    }

    return `Create ${drafts[0].relativePath}`;
  }

  return `Update ${drafts.length} files`;
}

export function markdownChangeProposalSummary(drafts: AgentDraftFileChange[]) {
  return drafts.map((draft) => draft.summary).find(Boolean) ?? "Prepared changes for review.";
}

function markdownChangeProposalFile(
  runId: string,
  draft: AgentDraftFileChange,
  index: number
): AgentProposalFileChange {
  const id = `${draft.kind}-${runId}-${index + 1}`;

  if (draft.kind === "edit_file") {
    return {
      id,
      kind: "edit_file",
      status: "pending",
      relativePath: draft.relativePath,
      baseHash: draft.baseHash,
      baseContent: draft.baseContent,
      replacement: draft.replacement,
      unifiedDiff: draft.unifiedDiff
    };
  }

  if (draft.kind === "create_file") {
    return {
      id,
      kind: "create_file",
      status: "pending",
      relativePath: draft.relativePath,
      content: draft.content,
      unifiedDiff: draft.unifiedDiff
    };
  }

  return {
    id,
    kind: "delete_file",
    status: "pending",
    relativePath: draft.relativePath,
    baseHash: draft.baseHash,
    baseContent: draft.baseContent,
    unifiedDiff: draft.unifiedDiff
  };
}
