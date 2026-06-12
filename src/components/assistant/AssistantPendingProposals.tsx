import {
  isVisiblePendingProposal,
  proposalDisplayTitle,
  reviewableFile,
  visibleProposalStatus
} from "../../assistant/assistantUtils";
import type { ReviewTarget } from "../../app/useAgentProposals";
import type { AppStrings } from "../../i18n/strings";
import type { AgentChangeProposal } from "../../types/iliad";

interface AssistantPendingProposalsProps {
  labels: AppStrings["assistant"];
  proposals: AgentChangeProposal[];
  onRejectProposal: (proposalId: string) => Promise<void>;
  onReviewTargetChange: (target: ReviewTarget | null) => void | Promise<void>;
}

export function AssistantPendingProposals({
  labels,
  proposals,
  onRejectProposal,
  onReviewTargetChange
}: AssistantPendingProposalsProps) {
  const pendingProposals = proposals.filter(isVisiblePendingProposal);

  if (pendingProposals.length === 0) {
    return null;
  }

  return (
    <section className="assistant-pending" aria-label={labels.pendingChanges}>
      <header>{labels.pendingChanges}</header>
      {pendingProposals.map((proposal) => {
        const file = reviewableFile(proposal);
        const error = proposal.files.find((candidate) => candidate.error)?.error;
        const visibleStatus = visibleProposalStatus(proposal, labels);

        return (
          <div key={proposal.id} className="assistant-patch-card">
            <div>
              <span>{labels.filesChanged(proposal.files.length)}</span>
              <strong>{proposalDisplayTitle(proposal)}</strong>
              {visibleStatus ? <small>{visibleStatus}</small> : null}
              {error ? <em>{error}</em> : null}
            </div>
            <div className="assistant-patch-actions">
              <button
                type="button"
                disabled={!file}
                onClick={() => {
                  if (file) {
                    void onReviewTargetChange({ proposalId: proposal.id, fileId: file.id });
                  }
                }}
              >
                {labels.review}
              </button>
              <button type="button" onClick={() => void onRejectProposal(proposal.id)}>
                {labels.discard}
              </button>
            </div>
          </div>
        );
      })}
    </section>
  );
}
