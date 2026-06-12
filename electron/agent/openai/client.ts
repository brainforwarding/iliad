import { malformedProviderResponseError, providerStatusError } from "../errors.js";
import { parseProposalDrafts, sanitizeLegacyAssistantText } from "../proposalDrafts.js";
import { createTextDeltaEmitter, type TextDeltaEmitter } from "../textStream.js";
import type {
  AgentProviderResponse,
  AgentProviderRunRequest,
  AgentRunContextItem,
  AgentThinkingRunEventListener
} from "../types.js";
import type { AgentDocumentTools } from "../documentTools.js";
import {
  executeOpenAiDocumentToolCall,
  functionCallOutputItem,
  initialOpenAiToolBudgetState,
  OPENAI_DOCUMENT_TOOL_BUDGETS,
  openAiFunctionCalls,
  toolBudgetExceededOutput
} from "./documentTools.js";
import {
  isRetryableUnsupportedParameterError,
  isRetryableUnsupportedToolParameterError,
  nextStreamingOptions,
  OpenAiRequestError,
  optionsKey,
  providerFailureDiagnostic,
  providerRetryReason,
  readOpenAiRequestError
} from "./providerErrors.js";
import { postOpenAiResponse } from "./request.js";
import { readOpenAiResponse, responseText } from "./responses.js";
import { readOpenAiResponseStream } from "./stream.js";
import { userInput } from "./prompts.js";
import type { OpenAiDiagnosticEventListener, OpenAiInputItem, OpenAiRequestOptions, OpenAiResponse } from "./types.js";

async function createOpenAiResponseNonStreaming({
  apiKey,
  model,
  request,
  signal,
  onDiagnosticEvent
}: {
  apiKey: string;
  model: string;
  request: AgentProviderRunRequest;
  signal: AbortSignal;
  onDiagnosticEvent?: OpenAiDiagnosticEventListener;
}): Promise<AgentProviderResponse> {
  const startedAt = Date.now();
  onDiagnosticEvent?.({
    event: "provider.request.started",
    streaming: false
  });

  try {
    const response = await postOpenAiResponse({ apiKey, model, request, signal });

    const payload = await readOpenAiResponse(response);

    if (!response.ok) {
      throw providerStatusError(response.status);
    }

    const text = responseText(payload);
    const parsed =
      request.runProfile === "remote_read_only"
        ? { drafts: [], anchoredEditFailed: false }
        : parseProposalDrafts(request, text);

    if (!payload.id) {
      throw malformedProviderResponseError();
    }

    onDiagnosticEvent?.({
      event: "provider.request.completed",
      streaming: false,
      durationMs: Date.now() - startedAt,
      providerStatus: response.status,
      retryable: false,
      responseId: payload.id,
      outputTextChars: text.length,
      draftFileChangeCount: parsed.drafts.length
    });

    return {
      runId: request.runId,
      responseId: payload.id,
      text:
        request.runProfile === "remote_read_only"
          ? text.trim()
          : sanitizeLegacyAssistantText(text, parsed.drafts.length > 0, request.language, parsed.anchoredEditFailed),
      draftFileChanges: parsed.drafts,
      proposalSource: parsed.drafts.length > 0 ? { kind: "legacy_marker_adapter" } : undefined
    };
  } catch (error) {
    onDiagnosticEvent?.({
      event: "provider.request.completed",
      streaming: false,
      durationMs: Date.now() - startedAt,
      ...providerFailureDiagnostic(error)
    });
    throw error;
  }
}

async function requestOpenAiResponseStreamPayload({
  apiKey,
  model,
  request,
  signal,
  options,
  onRunEvent,
  onDiagnosticEvent,
  textEmitter
}: {
  apiKey: string;
  model: string;
  request: AgentProviderRunRequest;
  signal: AbortSignal;
  options: OpenAiRequestOptions;
  onRunEvent?: AgentThinkingRunEventListener;
  onDiagnosticEvent?: OpenAiDiagnosticEventListener;
  textEmitter?: TextDeltaEmitter;
}): Promise<OpenAiResponse> {
  const startedAt = Date.now();
  // Every streamed payload (tool round, retry) starts a new generation: the
  // renderer replaces its draft so rounds and retries can never concatenate.
  textEmitter?.nextGeneration();
  onDiagnosticEvent?.({
    event: "provider.request.started",
    streaming: true,
    reasoning: options.reasoning,
    textVerbosity: options.textVerbosity
  });

  try {
    const response = await postOpenAiResponse({ apiKey, model, request, signal, options });

    if (!response.ok) {
      if (response.status !== 400) {
        throw providerStatusError(response.status);
      }

      throw await readOpenAiRequestError(response);
    }

    const payload = await readOpenAiResponseStream(response, request, onRunEvent, textEmitter);
    textEmitter?.flush();
    const text = responseText(payload);

    if (!payload.id) {
      throw malformedProviderResponseError();
    }

    onDiagnosticEvent?.({
      event: "provider.request.completed",
      streaming: true,
      durationMs: Date.now() - startedAt,
      providerStatus: response.status,
      retryable: false,
      responseId: payload.id,
      outputTextChars: text.length
    });

    return payload;
  } catch (error) {
    onDiagnosticEvent?.({
      event: "provider.request.completed",
      streaming: true,
      durationMs: Date.now() - startedAt,
      ...providerFailureDiagnostic(error)
    });
    throw error;
  }
}

async function createOpenAiResponseStream({
  apiKey,
  model,
  request,
  signal,
  options,
  onRunEvent,
  onDiagnosticEvent,
  textEmitter
}: {
  apiKey: string;
  model: string;
  request: AgentProviderRunRequest;
  signal: AbortSignal;
  options: OpenAiRequestOptions;
  onRunEvent?: AgentThinkingRunEventListener;
  onDiagnosticEvent?: OpenAiDiagnosticEventListener;
  textEmitter?: TextDeltaEmitter;
}): Promise<AgentProviderResponse> {
  const payload = await requestOpenAiResponseStreamPayload({
    apiKey,
    model,
    request,
    signal,
    options,
    onRunEvent,
    onDiagnosticEvent,
    textEmitter
  });
  return providerResponseFromOpenAiPayload(request, payload);
}

async function createOpenAiResponseToolLoop({
  apiKey,
  model,
  request,
  signal,
  options,
  documentTools,
  onRunEvent,
  onDiagnosticEvent,
  onToolContext,
  textEmitter
}: {
  apiKey: string;
  model: string;
  request: AgentProviderRunRequest;
  signal: AbortSignal;
  options: OpenAiRequestOptions;
  documentTools: AgentDocumentTools;
  onRunEvent?: AgentThinkingRunEventListener;
  onDiagnosticEvent?: OpenAiDiagnosticEventListener;
  onToolContext?: (item: AgentRunContextItem) => void;
  textEmitter?: TextDeltaEmitter;
}): Promise<AgentProviderResponse> {
  const budget = initialOpenAiToolBudgetState();
  const transcript: OpenAiInputItem[] = [
    {
      role: "user",
      content: userInput(request)
    }
  ];
  let toolsEnabled = true;
  let lastPayload: OpenAiResponse | undefined;

  while (true) {
    throwIfAborted(signal);
    const payload = await requestOpenAiResponseStreamPayload({
      apiKey,
      model,
      request,
      signal,
      options: {
        ...options,
        tools: true,
        toolChoice: toolsEnabled ? "auto" : "none",
        input: lastPayload ? transcript : undefined
      },
      onRunEvent,
      onDiagnosticEvent,
      textEmitter
    });
    lastPayload = payload;

    const outputItems = payload.output ?? [];
    const calls = openAiFunctionCalls(outputItems);

    if (calls.length === 0) {
      return providerResponseFromOpenAiPayload(request, payload);
    }

    transcript.push(...outputItems);

    if (!toolsEnabled) {
      return exhaustedToolBudgetResponse(request, payload.id);
    }

    const toolOutputItems: OpenAiInputItem[] = [];

    if (budget.toolRounds >= OPENAI_DOCUMENT_TOOL_BUDGETS.maxToolRounds) {
      toolsEnabled = false;
      toolOutputItems.push(...calls.map(toolBudgetExceededOutput));
    } else {
      budget.toolRounds += 1;

      for (let index = 0; index < calls.length; index += 1) {
        const call = calls[index];
        throwIfAborted(signal);
        const result = await executeOpenAiDocumentToolCall({
          call,
          requestRunId: request.runId,
          documentTools,
          budget,
          signal,
          allowOpenDocument: request.runProfile !== "remote_read_only",
          onDiagnosticEvent,
          onToolContext
        });
        throwIfAborted(signal);
        toolOutputItems.push(result.outputItem);

        if (result.exhaustedBudget) {
          toolsEnabled = false;
          toolOutputItems.push(...calls.slice(index + 1).map(toolBudgetExceededOutput));
          break;
        }
      }
    }

    if (toolOutputItems.length === 0) {
      for (const call of calls) {
        toolOutputItems.push(
          functionCallOutputItem(call, {
            ok: false,
            code: "tool_call_unavailable",
            message: "Document tool call failed."
          })
        );
      }
    }

    transcript.push(...toolOutputItems);
  }
}

function providerResponseFromOpenAiPayload(
  request: AgentProviderRunRequest,
  payload: OpenAiResponse
): AgentProviderResponse {
  const text = responseText(payload);
  const parsed =
    request.runProfile === "remote_read_only"
      ? { drafts: [], anchoredEditFailed: false }
      : parseProposalDrafts(request, text);

  if (!payload.id) {
    throw malformedProviderResponseError();
  }

  return {
    runId: request.runId,
    responseId: payload.id,
    text:
      request.runProfile === "remote_read_only"
        ? text.trim()
        : sanitizeLegacyAssistantText(text, parsed.drafts.length > 0, request.language, parsed.anchoredEditFailed),
    draftFileChanges: parsed.drafts,
    proposalSource: parsed.drafts.length > 0 ? { kind: "legacy_marker_adapter" } : undefined
  };
}

function exhaustedToolBudgetResponse(request: AgentProviderRunRequest, responseId: string | undefined): AgentProviderResponse {
  return {
    runId: request.runId,
    responseId,
    text:
      request.language === "es"
        ? "Se agoto el presupuesto de herramientas de documentos. Respondo solo con el contexto ya disponible."
        : "The document tool budget was exhausted. I can only answer with the context already available.",
    draftFileChanges: []
  };
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) {
    signal.throwIfAborted();
  }
}

export async function createOpenAiResponse({
  apiKey,
  model,
  request,
  signal,
  documentTools,
  onRunEvent,
  onDiagnosticEvent,
  onToolContext
}: {
  apiKey: string;
  model: string;
  request: AgentProviderRunRequest;
  signal: AbortSignal;
  documentTools?: AgentDocumentTools;
  onRunEvent?: AgentThinkingRunEventListener;
  onDiagnosticEvent?: OpenAiDiagnosticEventListener;
  onToolContext?: (item: AgentRunContextItem) => void;
}): Promise<AgentProviderResponse> {
  let options: OpenAiRequestOptions = { reasoning: true, textVerbosity: true };
  const tried = new Set<string>();
  let toolsEnabled = Boolean(documentTools);
  const textEmitter = createTextDeltaEmitter(request.runId, onRunEvent);

  while (true) {
    tried.add(optionsKey(options));

    try {
      if (toolsEnabled && documentTools) {
        return await createOpenAiResponseToolLoop({
          apiKey,
          model,
          request,
          signal,
          options,
          documentTools,
          onRunEvent,
          onDiagnosticEvent,
          onToolContext,
          textEmitter
        });
      }

      return await createOpenAiResponseStream({
        apiKey,
        model,
        request,
        signal,
        options,
        onRunEvent,
        onDiagnosticEvent,
        textEmitter
      });
    } catch (error) {
      const nextOptions = nextStreamingOptions(error, options, tried);

      if (nextOptions) {
        onDiagnosticEvent?.({
          event: "provider.retry",
          reason: providerRetryReason(error),
          from: optionsKey(options),
          to: optionsKey(nextOptions)
        });
        options = nextOptions;
        continue;
      }

      if (toolsEnabled && isRetryableUnsupportedToolParameterError(error)) {
        onDiagnosticEvent?.({
          event: "provider.retry",
          reason: providerRetryReason(error),
          from: `${optionsKey(options)}:tools`,
          to: `${optionsKey(options)}:no-tools`
        });
        toolsEnabled = false;
        continue;
      }

      if (isRetryableUnsupportedParameterError(error)) {
        onDiagnosticEvent?.({
          event: "provider.retry",
          reason: providerRetryReason(error),
          from: optionsKey(options),
          to: "non-streaming"
        });
        return createOpenAiResponseNonStreaming({ apiKey, model, request, signal, onDiagnosticEvent });
      }

      if (error instanceof OpenAiRequestError) {
        throw providerStatusError(error.status);
      }

      throw error;
    }
  }
}
