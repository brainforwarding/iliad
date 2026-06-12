import path from "node:path";
import { malformedProviderResponseError } from "../errors.js";
import {
  AgentDocumentToolError,
  type AgentDocumentTools,
  type AgentDocumentToolName,
  type ListDocumentsInput,
  type OpenDocumentInput,
  type ReadDocumentInput,
  type SearchDocumentsInput
} from "../documentTools.js";
import type { AgentRunContextItem } from "../types.js";
import type { OpenAiDiagnosticEventListener, OpenAiInputItem, OpenAiOutputItem } from "./types.js";
import { isRecord } from "./utils.js";

const MAX_TOOL_OUTPUT_BYTES = 96 * 1024;

export const OPENAI_DOCUMENT_TOOL_BUDGETS = {
  maxToolRounds: 4,
  maxTotalToolCalls: 8,
  maxReadDocumentCalls: 4
};

export interface OpenAiDocumentToolBudgetState {
  toolRounds: number;
  totalToolCalls: number;
  readDocumentCalls: number;
  readDocumentSucceeded: boolean;
}

export interface OpenAiDocumentToolCall {
  item: OpenAiOutputItem;
  name: string;
  callId: string;
  argumentsText: string;
}

export interface AgentDocumentToolCallInput {
  name: string;
  callId: string;
  argumentsText?: string;
  argumentsValue?: unknown;
}

export interface AgentDocumentToolCallResult {
  result: unknown;
  exhaustedBudget: boolean;
  status: "completed" | "failed";
  resultCount: number;
  searchedPaths?: number;
  searchedFiles?: number;
  truncated?: boolean;
  errorCode?: string;
}

export function openAiDocumentToolSchemas({ includeOpenDocument = true }: { includeOpenDocument?: boolean } = {}) {
  const schemas = [
    {
      type: "function",
      name: "list_documents",
      description: "List visible Markdown documents in the current Iliad workspace.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          directory: {
            type: ["string", "null"],
            description: "Optional workspace-relative directory to list."
          },
          depth: {
            type: ["integer", "null"],
            description: "Optional directory depth."
          },
          limit: {
            type: ["integer", "null"],
            description: "Optional maximum number of documents."
          }
        },
        required: ["directory", "depth", "limit"],
        additionalProperties: false
      }
    },
    {
      type: "function",
      name: "search_documents",
      description: "Search visible Markdown document paths and contents in the current Iliad workspace.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Lexical search query."
          },
          directory: {
            type: ["string", "null"],
            description: "Optional workspace-relative directory to scope the search."
          },
          limit: {
            type: ["integer", "null"],
            description: "Optional maximum number of matches."
          }
        },
        required: ["query", "directory", "limit"],
        additionalProperties: false
      }
    },
    {
      type: "function",
      name: "read_document",
      description: "Read one visible Markdown document by workspace-relative path.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Workspace-relative Markdown path."
          }
        },
        required: ["path"],
        additionalProperties: false
      }
    }
  ];

  if (includeOpenDocument) {
    schemas.push({
      type: "function",
      name: "open_document",
      description: "Open one visible Markdown document in the Iliad editor so the user can see it.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Workspace-relative Markdown path."
          }
        },
        required: ["path"],
        additionalProperties: false
      }
    });
  }

  return schemas;
}

export function initialOpenAiToolBudgetState(): OpenAiDocumentToolBudgetState {
  return {
    toolRounds: 0,
    totalToolCalls: 0,
    readDocumentCalls: 0,
    readDocumentSucceeded: false
  };
}

export function openAiFunctionCalls(output: OpenAiOutputItem[] | undefined): OpenAiDocumentToolCall[] {
  const calls: OpenAiDocumentToolCall[] = [];

  for (const item of output ?? []) {
    if (item.type !== "function_call") {
      continue;
    }

    const name = typeof item.name === "string" ? item.name : "";
    const callId = typeof item.call_id === "string" ? item.call_id : "";
    const argumentsText = typeof item.arguments === "string" ? item.arguments : "";

    if (!callId) {
      throw malformedProviderResponseError();
    }

    calls.push({ item, name, callId, argumentsText });
  }

  return calls;
}

export function functionCallOutputItem(call: OpenAiDocumentToolCall, output: unknown): OpenAiInputItem {
  return {
    type: "function_call_output",
    call_id: call.callId,
    output: serializeDocumentToolOutput(output)
  };
}

export function toolBudgetExceededOutput(call: OpenAiDocumentToolCall): OpenAiInputItem {
  return functionCallOutputItem(call, toolError("tool_budget_exceeded"));
}

export async function executeOpenAiDocumentToolCall({
  call,
  requestRunId,
  documentTools,
  budget,
  signal,
  allowOpenDocument,
  onDiagnosticEvent,
  onToolContext
}: {
  call: OpenAiDocumentToolCall;
  requestRunId: string;
  documentTools: AgentDocumentTools;
  budget: OpenAiDocumentToolBudgetState;
  signal: AbortSignal;
  allowOpenDocument?: boolean;
  onDiagnosticEvent?: OpenAiDiagnosticEventListener;
  onToolContext?: (item: AgentRunContextItem) => void;
}): Promise<{ outputItem: OpenAiInputItem; exhaustedBudget: boolean }> {
  const startedAt = Date.now();
  let diagnosticResult: AgentDocumentToolCallResult | undefined;

  try {
    const result = await executeAgentDocumentToolCall({
      call,
      requestRunId,
      documentTools,
      budget,
      signal,
      allowOpenDocument,
      onToolContext
    });
    diagnosticResult = result;

    return {
      outputItem: functionCallOutputItem(call, result.result),
      exhaustedBudget: result.exhaustedBudget
    };
  } finally {
    onDiagnosticEvent?.({
      event: "provider.tool_call",
      toolName: call.name || "unknown_tool",
      status: diagnosticResult?.status ?? "failed",
      durationMs: Date.now() - startedAt,
      resultCount: diagnosticResult?.resultCount ?? 0,
      truncated: diagnosticResult?.truncated,
      searchedPaths: diagnosticResult?.searchedPaths,
      searchedFiles: diagnosticResult?.searchedFiles,
      errorCode: diagnosticResult?.errorCode
    });
  }
}

export async function executeAgentDocumentToolCall({
  call,
  requestRunId,
  documentTools,
  budget,
  signal,
  allowOpenDocument = true,
  onToolContext
}: {
  call: AgentDocumentToolCallInput;
  requestRunId: string;
  documentTools: AgentDocumentTools;
  budget: OpenAiDocumentToolBudgetState;
  signal: AbortSignal;
  allowOpenDocument?: boolean;
  onToolContext?: (item: AgentRunContextItem) => void;
}): Promise<AgentDocumentToolCallResult> {
  let status: "completed" | "failed" = "failed";
  let resultCount = 0;
  let searchedPaths: number | undefined;
  let searchedFiles: number | undefined;
  let truncated: boolean | undefined;
  let errorCode: string | undefined;
  let exhaustedBudget = false;

  try {
    throwIfAborted(signal);
    const parsedArguments = parseToolArguments(call);

    if (!isAllowedDocumentToolName(call.name) || (call.name === "open_document" && !allowOpenDocument)) {
      errorCode = "unknown_tool";
      return {
        result: toolError("unknown_tool"),
        exhaustedBudget,
        status,
        resultCount,
        errorCode
      };
    }

    const validatedInput = validateToolInput(call.name, parsedArguments, documentTools);

    if (call.name === "read_document" && budget.readDocumentCalls >= OPENAI_DOCUMENT_TOOL_BUDGETS.maxReadDocumentCalls) {
      exhaustedBudget = true;
      errorCode = "tool_budget_exceeded";
      return {
        result: toolError("tool_budget_exceeded"),
        exhaustedBudget,
        status,
        resultCount,
        errorCode
      };
    }

    if (
      call.name !== "read_document" &&
      !budget.readDocumentSucceeded &&
      budget.totalToolCalls >= OPENAI_DOCUMENT_TOOL_BUDGETS.maxTotalToolCalls - 1
    ) {
      exhaustedBudget = true;
      errorCode = "tool_budget_exceeded";
      return {
        result: toolError("tool_budget_exceeded", "read_reserved"),
        exhaustedBudget,
        status,
        resultCount,
        errorCode
      };
    }

    if (budget.totalToolCalls >= OPENAI_DOCUMENT_TOOL_BUDGETS.maxTotalToolCalls) {
      exhaustedBudget = true;
      errorCode = "tool_budget_exceeded";
      return {
        result: toolError("tool_budget_exceeded"),
        exhaustedBudget,
        status,
        resultCount,
        errorCode
      };
    }

    budget.totalToolCalls += 1;

    const output = await executeValidatedTool({
      call,
      requestRunId,
      documentTools,
      validatedInput,
      budget,
      signal,
      onToolContext
    });

    status = "completed";
    resultCount = output.resultCount;
    searchedPaths = output.searchedPaths;
    searchedFiles = output.searchedFiles;
    truncated = output.truncated;
    return {
      result: output.result,
      exhaustedBudget,
      status,
      resultCount,
      searchedPaths,
      searchedFiles,
      truncated
    };
  } catch (error) {
    const result = toolErrorFromUnknown(error);
    errorCode = result.code;
    maybeEmitFailedReadContext({ call, requestRunId, onToolContext });
    return {
      result,
      exhaustedBudget,
      status,
      resultCount,
      searchedPaths,
      searchedFiles,
      truncated,
      errorCode
    };
  }
}

async function executeValidatedTool({
  call,
  requestRunId,
  documentTools,
  validatedInput,
  budget,
  signal,
  onToolContext
}: {
  call: AgentDocumentToolCallInput;
  requestRunId: string;
  documentTools: AgentDocumentTools;
  validatedInput: ListDocumentsInput | SearchDocumentsInput | ReadDocumentInput;
  budget: OpenAiDocumentToolBudgetState;
  signal: AbortSignal;
  onToolContext?: (item: AgentRunContextItem) => void;
}) {
  if (call.name === "list_documents") {
    const input = validatedInput as ListDocumentsInput;
    const result = await documentTools.listDocuments(input, signal);
    throwIfAborted(signal);
    const output = {
      ok: true,
      files: result.files,
      truncated: result.truncated
    };
    onToolContext?.(genericToolContextItem({
      requestRunId,
      call,
      label: "Document list",
      inclusion: "available",
      reason: "model_directed_document_list",
      resultCount: result.files.length,
      truncated: result.truncated
    }));
    return {
      result: output,
      resultCount: result.files.length,
      truncated: result.truncated
    };
  }

  if (call.name === "search_documents") {
    const input = validatedInput as SearchDocumentsInput;
    const result = await documentTools.searchDocuments(input, signal);
    throwIfAborted(signal);
    const output = {
      ok: true,
      matches: result.matches,
      truncated: result.truncated,
      searchedPaths: result.searchedPaths,
      searchedFiles: result.searchedFiles
    };
    onToolContext?.(genericToolContextItem({
      requestRunId,
      call,
      label: "Document search",
      inclusion: "reference",
      reason: "model_directed_document_search",
      resultCount: result.matches.length,
      searchedPaths: result.searchedPaths,
      searchedFiles: result.searchedFiles,
      truncated: result.truncated
    }));
    return {
      result: output,
      resultCount: result.matches.length,
      searchedPaths: result.searchedPaths,
      searchedFiles: result.searchedFiles,
      truncated: result.truncated
    };
  }

  if (call.name === "open_document") {
    const input = validatedInput as OpenDocumentInput;
    const result = await documentTools.openDocument(input, signal);
    throwIfAborted(signal);
    onToolContext?.({
      id: `model-document-open-${safeIdPart(call.callId)}`,
      kind: "document_reference",
      label: path.posix.basename(result.relativePath) || result.relativePath,
      relativePath: result.relativePath,
      inclusion: "available",
      reason: "model_directed_document_open",
      correlationId: call.callId
    });
    return {
      result: { ok: true, relativePath: result.relativePath },
      resultCount: 1
    };
  }

  const input = validatedInput as ReadDocumentInput;
  budget.readDocumentCalls += 1;
  const result = await documentTools.readDocument(input, signal);
  budget.readDocumentSucceeded = true;
  throwIfAborted(signal);
  const output = fitSerializedToolOutput({
    ok: true,
    relativePath: result.relativePath,
    baseHash: result.hash,
    estimatedTokens: result.estimatedTokens,
    content: result.content
  });
  onToolContext?.({
    id: `model-document-read-${safeIdPart(call.callId)}`,
    kind: "document_read",
    label: path.posix.basename(result.relativePath) || "Document",
    relativePath: result.relativePath,
    inclusion: "full",
    reason: "model_directed_document_read",
    baseHash: result.hash,
    estimatedTokens: result.estimatedTokens,
    correlationId: call.callId
  });
  return {
    result: output,
    resultCount: 1
  };
}

function validateListDocumentsInput(args: Record<string, unknown>, documentTools: AgentDocumentTools): ListDocumentsInput {
  rejectExtraProperties(args, ["directory", "depth", "limit"]);
  const input: ListDocumentsInput = {};

  if (args.directory !== undefined && args.directory !== null) {
    if (typeof args.directory !== "string") {
      throw validationError();
    }

    input.directory = args.directory;
  }

  if (args.depth !== undefined && args.depth !== null) {
    input.depth = boundedInteger(args.depth, documentTools.limits.maxDepth);
  }

  if (args.limit !== undefined && args.limit !== null) {
    input.limit = boundedInteger(args.limit, documentTools.limits.maxListResults);
  }

  return input;
}

function validateSearchDocumentsInput(args: Record<string, unknown>, documentTools: AgentDocumentTools): SearchDocumentsInput {
  rejectExtraProperties(args, ["query", "directory", "limit"]);

  if (typeof args.query !== "string") {
    throw validationError();
  }

  const input: SearchDocumentsInput = { query: args.query };

  if (args.directory !== undefined && args.directory !== null) {
    if (typeof args.directory !== "string") {
      throw validationError();
    }

    input.directory = args.directory;
  }

  if (args.limit !== undefined && args.limit !== null) {
    input.limit = boundedInteger(args.limit, documentTools.limits.maxSearchResults);
  }

  return input;
}

function validateReadDocumentInput(args: Record<string, unknown>): ReadDocumentInput {
  rejectExtraProperties(args, ["path"]);

  if (typeof args.path !== "string") {
    throw validationError();
  }

  return { path: args.path };
}

function validateToolInput(
  name: AgentDocumentToolName,
  parsedArguments: Record<string, unknown>,
  documentTools: AgentDocumentTools
) {
  if (name === "list_documents") {
    return validateListDocumentsInput(parsedArguments, documentTools);
  }

  if (name === "search_documents") {
    return validateSearchDocumentsInput(parsedArguments, documentTools);
  }

  // read_document and open_document share the single-path input shape.
  return validateReadDocumentInput(parsedArguments);
}

function parseToolArguments(call: AgentDocumentToolCallInput) {
  if ("argumentsValue" in call) {
    if (!isPlainObject(call.argumentsValue)) {
      throw validationError();
    }

    return call.argumentsValue;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(call.argumentsText || "{}");
  } catch {
    throw validationError();
  }

  if (!isPlainObject(parsed)) {
    throw validationError();
  }

  return parsed;
}

function rejectExtraProperties(args: Record<string, unknown>, allowed: string[]) {
  const allowedSet = new Set(allowed);

  for (const key of Object.keys(args)) {
    if (!allowedSet.has(key)) {
      throw validationError();
    }
  }
}

function boundedInteger(value: unknown, max: number) {
  if (!Number.isInteger(value) || typeof value !== "number" || value < 1 || value > max) {
    throw validationError();
  }

  return value;
}

export function serializeDocumentToolOutput(output: unknown) {
  const fitted = fitSerializedToolOutput(output);
  const serialized = JSON.stringify(fitted);

  if (Buffer.byteLength(serialized, "utf8") <= MAX_TOOL_OUTPUT_BYTES) {
    return serialized;
  }

  return JSON.stringify(toolError("tool_output_too_large"));
}

function fitSerializedToolOutput(output: unknown): unknown {
  if (!isRecord(output)) {
    return output;
  }

  if (typeof output.content === "string") {
    let next: Record<string, unknown> = { ...output, truncated: false };

    if (Buffer.byteLength(JSON.stringify(next), "utf8") <= MAX_TOOL_OUTPUT_BYTES) {
      return output;
    }

    let content = output.content;
    while (content.length > 0) {
      content = content.slice(0, Math.floor(content.length * 0.8));
      next = { ...output, content, truncated: true };

      if (Buffer.byteLength(JSON.stringify(next), "utf8") <= MAX_TOOL_OUTPUT_BYTES) {
        return next;
      }
    }

    return toolError("tool_output_too_large");
  }

  // List/search outputs degrade by dropping trailing rows instead of failing
  // wholesale: with deep paths, 500 rows can exceed the byte cap, and a partial
  // result is strictly more useful than tool_output_too_large.
  const arrayKey = Array.isArray(output.files) ? "files" : Array.isArray(output.matches) ? "matches" : null;

  if (!arrayKey) {
    return output;
  }

  if (Buffer.byteLength(JSON.stringify(output), "utf8") <= MAX_TOOL_OUTPUT_BYTES) {
    return output;
  }

  let rows = output[arrayKey] as unknown[];

  while (rows.length > 0) {
    rows = rows.slice(0, Math.floor(rows.length * 0.8));
    const next = { ...output, [arrayKey]: rows, truncated: true };

    if (Buffer.byteLength(JSON.stringify(next), "utf8") <= MAX_TOOL_OUTPUT_BYTES) {
      return next;
    }
  }

  return toolError("tool_output_too_large");
}

function toolErrorFromUnknown(error: unknown) {
  if (error instanceof AgentDocumentToolError) {
    return toolError(error.code);
  }

  if (isToolValidationError(error)) {
    return toolError(error.code);
  }

  throw error;
}

function toolError(code: string, variant?: "read_reserved") {
  return {
    ok: false,
    code,
    message:
      code === "tool_budget_exceeded"
        ? variant === "read_reserved"
          ? "The document tool budget is reserving the final call for read_document. Read one of the existing matches or ask a focused clarification."
          : "The document tool budget is exhausted. Answer with the context already available."
        : "Document tool call failed."
  };
}

function validationError(code = "invalid_arguments") {
  return { name: "OpenAiDocumentToolValidationError", code };
}

function isToolValidationError(error: unknown): error is { code: string } {
  return isRecord(error) && error.name === "OpenAiDocumentToolValidationError" && typeof error.code === "string";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function isAllowedDocumentToolName(name: string): name is AgentDocumentToolName {
  return name === "list_documents" || name === "search_documents" || name === "read_document" || name === "open_document";
}

function genericToolContextItem({
  requestRunId,
  call,
  label,
  inclusion,
  reason,
  resultCount,
  searchedPaths,
  searchedFiles,
  truncated
}: {
  requestRunId: string;
  call: AgentDocumentToolCallInput;
  label: string;
  inclusion: "available" | "reference";
  reason: string;
  resultCount: number;
  searchedPaths?: number;
  searchedFiles?: number;
  truncated?: boolean;
}): AgentRunContextItem {
  return {
    id: `model-document-${reason}-${safeIdPart(requestRunId)}-${safeIdPart(call.callId)}`,
    kind: "document_reference",
    label,
    inclusion,
    reason,
    correlationId: call.callId,
    resultCount,
    ...(searchedPaths !== undefined ? { searchedPaths } : {}),
    ...(searchedFiles !== undefined ? { searchedFiles } : {}),
    ...(truncated !== undefined ? { truncated } : {})
  };
}

function maybeEmitFailedReadContext({
  call,
  requestRunId,
  onToolContext
}: {
  call: AgentDocumentToolCallInput;
  requestRunId: string;
  onToolContext?: (item: AgentRunContextItem) => void;
}) {
  if (call.name !== "read_document" && call.name !== "open_document") {
    return;
  }

  const failureKind = call.name === "open_document" ? "open" : "read";
  const safePath = safeReadPathFromArguments(call);
  onToolContext?.({
    id: `model-document-${failureKind}-failed-${safeIdPart(requestRunId)}-${safeIdPart(call.callId)}`,
    kind: "document_reference",
    label: safePath ? path.posix.basename(safePath) || safePath : `Document ${failureKind} failed`,
    ...(safePath ? { relativePath: safePath } : {}),
    inclusion: "excluded",
    reason: `model_directed_document_${failureKind}_failed`,
    correlationId: call.callId
  });
}

function safeReadPathFromArguments(call: AgentDocumentToolCallInput) {
  let parsed: unknown;

  if ("argumentsValue" in call) {
    parsed = call.argumentsValue;
  } else {
    try {
      parsed = JSON.parse(call.argumentsText || "{}");
    } catch {
      return undefined;
    }
  }

  if (!isRecord(parsed) || typeof parsed.path !== "string") {
    return undefined;
  }

  const normalized = parsed.path.trim().replace(/\\/g, "/");

  if (!normalized || path.isAbsolute(normalized)) {
    return undefined;
  }

  const segments = normalized.split("/");

  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment.startsWith("."))) {
    return undefined;
  }

  return normalized;
}

function safeIdPart(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 80) || "tool-call";
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) {
    signal.throwIfAborted();
  }
}
