import { describe, expect, it } from "vitest";
import {
  activityMetadata,
  activityTitle,
  agentErrorMessage,
  contextManifestDetailRows,
  isGenericRunningStatus,
  localizedRunPhase,
  localizedStatusMessage,
  mergeRunActivityEvent,
  previouslyReferencedDocumentPaths,
  receiptActivityTitle,
  shortContextHash,
  thinkingStatusText,
  turnReceiptDetailRows,
  turnReceiptSummary,
  visibleRunActivities
} from "../../src/assistant/assistantUtils";
import { appStrings } from "../../src/i18n/strings";
import type { AgentActivityRunEvent, AgentRunContextItem, AgentRunContextManifest } from "../../src/types/iliad";

const providerCapabilities = {
  text: true,
  thinkingSummaries: true,
  reviewableProposals: true,
  workspaceEvents: true,
  managedAccountAuth: true,
  rateLimits: true,
  media: {
    transcription: false,
    images: false,
    realtime: false
  }
};

function contextItem(overrides: Partial<AgentRunContextItem>): AgentRunContextItem {
  return {
    id: "item-1",
    kind: "current_file",
    label: "s2.md",
    relativePath: "notes/s2.md",
    inclusion: "full",
    reason: "active_markdown_file",
    baseHash: "1234567890abcdef",
    ...overrides
  };
}

function contextManifest(
  items: AgentRunContextItem[],
  overrides: Partial<AgentRunContextManifest> = {}
): AgentRunContextManifest {
  return {
    id: "manifest-run-1",
    runId: "run-1",
    createdAt: "2026-05-24T00:00:00.000Z",
    updatedAt: "2026-05-24T00:00:00.000Z",
    status: "completed",
    workspaceLabel: "iliad",
    workspaceId: "workspace-secret-id",
    workspaceRootPersisted: false,
    provider: {
      id: "codex-app-server",
      label: "Codex",
      billing: "codex_account",
      capabilities: providerCapabilities
    },
    model: "gpt-5.5",
    mode: "balanced",
    language: "en",
    policy: "auto",
    items,
    estimatedInputTokens: 100,
    proposalIds: [],
    ...overrides
  };
}

describe("assistant error messages", () => {
  it("uses provider-neutral provider-unavailable fallback copy", () => {
    expect(appStrings.en.assistant.errors.provider_unavailable).toBe(
      "The agent runtime is unavailable right now. Try again shortly."
    );
    expect(appStrings.es.assistant.errors.provider_unavailable).toBe(
      "El motor del agente no está disponible ahora. Intenta de nuevo en un momento."
    );
    expect(appStrings.en.assistant.errors.provider_unavailable).not.toMatch(/OpenAI/i);
    expect(appStrings.es.assistant.errors.provider_unavailable).not.toMatch(/OpenAI/i);
  });

  it("shows specific safe provider messages for runtime failures", () => {
    expect(
      agentErrorMessage(appStrings.en.assistant, {
        code: "provider_unavailable",
        userMessage: "Codex reported a usage or billing limit. Check your OpenAI account and try again.",
        retryable: true
      })
    ).toBe("Codex reported a usage or billing limit. Check your OpenAI account and try again.");
  });

  it("keeps OpenAI-specific backend messages behind localized fallback copy", () => {
    expect(
      agentErrorMessage(appStrings.es.assistant, {
        code: "provider_unavailable",
        userMessage: "OpenAI is unavailable right now. Try again shortly.",
        retryable: true
      })
    ).toBe("El motor del agente no está disponible ahora. Intenta de nuevo en un momento.");
  });
});

describe("assistant run phase formatting", () => {
  const labels = appStrings.en.assistant;

  it("maps service-owned run phases to minimal localized statuses", () => {
    expect(localizedRunPhase("reading_context", labels)).toBe("Reading context");
    expect(localizedRunPhase("asking_model", labels)).toBe("Working");
    expect(localizedRunPhase("reviewing_changes", labels)).toBe("Reviewing changes");
    expect(localizedRunPhase("waiting_for_review", labels)).toBe("Reviewing changes");
    expect(localizedRunPhase("completed", labels)).toBe("");
    expect(localizedRunPhase("failed", labels)).toBe("");
    expect(localizedRunPhase("canceled", labels)).toBe("");
  });

  it("keeps legacy status events safe during local development reloads", () => {
    expect(localizedStatusMessage("reading_context", labels)).toBe("Reading context");
    expect(localizedStatusMessage("Preguntando al modelo", appStrings.es.assistant)).toBe("Preguntando al modelo");
  });

  it("hides generic statuses beside the wave but keeps thinking summaries visible", () => {
    expect(isGenericRunningStatus(localizedRunPhase("asking_model", labels), labels)).toBe(true);
    expect(isGenericRunningStatus(localizedRunPhase("waiting_for_review", labels), labels)).toBe(true);
    expect(isGenericRunningStatus(thinkingStatusText("Editing the introduction", labels), labels)).toBe(false);
  });
});

describe("assistant context manifest formatting", () => {
  const labels = appStrings.en.assistant.context;

  it("keeps excluded references visible in detail rows", () => {
    const manifest = contextManifest([
      contextItem({ id: "current-file", relativePath: "notes/s2.md" }),
      contextItem({
        id: "document-read-guides-style",
        kind: "document_read",
        label: "style.md",
        relativePath: "guides/style.md",
        inclusion: "full",
        reason: "explicit_file_mention",
        baseHash: "abc123",
        estimatedTokens: 42,
        correlationId: "ctx-style"
      }),
      contextItem({
        id: "document-reference-secret",
        kind: "document_reference",
        label: "Unresolved document reference",
        relativePath: undefined,
        inclusion: "excluded",
        reason: "explicit_file_mention_unresolved",
        baseHash: undefined,
        correlationId: "ctx-secret"
      })
    ]);

    expect(contextManifestDetailRows(manifest, labels)).toContainEqual({
      id: "document-reference-secret",
      primary: "Unresolved document reference",
      secondary: "Excluded"
    });
  });

  it("shows excluded OpenAI workspace scope in detail rows", () => {
    const manifest = contextManifest(
      [
        contextItem({}),
        contextItem({
          id: "other-workspace-files",
          kind: "workspace_scope",
          label: "Other workspace files",
          relativePath: undefined,
          inclusion: "excluded",
          reason: "openai_api_current_request_only",
          baseHash: undefined
        })
      ],
      {
        provider: {
          id: "openai-api",
          label: "OpenAI API",
          billing: "openai_platform_api",
          capabilities: providerCapabilities
        }
      }
    );

    expect(contextManifestDetailRows(manifest, labels).map((row) => row.primary)).toContain(
      "Other workspace files excluded"
    );
  });

  it("truncates context hashes safely and omits empty hashes", () => {
    expect(shortContextHash("1234567890abcdef")).toBe("12345678");
    expect(shortContextHash("1234")).toBe("1234");
    expect(shortContextHash("   ")).toBeNull();
    expect(shortContextHash(undefined)).toBeNull();
  });

  it("does not expose workspace ids as primary display text", () => {
    const rows = contextManifestDetailRows(
      contextManifest([
        contextItem({
          id: "workspace-secret-id",
          kind: "workspace_scope",
          label: "workspace-secret-id",
          relativePath: undefined,
          inclusion: "excluded",
          reason: "openai_api_current_request_only",
          baseHash: undefined
        }),
        contextItem({
          id: "runtime-workspace",
          kind: "runtime_workspace",
          label: "workspace-secret-id",
          relativePath: undefined,
          inclusion: "available",
          reason: "codex_workspace_runtime",
          baseHash: undefined
        })
      ]),
      labels
    );

    expect(rows.map((row) => row.primary)).toEqual(["Other workspace files excluded", "Workspace access"]);
    expect(rows.some((row) => row.primary.includes("workspace-secret-id"))).toBe(false);
  });

  it("formats proposal/reference items and sparse non-completed manifests", () => {
    const rows = contextManifestDetailRows(
      contextManifest(
        [
          contextItem({
            id: "proposal-1",
            kind: "proposal",
            label: "Draft proposal",
            relativePath: undefined,
            inclusion: "reference",
            reason: "reviewable_proposal",
            baseHash: undefined
          })
        ],
        { status: "failed" }
      ),
      labels
    );

    expect(rows).toEqual([{ id: "proposal-1", primary: "Draft proposal", secondary: "Reference" }]);
  });

  it("shows useful model-directed document receipt metadata", () => {
    const rows = contextManifestDetailRows(
      contextManifest([
        contextItem({
          id: "list-1",
          kind: "document_reference",
          label: "Document list",
          relativePath: undefined,
          inclusion: "available",
          reason: "model_directed_document_list",
          baseHash: undefined,
          resultCount: 12,
          truncated: true
        }),
        contextItem({
          id: "search-1",
          kind: "document_reference",
          label: "Document search",
          relativePath: undefined,
          inclusion: "reference",
          reason: "model_directed_document_search",
          baseHash: undefined,
          resultCount: 3,
          searchedPaths: 8,
          searchedFiles: 4
        }),
        contextItem({
          id: "read-1",
          kind: "document_read",
          label: "style.md",
          relativePath: "guides/style.md",
          inclusion: "full",
          reason: "model_directed_document_read",
          baseHash: "abc123"
        }),
        contextItem({
          id: "read-failed-1",
          kind: "document_reference",
          label: "Unsafe absolute path",
          relativePath: "missing/guide.md",
          inclusion: "excluded",
          reason: "model_directed_document_read_failed",
          baseHash: undefined
        })
      ]),
      labels
    );

    expect(rows).toEqual([
      { id: "list-1", primary: "Document list", secondary: "12 results · search capped" },
      { id: "search-1", primary: "Document search", secondary: "3 results · 8 paths searched · 4 files searched" },
      { id: "read-1", primary: "guides/style.md", secondary: undefined },
      { id: "read-failed-1", primary: "missing/guide.md", secondary: "Excluded" }
    ]);
  });
});

describe("assistant live activity formatting", () => {
  const labels = appStrings.en.assistant;

  function activity(overrides: Partial<AgentActivityRunEvent>): AgentActivityRunEvent {
    return {
      type: "activity",
      runId: "run-1",
      activityId: "activity-1",
      sequence: 1,
      kind: "document_search",
      status: "started",
      title: "backend title is not rendered",
      ...overrides
    };
  }

  it("updates activity rows by id and keeps sequence order", () => {
    const merged = mergeRunActivityEvent(
      [
        activity({ activityId: "activity-2", sequence: 2, status: "started" }),
        activity({ activityId: "activity-1", sequence: 1, status: "started" })
      ],
      activity({ activityId: "activity-2", sequence: 99, status: "completed", resultCount: 4 })
    );

    expect(merged.map((row) => `${row.activityId}:${row.status}`)).toEqual([
      "activity-1:started",
      "activity-2:completed"
    ]);
    expect(merged.find((row) => row.activityId === "activity-2")?.sequence).toBe(2);
    expect(visibleRunActivities(merged, 1).map((row) => row.activityId)).toEqual(["activity-2"]);
  });

  it("formats safe metadata and omits unsafe query/path details", () => {
    expect(
      activityTitle(activity({ query: "style guide", resultCount: 2, searchedFiles: 5 }), labels.activity)
    ).toBe('Searching documents for "style guide"');
    expect(activityMetadata(activity({ resultCount: 2, searchedFiles: 5, truncated: true }), labels.context)).toBe(
      "2 results · 5 files searched · search capped"
    );
    expect(activityMetadata(activity({ resultCount: 2, searchedFiles: 5, truncated: true }), appStrings.es.assistant.context)).toBe(
      "2 resultados · 5 archivos revisados · búsqueda limitada"
    );
    expect(activityTitle(activity({ query: "/Users/sebastian/secret.md" }), labels.activity)).toBe("Searching documents");
    expect(activityTitle(activity({ query: "github_pat_SECRETSECRETSECRET" }), labels.activity)).toBe("Searching documents");
    expect(activityTitle(activity({ query: "style\u0000guide" }), labels.activity)).toBe("Searching documents");
    expect(activityTitle(activity({ query: "a".repeat(81) }), labels.activity)).toBe("Searching documents");
    expect(
      activityTitle(activity({ kind: "document_read", relativePath: "/Users/sebastian/secret.md" }), labels.activity)
    ).toBe("Reading document");
  });
});

function receiptActivity(overrides: Partial<AgentActivityRunEvent>): AgentActivityRunEvent {
  return {
    type: "activity",
    runId: "run-1",
    activityId: `activity-${Math.random().toString(36).slice(2)}`,
    sequence: 1,
    kind: "document_read",
    status: "completed",
    title: "raw",
    ...overrides
  };
}

describe("turn receipt summary", () => {
  const en = appStrings.en.assistant;
  const es = appStrings.es.assistant;

  it("prefixes the process label and counts distinct completed reads, searches, and failed reads in both locales", () => {
    const activities = [
      receiptActivity({ activityId: "r1", sequence: 1, relativePath: "a.md" }),
      receiptActivity({ activityId: "r2", sequence: 2, relativePath: "A.md" }),
      receiptActivity({ activityId: "r3", sequence: 3, relativePath: "b.md" }),
      receiptActivity({ activityId: "s1", sequence: 4, kind: "document_search", query: "rubrica" }),
      receiptActivity({ activityId: "f1", sequence: 5, kind: "document_read_failed", status: "failed", relativePath: "c.md" })
    ];

    expect(turnReceiptSummary(activities, en)).toBe("Process · Read 2 documents · 1 search · 1 read failed");
    expect(turnReceiptSummary(activities, es)).toBe("Proceso · Leyó 2 documentos · 1 búsqueda · 1 lectura fallida");
  });

  it("shows the bare process label when activities exist but none are counted", () => {
    const activities = [
      receiptActivity({ activityId: "r1", sequence: 1, status: "started", relativePath: "a.md" }),
      receiptActivity({ activityId: "s1", sequence: 2, kind: "document_search", status: "started" }),
      receiptActivity({ activityId: "l1", sequence: 3, kind: "document_list" })
    ];

    expect(turnReceiptSummary(activities, en)).toBe("Process");
    expect(turnReceiptSummary(activities, es)).toBe("Proceso");
  });

  it("shows the bare process label when the run used no document tools", () => {
    expect(turnReceiptSummary([], en)).toBe("Process");
    expect(turnReceiptSummary([], es)).toBe("Proceso");
  });

  it("uses past-tense receipt titles while the live trail keeps progressive ones", () => {
    const read = receiptActivity({ relativePath: "guides/style.md" });

    expect(receiptActivityTitle(read, en.receipt)).toBe("Read guides/style.md");
    expect(activityTitle(read, en.activity)).toBe("Reading guides/style.md");
    expect(receiptActivityTitle(receiptActivity({ kind: "document_search", query: "rubrica" }), es.receipt)).toBe(
      'Buscó documentos para "rubrica"'
    );
  });
});

describe("turn receipt detail rows", () => {
  const labels = appStrings.en.assistant.context;

  it("filters model-directed manifest rows when activity rows render, and keeps them otherwise", () => {
    const manifest = contextManifest([
      contextItem({}),
      contextItem({
        id: "model-read",
        kind: "document_read",
        relativePath: "guides/style.md",
        reason: "model_directed_document_read"
      })
    ]);

    expect(turnReceiptDetailRows(manifest, true, labels).map((row) => row.primary)).toEqual(["notes/s2.md"]);
    expect(turnReceiptDetailRows(manifest, false, labels).map((row) => row.primary)).toEqual([
      "notes/s2.md",
      "guides/style.md"
    ]);
  });

  it("groups conversation reference-index items into a single row", () => {
    const manifest = contextManifest([
      contextItem({}),
      contextItem({
        id: "conversation-reference-1",
        kind: "document_reference",
        relativePath: "rubrica.md",
        inclusion: "reference",
        reason: "conversation_reference_index"
      }),
      contextItem({
        id: "conversation-reference-2",
        kind: "document_reference",
        relativePath: "mapa.md",
        inclusion: "reference",
        reason: "conversation_reference_index"
      })
    ]);

    const rows = turnReceiptDetailRows(manifest, false, labels);

    expect(rows.map((row) => row.primary)).toEqual([
      "notes/s2.md",
      "2 documents referenced earlier in this conversation"
    ]);
    expect(rows[1].secondary).toBe("Reference");
  });

  it("renders the history-omission item with its count, preceded by the no-file negative", () => {
    const manifest = contextManifest([
      contextItem({
        id: "conversation-history-omitted",
        kind: "conversation_history",
        relativePath: undefined,
        label: "Earlier conversation",
        inclusion: "excluded",
        reason: "conversation_history_budget_omitted",
        resultCount: 12
      })
    ]);

    const rows = turnReceiptDetailRows(manifest, false, labels);

    // No file-like items in this manifest: the explicit negative leads.
    expect(rows[0]).toEqual({ id: "no-file-included", primary: "No file included" });
    expect(rows[1].primary).toBe("12 earlier messages not sent (history budget)");
    expect(rows[1].secondary).toBe("Excluded");
  });

  it("renders the compaction-summary row with singular/plural labels in both locales", () => {
    const item = contextItem({
      id: "conversation-summary",
      kind: "conversation_history",
      relativePath: undefined,
      label: "Earlier conversation summary",
      inclusion: "full",
      reason: "conversation_summary",
      resultCount: 23
    });

    const rows = turnReceiptDetailRows(contextManifest([item]), false, labels);
    expect(rows.map((row) => row.primary)).toContain("Summary of 23 earlier messages");

    const singular = turnReceiptDetailRows(
      contextManifest([{ ...item, resultCount: 1 }]),
      false,
      appStrings.es.assistant.context
    );
    expect(singular.map((row) => row.primary)).toContain("Resumen de 1 mensaje anterior");

    const plural = turnReceiptDetailRows(
      contextManifest([item]),
      false,
      appStrings.es.assistant.context
    );
    expect(plural.map((row) => row.primary)).toContain("Resumen de 23 mensajes anteriores");
  });

  it("omits the no-file row when a file-like item is present and when there is no manifest", () => {
    expect(
      turnReceiptDetailRows(contextManifest([contextItem({})]), false, labels).map((row) => row.id)
    ).not.toContain("no-file-included");
    expect(turnReceiptDetailRows(undefined, false, labels)).toEqual([]);
  });
});

describe("previously referenced document paths", () => {
  function entryWith(kind: string, items: AgentRunContextItem[]) {
    return { kind, contextManifest: contextManifest(items) };
  }

  it("mines assistant and error manifests, newest first, deduped and filtered", () => {
    const entries = [
      entryWith("assistant", [contextItem({ relativePath: "old.md" })]),
      entryWith("user", [contextItem({ relativePath: "never-mined.md" })]),
      entryWith("error", [
        contextItem({ id: "read-1", kind: "document_read", relativePath: "failed-run-read.md", reason: "model_directed_document_read" })
      ]),
      entryWith("assistant", [
        contextItem({ relativePath: "newest.md" }),
        contextItem({ id: "ref", kind: "document_reference", relativePath: "not-included.md", inclusion: "reference", reason: "conversation_reference_index" }),
        contextItem({ id: "dup", kind: "document_read", relativePath: "OLD.md", reason: "model_directed_document_read" }),
        contextItem({ id: "hidden", kind: "document_read", relativePath: ".obsidian/x.md", reason: "model_directed_document_read" })
      ])
    ];

    expect(previouslyReferencedDocumentPaths(entries, ["excluded.md"])).toEqual([
      "newest.md",
      "OLD.md",
      "failed-run-read.md"
    ]);
  });

  it("excludes the current packet paths case-insensitively and respects the cap", () => {
    const entries = [
      entryWith("assistant", [
        contextItem({ id: "a", relativePath: "Active.md" }),
        contextItem({ id: "b", kind: "document_read", relativePath: "kept.md", reason: "model_directed_document_read" })
      ])
    ];

    expect(previouslyReferencedDocumentPaths(entries, ["active.md"])).toEqual(["kept.md"]);

    const many = entryWith(
      "assistant",
      Array.from({ length: 30 }, (_, index) =>
        contextItem({ id: `read-${index}`, kind: "document_read", relativePath: `docs/file-${index}.md`, reason: "model_directed_document_read" })
      )
    );

    expect(previouslyReferencedDocumentPaths([many], [])).toHaveLength(20);
  });
});
