import type { AgentDocumentTools } from "../documentTools.js";
import type { AgentRunContextItem } from "../types.js";
import {
  executeAgentDocumentToolCall,
  initialOpenAiToolBudgetState,
  openAiDocumentToolSchemas,
  serializeDocumentToolOutput,
  type OpenAiDocumentToolBudgetState
} from "../openai/documentTools.js";
import type { AgentRuntimeDiagnosticEventListener } from "./provider.js";

export type CodexDocumentToolBudgetState = OpenAiDocumentToolBudgetState;

export interface CodexDocumentToolCall {
  callId: string;
  name: string;
  argumentsValue: unknown;
}

export interface CodexDocumentToolResponse {
  contentItems: Array<{ type: "inputText"; text: string }>;
  success: boolean;
}

export function codexDocumentDynamicTools({ includeOpenDocument = true }: { includeOpenDocument?: boolean } = {}) {
  return openAiDocumentToolSchemas({ includeOpenDocument }).map(({ name, description, parameters }) => ({
    name,
    description,
    inputSchema: parameters
  }));
}

export function initialCodexDocumentToolBudgetState(): CodexDocumentToolBudgetState {
  return initialOpenAiToolBudgetState();
}

export async function executeCodexDocumentToolCall({
  call,
  requestRunId,
  documentTools,
  budget,
  signal,
  allowOpenDocument,
  onDiagnosticEvent,
  onToolContext
}: {
  call: CodexDocumentToolCall;
  requestRunId: string;
  documentTools: AgentDocumentTools;
  budget: CodexDocumentToolBudgetState;
  signal: AbortSignal;
  allowOpenDocument?: boolean;
  onDiagnosticEvent?: AgentRuntimeDiagnosticEventListener;
  onToolContext?: (item: AgentRunContextItem) => void;
}): Promise<CodexDocumentToolResponse> {
  const startedAt = Date.now();
  const result = await executeAgentDocumentToolCall({
    call: {
      name: call.name,
      callId: call.callId,
      argumentsValue: call.argumentsValue
    },
    requestRunId,
    documentTools,
    budget,
    signal,
    allowOpenDocument,
    onToolContext
  });

  onDiagnosticEvent?.({
    event: "provider.tool_call",
    toolName: call.name || "unknown_tool",
    status: result.status,
    durationMs: Date.now() - startedAt,
    resultCount: result.resultCount,
    truncated: result.truncated,
    searchedPaths: result.searchedPaths,
    searchedFiles: result.searchedFiles,
    errorCode: result.errorCode
  });

  const text = serializeDocumentToolOutput(result.result);

  return {
    contentItems: [{ type: "inputText", text }],
    success: result.status === "completed" && isSuccessfulToolOutput(text)
  };
}

export function failedCodexDocumentToolResponse(code: string, message: string): CodexDocumentToolResponse {
  return {
    contentItems: [
      {
        type: "inputText",
        text: serializeDocumentToolOutput({
          ok: false,
          code,
          message
        })
      }
    ],
    success: false
  };
}

function isSuccessfulToolOutput(text: string) {
  try {
    const parsed = JSON.parse(text) as { ok?: unknown };
    return parsed.ok === true;
  } catch {
    return false;
  }
}
