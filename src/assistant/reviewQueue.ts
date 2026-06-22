import { fileHasMutableReview } from "./assistantUtils";
import type { PendingFileTreeChange } from "./pendingFileTree";
import { normalizeRelativePath } from "./pendingFileTree";
import type { AgentChangeProposal, AgentProposalFileChange } from "../types/iliad";

export type ReviewQueueSource = "internal_agent" | "external_filesystem";

export type ReviewQueueBlockedReason =
  | "external_drift_same_path"
  | "superseded_same_path"
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
  createdAt: string;
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

function proposalCreatedTime(proposal: Pick<AgentChangeProposal, "createdAt">) {
  const parsed = Date.parse(proposal.createdAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function proposalCreationCompareDesc(
  left: Pick<AgentChangeProposal, "id" | "runId" | "createdAt">,
  right: Pick<AgentChangeProposal, "id" | "runId" | "createdAt">
) {
  const timestampDifference = proposalCreatedTime(right) - proposalCreatedTime(left);

  if (timestampDifference !== 0) {
    return timestampDifference;
  }

  const runDifference = right.runId.localeCompare(left.runId);

  if (runDifference !== 0) {
    return runDifference;
  }

  return right.id.localeCompare(left.id);
}

function itemSort(left: ReviewQueueItem, right: ReviewQueueItem) {
  const leftTime = Number.isFinite(Date.parse(left.createdAt)) ? Date.parse(left.createdAt) : 0;
  const rightTime = Number.isFinite(Date.parse(right.createdAt)) ? Date.parse(right.createdAt) : 0;
  const timestampDifference = rightTime - leftTime;

  if (timestampDifference !== 0) {
    return timestampDifference;
  }

  return right.id.localeCompare(left.id);
}

export function isExternalFilesystemProposal(proposal: AgentChangeProposal | undefined | null) {
  return proposal?.metadata?.kind === "external_filesystem";
}

export function internalReviewProposals(proposals: AgentChangeProposal[]) {
  const visibleFileIdsByProposal = new Map<string, Set<string>>();

  for (const item of buildReviewQueueItems(proposals)) {
    if (item.source !== "internal_agent" || !item.visibleInFileTree || item.blockedReason) {
      continue;
    }

    const fileIds = visibleFileIdsByProposal.get(item.proposalId) ?? new Set<string>();
    fileIds.add(item.fileId);

    for (const duplicateFileId of item.duplicateFileIds) {
      fileIds.add(duplicateFileId);
    }

    visibleFileIdsByProposal.set(item.proposalId, fileIds);
  }

  return proposals
    .filter((proposal) => !isExternalFilesystemProposal(proposal) && visibleFileIdsByProposal.has(proposal.id))
    .map((proposal) => ({
      ...proposal,
      files: proposal.files.filter((file) => visibleFileIdsByProposal.get(proposal.id)?.has(file.id))
    }))
    .filter((proposal) => proposal.files.some(fileHasMutableReview));
}

export function buildReviewQueueItems(proposals: AgentChangeProposal[]): ReviewQueueItem[] {
  const candidates: ReviewQueueItem[] = [];
  const grouped = new Map<string, ReviewQueueItem>();
  const newestInternalPathOwner = new Map<
    string,
    { proposalId: string; fileId: string; proposal: AgentChangeProposal }
  >();

  proposals.forEach((proposal) => {
    if (proposalSource(proposal) !== "internal_agent") {
      return;
    }

    proposal.files.forEach((file) => {
      const normalizedRelativePath = normalizeRelativePath(file.relativePath);

      if (!normalizedRelativePath) {
        return;
      }

      const current = newestInternalPathOwner.get(normalizedRelativePath);

      if (!current || proposalCreationCompareDesc(proposal, current.proposal) < 0) {
        newestInternalPathOwner.set(normalizedRelativePath, {
          proposalId: proposal.id,
          fileId: file.id,
          proposal
        });
      }
    });
  });

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
        createdAt: proposal.createdAt,
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

    const newestInternalOwner = newestInternalPathOwner.get(item.normalizedRelativePath);

    if (
      item.source === "internal_agent" &&
      newestInternalOwner &&
      newestInternalOwner.proposalId !== item.proposalId
    ) {
      item.visibleInFileTree = false;
      item.blockedReason = "superseded_same_path";
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
