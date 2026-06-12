import { providerStatusError } from "../errors.js";
import type { OpenAiRequestOptions } from "./types.js";
import { isRecord, numericProperty, recordProperty, stringProperty } from "./utils.js";

export class OpenAiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly payload: unknown
  ) {
    super(openAiErrorMessage(payload) || `OpenAI request failed with status ${status}`);
    this.name = "OpenAiRequestError";
  }
}

export class OpenAiStreamEventError extends Error {
  constructor(readonly payload: unknown) {
    super(openAiErrorMessage(payload) || "OpenAI returned an error while streaming.");
    this.name = "OpenAiStreamEventError";
  }
}

export async function readOpenAiRequestError(response: Response) {
  try {
    return new OpenAiRequestError(response.status, await response.json());
  } catch {
    return new OpenAiRequestError(response.status, null);
  }
}

export function openAiStreamEventError(event: Record<string, unknown>) {
  const eventError = recordProperty(event, "error");
  const status =
    numericProperty(event, "status") ??
    numericProperty(eventError, "status") ??
    numericProperty(eventError, "status_code") ??
    numericProperty(recordProperty(event, "response"), "status_code");

  if (status) {
    return providerStatusError(status);
  }

  return new OpenAiStreamEventError(event);
}

export function nextStreamingOptions(
  error: unknown,
  current: OpenAiRequestOptions,
  tried: Set<string>
): OpenAiRequestOptions | null {
  if (!isRetryableUnsupportedParameterError(error) || isUnsupportedStreamingError(error)) {
    return null;
  }

  const candidates: OpenAiRequestOptions[] = [];

  if (isUnsupportedReasoningError(error) && current.reasoning) {
    candidates.push({ ...current, reasoning: false });
  }

  if (isUnsupportedTextVerbosityError(error) && current.textVerbosity) {
    candidates.push({ ...current, textVerbosity: false });
  }

  candidates.push({ reasoning: false, textVerbosity: current.textVerbosity });
  candidates.push({ reasoning: current.reasoning, textVerbosity: false });
  candidates.push({ reasoning: false, textVerbosity: false });

  return candidates.find((candidate) => !tried.has(optionsKey(candidate))) ?? null;
}

export function isRetryableUnsupportedParameterError(error: unknown) {
  return (
    isUnsupportedReasoningError(error) ||
    isReasoningSummaryUnavailableError(error) ||
    isUnsupportedTextVerbosityError(error) ||
    isUnsupportedStreamingError(error)
  );
}

export function isRetryableUnsupportedToolParameterError(error: unknown) {
  const message = openAiRequestErrorMessage(error);
  return (
    message !== "" &&
    /\b(?:tools?|tool_choice|parallel_tool_calls)\b/i.test(message) &&
    isUnsupportedParameterMessage(message)
  );
}

function isUnsupportedReasoningError(error: unknown) {
  const message = openAiRequestErrorMessage(error);
  return message !== "" && /\breasoning\b/i.test(message) && isUnsupportedParameterMessage(message);
}

function isReasoningSummaryUnavailableError(error: unknown) {
  const message = openAiRequestErrorMessage(error);
  return (
    message !== "" &&
    /\b(?:reasoning|summar(?:y|ies|izer|izers))\b/i.test(message) &&
    /\b(?:access|available|enabled|organization|org|permission|support|supported|unavailable|verification|verified|verify)\b/i.test(message)
  );
}

function isUnsupportedTextVerbosityError(error: unknown) {
  const message = openAiRequestErrorMessage(error);
  return (
    message !== "" &&
    (/\btext\.verbosity\b/i.test(message) ||
      /\bverbosity\b/i.test(message) ||
      /\b(?:parameter|param)\b[^.]*["']?text["']?/i.test(message)) &&
    isUnsupportedParameterMessage(message)
  );
}

function isUnsupportedStreamingError(error: unknown) {
  const message = openAiRequestErrorMessage(error);
  return message !== "" && /\bstream(?:ing)?\b/i.test(message) && isUnsupportedParameterMessage(message);
}

function isUnsupportedParameterMessage(message: string) {
  return /\b(?:unsupported|not supported|does not support|not support|unknown|invalid|unrecognized)\b/i.test(message);
}

function openAiRequestErrorMessage(error: unknown) {
  if (error instanceof OpenAiStreamEventError) {
    return openAiErrorMessage(error.payload);
  }

  if (!(error instanceof OpenAiRequestError) || error.status !== 400) {
    return "";
  }

  return openAiErrorMessage(error.payload);
}

export function openAiErrorMessage(payload: unknown): string {
  if (!isRecord(payload)) {
    return "";
  }

  const error = payload.error;

  if (isRecord(error)) {
    return [stringProperty(error, "message"), stringProperty(error, "code"), stringProperty(error, "param")]
      .filter(Boolean)
      .join(" ");
  }

  return stringProperty(payload, "message");
}

export function optionsKey(options: OpenAiRequestOptions) {
  return `${options.reasoning ? "reasoning" : "no-reasoning"}:${options.textVerbosity ? "verbosity" : "no-verbosity"}`;
}

export function providerRetryReason(error: unknown) {
  if (isReasoningSummaryUnavailableError(error)) {
    return "unsupported_reasoning_summary";
  }

  if (isUnsupportedReasoningError(error)) {
    return "unsupported_reasoning";
  }

  if (isUnsupportedTextVerbosityError(error)) {
    return "unsupported_text_verbosity";
  }

  if (isUnsupportedStreamingError(error)) {
    return "unsupported_streaming";
  }

  return "unsupported_provider_option";
}

export function providerFailureDiagnostic(error: unknown) {
  if (error instanceof OpenAiRequestError) {
    return {
      providerStatus: error.status,
      retryable: isRetryableUnsupportedParameterError(error),
      errorCode: "openai_request_error"
    };
  }

  if (error instanceof OpenAiStreamEventError) {
    return {
      retryable: isRetryableUnsupportedParameterError(error),
      errorCode: "openai_stream_event_error"
    };
  }

  if (isRecord(error)) {
    const status = numericProperty(error, "providerStatus") ?? numericProperty(error, "status");
    const code = stringProperty(error, "code");

    return {
      ...(status ? { providerStatus: status } : {}),
      ...(code ? { errorCode: code } : { errorCode: stringProperty(error, "name") || "provider_request_error" }),
      retryable: typeof error.retryable === "boolean" ? error.retryable : true
    };
  }

  return {
    errorCode: "provider_request_error",
    retryable: true
  };
}
