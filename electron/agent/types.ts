import type { AgentModelId } from "./agentModels.js";
import type { AgentRuntimeProviderMetadata } from "./runtime/provider.js";

export type AgentMode = "fast" | "balanced" | "deep";
export type AgentRunProfile = "desktop" | "remote_read_only";

export interface AgentSettingsSnapshot {
  hasOpenAiApiKey: boolean;
  model: AgentModelId;
  mode: AgentMode;
  runtimeProvider: AgentRuntimeProviderMetadata;
}

export interface AgentSettingsUpdate {
  openAiApiKey?: string;
  model?: string;
  mode?: AgentMode;
}

export interface AgentRunRequest {
  runId: string;
  workspaceRoot: string;
  runProfile?: AgentRunProfile;
  activeFile: {
    path: string;
    relativePath: string;
    content: string;
    baseHash: string;
  } | null;
  messages: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
  prompt: string;
  mode: AgentMode;
  language: "en" | "es";
  contextAttachments?: AgentContextAttachment[];
  /**
   * Identifier-only index of documents referenced earlier in the conversation
   * (ADR-0014). Sanitized again in the main process; content is never re-sent.
   */
  previouslyReferencedDocuments?: string[];
  /**
   * Live editor selection at send time, as offsets into activeFile.content
   * (ADR-0017). Main re-validates bounds and slices from the snapshot itself.
   */
  editorSelection?: { from: number; to: number };
}

export type AgentChatThreadTitleSource = "fallback" | "ai";

export interface AgentChatHistoryEntry {
  id: string;
  kind: "user" | "assistant" | "error" | "status";
  text: string;
  createdAt: string;
  source?: "desktop" | "telegram";
}

export interface AgentChatThread {
  id: string;
  workspaceRoot: string;
  title: string;
  titleSource: AgentChatThreadTitleSource;
  createdAt: string;
  updatedAt: string;
  entries: AgentChatHistoryEntry[];
}

export interface AgentChatThreadSummary {
  id: string;
  title: string;
  titleSource: AgentChatThreadTitleSource;
  updatedAt: string;
  messageCount: number;
}

export interface AgentContextAttachment {
  relativePath: string;
  source: "manual_attachment";
}

export type AgentContextDocumentSource = "explicit_file_mention" | "manual_attachment";
export type AgentContextReferenceReason =
  | "not_found"
  | "unsafe"
  | "not_markdown"
  | "oversized"
  | "budget_exceeded"
  | "ambiguous"
  | "duplicate"
  | "unknown";

export interface AgentContextDocument {
  correlationId: string;
  relativePath: string;
  content: string;
  baseHash: string;
  estimatedTokens: number;
  source: AgentContextDocumentSource;
}

export interface AgentContextReference {
  correlationId: string;
  safeDisplayPath?: string;
  reason: AgentContextReferenceReason;
  source?: AgentContextDocumentSource;
}

export interface AgentMarkdownContextDocumentSummary {
  relativePath: string;
  name: string;
  sizeBytes: number;
  estimatedTokens: number;
}

export interface AgentMarkdownContextDocumentListResponse {
  files: AgentMarkdownContextDocumentSummary[];
  truncated: boolean;
}

export type NormalizeContextDropResponse =
  | { ok: true; relativePath: string }
  | { ok: false; reason: "outside_workspace" | "not_markdown" | "unsafe" | "not_found" };

export interface AgentPreparedRunRequest extends AgentRunRequest {
  contextDocuments: AgentContextDocument[];
  unresolvedContextReferences: AgentContextReference[];
  sanitizedPrompt: string;
  omittedHistoryMessageCount: number;
  /** Main-originated workspace rules (AGENTS.md, ADR-0018); never renderer input. */
  workspaceRules?: Omit<AgentContextDocument, "source">;
  workspaceRulesExcluded?: boolean;
  /** Main-originated compaction summary from the cache lookup (ADR-0015); never renderer input. */
  conversationSummary?: { text: string; coveredMessageCount: number };
}

export type AgentProviderRunRequest = AgentRunRequest &
  Partial<
    Pick<
      AgentPreparedRunRequest,
      | "contextDocuments"
      | "unresolvedContextReferences"
      | "sanitizedPrompt"
      | "omittedHistoryMessageCount"
      | "workspaceRules"
      | "workspaceRulesExcluded"
      | "conversationSummary"
    >
  >;

export interface AgentPatchProposal {
  id: string;
  runId: string;
  summary: string;
  path: string;
  relativePath: string;
  baseHash: string;
  replacement: string;
  unifiedDiff: string;
}

export interface AgentCreateDocumentProposal {
  id: string;
  runId: string;
  summary: string;
  relativePath: string;
  content: string;
}

export type AgentProposalStatus = "pending" | "partially_applied" | "applied" | "rejected" | "stale" | "failed";

export type AgentProposalFileStatus =
  | "pending"
  | "partially_applied"
  | "applied"
  | "rejected"
  | "stale"
  | "failed";

export type AgentReviewHunkStatus = "pending" | "accepted" | "rejected" | "stale";

export interface AgentReviewHunk {
  id: string;
  status: AgentReviewHunkStatus;
  anchorLine: number;
  oldStartLine: number;
  oldLines: string[];
  newLines: string[];
  oldLineBreaks?: string[];
  newLineBreaks?: string[];
}

export interface AgentChangeProposal {
  id: string;
  runId: string;
  responseId?: string;
  workspaceRoot: string;
  title: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
  model: string;
  source: AgentProposalSource;
  status: AgentProposalStatus;
  files: AgentProposalFileChange[];
}

export interface AgentProposalSource {
  kind: "openai_response" | "legacy_marker_adapter" | "tool_call" | "subagent" | "codex_app_server";
  agentName?: string;
  parentRunId?: string;
}

export type AgentProposalFileChange = AgentEditFileProposal | AgentCreateFileProposal;

export interface AgentEditFileProposal {
  id: string;
  kind: "edit_file";
  status: AgentProposalFileStatus;
  relativePath: string;
  baseHash: string;
  baseContent: string;
  replacement: string;
  unifiedDiff: string;
  hunks?: AgentReviewHunk[];
  error?: string;
}

export interface AgentCreateFileProposal {
  id: string;
  kind: "create_file";
  status: AgentProposalFileStatus;
  relativePath: string;
  content: string;
  unifiedDiff: string;
  error?: string;
}

export type AgentDraftFileChange =
  | {
      kind: "edit_file";
      relativePath: string;
      baseHash: string;
      baseContent: string;
      replacement: string;
      unifiedDiff: string;
      summary: string;
    }
  | {
      kind: "create_file";
      relativePath: string;
      content: string;
      unifiedDiff: string;
      summary: string;
    };

export interface AgentProviderResponse {
  runId: string;
  responseId?: string;
  text: string;
  draftFileChanges: AgentDraftFileChange[];
  proposalSource?: AgentProposalSource;
}

export type AgentRunPhase =
  | "reading_context"
  | "asking_model"
  | "reviewing_changes"
  | "waiting_for_review"
  | "completed"
  | "failed"
  | "canceled";

export type AgentRunPhaseEvent = {
  type: "run_phase";
  runId: string;
  phase: AgentRunPhase;
  source: "agent_service";
  proposalFileCount?: number;
  errorCode?: AgentErrorCode;
};

export type AgentLegacyStatusRunEvent = { type: "status"; runId: string; message: string };

export type AgentThinkingRunEvent =
  | {
      type: "thinking_delta";
      runId: string;
      itemId: string;
      summaryIndex: number;
      delta: string;
    }
  | {
      type: "thinking_done";
      runId: string;
      itemId: string;
      summaryIndex: number;
      text: string;
    };

export type AgentActivityKind =
  | "document_list"
  | "document_search"
  | "document_read"
  | "document_read_failed"
  | "document_open";
export type AgentActivityStatus = "started" | "completed" | "failed";

export type AgentActivityRunEvent = {
  type: "activity";
  runId: string;
  activityId: string;
  sequence: number;
  kind: AgentActivityKind;
  status: AgentActivityStatus;
  title: string;
  query?: string;
  relativePath?: string;
  resultCount?: number;
  searchedPaths?: number;
  searchedFiles?: number;
  truncated?: boolean;
  errorCode?: string;
};

export type AgentTextRunEvent = {
  type: "text_delta";
  runId: string;
  /** Streamed-payload counter; a change tells the renderer to replace, not append. */
  generation: number;
  delta: string;
};

export type AgentOpenDocumentRunEvent = {
  type: "open_document";
  runId: string;
  relativePath: string;
};

export type AgentProviderRunEvent =
  | AgentThinkingRunEvent
  | AgentActivityRunEvent
  | AgentTextRunEvent
  | AgentOpenDocumentRunEvent;

export type AgentRunEvent = AgentRunPhaseEvent | AgentLegacyStatusRunEvent | AgentProviderRunEvent;

export type AgentRunEventListener = (event: AgentRunEvent) => void;
export type AgentThinkingRunEventListener = (event: AgentProviderRunEvent) => void;

export type AgentErrorCode =
  | "missing_api_key"
  | "invalid_api_key"
  | "rate_limited"
  | "provider_unavailable"
  | "network_unreachable"
  | "dns_failure"
  | "request_timeout"
  | "request_canceled"
  | "model_not_found"
  | "malformed_provider_response"
  | "unknown";

export interface AgentError {
  code: AgentErrorCode;
  userMessage: string;
  detail?: string;
  providerStatus?: number;
  retryable: boolean;
}

export type AgentRunContextManifestStatus = "running" | "completed" | "failed" | "canceled";
export type AgentRunContextItemKind =
  | "current_file"
  | "proposal"
  | "workspace_scope"
  | "runtime_workspace"
  | "document_read"
  | "document_reference"
  | "conversation_history";
export type AgentRunContextInclusion = "full" | "reference" | "available" | "excluded";

export interface AgentRunContextItem {
  id: string;
  kind: AgentRunContextItemKind;
  label: string;
  relativePath?: string;
  inclusion: AgentRunContextInclusion;
  reason: string;
  baseHash?: string;
  estimatedTokens?: number;
  correlationId?: string;
  resultCount?: number;
  searchedPaths?: number;
  searchedFiles?: number;
  truncated?: boolean;
  /** 1-based line range for editor_selection receipt rows. */
  lineStart?: number;
  lineEnd?: number;
}

export interface AgentRunContextManifest {
  id: string;
  runId: string;
  createdAt: string;
  updatedAt: string;
  status: AgentRunContextManifestStatus;
  workspaceLabel: string;
  workspaceId: string;
  workspaceRootPersisted: false;
  provider: AgentRuntimeProviderMetadata;
  model: AgentModelId | string;
  mode: AgentMode;
  language: "en" | "es";
  policy: "auto";
  items: AgentRunContextItem[];
  estimatedInputTokens: number;
  responseId?: string;
  proposalIds: string[];
  error?: {
    code: AgentErrorCode;
    userMessage: string;
    retryable: boolean;
    providerStatus?: number;
  };
}

export interface AgentRunResponse {
  runId: string;
  responseId?: string;
  text: string;
  proposalIds: string[];
  proposals: AgentChangeProposal[];
  patch: AgentPatchProposal | null;
  newDocument: AgentCreateDocumentProposal | null;
  contextManifest?: AgentRunContextManifest;
  error?: AgentError;
}

export interface AgentTranscribeAudioRequest {
  requestId: string;
  audio: ArrayBuffer | Uint8Array;
  mimeType: string;
  language?: string;
}

export type AgentTranscribeAudioResponse =
  | {
      requestId: string;
      text: string;
      error?: undefined;
    }
  | {
      requestId: string;
      text: "";
      error: AgentError;
    };

export interface CodexAccount {
  type: "chatgpt" | "apiKey" | "amazonBedrock";
  email?: string;
  planType?: string;
}

export interface CodexAccountRateLimitBucket {
  usedPercent?: number | null;
  windowDurationMins?: number | null;
  resetsAtUnixSeconds?: number | null;
  resetsAtIso?: string | null;
}

export interface CodexAccountRateLimitSummary {
  limitId?: string | null;
  limitName?: string | null;
  planType?: string | null;
  primary?: CodexAccountRateLimitBucket;
  secondary?: CodexAccountRateLimitBucket;
  rateLimitReachedType?: string | null;
  credits?: {
    hasCredits?: boolean | null;
    unlimited?: boolean | null;
    balance?: string | null;
  };
}

export interface CodexAccountConnectionError {
  code:
    | "app_server_unavailable"
    | "protocol_error"
    | "request_timeout"
    | "unsupported_method"
    | "untrusted_ipc_sender"
    | "unknown";
  message: string;
  detail?: string;
}

export interface CodexAccountStatusResponse {
  available: boolean;
  connected: boolean;
  requiresOpenaiAuth: boolean;
  pendingLogin: boolean;
  account?: CodexAccount;
  rateLimits?: CodexAccountRateLimitSummary;
  error?: CodexAccountConnectionError;
}

export interface CodexDeviceLoginResponse extends CodexAccountStatusResponse {
  login?: {
    verificationUrl: string;
    userCode: string;
  };
}

export type CodexOpenDeviceLoginResponse =
  | {
      ok: true;
    }
  | {
      ok: false;
      error: CodexAccountConnectionError;
    };

export interface ApplyAgentPatchRequest {
  workspaceRoot: string;
  patch: AgentPatchProposal;
}

export interface ApplyAgentPatchResponse {
  savedAt: string;
  content: string;
}

export interface ApplyAgentCreateDocumentRequest {
  workspaceRoot: string;
  document: AgentCreateDocumentProposal;
}

export interface ApplyAgentCreateDocumentResponse {
  savedAt: string;
  file: {
    name: string;
    path: string;
    relativePath: string;
    kind: "markdown";
  };
  content: string;
}

export interface ApplyAgentProposalFileRequest {
  workspaceRoot: string;
  proposalId: string;
  fileId: string;
}

export type ApplyAgentProposalFileResponse =
  | {
      kind: "edit_file";
      proposal: AgentChangeProposal;
      fileId: string;
      status: AgentProposalFileStatus;
      content?: string;
    }
  | {
      kind: "create_file";
      proposal: AgentChangeProposal;
      fileId: string;
      status: AgentProposalFileStatus;
      file?: {
        name: string;
        path: string;
        relativePath: string;
        kind: "markdown";
      };
      content?: string;
    };

export interface RejectAgentProposalFileRequest {
  workspaceRoot: string;
  proposalId: string;
  fileId: string;
}

export interface RejectAgentProposalRequest {
  workspaceRoot: string;
  proposalId: string;
}

export interface ResolveAgentProposalHunkRequest {
  workspaceRoot: string;
  proposalId: string;
  fileId: string;
  hunkId: string;
  decision: "accept" | "reject";
}

export interface ResolveAgentProposalHunkResponse {
  proposal: AgentChangeProposal;
  fileId: string;
  hunkId: string;
  status: AgentReviewHunkStatus;
  content?: string;
}
