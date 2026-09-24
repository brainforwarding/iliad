// Review records for outside changes. Type names keep the historical
// "Agent" prefix to limit churn; there is no internal agent.

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
    }
  | {
      kind: "delete_file";
      relativePath: string;
      baseHash: string;
      baseContent: string;
      unifiedDiff: string;
      summary: string;
    };

export interface ApplyAgentProposalFileRequest {
  workspaceSessionId: string;
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
    }
  | {
      kind: "delete_file";
      proposal: AgentChangeProposal;
      fileId: string;
      status: AgentProposalFileStatus;
    };

export interface RejectAgentProposalFileRequest {
  workspaceSessionId: string;
  proposalId: string;
  fileId: string;
}

export interface RejectAgentProposalRequest {
  workspaceSessionId: string;
  proposalId: string;
}
