import type { AppStrings } from "../i18n/strings";
import type {
  AgentActivityRunEvent,
  AgentChangeProposal,
  AgentError,
  AgentProposalFileChange,
  AgentRunPhase,
  AgentRunContextInclusion,
  AgentRunContextItem,
  AgentRunContextManifest
} from "../types/iliad";
import { isVisibleMarkdownContextPath, normalizeRelativePath } from "./contextAttachments";

const maxThinkingStatusLength = 280;

export function fileBasename(path: string) {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

type AssistantContextLabels = AppStrings["assistant"]["context"];

export interface ContextManifestDetailRow {
  id: string;
  primary: string;
  secondary?: string;
}

export function shortContextHash(hash: string | undefined | null, length = 8) {
  const compact = hash?.trim();

  if (!compact) {
    return null;
  }

  return compact.length <= length ? compact : compact.slice(0, length);
}

export function contextManifestDetailRows(
  manifest: Pick<AgentRunContextManifest, "items"> | undefined | null,
  labels: AssistantContextLabels
): ContextManifestDetailRow[] {
  return (manifest?.items ?? []).map((item) => ({
    id: item.id || `${item.kind}-${item.reason}`,
    primary: contextManifestItemDisplayText(item, labels),
    secondary: contextManifestItemSecondaryText(item, labels)
  }));
}

export function contextManifestProviderText(
  manifest: Pick<AgentRunContextManifest, "provider" | "model">,
  labels: AssistantContextLabels
) {
  return labels.provider(manifest.provider.label, manifest.model);
}

export function contextManifestItemDisplayText(item: AgentRunContextItem, labels: AssistantContextLabels) {
  if (item.reason === "conversation_history_budget_omitted") {
    return labels.historyOmitted(item.resultCount ?? 0);
  }

  if (item.reason === "conversation_summary") {
    return labels.summaryUsed(item.resultCount ?? 0);
  }

  if (item.reason === "model_directed_document_list") {
    return labels.documentList;
  }

  if (item.reason === "model_directed_document_search") {
    return labels.documentSearch;
  }

  if (item.reason === "model_directed_document_read_failed") {
    return safeActivityPath(item.relativePath) ?? labels.documentReadFailed;
  }

  if (item.kind === "runtime_workspace") {
    return labels.workspaceAccess;
  }

  if (item.kind === "workspace_scope") {
    return item.inclusion === "excluded" ? labels.excludedWorkspace : labels.workspaceFiles;
  }

  if (item.reason === "editor_selection" && typeof item.lineStart === "number" && typeof item.lineEnd === "number") {
    return labels.selection(item.lineStart, item.lineEnd);
  }

  if (item.reason === "workspace_rules" || item.reason === "workspace_rules_oversized") {
    return labels.workspaceRules;
  }

  if (item.relativePath) {
    return item.relativePath;
  }

  if (item.label) {
    return item.label;
  }

  return item.kind === "current_file" ? labels.currentFile : labels.reference;
}

export function contextManifestInclusionLabel(inclusion: AgentRunContextInclusion, labels: AssistantContextLabels) {
  switch (inclusion) {
    case "available":
      return labels.available;
    case "excluded":
      return labels.excluded;
    case "reference":
      return labels.reference;
    case "full":
    default:
      return labels.included;
  }
}

function isFileLikeContextItem(item: AgentRunContextItem) {
  return (
    (item.kind === "current_file" || item.kind === "proposal" || item.kind === "document_read") &&
    item.inclusion !== "excluded"
  );
}

function contextManifestItemSecondaryText(item: AgentRunContextItem, labels: AssistantContextLabels) {
  if (item.reason === "model_directed_document_search" || item.reason === "model_directed_document_list") {
    return contextManifestMetadataText(item, labels);
  }

  if (item.kind === "runtime_workspace" || item.kind === "workspace_scope") {
    return contextManifestInclusionLabel(item.inclusion, labels);
  }

  if (item.inclusion === "reference") {
    return labels.reference;
  }

  if (item.inclusion === "excluded") {
    return labels.excluded;
  }

  return undefined;
}

function contextManifestMetadataText(item: AgentRunContextItem, labels: AssistantContextLabels) {
  const parts: string[] = [];

  if (typeof item.resultCount === "number") {
    parts.push(labels.resultCount(item.resultCount));
  }

  if (typeof item.searchedPaths === "number") {
    parts.push(labels.searchedPaths(item.searchedPaths));
  }

  if (typeof item.searchedFiles === "number") {
    parts.push(labels.searchedFiles(item.searchedFiles));
  }

  if (item.truncated) {
    parts.push(labels.truncated);
  }

  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function safeActivityPath(relativePath: string | undefined) {
  if (!relativePath) {
    return null;
  }

  if (/^(?:\/|~\/|[A-Za-z]:[\\/])/.test(relativePath.trim())) {
    return null;
  }

  const normalized = normalizeRelativePath(relativePath);
  return isVisibleMarkdownContextPath(normalized) ? normalized : null;
}

function safeActivityQuery(query: string | undefined) {
  if (!query) {
    return null;
  }

  if (/(^|[\s"'`])(?:\/|~\/|[A-Za-z]:[\\/])/.test(query)) {
    return null;
  }

  if (/\b(?:sk-[A-Za-z0-9_-]{8,}|github_pat_|ghp_|xox[baprs]-|AIza[0-9A-Za-z_-]{10,})/.test(query)) {
    return null;
  }

  if (/[\u0000-\u001f\u007f]/.test(query)) {
    return null;
  }

  const compact = query.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();

  if (!compact || compact.length > 80) {
    return null;
  }

  return compact;
}

/**
 * Mines prior turns' manifests for documents the conversation actually saw
 * (current file or document reads with full inclusion) and returns an
 * identifier-only index, most recently referenced first (ADR-0014). Error
 * entries are mined too: documents read during a failed run were still
 * referenced. The main process re-sanitizes and re-filters after @-mention
 * resolution; the exclude list here is a best-effort de-noiser.
 */
export function previouslyReferencedDocumentPaths(
  entries: Array<{ kind: string; contextManifest?: Pick<AgentRunContextManifest, "items"> }>,
  excludePaths: string[],
  limit = 20
): string[] {
  const excluded = new Set(excludePaths.map((path) => normalizeRelativePath(path).toLowerCase()));
  const seen = new Set<string>();
  const result: string[] = [];

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];

    if (entry.kind !== "assistant" && entry.kind !== "error") {
      continue;
    }

    for (const item of entry.contextManifest?.items ?? []) {
      if ((item.kind !== "current_file" && item.kind !== "document_read") || item.inclusion !== "full") {
        continue;
      }

      // Workspace rules are standing context, not a conversational reference.
      if (item.reason === "workspace_rules") {
        continue;
      }

      if (!item.relativePath) {
        continue;
      }

      const normalized = normalizeRelativePath(item.relativePath);

      if (!isVisibleMarkdownContextPath(normalized)) {
        continue;
      }

      const key = normalized.toLowerCase();

      if (seen.has(key) || excluded.has(key)) {
        continue;
      }

      seen.add(key);
      result.push(normalized);

      if (result.length >= limit) {
        return result;
      }
    }
  }

  return result;
}

/**
 * Header line for the permanent turn receipt: the "Process" label, plus action
 * counts when the run used document tools. Counting semantics: reads are
 * distinct completed document_read paths; searches are completed
 * document_search rows; failed reads are keyed to kind document_read_failed (a
 * document_read stuck in "started" renders in the body but is not counted).
 * Turns without counted activity show the bare label; the context rows
 * (current file, workspace access, no-file negative) live in the expanded
 * body. This amends the byte-identical-fallback decision of the morning spec.
 */
export function turnReceiptSummary(activities: AgentActivityRunEvent[], labels: Pick<AppStrings["assistant"], "receipt">) {
  const reads = new Set<string>();
  const opens = new Set<string>();
  let searches = 0;
  let failedReads = 0;

  for (const activity of activities) {
    if (activity.kind === "document_read" && activity.status === "completed") {
      reads.add((activity.relativePath ?? activity.activityId).toLowerCase());
    } else if (activity.kind === "document_open" && activity.status === "completed") {
      opens.add((activity.relativePath ?? activity.activityId).toLowerCase());
    } else if (activity.kind === "document_search" && activity.status === "completed") {
      searches += 1;
    } else if (activity.kind === "document_read_failed") {
      failedReads += 1;
    }
  }

  const parts: string[] = [labels.receipt.process];

  if (reads.size > 0) {
    parts.push(labels.receipt.reads(reads.size));
  }

  if (searches > 0) {
    parts.push(labels.receipt.searches(searches));
  }

  if (opens.size > 0) {
    parts.push(labels.receipt.opens(opens.size));
  }

  if (failedReads > 0) {
    parts.push(labels.receipt.readsFailed(failedReads));
  }

  return parts.join(" · ");
}

/**
 * Past-tense activity titles for the permanent receipt; the live trail keeps
 * the progressive set (activityTitle).
 */
export function receiptActivityTitle(activity: AgentActivityRunEvent, labels: AppStrings["assistant"]["receipt"]) {
  const path = safeActivityPath(activity.relativePath);

  if (activity.kind === "document_read") {
    return path ? labels.documentRead(path) : labels.documentReadGeneric;
  }

  if (activity.kind === "document_open") {
    return path ? labels.documentOpen(path) : labels.documentOpenGeneric;
  }

  if (activity.kind === "document_read_failed") {
    return path ? labels.documentReadFailed(path) : labels.documentReadFailedGeneric;
  }

  if (activity.kind === "document_search") {
    const query = safeActivityQuery(activity.query);
    return query ? labels.documentSearchQuery(query) : labels.documentSearch;
  }

  return labels.documentList;
}

/**
 * Manifest rows for the turn receipt. When activity rows render, model-directed
 * manifest rows are filtered (the activity row is the richer rendering of the
 * same action); conversation_reference_index items always group into one row.
 */
export function turnReceiptDetailRows(
  manifest: Pick<AgentRunContextManifest, "items"> | undefined | null,
  hasActivityRows: boolean,
  labels: AssistantContextLabels
): ContextManifestDetailRow[] {
  const rows: ContextManifestDetailRow[] = [];
  let referenceIndexCount = 0;

  // The old collapsed summary stated the no-file negative ("sin archivo")
  // explicitly; with the header reduced to "Process", the negative moves into
  // the body as a row — absence of a current-file row alone is too implicit.
  if (manifest && !(manifest.items ?? []).some(isFileLikeContextItem)) {
    rows.push({ id: "no-file-included", primary: labels.noFileIncluded });
  }

  for (const item of manifest?.items ?? []) {
    if (item.reason === "conversation_reference_index") {
      referenceIndexCount += 1;
      continue;
    }

    if (hasActivityRows && item.reason.startsWith("model_directed_")) {
      continue;
    }

    rows.push({
      id: item.id || `${item.kind}-${item.reason}`,
      primary: contextManifestItemDisplayText(item, labels),
      secondary: contextManifestItemSecondaryText(item, labels)
    });
  }

  if (referenceIndexCount > 0) {
    rows.push({
      id: "conversation-reference-group",
      primary: labels.referencedEarlier(referenceIndexCount),
      secondary: labels.reference
    });
  }

  return rows;
}

export function mergeRunActivityEvent(current: AgentActivityRunEvent[], event: AgentActivityRunEvent) {
  const existing = current.find((activity) => activity.activityId === event.activityId);
  const nextEvent = existing ? { ...event, sequence: existing.sequence } : event;
  return [
    ...current.map((activity) => (activity.activityId === event.activityId ? nextEvent : activity)),
    ...(existing ? [] : [nextEvent])
  ].sort((left, right) => left.sequence - right.sequence);
}

export function visibleRunActivities(activities: AgentActivityRunEvent[], limit = 5) {
  return [...activities].sort((left, right) => left.sequence - right.sequence).slice(-limit);
}

export function activityTitle(activity: AgentActivityRunEvent, labels: AppStrings["assistant"]["activity"]) {
  const path = safeActivityPath(activity.relativePath);

  if (activity.kind === "document_read") {
    return path ? labels.documentRead(path) : labels.documentReadGeneric;
  }

  if (activity.kind === "document_open") {
    return path ? labels.documentOpen(path) : labels.documentOpenGeneric;
  }

  if (activity.kind === "document_read_failed") {
    return path ? labels.documentReadFailed(path) : labels.documentReadFailedGeneric;
  }

  if (activity.kind === "document_search") {
    const query = safeActivityQuery(activity.query);
    return query ? labels.documentSearchQuery(query) : labels.documentSearch;
  }

  return labels.documentList;
}

export function activityMetadata(activity: AgentActivityRunEvent, labels: AssistantContextLabels) {
  const parts: string[] = [];

  if (typeof activity.resultCount === "number") {
    parts.push(labels.resultCount(activity.resultCount));
  }

  if (typeof activity.searchedPaths === "number") {
    parts.push(labels.searchedPaths(activity.searchedPaths));
  }

  if (typeof activity.searchedFiles === "number") {
    parts.push(labels.searchedFiles(activity.searchedFiles));
  }

  if (activity.truncated) {
    parts.push(labels.truncated);
  }

  return parts.join(" · ");
}

export function agentErrorMessage(labels: AppStrings["assistant"], error: AgentError) {
  if (error.code === "provider_unavailable" && error.userMessage && /^Codex\b/i.test(error.userMessage)) {
    return error.userMessage;
  }

  return labels.errors[error.code] ?? error.userMessage ?? labels.errorFallback;
}

export function compactStatusText(text: string) {
  const compact = text.replace(/\s+/g, " ").trim();

  if (compact.length <= maxThinkingStatusLength) {
    return compact;
  }

  return `${compact.slice(0, maxThinkingStatusLength - 3).trimEnd()}...`;
}

export function localizedStatusMessage(message: string, labels: AppStrings["assistant"]) {
  const compact = compactStatusText(message);
  const normalized = compact.toLowerCase().replace(/[\s-]+/g, "_");

  switch (normalized) {
    case "preparing_context":
    case "reading_context":
      return labels.status.reading;
    case "asking_model":
      return labels.status.asking;
    case "thinking":
      return labels.status.thinking;
    case "finalizing":
      return labels.status.finalizing;
    case "preparing_proposal":
      return labels.status.preparingProposal;
    case "reviewing_changes":
      return labels.status.reviewingChanges;
    default:
      return compact;
  }
}

export function localizedRunPhase(phase: AgentRunPhase, labels: AppStrings["assistant"]) {
  switch (phase) {
    case "reading_context":
      return labels.status.reading;
    case "asking_model":
      return labels.status.asking;
    case "reviewing_changes":
      return labels.status.reviewingChanges;
    case "waiting_for_review":
      return labels.status.reviewingChanges;
    case "completed":
    case "failed":
    case "canceled":
      return "";
  }
}

export function thinkingStatusText(text: string, labels: AppStrings["assistant"]) {
  const summary = compactStatusText(text);
  return summary || labels.status.thinking;
}

export function isGenericRunningStatus(text: string, labels: AppStrings["assistant"]) {
  return new Set<string>([
    labels.status.reading,
    labels.status.asking,
    labels.status.thinking,
    labels.status.finalizing,
    labels.status.preparingProposal,
    labels.status.reviewingChanges
  ]).has(text);
}

export function fileHasMutableReview(file: AgentProposalFileChange) {
  if (file.kind === "edit_file") {
    return file.status === "failed" || (file.hunks ?? []).some((hunk) => hunk.status === "pending" || hunk.status === "stale");
  }

  return file.status === "pending" || file.status === "stale" || file.status === "failed";
}

export function reviewableFile(proposal: AgentChangeProposal) {
  return proposal.files.find(fileHasMutableReview) ?? null;
}

export function isVisiblePendingProposal(proposal: AgentChangeProposal) {
  return proposal.files.some(fileHasMutableReview);
}

export function proposalDisplayTitle(proposal: AgentChangeProposal) {
  if (proposal.files.length === 1) {
    return proposal.files[0]?.relativePath ?? proposal.title;
  }

  return proposal.title;
}

export function visibleProposalStatus(proposal: AgentChangeProposal, labels: AppStrings["assistant"]) {
  const hasFailedFile = proposal.files.some((file) => file.status === "failed");
  const hasStaleFile = proposal.files.some((file) => file.status === "stale");

  if (proposal.status === "failed" || hasFailedFile) {
    return labels.proposalStatus.failed;
  }

  if (proposal.status === "stale" || hasStaleFile) {
    return labels.proposalStatus.stale;
  }

  return null;
}
