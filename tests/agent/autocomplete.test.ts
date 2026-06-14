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
    expect(autocompleteMaxOutputTokens("paragraph")).toBe(140);
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
