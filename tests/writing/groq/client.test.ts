import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeAgentError } from "../../../electron/writing/errors";
import { streamGroqText, validateGroqApiKey } from "../../../electron/writing/groq/client";
import { GROQ_CHAT_COMPLETIONS_URL, GROQ_MODELS_URL } from "../../../electron/writing/groq/config";
import { GROQ_MODEL, buildWritingAiPrompt } from "../../../electron/writing/groq/prompts/index";
import { autocompleteCases, selectionCases } from "../../fixtures/writingCases";

type Handler = (request: http.IncomingMessage, body: string, response: http.ServerResponse) => void;

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

/** A fake Groq: a local server; `fetchImpl` rewrites Groq URLs to it. */
async function fakeGroq(handler: Handler) {
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (part) => (body += part));
    request.on("end", () => handler(request, body, response));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const seenUrls: string[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    const url = String(input);
    seenUrls.push(url);
    return fetch(url.replace("https://api.groq.com/openai/v1", base), init);
  };
  return { fetchImpl, seenUrls };
}

function sse(response: http.ServerResponse, frames: string[]) {
  response.writeHead(200, { "Content-Type": "text/event-stream" });
  for (const frame of frames) response.write(frame);
  response.end();
}

const frame = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`;
const delta = (text: string) => frame({ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] });

describe("streamGroqText (own key)", () => {
  it("posts the pinned body with the writer's key and streams content only", async () => {
    let seen: { auth?: string; body?: Record<string, unknown> } = {};
    const { fetchImpl, seenUrls } = await fakeGroq((request, body, response) => {
      seen = { auth: request.headers.authorization, body: JSON.parse(body) };
      sse(response, [
        frame({ choices: [{ index: 0, delta: { reasoning: "thinking…" }, finish_reason: null }] }),
        delta("Hello"),
        delta(" writer."),
        frame({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }], x_groq: { usage: { prompt_tokens: 300, completion_tokens: 40, total_tokens: 340 } } }),
        "data: [DONE]\n\n"
      ]);
    });

    const task = autocompleteCases[0].task;
    const deltas: string[] = [];
    const result = await streamGroqText({
      route: { kind: "own-key", apiKey: "gsk_test" },
      task,
      signal: new AbortController().signal,
      onDelta: (piece) => deltas.push(piece),
      fetchImpl
    });

    expect(seenUrls).toEqual([GROQ_CHAT_COMPLETIONS_URL]);
    expect(seen.auth).toBe("Bearer gsk_test");
    const prompt = buildWritingAiPrompt(task);
    expect(seen.body).toEqual({
      model: GROQ_MODEL,
      reasoning_effort: "low",
      include_reasoning: false,
      stream: true,
      stream_options: { include_usage: true },
      n: 1,
      messages: prompt.messages,
      max_completion_tokens: prompt.maxCompletionTokens
    });
    expect(result).toMatchObject({ text: "Hello writer.", finishReason: "stop", usage: { promptTokens: 300, completionTokens: 40 } });
    expect(deltas).toEqual(["Hello", " writer."]);
    expect(result.firstDeltaMs).not.toBeNull();
  });

  it("maps 401/403 to invalid_api_key and 429 to rate_limited, never quoting the body", async () => {
    for (const [status, code] of [[401, "invalid_api_key"], [403, "invalid_api_key"], [429, "rate_limited"], [500, "provider_unavailable"], [404, "model_not_found"]] as const) {
      const { fetchImpl } = await fakeGroq((_request, _body, response) => {
        response.writeHead(status, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { message: "SECRET-BODY gsk_leak" } }));
      });
      const error = await streamGroqText({
        route: { kind: "own-key", apiKey: "gsk_test" },
        task: selectionCases[0].task,
        signal: new AbortController().signal,
        fetchImpl
      }).catch((caught) => caught);
      const agentError = normalizeAgentError(error);
      expect(agentError.code).toBe(code);
      expect(agentError.providerStatus).toBe(status);
      expect(JSON.stringify(agentError)).not.toMatch(/SECRET|gsk_/);
    }
  });

  it("aborting mid-stream closes the connection (the server sees the socket close)", async () => {
    let closed!: () => void;
    const socketClosed = new Promise<void>((resolve) => (closed = resolve));
    const { fetchImpl } = await fakeGroq((_request, _body, response) => {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write(delta("partial"));
      response.on("close", () => closed());
      // Never ends on its own.
    });
    const controller = new AbortController();
    const error = await streamGroqText({
      route: { kind: "own-key", apiKey: "gsk_test" },
      task: autocompleteCases[0].task,
      signal: controller.signal,
      onDelta: () => controller.abort(),
      fetchImpl
    }).catch((caught) => caught);

    expect(normalizeAgentError(error, { wasCanceled: controller.signal.aborted }).code).toBe("request_canceled");
    await expect(socketClosed).resolves.toBeUndefined();
  });

  it("stops forwarding at the task's maxOutputChars and reports length", async () => {
    const { fetchImpl } = await fakeGroq((_request, _body, response) => {
      sse(response, [delta("x".repeat(300)), delta("y".repeat(300)), frame({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })]);
    });
    const result = await streamGroqText({
      route: { kind: "own-key", apiKey: "gsk_test" },
      task: autocompleteCases[0].task, // sentence: 420 chars
      signal: new AbortController().signal,
      fetchImpl
    });
    expect(result).toMatchObject({ finishReason: "length", outputCapped: true });
    expect(result.text).toHaveLength(420);
  });
});

describe("validateGroqApiKey", () => {
  it("is ok only on 200 from GET /models", async () => {
    let auth: string | undefined;
    let method: string | undefined;
    const { fetchImpl, seenUrls } = await fakeGroq((request, _body, response) => {
      auth = request.headers.authorization;
      method = request.method;
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end('{"data":[]}');
    });
    await expect(validateGroqApiKey("gsk_valid", { fetchImpl })).resolves.toEqual({ ok: true });
    expect(seenUrls).toEqual([GROQ_MODELS_URL]);
    expect(method).toBe("GET");
    expect(auth).toBe("Bearer gsk_valid");
  });

  it("maps 401/403 to rejected and anything else (or no network) to unreachable", async () => {
    for (const [status, reason] of [[401, "rejected"], [403, "rejected"], [429, "unreachable"], [503, "unreachable"]] as const) {
      const { fetchImpl } = await fakeGroq((_request, _body, response) => {
        response.writeHead(status);
        response.end();
      });
      await expect(validateGroqApiKey("gsk_x", { fetchImpl })).resolves.toEqual({ ok: false, reason });
    }
    const offline: typeof fetch = () => Promise.reject(new TypeError("fetch failed"));
    await expect(validateGroqApiKey("gsk_x", { fetchImpl: offline })).resolves.toEqual({ ok: false, reason: "unreachable" });
  });

  it("checks the shape before any network call", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    for (const key of ["", "gsk_ with space", "gsk_\n", "x".repeat(513)]) {
      await expect(validateGroqApiKey(key, { fetchImpl })).resolves.toEqual({ ok: false, reason: "invalid_shape" });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
