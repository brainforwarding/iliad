// Groq writing-AI benchmark and Phase 0 budget probes.
// Spec: specs/2026-09-25-groq-ai-free-tier.md, "Benchmark" and "Phased plan".
//
//   npm run benchmark:autocomplete -- [--dry-run] [--trials=N] [--samples]
//   npm run benchmark:autocomplete -- --budget-probe [--dry-run]
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
import { stableAutocompletePrefix } from "../electron/writing/geminiAutocomplete";
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
  TIGHTEN_MAX_INPUT_CHARS,
  TIGHTEN_MAX_INSTRUCTION_CHARS,
  buildWritingAiPrompt,
  groqChatCompletionBody,
  parseWritingAiTask,
  promptUtf8Bytes,
  type WritingAiPrompt,
  type WritingAiTask
} from "../electron/writing/groq/prompts/index";
import { containsReasoningMarkers } from "../electron/writing/groq/sse";
import {
  cleanTightenOutput,
  looksLikePreambleEcho,
  looksLikeTightenContextEcho,
  tightenSelectedText
} from "../electron/writing/tighten";
import { ADVERSARIAL_FLAVORS, adversarialText, autocompleteCases, selectionCases } from "../tests/fixtures/writingCases";

// Groq list prices for openai/gpt-oss-120b (USD per token), as in the spec's cost model.
const INPUT_USD_PER_TOKEN = 0.15 / 1_000_000;
const OUTPUT_USD_PER_TOKEN = 0.6 / 1_000_000;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const budgetProbe = args.includes("--budget-probe");
const showSamples = args.includes("--samples");
const trials = Math.min(10, Math.max(1, Number(args.find((arg) => arg.startsWith("--trials="))?.split("=")[1] ?? 3) || 3));

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

async function runTask(apiKey: string, id: string, task: WritingAiTask, trial: number): Promise<Row> {
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
  const cases: Array<{ id: string; task: WritingAiTask }> = [...autocompleteCases, ...selectionCases];
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

  // (c) Adversarial Unicode, every field at its maximum.
  const adversarial = [];
  for (const flavor of ADVERSARIAL_FLAVORS) {
    adversarial.push(await probePrompt(apiKey, `v1:autocomplete-idea-max:${flavor}`, buildWritingAiPrompt(maxAutocompleteTask(flavor, 1))));
    adversarial.push(await probePrompt(apiKey, `v1:selection-edit-max:${flavor}`, buildWritingAiPrompt(maxSelectionTask(flavor, 1))));
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

  return {
    promptVersion: LATEST_PROMPT_VERSION,
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
        worstTokensPerByte: Math.max(...adversarial.map((row) => (row.promptTokens ?? 0) / row.bytes)).toFixed(3)
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

async function main() {
  const apiKey = readGroqKey();
  const plannedRequests = budgetProbe
    ? 1 + autocompleteCases.length + selectionCases.length + ADVERSARIAL_FLAVORS.length * 2 + 6 + 2
    : trials * (autocompleteCases.length + selectionCases.length);

  if (dryRun || !apiKey) {
    console.log(JSON.stringify({
      mode: budgetProbe ? "budget-probe" : "benchmark",
      route: "direct",
      promptVersion: LATEST_PROMPT_VERSION,
      cases: [...autocompleteCases, ...selectionCases].map(({ id, task }) => ({ id, kind: task.task === "autocomplete" ? task.kind : task.mode, language: task.language })),
      trials: budgetProbe ? 1 : trials,
      requests: dryRun || !apiKey ? 0 : plannedRequests,
      plannedRequests,
      note: apiKey ? "Dry run: no requests made." : "No GROQ_API_KEY in the environment or .env.local: no requests made."
    }, null, 2));
    return;
  }

  const output = budgetProbe ? await budgetProbes(apiKey) : await benchmark(apiKey);
  console.log(JSON.stringify({ mode: budgetProbe ? "budget-probe" : "benchmark", route: "direct", date: new Date().toISOString(), ...output }, null, 2));
}

main().catch((error) => {
  // Never print provider text or the key: only the normalized code.
  console.error(JSON.stringify({ error: normalizeAgentError(error).code }));
  process.exitCode = 1;
});
