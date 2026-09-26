import { describe, expect, it } from "vitest";
import {
  AUTOCOMPLETE_MAX_AVOID_CHARS,
  AUTOCOMPLETE_MAX_DIRECTION_CHARS,
  AUTOCOMPLETE_MAX_HEADING_CHARS,
  AUTOCOMPLETE_MAX_PREFIX_CHARS,
  AUTOCOMPLETE_MAX_SUFFIX_CHARS,
  AUTOCOMPLETE_MAX_TITLE_CHARS,
  GROQ_MODEL,
  LATEST_PROMPT_VERSION,
  PROMPT_VERSIONS,
  TIGHTEN_MAX_INPUT_CHARS,
  TIGHTEN_MAX_INSTRUCTION_CHARS,
  buildWritingAiPrompt,
  groqChatCompletionBody,
  parseWritingAiTask,
  promptUtf8Bytes,
  utf8ByteLength,
  type AutocompleteTaskV1,
  type SelectionTaskV1
} from "../../../electron/writing/groq/prompts/index";
import { autocompleteInstructions as reexportedInstructions } from "../../../electron/writing/autocomplete";
import { normalizeTightenSelectionRange as reexportedRange, tightenModelInput as reexportedInput } from "../../../electron/writing/tighten";
import { autocompleteInstructions, normalizeTightenSelectionRange, tightenModelInput } from "../../../electron/writing/groq/prompts/v1";
import { ADVERSARIAL_FLAVORS, adversarialText, autocompleteCases, selectionCases } from "../../fixtures/writingCases";

const baseAutocomplete = autocompleteCases[0].task;
const baseSelection = selectionCases[0].task;

describe("prompt versions", () => {
  it("serves v1 as the newest version", () => {
    expect(LATEST_PROMPT_VERSION).toBe(1);
    expect(PROMPT_VERSIONS).toEqual([1]);
  });

  it("keeps autocomplete.ts and tighten.ts re-exporting the moved builders", () => {
    expect(reexportedInstructions).toBe(autocompleteInstructions);
    expect(reexportedInput).toBe(tightenModelInput);
    expect(reexportedRange).toBe(normalizeTightenSelectionRange);
  });
});

// Golden snapshots: v1 is frozen. If one of these changes, add v2.ts instead
// of editing v1 (spec §2). Keyed by v / task / kind-or-mode / language / case.
describe("v1 golden snapshots", () => {
  for (const { id, task } of autocompleteCases) {
    for (const extend of [false, true]) {
      it(`v1 autocomplete ${task.kind} ${task.language} ${id}${extend ? " extend" : ""}`, () => {
        const prompt = buildWritingAiPrompt({ ...task, extend, ...(extend ? { direction: "Keep it concrete", avoid: ["An earlier candidate."] } : {}) });
        expect(prompt).toMatchSnapshot();
      });
    }
  }

  for (const { id, task } of selectionCases) {
    it(`v1 selection ${task.mode} ${task.language} ${id}`, () => {
      expect(buildWritingAiPrompt(task)).toMatchSnapshot();
    });
  }
});

describe("budgets and caps", () => {
  it("pins the model and params in the chat-completions body", () => {
    const body = groqChatCompletionBody(buildWritingAiPrompt(baseAutocomplete));
    expect(body).toMatchObject({
      model: GROQ_MODEL,
      reasoning_effort: "low",
      include_reasoning: false,
      stream: true,
      stream_options: { include_usage: true },
      n: 1
    });
    expect(Object.keys(body).sort()).toEqual(
      ["include_reasoning", "max_completion_tokens", "messages", "model", "n", "reasoning_effort", "stream", "stream_options"]
    );
    expect(body.messages.map((message) => message.role)).toEqual(["system", "user"]);
  });

  it("uses per-kind completion budgets and output caps", () => {
    const kinds = (["sentence", "paragraph", "idea"] as const).map((kind) => buildWritingAiPrompt({ ...baseAutocomplete, kind }));
    expect(kinds.map((prompt) => prompt.maxOutputChars)).toEqual([420, 700, 2400]);
    expect(kinds[0].maxCompletionTokens).toBeLessThan(kinds[1].maxCompletionTokens);
    expect(kinds[1].maxCompletionTokens).toBeLessThan(kinds[2].maxCompletionTokens);
  });

  it("sizes a selection budget from the selected text, not the whole context", () => {
    const context = "x".repeat(3900);
    const small: SelectionTaskV1 = { ...baseSelection, mode: "edit", instruction: "warmer", text: `${context}short`, selection: { from: 3900, to: 3905 } };
    const whole: SelectionTaskV1 = { ...small, selection: { from: 0, to: 3905 } };
    expect(buildWritingAiPrompt(small).maxCompletionTokens).toBeLessThan(buildWritingAiPrompt(whole).maxCompletionTokens);
    expect(buildWritingAiPrompt(whole).maxCompletionTokens).toBe(4096);
    expect(buildWritingAiPrompt(small).maxOutputChars).toBe(400);
    expect(buildWritingAiPrompt({ ...small, text: "y".repeat(4000), selection: { from: 0, to: 4000 } }).maxOutputChars).toBe(12000);
    expect(buildWritingAiPrompt({ ...small, text: "y".repeat(4000), selection: { from: 0, to: 1000 } }).maxOutputChars).toBe(3000);
  });

  it("appends the gpt-oss output rule to the system prompt in both languages", () => {
    expect(buildWritingAiPrompt(baseAutocomplete).messages[0].content).toMatch(/ Reply with the insertion text only\. No quotes, no Markdown code fences, no commentary\.$/);
    expect(buildWritingAiPrompt({ ...baseAutocomplete, language: "es" }).messages[0].content).toMatch(/Responde solo con el texto a insertar\./);
    expect(buildWritingAiPrompt(baseSelection).messages[0].content).toMatch(/Reply with the rewritten text only\./);
  });

  it("counts UTF-8 bytes exactly (the reservation's input bound)", () => {
    const encoder = new TextEncoder();
    for (const flavor of ADVERSARIAL_FLAVORS) {
      const text = adversarialText(flavor, 500, 3);
      expect(text.length).toBe(500);
      expect(utf8ByteLength(text)).toBe(encoder.encode(text).length);
    }
    expect(utf8ByteLength("\ud800x")).toBe(encoder.encode("\ud800x").length);
    expect(utf8ByteLength("x\udc00")).toBe(encoder.encode("x\udc00").length);
    const prompt = buildWritingAiPrompt(baseSelection);
    expect(promptUtf8Bytes(prompt)).toBe(prompt.messages.reduce((sum, message) => sum + encoder.encode(message.content).length, 0));
  });
});

describe("parseWritingAiTask", () => {
  const accepts = (input: unknown) => expect(parseWritingAiTask(input).ok).toBe(true);
  const rejects = (input: unknown, field: string) => expect(parseWritingAiTask(input)).toEqual({ ok: false, field });

  it("accepts every fixture and round-trips it", () => {
    for (const { task } of [...autocompleteCases, ...selectionCases]) {
      expect(parseWritingAiTask(JSON.parse(JSON.stringify(task)))).toEqual({ ok: true, task });
    }
  });

  it("rejects unknown and unsupported versions as `v`", () => {
    rejects({ ...baseAutocomplete, v: 2 }, "v");
    rejects({ ...baseAutocomplete, v: "1" }, "v");
    rejects(null, "v");
    rejects([], "v");
  });

  it("rejects unknown fields, including the removed inline kind, trigger and guidance", () => {
    rejects({ ...baseAutocomplete, kind: "inline" }, "kind");
    rejects({ ...baseAutocomplete, trigger: "manual" }, "trigger");
    rejects({ ...baseAutocomplete, guidance: "notes" }, "guidance");
    rejects({ ...baseAutocomplete, messages: [] }, "messages");
    rejects({ ...baseSelection, model: "x" }, "model");
    rejects({ ...baseSelection, selection: { from: 0, to: 3, extra: 1 } }, "selection");
    rejects({ ...baseAutocomplete, task: "chat" }, "task");
  });

  it("enforces every autocomplete limit at ±1", () => {
    const at = (patch: Partial<AutocompleteTaskV1>) => ({ ...baseAutocomplete, ...patch });
    accepts(at({ prefix: "p".repeat(AUTOCOMPLETE_MAX_PREFIX_CHARS) }));
    rejects(at({ prefix: "p".repeat(AUTOCOMPLETE_MAX_PREFIX_CHARS + 1) }), "prefix");
    rejects(at({ prefix: "   " }), "prefix");
    accepts(at({ suffix: "s".repeat(AUTOCOMPLETE_MAX_SUFFIX_CHARS) }));
    rejects(at({ suffix: "s".repeat(AUTOCOMPLETE_MAX_SUFFIX_CHARS + 1) }), "suffix");
    accepts(at({ documentTitle: "t".repeat(AUTOCOMPLETE_MAX_TITLE_CHARS) }));
    rejects(at({ documentTitle: "t".repeat(AUTOCOMPLETE_MAX_TITLE_CHARS + 1) }), "documentTitle");
    accepts(at({ headingPath: Array(8).fill("h".repeat(AUTOCOMPLETE_MAX_HEADING_CHARS)) }));
    rejects(at({ headingPath: Array(9).fill("h") }), "headingPath");
    rejects(at({ nearbyHeadings: ["h".repeat(AUTOCOMPLETE_MAX_HEADING_CHARS + 1)] }), "nearbyHeadings");
    accepts(at({ direction: "d".repeat(AUTOCOMPLETE_MAX_DIRECTION_CHARS) }));
    rejects(at({ direction: "d".repeat(AUTOCOMPLETE_MAX_DIRECTION_CHARS + 1) }), "direction");
    accepts(at({ avoid: Array(3).fill("a".repeat(AUTOCOMPLETE_MAX_AVOID_CHARS)) }));
    rejects(at({ avoid: Array(4).fill("a") }), "avoid");
    rejects(at({ avoid: ["a".repeat(AUTOCOMPLETE_MAX_AVOID_CHARS + 1)] }), "avoid");
    rejects(at({ extend: "yes" as unknown as boolean }), "extend");
    rejects(at({ language: "fr" as "en" }), "language");
    rejects({ ...baseAutocomplete, direction: undefined }, "direction");
  });

  it("enforces every selection limit at ±1", () => {
    const at = (patch: Partial<SelectionTaskV1>) => ({ ...baseSelection, ...patch });
    const long = "t".repeat(TIGHTEN_MAX_INPUT_CHARS);
    accepts(at({ text: long, selection: { from: 0, to: long.length } }));
    rejects(at({ text: `${long}t`, selection: { from: 0, to: 1 } }), "text");
    rejects(at({ text: "  ", selection: { from: 0, to: 1 } }), "text");
    rejects(at({ selection: { from: 3, to: 3 } }), "selection");
    rejects(at({ selection: { from: -1, to: 3 } }), "selection");
    rejects(at({ selection: { from: 0, to: baseSelection.text.length + 1 } }), "selection");
    rejects(at({ selection: { from: 0.5, to: 3 } }), "selection");
    accepts(at({ mode: "edit", instruction: "i".repeat(TIGHTEN_MAX_INSTRUCTION_CHARS) }));
    rejects(at({ mode: "edit", instruction: "i".repeat(TIGHTEN_MAX_INSTRUCTION_CHARS + 1) }), "instruction");
    rejects(at({ mode: "edit" }), "instruction");
    rejects(at({ mode: "tighten", instruction: "shorter" }), "instruction");
  });

  it("accepts a max-size CJK request (every field at its limit)", () => {
    const cjk = (n: number) => adversarialText("cjk", n);
    accepts({
      ...baseAutocomplete,
      kind: "idea",
      prefix: cjk(AUTOCOMPLETE_MAX_PREFIX_CHARS),
      suffix: cjk(AUTOCOMPLETE_MAX_SUFFIX_CHARS),
      documentTitle: cjk(AUTOCOMPLETE_MAX_TITLE_CHARS),
      headingPath: Array(8).fill(cjk(AUTOCOMPLETE_MAX_HEADING_CHARS)),
      nearbyHeadings: Array(8).fill(cjk(AUTOCOMPLETE_MAX_HEADING_CHARS)),
      direction: cjk(AUTOCOMPLETE_MAX_DIRECTION_CHARS),
      avoid: Array(3).fill(cjk(AUTOCOMPLETE_MAX_AVOID_CHARS))
    });
  });
});
