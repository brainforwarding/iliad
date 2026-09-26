import { describe, expect, it } from "vitest";
import { IliadAiProxyClient } from "../../../electron/writing/groq/proxyClient";
import type { WritingAiTask } from "../../../electron/writing/groq/prompts/index";

const BASE = "https://proxy.test";

function sseBody(text: string) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    }
  });
}

describe("IliadAiProxyClient token issuance", () => {
  it("does not tie shared issuance to the first caller's signal: A is canceled, B still gets the token", async () => {
    let releaseInstall!: () => void;
    const installGate = new Promise<void>((resolve) => { releaseInstall = resolve; });
    const installSignals: Array<AbortSignal | null | undefined> = [];
    const generateTokens: string[] = [];
    let stored: string | null = null;

    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === `${BASE}/v1/install`) {
        installSignals.push(init?.signal);
        // Like fetch: an aborted signal rejects the in-flight request.
        await Promise.race([
          installGate,
          new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)))
        ]);
        return new Response(JSON.stringify({ token: "v1.shared.token" }), { status: 200 });
      }
      generateTokens.push(String((init?.headers as Record<string, string>).Authorization));
      return new Response(sseBody("done."), { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }) as typeof fetch;

    const client = new IliadAiProxyClient({
      endpoint: { resolve: async () => ({ ok: true, baseUrl: BASE }) },
      tokens: {
        read: async () => stored,
        write: async (token) => { stored = token; },
        clear: async () => { stored = null; }
      },
      clientVersion: "0.4.0",
      fetchImpl
    });
    const task = { v: 1, task: "autocomplete" } as unknown as WritingAiTask;

    const a = new AbortController();
    const first = client.stream({ task, signal: a.signal, maxOutputChars: 100 });
    const second = client.stream({ task, signal: new AbortController().signal, maxOutputChars: 100 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    a.abort();
    await expect(first).rejects.toThrow();

    releaseInstall();
    const result = await second;
    expect(result.text).toBe("done.");
    expect(installSignals).toHaveLength(1);
    expect(installSignals[0]?.aborted).toBe(false);
    expect(generateTokens).toEqual(["Bearer v1.shared.token"]);
  });
});
