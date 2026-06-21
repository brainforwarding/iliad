import { fileHasMutableReview } from "./assistantUtils";
import type { AgentChangeProposal } from "../types/iliad";

export interface PendingReviewTarget {
  proposalId: string;
  fileId: string;
}

export function mutableReviewProposals(proposals: AgentChangeProposal[]) {
  return proposals.filter((proposal) => proposal.files.some(fileHasMutableReview));
}

export function mutableReviewFileCount(proposals: AgentChangeProposal[]) {
  return proposals.reduce((count, proposal) => count + proposal.files.filter(fileHasMutableReview).length, 0);
}

export function mutableReviewProposalIds(proposals: AgentChangeProposal[]) {
  return mutableReviewProposals(proposals).map((proposal) => proposal.id);
}

export function firstMutableReviewTarget(proposals: AgentChangeProposal[]): PendingReviewTarget | null {
  for (const proposal of proposals) {
    const file = proposal.files.find(fileHasMutableReview);

    if (file) {
      return { proposalId: proposal.id, fileId: file.id };
    }
  }

  return null;
}
