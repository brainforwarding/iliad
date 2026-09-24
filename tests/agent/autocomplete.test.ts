import { describe, expect, it } from "vitest";
import {
  AUTOCOMPLETE_API_MODEL,
  AUTOCOMPLETE_CODEX_MODEL_PREFERENCES,
  AUTOCOMPLETE_TIMEOUT_MS,
  autocompleteModelInput,
  autocompleteInstructions,
  cleanAutocompleteOutput,
  autocompleteReasonFromAgentError,
  autocompleteMaxOutputTokens
} from "../../electron/agent/autocomplete";
import { AgentRuntimeError } from "../../electron/agent/errors";
import { nextAutocompleteProviderIndex } from "../../electron/agent/agentService";

describe("agent autocomplete helpers", () => {
  it("uses fast autocomplete-specific models before the general chat model", () => {
    expect(AUTOCOMPLETE_CODEX_MODEL_PREFERENCES).toEqual(["gpt-5.4-mini", "gpt-5.3-codex-spark"]);
    expect(AUTOCOMPLETE_API_MODEL).toBe("gpt-5.4-mini");
    expect(AUTOCOMPLETE_TIMEOUT_MS).toBe(18000);
    expect(autocompleteMaxOutputTokens()).toBe(48);
    expect(autocompleteMaxOutputTokens("paragraph")).toBe(180);
    expect(autocompleteMaxOutputTokens("sentence")).toBe(80);
    expect(autocompleteMaxOutputTokens("idea")).toBe(700);
  });

  it("asks a full idea to finish the section without headings, and extensions to continue the draft", () => {
    const idea = autocompleteInstructions("en", "idea");
    expect(idea).toContain("until the current idea is complete");
    expect(idea).toContain("Never write headings");
    expect(idea).not.toContain("unaccepted");
    expect(autocompleteInstructions("es", "idea", true)).toContain("borrador que el autor aún no acepta");
    expect(autocompleteInstructions("en", "paragraph", true)).toContain("Do not start a new paragraph");
    expect(autocompleteInstructions("en", "paragraph")).toContain("start the next paragraph");
  });

  it("keeps a multi-paragraph idea, but rejects headings and code fences", () => {
    const prefix = "Al terminar, cada pareja comparte una frase.";
    expect(cleanAutocompleteOutput("Luego conversan.\n\n- Duración: 20 minutos.\n- Variación: tríos.", { prefix, suffix: "", suggestionKind: "idea" }))
      .toBe("\n\nLuego conversan.\n\n- Duración: 20 minutos.\n- Variación: tríos.");
    expect(cleanAutocompleteOutput("Luego conversan.\n\n## Cierre\nFin.", { prefix, suffix: "", suggestionKind: "idea" })).toBe("");
    expect(cleanAutocompleteOutput("Luego:\n```\ncode\n```", { prefix, suffix: "", suggestionKind: "idea" })).toBe("");
    expect(cleanAutocompleteOutput("x".repeat(2401), { prefix, suffix: "", suggestionKind: "idea" })).toBe("");
  });

  it("continues an extended draft inline unless the model starts a new block", () => {
    const prefix = "She walked into the quiet room";
    expect(cleanAutocompleteOutput("with the lamps off.", { prefix, suffix: "", suggestionKind: "paragraph", extend: true }))
      .toBe(" with the lamps off.");
    expect(cleanAutocompleteOutput("First.\n\nSecond.", { prefix, suffix: "", suggestionKind: "paragraph", extend: true })).toBe("");
    expect(cleanAutocompleteOutput("and waited.\n\nLater, she left.", { prefix, suffix: "", suggestionKind: "idea", extend: true }))
      .toBe(" and waited.\n\nLater, she left.");
    expect(cleanAutocompleteOutput("\n\nLater, she left.", { prefix: `${prefix}.`, suffix: "", suggestionKind: "idea", extend: true }))
      .toBe("\n\nLater, she left.");
  });

  it("builds bounded fill-in-the-middle input without chat framing", () => {
    const input = autocompleteModelInput({
      requestId: "request-1",
      language: "en",
      prefix: "The core idea is",
      suffix: " when the draft settles.",
      headingPath: ["Notes", "Draft"],
      documentTitle: "memo",
      nearbyHeadings: ["Draft"],
      trigger: "automatic",
      suggestionKind: "inline"
    });

    expect(input).toContain("<<<PREFIX>>>");
    expect(input).toContain("The core idea is");
    expect(input).toContain("<<<SUFFIX>>>");
    expect(input).toContain("Notes > Draft");
    expect(input).toContain("Trigger: automatic");
    expect(input).toContain("Suggestion kind: inline");
  });

  it("uses separate instructions for short inline and explicit paragraph suggestions", () => {
    expect(autocompleteInstructions("en")).toContain("3 to 15 words");
    expect(autocompleteInstructions("en", "paragraph")).toContain("one short paragraph");
    expect(autocompleteInstructions("es", "paragraph")).toContain("un solo párrafo");
  });

  it("cleans terse insertions and rejects noisy outputs", () => {
    expect(cleanAutocompleteOutput(" easier to see.", { prefix: "The result is", suffix: "" })).toBe(" easier to see.");
    expect(cleanAutocompleteOutput("easier to see.", { prefix: "The result is", suffix: "" })).toBe(" easier to see.");
    expect(cleanAutocompleteOutput("```md\nbad\n```", { prefix: "The result is", suffix: "" })).toBe("");
    expect(cleanAutocompleteOutput("first line\nsecond line", { prefix: "The result is", suffix: "" })).toBe("");
    expect(cleanAutocompleteOutput("Here is a suggestion.", { prefix: "The result is", suffix: "" })).toBe("");
    expect(cleanAutocompleteOutput(" when the draft settles.", { prefix: "The result is", suffix: " when the draft settles." })).toBe("");
  });

  it("allows explicit paragraph suggestions while rejecting multi-paragraph noise", () => {
    expect(
      cleanAutocompleteOutput("The next point develops the idea in a measured way.", {
        prefix: "The result is clear.",
        suffix: "",
        suggestionKind: "paragraph"
      })
    ).toBe("\n\nThe next point develops the idea in a measured way.");
    expect(
      cleanAutocompleteOutput("The next point develops the idea.\n\nA second paragraph is too much.", {
        prefix: "The result is clear.",
        suffix: "",
        suggestionKind: "paragraph"
      })
    ).toBe("");
    expect(
      cleanAutocompleteOutput("# New section", {
        prefix: "The result is clear.",
        suffix: "",
        suggestionKind: "paragraph"
      })
    ).toBe("");
  });

  it("spaces the next sentence and finishes an incomplete thought before expanding it", () => {
    expect(cleanAutocompleteOutput("She waited.", { prefix: "The door opened.", suffix: "", suggestionKind: "sentence" }))
      .toBe(" She waited.");
    expect(cleanAutocompleteOutput("quiet. She waited.", { prefix: "The room was", suffix: "", suggestionKind: "paragraph" }))
      .toBe(" quiet. She waited.");
    expect(autocompleteInstructions("es", "sentence")).toContain("Conserva el idioma del texto");
  });

  it("maps provider errors to autocomplete reasons", () => {
    expect(
      autocompleteReasonFromAgentError(
        {
          code: "rate_limited",
          userMessage: "rate limited",
          retryable: true
        },
        false
      )
    ).toBe("rate_limited");
    expect(
      autocompleteReasonFromAgentError(
        {
          code: "request_canceled",
          userMessage: "canceled",
          retryable: false
        },
        false
      )
    ).toBe("aborted");
    expect(
      autocompleteReasonFromAgentError(
        {
          code: "provider_unavailable",
          userMessage: "unavailable",
          retryable: true
        },
        true
      )
    ).toBe("timeout");
  });

  it("skips same-provider model retries for transient Codex autocomplete failures before API fallback", () => {
    const codex = { metadata: { id: "codex-app-server" } };
    const api = { metadata: { id: "openai-responses" } };
    const candidates = [
      { provider: codex, model: "gpt-5.4-mini" },
      { provider: codex, model: "gpt-5.3-codex-spark" },
      { provider: api, model: "gpt-5.4-mini" }
    ];

    expect(
      nextAutocompleteProviderIndex(
        new AgentRuntimeError({
            code: "provider_unavailable",
            userMessage: "provider unavailable",
            retryable: true
        }),
        candidates as never,
        0
      )
    ).toBe(2);
  });

  it("retries the next Codex autocomplete model only for model-specific failures", () => {
    const codex = { metadata: { id: "codex-app-server" } };
    const api = { metadata: { id: "openai-responses" } };
    const candidates = [
      { provider: codex, model: "gpt-5.4-mini" },
      { provider: codex, model: "gpt-5.3-codex-spark" },
      { provider: api, model: "gpt-5.4-mini" }
    ];

    expect(
      nextAutocompleteProviderIndex(
        new AgentRuntimeError({
            code: "model_not_found",
            userMessage: "model not found",
            retryable: false
        }),
        candidates as never,
        0
      )
    ).toBe(1);
    expect(
      nextAutocompleteProviderIndex(
        new AgentRuntimeError({
            code: "request_canceled",
            userMessage: "canceled",
            retryable: false
        }),
        candidates as never,
        0
      )
    ).toBe(-1);
  });
});
