import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentDocumentTools } from "../../electron/agent/documentTools";
import { AgentDocumentToolError, defaultAgentDocumentToolLimits } from "../../electron/agent/documentTools";
import {
  executeAgentDocumentToolCall,
  initialOpenAiToolBudgetState,
  openAiDocumentToolSchemas,
  OPENAI_DOCUMENT_TOOL_BUDGETS
} from "../../electron/agent/openai/documentTools";
import { codexDocumentDynamicTools } from "../../electron/agent/runtime/codexDocumentTools";
import { createOpenAiResponse } from "../../electron/agent/openaiResponses";
import type { AgentRunContextItem, AgentRunRequest } from "../../electron/agent/types";

function providerRequest(overrides: Partial<AgentRunRequest> = {}): AgentRunRequest {
  return {
    runId: `run-tool-loop-${Math.random().toString(16).slice(2)}`,
    workspaceRoot: "/tmp",
    activeFile: null,
    messages: [],
    prompt: "Use the style guide.",
    mode: "balanced",
    language: "en",
    ...overrides
  };
}

function sseResponse(events: unknown[]) {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" }
  });
}

function completedResponse(id: string, output: unknown[]) {
  return {
    type: "response.completed",
    response: {
      id,
      output
    }
  };
}

function messageItem(text: string) {
  return {
    type: "message",
    role: "assistant",
    content: [{ type: "output_text", text }]
  };
}

function functionCallItem(name: string, callId: string, args: string, id = `fc_${callId}`) {
  return {
    id,
    type: "function_call",
    call_id: callId,
    name,
    arguments: args
  };
}

function reasoningItem() {
  return {
    id: "rs_1",
    type: "reasoning",
    summary: [{ type: "summary_text", text: "Finding the right document." }]
  };
}

function documentTools(overrides: Partial<AgentDocumentTools> = {}): AgentDocumentTools {
  return {
    limits: defaultAgentDocumentToolLimits,
    listDocuments: vi.fn(async () => ({
      files: [
        {
          relativePath: "guides/style.md",
          name: "style.md",
          sizeBytes: 64,
          estimatedTokens: 16
        }
      ],
      truncated: false,
      skipped: emptySkippedCounts()
    })) as AgentDocumentTools["listDocuments"],
    searchDocuments: vi.fn(async () => ({
      matches: [
        {
          relativePath: "guides/style.md",
          line: 1,
          matchType: "content",
          excerpt: "Style guide match."
        }
      ],
      truncated: false,
      searchedPaths: 1,
      searchedFiles: 1,
      skipped: emptySkippedCounts()
    })) as AgentDocumentTools["searchDocuments"],
    readDocument: vi.fn(async () => ({
      relativePath: "guides/style.md",
      hash: "hash-style",
      content: "# Style\nUse direct language.\n",
      sizeBytes: 29,
      estimatedTokens: 8
    })) as AgentDocumentTools["readDocument"],
    openDocument: vi.fn(async () => ({
      relativePath: "guides/style.md"
    })) as AgentDocumentTools["openDocument"],
    ...overrides
  };
}

function emptySkippedCounts() {
  return {
    ignored: 0,
    unsafe: 0,
    unreadable: 0,
    oversized: 0,
    nonMarkdown: 0,
    symlink: 0
  };
}

async function createOpenAiResponseWithDocumentTools({
  tools,
  request = providerRequest(),
  onToolContext
}: {
  tools: AgentDocumentTools;
  request?: AgentRunRequest;
  onToolContext?: (item: AgentRunContextItem) => void;
}) {
  const input = {
    apiKey: "test-key",
    model: "gpt-5.5",
    request,
    signal: new AbortController().signal,
    documentTools: tools,
    onToolContext
  };

  return createOpenAiResponse(input as Parameters<typeof createOpenAiResponse>[0]);
}

function outputItems(input: unknown) {
  expect(Array.isArray(input)).toBe(true);
  return input as Array<Record<string, unknown>>;
}

function toolOutputFromRequest(body: Record<string, unknown>, callId: string) {
  const item = outputItems(body.input).find(
    (candidate) => candidate.type === "function_call_output" && candidate.call_id === callId
  );
  expect(item).toMatchObject({
    type: "function_call_output",
    call_id: callId,
    output: expect.any(String)
  });
  return JSON.parse(String(item?.output)) as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenAI document tool loop", () => {
  it("advertises strict document tools and replays read_document output in the Responses transcript", async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    const firstOutput = [
      reasoningItem(),
      functionCallItem("read_document", "call_read_1", JSON.stringify({ path: "guides/style.md" }))
    ];
    const tools = documentTools();
    const toolContextItems: AgentRunContextItem[] = [];

    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      requestBodies.push(JSON.parse(String(init.body)));

      if (requestBodies.length === 1) {
        return sseResponse([completedResponse("resp_read_call", firstOutput)]);
      }

      return sseResponse([completedResponse("resp_final", [messageItem("I used the style guide.")])]);
    });

    const result = await createOpenAiResponseWithDocumentTools({
      tools,
      onToolContext: (item) => toolContextItems.push(item)
    });

    expect(result.text).toBe("I used the style guide.");
    expect(requestBodies).toHaveLength(2);
    expect(requestBodies[0]).toMatchObject({
      tool_choice: "auto",
      parallel_tool_calls: false
    });
    expect(requestBodies[0].tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "function", name: "list_documents", strict: true }),
        expect.objectContaining({ type: "function", name: "search_documents", strict: true }),
        expect.objectContaining({ type: "function", name: "read_document", strict: true })
      ])
    );
    for (const tool of requestBodies[0].tools as Array<Record<string, unknown>>) {
      expect(tool.parameters).toEqual(expect.objectContaining({ additionalProperties: false }));
    }

    expect(tools.readDocument).toHaveBeenCalledWith({ path: "guides/style.md" }, expect.any(AbortSignal));
    const replayedItems = outputItems(requestBodies[1].input);
    expect(replayedItems).toEqual(expect.arrayContaining(firstOutput));
    const toolOutput = toolOutputFromRequest(requestBodies[1], "call_read_1");
    expect(toolOutput).toMatchObject({
      ok: true,
      relativePath: "guides/style.md",
      baseHash: "hash-style",
      estimatedTokens: 8,
      content: "# Style\nUse direct language.\n"
    });
    expect(toolContextItems).toContainEqual(
      expect.objectContaining({
        kind: "document_read",
        relativePath: "guides/style.md",
        inclusion: "full",
        reason: "model_directed_document_read",
        baseHash: "hash-style",
        estimatedTokens: 8
      })
    );
  });

  it("executes search_documents and keeps function-call output out of visible assistant text", async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    const tools = documentTools();

    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      requestBodies.push(JSON.parse(String(init.body)));

      if (requestBodies.length === 1) {
        return sseResponse([
          completedResponse("resp_search_call", [
            functionCallItem("search_documents", "call_search_1", JSON.stringify({ query: "style guide", limit: 3 }))
          ])
        ]);
      }

      return sseResponse([completedResponse("resp_search_final", [messageItem("Found the relevant guide.")])]);
    });

    const result = await createOpenAiResponseWithDocumentTools({ tools });

    expect(result.text).toBe("Found the relevant guide.");
    expect(result.text).not.toContain("Style guide match.");
    expect(tools.searchDocuments).toHaveBeenCalledWith({ query: "style guide", limit: 3 }, expect.any(AbortSignal));
    expect(toolOutputFromRequest(requestBodies[1], "call_search_1")).toMatchObject({
      ok: true,
      matches: [
        {
          relativePath: "guides/style.md",
          line: 1,
          matchType: "content",
          excerpt: "Style guide match."
        }
      ],
      searchedFiles: 1
    });
  });

  it.each([
    {
      name: "unknown tool name",
      call: functionCallItem("write_document", "call_unknown", JSON.stringify({ path: "guides/style.md" })),
      expectedCode: "unknown_tool"
    },
    {
      name: "malformed JSON arguments",
      call: functionCallItem("read_document", "call_malformed", "{"),
      expectedCode: "invalid_arguments"
    },
    {
      name: "non-object arguments",
      call: functionCallItem("read_document", "call_non_object", JSON.stringify("guides/style.md")),
      expectedCode: "invalid_arguments"
    },
    {
      name: "missing required fields",
      call: functionCallItem("read_document", "call_missing", JSON.stringify({})),
      expectedCode: "invalid_arguments"
    },
    {
      name: "extra fields",
      call: functionCallItem("read_document", "call_extra", JSON.stringify({ path: "guides/style.md", extra: true })),
      expectedCode: "invalid_arguments"
    },
    {
      name: "invalid numeric limits",
      call: functionCallItem("search_documents", "call_bad_limit", JSON.stringify({ query: "style", limit: -1 })),
      expectedCode: "invalid_arguments"
    }
  ])("returns a structured tool error for $name", async ({ call, expectedCode }) => {
    const requestBodies: Array<Record<string, unknown>> = [];
    const tools = documentTools();

    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      requestBodies.push(JSON.parse(String(init.body)));

      if (requestBodies.length === 1) {
        return sseResponse([completedResponse("resp_bad_call", [call])]);
      }

      return sseResponse([completedResponse("resp_after_bad_call", [messageItem("Continuing without that tool result.")])]);
    });

    const result = await createOpenAiResponseWithDocumentTools({ tools });

    expect(result.text).toBe("Continuing without that tool result.");
    expect(tools.readDocument).not.toHaveBeenCalled();
    expect(tools.searchDocuments).not.toHaveBeenCalled();
    expect(tools.listDocuments).not.toHaveBeenCalled();
    expect(toolOutputFromRequest(requestBodies[1], String(call.call_id))).toMatchObject({
      ok: false,
      code: expectedCode,
      message: expect.any(String)
    });
  });

  it("caps repeated tool calls and asks the model for final text with tools disabled", async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    const tools = documentTools();

    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      requestBodies.push(JSON.parse(String(init.body)));
      const callNumber = requestBodies.length;

      if (callNumber <= 5) {
        return sseResponse([
          completedResponse(`resp_repeat_${callNumber}`, [
            functionCallItem("read_document", `call_read_${callNumber}`, JSON.stringify({ path: `guides/${callNumber}.md` }))
          ])
        ]);
      }

      return sseResponse([completedResponse("resp_budget_final", [messageItem("I will answer with the context available.")])]);
    });

    const result = await createOpenAiResponseWithDocumentTools({ tools });

    expect(result.text).toBe("I will answer with the context available.");
    expect(tools.readDocument).toHaveBeenCalledTimes(4);
    expect(requestBodies.at(-1)).toMatchObject({ tool_choice: "none" });
    const exhaustedOutput = toolOutputFromRequest(requestBodies.at(-1) ?? {}, "call_read_5");
    expect(exhaustedOutput).toMatchObject({
      ok: false,
      code: "tool_budget_exceeded",
      message: expect.stringContaining("document tool budget")
    });
  });

  it("reserves the final total-call slot for a successful read before allowing more search calls", async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    const calls = [
      functionCallItem("read_document", "call_read_missing", JSON.stringify({ path: "guides/missing.md" })),
      ...Array.from({ length: 7 }, (_value, index) =>
        functionCallItem("search_documents", `call_search_${index + 1}`, JSON.stringify({ query: "style guide", limit: 3 }))
      )
    ];
    const tools = documentTools({
      readDocument: vi.fn(async () => {
        throw new AgentDocumentToolError("not_found", "Missing.");
      }) as AgentDocumentTools["readDocument"]
    });

    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      requestBodies.push(JSON.parse(String(init.body)));

      if (requestBodies.length === 1) {
        return sseResponse([completedResponse("resp_many_tools", calls)]);
      }

      return sseResponse([completedResponse("resp_reserved_final", [messageItem("I need a file choice.")])]);
    });

    const result = await createOpenAiResponseWithDocumentTools({ tools });

    expect(result.text).toBe("I need a file choice.");
    expect(tools.readDocument).toHaveBeenCalledTimes(1);
    expect(tools.searchDocuments).toHaveBeenCalledTimes(6);
    const reservedOutput = toolOutputFromRequest(requestBodies[1], "call_search_7");
    expect(reservedOutput).toMatchObject({
      ok: false,
      code: "tool_budget_exceeded",
      message: expect.stringContaining("final call for read_document")
    });
  });

  it("accepts strict-mode directory: null, passes a directory scope through, and rejects invalid directory types", async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    const tools = documentTools();

    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      requestBodies.push(JSON.parse(String(init.body)));

      if (requestBodies.length === 1) {
        return sseResponse([
          completedResponse("resp_scope_calls", [
            // Strict mode always emits directory (null when unscoped).
            functionCallItem(
              "search_documents",
              "call_null_dir",
              JSON.stringify({ query: "guide", directory: null, limit: 3 })
            ),
            functionCallItem(
              "search_documents",
              "call_scoped",
              JSON.stringify({ query: "guide", directory: "courses", limit: 3 })
            ),
            functionCallItem("search_documents", "call_bad_dir", JSON.stringify({ query: "guide", directory: 123 }))
          ])
        ]);
      }

      return sseResponse([completedResponse("resp_scope_final", [messageItem("Done.")])]);
    });

    const result = await createOpenAiResponseWithDocumentTools({ tools });

    expect(result.text).toBe("Done.");
    expect(tools.searchDocuments).toHaveBeenCalledTimes(2);
    expect(tools.searchDocuments).toHaveBeenCalledWith({ query: "guide", limit: 3 }, expect.any(AbortSignal));
    expect(tools.searchDocuments).toHaveBeenCalledWith(
      { query: "guide", directory: "courses", limit: 3 },
      expect.any(AbortSignal)
    );
    expect(toolOutputFromRequest(requestBodies[1], "call_bad_dir")).toMatchObject({
      ok: false,
      code: "invalid_arguments"
    });
  });

  it("executes open_document on desktop runs, emits its manifest receipt, and gates it off remote runs", async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    const tools = documentTools();
    const toolContextItems: AgentRunContextItem[] = [];

    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      requestBodies.push(JSON.parse(String(init.body)));

      if (requestBodies.length === 1) {
        return sseResponse([
          completedResponse("resp_open_call", [
            functionCallItem("open_document", "call_open_1", JSON.stringify({ path: "guides/style.md" }))
          ])
        ]);
      }

      return sseResponse([completedResponse("resp_open_final", [messageItem("Lo abrí.")])]);
    });

    const result = await createOpenAiResponseWithDocumentTools({
      tools,
      onToolContext: (item) => toolContextItems.push(item)
    });

    expect(result.text).toBe("Lo abrí.");
    expect(tools.openDocument).toHaveBeenCalledWith({ path: "guides/style.md" }, expect.any(AbortSignal));
    expect(toolOutputFromRequest(requestBodies[1], "call_open_1")).toMatchObject({
      ok: true,
      relativePath: "guides/style.md"
    });
    expect(toolContextItems).toContainEqual(
      expect.objectContaining({
        kind: "document_reference",
        relativePath: "guides/style.md",
        inclusion: "available",
        reason: "model_directed_document_open"
      })
    );
    // Desktop schema advertises it; the remote schema list excludes it.
    expect(openAiDocumentToolSchemas().map((schema) => schema.name)).toContain("open_document");
    expect(openAiDocumentToolSchemas({ includeOpenDocument: false }).map((schema) => schema.name)).not.toContain(
      "open_document"
    );
    expect(codexDocumentDynamicTools({ includeOpenDocument: false }).map((tool) => tool.name)).not.toContain(
      "open_document"
    );
  });

  it("rejects open_document as unknown on remote runs and respects the read-reserved budget", async () => {
    const tools = documentTools();
    const remoteRejection = await executeAgentDocumentToolCall({
      call: { name: "open_document", callId: "call_remote", argumentsValue: { path: "guides/style.md" } },
      requestRunId: "run-remote",
      documentTools: tools,
      budget: initialOpenAiToolBudgetState(),
      signal: new AbortController().signal,
      allowOpenDocument: false
    });
    expect(remoteRejection.result).toMatchObject({ ok: false, code: "unknown_tool" });
    expect(tools.openDocument).not.toHaveBeenCalled();

    // open_document behaves like every non-read tool against the reserve.
    const budget = initialOpenAiToolBudgetState();
    budget.totalToolCalls = OPENAI_DOCUMENT_TOOL_BUDGETS.maxTotalToolCalls - 1;
    const reserved = await executeAgentDocumentToolCall({
      call: { name: "open_document", callId: "call_reserved", argumentsValue: { path: "guides/style.md" } },
      requestRunId: "run-reserved",
      documentTools: tools,
      budget,
      signal: new AbortController().signal
    });
    expect(reserved.result).toMatchObject({ ok: false, code: "tool_budget_exceeded" });
    expect(tools.openDocument).not.toHaveBeenCalled();
  });

  it("drops trailing rows instead of failing when search output exceeds the byte cap", async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    const longPath = (index: number) =>
      `courses/${"sub/".repeat(8)}very-long-directory-name-${String(index).padStart(4, "0")}/notes-${index}.md`;
    const tools = documentTools({
      searchDocuments: vi.fn(async () => ({
        matches: Array.from({ length: 500 }, (_, index) => ({
          relativePath: longPath(index),
          line: 0,
          matchType: "path" as const,
          excerpt: "x".repeat(240)
        })),
        truncated: false,
        searchedPaths: 500,
        searchedFiles: 0,
        skipped: emptySkippedCounts()
      })) as AgentDocumentTools["searchDocuments"]
    });

    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      requestBodies.push(JSON.parse(String(init.body)));

      if (requestBodies.length === 1) {
        return sseResponse([
          completedResponse("resp_fit_call", [
            functionCallItem("search_documents", "call_fit", JSON.stringify({ query: "notes" }))
          ])
        ]);
      }

      return sseResponse([completedResponse("resp_fit_final", [messageItem("Done.")])]);
    });

    await createOpenAiResponseWithDocumentTools({ tools });

    const output = toolOutputFromRequest(requestBodies[1], "call_fit") as {
      ok: boolean;
      truncated: boolean;
      matches: unknown[];
    };
    expect(output.ok).toBe(true);
    expect(output.truncated).toBe(true);
    expect(output.matches.length).toBeGreaterThan(0);
    expect(output.matches.length).toBeLessThan(500);
  });
});
