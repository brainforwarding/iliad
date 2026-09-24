import { fileHasMutableReview } from "./reviewFiles";
import type { PendingFileTreeChange } from "./pendingFileTree";
import { normalizeRelativePath } from "./pendingFileTree";
import type { AgentChangeProposal, AgentProposalFileChange } from "../types/iliad";

export interface ReviewQueueItem {
  id: string;
  proposalId: string;
  fileId: string;
  kind: AgentProposalFileChange["kind"];
  relativePath: string;
  normalizedRelativePath: string;
  createdAt: string;
  updatedAt: string;
  /** Other file ids of the same proposal for the same path (reviewed together). */
  duplicateFileIds: string[];
}

export interface ReviewTarget {
  proposalId: string;
  fileId: string;
}

export interface ReviewQueueSummary {
  items: ReviewQueueItem[];
  firstTarget: ReviewTarget | null;
}

export function isExternalFilesystemProposal(proposal: AgentChangeProposal | undefined | null) {
  return proposal?.metadata?.kind === "external_filesystem";
}

function itemTime(item: ReviewQueueItem) {
  const parsed = Date.parse(item.createdAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * One queue item per pending outside-change path. Only outside-change
 * (external filesystem) proposals are reviewable; anything else is ignored.
 */
export function buildReviewQueueItems(proposals: AgentChangeProposal[]): ReviewQueueItem[] {
  const items: ReviewQueueItem[] = [];
  const byPath = new Map<string, ReviewQueueItem>();

  proposals.forEach((proposal, proposalIndex) => {
    if (!isExternalFilesystemProposal(proposal)) {
      return;
    }

    proposal.files.forEach((file, fileIndex) => {
      if (!fileHasMutableReview(file)) {
        return;
      }

      const normalizedRelativePath = normalizeRelativePath(file.relativePath);

      if (!normalizedRelativePath) {
        return;
      }

      const existing = byPath.get(normalizedRelativePath);

      if (existing) {
        if (existing.proposalId === proposal.id) {
          existing.duplicateFileIds.push(file.id);
        }

        return;
      }

      const item: ReviewQueueItem = {
        id: `${proposal.id}:${normalizedRelativePath}:${proposalIndex}:${fileIndex}`,
        proposalId: proposal.id,
        fileId: file.id,
        kind: file.kind,
        relativePath: file.relativePath,
        normalizedRelativePath,
        createdAt: proposal.createdAt,
        updatedAt: proposal.updatedAt || proposal.createdAt,
        duplicateFileIds: []
      };

      byPath.set(normalizedRelativePath, item);
      items.push(item);
    });
  });

  return items.sort((left, right) => itemTime(right) - itemTime(left) || right.id.localeCompare(left.id));
}

export function buildReviewQueueSummary(proposals: AgentChangeProposal[]): ReviewQueueSummary {
  const items = buildReviewQueueItems(proposals);
  const first = items[0] ?? null;

  return {
    items,
    firstTarget: first ? { proposalId: first.proposalId, fileId: first.fileId } : null
  };
}

export function pendingFileTreeChangesFromQueue(items: ReviewQueueItem[]): PendingFileTreeChange[] {
  return items.map((item) => ({
    proposalId: item.proposalId,
    fileId: item.fileId,
    kind: item.kind,
    relativePath: item.relativePath,
    normalizedRelativePath: item.normalizedRelativePath,
    status: "pending"
  }));
}
