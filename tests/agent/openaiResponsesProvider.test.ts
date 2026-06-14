import { describe, expect, it, vi } from "vitest";
import { OpenAiResponsesRuntimeProvider } from "../../electron/agent/runtime/openaiResponsesProvider";

const textRequest = {
  instructions: "Rewrite this passage only.",
  input: "This passage is rather wordy.",
  maxOutputTokens: 384,
  language: "en" as const,
  cwd: "/tmp"
};

describe("OpenAI Responses runtime provider text generation", () => {
  it("uses the non-streaming one-shot Responses body", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ id: "resp_text", output_text: "This passage is wordy." }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    const provider = new OpenAiResponsesRuntimeProvider({
      apiKey: "test-key",
      model: "gpt-5.5",
      fetchImpl: fetchImpl as typeof fetch
    });

    await expect(
      provider.generateText!({
        request: textRequest,
        signal: new AbortController().signal
      })
    ).resolves.toEqual({
      responseId: "resp_text",
      text: "This passage is wordy."
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.openai.com/v1/responses",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
          "Content-Type": "application/json"
        })
      })
    );
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: "gpt-5.5",
      instructions: "Rewrite this passage only.",
      input: "This passage is rather wordy.",
      max_output_tokens: 384,
      reasoning: { effort: "low" },
      stream: false
    });
  });

  it("maps JSON error responses by HTTP status", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: "insufficient quota" } }), {
        status: 429,
        headers: { "Content-Type": "application/json" }
      })
    );
    const provider = new OpenAiResponsesRuntimeProvider({
      apiKey: "test-key",
      model: "gpt-5.5",
      fetchImpl: fetchImpl as typeof fetch
    });

    await expect(
      provider.generateText!({
        request: textRequest,
        signal: new AbortController().signal
      })
    ).rejects.toMatchObject({
      agentError: {
        code: "rate_limited",
        providerStatus: 429
      }
    });
  });
});
