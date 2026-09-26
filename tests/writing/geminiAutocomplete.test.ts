import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateGeminiAutocomplete, readGeminiAutocompleteStream, stableAutocompletePrefix } from "../../electron/writing/geminiAutocomplete";
import { WritingAiService } from "../../electron/writing/writingAiService";
import { WritingSettingsStore } from "../../electron/writing/settingsStore";
import type { IdeaAutocompleteTextRequest } from "../../electron/writing/autocomplete";

const request = (): IdeaAutocompleteTextRequest => ({
  requestId: "test", language: "en", prefix: "She opened the door and ", suffix: "",
  headingPath: [], nearbyHeadings: [], documentTitle: "A story", trigger: "manual",
  suggestionKind: "sentence", signal: new AbortController().signal
});
const reply = (text = "waited.") => Response.json({ candidates: [{
  finishReason: "STOP", content: { parts: [{ thought: true, text: "private thought" }, { text }] }
}] });

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Gemini autocomplete", () => {
  it("streams complete words across fragmented UTF-8 and SSE boundaries", async () => {
    const events = [
      { candidates: [{ content: { parts: [{ thought: true, text: "hidden reasoning" }] } }] },
      { candidates: [{ content: { parts: [{ text: "Entró en la habitación y " }] } }] },
      { candidates: [{ content: { parts: [{ text: "esperó." }] }, finishReason: "STOP" }] }
    ];
    const bytes = new TextEncoder().encode(events.map((event) => `data: ${JSON.stringify(event)}\r\n\r\n`).join(""));
    const stream = new ReadableStream({ start(controller) {
      for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
      controller.close();
    } });
    const onPartial = vi.fn();
    expect(await readGeminiAutocompleteStream(new Response(stream), { ...request(), onPartial })).toBe("Entró en la habitación y esperó.");
    expect(onPartial).toHaveBeenCalledWith("Entró en la habitación ");
    expect(stableAutocompletePrefix("a partial")).toBe("");
  });

  it("discards streamed output without a successful finish", async () => {
    const stream = new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"candidates":[{"content":{"parts":[{"text":"a quiet room"}]},"finishReason":"MAX_TOKENS"}]}\n\n'));
      controller.close();
    } });
    expect(await readGeminiAutocompleteStream(new Response(stream), request())).toBe("");
  });
  it("sends a cancellable direct request with low thinking and returns only prose", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply());
    const input = request();
    expect(await generateGeminiAutocomplete("test-key", input, fetcher)).toBe("waited.");
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
    expect(init?.signal).toBe(input.signal);
    expect(init?.headers).toMatchObject({ "x-goog-api-key": "test-key" });
    const body = JSON.parse(init?.body as string);
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "low", includeThoughts: false });
    expect(body.systemInstruction.parts[0].text).toContain("Finish the current sentence");
    expect(body.tools).toBeUndefined();
  });

  it.each(["MAX_TOKENS", "SAFETY", "RECITATION"])("does not offer unfinished or blocked output (%s)", async (finishReason) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ candidates: [{
      finishReason, content: { parts: [{ text: "an unfinished" }] }
    }] }));
    expect(await generateGeminiAutocomplete("test-key", request(), fetcher)).toBe("");
  });

  it.each([[401, "invalid_api_key"], [429, "rate_limited"], [404, "model_not_found"], [503, "provider_unavailable"], [400, "provider_unavailable"]])(
    "maps HTTP %s without exposing provider content", async (status, code) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { message: "secret document" } }, { status: status as number }));
      await expect(generateGeminiAutocomplete("test-key", request(), fetcher)).rejects.toMatchObject({ agentError: { code } });
    }
  );

  it("recognizes Google's invalid-key reason on HTTP 400", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { details: [{ reason: "API_KEY_INVALID" }] } }, { status: 400 }));
    await expect(generateGeminiAutocomplete("test-key", request(), fetcher)).rejects.toMatchObject({ agentError: { code: "invalid_api_key" } });
  });

  it("returns an empty provider answer without inventing a suggestion", async () => {
    expect(await generateGeminiAutocomplete("test-key", request(), vi.fn().mockResolvedValue(reply("")))).toBe("");
  });

  it("propagates an in-flight timeout without retrying or leaking input", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
    }));
    const pending = generateGeminiAutocomplete("test-key", { ...request(), signal: controller.signal }, fetcher);
    const failed = expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
    controller.abort(new DOMException("Timed out", "TimeoutError"));
    await failed;
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("never starts an already canceled request", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const input = { ...request(), signal: AbortSignal.abort() };
    await expect(generateGeminiAutocomplete("test-key", input, fetcher)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("runs autocomplete on the saved Gemini key and reports it in the writing status", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GOOGLE_API_KEY", "");
    const directory = await mkdtemp(path.join(tmpdir(), "iliad-gemini-test-"));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply());
    const diagnostics = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), log: vi.fn(), flush: vi.fn(async () => undefined) };
    const service = new WritingAiService(directory, { fetchImpl: fetcher, diagnostics });
    try {
      await expect(service.autocompleteIdea(request())).rejects.toMatchObject({ agentError: { code: "missing_api_key" } });
      expect(fetcher).not.toHaveBeenCalled();
      await new WritingSettingsStore(directory).setGeminiApiKey("test-saved-key");
      expect(await service.autocompleteIdea(request())).toBe("waited.");
      expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({ "x-goog-api-key": "test-saved-key" });
      const status = await service.writingAssistStatus();
      expect(status).toMatchObject({
        autocomplete: { provider: "gemini-api", model: "gemini-3.8-flash", available: true },
        geminiKey: { hasKey: true, last4: "-key" }
      });
      expect(JSON.stringify(status)).not.toContain("test-saved-key");
    } finally {
      service.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
