import {
  fileHasMutableReview,
  isVisiblePendingProposal,
  proposalDisplayTitle,
  reviewableFile,
  visibleProposalStatus
} from "../../assistant/assistantUtils";
import { internalReviewProposals } from "../../assistant/reviewQueue";
import { normalizeRelativePath } from "../../assistant/pendingFileTree";
import type { AppStrings } from "../../i18n/strings";
import type { AgentChangeProposal } from "../../types/iliad";

interface AssistantPendingProposalsProps {
  labels: AppStrings["assistant"];
  proposals: AgentChangeProposal[];
  onAcceptProposalFile: (proposalId: string, fileId: string) => Promise<void>;
  onRejectProposalFile: (proposalId: string, fileId: string) => Promise<void>;
}

export function AssistantPendingProposals({
  labels,
  proposals,
  onAcceptProposalFile,
  onRejectProposalFile
}: AssistantPendingProposalsProps) {
  const pendingProposals = internalReviewProposals(proposals).filter(isVisiblePendingProposal);
  const pathCounts = new Map<string, number>();

  for (const proposal of pendingProposals) {
    const file = reviewableFile(proposal);

    if (!file) {
      continue;
    }

    const path = normalizeRelativePath(file.relativePath);

    if (path) {
      pathCounts.set(path, (pathCounts.get(path) ?? 0) + 1);
    }
  }

  if (pendingProposals.length === 0) {
    return null;
  }

  return (
    <section className="assistant-pending" aria-label={labels.pendingChanges}>
      <header>{labels.pendingChanges}</header>
      {pendingProposals.map((proposal) => {
        const file = reviewableFile(proposal);
        const reviewableFiles = proposal.files.filter(fileHasMutableReview);
        const error = proposal.files.find((candidate) => candidate.error)?.error;
        const visibleStatus = visibleProposalStatus(proposal, labels);
        const normalizedPath = file ? normalizeRelativePath(file.relativePath) : "";
        const repeatedPath = normalizedPath ? (pathCounts.get(normalizedPath) ?? 0) > 1 : false;
        const runContext = repeatedPath
          ? new Date(proposal.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
          : null;

        return (
          <div key={proposal.id} className="assistant-patch-card">
            <div>
              <span>{labels.filesChanged(proposal.files.length)}</span>
              <strong>{proposalDisplayTitle(proposal)}</strong>
              {runContext ? <small>{runContext}</small> : null}
              {visibleStatus ? <small>{visibleStatus}</small> : null}
              {error ? <em>{error}</em> : null}
            </div>
            <div className="assistant-patch-actions">
              <button
                type="button"
                disabled={reviewableFiles.length === 0}
                onClick={() => {
                  void (async () => {
                    for (const candidate of reviewableFiles) {
                      await onAcceptProposalFile(proposal.id, candidate.id);
                    }
                  })();
                }}
              >
                {labels.acceptAll}
              </button>
              <button
                type="button"
                disabled={reviewableFiles.length === 0}
                onClick={() => {
                  void (async () => {
                    for (const candidate of reviewableFiles) {
                      await onRejectProposalFile(proposal.id, candidate.id);
                    }
                  })();
                }}
              >
                {labels.rejectAll}
              </button>
            </div>
          </div>
        );
      })}
    </section>
  );
}
