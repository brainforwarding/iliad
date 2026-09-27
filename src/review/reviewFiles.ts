import type { AgentChangeProposal, AgentProposalFileChange, ReviewFileExpectation, ReviewFileRevision } from "../types/iliad";

/** A review file still needs a decision (pending, stale, or failed). */
export function fileHasMutableReview(file: AgentProposalFileChange) {
  if (file.kind === "edit_file") {
    return file.status === "failed" || (file.hunks ?? []).some((hunk) => hunk.status === "pending" || hunk.status === "stale");
  }

  return file.status === "pending" || file.status === "stale" || file.status === "failed";
}

export function reviewableFile(proposal: AgentChangeProposal) {
  return proposal.files.find(fileHasMutableReview) ?? null;
}

/**
 * The revision of a review file as rendered: the hashes main compares before
 * any file-level Keep or Restore. A missing hash stays null, which main never
 * matches for a present side, so the action fails safe as stale.
 */
export function reviewFileRevision(file: AgentProposalFileChange): ReviewFileRevision {
  if (file.kind === "create_file") {
    return { baselineHash: null, diskHash: file.reviewedContentHash ?? null };
  }

  if (file.kind === "delete_file") {
    return { baselineHash: file.baselineContentHash ?? file.baseHash, diskHash: null };
  }

  return { baselineHash: file.baselineContentHash ?? file.baseHash, diskHash: file.reviewedContentHash ?? null };
}

export function reviewFileExpectation(file: AgentProposalFileChange): ReviewFileExpectation {
  return { fileId: file.id, ...reviewFileRevision(file) };
}
