import { malformedProviderResponseError, normalizeAgentError, providerStatusError } from "./errors.js";
import type { AgentError, AgentTranscribeAudioRequest, AgentTranscribeAudioResponse } from "./types.js";

export const AGENT_TRANSCRIPTION_MAX_BYTES = 24 * 1024 * 1024;
export const AGENT_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";

const audioMimeExtensions = new Map<string, string>([
  ["audio/flac", "flac"],
  ["audio/mpeg", "mp3"],
  ["audio/mp3", "mp3"],
  ["audio/mp4", "mp4"],
  ["video/mp4", "mp4"],
  ["audio/mpga", "mpga"],
  ["audio/m4a", "m4a"],
  ["audio/x-m4a", "m4a"],
  ["audio/ogg", "ogg"],
  ["application/ogg", "ogg"],
  ["audio/wav", "wav"],
  ["audio/wave", "wav"],
  ["audio/x-wav", "wav"],
  ["audio/webm", "webm"],
  ["video/webm", "webm"]
]);

export interface ValidatedTranscriptionRequest {
  requestId: string;
  audioBytes: Uint8Array;
  mimeType: string;
  extension: string;
  language?: string;
}

export function requestIdFromTranscriptionRequest(value: unknown) {
  if (!isRecord(value)) {
    return "";
  }

  return typeof value.requestId === "string" ? value.requestId : "";
}

export function validateTranscribeAudioRequest(value: unknown): ValidatedTranscriptionRequest | AgentError {
  if (!isRecord(value)) {
    return invalidRequestError("Dictation request must be an object.");
  }

  const requestId = typeof value.requestId === "string" ? value.requestId.trim() : "";
  const mimeType = normalizeMimeType(typeof value.mimeType === "string" ? value.mimeType : "");
  const extension = audioMimeExtensions.get(mimeType);
  const audioBytes = readAudioBytes(value.audio ?? value.audioBytes);
  const language = typeof value.language === "string" && value.language.trim() ? value.language.trim() : undefined;

  if (!requestId) {
    return invalidRequestError("Dictation requestId is required.");
  }

  if (!audioBytes) {
    return invalidRequestError("Dictation audio bytes are required.");
  }

  if (!mimeType || !extension) {
    return unsupportedAudioTypeError();
  }

  if (audioBytes.byteLength === 0) {
    return emptyAudioError();
  }

  if (audioBytes.byteLength > AGENT_TRANSCRIPTION_MAX_BYTES) {
    return audioTooLargeError();
  }

  return {
    requestId,
    audioBytes,
    mimeType,
    extension,
    ...(language ? { language } : {})
  };
}

export async function createOpenAiAudioTranscription({
  apiKey,
  request,
  signal,
  model = AGENT_TRANSCRIPTION_MODEL
}: {
  apiKey: string;
  request: ValidatedTranscriptionRequest;
  signal?: AbortSignal;
  model?: string;
}) {
  const form = new FormData();
  const filename = `dictation.${request.extension}`;
  form.set("file", new Blob([audioBytesToBlobPart(request.audioBytes)], { type: request.mimeType }), filename);
  form.set("model", model);

  if (request.language) {
    form.set("language", request.language);
  }

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    body: form
  });

  if (!response.ok) {
    throw providerStatusError(response.status);
  }

  try {
    return parseOpenAiTranscriptionResponse(await response.json());
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw malformedProviderResponseError();
    }

    throw error;
  }
}

export function parseOpenAiTranscriptionResponse(payload: unknown) {
  if (!isRecord(payload) || typeof payload.text !== "string") {
    throw malformedProviderResponseError();
  }

  return payload.text;
}

export function transcriptionFailedResponse(requestId: string, error: AgentError): AgentTranscribeAudioResponse {
  return {
    requestId,
    text: "",
    error
  };
}

export function normalizeTranscriptionError(error: unknown, options: { wasCanceled?: boolean } = {}) {
  return normalizeAgentError(error, options);
}

export function missingDictationApiKeyError(): AgentError {
  return {
    code: "missing_api_key",
    userMessage: "Add an OpenAI API key to dictate.",
    retryable: false
  };
}

function invalidRequestError(detail: string): AgentError {
  return {
    code: "unknown",
    userMessage: "The dictation request was invalid.",
    detail: `invalid_request: ${detail}`,
    retryable: false
  };
}

function unsupportedAudioTypeError(): AgentError {
  return {
    code: "unknown",
    userMessage: "This audio format is not supported for dictation.",
    detail: "unsupported_audio_type",
    retryable: false
  };
}

function audioTooLargeError(): AgentError {
  return {
    code: "unknown",
    userMessage: "Recording too long.",
    detail: `audio_too_large: Maximum audio size is ${AGENT_TRANSCRIPTION_MAX_BYTES} bytes.`,
    retryable: false
  };
}

function emptyAudioError(): AgentError {
  return {
    code: "unknown",
    userMessage: "No speech detected.",
    detail: "empty_audio",
    retryable: false
  };
}

function normalizeMimeType(mimeType: string) {
  return mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
}

function readAudioBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) {
    return value;
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }

  return null;
}

function audioBytesToBlobPart(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
