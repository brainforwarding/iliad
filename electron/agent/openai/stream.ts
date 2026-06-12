import { malformedProviderResponseError } from "../errors.js";
import type { TextDeltaEmitter } from "../textStream.js";
import type { AgentProviderRunRequest, AgentThinkingRunEventListener } from "../types.js";
import { openAiStreamEventError } from "./providerErrors.js";
import { parseOpenAiResponse, responseText } from "./responses.js";
import { emitReasoningSummariesFromResponse, emitSummaryDelta, flushSummaryDeltas, sanitizeThinkingSummary } from "./summaries.js";
import type { OpenAiResponse, OpenAiStreamSummary } from "./types.js";
import { isRecord, recordProperty, stringProperty } from "./utils.js";

export async function readOpenAiResponseStream(
  response: Response,
  request: AgentProviderRunRequest,
  onRunEvent?: AgentThinkingRunEventListener,
  textEmitter?: TextDeltaEmitter
): Promise<OpenAiResponse> {
  if (!response.body) {
    throw malformedProviderResponseError();
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const summaries = new Map<string, OpenAiStreamSummary>();
  let buffer = "";
  let outputText = "";
  let responseId: string | undefined;
  let completedResponse: OpenAiResponse | undefined;

  const handleEvent = (event: unknown) => {
    if (!isRecord(event)) {
      return;
    }

    const type = typeof event.type === "string" ? event.type : "";

    if (type === "error") {
      throw openAiStreamEventError(event);
    }

    if (type.startsWith("response.reasoning_text")) {
      return;
    }

    if (type === "response.output_text.delta") {
      const delta = stringProperty(event, "delta");
      outputText += delta;
      textEmitter?.push(delta);
      return;
    }

    if (type === "response.output_text.done") {
      const text = stringProperty(event, "text");

      if (text && !outputText) {
        outputText = text;
      }

      return;
    }

    if (type === "response.reasoning_summary_text.delta") {
      handleReasoningSummaryDelta(event, summaries, request.runId, onRunEvent);
      return;
    }

    if (type === "response.reasoning_summary_text.done") {
      handleReasoningSummaryDone(event, summaries, request.runId, onRunEvent);
      return;
    }

    if (type === "response.completed") {
      const responsePayload = recordProperty(event, "response");

      if (responsePayload) {
        const completed = parseOpenAiResponse(responsePayload);
        completedResponse = completed;
        responseId = completed.id ?? responseId;
        const completedText = responseText(completed);

        if (completedText) {
          outputText = completedText;
        }

        emitReasoningSummariesFromResponse(completed, request.runId, onRunEvent);
      }

      return;
    }

    if (type === "response.failed" || type === "response.incomplete" || type === "response.error") {
      throw openAiStreamEventError(event);
    }

    const itemText = outputTextFromVariantEvent(event, outputText.length > 0);

    if (itemText) {
      outputText += itemText;
    }

    const maybeResponse = recordProperty(event, "response");

    if (maybeResponse) {
      responseId = stringProperty(maybeResponse, "id") || responseId;
    }

    if (maybeResponse && stringProperty(maybeResponse, "status").match(/^(failed|incomplete|error)$/i)) {
      throw openAiStreamEventError(event);
    }
  };

  while (true) {
    const { value, done } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      for (const event of parseSseFrame(frame)) {
        handleEvent(event);
      }
    }
  }

  buffer += decoder.decode();

  if (buffer.trim()) {
    for (const event of parseSseFrame(buffer)) {
      handleEvent(event);
    }
  }

  flushSummaryDeltas(summaries, request.runId, onRunEvent);

  return completedResponse
    ? {
        ...completedResponse,
        id: completedResponse.id ?? responseId,
        output_text: responseText(completedResponse) || outputText
      }
    : {
        id: responseId,
        output_text: outputText
      };
}

function parseSseFrame(frame: string) {
  const data = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();

  if (!data || data === "[DONE]") {
    return [];
  }

  try {
    return [JSON.parse(data) as unknown];
  } catch {
    throw malformedProviderResponseError();
  }
}

function handleReasoningSummaryDelta(
  event: Record<string, unknown>,
  summaries: Map<string, OpenAiStreamSummary>,
  runId: string,
  onRunEvent?: AgentThinkingRunEventListener
) {
  const itemId = reasoningItemId(event);
  const summaryIndex = reasoningSummaryIndex(event);
  const key = `${itemId}:${summaryIndex}`;
  const summary = summaries.get(key) ?? { raw: "", emitted: "", lastEmitAt: 0 };
  summary.raw += stringProperty(event, "delta");
  summaries.set(key, summary);

  emitSummaryDelta(summary, runId, itemId, summaryIndex, onRunEvent);
}

function handleReasoningSummaryDone(
  event: Record<string, unknown>,
  summaries: Map<string, OpenAiStreamSummary>,
  runId: string,
  onRunEvent?: AgentThinkingRunEventListener
) {
  const itemId = reasoningItemId(event);
  const summaryIndex = reasoningSummaryIndex(event);
  const key = `${itemId}:${summaryIndex}`;
  const summary = summaries.get(key) ?? { raw: "", emitted: "", lastEmitAt: 0 };
  const raw = stringProperty(event, "text") || summary.raw;
  const text = sanitizeThinkingSummary(raw);

  if (text) {
    onRunEvent?.({
      type: "thinking_done",
      runId,
      itemId,
      summaryIndex,
      text
    });
    summary.emitted = text;
  }

  summary.raw = raw;
  summaries.set(key, summary);
}

function outputTextFromVariantEvent(event: Record<string, unknown>, hasOutputText: boolean) {
  const type = stringProperty(event, "type");

  if (type.includes("reasoning") || type.includes("tool")) {
    return "";
  }

  const delta = event.delta;

  if (isRecord(delta) && typeof delta.text === "string" && type.endsWith(".delta")) {
    return delta.text;
  }

  const part = recordProperty(event, "part") ?? recordProperty(event, "content_part");

  if (part && stringProperty(part, "type").includes("output_text")) {
    return stringProperty(part, "text");
  }

  const item = recordProperty(event, "item") ?? recordProperty(event, "output_item");

  if (!hasOutputText && item && stringProperty(item, "type") === "message") {
    return itemContentText(item);
  }

  return "";
}

function itemContentText(item: Record<string, unknown>) {
  const content = item.content;

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .filter(isRecord)
    .map((part) => {
      const type = stringProperty(part, "type");

      return type === "output_text" || type === "text" ? stringProperty(part, "text") : "";
    })
    .join("");
}

function reasoningItemId(event: Record<string, unknown>) {
  return stringProperty(event, "item_id") || stringProperty(event, "itemId") || "reasoning-summary";
}

function reasoningSummaryIndex(event: Record<string, unknown>) {
  const index = event.summary_index ?? event.summaryIndex ?? event.output_index;
  return typeof index === "number" && Number.isFinite(index) ? index : 0;
}
