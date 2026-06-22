import { fileHasMutableReview } from "./assistantUtils";
import type { PendingFileTreeChange } from "./pendingFileTree";
import { normalizeRelativePath } from "./pendingFileTree";
import type { AgentChangeProposal, AgentProposalFileChange } from "../types/iliad";

export type ReviewQueueSource = "internal_agent" | "external_filesystem";

export type ReviewQueueBlockedReason =
  | "external_drift_same_path"
  | "stale"
  | "missing_file"
  | "path_collision";

export interface ReviewQueueItem {
  id: string;
  source: ReviewQueueSource;
  groupId: string;
  proposalId: string;
  fileId: string;
  runId: string;
  kind: AgentProposalFileChange["kind"];
  relativePath: string;
  normalizedRelativePath: string;
  updatedAt: string;
  visibleInFileTree: boolean;
  blockedReason?: ReviewQueueBlockedReason;
  duplicateFileIds: string[];
}

export interface ReviewTarget {
  proposalId: string;
  fileId: string;
}

export interface ReviewQueueSummary {
  items: ReviewQueueItem[];
  visibleItems: ReviewQueueItem[];
  internalItems: ReviewQueueItem[];
  externalItems: ReviewQueueItem[];
  firstTarget: ReviewTarget | null;
  stripBulkAction: "discard_internal" | "restore_external" | null;
}

function proposalSource(proposal: AgentChangeProposal): ReviewQueueSource {
  return proposal.metadata?.kind === "external_filesystem" ? "external_filesystem" : "internal_agent";
}

function itemSort(left: ReviewQueueItem, right: ReviewQueueItem) {
  const timestampDifference = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);

  if (timestampDifference !== 0) {
    return timestampDifference;
  }

  return right.id.localeCompare(left.id);
}

export function isExternalFilesystemProposal(proposal: AgentChangeProposal | undefined | null) {
  return proposal?.metadata?.kind === "external_filesystem";
}

export function internalReviewProposals(proposals: AgentChangeProposal[]) {
  return proposals.filter(
    (proposal) => !isExternalFilesystemProposal(proposal) && proposal.files.some(fileHasMutableReview)
  );
}

export function buildReviewQueueItems(proposals: AgentChangeProposal[]): ReviewQueueItem[] {
  const candidates: ReviewQueueItem[] = [];
  const grouped = new Map<string, ReviewQueueItem>();

  proposals.forEach((proposal, proposalIndex) => {
    const source = proposalSource(proposal);

    proposal.files.forEach((file, fileIndex) => {
      if (!fileHasMutableReview(file)) {
        return;
      }

      const normalizedRelativePath = normalizeRelativePath(file.relativePath);

      if (!normalizedRelativePath) {
        return;
      }

      const groupId = `${source}:${proposal.runId}:${normalizedRelativePath}`;
      const existing = grouped.get(groupId);

      if (existing) {
        existing.duplicateFileIds.push(file.id);
        return;
      }

      const item: ReviewQueueItem = {
        id: `${groupId}:${proposal.id}:${proposalIndex}:${fileIndex}`,
        source,
        groupId,
        proposalId: proposal.id,
        fileId: file.id,
        runId: proposal.runId,
        kind: file.kind,
        relativePath: file.relativePath,
        normalizedRelativePath,
        updatedAt: proposal.updatedAt || proposal.createdAt,
        visibleInFileTree: true,
        duplicateFileIds: []
      };

      grouped.set(groupId, item);
      candidates.push(item);
    });
  });

  const externalPaths = new Set(
    candidates
      .filter((item) => item.source === "external_filesystem")
      .map((item) => item.normalizedRelativePath)
  );
  const visiblePathKeys = new Set<string>();

  for (const item of [...candidates].sort(itemSort)) {
    if (item.source === "internal_agent" && externalPaths.has(item.normalizedRelativePath)) {
      item.visibleInFileTree = false;
      item.blockedReason = "external_drift_same_path";
      continue;
    }

    if (visiblePathKeys.has(item.normalizedRelativePath)) {
      item.visibleInFileTree = false;
      continue;
    }

    visiblePathKeys.add(item.normalizedRelativePath);
    item.visibleInFileTree = true;
  }

  return candidates.sort(itemSort);
}

export function buildReviewQueueSummary(proposals: AgentChangeProposal[]): ReviewQueueSummary {
  const items = buildReviewQueueItems(proposals);
  const visibleItems = items.filter((item) => item.visibleInFileTree && !item.blockedReason);
  const internalItems = items.filter((item) => item.source === "internal_agent");
  const externalItems = items.filter((item) => item.source === "external_filesystem");
  const hasInternalVisible = visibleItems.some((item) => item.source === "internal_agent");
  const hasExternalVisible = visibleItems.some((item) => item.source === "external_filesystem");
  const stripBulkAction =
    hasInternalVisible && hasExternalVisible
      ? null
      : hasExternalVisible
        ? "restore_external"
        : hasInternalVisible && visibleItems.length > 1
          ? "discard_internal"
          : null;
  const first = visibleItems[0] ?? null;

  return {
    items,
    visibleItems,
    internalItems,
    externalItems,
    firstTarget: first ? { proposalId: first.proposalId, fileId: first.fileId } : null,
    stripBulkAction
  };
}

export function pendingFileTreeChangesFromQueue(items: ReviewQueueItem[]): PendingFileTreeChange[] {
  return items
    .filter((item) => item.visibleInFileTree)
    .map((item) => ({
      proposalId: item.proposalId,
      fileId: item.fileId,
      kind: item.kind,
      relativePath: item.relativePath,
      normalizedRelativePath: item.normalizedRelativePath,
      status: item.blockedReason ? "stale" : "pending"
    }));
}
