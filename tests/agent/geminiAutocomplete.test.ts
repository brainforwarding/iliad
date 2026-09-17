import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateGeminiAutocomplete } from "../../electron/agent/geminiAutocomplete";
import { AgentService } from "../../electron/agent/agentService";
import { AgentSettingsStore } from "../../electron/agent/settingsStore";
import type { IdeaAutocompleteTextRequest } from "../../electron/agent/autocomplete";

const request = (): IdeaAutocompleteTextRequest => ({
  requestId: "test", language: "en", prefix: "She opened the door and ", suffix: "",
  headingPath: [], nearbyHeadings: [], documentTitle: "A story", trigger: "manual",
  suggestionKind: "sentence", allowApiFallback: false, signal: new AbortController().signal
});
const reply = (text = "waited.") => Response.json({ candidates: [{
  finishReason: "STOP", content: { parts: [{ thought: true, text: "private thought" }, { text }] }
}] });

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Gemini autocomplete", () => {
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

  it("never starts an already canceled request", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const input = { ...request(), signal: AbortSignal.abort() };
    await expect(generateGeminiAutocomplete("test-key", input, fetcher)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("uses a saved Gemini key ahead of Codex without changing the chat model or API opt-in", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GOOGLE_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    const directory = await mkdtemp(path.join(tmpdir(), "iliad-gemini-test-"));
    const service = new AgentService(directory);
    try {
      const store = new AgentSettingsStore(directory);
      const before = await store.snapshot();
      await store.update({ geminiApiKey: "test-saved-key" });
      expect(await store.snapshot()).toMatchObject({ hasGeminiApiKey: true, model: before.model });
      expect(JSON.stringify(await store.snapshot())).not.toContain("test-saved-key");
      const codex = vi.spyOn(service, "codexStatus").mockResolvedValue({ available: true, connected: true } as never);
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply());
      vi.stubGlobal("fetch", fetcher);
      expect(await service.autocompleteIdea(request())).toBe("waited.");
      expect(codex).not.toHaveBeenCalled();
      expect(await service.writingAssistStatus({ autocompleteApiFallbackEnabled: false })).toMatchObject({
        autocomplete: { provider: "gemini-api", model: "gemini-3.8-flash", available: true, apiFallbackEnabled: false }
      });
    } finally {
      await (service as unknown as { diagnostics: { flush(): Promise<void> } }).diagnostics.flush();
      service.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
