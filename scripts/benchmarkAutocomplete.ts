// Groq writing-AI benchmark and Phase 0 budget probes.
// Spec: specs/2026-09-25-groq-ai-free-tier.md, "Benchmark" and "Phased plan".
//
//   npm run benchmark:autocomplete -- [--dry-run] [--trials=N] [--samples]
//   npm run benchmark:autocomplete -- --budget-probe [--dry-run]
//   npm run benchmark:autocomplete -- --context [--dry-run] [--trials=N] [--only=a,b] [--samples]
//
// --context: paired prompt v2 / v3 runs per case (alternating order; specs
// 2026-09-27-ai-context-and-preferences.md and
// 2026-09-27-writing-rules-prompt-v3.md, Review "Benchmark"): late cursor in a
// long document, an extended draft, ✦ AI edits, Spanish under both app
// languages, max-byte Unicode, the shared EN/ES fixtures (sentence, paragraph,
// idea, tighten, edit) and synthetic bait cases (unsupported causal claim,
// generic opening, inflated ending, three-part rhetoric). Reports body bytes,
// prompt tokens, time to first token, completion time, finish reasons,
// cleaner/guard rejections, raw/cleaned length, em dashes, semicolons, a
// colon heuristic and stock phrases, plus short samples (synthetic fixture
// text only; --samples adds full texts as shuffled, blinded A/B pairs).
//
// Route: direct to Groq with GROQ_API_KEY (environment, or the git-ignored
// repo-root .env.local). The key is never printed. The proxy route
// (ILIAD_AI_PROXY_URL) arrives with the Worker (Phase 2).
//
// Output is JSON: timings, finish reasons, usage and cost. No prose, unless
// --samples is passed (synthetic fixture text only, for hand-checking quality).

import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { cleanAutocompleteOutput } from "../electron/writing/autocomplete";
import { normalizeAgentError } from "../electron/writing/errors";
import { stableAutocompletePrefix } from "../electron/writing/groq/partials";
import { streamGroqChatCompletion, streamGroqPrompt, type GroqStreamResult } from "../electron/writing/groq/client";
import {
  AUTOCOMPLETE_MAX_AVOID_CHARS,
  AUTOCOMPLETE_MAX_AVOID_COUNT,
  AUTOCOMPLETE_MAX_DIRECTION_CHARS,
  AUTOCOMPLETE_MAX_HEADING_CHARS,
  AUTOCOMPLETE_MAX_HEADING_COUNT,
  AUTOCOMPLETE_MAX_PREFIX_CHARS,
  AUTOCOMPLETE_MAX_SUFFIX_CHARS,
  AUTOCOMPLETE_MAX_TITLE_CHARS,
  GROQ_PINNED_PARAMS,
  LATEST_PROMPT_VERSION,
  MIN_PROMPT_OVERHEAD_TOKENS,
  WRITING_AI_MAX_TASK_BYTES,
  WRITING_PREFERENCES_MAX_CHARS,
  TIGHTEN_MAX_INPUT_CHARS,
  TIGHTEN_MAX_INSTRUCTION_CHARS,
  buildWritingAiPrompt,
  groqChatCompletionBody,
  parseWritingAiTask,
  promptUtf8Bytes,
  type WritingAiPrompt,
  type WritingAiTask,
  type WritingAiTaskV1
} from "../electron/writing/groq/prompts/index";
import { containsReasoningMarkers } from "../electron/writing/groq/sse";
import {
  cleanTightenOutput,
  looksLikePreambleEcho,
  looksLikeReferenceEcho,
  looksLikeTightenContextEcho,
  referenceTextForEchoCheck,
  tightenSelectedText
} from "../electron/writing/tighten";
import { buildAutocompleteTask, buildSelectionTask, type AutocompleteTaskInput, type SelectionTaskInput } from "../electron/writing/aiTasks";
import { buildAutocompleteContext } from "../src/editor/writingAssistContext";
import { ADVERSARIAL_FLAVORS, adversarialText, autocompleteCases, selectionCases } from "../tests/fixtures/writingCases";

// Groq list prices for openai/gpt-oss-120b (USD per token), as in the spec's cost model.
const INPUT_USD_PER_TOKEN = 0.15 / 1_000_000;
const OUTPUT_USD_PER_TOKEN = 0.6 / 1_000_000;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const budgetProbe = args.includes("--budget-probe");
const contextMode = args.includes("--context");
const onlyCases = args.find((arg) => arg.startsWith("--only="))?.split("=")[1]?.split(",").filter(Boolean) ?? null;
const showSamples = args.includes("--samples");
const trials = Math.min(10, Math.max(1, Number(args.find((arg) => arg.startsWith("--trials="))?.split("=")[1] ?? (contextMode ? 5 : 3)) || 3));

function readGroqKey(): string | null {
  if (process.env.GROQ_API_KEY?.trim()) return process.env.GROQ_API_KEY.trim();
  try {
    const envFile = fs.readFileSync(path.resolve(process.cwd(), ".env.local"), "utf8");
    const match = /^\s*(?:export\s+)?GROQ_API_KEY\s*=\s*["']?([^"'\s#]+)/m.exec(envFile);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** One streamed request with a few polite retries on Groq 429 (TPM). */
async function withRetry<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      const agentError = normalizeAgentError(error);
      if (agentError.code !== "rate_limited" || attempt >= 4) throw error;
      await sleep(15_000 * (attempt + 1));
    }
  }
}

const cost = (result: GroqStreamResult) =>
  result.usage ? result.usage.promptTokens * INPUT_USD_PER_TOKEN + result.usage.completionTokens * OUTPUT_USD_PER_TOKEN : null;

const percentile = (values: number[], p: number) =>
  values.length ? Math.round([...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * p) - 1)]) : null;

interface Row {
  case: string;
  kind: string;
  language: string;
  trial: number;
  error?: string;
  firstDeltaMs?: number | null;
  firstVisibleMs?: number | null;
  completeMs?: number;
  finishReason?: string | null;
  accepted?: boolean;
  outputChars?: number;
  reasoningLeak?: boolean;
  reasoningFieldChars?: number;
  promptTokens?: number;
  completionTokens?: number;
  reasoningTokens?: number | null;
  maxCompletionTokens?: number;
  promptBytes?: number;
  costUsd?: number | null;
  sample?: string;
}

async function runTask(apiKey: string, id: string, task: WritingAiTaskV1, trial: number): Promise<Row> {
  const prompt = buildWritingAiPrompt(task);
  const kind = task.task === "autocomplete" ? task.kind : task.mode;
  const base = { case: id, kind, language: task.language, trial, maxCompletionTokens: prompt.maxCompletionTokens, promptBytes: promptUtf8Bytes(prompt) };
  const started = performance.now();
  let firstVisibleMs: number | null = null;

  try {
    const result = await withRetry(() =>
      streamGroqPrompt({
        apiKey,
        prompt,
        signal: AbortSignal.timeout(task.task === "autocomplete" && task.kind === "idea" ? 30_000 : 30_000),
        now: () => performance.now(),
        onDelta: (_delta, text) => {
          // Mirrors the app: stable-word partials go through the cleaner before they show.
          if (firstVisibleMs !== null || task.task !== "autocomplete") return;
          const stable = stableAutocompletePrefix(text);
          if (stable && cleanAutocompleteOutput(stable, { prefix: task.prefix, suffix: task.suffix, suggestionKind: task.kind, extend: task.extend })) {
            firstVisibleMs = performance.now() - started;
          }
        }
      })
    );
    const completeMs = performance.now() - started;
    let cleaned = "";
    if (result.finishReason === "stop" && !containsReasoningMarkers(result.text)) {
      if (task.task === "autocomplete") {
        cleaned = cleanAutocompleteOutput(result.text, { prefix: task.prefix, suffix: task.suffix, suggestionKind: task.kind, extend: task.extend });
      } else {
        const selected = tightenSelectedText(task.text, task.selection);
        const rewrite = cleanTightenOutput(result.text, selected);
        cleaned = rewrite.trim() && !looksLikePreambleEcho(rewrite, selected) && !looksLikeTightenContextEcho(rewrite, task.text, task.selection) ? rewrite : "";
      }
    }
    return {
      ...base,
      firstDeltaMs: result.firstDeltaMs === null ? null : Math.round(result.firstDeltaMs),
      // A selection rewrite lands whole; an autocomplete that never streamed a stable partial shows at completion.
      firstVisibleMs: Math.round(firstVisibleMs ?? (cleaned ? completeMs : NaN)) || null,
      completeMs: Math.round(completeMs),
      finishReason: result.finishReason,
      accepted: Boolean(cleaned),
      outputChars: result.text.length,
      reasoningLeak: containsReasoningMarkers(result.text),
      reasoningFieldChars: result.reasoningChars,
      promptTokens: result.usage?.promptTokens,
      completionTokens: result.usage?.completionTokens,
      reasoningTokens: result.usage?.reasoningTokens ?? null,
      costUsd: cost(result),
      ...(showSamples ? { sample: cleaned || `[rejected] ${result.text}` } : {})
    };
  } catch (error) {
    return { ...base, error: normalizeAgentError(error).code };
  }
}

function summarize(rows: Row[]) {
  const groups = new Map<string, Row[]>();
  for (const row of rows) groups.set(row.kind, [...(groups.get(row.kind) ?? []), row]);
  return [...groups].map(([kind, samples]) => {
    const ok = samples.filter((row) => !row.error);
    const finishReasons: Record<string, number> = {};
    for (const row of ok) finishReasons[String(row.finishReason)] = (finishReasons[String(row.finishReason)] ?? 0) + 1;
    const nums = (pick: (row: Row) => number | null | undefined) => ok.map(pick).filter((value): value is number => typeof value === "number");
    return {
      kind,
      samples: samples.length,
      errors: samples.length - ok.length,
      accepted: ok.filter((row) => row.accepted).length,
      finishReasons,
      reasoningLeaks: ok.filter((row) => row.reasoningLeak).length,
      reasoningFieldCharsTotal: nums((row) => row.reasoningFieldChars).reduce((a, b) => a + b, 0),
      firstDeltaP50: percentile(nums((row) => row.firstDeltaMs), 0.5),
      firstDeltaP95: percentile(nums((row) => row.firstDeltaMs), 0.95),
      firstVisibleP50: percentile(nums((row) => row.firstVisibleMs), 0.5),
      firstVisibleP95: percentile(nums((row) => row.firstVisibleMs), 0.95),
      completeP50: percentile(nums((row) => row.completeMs), 0.5),
      completeP95: percentile(nums((row) => row.completeMs), 0.95),
      completionTokensMax: Math.max(0, ...nums((row) => row.completionTokens)),
      completionTokensP50: percentile(nums((row) => row.completionTokens), 0.5),
      reasoningTokensMax: Math.max(0, ...nums((row) => row.reasoningTokens)),
      reasoningTokensP50: percentile(nums((row) => row.reasoningTokens), 0.5),
      budget: Math.max(0, ...nums((row) => row.maxCompletionTokens)),
      overBudget: ok.filter((row) => (row.completionTokens ?? 0) > (row.maxCompletionTokens ?? Infinity)).length,
      meanCostUsd: nums((row) => row.costUsd).length ? Number((nums((row) => row.costUsd).reduce((a, b) => a + b, 0) / nums((row) => row.costUsd).length).toFixed(6)) : null
    };
  });
}

async function benchmark(apiKey: string) {
  const cases: Array<{ id: string; task: WritingAiTaskV1 }> = [...autocompleteCases, ...selectionCases];
  const rows: Row[] = [];
  for (let trial = 0; trial < trials; trial += 1) {
    for (const { id, task } of trial % 2 ? [...cases].reverse() : cases) {
      rows.push(await runTask(apiKey, id, task, trial));
    }
  }
  return { summary: summarize(rows), rows };
}

// ---------------------------------------------------------------------------
// Phase 0 budget probes.

/** Billed prompt tokens minus UTF-8 bytes of the message contents. */
async function probePrompt(apiKey: string, label: string, prompt: WritingAiPrompt, maxCompletionTokens = 16) {
  const result = await withRetry(() =>
    streamGroqChatCompletion({
      apiKey,
      body: groqChatCompletionBody({ ...prompt, maxCompletionTokens }),
      maxOutputChars: 100_000,
      signal: AbortSignal.timeout(60_000)
    })
  );
  const bytes = promptUtf8Bytes(prompt);
  return {
    label,
    bytes,
    promptTokens: result.usage?.promptTokens ?? null,
    overhead: result.usage ? result.usage.promptTokens - bytes : null,
    completionTokens: result.usage?.completionTokens ?? null,
    maxCompletionTokens,
    finishReason: result.finishReason,
    reasoningLeak: containsReasoningMarkers(result.text)
  };
}

function maxAutocompleteTask(flavor: (typeof ADVERSARIAL_FLAVORS)[number], seed: number): WritingAiTask {
  const text = (chars: number, salt: number) => adversarialText(flavor, chars, seed * 31 + salt);
  const task: WritingAiTask = {
    v: 1,
    task: "autocomplete",
    language: "en",
    kind: "idea",
    extend: true,
    prefix: text(AUTOCOMPLETE_MAX_PREFIX_CHARS, 1),
    suffix: text(AUTOCOMPLETE_MAX_SUFFIX_CHARS, 2),
    documentTitle: text(AUTOCOMPLETE_MAX_TITLE_CHARS, 3),
    headingPath: Array.from({ length: AUTOCOMPLETE_MAX_HEADING_COUNT }, (_, index) => text(AUTOCOMPLETE_MAX_HEADING_CHARS, 10 + index)),
    nearbyHeadings: Array.from({ length: AUTOCOMPLETE_MAX_HEADING_COUNT }, (_, index) => text(AUTOCOMPLETE_MAX_HEADING_CHARS, 20 + index)),
    direction: text(AUTOCOMPLETE_MAX_DIRECTION_CHARS, 4),
    avoid: Array.from({ length: AUTOCOMPLETE_MAX_AVOID_COUNT }, (_, index) => text(AUTOCOMPLETE_MAX_AVOID_CHARS, 30 + index))
  };
  if (!parseWritingAiTask(task).ok) throw new Error(`probe task invalid: ${flavor}`);
  return task;
}

function maxSelectionTask(flavor: (typeof ADVERSARIAL_FLAVORS)[number], seed: number): WritingAiTask {
  const text = adversarialText(flavor, TIGHTEN_MAX_INPUT_CHARS, seed * 17 + 5);
  const task: WritingAiTask = {
    v: 1,
    task: "selection",
    language: "es",
    mode: "edit",
    instruction: adversarialText(flavor, TIGHTEN_MAX_INSTRUCTION_CHARS, seed * 17 + 6),
    text,
    selection: { from: 0, to: text.length }
  };
  if (!parseWritingAiTask(task).ok) throw new Error(`probe task invalid: ${flavor}`);
  return task;
}

const V3_MAX_FLAVORS = ["cjk", "emoji-zwj", "random", "ascii-noise"] as const satisfies ReadonlyArray<(typeof ADVERSARIAL_FLAVORS)[number]>;

/** The largest v2/v3 completion main can build: every field at its limit, a document far over the byte budget. */
function maxContextAutocompleteTask(flavor: (typeof ADVERSARIAL_FLAVORS)[number], version: 2 | 3): WritingAiTask {
  const text = (chars: number, salt: number) => adversarialText(flavor, chars, 97 + salt);
  const documentText = text(60_000, 1);
  const cursor = Math.floor(documentText.length * 0.7);
  const task = buildAutocompleteTask(version, {
    language: "en",
    kind: "idea",
    extend: false,
    prefix: documentText.slice(cursor - AUTOCOMPLETE_MAX_PREFIX_CHARS, cursor),
    suffix: documentText.slice(cursor, cursor + AUTOCOMPLETE_MAX_SUFFIX_CHARS),
    documentTitle: text(AUTOCOMPLETE_MAX_TITLE_CHARS, 3),
    headingPath: Array.from({ length: AUTOCOMPLETE_MAX_HEADING_COUNT }, (_, index) => text(AUTOCOMPLETE_MAX_HEADING_CHARS, 10 + index)),
    nearbyHeadings: [],
    direction: text(AUTOCOMPLETE_MAX_DIRECTION_CHARS, 4),
    avoid: Array.from({ length: AUTOCOMPLETE_MAX_AVOID_COUNT }, (_, index) => text(AUTOCOMPLETE_MAX_AVOID_CHARS, 30 + index)),
    document: { text: documentText, cursor },
    preferences: text(WRITING_PREFERENCES_MAX_CHARS, 5).trim()
  });
  const parsed = parseWritingAiTask(task);
  if (!parsed.ok) throw new Error(`probe task invalid: ${flavor} (${parsed.field})`);
  return parsed.task;
}

function maxContextSelectionTask(flavor: (typeof ADVERSARIAL_FLAVORS)[number], version: 2 | 3): WritingAiTask {
  const documentText = adversarialText(flavor, 60_000, 211);
  const from = Math.floor(documentText.length / 2);
  const text = documentText.slice(from, from + TIGHTEN_MAX_INPUT_CHARS);
  const task = buildSelectionTask(version, {
    language: "es",
    mode: "edit",
    instruction: adversarialText(flavor, TIGHTEN_MAX_INSTRUCTION_CHARS, 212),
    text,
    selection: { from: 0, to: text.length },
    document: { text: documentText, selectionFrom: from, selectionTo: from + text.length },
    preferences: adversarialText(flavor, WRITING_PREFERENCES_MAX_CHARS, 213).trim()
  });
  const parsed = parseWritingAiTask(task);
  if (!parsed.ok) throw new Error(`probe task invalid: ${flavor} (${parsed.field})`);
  if (Buffer.byteLength(JSON.stringify(parsed.task), "utf8") > WRITING_AI_MAX_TASK_BYTES) throw new Error("over the task budget");
  return parsed.task;
}

const REASONING_HEAVY: WritingAiPrompt = {
  messages: [
    { role: "system", content: "Answer with the final number only." },
    {
      role: "user",
      content:
        "A train leaves at 09:17 and travels 413 km at 87 km/h, stops for 23 minutes, then 219 km at 94 km/h. Another leaves at 10:02 at 101 km/h over the same 632 km without stopping. Which arrives first, and by how many seconds? Then compute the product of those seconds and the number of primes below 200."
    }
  ],
  maxCompletionTokens: 0,
  maxOutputChars: 100_000
};

async function budgetProbes(apiKey: string) {
  // (b) Fixed overhead: near-empty messages, then every fixture per task/kind/version.
  const overhead = [];
  overhead.push(await probePrompt(apiKey, "minimal", { messages: [{ role: "system", content: "" }, { role: "user", content: "x" }], maxCompletionTokens: 16, maxOutputChars: 1 }));
  for (const { id, task } of [...autocompleteCases, ...selectionCases]) {
    overhead.push(await probePrompt(apiKey, `v${task.v}:${id}`, buildWritingAiPrompt(task)));
  }

  // The same fixtures and the context/bait cases as the v2 and v3 tasks the app builds (v3's longer system prompt).
  for (const entry of contextCases({ all: true }).filter((item) => !item.id.startsWith("unicode") && !item.id.startsWith("edit-unicode"))) {
    for (const version of [2, 3] as const) {
      overhead.push(await probePrompt(apiKey, `v${version}:${entry.id}`, buildWritingAiPrompt(contextTask(entry, version))));
    }
  }

  // (c) Adversarial Unicode, every field at its maximum (v1), and the largest
  // v3 bodies main can build (56 KiB task, preferences at their limit).
  const adversarial = [];
  for (const flavor of ADVERSARIAL_FLAVORS) {
    adversarial.push(await probePrompt(apiKey, `v1:autocomplete-idea-max:${flavor}`, buildWritingAiPrompt(maxAutocompleteTask(flavor, 1))));
    adversarial.push(await probePrompt(apiKey, `v1:selection-edit-max:${flavor}`, buildWritingAiPrompt(maxSelectionTask(flavor, 1))));
  }
  for (const flavor of V3_MAX_FLAVORS) {
    adversarial.push(await probePrompt(apiKey, `v3:autocomplete-idea-max:${flavor}`, buildWritingAiPrompt(maxContextAutocompleteTask(flavor, 3))));
    adversarial.push(await probePrompt(apiKey, `v3:selection-edit-max:${flavor}`, buildWritingAiPrompt(maxContextSelectionTask(flavor, 3))));
  }

  // (a) max_completion_tokens bounds reasoning + content, on a reasoning-heavy prompt.
  const reasoningBudget = [];
  for (const budget of [8, 16, 32, 64, 128, 256]) {
    reasoningBudget.push(await probePrompt(apiKey, `reasoning-heavy@${budget}`, REASONING_HEAVY, budget));
  }
  // Same budget with reasoning explicitly included: reasoning must arrive outside `content`.
  const included = await withRetry(() =>
    streamGroqChatCompletion({
      apiKey,
      body: { ...groqChatCompletionBody({ ...REASONING_HEAVY, maxCompletionTokens: 2048 }), include_reasoning: true },
      maxOutputChars: 100_000,
      signal: AbortSignal.timeout(60_000)
    })
  );
  const reasoningIncluded = {
    finishReason: included.finishReason,
    reasoningFieldChars: included.reasoningChars,
    reasoningTokens: included.usage?.reasoningTokens ?? null,
    completionTokens: included.usage?.completionTokens ?? null,
    contentChars: included.text.length,
    reasoningLeak: containsReasoningMarkers(included.text)
  };
  const excluded = await withRetry(() =>
    streamGroqChatCompletion({
      apiKey,
      body: groqChatCompletionBody({ ...REASONING_HEAVY, maxCompletionTokens: 2048 }),
      maxOutputChars: 100_000,
      signal: AbortSignal.timeout(60_000)
    })
  );
  const reasoningExcluded = {
    finishReason: excluded.finishReason,
    reasoningFieldChars: excluded.reasoningChars,
    reasoningTokens: excluded.usage?.reasoningTokens ?? null,
    completionTokens: excluded.usage?.completionTokens ?? null,
    contentChars: excluded.text.length,
    reasoningLeak: containsReasoningMarkers(excluded.text)
  };

  const allPrompt = [...overhead, ...adversarial];
  const maxOverhead = Math.max(...allPrompt.map((row) => row.overhead ?? -Infinity));
  const minimalOverhead = overhead[0].overhead ?? NaN;
  const measuredOverhead = Math.max(maxOverhead, minimalOverhead);
  const allBudgeted = [...allPrompt, ...reasoningBudget];

  const configuredOverheadFails = allPrompt.filter((row) => row.promptTokens === null || row.promptTokens > row.bytes + MIN_PROMPT_OVERHEAD_TOKENS);

  return {
    promptVersions: "1 (fixtures, max fields), 2 and 3 (fixtures, context and bait cases), 3 (max bodies)",
    latestPromptVersion: LATEST_PROMPT_VERSION,
    params: GROQ_PINNED_PARAMS,
    gates: {
      a_completionBoundsReasoning: {
        pass: allBudgeted.every((row) => row.completionTokens !== null && row.completionTokens <= row.maxCompletionTokens),
        overBudget: allBudgeted.filter((row) => (row.completionTokens ?? Infinity) > row.maxCompletionTokens).map((row) => row.label),
        smallBudgetsEndInLength: reasoningBudget.filter((row) => row.maxCompletionTokens <= 64).every((row) => row.finishReason === "length")
      },
      b_promptOverhead: {
        minimalOverhead,
        maxObservedOverhead: maxOverhead,
        recommendedPromptOverheadTokens: Math.ceil((2 * measuredOverhead) / 50) * 50
      },
      c_promptTokensWithinBytesPlusOverhead: {
        pass: allPrompt.every((row) => row.promptTokens !== null && row.promptTokens <= row.bytes + measuredOverhead),
        worstTokensPerByte: Math.max(...adversarial.map((row) => (row.promptTokens ?? 0) / row.bytes)).toFixed(3),
        worstV3TokensPerByte: Math.max(...allPrompt.filter((row) => row.label.startsWith("v3:")).map((row) => (row.promptTokens ?? 0) / row.bytes)).toFixed(3)
      },
      d_configuredPromptOverheadHolds: {
        promptOverheadTokens: MIN_PROMPT_OVERHEAD_TOKENS,
        pass: configuredOverheadFails.length === 0,
        failing: configuredOverheadFails.map((row) => row.label),
        maxV3Overhead: Math.max(...allPrompt.filter((row) => row.label.startsWith("v3:")).map((row) => row.overhead ?? -Infinity))
      },
      reasoningNeverInContent: {
        pass: [...allBudgeted, reasoningIncluded, reasoningExcluded].every((row) => !row.reasoningLeak) && reasoningExcluded.reasoningFieldChars === 0,
        includeReasoningFalseSendsNoReasoningField: reasoningExcluded.reasoningFieldChars === 0,
        reasoningStillBilledWhenExcluded: (reasoningExcluded.reasoningTokens ?? 0) > 0
      }
    },
    overhead,
    adversarial,
    reasoningBudget,
    reasoningIncluded,
    reasoningExcluded
  };
}


// ---------------------------------------------------------------------------
// --context: paired v2 / v3 runs (whole-document context, spec 2026-09-27;
// writing rules, spec 2026-09-27-writing-rules-prompt-v3.md).

const CONTEXT_SAMPLE_CHARS = 220;

/** Deterministic filler built from a few sentence templates. */
function filler(templates: string[], count: number, seed: number): string {
  const out: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const template = templates[(index * 7 + seed) % templates.length];
    out.push(template.replace(/\{n\}/g, String(((index + seed) * 13) % 97)));
  }
  return out.join(" ");
}

const EN_TEMPLATES = [
  "The morning log recorded {n} crossings, most of them before the fog lifted.",
  "Volunteers repainted the railings along the north mole for the {n}th time this decade.",
  "Complaints about the timetable dropped once the new signage went up on Brannock Street.",
  "The council asked for a cost estimate covering {n} months of maintenance.",
  "Fishermen reported that the tide gauge readings matched their own observations.",
  "A school group toured the station and asked how the old lamp had been lit.",
  "Insurance inspectors noted {n} minor issues, none of them urgent.",
  "The café by the slipway extended its hours for the summer season."
];

const ES_TEMPLATES = [
  "El registro de la mañana anotó {n} cruces, casi todos antes de que levantara la niebla.",
  "Los voluntarios pintaron otra vez las barandas del espigón norte.",
  "Las quejas por el horario bajaron cuando se instaló la nueva señalética en la calle Almirante Soto.",
  "El concejo pidió un presupuesto para {n} meses de mantención.",
  "Los pescadores dijeron que las mediciones del mareógrafo coincidían con lo que ellos veían.",
  "Un curso del liceo visitó la estación y preguntó cómo se encendía la lámpara antigua.",
  "La inspección del seguro encontró {n} observaciones menores, ninguna urgente.",
  "La cafetería junto a la rampa amplió su horario durante el verano."
];

function longEnglishDocument(): string {
  const intro = [
    "# Kestrel Point Harbor: Annual Report",
    "",
    "Mara Quint has been harbor master at Kestrel Point since 2019. This report covers the Gull Line ferry, the TIDEWATCH tide-gauge project and the repairs to the north mole.",
    "",
    "In this report, \"the Gull Line\" always means the ferry service to Orran Island, and TIDEWATCH is written in capitals, as in the project's charter.",
    ""
  ].join("\n");
  const sections = Array.from({ length: 14 }, (_, index) =>
    [`## ${["Operations", "Maintenance", "Community", "Budget", "Safety", "Weather"][index % 6]} notes ${index + 1}`, "", filler(EN_TEMPLATES, 9, index), "", filler(EN_TEMPLATES, 8, index + 3), ""].join("\n")
  ).join("\n");
  return `${intro}\n${sections}\n## Recommendations\n\nThe weakest point this year was the winter timetable. For next winter, the harbor master should `;
}

function longSpanishDocument(): string {
  const intro = [
    "# Informe anual del muelle de Punta Cernícalo",
    "",
    "Inés Arrieta es la capitana de puerto de Punta Cernícalo desde 2020. Este informe cubre el ferry Gaviota, el proyecto MAREA de medición de mareas y las reparaciones del espigón norte.",
    "",
    "En este informe, «el Gaviota» es siempre el servicio de ferry a isla Quenac, y MAREA se escribe en mayúsculas, como en el acta del proyecto.",
    ""
  ].join("\n");
  const sections = Array.from({ length: 14 }, (_, index) =>
    [`## Notas de ${["operación", "mantención", "comunidad", "presupuesto", "seguridad", "clima"][index % 6]} ${index + 1}`, "", filler(ES_TEMPLATES, 9, index), "", filler(ES_TEMPLATES, 8, index + 3), ""].join("\n")
  ).join("\n");
  return `${intro}\n${sections}\n## Recomendaciones\n\nEl punto más débil de este año fue el horario de invierno. Para el próximo invierno, la capitana de puerto debería `;
}

/** Max-byte Unicode: CJK, emoji and quotes, far over the byte budget. */
function unicodeDocument(): string {
  const line = (index: number) => `第${index}节：港口的"潮汐"记录 😀🌊 很重要\\，每天都要检查。`;
  const body = Array.from({ length: 2400 }, (_, index) => line(index)).join("\n");
  return `# 港口报告\n\n玛拉负责港口。\n\n${body}\n\n## 结论\n\n明年冬天，港务长应该`;
}

interface ContextCase {
  id: string;
  what: string;
  /** The language the document is written in (the task's `language` is the app language). */
  docLanguage: "en" | "es";
  /** Spanish dialogue uses the raya: em dashes there are the writer's voice, not the model's habit. */
  dialogue?: boolean;
  variant: "autocomplete" | "selection";
  autocomplete?: AutocompleteTaskInput;
  selection?: SelectionTaskInput;
}

function autocompleteCase(id: string, what: string, text: string, language: "en" | "es", kind: AutocompleteTaskInput["kind"], draft = "", docLanguage: "en" | "es" = language): ContextCase {
  const cursor = text.length;
  const context = buildAutocompleteContext(text, cursor, { minPrefixChars: 8, includePreviousBlockOnEmptyPrefix: true, includePreviousBlockOnShortPrefix: true });
  if (!context) throw new Error(`no context for ${id}`);
  return {
    id,
    what,
    docLanguage,
    variant: "autocomplete",
    autocomplete: {
      language,
      kind,
      extend: Boolean(draft),
      prefix: `${context.prefix}${draft}`.slice(-2500),
      suffix: context.suffix,
      documentTitle: "report",
      headingPath: context.headingPath,
      nearbyHeadings: context.nearbyHeadings,
      direction: "",
      avoid: [],
      document: { text, cursor },
      preferences: ""
    }
  };
}

function selectionCase(id: string, what: string, text: string, paragraph: string, language: "en" | "es", mode: "tighten" | "edit", instruction?: string, docLanguage: "en" | "es" = language): ContextCase {
  const selectionFrom = text.indexOf(paragraph);
  if (selectionFrom < 0) throw new Error(`paragraph not found for ${id}`);
  const passageFrom = Math.max(0, text.lastIndexOf("\n\n", selectionFrom - 3) + 2);
  const passageToAt = text.indexOf("\n\n", selectionFrom + paragraph.length + 2);
  const passageTo = passageToAt < 0 ? text.length : passageToAt;
  const passage = text.slice(passageFrom, passageTo).slice(0, 4000);
  return {
    id,
    what,
    docLanguage,
    variant: "selection",
    selection: {
      language,
      mode,
      ...(mode === "edit" ? { instruction } : {}),
      text: passage,
      selection: { from: selectionFrom - passageFrom, to: selectionFrom - passageFrom + paragraph.length },
      document: { text, selectionFrom, selectionTo: selectionFrom + paragraph.length },
      preferences: ""
    }
  };
}

function contextCases(options: { all?: boolean } = {}): ContextCase[] {
  const en = longEnglishDocument();
  const es = longSpanishDocument();
  const unicode = unicodeDocument();
  const enEdit = `${en.slice(0, en.lastIndexOf("## Recommendations"))}## Recommendations\n\nThe weakest point this year was the winter timetable. The person in charge of the harbor thinks the boat to the island should run less often in January because hardly anyone uses it then and it costs a lot.\n\nOther matters are listed in the appendix.`;
  const enParagraph = "The weakest point this year was the winter timetable. The person in charge of the harbor thinks the boat to the island should run less often in January because hardly anyone uses it then and it costs a lot.";
  const esEdit = `${es.slice(0, es.lastIndexOf("## Recomendaciones"))}## Recomendaciones\n\nEl punto más débil de este año fue el horario de invierno. La persona a cargo del puerto piensa que el barco a la isla debería salir menos seguido en enero, porque casi nadie lo usa en esa época y además cuesta bastante dinero mantenerlo funcionando.\n\nOtros temas se detallan en el anexo.`;
  const esParagraph = "El punto más débil de este año fue el horario de invierno. La persona a cargo del puerto piensa que el barco a la isla debería salir menos seguido en enero, porque casi nadie lo usa en esa época y además cuesta bastante dinero mantenerlo funcionando.";
  const unicodeParagraph = "明年冬天，港务长应该";
  const cases = [
    autocompleteCase("late-en-sentence", "Late cursor in a long EN document (names only early)", en, "en", "sentence"),
    autocompleteCase("late-en-idea", "Late cursor, full idea", en, "en", "idea"),
    autocompleteCase("extend-en-paragraph", "Extending an unaccepted draft", en, "en", "paragraph", "reduce the number of Gull Line crossings in January and "),
    autocompleteCase("late-es-app-en", "Spanish document, English app language", es, "en", "sentence", "", "es"),
    autocompleteCase("late-es-app-es", "Spanish document, Spanish app language", es, "es", "paragraph"),
    autocompleteCase("unicode-max", "Max-byte Unicode (CJK, emoji, quotes) over the budget", unicode, "en", "sentence"),
    selectionCase("edit-en-rewrite", "✦ AI Rewrite (edit) late in the EN document", enEdit, enParagraph, "en", "edit", "Rewrite this to be clearer."),
    selectionCase("tighten-es-app-es", "✦ AI Shorten, Spanish document, Spanish app", esEdit, esParagraph, "es", "tighten"),
    selectionCase("edit-es-app-en", "✦ AI Rewrite, Spanish document, English app", esEdit, esParagraph, "en", "edit", "Rewrite this to be clearer.", "es"),
    selectionCase("edit-unicode-max", "✦ AI edit in a max-byte Unicode document", unicode, unicodeParagraph, "en", "edit", "Make it more formal."),
    ...fixtureCases(),
    ...baitCases()
  ];
  return options.all ? cases : cases.filter((entry) => !onlyCases || onlyCases.includes(entry.id));
}

/** The shared EN/ES fixtures (tests/fixtures/writingCases.ts) as the app builds them: the local window, no snapshot. */
function fixtureCases(): ContextCase[] {
  const autocomplete = autocompleteCases.map(({ id, task }): ContextCase => ({
    id: `fixture-${id}`,
    what: `Fixture ${task.kind} (${task.language})`,
    docLanguage: task.language,
    dialogue: id.startsWith("dialogue-es"),
    variant: "autocomplete",
    autocomplete: {
      language: task.language,
      kind: task.kind,
      extend: false,
      prefix: task.prefix,
      suffix: task.suffix,
      documentTitle: task.documentTitle,
      headingPath: task.headingPath,
      nearbyHeadings: task.nearbyHeadings,
      direction: "",
      avoid: [],
      document: { text: `${task.prefix}${task.suffix}`, cursor: task.prefix.length },
      preferences: ""
    }
  }));
  const selection = selectionCases.map(({ id, task }): ContextCase => ({
    id: `fixture-${id}`,
    what: `Fixture ✦ AI ${task.mode} (${task.language})`,
    docLanguage: task.language,
    variant: "selection",
    selection: {
      language: task.language,
      mode: task.mode,
      ...(task.mode === "edit" ? { instruction: task.instruction } : {}),
      text: task.text,
      selection: task.selection,
      document: { text: task.text, selectionFrom: task.selection.from, selectionTo: task.selection.to },
      preferences: ""
    }
  }));
  return [...autocomplete, ...selection];
}

/**
 * Synthetic bait (spec 2026-09-27-writing-rules-prompt-v3.md, Review 7): text
 * that invites the AI habits the v3 rules name. Facts without reasons
 * (unsupported causal claim), a fresh section under a title (generic
 * opening), the end of a short report (inflated or upbeat ending) and a
 * persuasive rewrite (three-part rhetoric, "not just X but Y").
 */
function baitCases(): ContextCase[] {
  const causalEn = "# Reading groups\n\nSince March, students in 3rd grade take a reading test at the start of each term. Those who score below 40 points join a group of at most six students. Groups meet three times a week for 45 minutes with the same teacher. ";
  const causalEs = "# Grupos de lectura\n\nDesde marzo, los estudiantes de 3° básico rinden una prueba de lectura al inicio de cada semestre. Quienes sacan menos de 40 puntos entran a un grupo de máximo seis estudiantes. Los grupos se reúnen tres veces por semana durante 45 minutos con la misma profesora. ";
  const openingEn = "# Why we moved the Tuesday workshop\n\n";
  const openingEs = "# Por qué cambiamos el taller del martes\n\n";
  const endingEn = "# Pilot report: evening library hours\n\nFrom 2 September to 25 October the library stayed open until 21:00 on weekdays. 312 people came after 18:00, most of them on Tuesdays and Thursdays. Two staff members covered the extra hours, at a cost of 4,100 dollars.\n\nLoans after 18:00 were 9 % of all loans in the period. Noise complaints: none.\n\n## Conclusion\n\n";
  const endingEs = "# Informe del piloto: biblioteca en horario vespertino\n\nDel 2 de septiembre al 25 de octubre la biblioteca abrió hasta las 21:00 en días hábiles. 312 personas llegaron después de las 18:00, casi todas martes y jueves. Dos funcionarias cubrieron las horas extra, con un costo de 3,9 millones de pesos.\n\nLos préstamos después de las 18:00 fueron el 9 % del total del periodo. Reclamos por ruido: ninguno.\n\n## Conclusión\n\n";
  const triadEnParagraph = "The new schedule starts in January. Classes begin at 8:30 instead of 8:00, and lunch moves to 12:45. Buses will leave the depot fifteen minutes later.";
  const triadEsParagraph = "El nuevo horario empieza en enero. Las clases comienzan a las 8:30 en vez de las 8:00 y el almuerzo pasa a las 12:45. Los buses saldrán del terminal quince minutos más tarde.";
  const triadEn = `# Notice to families\n\n${triadEnParagraph}\n\nQuestions go to the school office.`;
  const triadEs = `# Aviso a las familias\n\n${triadEsParagraph}\n\nLas consultas van a la secretaría del colegio.`;
  return [
    autocompleteCase("bait-causal-en", "Bait: facts without reasons (unsupported causal claim)", causalEn, "en", "paragraph"),
    autocompleteCase("bait-causal-es", "Bait: hechos sin causas (conclusión sin respaldo)", causalEs, "es", "paragraph"),
    autocompleteCase("bait-opening-en", "Bait: fresh section under a title (generic opening)", openingEn, "en", "paragraph"),
    autocompleteCase("bait-opening-es", "Bait: sección nueva bajo un título (apertura genérica)", openingEs, "es", "paragraph"),
    autocompleteCase("bait-ending-en", "Bait: conclusion of a short report (inflated/upbeat ending)", endingEn, "en", "paragraph"),
    autocompleteCase("bait-ending-es", "Bait: conclusión de un informe breve (cierre inflado/optimista)", endingEs, "es", "paragraph"),
    selectionCase("bait-triad-en", "Bait: persuasive rewrite (three-part rhetoric, not just X but Y)", triadEn, triadEnParagraph, "en", "edit", "Make it more persuasive."),
    selectionCase("bait-triad-es", "Bait: reescritura persuasiva (tríadas, no solo X sino Y)", triadEs, triadEsParagraph, "es", "edit", "Hazlo más persuasivo.")
  ];
}

// ---------------------------------------------------------------------------
// Style counters over the cleaned answer (what the writer would see).

const STOCK_PHRASES: Record<"en" | "es", RegExp[]> = {
  en: [
    /\bcrucial\b/gi, /\bpivotal\b/gi, /\bkey role\b/gi, /\bvital\b/gi, /\bmilestone\b/gi, /\btestament\b/gi,
    /\bunderscor(?:e|es|ed|ing)\b/gi, /\bdelv(?:e|es|ing)\b/gi, /\blandscape\b/gi, /\bfoster(?:s|ed|ing)?\b/gi,
    /\bseamless(?:ly)?\b/gi, /\brobust\b/gi, /\bnot (?:just|only)\b/gi, /\bin today'?s\b/gi, /\bever-(?:changing|evolving)\b/gi,
    /\bincreasingly\b/gi, /\bmoreover\b/gi, /\bfurthermore\b/gi, /\bultimately\b/gi, /\bin conclusion\b/gi,
    /\bensur(?:e|es|ing)\b/gi, /\benhanc(?:e|es|ed|ing)\b/gi, /\bpromising\b/gi, /\bpaving the way\b/gi, /\bplays? a (?:key|crucial|vital|significant) role\b/gi
  ],
  es: [
    /\bfundamental(?:es)?\b/gi, /\bcrucial(?:es)?\b/gi, /\bpapel clave\b/gi, /\bhito\b/gi, /\becosistema\b/gi, /\bpotenci(?:ar|a|ando)\b/gi,
    /\bimpuls(?:ar|a|ando)\b/gi, /\bfoment(?:ar|a|ando)\b/gi, /\bsinergia\b/gi, /\brobust[oa]s?\b/gi, /\bintegral(?:es)?\b/gi,
    /\btransformador(?:a|es)?\b/gi, /\binnovador(?:a|es)?\b/gi, /\bpanorama\b/gi, /\bno solo\b/gi, /\bponer en valor\b/gi,
    /\ben este contexto\b/gi, /\ben definitiva\b/gi, /\bcabe destacar\b/gi, /\bdesempeñ(?:a|an) un papel\b/gi, /\bpone de relieve\b/gi,
    /\babord(?:ar|a|ando)\b/gi, /\bprometedor(?:a|es)?\b/gi, /\bgarantiz(?:ar|a|ando)\b/gi, /\bclave\b/gi
  ]
};

interface StyleCounts {
  emDashes: number;
  semicolons: number;
  /** Colons outside times (8:30), URLs and list introductions (a colon ending a line before a list item). */
  colonsHeuristic: number;
  /** Stock phrases in the answer that the source text does not already use. */
  stockPhrases: number;
  stockPhraseHits: string[];
}

function styleCounts(output: string, source: string, language: "en" | "es"): StyleCounts {
  const emDashes = (output.match(/—|\s–\s/g) ?? []).length;
  const semicolons = (output.match(/;/g) ?? []).length;
  const colonsHeuristic = (output
    .replace(/\b\d{1,2}:\d{2}\b/g, "")
    .replace(/[a-z]+:\/\//gi, "")
    .replace(/:[ \t]*\n+[ \t]*(?:[-*+]|\d+[.)])\s/g, "")
    .match(/:/g) ?? []).length;
  const hits: string[] = [];
  for (const pattern of STOCK_PHRASES[language]) {
    for (const match of output.match(pattern) ?? []) {
      if (!new RegExp(pattern.source, "i").test(source)) hits.push(match.toLowerCase());
    }
  }
  return { emDashes, semicolons, colonsHeuristic, stockPhrases: hits.length, stockPhraseHits: hits };
}

function sourceText(entry: ContextCase): string {
  return entry.autocomplete ? entry.autocomplete.document?.text ?? `${entry.autocomplete.prefix}${entry.autocomplete.suffix}` : entry.selection!.document?.text ?? entry.selection!.text;
}

function contextTask(entry: ContextCase, version: 2 | 3): WritingAiTask {
  const task = entry.autocomplete ? buildAutocompleteTask(version, entry.autocomplete) : buildSelectionTask(version, entry.selection!);
  const parsed = parseWritingAiTask(task);
  if (!parsed.ok) throw new Error(`invalid ${entry.id} v${version}: ${parsed.field}`);
  return parsed.task;
}

type BenchVersion = 2 | 3;
const BENCH_VERSIONS: readonly BenchVersion[] = [2, 3];

interface ContextRow extends Partial<StyleCounts> {
  case: string;
  docLanguage: "en" | "es";
  variant: "autocomplete" | "selection";
  dialogue: boolean;
  version: BenchVersion;
  trial: number;
  bodyBytes: number;
  promptBytes: number;
  error?: string;
  promptTokens?: number;
  /** Prompt tokens Groq served from its prompt cache (`prompt_tokens_details.cached_tokens`), when reported. */
  cachedPromptTokens?: number | null;
  completionTokens?: number;
  firstDeltaMs?: number | null;
  completeMs?: number;
  finishReason?: string | null;
  accepted?: boolean;
  rejectedBy?: string | null;
  rawChars?: number;
  cleanedChars?: number;
  costUsd?: number | null;
  sample?: string;
  fullText?: string;
}

async function runContextCase(apiKey: string, entry: ContextCase, version: BenchVersion, trial: number): Promise<ContextRow> {
  const task = contextTask(entry, version);
  const prompt = buildWritingAiPrompt(task);
  const base = {
    case: entry.id,
    docLanguage: entry.docLanguage,
    variant: entry.variant,
    dialogue: Boolean(entry.dialogue),
    version,
    trial,
    bodyBytes: Buffer.byteLength(JSON.stringify(task), "utf8"),
    promptBytes: promptUtf8Bytes(prompt)
  };
  const started = performance.now();
  try {
    const result = await withRetry(() =>
      streamGroqPrompt({ apiKey, prompt, signal: AbortSignal.timeout(45_000), now: () => performance.now() })
    );
    const completeMs = performance.now() - started;
    let cleaned = "";
    let rejectedBy: string | null = null;
    if (result.finishReason !== "stop") rejectedBy = `finish:${result.finishReason}`;
    else if (containsReasoningMarkers(result.text)) rejectedBy = "reasoning_marker";
    else if (entry.autocomplete) {
      const input = entry.autocomplete;
      cleaned = cleanAutocompleteOutput(result.text, { prefix: input.prefix, suffix: input.suffix, suggestionKind: input.kind, extend: input.extend });
      if (!cleaned) rejectedBy = "cleaner";
    } else {
      const input = entry.selection!;
      const selected = tightenSelectedText(input.text, input.selection);
      const rewrite = cleanTightenOutput(result.text, selected);
      if (!rewrite.trim()) rejectedBy = "empty";
      else if (looksLikePreambleEcho(rewrite, selected)) rejectedBy = "preamble_echo";
      else if (looksLikeTightenContextEcho(rewrite, input.text, input.selection)) rejectedBy = "context_echo";
      else if (looksLikeReferenceEcho(rewrite, referenceTextForEchoCheck(input.text, input.selection, input.document), selected)) rejectedBy = "reference_echo";
      else cleaned = rewrite;
    }
    const shown = cleaned || result.text;
    return {
      ...base,
      promptTokens: result.usage?.promptTokens,
      cachedPromptTokens: result.usage?.cachedPromptTokens ?? null,
      completionTokens: result.usage?.completionTokens,
      firstDeltaMs: result.firstDeltaMs === null ? null : Math.round(result.firstDeltaMs),
      completeMs: Math.round(completeMs),
      finishReason: result.finishReason,
      accepted: Boolean(cleaned),
      rejectedBy,
      rawChars: result.text.length,
      cleanedChars: cleaned.length,
      ...styleCounts(cleaned, sourceText(entry), entry.docLanguage),
      costUsd: cost(result),
      sample: `${cleaned ? "" : "[rejected] "}${shown.replace(/\s+/g, " ").trim().slice(0, CONTEXT_SAMPLE_CHARS)}`,
      ...(showSamples ? { fullText: shown } : {})
    };
  } catch (error) {
    return { ...base, error: normalizeAgentError(error).code };
  }
}

function summarizeContext(rows: ContextRow[], version: BenchVersion, language?: "en" | "es") {
  const all = rows.filter((row) => row.version === version && (!language || row.docLanguage === language));
  const ok = all.filter((row) => !row.error);
  const nums = (pick: (row: ContextRow) => number | null | undefined, from = ok) => from.map(pick).filter((value): value is number => typeof value === "number");
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
  const count = (values: Array<string | null | undefined>) => {
    const out: Record<string, number> = {};
    for (const value of values) out[String(value)] = (out[String(value)] ?? 0) + 1;
    return out;
  };
  const accepted = ok.filter((row) => row.accepted);
  const nonDialogue = accepted.filter((row) => !row.dialogue);
  return {
    version,
    language: language ?? "all",
    requests: all.length,
    errors: all.length - ok.length,
    accepted: accepted.length,
    finishReasons: count(ok.map((row) => row.finishReason)),
    rejections: count(ok.filter((row) => row.rejectedBy).map((row) => row.rejectedBy)),
    emDashes: sum(nums((row) => row.emDashes, nonDialogue)),
    emDashesDialogueCases: sum(nums((row) => row.emDashes, accepted.filter((row) => row.dialogue))),
    answersWithEmDash: nonDialogue.filter((row) => (row.emDashes ?? 0) > 0).length,
    semicolons: sum(nums((row) => row.semicolons, accepted)),
    answersWithSemicolon: accepted.filter((row) => (row.semicolons ?? 0) > 0).length,
    colonsHeuristic: sum(nums((row) => row.colonsHeuristic, accepted)),
    stockPhrases: sum(nums((row) => row.stockPhrases, accepted)),
    answersWithStockPhrase: accepted.filter((row) => (row.stockPhrases ?? 0) > 0).length,
    stockPhraseHits: count(accepted.flatMap((row) => row.stockPhraseHits ?? [])),
    rawCharsP50: percentile(nums((row) => row.rawChars), 0.5),
    cleanedCharsP50: percentile(nums((row) => row.cleanedChars, accepted), 0.5),
    cleanedCharsMean: accepted.length ? Math.round(sum(nums((row) => row.cleanedChars, accepted)) / accepted.length) : null,
    promptTokensP50: percentile(nums((row) => row.promptTokens), 0.5),
    firstDeltaP50: percentile(nums((row) => row.firstDeltaMs), 0.5),
    firstDeltaP90: percentile(nums((row) => row.firstDeltaMs), 0.9),
    completeP50: percentile(nums((row) => row.completeMs), 0.5),
    completeP90: percentile(nums((row) => row.completeMs), 0.9),
    totalCostUsd: Number(sum(nums((row) => row.costUsd)).toFixed(6))
  };
}

/** Deterministic shuffle (seeded), so the blinded pairs are reproducible. */
function seededShuffle<T>(items: T[], seed: number): T[] {
  const out = [...items];
  let state = seed >>> 0;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (let index = out.length - 1; index > 0; index -= 1) {
    const other = Math.floor(next() * (index + 1));
    [out[index], out[other]] = [out[other], out[index]];
  }
  return out;
}

async function contextBenchmark(apiKey: string) {
  const cases = contextCases();
  const rows: ContextRow[] = [];
  for (let trial = 0; trial < trials; trial += 1) {
    for (const entry of cases) {
      // Alternate the order per case so neither version always goes first.
      const order: BenchVersion[] = (trial + cases.indexOf(entry)) % 2 ? [3, 2] : [2, 3];
      for (const version of order) rows.push(await runContextCase(apiKey, entry, version, trial));
    }
  }
  const perCase = cases.map((entry) => ({
    id: entry.id,
    ...Object.fromEntries(BENCH_VERSIONS.map((version) => {
      const mine = rows.filter((row) => row.case === entry.id && row.version === version && !row.error);
      return [`v${version}`, {
        accepted: `${mine.filter((row) => row.accepted).length}/${mine.length}`,
        emDashes: mine.reduce((a, row) => a + (row.emDashes ?? 0), 0),
        semicolons: mine.reduce((a, row) => a + (row.semicolons ?? 0), 0),
        colons: mine.reduce((a, row) => a + (row.colonsHeuristic ?? 0), 0),
        stock: mine.reduce((a, row) => a + (row.stockPhrases ?? 0), 0),
        cleanedCharsP50: percentile(mine.filter((row) => row.accepted).map((row) => row.cleanedChars ?? 0), 0.5)
      }];
    }))
  }));
  const pairs = showSamples
    ? seededShuffle(
        cases.flatMap((entry) =>
          Array.from({ length: trials }, (_, trial) => {
            const v2 = rows.find((row) => row.case === entry.id && row.version === 2 && row.trial === trial);
            const v3 = rows.find((row) => row.case === entry.id && row.version === 3 && row.trial === trial);
            const flip = (trial + cases.indexOf(entry)) % 2 === 1;
            return { case: entry.id, what: entry.what, trial, A: (flip ? v3 : v2)?.fullText ?? null, B: (flip ? v2 : v3)?.fullText ?? null, key: flip ? "A=v3" : "A=v2" };
          })
        ),
        20260927
      )
    : undefined;
  return {
    cases: cases.map(({ id, what, docLanguage }) => ({ id, what, docLanguage })),
    summary: BENCH_VERSIONS.map((version) => summarizeContext(rows, version)),
    summaryByLanguage: (["en", "es"] as const).flatMap((language) => BENCH_VERSIONS.map((version) => summarizeContext(rows, version, language))),
    perCase,
    ...(pairs ? { samplePairs: pairs } : {}),
    rows: rows.map(({ fullText: _fullText, ...row }) => row)
  };
}

async function main() {
  const apiKey = readGroqKey();
  const plannedRequests = budgetProbe
    ? 1 + autocompleteCases.length + selectionCases.length + 2 * (contextCases({ all: true }).length - 2) + ADVERSARIAL_FLAVORS.length * 2 + V3_MAX_FLAVORS.length * 2 + 6 + 2
    : contextMode
      ? trials * contextCases().length * 2
      : trials * (autocompleteCases.length + selectionCases.length);
  const mode = budgetProbe ? "budget-probe" : contextMode ? "context" : "benchmark";

  if (dryRun || !apiKey) {
    if (budgetProbe) {
      // Build every probe task (throws if one is invalid) without sending anything.
      for (const flavor of V3_MAX_FLAVORS) {
        maxContextAutocompleteTask(flavor, 3);
        maxContextSelectionTask(flavor, 3);
      }
    }
    console.log(JSON.stringify({
      mode,
      route: "direct",
      promptVersion: contextMode ? "2 vs 3" : budgetProbe ? "1, 2, 3" : 1,
      cases: contextMode
        ? contextCases().map((entry) => ({
            id: entry.id,
            what: entry.what,
            bodyBytesV2: Buffer.byteLength(JSON.stringify(contextTask(entry, 2)), "utf8"),
            bodyBytesV3: Buffer.byteLength(JSON.stringify(contextTask(entry, 3)), "utf8"),
            promptBytesV2: promptUtf8Bytes(buildWritingAiPrompt(contextTask(entry, 2))),
            promptBytesV3: promptUtf8Bytes(buildWritingAiPrompt(contextTask(entry, 3)))
          }))
        : [...autocompleteCases, ...selectionCases].map(({ id, task }) => ({ id, kind: task.task === "autocomplete" ? task.kind : task.mode, language: task.language })),
      trials: budgetProbe ? 1 : trials,
      requests: dryRun || !apiKey ? 0 : plannedRequests,
      plannedRequests,
      note: apiKey ? "Dry run: no requests made." : "No GROQ_API_KEY in the environment or .env.local: no requests made."
    }, null, 2));
    return;
  }

  const output = budgetProbe ? await budgetProbes(apiKey) : contextMode ? await contextBenchmark(apiKey) : await benchmark(apiKey);
  console.log(JSON.stringify({ mode, route: "direct", date: new Date().toISOString(), ...output }, null, 2));
}

main().catch((error) => {
  // Never print provider text or the key: only the normalized code.
  console.error(JSON.stringify({ error: normalizeAgentError(error).code }));
  process.exitCode = 1;
});
