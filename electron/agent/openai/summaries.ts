import type { AgentThinkingRunEventListener } from "../types.js";
import type { OpenAiResponse, OpenAiStreamSummary } from "./types.js";

export function sanitizeThinkingSummary(text: string) {
  if (!text.trim()) {
    return "";
  }

  if (/```|~~~/.test(text) || /\b(?:FULL_REPLACEMENT|NEW_DOCUMENT):/i.test(text)) {
    return "";
  }

  if (/\b(?:chain[-\s]?of[-\s]?thought|hidden reasoning|internal policy|raw reasoning|reasoning_text)\b/i.test(text)) {
    return "";
  }

  if (countLongQuotedLines(text) > 0 || text.length > 800) {
    return "";
  }

  const clean = text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/[*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (/\b(?:diff|full replacement|complete document|document excerpt|transport marker)\b/i.test(clean)) {
    return "";
  }

  return clean.length > 180 ? `${clean.slice(0, 177).trimEnd()}...` : clean;
}

function countLongQuotedLines(text: string) {
  return text.split(/\r?\n/).filter((line) => /^\s*>.{80,}/.test(line) || /^ {4,}\S.{120,}/.test(line)).length;
}

export function flushSummaryDeltas(
  summaries: Map<string, OpenAiStreamSummary>,
  runId: string,
  onRunEvent?: AgentThinkingRunEventListener
) {
  for (const [key, summary] of summaries) {
    const [itemId, summaryIndexValue] = key.split(":");
    emitSummaryDelta(summary, runId, itemId, Number(summaryIndexValue), onRunEvent, true);
  }
}

export function emitSummaryDelta(
  summary: OpenAiStreamSummary,
  runId: string,
  itemId: string,
  summaryIndex: number,
  onRunEvent?: AgentThinkingRunEventListener,
  force = false
) {
  const text = sanitizeThinkingSummary(summary.raw);
  const now = Date.now();

  if (!text || !text.startsWith(summary.emitted)) {
    return;
  }

  if (!force && now - summary.lastEmitAt < 120) {
    return;
  }

  const delta = text.slice(summary.emitted.length);

  if (!delta) {
    return;
  }

  summary.emitted = text;
  summary.lastEmitAt = now;
  onRunEvent?.({
    type: "thinking_delta",
    runId,
    itemId,
    summaryIndex,
    delta
  });
}

export function emitReasoningSummariesFromResponse(
  response: OpenAiResponse,
  runId: string,
  onRunEvent?: AgentThinkingRunEventListener
) {
  response.output
    ?.filter((item) => item.type === "reasoning")
    .flatMap((item) => item.summary ?? [])
    .forEach((summary, index) => {
      const text = sanitizeThinkingSummary(summary.text ?? "");

      if (!text) {
        return;
      }

      onRunEvent?.({
        type: "thinking_done",
        runId,
        itemId: `reasoning-summary-${index + 1}`,
        summaryIndex: index,
        text
      });
    });
}
