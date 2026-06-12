import type { AgentProviderRunRequest } from "../types.js";
import { openAiDocumentToolSchemas } from "./documentTools.js";
import { instructions, userInput } from "./prompts.js";
import type { OpenAiRequestOptions } from "./types.js";

function modeToReasoningEffort(mode: AgentProviderRunRequest["mode"]) {
  if (mode === "fast") {
    return "low";
  }

  if (mode === "deep") {
    return "high";
  }

  return "medium";
}

export function openAiRequestBody(model: string, request: AgentProviderRunRequest, options?: OpenAiRequestOptions) {
  const body: Record<string, unknown> = {
    model,
    instructions: instructions(request),
    input: options?.input ?? userInput(request),
    max_output_tokens: 4096
  };

  if (options) {
    body.stream = true;

    if (options.reasoning) {
      body.reasoning = {
        effort: modeToReasoningEffort(request.mode),
        summary: "auto"
      };
    }

    if (options.textVerbosity) {
      body.text = {
        verbosity: "low"
      };
    }
  }

  if (options?.tools) {
    // UI navigation has no remote surface: the open tool exists only on desktop runs.
    body.tools = openAiDocumentToolSchemas({ includeOpenDocument: request.runProfile !== "remote_read_only" });
    body.tool_choice = options.toolChoice ?? "auto";
    body.parallel_tool_calls = false;
  }

  return body;
}

export async function postOpenAiResponse({
  apiKey,
  model,
  request,
  signal,
  options
}: {
  apiKey: string;
  model: string;
  request: AgentProviderRunRequest;
  signal: AbortSignal;
  options?: OpenAiRequestOptions;
}) {
  return fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(openAiRequestBody(model, request, options))
  });
}
