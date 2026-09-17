// Synthetic writing only. Run after npm run build. No credentials or prose are logged.
import { performance } from "node:perf_hooks";
import { generateGeminiAutocomplete } from "../dist-electron/agent/geminiAutocomplete.js";
import { OpenAiResponsesRuntimeProvider } from "../dist-electron/agent/runtime/openaiResponsesProvider.js";
import { autocompleteInstructions, autocompleteModelInput, autocompleteMaxOutputTokens, cleanAutocompleteOutput } from "../dist-electron/agent/autocomplete.js";

export const writingCases = [
  { id: "fiction-en", language: "en", prefix: "Mara found the lighthouse door open. On the stairs she noticed ", suffix: "", suggestionKind: "sentence" },
  { id: "fiction-es", language: "es", prefix: "Mara encontró abierta la puerta del faro. En la escalera vio ", suffix: "", suggestionKind: "sentence" },
  { id: "essay-en", language: "en", prefix: "An effective classroom gives students time to revise their thinking. For example, ", suffix: "", suggestionKind: "paragraph" },
  { id: "essay-es", language: "es", prefix: "Una buena clase permite que los estudiantes revisen sus ideas. Por ejemplo, ", suffix: "", suggestionKind: "paragraph" },
  { id: "dialogue-en", language: "en", prefix: '“You knew,” she said.\n\n“I knew only that ', suffix: ',” he replied.', suggestionKind: "inline" },
  { id: "dialogue-es", language: "es", prefix: '—Tú lo sabías.\n\n—Solo sabía que ', suffix: ' —respondió él.', suggestionKind: "inline" },
  { id: "middle-en", language: "en", prefix: "The simplest way to improve a draft is to ", suffix: " before sharing it with a reader.", suggestionKind: "inline" },
  { id: "middle-es", language: "es", prefix: "La forma más sencilla de mejorar un borrador es ", suffix: " antes de compartirlo con otra persona.", suggestionKind: "inline" }
];
const dryRun = process.argv.includes("--dry-run");
const trialsArg = process.argv.find((arg) => arg.startsWith("--trials="));
const trials = Math.min(20, Math.max(1, Number(trialsArg?.split("=")[1] ?? 3) || 3));
const providers = [];
if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) providers.push("gemini");
if (process.env.OPENAI_API_KEY) providers.push("openai");
if (dryRun || !providers.length) {
  console.log(JSON.stringify({ cases: writingCases.map(({ id, suggestionKind }) => ({ id, suggestionKind })), trials,
    providers, requests: dryRun ? 0 : providers.length * writingCases.length * trials,
    note: "Set GEMINI_API_KEY and/or OPENAI_API_KEY to measure real latency. --trials=N controls paid requests. No latency measurements were made." }, null, 2));
} else {
  const rows = [];
  for (let trial = 0; trial < trials; trial++) for (const sample of writingCases) for (const provider of trial % 2 ? [...providers].reverse() : providers) {
    const started = performance.now();
    let firstVisibleMs = null;
    const request = { ...sample, requestId: `benchmark-${sample.id}-${trial}`, trigger: "manual", headingPath: [], nearbyHeadings: [],
      documentTitle: "Synthetic benchmark", allowApiFallback: true, signal: AbortSignal.timeout(18_000),
      onPartial: (raw) => { if (firstVisibleMs === null && cleanAutocompleteOutput(raw, sample)) firstVisibleMs = performance.now() - started; }
    };
    try {
      const raw = provider === "gemini"
        ? await generateGeminiAutocomplete(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY, request)
        : (await new OpenAiResponsesRuntimeProvider({ apiKey: process.env.OPENAI_API_KEY, model: "gpt-5.4-mini" }).generateText({
          request: { instructions: autocompleteInstructions(sample.language, sample.suggestionKind), input: autocompleteModelInput(request),
            maxOutputTokens: autocompleteMaxOutputTokens(sample.suggestionKind), language: sample.language, cwd: process.cwd() }, signal: request.signal
        })).text;
      const insert = cleanAutocompleteOutput(raw, sample);
      const completeMs = performance.now() - started;
      rows.push({ provider, case: sample.id, trial, acceptedByCleaner: Boolean(insert), chars: insert.length,
        firstVisibleMs: firstVisibleMs ?? (insert ? completeMs : null), completeMs });
    } catch {
      rows.push({ provider, case: sample.id, trial, error: request.signal.aborted ? "timeout" : "provider" });
    }
  }
  const percentile = (values, p) => values.length ? Math.round([...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1]) : null;
  const summary = providers.map((provider) => {
    const samples = rows.filter((row) => row.provider === provider);
    const latencies = samples.map((row) => row.firstVisibleMs).filter((value) => typeof value === "number");
    return { provider, samples: samples.length, usable: samples.filter((row) => row.acceptedByCleaner).length,
      timeouts: samples.filter((row) => row.error === "timeout").length, firstVisibleP50: percentile(latencies, .5), firstVisibleP95: percentile(latencies, .95) };
  });
  console.log(JSON.stringify({ summary, rows, note: "Model latency excludes the automatic 450 ms pause. Usable means passed the output cleaner, not human-rated writing quality. Human acceptance and undo require a writing session." }, null, 2));
}
