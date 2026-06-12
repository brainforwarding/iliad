import { createOpenAiResponse } from "../openaiResponses.js";
import type { AgentProviderRunRequest, AgentRunContextItem, AgentThinkingRunEventListener } from "../types.js";
import type { AgentDocumentTools } from "../documentTools.js";
import type {
  AgentRuntimeDiagnosticEventListener,
  AgentRuntimeProvider,
  AgentRuntimeProviderMetadata
} from "./provider.js";

export const OPENAI_RESPONSES_PROVIDER_METADATA: AgentRuntimeProviderMetadata = {
  id: "openai-api",
  label: "OpenAI API",
  billing: "openai_platform_api",
  capabilities: {
    text: true,
    thinkingSummaries: true,
    reviewableProposals: true,
    workspaceEvents: false,
    managedAccountAuth: false,
    rateLimits: false,
    media: {
      transcription: true,
      images: false,
      realtime: false
    }
  }
};

export class OpenAiResponsesRuntimeProvider implements AgentRuntimeProvider {
  readonly metadata = OPENAI_RESPONSES_PROVIDER_METADATA;

  constructor(
    private readonly options: {
      apiKey: string;
      model: string;
    }
  ) {}

  startRun({
    request,
    signal,
    documentTools,
    onRunEvent,
    onDiagnosticEvent,
    onToolContext
  }: {
    request: AgentProviderRunRequest;
    signal: AbortSignal;
    documentTools?: AgentDocumentTools;
    onRunEvent?: AgentThinkingRunEventListener;
    onDiagnosticEvent?: AgentRuntimeDiagnosticEventListener;
    onToolContext?: (item: AgentRunContextItem) => void;
  }) {
    return createOpenAiResponse({
      apiKey: this.options.apiKey,
      model: this.options.model,
      request,
      signal,
      documentTools,
      onRunEvent,
      onDiagnosticEvent,
      onToolContext
    });
  }
}
