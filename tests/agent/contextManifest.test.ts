import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildAgentRunContextManifest,
  estimateTokensFromText,
  serializeAgentRunContextManifest
} from "../../electron/agent/contextManifest";
import { AgentContextManifestStore } from "../../electron/agent/contextManifestStore";
import { AgentService, cleanupCodexSupersededDiscoveryRows } from "../../electron/agent/agentService";
import { CODEX_APP_SERVER_PROVIDER_METADATA } from "../../electron/agent/runtime/codexAppServerProvider";
import { OPENAI_RESPONSES_PROVIDER_METADATA } from "../../electron/agent/runtime/openaiResponsesProvider";
import type { AgentRunContextItem, AgentRunContextManifest, AgentRunEvent, AgentRunRequest } from "../../electron/agent/types";

let root = "";
let userData = "";
let createdServices: AgentService[] = [];

const unavailableCodexClient = {
  status: async () => ({
    available: false,
    connected: false,
    requiresOpenaiAuth: true,
    pendingLogin: false
  }),
  dispose: () => undefined
};

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "iliad-context-workspace-"));
  userData = await mkdtemp(path.join(os.tmpdir(), "iliad-context-userdata-"));
  createdServices = [];
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(createdServices.map((service) => flushServiceDiagnostics(service)));
  for (const service of createdServices) {
    service.dispose();
  }
  await rm(root, { recursive: true, force: true });
  await rm(userData, { recursive: true, force: true });
});

function request(overrides: Partial<AgentRunRequest> = {}): AgentRunRequest {
  return {
    runId: "run-context-test",
    workspaceRoot: root,
    activeFile: null,
    messages: [],
    prompt: "Help with this document.",
    mode: "balanced",
    language: "en",
    ...overrides
  };
}

function manifest(overrides: Partial<AgentRunContextManifest> = {}): AgentRunContextManifest {
  return {
    ...buildAgentRunContextManifest({
      request: request(),
      provider: OPENAI_RESPONSES_PROVIDER_METADATA,
      model: "gpt-5.5",
      workspaceId: "workspace_test",
      now: new Date(0).toISOString()
    }),
    ...overrides
  };
}

function contextItem(overrides: Partial<AgentRunContextItem>): AgentRunContextItem {
  return {
    id: "item-1",
    kind: "document_reference",
    label: "Document search",
    inclusion: "reference",
    reason: "model_directed_document_search",
    ...overrides
  };
}

function sseResponse(events: unknown[], status = 200) {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    status,
    headers: { "Content-Type": "text/event-stream" }
  });
}

function serviceWithFakeCodex(userDataPath = userData) {
  const service = new AgentService(userDataPath);
  (service as unknown as { codexAppServerClient: typeof unavailableCodexClient }).codexAppServerClient =
    unavailableCodexClient;
  createdServices.push(service);
  return service;
}

function flushServiceDiagnostics(service: AgentService) {
  return (service as unknown as { diagnostics: { flush(): Promise<void> } }).diagnostics.flush();
}

describe("agent context manifest", () => {
  it("builds an active-file manifest without storing document content", async () => {
    const content = "ACTIVE_DOC_SENTINEL\nThis content must not be serialized as context text.";
    const activePath = path.join(root, "notes", "doc.md");
    const built = buildAgentRunContextManifest({
      request: request({
        activeFile: {
          path: activePath,
          relativePath: "notes/doc.md",
          content,
          baseHash: "base-hash-test"
        },
        messages: [{ role: "user", content: "MESSAGE_SENTINEL" }],
        prompt: "PROMPT_SENTINEL"
      }),
      provider: OPENAI_RESPONSES_PROVIDER_METADATA,
      model: "gpt-5.5",
      workspaceId: "workspace_test",
      now: new Date(0).toISOString()
    });

    expect(built.workspaceLabel).toBe(path.basename(root));
    expect(built.workspaceRootPersisted).toBe(false);
    expect(built.items).toContainEqual({
      id: "current-file",
      kind: "current_file",
      label: "doc.md",
      relativePath: "notes/doc.md",
      inclusion: "full",
      reason: "active_markdown_file",
      baseHash: "base-hash-test",
      estimatedTokens: estimateTokensFromText(content)
    });
    expect(JSON.stringify(built)).not.toContain(content);
    expect(JSON.stringify(built)).not.toContain(activePath);
  });

  it("records manual attachment context as metadata-only manifest rows", () => {
    const built = buildAgentRunContextManifest({
      request: {
        ...request({ runId: "run-manual-context-manifest" }),
        contextDocuments: [
          {
            correlationId: "ctx-manual",
            relativePath: "notes/manual.md",
            content: "MANUAL_CONTEXT_CONTENT_SENTINEL",
            baseHash: "manual-hash",
            estimatedTokens: 7,
            source: "manual_attachment"
          }
        ],
        unresolvedContextReferences: [
          {
            correlationId: "ctx-missing-manual",
            safeDisplayPath: "missing.md",
            reason: "not_found",
            source: "manual_attachment"
          }
        ]
      },
      provider: OPENAI_RESPONSES_PROVIDER_METADATA,
      model: "gpt-5.5",
      workspaceId: "workspace_test"
    });

    expect(built.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "document_read",
          relativePath: "notes/manual.md",
          reason: "manual_context_attachment",
          baseHash: "manual-hash",
          estimatedTokens: 7
        }),
        expect.objectContaining({
          kind: "document_reference",
          relativePath: "missing.md",
          reason: "manual_context_attachment_unresolved"
        })
      ])
    );
    expect(JSON.stringify(built)).not.toContain("MANUAL_CONTEXT_CONTENT_SENTINEL");
  });

  it("records provider-appropriate workspace items when no file is active", () => {
    const openAi = buildAgentRunContextManifest({
      request: request(),
      provider: OPENAI_RESPONSES_PROVIDER_METADATA,
      model: "gpt-5.5",
      workspaceId: "workspace_test"
    });
    const codex = buildAgentRunContextManifest({
      request: request(),
      provider: {
        ...OPENAI_RESPONSES_PROVIDER_METADATA,
        id: "codex-app-server",
        label: "Codex",
        billing: "codex_account",
        capabilities: {
          ...OPENAI_RESPONSES_PROVIDER_METADATA.capabilities,
          workspaceEvents: true,
          managedAccountAuth: true,
          rateLimits: true
        }
      },
      model: "gpt-5.5",
      workspaceId: "workspace_test"
    });

    expect(openAi.items.some((item) => item.kind === "current_file")).toBe(false);
    expect(openAi.items).toContainEqual({
      id: "other-workspace-files",
      kind: "workspace_scope",
      label: "Other workspace files",
      inclusion: "excluded",
      reason: "openai_api_current_request_only"
    });
    expect(codex.items).toContainEqual({
      id: "runtime-workspace",
      kind: "runtime_workspace",
      label: "Workspace runtime",
      inclusion: "available",
      reason: "codex_workspace_runtime"
    });
  });

  it("persists, updates, prunes old records, and survives malformed JSON", async () => {
    const store = new AgentContextManifestStore(userData);

    await store.saveManifest(manifest());
    await expect(store.updateManifest("run-context-test", {
      status: "completed",
      updatedAt: new Date(1).toISOString(),
      responseId: "resp_test",
      proposalIds: ["proposal-test"]
    })).resolves.toMatchObject({
      status: "completed",
      responseId: "resp_test",
      proposalIds: ["proposal-test"]
    });

    await expect(store.getManifest("run-context-test")).resolves.toMatchObject({
      runId: "run-context-test",
      status: "completed"
    });

    for (let index = 0; index < 205; index += 1) {
      await store.saveManifest(
        manifest({
          id: `manifest-prune-${index}`,
          runId: `run-prune-${index}`,
          createdAt: new Date(1_000 + index).toISOString(),
          updatedAt: new Date(1_000 + index).toISOString()
        })
      );
    }

    const raw = JSON.parse(await readFile(path.join(userData, "assistant", "context-manifests.json"), "utf8"));
    expect(raw).toHaveLength(200);
    expect(raw.some((item: AgentRunContextManifest) => item.runId === "run-prune-204")).toBe(true);

    await writeFile(path.join(userData, "assistant", "context-manifests.json"), "{ malformed", "utf8");
    await expect(store.saveManifest(manifest({ runId: "run-after-malformed" }))).resolves.toMatchObject({
      runId: "run-after-malformed"
    });

    await writeFile(path.join(userData, "assistant", "context-manifests.json"), "[null]", "utf8");
    await expect(store.saveManifest(manifest({ runId: "run-after-bad-record" }))).resolves.toMatchObject({
      runId: "run-after-bad-record"
    });
  });

  it("allowlists persisted fields and excludes document, prompt, response, proposal, path, key, and stack data", async () => {
    const store = new AgentContextManifestStore(userData);
    const absoluteActivePath = path.join(root, "secret.md");
    await store.saveManifest({
      ...manifest({
        id: "manifest-privacy",
        runId: "run-privacy",
        workspaceId: await store.workspaceId(root),
        responseId: "resp_privacy",
        proposalIds: ["proposal-privacy"],
        error: {
          code: "unknown",
          userMessage: "Safe user message.",
          retryable: true
        }
      }),
      activeFile: { content: "ACTIVE_DOC_SENTINEL", path: absoluteActivePath },
      prompt: "PROMPT_SENTINEL",
      messages: [{ content: "MESSAGE_SENTINEL" }],
      text: "ASSISTANT_RESPONSE_SENTINEL",
      apiKey: "sk-proj-SHOULD_NOT_PERSIST",
      stack: "Error: raw\n    at stack",
      cause: { message: "nested cause" },
      proposal: {
        baseContent: "PROPOSAL_BASE_SENTINEL",
        replacement: "PROPOSAL_REPLACEMENT_SENTINEL",
        content: "PROPOSAL_CONTENT_SENTINEL",
        unifiedDiff: "PROPOSAL_DIFF_SENTINEL"
      }
    } as unknown as AgentRunContextManifest);

    const raw = await readFile(path.join(userData, "assistant", "context-manifests.json"), "utf8");

    expect(raw).not.toContain("ACTIVE_DOC_SENTINEL");
    expect(raw).not.toContain("PROMPT_SENTINEL");
    expect(raw).not.toContain("MESSAGE_SENTINEL");
    expect(raw).not.toContain("ASSISTANT_RESPONSE_SENTINEL");
    expect(raw).not.toContain("PROPOSAL_BASE_SENTINEL");
    expect(raw).not.toContain("PROPOSAL_REPLACEMENT_SENTINEL");
    expect(raw).not.toContain("PROPOSAL_CONTENT_SENTINEL");
    expect(raw).not.toContain("PROPOSAL_DIFF_SENTINEL");
    expect(raw).not.toContain(root);
    expect(raw).not.toContain(absoluteActivePath);
    expect(raw).not.toContain("sk-proj-SHOULD_NOT_PERSIST");
    expect(raw).not.toContain("raw");
    expect(raw).not.toContain("nested cause");
  });

  it("allowlists document read/reference ledger metadata without persisting explicit context content", () => {
    const serialized = serializeAgentRunContextManifest({
      ...manifest({
        items: [
          {
            id: "document-read-guides-style",
            kind: "document_read",
            label: "SHOULD_BE_REPLACED_BY_BASENAME",
            relativePath: "guides/style.md",
            inclusion: "full",
            reason: "explicit_file_mention",
            baseHash: "hash-style",
            estimatedTokens: 12,
            correlationId: "ctx-style",
            content: "DOCUMENT_READ_CONTENT_SENTINEL"
          },
          {
            id: "document-reference-missing",
            kind: "document_reference",
            label: "SHOULD_BE_REPLACED_BY_BASENAME",
            relativePath: "missing.md",
            inclusion: "excluded",
            reason: "explicit_file_mention_unresolved",
            correlationId: "ctx-missing",
            unsafeMention: "../secret.md"
          },
          {
            id: "document-reference-unsafe",
            kind: "document_reference",
            label: "Unresolved document reference",
            inclusion: "excluded",
            reason: "explicit_file_mention_unresolved",
            correlationId: "ctx-unsafe",
            unsafeMention: "../secret.md"
          }
        ] as unknown as AgentRunContextManifest["items"]
      })
    });

    expect(serialized.items).toEqual([
      {
        id: "document-read-guides-style",
        kind: "document_read",
        label: "style.md",
        relativePath: "guides/style.md",
        inclusion: "full",
        reason: "explicit_file_mention",
        baseHash: "hash-style",
        estimatedTokens: 12,
        correlationId: "ctx-style"
      },
      {
        id: "document-reference-missing",
        kind: "document_reference",
        label: "missing.md",
        relativePath: "missing.md",
        inclusion: "excluded",
        reason: "explicit_file_mention_unresolved",
        correlationId: "ctx-missing"
      },
      {
        id: "document-reference-unsafe",
        kind: "document_reference",
        label: "Unresolved document reference",
        inclusion: "excluded",
        reason: "explicit_file_mention_unresolved",
        correlationId: "ctx-unsafe"
      }
    ]);
    expect(JSON.stringify(serialized)).not.toContain("DOCUMENT_READ_CONTENT_SENTINEL");
    expect(JSON.stringify(serialized)).not.toContain("../secret.md");
  });

  it("preserves searched path counts in serialized model-directed discovery rows", () => {
    const serialized = serializeAgentRunContextManifest({
      ...manifest({
        items: [
          contextItem({
            id: "search-1",
            resultCount: 0,
            searchedPaths: 8,
            searchedFiles: 12,
            truncated: true
          })
        ]
      })
    });

    expect(serialized.items[0]).toEqual(
      expect.objectContaining({
        resultCount: 0,
        searchedPaths: 8,
        searchedFiles: 12,
        truncated: true
      })
    );
  });

  it("cleans up only superseded zero-result capped Codex discovery rows", () => {
    const items = [
      contextItem({
        id: "zero-before-read",
        reason: "model_directed_document_search",
        resultCount: 0,
        truncated: true
      }),
      contextItem({
        id: "productive-before-read",
        reason: "model_directed_document_list",
        resultCount: 2,
        truncated: true
      }),
      contextItem({
        id: "model-read",
        kind: "document_read",
        label: "style.md",
        relativePath: "guides/style.md",
        inclusion: "full",
        reason: "model_directed_document_read",
        baseHash: "hash-style"
      }),
      contextItem({
        id: "zero-after-read",
        reason: "model_directed_document_list",
        resultCount: 0,
        truncated: true
      })
    ];

    expect(
      cleanupCodexSupersededDiscoveryRows({
        provider: CODEX_APP_SERVER_PROVIDER_METADATA,
        items
      }).map((item) => item.id)
    ).toEqual(["productive-before-read", "model-read", "zero-after-read"]);
  });

  it("keeps zero-result capped discovery rows without a later Codex read or for OpenAI manifests", () => {
    const items = [
      contextItem({
        id: "zero-search",
        reason: "model_directed_document_search",
        resultCount: 0,
        truncated: true
      })
    ];
    const itemsBeforeRead = [
      ...items,
      contextItem({
        id: "model-read",
        kind: "document_read",
        label: "style.md",
        relativePath: "guides/style.md",
        inclusion: "full",
        reason: "model_directed_document_read",
        baseHash: "hash-style"
      })
    ];

    expect(
      cleanupCodexSupersededDiscoveryRows({
        provider: CODEX_APP_SERVER_PROVIDER_METADATA,
        items
      }).map((item) => item.id)
    ).toEqual(["zero-search"]);
    expect(
      cleanupCodexSupersededDiscoveryRows({
        provider: OPENAI_RESPONSES_PROVIDER_METADATA,
        items: itemsBeforeRead
      }).map((item) => item.id)
    ).toEqual(["zero-search", "model-read"]);
  });

  it("returns and persists completed manifests with proposal ids from AgentService", async () => {
    const activePath = path.join(root, "doc.md");
    await writeFile(activePath, "ACTIVE_DOC_SENTINEL\n", "utf8");
    vi.stubGlobal("fetch", async () =>
      sseResponse([
        { type: "response.created", response: { id: "resp_manifest_success" } },
        {
          type: "response.output_text.delta",
          delta: "Summary\n\nFULL_REPLACEMENT:\n```markdown\nPROPOSAL_REPLACEMENT_SENTINEL\n```\n"
        },
        {
          type: "response.completed",
          response: {
            id: "resp_manifest_success",
            output_text: "Summary\n\nFULL_REPLACEMENT:\n```markdown\nPROPOSAL_REPLACEMENT_SENTINEL\n```\n"
          }
        }
      ])
    );

    const service = serviceWithFakeCodex();
    await service.updateSettings({ openAiApiKey: "sk-proj-SHOULD_NOT_PERSIST" });
    const events: AgentRunEvent[] = [];
    const response = await service.startRun(
      request({
        runId: "run-service-success",
        activeFile: {
          path: activePath,
          relativePath: "doc.md",
          content: "ACTIVE_DOC_SENTINEL\n",
          baseHash: "base-hash-service"
        },
        prompt: "PROMPT_SENTINEL"
      }),
      (event) => events.push(event)
    );

    expect(response.error).toBeUndefined();
    expect(response.contextManifest).toMatchObject({
      runId: "run-service-success",
      status: "completed",
      responseId: "resp_manifest_success",
      proposalIds: ["proposal-run-service-success"]
    });

    const raw = await readFile(path.join(userData, "assistant", "context-manifests.json"), "utf8");
    expect(raw).toContain("proposal-run-service-success");
    expect(raw).not.toContain("ACTIVE_DOC_SENTINEL");
    expect(raw).not.toContain("PROMPT_SENTINEL");
    expect(raw).not.toContain("PROPOSAL_REPLACEMENT_SENTINEL");
    expect(raw).not.toContain("sk-proj-SHOULD_NOT_PERSIST");
    expect(raw).not.toContain(root);
    expect(events.filter((event) => event.type === "run_phase")).toEqual([
      { type: "run_phase", runId: "run-service-success", phase: "reading_context", source: "agent_service" },
      { type: "run_phase", runId: "run-service-success", phase: "asking_model", source: "agent_service" },
      { type: "run_phase", runId: "run-service-success", phase: "reviewing_changes", source: "agent_service" },
      {
        type: "run_phase",
        runId: "run-service-success",
        phase: "waiting_for_review",
        source: "agent_service",
        proposalFileCount: 1
      },
      { type: "run_phase", runId: "run-service-success", phase: "completed", source: "agent_service" }
    ]);
  });

  it("ignores renderer-supplied explicit context document payloads before provider invocation", async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      requestBodies.push(JSON.parse(String(init.body)));

      return sseResponse([
        { type: "response.created", response: { id: "resp_renderer_context_ignored" } },
        { type: "response.output_text.delta", delta: "Done" },
        { type: "response.completed", response: { id: "resp_renderer_context_ignored", output_text: "Done" } }
      ]);
    });

    const service = serviceWithFakeCodex();
    await service.updateSettings({ openAiApiKey: "sk-proj-SHOULD_NOT_PERSIST" });
    await writeFile(path.join(root, "safe.md"), "SAFE_CONTEXT_FROM_DISK_SENTINEL", "utf8");
    const events: AgentRunEvent[] = [];
    const response = await service.startRun(
      {
        ...request({ runId: "run-renderer-context-injection", prompt: "Please use @safe.md" }),
        contextDocuments: [
          {
            correlationId: "ctx-forged",
            relativePath: "forged.md",
            content: "FORGED_RENDERER_CONTEXT_SENTINEL",
            baseHash: "forged-hash",
            estimatedTokens: 1,
            source: "explicit_file_mention"
          }
        ],
        unresolvedContextReferences: [
          {
            correlationId: "ctx-forged-reference",
            safeDisplayPath: "../secret.md",
            reason: "unsafe"
          }
        ],
        contextAttachments: [
          {
            relativePath: "safe.md",
            source: "manual_attachment",
            content: "FORGED_RENDERER_ATTACHMENT_SENTINEL",
            baseHash: "forged-attachment-hash"
          }
        ]
      } as unknown as AgentRunRequest,
      (event) => events.push(event)
    );

    expect(response.error).toBeUndefined();
    expect(JSON.stringify(requestBodies)).not.toContain("FORGED_RENDERER_CONTEXT_SENTINEL");
    expect(JSON.stringify(requestBodies)).not.toContain("FORGED_RENDERER_ATTACHMENT_SENTINEL");
    expect(JSON.stringify(requestBodies)).toContain("SAFE_CONTEXT_FROM_DISK_SENTINEL");
    expect(JSON.stringify(response.contextManifest)).not.toContain("FORGED_RENDERER_CONTEXT_SENTINEL");
    expect(JSON.stringify(response.contextManifest)).not.toContain("FORGED_RENDERER_ATTACHMENT_SENTINEL");
    expect(JSON.stringify(response.contextManifest)).not.toContain("SAFE_CONTEXT_FROM_DISK_SENTINEL");
    expect(response.contextManifest?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "document_read",
          relativePath: "safe.md",
          reason: "manual_context_attachment"
        })
      ])
    );
    expect(JSON.stringify(response.contextManifest)).not.toContain("../secret.md");
    expect(events.filter((event) => event.type === "run_phase")).toEqual([
      {
        type: "run_phase",
        runId: "run-renderer-context-injection",
        phase: "reading_context",
        source: "agent_service"
      },
      { type: "run_phase", runId: "run-renderer-context-injection", phase: "asking_model", source: "agent_service" },
      { type: "run_phase", runId: "run-renderer-context-injection", phase: "completed", source: "agent_service" }
    ]);
  });

  it("records model-directed document list, search, and read rows as metadata-only manifest context", async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    await mkdir(path.join(root, "guides"), { recursive: true });
    await writeFile(path.join(root, "guides", "style.md"), "# Style\nSTYLE_TOOL_CONTENT_SENTINEL\n", "utf8");

    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      requestBodies.push(JSON.parse(String(init.body)));

      if (requestBodies.length === 1) {
        return sseResponse([
          {
            type: "response.completed",
            response: {
              id: "resp_model_list",
              output: [
                {
                  type: "function_call",
                  call_id: "call_list",
                  name: "list_documents",
                  arguments: JSON.stringify({ directory: "guides", depth: 1, limit: 5 })
                }
              ]
            }
          }
        ]);
      }

      if (requestBodies.length === 2) {
        return sseResponse([
          {
            type: "response.completed",
            response: {
              id: "resp_model_search",
              output: [
                {
                  type: "function_call",
                  call_id: "call_search",
                  name: "search_documents",
                  arguments: JSON.stringify({ query: "STYLE_QUERY_SENTINEL", limit: 5 })
                }
              ]
            }
          }
        ]);
      }

      if (requestBodies.length === 3) {
        return sseResponse([
          {
            type: "response.completed",
            response: {
              id: "resp_model_read",
              output: [
                {
                  type: "function_call",
                  call_id: "call_read",
                  name: "read_document",
                  arguments: JSON.stringify({ path: "guides/style.md" })
                }
              ]
            }
          }
        ]);
      }

      return sseResponse([
        {
          type: "response.completed",
          response: {
            id: "resp_model_final",
            output: [
              {
                type: "message",
                role: "assistant",
                content: [{ type: "output_text", text: "I used the workspace style guide." }]
              }
            ]
          }
        }
      ]);
    });

    const service = serviceWithFakeCodex();
    await service.updateSettings({ openAiApiKey: "sk-proj-SHOULD_NOT_PERSIST" });
    const response = await service.startRun(request({ runId: "run-model-directed-context" }), () => undefined);

    expect(response.error).toBeUndefined();
    expect(response.text).toBe("I used the workspace style guide.");
    expect(response.contextManifest?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "document_reference",
          label: "Document list",
          inclusion: "available",
          reason: "model_directed_document_list"
        }),
        expect.objectContaining({
          kind: "document_reference",
          label: "Document search",
          inclusion: "reference",
          reason: "model_directed_document_search"
        }),
        expect.objectContaining({
          kind: "document_read",
          label: "style.md",
          relativePath: "guides/style.md",
          inclusion: "full",
          reason: "model_directed_document_read",
          baseHash: expect.any(String),
          estimatedTokens: expect.any(Number)
        })
      ])
    );

    const raw = await readFile(path.join(userData, "assistant", "context-manifests.json"), "utf8");
    expect(raw).toContain("model_directed_document_list");
    expect(raw).toContain("model_directed_document_search");
    expect(raw).toContain("model_directed_document_read");
    expect(raw).not.toContain("STYLE_TOOL_CONTENT_SENTINEL");
    expect(raw).not.toContain("STYLE_QUERY_SENTINEL");
    expect(raw).not.toContain("STYLE_EXCERPT_SENTINEL");
    expect(raw).not.toContain(root);
  });

  it("preserves distinct model-directed search and list receipt rows in final manifests", async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    await mkdir(path.join(root, "guides"), { recursive: true });
    await writeFile(path.join(root, "guides", "style.md"), "# Style\n", "utf8");

    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      requestBodies.push(JSON.parse(String(init.body)));
      const calls = [
        {
          id: "resp_list_one",
          call_id: "call_list_one",
          name: "list_documents",
          arguments: JSON.stringify({ directory: "guides", depth: 1, limit: 5 })
        },
        {
          id: "resp_list_two",
          call_id: "call_list_two",
          name: "list_documents",
          arguments: JSON.stringify({ directory: null, depth: 1, limit: 5 })
        },
        {
          id: "resp_search_one",
          call_id: "call_search_one",
          name: "search_documents",
          arguments: JSON.stringify({ query: "style", limit: 5 })
        },
        {
          id: "resp_search_two",
          call_id: "call_search_two",
          name: "search_documents",
          arguments: JSON.stringify({ query: "guide", limit: 5 })
        }
      ];
      const call = calls[requestBodies.length - 1];

      if (call) {
        return sseResponse([
          {
            type: "response.completed",
            response: {
              id: call.id,
              output: [
                {
                  type: "function_call",
                  call_id: call.call_id,
                  name: call.name,
                  arguments: call.arguments
                }
              ]
            }
          }
        ]);
      }

      return sseResponse([
        {
          type: "response.completed",
          response: {
            id: "resp_repeated_receipts_final",
            output: [
              {
                type: "message",
                role: "assistant",
                content: [{ type: "output_text", text: "Done." }]
              }
            ]
          }
        }
      ]);
    });

    const service = serviceWithFakeCodex();
    await service.updateSettings({ openAiApiKey: "sk-proj-SHOULD_NOT_PERSIST" });
    const response = await service.startRun(request({ runId: "run-repeated-tool-context" }), () => undefined);

    expect(response.error).toBeUndefined();
    expect(
      response.contextManifest?.items
        .filter((item) => item.reason === "model_directed_document_list" || item.reason === "model_directed_document_search")
        .map((item) => [item.reason, item.correlationId])
    ).toEqual([
      ["model_directed_document_list", "call_list_one"],
      ["model_directed_document_list", "call_list_two"],
      ["model_directed_document_search", "call_search_one"],
      ["model_directed_document_search", "call_search_two"]
    ]);
  });

  it("returns failed manifests for provider execution failures and no manifest for pre-provider failures", async () => {
    vi.stubGlobal("fetch", async () => sseResponse([], 500));

    const failedService = serviceWithFakeCodex();
    await failedService.updateSettings({ openAiApiKey: "sk-test" });
    const failedEvents: AgentRunEvent[] = [];
    const failed = await failedService.startRun(request({ runId: "run-service-failed" }), (event) =>
      failedEvents.push(event)
    );

    expect(failed.error).toMatchObject({ code: "provider_unavailable", providerStatus: 500 });
    expect(failed.contextManifest).toMatchObject({
      runId: "run-service-failed",
      status: "failed",
      error: {
        code: "provider_unavailable",
        userMessage: "OpenAI is unavailable right now. Try again shortly.",
        retryable: true,
        providerStatus: 500
      }
    });

    const missingKeyUserData = await mkdtemp(path.join(os.tmpdir(), "iliad-context-nokey-"));
    const missingKeyService = serviceWithFakeCodex(missingKeyUserData);
    const missingKeyEvents: AgentRunEvent[] = [];
    const missingKey = await missingKeyService.startRun(
      request({ runId: "run-missing-key", workspaceRoot: path.join(root, "missing-key") }),
      (event) => missingKeyEvents.push(event)
    );
    await flushServiceDiagnostics(failedService);
    await flushServiceDiagnostics(missingKeyService);
    await rm(missingKeyUserData, { recursive: true, force: true });

    expect(missingKey.error).toMatchObject({ code: "missing_api_key" });
    expect(missingKey.contextManifest).toBeUndefined();
    expect(failedEvents.filter((event) => event.type === "run_phase")).toEqual([
      { type: "run_phase", runId: "run-service-failed", phase: "reading_context", source: "agent_service" },
      { type: "run_phase", runId: "run-service-failed", phase: "asking_model", source: "agent_service" },
      {
        type: "run_phase",
        runId: "run-service-failed",
        phase: "failed",
        source: "agent_service",
        errorCode: "provider_unavailable"
      }
    ]);
    expect(missingKeyEvents.filter((event) => event.type === "run_phase")).toEqual([
      { type: "run_phase", runId: "run-missing-key", phase: "reading_context", source: "agent_service" },
      {
        type: "run_phase",
        runId: "run-missing-key",
        phase: "failed",
        source: "agent_service",
        errorCode: "missing_api_key"
      }
    ]);
  });

  it("emits a terminal failed phase when active-file validation fails before provider selection", async () => {
    const service = serviceWithFakeCodex();
    await service.updateSettings({ openAiApiKey: "sk-test" });
    const events: AgentRunEvent[] = [];
    const response = await service.startRun(
      request({
        runId: "run-invalid-active-file",
        activeFile: {
          path: path.join(root, "not-markdown.txt"),
          relativePath: "not-markdown.txt",
          content: "Invalid",
          baseHash: "hash"
        }
      }),
      (event) => events.push(event)
    );

    expect(response.error).toMatchObject({ code: "unknown" });
    await flushServiceDiagnostics(service);
    expect(events.filter((event) => event.type === "run_phase")).toEqual([
      { type: "run_phase", runId: "run-invalid-active-file", phase: "reading_context", source: "agent_service" },
      {
        type: "run_phase",
        runId: "run-invalid-active-file",
        phase: "failed",
        source: "agent_service",
        errorCode: "unknown"
      }
    ]);
  });
});

describe("conversation history and reference-index manifest items", () => {
  it("adds identifier-index and history-omission items from the prepared request", () => {
    const built = buildAgentRunContextManifest({
      request: {
        ...request({ previouslyReferencedDocuments: ["rubrica.md", "notes/mapa.md"] }),
        omittedHistoryMessageCount: 5
      },
      provider: OPENAI_RESPONSES_PROVIDER_METADATA,
      model: "gpt-5.5",
      workspaceId: "workspace_test",
      now: new Date(0).toISOString()
    });

    expect(built.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "conversation-reference-1",
          kind: "document_reference",
          relativePath: "rubrica.md",
          inclusion: "reference",
          reason: "conversation_reference_index"
        }),
        expect.objectContaining({
          id: "conversation-reference-2",
          relativePath: "notes/mapa.md",
          reason: "conversation_reference_index"
        }),
        expect.objectContaining({
          id: "conversation-history-omitted",
          kind: "conversation_history",
          inclusion: "excluded",
          reason: "conversation_history_budget_omitted",
          resultCount: 5
        })
      ])
    );
  });

  it("round-trips the new kind and reasons through serialization without coercion", () => {
    const serialized = serializeAgentRunContextManifest(
      manifest({
        items: [
          contextItem({
            id: "conversation-reference-1",
            kind: "document_reference",
            label: "rubrica.md",
            relativePath: "rubrica.md",
            inclusion: "reference",
            reason: "conversation_reference_index"
          }),
          contextItem({
            id: "conversation-history-omitted",
            kind: "conversation_history",
            label: "Earlier conversation",
            inclusion: "excluded",
            reason: "conversation_history_budget_omitted",
            resultCount: 7
          })
        ]
      })
    );

    expect(serialized.items[0]).toMatchObject({
      kind: "document_reference",
      relativePath: "rubrica.md",
      inclusion: "reference",
      reason: "conversation_reference_index"
    });
    expect(serialized.items[1]).toMatchObject({
      kind: "conversation_history",
      label: "Earlier conversation",
      inclusion: "excluded",
      reason: "conversation_history_budget_omitted",
      resultCount: 7
    });
  });

  it("computes estimatedInputTokens over the provided, already trimmed messages", () => {
    const built = buildAgentRunContextManifest({
      request: request({ messages: [{ role: "user", content: "x".repeat(400) }] }),
      provider: OPENAI_RESPONSES_PROVIDER_METADATA,
      model: "gpt-5.5",
      workspaceId: "workspace_test",
      now: new Date(0).toISOString()
    });

    // History selection runs in preparedRunRequest, so omitted messages never
    // reach this sum: it covers exactly the messages the provider will send.
    expect(built.estimatedInputTokens).toBe(100 + estimateTokensFromText("Help with this document."));
  });
});

describe("conversation summary manifest rows", () => {
  function summaryRequest(coveredMessageCount: number, omitted: number) {
    return {
      ...request(),
      omittedHistoryMessageCount: omitted,
      conversationSummary: { text: "## Decisions\n- usar 'estudiantes'", coveredMessageCount }
    };
  }

  it("emits the summary row and shrinks the omitted row to the uncovered gap", () => {
    const built = buildAgentRunContextManifest({
      request: summaryRequest(10, 12),
      provider: OPENAI_RESPONSES_PROVIDER_METADATA,
      model: "gpt-5.5",
      workspaceId: "workspace_test",
      now: new Date(0).toISOString()
    });

    expect(built.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "conversation-summary",
          kind: "conversation_history",
          label: "Earlier conversation summary",
          inclusion: "full",
          reason: "conversation_summary",
          resultCount: 10,
          estimatedTokens: estimateTokensFromText("## Decisions\n- usar 'estudiantes'")
        }),
        expect.objectContaining({
          id: "conversation-history-omitted",
          reason: "conversation_history_budget_omitted",
          resultCount: 2
        })
      ])
    );
  });

  it("omits the gap row entirely at full coverage", () => {
    const built = buildAgentRunContextManifest({
      request: summaryRequest(12, 12),
      provider: OPENAI_RESPONSES_PROVIDER_METADATA,
      model: "gpt-5.5",
      workspaceId: "workspace_test",
      now: new Date(0).toISOString()
    });

    expect(built.items.some((item) => item.reason === "conversation_summary")).toBe(true);
    expect(built.items.some((item) => item.reason === "conversation_history_budget_omitted")).toBe(false);
  });

  it("counts the summary text toward estimatedInputTokens exactly once", () => {
    const built = buildAgentRunContextManifest({
      request: summaryRequest(10, 12),
      provider: OPENAI_RESPONSES_PROVIDER_METADATA,
      model: "gpt-5.5",
      workspaceId: "workspace_test",
      now: new Date(0).toISOString()
    });
    const without = buildAgentRunContextManifest({
      request: { ...request(), omittedHistoryMessageCount: 12 },
      provider: OPENAI_RESPONSES_PROVIDER_METADATA,
      model: "gpt-5.5",
      workspaceId: "workspace_test",
      now: new Date(0).toISOString()
    });

    expect(built.estimatedInputTokens - without.estimatedInputTokens).toBe(
      estimateTokensFromText("## Decisions\n- usar 'estudiantes'")
    );
  });

  it("round-trips reason, counts, tokens, and label through serialization (restart survival)", () => {
    const serialized = serializeAgentRunContextManifest(
      manifest({
        items: [
          contextItem({
            id: "conversation-summary",
            kind: "conversation_history",
            label: "Earlier conversation summary",
            inclusion: "full",
            reason: "conversation_summary",
            resultCount: 9,
            estimatedTokens: 42
          })
        ]
      })
    );

    expect(serialized.items[0]).toMatchObject({
      kind: "conversation_history",
      label: "Earlier conversation summary",
      inclusion: "full",
      reason: "conversation_summary",
      resultCount: 9,
      estimatedTokens: 42
    });
  });
});

describe("editor selection manifest item", () => {
  it("emits a selection row with line fields that survive serialization", () => {
    const built = buildAgentRunContextManifest({
      request: request({
        activeFile: { path: "/ws/notes.md", relativePath: "notes.md", content: "uno\ndos tres\ncuatro\n", baseHash: "h" },
        editorSelection: { from: 4, to: 12 }
      }),
      provider: OPENAI_RESPONSES_PROVIDER_METADATA,
      model: "gpt-5.5",
      workspaceId: "workspace_test",
      now: new Date(0).toISOString()
    });

    const item = built.items.find((candidate) => candidate.reason === "editor_selection");
    expect(item).toMatchObject({ id: "editor-selection", kind: "current_file", inclusion: "full", lineStart: 2, lineEnd: 2 });

    const serialized = serializeAgentRunContextManifest(built);
    const survived = serialized.items.find((candidate) => candidate.reason === "editor_selection");
    expect(survived).toMatchObject({ reason: "editor_selection", lineStart: 2, lineEnd: 2 });
  });
});

describe("workspace rules manifest rows", () => {
  it("emits the included row with hash and the excluded row without token estimates", () => {
    const included = buildAgentRunContextManifest({
      request: {
        ...request(),
        workspaceRules: {
          correlationId: "workspace-rules",
          relativePath: "AGENTS.md",
          content: "Reglas.",
          baseHash: "rules-hash",
          estimatedTokens: 2
        }
      },
      provider: OPENAI_RESPONSES_PROVIDER_METADATA,
      model: "gpt-5.5",
      workspaceId: "workspace_test",
      now: new Date(0).toISOString()
    });
    expect(included.items).toContainEqual(
      expect.objectContaining({
        id: "workspace-rules",
        kind: "document_read",
        relativePath: "AGENTS.md",
        inclusion: "full",
        reason: "workspace_rules",
        baseHash: "rules-hash"
      })
    );

    const excluded = buildAgentRunContextManifest({
      request: { ...request(), workspaceRulesExcluded: true },
      provider: OPENAI_RESPONSES_PROVIDER_METADATA,
      model: "gpt-5.5",
      workspaceId: "workspace_test",
      now: new Date(0).toISOString()
    });
    const row = excluded.items.find((item) => item.reason === "workspace_rules_oversized");
    expect(row).toMatchObject({ kind: "document_reference", inclusion: "excluded" });
    expect(row?.estimatedTokens).toBeUndefined();

    const serialized = serializeAgentRunContextManifest(included);
    expect(serialized.items.find((item) => item.reason === "workspace_rules")).toBeDefined();
  });
});
