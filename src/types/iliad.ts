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
  /** The file watcher could not be restarted; outside changes may go unnoticed. */
  watcherDegraded?: boolean;
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
  revision: number;
  liveDisk: true;
  sessionScoped: true;
}

export type AgentChangeProposalMetadata = ExternalFilesystemProposalMetadata;

export interface AgentProposalSource {
  kind: "external_agent";
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

export interface ExternalReviewSnapshot {
  workspaceRoot: string;
  revision: number;
  proposal: AgentChangeProposal | null;
}

export type MarkdownWriteExpectation = { kind: "absent" } | { kind: "hash"; hash: string };

export type MarkdownWriteConflictReason = "pending_review" | "disk_changed" | "unsafe_path";

export type WriteMarkdownResult =
  | { status: "written"; savedAt: string }
  | { status: "conflict"; reason: MarkdownWriteConflictReason };

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
  | "incomplete"
  | "blocked"
  | "aborted"
  | "untrusted";

export type TightenResult =
  | { ok: true; rewrite: string; unchanged: boolean }
  | { ok: false; reason: TightenFailureReason };

export interface IdeaAutocompleteRequest {
  direction?: string;
  guidance?: string;
  avoid?: string[];
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
  suggestionKind?: "inline" | "sentence" | "paragraph" | "idea";
  /** The prefix ends with the visible, unaccepted suggestion being extended. */
  extend?: boolean;
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
    provider: "gemini-api" | null;
    model: string | null;
  };
  geminiKey: GeminiKeyState;
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

export interface GeminiKeyState {
  hasKey: boolean;
  /** Last four characters of the key in use, for display only. */
  last4: string | null;
}

/** Outside-change review (channel names keep their historical `agent:` prefix). */
export interface AgentApi {
  getExternalReview: (request: { workspaceSessionId: string }) => Promise<ExternalReviewSnapshot>;
  onExternalReviewChanged: (listener: (snapshot: ExternalReviewSnapshot) => void) => () => void;
  applyProposalFile: (request: {
    workspaceSessionId: string;
    proposalId: string;
    fileId: string;
  }) => Promise<ApplyAgentProposalFileResponse>;
  rejectProposalFile: (request: {
    workspaceSessionId: string;
    proposalId: string;
    fileId: string;
  }) => Promise<AgentChangeProposal>;
  rejectProposal: (request: { workspaceSessionId: string; proposalId: string }) => Promise<AgentChangeProposal>;
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
  writeMarkdown: (
    workspaceRoot: string,
    filePath: string,
    content: string,
    expected?: MarkdownWriteExpectation
  ) => Promise<WriteMarkdownResult>;
  createMarkdown: (workspaceRoot: string, directoryPath: string, requestedName: string) => Promise<FileTreeNode>;
  createFolder: (workspaceRoot: string, directoryPath: string, requestedName: string) => Promise<FileTreeNode>;
  renamePath: (workspaceRoot: string, filePath: string, requestedName: string) => Promise<FileTreeNode>;
  movePath: (workspaceRoot: string, sourcePath: string, targetDirectoryPath: string) => Promise<FileTreeNode>;
  duplicatePath: (workspaceRoot: string, filePath: string) => Promise<FileTreeNode>;
  moveToTrash: (workspaceRoot: string, filePath: string) => Promise<void>;
  searchMarkdownContent: (request: MarkdownContentSearchRequest) => Promise<MarkdownContentSearchResponse>;
  openUrl: (url: string) => Promise<void>;
  diagnostics?: {
    log: (request: {
      level?: "debug" | "info" | "warn" | "error";
      area?: "app" | "workspace" | "agent" | "provider" | "review";
      event: string;
      details?: Record<string, string | number | boolean | null>;
    }) => Promise<void>;
  };
  updates: UpdatesApi;
  openExternalFile: (workspaceRoot: string, filePath: string) => Promise<string>;
  revealInFinder: (workspaceRoot: string, filePath: string) => Promise<void>;
  saveImageAsset: (request: SaveImageAssetRequest) => Promise<SavedImageAsset>;
  referenceImageAsset: (request: ReferenceImageAssetRequest) => Promise<SavedImageAsset>;
  referenceImageAssetByRelativePath: (request: ReferenceImageAssetByRelativePathRequest) => Promise<SavedImageAsset>;
  pathForFile?: (file: File) => string;
  selectionComments?: SelectionCommentsApi;
  writingCorrectorMemory?: WritingCorrectorMemoryApi;
  tightenSelection: (request: TightenSelectionRequest) => Promise<TightenResult>;
  cancelTighten: (requestId: string) => void;
  autocompleteIdea: (request: IdeaAutocompleteRequest) => Promise<IdeaAutocompleteResult>;
  onAutocompletePartial: (listener: (event: { requestId: string; insert: string }) => void) => () => void;
  cancelAutocompleteIdea: (requestId: string) => void;
  getWritingAssistStatus: () => Promise<WritingAssistStatus>;
  getGeminiKeyState: () => Promise<GeminiKeyState>;
  setGeminiApiKey: (key: string | null) => Promise<GeminiKeyState>;
  assetUrl: (absolutePath: string) => string;
  agent: AgentApi;
}

declare global {
  interface Window {
    iliad: IliadApi;
  }
}
