import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentService } from "../../electron/agent/agentService";
import {
  AGENT_TRANSCRIPTION_MAX_BYTES,
  AGENT_TRANSCRIPTION_MODEL,
  createOpenAiAudioTranscription,
  validateTranscribeAudioRequest
} from "../../electron/agent/transcription";
import type { ValidatedTranscriptionRequest } from "../../electron/agent/transcription";

async function tempUserData() {
  return mkdtemp(path.join(tmpdir(), "iliad-transcription-test-"));
}

function validRequest(overrides: Record<string, unknown> = {}) {
  return {
    requestId: "dictation-1",
    audio: new Uint8Array([1, 2, 3, 4]),
    mimeType: "audio/webm",
    ...overrides
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function flushServiceDiagnostics(service: AgentService) {
  return (service as unknown as { diagnostics: { flush(): Promise<void> } }).diagnostics.flush();
}

describe("agent audio transcription", () => {
  it("rejects invalid MIME types", () => {
    const result = validateTranscribeAudioRequest(validRequest({ mimeType: "text/plain" }));

    expect(result).toMatchObject({
      code: "unknown",
      detail: "unsupported_audio_type",
      retryable: false
    });
  });

  it("rejects empty and oversized audio before provider use", () => {
    expect(validateTranscribeAudioRequest(validRequest({ audio: new Uint8Array() }))).toMatchObject({
      code: "unknown",
      detail: "empty_audio"
    });

    expect(
      validateTranscribeAudioRequest(validRequest({ audio: new Uint8Array(AGENT_TRANSCRIPTION_MAX_BYTES + 1) }))
    ).toMatchObject({
      code: "unknown",
      detail: expect.stringContaining("audio_too_large")
    });
  });

  it("validates malformed requests before checking for an API key", async () => {
    const userDataPath = await tempUserData();
    const service = new AgentService(userDataPath);

    try {
      const response = await service.transcribeAudio({ mimeType: "audio/webm", audio: new Uint8Array([1]) });

      expect(response).toMatchObject({
        requestId: "",
        text: "",
        error: {
          code: "unknown",
          detail: expect.stringContaining("invalid_request")
        }
      });
    } finally {
      await flushServiceDiagnostics(service);
      service.dispose();
      await rm(userDataPath, { recursive: true, force: true });
    }
  });

  it("returns a normalized missing-key error for valid requests", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const userDataPath = await tempUserData();
    const service = new AgentService(userDataPath);

    try {
      const response = await service.transcribeAudio(validRequest());

      expect(response).toMatchObject({
        requestId: "dictation-1",
        text: "",
        error: {
          code: "missing_api_key",
          userMessage: "Add an OpenAI API key to dictate.",
          retryable: false
        }
      });
    } finally {
      await flushServiceDiagnostics(service);
      service.dispose();
      await rm(userDataPath, { recursive: true, force: true });
    }
  });

  it("sends the expected OpenAI transcription request", async () => {
    let sentUrl = "";
    let sentInit: RequestInit | undefined;

    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      sentUrl = url;
      sentInit = init;

      return new Response(JSON.stringify({ text: "Hola mundo" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });

    const request = validateTranscribeAudioRequest(
      validRequest({
        mimeType: "audio/webm;codecs=opus"
      })
    );

    expect("code" in request).toBe(false);

    const text = await createOpenAiAudioTranscription({
      apiKey: "test-key",
      request: request as ValidatedTranscriptionRequest
    });

    const body = sentInit?.body as FormData;
    const file = body.get("file") as File;

    expect(text).toBe("Hola mundo");
    expect(sentUrl).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect(sentInit?.method).toBe("POST");
    expect(sentInit?.headers).toEqual({ Authorization: "Bearer test-key" });
    expect(body.get("model")).toBe(AGENT_TRANSCRIPTION_MODEL);
    expect(body.has("language")).toBe(false);
    expect(file.name).toBe("dictation.webm");
    expect(file.type).toBe("audio/webm");
  });

  it("parses transcription text from the provider response", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ text: "Transcribed text" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    const request = validateTranscribeAudioRequest(validRequest({ mimeType: "audio/wav" }));

    expect("code" in request).toBe(false);

    await expect(
      createOpenAiAudioTranscription({
        apiKey: "test-key",
        request: request as ValidatedTranscriptionRequest
      })
    ).resolves.toBe("Transcribed text");
  });
});
