// Worker-runtime integration tests (workerd via @cloudflare/vitest-pool-workers):
// real SQLite Durable Object transactions and alarms, the real
// `enable_request_signal` flag and abort propagation, against a fake Groq
// upstream served from Node through Miniflare's outbound service.
// Run: npm --prefix relay/ai-proxy run test:workers

import { randomBytes } from "node:crypto";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const secret = () => randomBytes(32).toString("base64url");

/** Fake Groq state, readable from tests via https://fake-groq.test/state. */
const state = { requests: 0, canceled: 0, lastBody: null as unknown };

function sse(frames: unknown[]): string {
  return frames.map((frame) => `data: ${typeof frame === "string" ? frame : JSON.stringify(frame)}\n\n`).join("");
}

async function fakeUpstream(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.hostname === "fake-groq.test") {
    if (url.pathname === "/reset") Object.assign(state, { requests: 0, canceled: 0, lastBody: null });
    return Response.json(state);
  }
  if (url.hostname !== "api.groq.com") return new Response("blocked", { status: 599 });

  state.requests += 1;
  const body = (await request.json()) as { messages: Array<{ content: string }> };
  state.lastBody = { model: (body as { model?: string }).model, messages: body.messages.length };
  const user = body.messages.at(-1)?.content ?? "";
  const scenario = /\[\[scenario:(\w+)\]\]/.exec(user)?.[1] ?? "ok";

  if (scenario === "status500") return new Response("{\"error\":{\"message\":\"boom\"}}", { status: 500 });
  if (scenario === "status429") return new Response("{}", { status: 429, headers: { "Retry-After": "9" } });

  const usage = { prompt_tokens: 300, completion_tokens: 40, total_tokens: 340 };
  if (scenario === "hang") {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(sse([{ choices: [{ index: 0, delta: { content: "first words" }, finish_reason: null }] }])));
      },
      cancel() {
        state.canceled += 1;
      }
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
  }

  return new Response(
    sse([
      { choices: [{ index: 0, delta: { role: "assistant", reasoning: "secret reasoning" }, finish_reason: null }] },
      { choices: [{ index: 0, delta: { content: "Hello from " }, finish_reason: null }] },
      { choices: [{ index: 0, delta: { content: "fake Groq." }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "stop" }], x_groq: { usage } },
      { choices: [], usage },
      "[DONE]"
    ]),
    { headers: { "Content-Type": "text/event-stream" } }
  );
}

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: {
        bindings: {
          INSTALL_DAILY_REQUESTS: "5",
          GROQ_API_KEY: "gsk_integration_test",
          TOKEN_SIGNING_KEYS: JSON.stringify({ it1: { key: secret(), signs: true } }),
          IP_HASH_KEY: secret(),
          ADMIN_TOKEN: secret()
        },
        outboundService: fakeUpstream
      }
    })
  ],
  test: {
    include: ["tests/workers/**/*.workers.test.ts"],
    testTimeout: 20_000
  }
});
