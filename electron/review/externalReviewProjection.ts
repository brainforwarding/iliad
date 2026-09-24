import { createHash } from "node:crypto";
import path from "node:path";
import { unifiedDiff } from "./diff.js";
import { hashMarkdown } from "./hash.js";
import { buildMarkdownChangeProposal } from "./markdownChangeContract.js";
import { buildLineReviewHunks } from "./reviewDiff.js";
import type { AgentChangeProposal, AgentDraftFileChange } from "./types.js";

export interface ExternalReviewItem {
  relativePath: string;
  kind: "edit" | "create" | "delete";
  baselineContent: string | null;
  baselineHash: string | null;
  diskContent: string | null;
  diskHash: string | null;
}

export interface ExternalReviewSnapshot {
  workspaceRoot: string;
  revision: number;
  proposal: AgentChangeProposal | null;
}

export function workspaceFingerprint(workspaceRoot: string) {
  return createHash("sha256").update(path.resolve(workspaceRoot)).digest("hex").slice(0, 12);
}

export function externalReviewProposalId(workspaceRoot: string) {
  return `proposal-external-filesystem-${workspaceFingerprint(workspaceRoot)}`;
}

export function externalReviewFileId(relativePath: string) {
  return `external-file-${createHash("sha256").update(relativePath).digest("hex").slice(0, 16)}`;
}

export function externalReviewRunId(workspaceRoot: string) {
  return `external-filesystem-${workspaceFingerprint(workspaceRoot)}`;
}

function projectionRunRequest(workspaceRoot: string) {
  return {
    runId: externalReviewRunId(workspaceRoot),
    workspaceRoot
  };
}

export function externalReviewItemToDraft(item: ExternalReviewItem): AgentDraftFileChange {
  if (item.kind === "create") {
    const content = item.diskContent ?? "";
    return {
      kind: "create_file",
      relativePath: item.relativePath,
      content,
      summary: `Create ${item.relativePath}`,
      unifiedDiff: unifiedDiff("", content, item.relativePath)
    };
  }

  const baseContent = item.baselineContent ?? "";
  const baseHash = item.baselineHash ?? hashMarkdown(baseContent);

  if (item.kind === "delete") {
    return {
      kind: "delete_file",
      relativePath: item.relativePath,
      baseHash,
      baseContent,
      summary: `Delete ${item.relativePath}`,
      unifiedDiff: unifiedDiff(baseContent, "", item.relativePath)
    };
  }

  const replacement = item.diskContent ?? "";
  return {
    kind: "edit_file",
    relativePath: item.relativePath,
    baseHash,
    baseContent,
    replacement,
    summary: `Edit ${item.relativePath}`,
    unifiedDiff: unifiedDiff(baseContent, replacement, item.relativePath)
  };
}

/**
 * Projects the internal review items onto the renderer-facing proposal shape.
 * The renderer review UI, file tree overlay, and review queue consume this
 * shape unchanged; ids are stable per workspace and path.
 */
export function projectExternalReview(
  workspaceRoot: string,
  items: Iterable<ExternalReviewItem>,
  revision: number
): AgentChangeProposal | null {
  const drafts = [...items]
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
    .map(externalReviewItemToDraft);
  const proposal = buildMarkdownChangeProposal({
    request: projectionRunRequest(workspaceRoot),
    model: "external-filesystem",
    source: { kind: "external_agent" },
    draftFileChanges: drafts
  });

  if (!proposal) {
    return null;
  }

  proposal.id = externalReviewProposalId(workspaceRoot);
  proposal.metadata = {
    kind: "external_filesystem",
    baselineId: `baseline-${revision}`,
    snapshotId: `snapshot-${revision}`,
    revision,
    liveDisk: true,
    sessionScoped: true
  };
  proposal.files = proposal.files.map((file) => {
    file.id = externalReviewFileId(file.relativePath);

    if (file.kind === "edit_file") {
      file.hunks = buildLineReviewHunks(file.baseContent, file.replacement, file.id);
      file.baselineState = "present";
      file.baselineContentHash = file.baseHash;
      file.reviewedState = "present";
      file.reviewedContentHash = hashMarkdown(file.replacement);
    } else if (file.kind === "create_file") {
      file.baselineState = "absent";
      file.reviewedState = "present";
      file.reviewedContentHash = hashMarkdown(file.content);
    } else {
      file.baselineState = "present";
      file.baselineContentHash = file.baseHash;
      file.reviewedState = "absent";
    }

    return file;
  });

  return proposal;
}

/**
 * Marks one (or every) file of a projected proposal as terminal for the IPC
 * response of a review action. The pushed snapshot that follows carries the
 * actual post-action review state.
 */
export function terminalExternalReviewProposal(
  proposal: AgentChangeProposal,
  fileId: string | null,
  status: "applied" | "rejected" | "stale"
): AgentChangeProposal {
  const next = JSON.parse(JSON.stringify(proposal)) as AgentChangeProposal;

  for (const file of next.files) {
    if (fileId && file.id !== fileId) {
      continue;
    }

    file.status = status;

    if (file.kind === "edit_file") {
      for (const hunk of file.hunks ?? []) {
        if (hunk.status === "pending" || hunk.status === "stale") {
          hunk.status = status === "applied" ? "accepted" : status;
        }
      }
    }
  }

  next.status = fileId ? recomputeStatus(next) : status;
  next.updatedAt = new Date().toISOString();
  return next;
}

function recomputeStatus(proposal: AgentChangeProposal): AgentChangeProposal["status"] {
  if (proposal.files.every((file) => file.status === "applied")) {
    return "applied";
  }

  if (proposal.files.every((file) => file.status === "rejected")) {
    return "rejected";
  }

  if (proposal.files.some((file) => file.status === "applied")) {
    return "partially_applied";
  }

  if (proposal.files.some((file) => file.status === "stale")) {
    return "stale";
  }

  return "pending";
}
