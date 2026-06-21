export type FileKind = "directory" | "markdown" | "external";

export interface FileTreeNode {
  name: string;
  path: string;
  relativePath: string;
  kind: FileKind;
  children?: FileTreeNode[];
}

export interface WorkspaceInfo {
  name: string;
  path: string;
  sessionId?: string;
}

export type ReadDirectoryResponse =
  | { status: "ok"; workspace: WorkspaceInfo; tree: FileTreeNode[] }
  | { status: "missing" };

export interface WorkspaceChangeEvent {
  workspaceRoot: string;
  treeChanged?: boolean;
  markdownChanged?: boolean;
  changedMarkdownPaths?: string[];
}

export interface SaveImageAssetRequest {
  workspaceRoot: string;
  documentPath: string;
  dataUrl: string;
  originalName?: string;
}

export interface SavedImageAsset {
  filePath: string;
  relativePath: string;
  markdown: string;
}

export interface ReferenceImageAssetRequest {
  workspaceRoot: string;
  documentPath: string;
  imagePath: string;
}

export interface ReferenceImageAssetByRelativePathRequest {
  workspaceSessionId: string;
  documentPath: string;
  imageRelativePath: string;
}

export interface MarkdownContentSearchRequest {
  workspaceRoot: string;
  query: string;
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
  maxReturnedFiles?: number;
  maxReturnedMatches?: number;
  maxMatchesPerFile?: number;
  maxFileBytes?: number;
  maxScannedMarkdownFiles?: number;
  maxVisitedEntries?: number;
  maxDirectoryDepth?: number;
  maxQueryLength?: number;
}

export type MarkdownContentSearchTruncationReason =
  | "files"
  | "matches"
  | "scanned_files"
  | "visited_entries"
  | "directory_depth"
  | "query_length";

export interface MarkdownContentSearchRange {
  startColumn: number;
  endColumn: number;
}

export interface MarkdownContentSearchMatch {
  id: string;
  lineNumber: number;
  lineText: string;
  matchedText: string;
  startOffset: number;
  endOffset: number;
  startColumn: number;
  endColumn: number;
  ranges: MarkdownContentSearchRange[];
}

export interface MarkdownContentSearchFileResult {
  filePath: string;
  relativePath: string;
  name: string;
  returnedMatchCount: number;
  matches: MarkdownContentSearchMatch[];
}

export interface MarkdownContentSearchResponse {
  status: "ok" | "invalid_regex";
  query: string;
  files: MarkdownContentSearchFileResult[];
  returnedFiles: number;
  returnedMatches: number;
  scannedMarkdownFiles: number;
  visitedEntries: number;
  skippedOversizedFiles: number;
  skippedUnreadableFiles: number;
  truncated: boolean;
  truncatedReasons: MarkdownContentSearchTruncationReason[];
  invalidRegexMessage?: string;
}

export type AgentMode = "fast" | "balanced" | "deep";
export type AgentRunProfile = "desktop" | "remote_read_only";
export type AgentModelId =
  | "gpt-5.5"
  | "gpt-5.4"
  | "gpt-5.4-mini";

export interface AgentRuntimeCapabilities {
  text: boolean;
  thinkingSummaries: boolean;
  reviewableProposals: boolean;
  workspaceEvents: boolean;
  managedAccountAuth: boolean;
  rateLimits: boolean;
  media: {
    transcription: boolean;
    images: boolean;
    realtime: boolean;
  };
}

export interface AgentRuntimeProviderMetadata {
  id: "openai-api" | "codex-app-server";
  label: string;
  billing: "openai_platform_api" | "codex_account";
  capabilities: AgentRuntimeCapabilities;
}

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

export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
}

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
  metadata?: AgentChangeProposalMetadata;
  status: AgentProposalStatus;
  files: AgentProposalFileChange[];
}

export interface ExternalFilesystemProposalMetadata {
  kind: "external_filesystem";
  baselineId: string;
  snapshotId: string;
  liveDisk: true;
  sessionScoped: true;
}

export type AgentChangeProposalMetadata = ExternalFilesystemProposalMetadata;

export interface AgentProposalSource {
  kind: "openai_response" | "legacy_marker_adapter" | "tool_call" | "subagent" | "codex_app_server" | "external_agent";
  agentName?: string;
  parentRunId?: string;
}

export type AgentProposalFileChange = AgentEditFileProposal | AgentCreateFileProposal | AgentDeleteFileProposal;

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
  baselineState?: "present" | "absent";
  baselineContentHash?: string;
  reviewedState?: "present" | "absent";
  reviewedContentHash?: string;
}

export interface AgentCreateFileProposal {
  id: string;
  kind: "create_file";
  status: AgentProposalFileStatus;
  relativePath: string;
  content: string;
  unifiedDiff: string;
  error?: string;
  baselineState?: "present" | "absent";
  baselineContentHash?: string;
  reviewedState?: "present" | "absent";
  reviewedContentHash?: string;
}

export interface AgentDeleteFileProposal {
  id: string;
  kind: "delete_file";
  status: AgentProposalFileStatus;
  relativePath: string;
  baseHash: string;
  baseContent: string;
  unifiedDiff: string;
  error?: string;
  baselineState?: "present" | "absent";
  baselineContentHash?: string;
  reviewedState?: "present" | "absent";
  reviewedContentHash?: string;
}

export interface ExternalAgentCaptureStartResponse {
  captureId: string;
  workspaceRoot: string;
  startedAt: string;
  markdownFileCount: number;
  resumed?: boolean;
}

export type ExternalAgentCaptureFinishResponse =
  | {
      status: "proposal";
      captureId: string;
      proposal: AgentChangeProposal;
      restoredRelativePaths: string[];
      restoredCreateRelativePaths: string[];
      unsupportedNotes: string[];
    }
  | {
      status: "empty";
      captureId: string;
      restoredRelativePaths: string[];
      restoredCreateRelativePaths: string[];
      unsupportedNotes: string[];
    }
  | {
      status: "unsupported_restored";
      captureId: string;
      restoredRelativePaths: string[];
      restoredCreateRelativePaths: string[];
      unsupportedNotes: string[];
    }
  | {
      status: "git_baseline_changed";
      captureId: string;
      unsupportedNotes: string[];
    }
  | {
      status: "unsafe";
      captureId: string;
      message: string;
      unsupportedNotes: string[];
    };

export interface ExternalAgentCaptureCancelResponse {
  status: "canceled";
  captureId: string;
  restoredRelativePaths: string[];
  restoredCreateRelativePaths: string[];
  unsupportedNotes: string[];
}

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
  errorCode?: string;
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
  messages: AgentMessage[];
  prompt: string;
  mode: AgentMode;
  language: "en" | "es";
  contextAttachments?: AgentContextAttachment[];
  /**
   * Identifier-only index of documents referenced earlier in the conversation
   * (ADR-0014), derived in-session from prior run manifests. Sanitized again in
   * the main process; content is never re-sent.
   */
  previouslyReferencedDocuments?: string[];
  /**
   * Live editor selection at send time, as offsets into activeFile.content
   * (ADR-0017). Main re-validates bounds and slices from the snapshot itself.
   */
  editorSelection?: { from: number; to: number };
}

export interface TightenSelectionRequest {
  /** Monotonic, renderer-owned; lets a late resolve be discarded as stale (ADR-0020). */
  requestId: string;
  /** `edit` uses a bounded custom instruction; omitted means fixed Tighten behavior. */
  mode?: "tighten" | "edit";
  text: string;
  /** Relative focus span within `text`; main validates and falls back to the whole text. */
  selection?: { from: number; to: number };
  instruction?: string;
  language: "en" | "es";
}

export type TightenFailureReason =
  | "no_key"
  | "invalid_api_key"
  | "rate_limited"
  | "too_long"
  | "empty"
  | "timeout"
  | "provider"
  | "aborted"
  | "untrusted";

export type TightenResult =
  | { ok: true; rewrite: string; unchanged: boolean }
  | { ok: false; reason: TightenFailureReason };

export interface IdeaAutocompleteRequest {
  requestId: string;
  workspaceSessionId: string;
  documentRelativePath: string;
  language: "en" | "es";
  cursor: number;
  prefix: string;
  suffix: string;
  headingPath: string[];
  documentTitle: string;
  nearbyHeadings: string[];
  trigger?: "automatic" | "manual";
  suggestionKind?: "inline" | "paragraph";
  autocompleteApiFallbackEnabled: boolean;
}

export type IdeaAutocompleteFailureReason =
  | "disabled"
  | "no_key"
  | "invalid_api_key"
  | "rate_limited"
  | "too_long"
  | "empty"
  | "timeout"
  | "provider"
  | "no_suggestion"
  | "aborted"
  | "untrusted";

export type IdeaAutocompleteResult =
  | { ok: true; insert: string }
  | { ok: false; reason: IdeaAutocompleteFailureReason };

export interface WritingAssistStatus {
  corrector: {
    available: boolean;
    provider: "local" | null;
  };
  autocomplete: {
    available: boolean;
    provider: "codex-app-server" | "openai-api" | null;
    apiFallbackAvailable: boolean;
    apiFallbackEnabled: boolean;
    model: AgentModelId | string | null;
  };
}

export type SelectionCommentStatus = "pending" | "sent" | "discarded";

/**
 * A user comment anchored to a text selection in a Markdown document.
 * Positions are live CodeMirror offsets while the document is open; the
 * quote/occurrence/prefix triple re-anchors the comment after restart or any
 * full-content replacement. Long selections are anchored by prefix/occurrence
 * because the serialized quote is truncated to ~80 chars.
 */
export interface SelectionComment {
  id: string;
  workspacePath: string;
  documentRelativePath: string;
  from: number;
  to: number;
  quote: string;
  occurrence: number;
  prefix: string;
  comment: string;
  createdAt: string;
  status: SelectionCommentStatus;
}

export interface SelectionCommentsApi {
  list: (workspaceSessionId: string) => Promise<SelectionComment[]>;
  save: (
    workspaceSessionId: string,
    documentRelativePath: string,
    comments: SelectionComment[]
  ) => Promise<SelectionComment[]>;
}

export interface WritingCorrectorMemorySnapshot {
  ignoredIssueFingerprints: string[];
  customWords: string[];
}

export interface WritingCorrectorMemoryApi {
  get: (request: {
    workspaceSessionId: string;
    documentRelativePath: string;
    language: "en" | "es";
  }) => Promise<WritingCorrectorMemorySnapshot>;
  ignoreIssue: (request: {
    workspaceSessionId: string;
    documentRelativePath: string;
    language: "en" | "es";
    fingerprint: string;
  }) => Promise<WritingCorrectorMemorySnapshot>;
  addDictionaryWord: (request: { language: "en" | "es"; word: string }) => Promise<{ customWords: string[] }>;
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

export interface CodexCliProbeRequest {
  executablePath?: string;
  timeoutMs?: number;
}

export type CodexCliProbeResponse =
  | {
      ok: true;
      executablePath: string;
      version: string;
      rawVersion: string;
    }
  | {
      ok: false;
      executablePath: string;
      error: {
        code: "invalid_path" | "not_found" | "not_codex_executable" | "timeout" | "failed" | "invalid_output";
        message: string;
        detail?: string;
        exitCode?: number;
      };
    };

export interface RemotePairedTelegramChat {
  chatId: string;
  username?: string;
  displayName?: string;
  pairedAt: string;
}

export interface TelegramRemotePairingStartResponse {
  token: string;
  pairingSessionId: string;
  expiresAt: string;
  pairingUrl?: string;
}

export interface TelegramRemoteErrorSummary {
  message: string;
  at: string;
}

export interface TelegramRemoteSettings {
  enabled: boolean;
  relayDeviceId: string;
  pairedChat: RemotePairedTelegramChat | null;
  lastConnectedAt?: string;
  lastError?: TelegramRemoteErrorSummary | null;
  boundWorkspaceRoot?: string;
  activeThreadId?: string;
  activeThreadWorkspaceRoot?: string;
  updatedAt: string;
}

export interface TelegramRemoteSettingsUpdateRequest {
  enabled?: boolean;
  activeThreadId?: string;
  workspaceSessionId?: string;
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

export type AgentActivityKind =
  | "document_list"
  | "document_search"
  | "document_read"
  | "document_read_failed"
  | "document_open";
export type AgentActivityStatus = "started" | "completed" | "failed";

export interface AgentActivityRunEvent {
  type: "activity";
  runId: string;
  activityId: string;
  sequence: number;
  kind: AgentActivityKind;
  status: AgentActivityStatus;
  title: string;
  relativePath?: string;
  query?: string;
  resultCount?: number;
  searchedPaths?: number;
  searchedFiles?: number;
  truncated?: boolean;
}

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

export type AgentRunEvent =
  | AgentRunPhaseEvent
  | AgentLegacyStatusRunEvent
  | AgentThinkingRunEvent
  | AgentActivityRunEvent
  | AgentTextRunEvent
  | AgentOpenDocumentRunEvent;

export interface ApplyAgentPatchResponse {
  savedAt: string;
  content: string;
}

export interface ApplyAgentCreateDocumentResponse {
  savedAt: string;
  file: FileTreeNode;
  content: string;
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
      file?: FileTreeNode;
      content?: string;
    }
  | {
      kind: "delete_file";
      proposal: AgentChangeProposal;
      fileId: string;
      status: AgentProposalFileStatus;
    };

export interface ResolveAgentProposalHunkResponse {
  proposal: AgentChangeProposal;
  fileId: string;
  hunkId: string;
  status: AgentReviewHunkStatus;
  content?: string;
}

export interface AgentApi {
  getSettings: () => Promise<AgentSettingsSnapshot>;
  updateSettings: (update: AgentSettingsUpdate) => Promise<AgentSettingsSnapshot>;
  probeCodexCli: (request?: CodexCliProbeRequest) => Promise<CodexCliProbeResponse>;
  codexStatus: () => Promise<CodexAccountStatusResponse>;
  startCodexDeviceLogin: () => Promise<CodexDeviceLoginResponse>;
  cancelCodexLogin: () => Promise<CodexAccountStatusResponse>;
  logoutCodex: () => Promise<CodexAccountStatusResponse>;
  openCodexDeviceLogin: () => Promise<CodexOpenDeviceLoginResponse>;
  startRun: (request: AgentRunRequest) => Promise<AgentRunResponse>;
  transcribeAudio: (request: AgentTranscribeAudioRequest) => Promise<AgentTranscribeAudioResponse>;
  onRunEvent: (listener: (event: AgentRunEvent) => void) => () => void;
  cancelRun: (runId: string) => Promise<void>;
  applyPatch: (request: {
    workspaceRoot: string;
    patch: AgentPatchProposal;
  }) => Promise<ApplyAgentPatchResponse>;
  applyNewDocument: (request: {
    workspaceRoot: string;
    document: AgentCreateDocumentProposal;
  }) => Promise<ApplyAgentCreateDocumentResponse>;
  listProposals: (workspaceRoot: string) => Promise<AgentChangeProposal[]>;
  startExternalCapture: (request: {
    workspaceSessionId: string;
    agentName?: string;
  }) => Promise<ExternalAgentCaptureStartResponse>;
  finishExternalCapture: (request: {
    workspaceSessionId: string;
    captureId: string;
  }) => Promise<ExternalAgentCaptureFinishResponse>;
  cancelExternalCapture: (request: {
    workspaceSessionId: string;
    captureId: string;
  }) => Promise<ExternalAgentCaptureCancelResponse>;
  applyProposalFile: (request: {
    workspaceRoot: string;
    proposalId: string;
    fileId: string;
  }) => Promise<ApplyAgentProposalFileResponse>;
  rejectProposalFile: (request: {
    workspaceRoot: string;
    proposalId: string;
    fileId: string;
  }) => Promise<AgentChangeProposal>;
  rejectProposal: (request: { workspaceRoot: string; proposalId: string }) => Promise<AgentChangeProposal>;
  resolveProposalHunk: (request: {
    workspaceRoot: string;
    proposalId: string;
    fileId: string;
    hunkId: string;
    decision: "accept" | "reject";
  }) => Promise<ResolveAgentProposalHunkResponse>;
  listChatThreads: (workspaceRoot: string) => Promise<AgentChatThreadSummary[]>;
  getChatThread: (request: { workspaceRoot: string; threadId: string }) => Promise<AgentChatThread | null>;
  saveChatThread: (request: {
    workspaceRoot: string;
    thread: Omit<AgentChatThread, "workspaceRoot"> & { workspaceRoot?: string };
  }) => Promise<AgentChatThread>;
  clearChatHistory: (workspaceRoot: string) => Promise<void>;
  generateChatThreadTitle: (request: {
    workspaceRoot: string;
    threadId: string;
    language: "en" | "es";
  }) => Promise<AgentChatThread | null>;
}

export interface TelegramRemoteApi {
  getSettings: () => Promise<TelegramRemoteSettings>;
  startPairing: () => Promise<TelegramRemotePairingStartResponse>;
  updateSettings: (update: TelegramRemoteSettingsUpdateRequest) => Promise<TelegramRemoteSettings>;
  revokeSettings: () => Promise<TelegramRemoteSettings>;
}

export type UpdateCheckResult =
  | {
      status: "available";
      currentVersion: string;
      latestVersion: string;
      releaseName: string;
      releaseDate: string;
      releaseUrl: string;
      downloadUrl?: string;
      notes?: string;
    }
  | {
      status: "current";
      currentVersion: string;
      latestVersion: string;
      releaseUrl?: string;
    }
  | {
      status: "error";
      currentVersion: string;
      message: string;
      detail?: string;
    };

export interface UpdatesApi {
  check: () => Promise<UpdateCheckResult>;
  consumePendingCheckRequest: () => Promise<boolean>;
  onCheckRequested: (listener: () => void) => () => void;
}

export interface IliadApi {
  getLaunchWorkspace: () => Promise<WorkspaceInfo | null>;
  openWorkspaceDialog: (language?: "en" | "es") => Promise<WorkspaceInfo | null>;
  readDirectory: (workspaceRoot: string) => Promise<ReadDirectoryResponse>;
  watchWorkspace?: (workspaceRoot: string, listener: (event: WorkspaceChangeEvent) => void) => () => void;
  readMarkdown: (workspaceRoot: string, filePath: string) => Promise<string>;
  writeMarkdown: (workspaceRoot: string, filePath: string, content: string) => Promise<{ savedAt: string }>;
  createMarkdown: (workspaceRoot: string, directoryPath: string, requestedName: string) => Promise<FileTreeNode>;
  createFolder: (workspaceRoot: string, directoryPath: string, requestedName: string) => Promise<FileTreeNode>;
  renamePath: (workspaceRoot: string, filePath: string, requestedName: string) => Promise<FileTreeNode>;
  movePath: (workspaceRoot: string, sourcePath: string, targetDirectoryPath: string) => Promise<FileTreeNode>;
  duplicatePath: (workspaceRoot: string, filePath: string) => Promise<FileTreeNode>;
  moveToTrash: (workspaceRoot: string, filePath: string) => Promise<void>;
  searchMarkdownContent: (request: MarkdownContentSearchRequest) => Promise<MarkdownContentSearchResponse>;
  openUrl: (url: string) => Promise<void>;
  updates: UpdatesApi;
  openExternalFile: (workspaceRoot: string, filePath: string) => Promise<string>;
  revealInFinder: (workspaceRoot: string, filePath: string) => Promise<void>;
  saveImageAsset: (request: SaveImageAssetRequest) => Promise<SavedImageAsset>;
  referenceImageAsset: (request: ReferenceImageAssetRequest) => Promise<SavedImageAsset>;
  referenceImageAssetByRelativePath: (request: ReferenceImageAssetByRelativePathRequest) => Promise<SavedImageAsset>;
  pathForFile?: (file: File) => string;
  listMarkdownContextDocuments?: (workspaceSessionId: string) => Promise<AgentMarkdownContextDocumentListResponse>;
  normalizeContextDrop?: (workspaceSessionId: string, absolutePath: string) => Promise<NormalizeContextDropResponse>;
  selectionComments?: SelectionCommentsApi;
  writingCorrectorMemory?: WritingCorrectorMemoryApi;
  tightenSelection: (request: TightenSelectionRequest) => Promise<TightenResult>;
  cancelTighten: (requestId: string) => void;
  autocompleteIdea: (request: IdeaAutocompleteRequest) => Promise<IdeaAutocompleteResult>;
  cancelAutocompleteIdea: (requestId: string) => void;
  getWritingAssistStatus: (request: { autocompleteApiFallbackEnabled: boolean }) => Promise<WritingAssistStatus>;
  assetUrl: (absolutePath: string) => string;
  agent: AgentApi;
  remote: TelegramRemoteApi;
}

declare global {
  interface Window {
    iliad: IliadApi;
  }
}
