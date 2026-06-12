import path from "node:path";
import { estimateTokensFromText } from "./conversationHistory.js";
import { sanitizeEditorSelection, selectionLineRange } from "./documentContext.js";
import type { AgentModelId } from "./agentModels.js";
import type { AgentRuntimeProviderMetadata } from "./runtime/provider.js";
import type {
  AgentMode,
  AgentRunContextInclusion,
  AgentRunContextItem,
  AgentRunContextItemKind,
  AgentRunContextManifest,
  AgentRunContextManifestStatus,
  AgentProviderRunRequest,
  AgentError
} from "./types.js";

export interface BuildAgentRunContextManifestInput {
  request: AgentProviderRunRequest;
  provider: AgentRuntimeProviderMetadata;
  model: AgentModelId | string;
  workspaceId: string;
  now?: string;
}

export function buildAgentRunContextManifest({
  request,
  provider,
  model,
  workspaceId,
  now = new Date().toISOString()
}: BuildAgentRunContextManifestInput): AgentRunContextManifest {
  const items = buildContextItems(request, provider);

  return {
    id: `manifest-${request.runId}`,
    runId: request.runId,
    createdAt: now,
    updatedAt: now,
    status: "running",
    workspaceLabel: workspaceLabel(request.workspaceRoot),
    workspaceId,
    workspaceRootPersisted: false,
    provider: sanitizeProviderMetadata(provider),
    model,
    mode: request.mode,
    language: request.language,
    policy: "auto",
    items,
    estimatedInputTokens: estimateInputTokens(request, items),
    proposalIds: []
  };
}

export function manifestStatusForAgentError(error: AgentError): AgentRunContextManifestStatus {
  return error.code === "request_canceled" ? "canceled" : "failed";
}

export function sanitizeManifestError(error: AgentError): AgentRunContextManifest["error"] {
  return {
    code: error.code,
    userMessage: error.userMessage,
    retryable: error.retryable,
    ...(typeof error.providerStatus === "number" ? { providerStatus: error.providerStatus } : {})
  };
}

export function serializeAgentRunContextManifest(manifest: Partial<AgentRunContextManifest> | undefined): AgentRunContextManifest {
  const source = manifest ?? {};

  return {
    id: stringValue(source.id),
    runId: stringValue(source.runId),
    createdAt: stringValue(source.createdAt),
    updatedAt: stringValue(source.updatedAt),
    status: manifestStatus(source.status),
    workspaceLabel: stringValue(source.workspaceLabel),
    workspaceId: stringValue(source.workspaceId),
    workspaceRootPersisted: false,
    provider: sanitizeProviderMetadata(source.provider),
    model: stringValue(source.model),
    mode: agentMode(source.mode),
    language: source.language === "es" ? "es" : "en",
    policy: "auto",
    items: Array.isArray(source.items) ? source.items.map(serializeContextItem) : [],
    estimatedInputTokens: nonNegativeInteger(source.estimatedInputTokens),
    ...(source.responseId ? { responseId: stringValue(source.responseId) } : {}),
    proposalIds: Array.isArray(source.proposalIds) ? source.proposalIds.map(stringValue) : [],
    ...(source.error ? { error: sanitizeStoredError(source.error) } : {})
  };
}

// The estimator lives in conversationHistory.ts (import direction:
// contextManifest -> conversationHistory, never the reverse); re-exported here
// for existing callers.
export { estimateTokensFromText };

function buildContextItems(request: AgentProviderRunRequest, provider: AgentRuntimeProviderMetadata): AgentRunContextItem[] {
  const items: AgentRunContextItem[] = [];

  if (request.activeFile) {
    items.push({
      id: "current-file",
      kind: "current_file",
      label: path.basename(request.activeFile.relativePath) || "Current file",
      relativePath: request.activeFile.relativePath,
      inclusion: "full",
      reason: "active_markdown_file",
      baseHash: request.activeFile.baseHash,
      estimatedTokens: estimateTokensFromText(request.activeFile.content)
    });
  }

  for (const document of request.contextDocuments ?? []) {
    items.push({
      id: `document-read-${document.correlationId}`,
      kind: "document_read",
      label: path.basename(document.relativePath) || "Document",
      relativePath: document.relativePath,
      inclusion: "full",
      reason: document.source === "manual_attachment" ? "manual_context_attachment" : "explicit_file_mention",
      baseHash: document.baseHash,
      estimatedTokens: document.estimatedTokens,
      correlationId: document.correlationId
    });
  }

  for (const reference of request.unresolvedContextReferences ?? []) {
    items.push({
      id: `document-reference-${reference.correlationId}`,
      kind: "document_reference",
      label: reference.safeDisplayPath ? path.basename(reference.safeDisplayPath) || reference.safeDisplayPath : "Unresolved document reference",
      ...(reference.safeDisplayPath ? { relativePath: reference.safeDisplayPath } : {}),
      inclusion: "excluded",
      reason: reference.source === "manual_attachment" ? "manual_context_attachment_unresolved" : "explicit_file_mention_unresolved",
      correlationId: reference.correlationId
    });
  }

  if (request.workspaceRules) {
    items.push({
      id: "workspace-rules",
      kind: "document_read",
      label: "Workspace rules",
      relativePath: request.workspaceRules.relativePath,
      inclusion: "full",
      reason: "workspace_rules",
      baseHash: request.workspaceRules.baseHash,
      estimatedTokens: request.workspaceRules.estimatedTokens
    });
  } else if (request.workspaceRulesExcluded) {
    items.push({
      id: "workspace-rules",
      kind: "document_reference",
      label: "Workspace rules",
      relativePath: "AGENTS.md",
      inclusion: "excluded",
      reason: "workspace_rules_oversized"
    });
  }

  const editorSelection = sanitizeEditorSelection(request);

  if (editorSelection && request.activeFile) {
    const { lineStart, lineEnd } = selectionLineRange(request.activeFile.content, editorSelection.from, editorSelection.to);
    items.push({
      id: "editor-selection",
      kind: "current_file",
      label: "Selection",
      relativePath: request.activeFile.relativePath,
      inclusion: "full",
      reason: "editor_selection",
      estimatedTokens: estimateTokensFromText(
        request.activeFile.content.slice(editorSelection.from, editorSelection.to)
      ),
      lineStart,
      lineEnd
    });
  }

  for (const [index, relativePath] of (request.previouslyReferencedDocuments ?? []).entries()) {
    items.push({
      id: `conversation-reference-${index + 1}`,
      kind: "document_reference",
      label: path.posix.basename(relativePath) || relativePath,
      relativePath,
      inclusion: "reference",
      reason: "conversation_reference_index"
    });
  }

  const omittedHistoryCount = request.omittedHistoryMessageCount ?? 0;
  const summaryCoveredCount =
    request.conversationSummary && omittedHistoryCount >= request.conversationSummary.coveredMessageCount
      ? request.conversationSummary.coveredMessageCount
      : 0;

  if (summaryCoveredCount > 0 && request.conversationSummary) {
    items.push({
      id: "conversation-summary",
      kind: "conversation_history",
      label: "Earlier conversation summary",
      inclusion: "full",
      reason: "conversation_summary",
      resultCount: summaryCoveredCount,
      estimatedTokens: estimateTokensFromText(request.conversationSummary.text)
    });
  }

  // With a summary the omitted row shrinks to the uncovered gap and
  // disappears only at full coverage (ADR-0015) — never overstates.
  if (omittedHistoryCount - summaryCoveredCount > 0) {
    items.push({
      id: "conversation-history-omitted",
      kind: "conversation_history",
      label: "Earlier conversation",
      inclusion: "excluded",
      reason: "conversation_history_budget_omitted",
      resultCount: omittedHistoryCount - summaryCoveredCount
    });
  }

  if (provider.id === "codex-app-server") {
    items.push({
      id: "runtime-workspace",
      kind: "runtime_workspace",
      label: "Workspace runtime",
      inclusion: "available",
      reason: "codex_workspace_runtime"
    });
  } else {
    items.push({
      id: "other-workspace-files",
      kind: "workspace_scope",
      label: "Other workspace files",
      inclusion: "excluded",
      reason: "openai_api_current_request_only"
    });
  }

  return items;
}

function estimateInputTokens(request: AgentProviderRunRequest, items: AgentRunContextItem[]) {
  const promptTokens = estimateTokensFromText(request.prompt);
  const messageTokens = request.messages.reduce((total, message) => total + estimateTokensFromText(message.content), 0);
  const itemTokens = items.reduce((total, item) => total + (item.estimatedTokens ?? 0), 0);
  return promptTokens + messageTokens + itemTokens;
}

function workspaceLabel(workspaceRoot: string) {
  const resolved = path.resolve(workspaceRoot);
  return path.basename(resolved) || "Workspace";
}

function serializeContextItem(item: AgentRunContextItem | undefined): AgentRunContextItem {
  const kind = contextItemKind(item?.kind);
  const relativePath = safeRelativePath(item?.relativePath);
  const reason = contextItemReason(item?.reason);
  const label = safeContextItemLabel(kind, relativePath, reason);

  return {
    id: stringValue(item?.id),
    kind,
    label,
    ...(relativePath ? { relativePath } : {}),
    inclusion: contextInclusion(item?.inclusion),
    reason,
    ...(item?.baseHash ? { baseHash: stringValue(item.baseHash) } : {}),
    ...(typeof item?.estimatedTokens === "number" ? { estimatedTokens: nonNegativeInteger(item.estimatedTokens) } : {}),
    ...(item?.correlationId ? { correlationId: stringValue(item.correlationId) } : {}),
    ...(typeof item?.resultCount === "number" ? { resultCount: nonNegativeInteger(item.resultCount) } : {}),
    ...(typeof item?.searchedPaths === "number" ? { searchedPaths: nonNegativeInteger(item.searchedPaths) } : {}),
    ...(typeof item?.searchedFiles === "number" ? { searchedFiles: nonNegativeInteger(item.searchedFiles) } : {}),
    ...(typeof item?.truncated === "boolean" ? { truncated: item.truncated } : {}),
    ...(typeof item?.lineStart === "number" ? { lineStart: nonNegativeInteger(item.lineStart) } : {}),
    ...(typeof item?.lineEnd === "number" ? { lineEnd: nonNegativeInteger(item.lineEnd) } : {})
  };
}

function sanitizeProviderMetadata(provider: AgentRuntimeProviderMetadata | undefined): AgentRuntimeProviderMetadata {
  const capabilities = provider?.capabilities ?? {
    text: false,
    thinkingSummaries: false,
    reviewableProposals: false,
    workspaceEvents: false,
    managedAccountAuth: false,
    rateLimits: false,
    media: {
      transcription: false,
      images: false,
      realtime: false
    }
  };
  const media = capabilities.media ?? {
    transcription: false,
    images: false,
    realtime: false
  };

  return {
    id: provider?.id === "codex-app-server" ? "codex-app-server" : "openai-api",
    label: stringValue(provider?.label),
    billing: provider?.billing === "codex_account" ? "codex_account" : "openai_platform_api",
    capabilities: {
      text: Boolean(capabilities.text),
      thinkingSummaries: Boolean(capabilities.thinkingSummaries),
      reviewableProposals: Boolean(capabilities.reviewableProposals),
      workspaceEvents: Boolean(capabilities.workspaceEvents),
      managedAccountAuth: Boolean(capabilities.managedAccountAuth),
      rateLimits: Boolean(capabilities.rateLimits),
      media: {
        transcription: Boolean(media.transcription),
        images: Boolean(media.images),
        realtime: Boolean(media.realtime)
      }
    }
  };
}

function sanitizeStoredError(error: NonNullable<AgentRunContextManifest["error"]>) {
  return {
    code: error.code,
    userMessage: stringValue(error.userMessage),
    retryable: Boolean(error.retryable),
    ...(typeof error.providerStatus === "number" ? { providerStatus: error.providerStatus } : {})
  };
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function nonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function manifestStatus(status: unknown): AgentRunContextManifestStatus {
  if (status === "completed" || status === "failed" || status === "canceled") {
    return status;
  }

  return "running";
}

function contextItemKind(kind: unknown): AgentRunContextItemKind {
  if (
    kind === "proposal" ||
    kind === "workspace_scope" ||
    kind === "runtime_workspace" ||
    kind === "document_read" ||
    kind === "document_reference" ||
    kind === "conversation_history"
  ) {
    return kind;
  }

  return "current_file";
}

function contextItemReason(reason: unknown) {
  if (
    reason === "active_markdown_file" ||
    reason === "openai_api_current_request_only" ||
    reason === "codex_workspace_runtime" ||
    reason === "proposal_generated_by_run" ||
    reason === "explicit_file_mention" ||
    reason === "explicit_file_mention_unresolved" ||
    reason === "manual_context_attachment" ||
    reason === "manual_context_attachment_unresolved" ||
    reason === "model_directed_document_read" ||
    reason === "model_directed_document_search" ||
    reason === "model_directed_document_list" ||
    reason === "model_directed_document_read_failed" ||
    reason === "model_directed_document_open" ||
    reason === "model_directed_document_open_failed" ||
    reason === "conversation_reference_index" ||
    reason === "conversation_history_budget_omitted" ||
    reason === "conversation_summary" ||
    reason === "editor_selection" ||
    reason === "workspace_rules" ||
    reason === "workspace_rules_oversized"
  ) {
    return reason;
  }

  return "context_manifest_metadata";
}

function safeRelativePath(value: unknown) {
  if (typeof value !== "string" || !value.trim() || path.isAbsolute(value)) {
    return undefined;
  }

  const normalized = value.replace(/\\/g, "/");
  const segments = normalized.split("/");

  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return undefined;
  }

  return normalized;
}

function safeContextItemLabel(kind: AgentRunContextItemKind, relativePath: string | undefined, reason: string) {
  if (relativePath) {
    return path.basename(relativePath) || "Current file";
  }

  if (reason === "model_directed_document_list") {
    return "Document list";
  }

  if (reason === "model_directed_document_search") {
    return "Document search";
  }

  if (reason === "model_directed_document_read_failed") {
    return "Document read failed";
  }

  if (reason === "model_directed_document_open") {
    return "Document opened";
  }

  if (reason === "model_directed_document_open_failed") {
    return "Document open failed";
  }

  if (reason === "conversation_summary") {
    return "Earlier conversation summary";
  }

  switch (kind) {
    case "runtime_workspace":
      return "Workspace runtime";
    case "workspace_scope":
      return "Other workspace files";
    case "proposal":
      return "Generated proposal";
    case "document_reference":
      return "Unresolved document reference";
    case "conversation_history":
      return "Earlier conversation";
    case "document_read":
    case "current_file":
    default:
      return "Current file";
  }
}

function contextInclusion(inclusion: unknown): AgentRunContextInclusion {
  if (inclusion === "reference" || inclusion === "available" || inclusion === "excluded") {
    return inclusion;
  }

  return "full";
}

function agentMode(mode: unknown): AgentMode {
  if (mode === "fast" || mode === "deep") {
    return mode;
  }

  return "balanced";
}
