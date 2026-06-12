import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AssistantTranscript } from "../../src/components/assistant/AssistantTranscript";
import { appStrings } from "../../src/i18n/strings";
import type { AssistantEntry } from "../../src/assistant/useAssistantRun";
import type { AgentActivityRunEvent, AgentRunContextManifest } from "../../src/types/iliad";

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

function manifest(): AgentRunContextManifest {
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
    items: [
      {
        id: "current-file",
        kind: "current_file",
        label: "s2.md",
        relativePath: "notes/s2.md",
        inclusion: "full",
        reason: "active_markdown_file",
        baseHash: "1234567890abcdef",
        estimatedTokens: 20
      },
      {
        id: "runtime-workspace",
        kind: "runtime_workspace",
        label: "Workspace runtime",
        inclusion: "available",
        reason: "codex_workspace_runtime"
      }
    ],
    estimatedInputTokens: 42,
    proposalIds: []
  };
}

describe("AssistantTranscript", () => {
  it("renders assistant context disclosure separately from prose", () => {
    const entries: AssistantEntry[] = [
      {
        id: "run-1-assistant",
        kind: "assistant",
        text: "Answer line one.\nAnswer line two.",
        contextManifest: manifest()
      }
    ];

    const html = renderToStaticMarkup(
      <AssistantTranscript
        entries={entries}
        labels={appStrings.en.assistant}
        runningRunId={null}
        transcriptRef={null}
      />
    );

    expect(html).toContain("assistant-markdown");
    expect(html).toContain("<details");
    expect(html).toContain(">Process<");
    expect(html).toContain("assistant-receipt-chevron");
    expect(html).toContain("notes/s2.md");
    expect(html).toContain("Workspace access");
    expect(html).toContain("Codex · gpt-5.5");
    expect(html).not.toContain("12345678");
    expect(html).not.toContain("workspace-secret-id");
    // The process header leads the turn: receipt markup precedes the prose.
    expect(html.indexOf("assistant-turn-receipt")).toBeLessThan(html.indexOf("assistant-markdown"));
  });

  it("renders assistant prose as markdown with math and safe links", () => {
    const entries: AssistantEntry[] = [
      {
        id: "run-1-assistant",
        kind: "assistant",
        text: "### Plan\n\nUse **bold** and [site](https://example.test).\n\n$E=mc^2$\n\n<script>alert('x')</script>\n\n[bad](javascript:alert(1))"
      }
    ];

    const html = renderToStaticMarkup(
      <AssistantTranscript
        entries={entries}
        labels={appStrings.en.assistant}
        runningRunId={null}
        transcriptRef={null}
      />
    );

    expect(html).toContain("<h3>Plan</h3>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain('href="https://example.test"');
    expect(html).toContain("katex");
    expect(html).toContain("&lt;script&gt;alert(&#x27;x&#x27;)&lt;/script&gt;");
    expect(html).toContain("markdown-link-unsafe");
    expect(html).not.toContain("javascript:alert");
  });

  it("renders a compact live activity trail only while a run is active", () => {
    const entries: AssistantEntry[] = [
      { id: "run-1-status", kind: "status", text: appStrings.en.assistant.status.thinking }
    ];
    const runActivities: AgentActivityRunEvent[] = [
      {
        type: "activity",
        runId: "run-1",
        activityId: "old",
        sequence: 1,
        kind: "document_read",
        status: "completed",
        title: "RAW PROMPT sk-should-not-render",
        relativePath: "old.md"
      },
      {
        type: "activity",
        runId: "run-1",
        activityId: "list",
        sequence: 2,
        kind: "document_list",
        status: "completed",
        title: "raw list",
        resultCount: 12,
        truncated: true
      },
      {
        type: "activity",
        runId: "run-1",
        activityId: "search",
        sequence: 3,
        kind: "document_search",
        status: "completed",
        title: "raw search",
        query: "style guide",
        resultCount: 3,
        searchedFiles: 4
      },
      {
        type: "activity",
        runId: "run-1",
        activityId: "read",
        sequence: 4,
        kind: "document_read",
        status: "started",
        title: "raw read",
        relativePath: "guides/style.md"
      },
      {
        type: "activity",
        runId: "run-1",
        activityId: "unsafe-query",
        sequence: 5,
        kind: "document_search",
        status: "started",
        title: "raw unsafe",
        query: "/Users/sebastian/secret.md"
      },
      {
        type: "activity",
        runId: "run-1",
        activityId: "failed",
        sequence: 6,
        kind: "document_read_failed",
        status: "failed",
        title: "raw failed",
        relativePath: "missing/guide.md"
      }
    ];

    const activeHtml = renderToStaticMarkup(
      <AssistantTranscript
        entries={entries}
        labels={appStrings.en.assistant}
        runActivities={runActivities}
        runningRunId="run-1"
        transcriptRef={null}
      />
    );

    expect(activeHtml).toContain("Agent activity");
    expect(activeHtml).toContain("Listing documents");
    expect(activeHtml).toContain("12 results · search capped");
    expect(activeHtml).toContain("Searching documents for &quot;style guide&quot;");
    expect(activeHtml).toContain("3 results · 4 files searched");
    expect(activeHtml).toContain("Reading guides/style.md");
    expect(activeHtml).toContain("Could not read missing/guide.md");
    expect(activeHtml).not.toContain("old.md");
    expect(activeHtml).not.toContain("RAW PROMPT");
    expect(activeHtml).not.toContain("sk-should-not-render");
    expect(activeHtml).not.toContain("/Users/sebastian/secret.md");

    const completedHtml = renderToStaticMarkup(
      <AssistantTranscript
        entries={entries}
        labels={appStrings.en.assistant}
        runActivities={runActivities}
        runningRunId={null}
        transcriptRef={null}
      />
    );

    expect(completedHtml).not.toContain("Agent activity");
    expect(completedHtml).not.toContain("Listing documents");
  });

  it("renders a collapsed permanent receipt on every manifest-bearing entry, including consecutive identical manifests", () => {
    const entries: AssistantEntry[] = [
      { id: "run-1-assistant", kind: "assistant", text: "First answer.", contextManifest: manifest() },
      { id: "run-2-assistant", kind: "assistant", text: "Second answer.", contextManifest: manifest() }
    ];

    const html = renderToStaticMarkup(
      <AssistantTranscript
        entries={entries}
        labels={appStrings.en.assistant}
        runningRunId={null}
        transcriptRef={null}
      />
    );

    expect(html.match(/assistant-turn-receipt/g)?.length).toBe(2);
    expect(html.match(/>Process</g)?.length).toBe(2);
    expect(html).not.toContain("<details open");
  });

  it("orders the expanded receipt as activity rows, then manifest rows, then provider line, deduplicating model-directed actions", () => {
    const activities: AgentActivityRunEvent[] = [
      {
        type: "activity",
        runId: "run-1",
        activityId: "read",
        sequence: 1,
        kind: "document_read",
        status: "completed",
        title: "raw",
        relativePath: "guides/style.md"
      }
    ];
    const withModelDirectedItem = manifest();
    withModelDirectedItem.items.push({
      id: "model-read",
      kind: "document_read",
      label: "style.md",
      relativePath: "guides/style.md",
      inclusion: "full",
      reason: "model_directed_document_read"
    });
    const entries: AssistantEntry[] = [
      {
        id: "run-1-assistant",
        kind: "assistant",
        text: "Answer.",
        contextManifest: withModelDirectedItem,
        activities
      }
    ];

    const html = renderToStaticMarkup(
      <AssistantTranscript
        entries={entries}
        labels={appStrings.en.assistant}
        runningRunId={null}
        transcriptRef={null}
      />
    );

    expect(html).toContain("Read 1 document");
    expect(html).toContain("Read guides/style.md");
    // Deduplicated: the path appears once as a past-tense activity row, not
    // again as a manifest row.
    expect(html.match(/guides\/style\.md/g)?.length).toBe(1);
    const activityIndex = html.indexOf("Read guides/style.md");
    const manifestRowIndex = html.indexOf("notes/s2.md");
    const providerIndex = html.indexOf("Codex · gpt-5.5");
    expect(activityIndex).toBeGreaterThan(-1);
    expect(manifestRowIndex).toBeGreaterThan(activityIndex);
    expect(providerIndex).toBeGreaterThan(manifestRowIndex);
  });

  it("groups conversation reference-index items into a single receipt row", () => {
    const withReferenceIndex = manifest();
    withReferenceIndex.items.push(
      {
        id: "conversation-reference-1",
        kind: "document_reference",
        label: "rubrica.md",
        relativePath: "rubrica.md",
        inclusion: "reference",
        reason: "conversation_reference_index"
      },
      {
        id: "conversation-reference-2",
        kind: "document_reference",
        label: "mapa.md",
        relativePath: "mapa.md",
        inclusion: "reference",
        reason: "conversation_reference_index"
      }
    );

    const html = renderToStaticMarkup(
      <AssistantTranscript
        entries={[{ id: "run-1-assistant", kind: "assistant", text: "Answer.", contextManifest: withReferenceIndex }]}
        labels={appStrings.en.assistant}
        runningRunId={null}
        transcriptRef={null}
      />
    );

    expect(html).toContain("2 documents referenced earlier in this conversation");
    expect(html).not.toContain("rubrica.md");
    expect(html).not.toContain("mapa.md");
  });

  it("renders receipts on error entries, omitting the provider line without a manifest", () => {
    const activities: AgentActivityRunEvent[] = [
      {
        type: "activity",
        runId: "run-1",
        activityId: "read",
        sequence: 1,
        kind: "document_read",
        status: "completed",
        title: "raw",
        relativePath: "guides/style.md"
      }
    ];
    const entries: AssistantEntry[] = [
      {
        id: "run-1-error",
        kind: "error",
        text: "Agent request failed.",
        contextManifest: manifest(),
        activities
      },
      { id: "run-2-error", kind: "error", text: "Network down", activities },
      { id: "run-3-error", kind: "error", text: "Early failure", contextManifest: manifest() }
    ];

    const html = renderToStaticMarkup(
      <AssistantTranscript
        entries={entries}
        labels={appStrings.en.assistant}
        runningRunId={null}
        transcriptRef={null}
      />
    );

    expect(html.match(/assistant-turn-receipt/g)?.length).toBe(3);
    expect(html).toContain("Agent request failed.");
    // Errors lead their bubble: the receipt stays below the error text.
    expect(html.indexOf("Agent request failed.")).toBeLessThan(html.indexOf("assistant-turn-receipt"));
    // Provider line renders only for the receipts that carry a manifest.
    expect(html.match(/Codex · gpt-5\.5/g)?.length).toBe(2);
    // The manifest-less receipt still summarizes its activities.
    expect(html.match(/Read 1 document/g)?.length).toBe(2);
    // The early failure with no activities shows the bare process label.
    expect(html.match(/>Process</g)?.length).toBe(1);
  });

  it("renders quiet attachment markers on sent user messages, alone and alongside selection comments", () => {
    const entries: AssistantEntry[] = [
      {
        id: "run-1-user",
        kind: "user",
        text: "Review these.",
        attachments: [
          { relativePath: "notes/rubrica.md", label: "rubrica.md" },
          { relativePath: "mapa.md", label: "mapa.md" }
        ]
      },
      {
        id: "run-2-user",
        kind: "user",
        text: "Typed text.\n\nComments on `doc.md`:",
        selectionComments: { count: 2, block: "Comments on `doc.md`:", typedText: "Typed text." },
        attachments: [{ relativePath: "anexo.md", label: "anexo.md" }]
      },
      { id: "restored-user", kind: "user", text: "Restored plain message." }
    ];

    const html = renderToStaticMarkup(
      <AssistantTranscript
        entries={entries}
        labels={appStrings.en.assistant}
        runningRunId={null}
        transcriptRef={null}
      />
    );

    expect(html.match(/assistant-user-attachment/g)?.length).toBe(2);
    expect(html).toContain('title="notes/rubrica.md"');
    expect(html).toContain("rubrica.md");
    expect(html).toContain(" · ");
    // Combined entry keeps order: typed text, comments disclosure, markers.
    const typedIndex = html.indexOf("Typed text.");
    const disclosureIndex = html.indexOf("assistant-comments-disclosure");
    const markerIndex = html.indexOf('title="anexo.md"');
    expect(typedIndex).toBeGreaterThan(-1);
    expect(disclosureIndex).toBeGreaterThan(typedIndex);
    expect(markerIndex).toBeGreaterThan(disclosureIndex);
    // Restored entries (no ephemeral fields) render as plain text.
    expect(html).toContain("Restored plain message.");
  });

  it("renders a fallback active status row and activity trail when the matching status entry is absent", () => {
    const html = renderToStaticMarkup(
      <AssistantTranscript
        entries={[{ id: "run-1-user", kind: "user", text: "Find the style guide." }]}
        labels={appStrings.en.assistant}
        runActivities={[
          {
            type: "activity",
            runId: "run-1",
            activityId: "read",
            sequence: 1,
            kind: "document_read",
            status: "started",
            title: "raw read",
            relativePath: "guides/style.md"
          }
        ]}
        runningRunId="run-1"
        transcriptRef={null}
      />
    );

    expect(html).toContain("is-active-status");
    expect(html).toContain("assistant-status-wave");
    expect(html).toContain("aria-label=\"Thinking\"");
    expect(html).toContain("Agent activity");
    expect(html).toContain("Reading guides/style.md");
  });
});
