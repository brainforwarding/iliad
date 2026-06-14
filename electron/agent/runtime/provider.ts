import type {
  AgentRunContextItem,
  AgentProviderResponse,
  AgentThinkingRunEventListener,
  AgentProviderRunRequest
} from "../types.js";
import type { AgentDocumentTools, AgentDocumentToolName } from "../documentTools.js";

export type AgentRuntimeProviderId = "openai-api" | "codex-app-server";

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
  id: AgentRuntimeProviderId;
  label: string;
  billing: "openai_platform_api" | "codex_account";
  capabilities: AgentRuntimeCapabilities;
}

export type AgentRuntimeDiagnosticEvent =
  | {
      event: "provider.request.started";
      streaming: boolean;
      reasoning?: boolean;
      textVerbosity?: boolean;
    }
  | {
      event: "provider.request.completed";
      streaming: boolean;
      durationMs: number;
      providerStatus?: number;
      retryable?: boolean;
      responseId?: string;
      outputTextChars?: number;
      draftFileChangeCount?: number;
      errorCode?: string;
    }
  | {
      event: "provider.tool_call";
      toolName: AgentDocumentToolName | string;
      status: "completed" | "failed";
      durationMs: number;
      resultCount?: number;
      truncated?: boolean;
      searchedPaths?: number;
      searchedFiles?: number;
      errorCode?: string;
    }
  | {
      event: "provider.phase";
      phase: string;
      method?: string;
      status?: string;
      responseId?: string;
      threadId?: string;
      turnId?: string;
      itemType?: string;
      changeCount?: number;
      failureCode?: string;
    }
  | {
      event: "provider.retry";
      reason: string;
      from: string;
      to: string;
      fromProvider?: AgentRuntimeProviderId;
      toProvider?: AgentRuntimeProviderId;
    };

export type AgentRuntimeDiagnosticEventListener = (event: AgentRuntimeDiagnosticEvent) => void;

export interface AgentRuntimeTextRequest {
  instructions: string;
  input: string;
  maxOutputTokens: number;
  language: "en" | "es";
  cwd: string;
}

export interface AgentRuntimeTextResponse {
  responseId?: string;
  text: string;
}

export interface AgentRuntimeProvider {
  readonly metadata: AgentRuntimeProviderMetadata;

  startRun(request: {
    request: AgentProviderRunRequest;
    signal: AbortSignal;
    documentTools?: AgentDocumentTools;
    onRunEvent?: AgentThinkingRunEventListener;
    onDiagnosticEvent?: AgentRuntimeDiagnosticEventListener;
    onToolContext?: (item: AgentRunContextItem) => void;
  }): Promise<AgentProviderResponse>;

  generateText?(request: {
    request: AgentRuntimeTextRequest;
    signal: AbortSignal;
    onDiagnosticEvent?: AgentRuntimeDiagnosticEventListener;
  }): Promise<AgentRuntimeTextResponse>;
}
