import { describe, expect, it } from "vitest";
import {
  AUTOCOMPLETE_TIMEOUT_MS,
  autocompleteModelInput,
  autocompleteInstructions,
  cleanAutocompleteOutput,
  autocompleteReasonFromAgentError
} from "../../electron/writing/autocomplete";

describe("agent autocomplete helpers", () => {
  it("keeps the autocomplete timeout", () => {
    expect(AUTOCOMPLETE_TIMEOUT_MS).toBe(18000);
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

  it("keeps a paragraph suggestion inside the list item at the cursor", () => {
    const list = "1. Formen parejas.\n2. Una persona habla.\n3. Quien escuchó resume.\n";
    // An empty item: the marker's period is not the end of a sentence.
    expect(cleanAutocompleteOutput("\n\nCambien de roles y repitan los pasos.", { prefix: `${list}4. `, suffix: "", suggestionKind: "paragraph" }))
      .toBe("Cambien de roles y repitan los pasos.");
    expect(cleanAutocompleteOutput("Cambien de roles.", { prefix: `${list}4.`, suffix: "", suggestionKind: "paragraph" }))
      .toBe(" Cambien de roles.");
    expect(cleanAutocompleteOutput("Cambien de roles.", { prefix: "- [ ] ", suffix: "", suggestionKind: "paragraph" }))
      .toBe("Cambien de roles.");
    // An item with text continues on the same line, never as a new paragraph.
    expect(cleanAutocompleteOutput("Luego cambian de roles.", { prefix: `${list}4. Repitan.`, suffix: "", suggestionKind: "paragraph" }))
      .toBe(" Luego cambian de roles.");
    // The model opening the next item starts a new line instead of joining item 3.
    expect(cleanAutocompleteOutput("4. La persona que habló confirma.\n5. Cambien de roles.", { prefix: `${list.trimEnd()}`, suffix: "", suggestionKind: "idea" }))
      .toBe("\n4. La persona que habló confirma.\n5. Cambien de roles.");
    expect(cleanAutocompleteOutput("4. La persona que habló confirma.", { prefix: `${list.trimEnd()}`, suffix: "", suggestionKind: "paragraph" }))
      .toBe("\n4. La persona que habló confirma.");
    expect(autocompleteInstructions("es", "paragraph")).toContain("elemento de lista");
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
      suggestionKind: "sentence"
    });

    expect(input).toContain("<<<PREFIX>>>");
    expect(input).toContain("The core idea is");
    expect(input).toContain("<<<SUFFIX>>>");
    expect(input).toContain("Notes > Draft");
    expect(input).not.toContain("Trigger:");
    expect(input).not.toContain("writing notes");
    expect(input).toContain("Suggestion kind: sentence");
  });

  it("uses separate instructions for sentence and paragraph suggestions", () => {
    expect(autocompleteInstructions("en")).toContain("at most 35 words");
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

  it("maps the Groq route's codes to their own reasons (Groq spec §5)", () => {
    const reason = (code: Parameters<typeof autocompleteReasonFromAgentError>[0]["code"]) =>
      autocompleteReasonFromAgentError({ code, userMessage: code, retryable: false }, false);
    expect(reason("free_quota_exhausted")).toBe("free_exhausted");
    expect(reason("free_global_cap")).toBe("free_exhausted");
    expect(reason("free_unavailable")).toBe("free_unavailable");
    expect(reason("client_outdated")).toBe("client_outdated");
    expect(reason("key_unreadable")).toBe("key_unreadable");
    expect(reason("invalid_api_key")).toBe("invalid_api_key");
    expect(reason("network_unreachable")).toBe("unreachable");
    expect(reason("dns_failure")).toBe("unreachable");
    expect(reason("provider_unavailable")).toBe("provider");
  });
});

describe("current-line echo (Groq Phase 0 finding 1)", () => {
  it("strips gpt-oss repeating the start of a Spanish dialogue line (dialogue-es fixture)", () => {
    const context = { prefix: "—Tú lo sabías.\n\n—Solo sabía que ", suffix: " —respondió él.", suggestionKind: "sentence" as const };
    expect(cleanAutocompleteOutput("Solo sabía que todo había cambiado", context)).toBe("todo había cambiado");
    expect(cleanAutocompleteOutput("solo sabía que todo había cambiado", context)).toBe("todo había cambiado");
    expect(cleanAutocompleteOutput("—Solo sabía que todo había cambiado", context)).toBe("todo había cambiado");
    expect(cleanAutocompleteOutput("todo había cambiado", context)).toBe("todo había cambiado");
  });

  it("strips the echo after list and quote markers, in paragraph mode too", () => {
    expect(cleanAutocompleteOutput("First we listen to each other.", { prefix: "Notes\n\n- First we ", suffix: "", suggestionKind: "sentence" }))
      .toBe("listen to each other.");
    expect(cleanAutocompleteOutput("Una persona cuenta lo que aprendió.", {
      prefix: "1. Formen parejas.\n2. Una persona ", suffix: "", suggestionKind: "paragraph"
    })).toBe("cuenta lo que aprendió.");
  });

  it("strips a restated previous line on a fresh line after a single break, not after a paragraph break", () => {
    const raw = "She climbed the stairs slowly, and each creak echoed her thoughts.";
    expect(cleanAutocompleteOutput(raw, { prefix: "Intro.\n\nShe climbed the stairs slowly, and\n", suffix: "", suggestionKind: "paragraph" }))
      .toBe("each creak echoed her thoughts.");
    // After a blank line (a new paragraph) the restatement is left to the model.
    expect(cleanAutocompleteOutput(raw, { prefix: "Intro.\n\nShe climbed the stairs slowly, and\n\n", suffix: "", suggestionKind: "paragraph" }))
      .toBe(raw);
  });

  it("leaves one-word lines and word-prefix matches alone", () => {
    // A single word on the line is not enough evidence of an echo.
    expect(cleanAutocompleteOutput("She said it again.", { prefix: "Intro.\n\nShe ", suffix: "", suggestionKind: "sentence" }))
      .toBe("She said it again.");
    // The line ends mid-word ("que"); output continuing with "quedó" is not an echo boundary.
    expect(cleanAutocompleteOutput("Solo sabía quedó claro", { prefix: "Intro.\n—Solo sabía que", suffix: "", suggestionKind: "sentence" }))
      .toBe(" Solo sabía quedó claro");
  });
});
