import { createOpenAiResponse } from "../openaiResponses.js";
import { normalizeAgentError, providerStatusError } from "../errors.js";
import { readOpenAiResponse, responseText } from "../openai/responses.js";
import type { AgentProviderRunRequest, AgentRunContextItem, AgentThinkingRunEventListener } from "../types.js";
import type { AgentDocumentTools } from "../documentTools.js";
import type {
  AgentRuntimeDiagnosticEventListener,
  AgentRuntimeProvider,
  AgentRuntimeProviderMetadata,
  AgentRuntimeTextRequest,
  AgentRuntimeTextResponse
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
      fetchImpl?: typeof fetch;
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

  async generateText({
    request,
    signal,
    onDiagnosticEvent
  }: {
    request: AgentRuntimeTextRequest;
    signal: AbortSignal;
    onDiagnosticEvent?: AgentRuntimeDiagnosticEventListener;
  }): Promise<AgentRuntimeTextResponse> {
    const startedAt = Date.now();
    const fetchImpl = this.options.fetchImpl ?? fetch;

    onDiagnosticEvent?.({
      event: "provider.request.started",
      streaming: false,
      reasoning: true,
      textVerbosity: false
    });

    try {
      const response = await fetchImpl("https://api.openai.com/v1/responses", {
        method: "POST",
        signal,
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: this.options.model,
          instructions: request.instructions,
          input: request.input,
          max_output_tokens: request.maxOutputTokens,
          reasoning: { effort: "low" },
          stream: false
        })
      });
      const payload = await readOpenAiResponse(response);

      if (!response.ok) {
        throw providerStatusError(response.status);
      }

      const text = responseText(payload);

      onDiagnosticEvent?.({
        event: "provider.request.completed",
        streaming: false,
        durationMs: Date.now() - startedAt,
        providerStatus: response.status,
        retryable: false,
        responseId: payload.id,
        outputTextChars: text.length,
        draftFileChangeCount: 0
      });

      return {
        responseId: payload.id,
        text
      };
    } catch (error) {
      const agentError = normalizeAgentError(error);
      onDiagnosticEvent?.({
        event: "provider.request.completed",
        streaming: false,
        durationMs: Date.now() - startedAt,
        retryable: true,
        errorCode: agentError.code,
        providerStatus: agentError.providerStatus
      });
      throw error;
    }
  }
}
