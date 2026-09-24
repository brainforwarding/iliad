import type { AgentChangeProposal, AgentProposalFileChange } from "../types/iliad";

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
