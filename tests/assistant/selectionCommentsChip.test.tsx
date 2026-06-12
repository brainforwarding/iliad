import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  clearSentSelectionComments,
  markSelectionCommentsSent,
  pendingSelectionComments,
  removeSelectionComment,
  revertSelectionCommentsToPending,
  selectionCommentExcerpt,
  sortSelectionCommentsForDisplay
} from "../../src/assistant/selectionComments";
import { AssistantSelectionCommentsChip } from "../../src/components/assistant/AssistantSelectionComments";
import { AssistantTranscript } from "../../src/components/assistant/AssistantTranscript";
import { appStrings } from "../../src/i18n/strings";
import type { AssistantEntry } from "../../src/assistant/useAssistantRun";
import type { SelectionComment } from "../../src/types/iliad";

function comment(overrides: Partial<SelectionComment>): SelectionComment {
  return {
    id: "comment-test",
    workspacePath: "/ws",
    documentRelativePath: "course-map.md",
    from: 10,
    to: 20,
    quote: "quoted text",
    occurrence: 1,
    prefix: "",
    comment: "tighten this",
    createdAt: new Date(0).toISOString(),
    status: "pending",
    ...overrides
  };
}

function renderChip(options?: {
  count?: number;
  items?: Array<{ id: string; excerpt: string; comment: string; anchored: boolean }>;
  initiallyExpanded?: boolean;
  language?: "en" | "es";
}) {
  return renderToStaticMarkup(
    <AssistantSelectionCommentsChip
      count={options?.count ?? 3}
      documentName="course-map.md"
      documentPath="/ws/course-map.md"
      items={
        options?.items ?? [
          { id: "c1", excerpt: "the three big ideas", comment: "too long", anchored: true },
          { id: "c2", excerpt: "video", comment: "verify this exists", anchored: true },
          { id: "c3", excerpt: "old text", comment: "restore this", anchored: false }
        ]
      }
      labels={appStrings[options?.language ?? "en"].assistant.selectionComments}
      initiallyExpanded={options?.initiallyExpanded ?? false}
      onDiscardItem={() => undefined}
      onSelectItem={() => undefined}
    />
  );
}

describe("AssistantSelectionCommentsChip", () => {
  it("renders the chip summary with count and document name", () => {
    const html = renderChip();

    expect(html).toContain("3 comments · course-map.md");
    expect(html).toContain('aria-expanded="false"');
    // The count and the document name are separate spans: the count never
    // truncates; only the document name may ellipsize.
    expect(html).toContain('<span class="assistant-comments-chip-count">3 comments</span>');
    expect(html).toContain('<span class="assistant-comments-chip-doc"> · course-map.md</span>');
    // Collapsed: the list is not rendered.
    expect(html).not.toContain("assistant-comments-list");
  });

  it("uses the singular form and the Spanish dictionary", () => {
    expect(renderChip({ count: 1 })).toContain("1 comment · course-map.md");
    expect(renderChip({ language: "es" })).toContain("3 comentarios · course-map.md");
  });

  it("renders expanded list rows with excerpt and comment", () => {
    const html = renderChip({ initiallyExpanded: true });

    expect(html).toContain("assistant-comments-list");
    expect(html).toContain("the three big ideas");
    expect(html).toContain("too long");
    expect(html).toContain("verify this exists");
    expect(html).toContain('aria-label="Discard comment"');
    expect(html).toContain("Go to &quot;the three big ideas&quot;");
  });

  it("renders the expanded list as a sibling of the chip, with per-row buttons", () => {
    const html = renderChip({ initiallyExpanded: true });

    // The list must NOT be nested inside the chip span: chips are
    // position: relative (tooltip anchoring), and a nested absolute list
    // would collapse to the chip's width instead of spanning the composer.
    expect(html).toContain('</span><div class="assistant-comments-list"');
    expect(html).toContain("assistant-comments-row-main");
    expect(html).toContain("assistant-comments-row-remove");
  });

  it("marks sin-ancla rows as muted orphans without warning chrome", () => {
    const html = renderChip({ initiallyExpanded: true });

    expect(html).toContain("assistant-comments-row is-orphan");
    expect(html).toContain("no anchor · old text");
    expect(html).not.toContain("warning");
  });

  it("renders nothing when there are no pending comments", () => {
    expect(renderChip({ count: 0, items: [] })).toBe("");
  });
});

describe("transcript disclosure", () => {
  function renderTranscript(entry: AssistantEntry) {
    return renderToStaticMarkup(
      <AssistantTranscript
        entries={[entry]}
        labels={appStrings.en.assistant}
        runningRunId={null}
        transcriptRef={null}
      />
    );
  }

  it("shows typed text plus a compact disclosure for sent comments", () => {
    const html = renderTranscript({
      id: "run-1-user",
      kind: "user",
      text: "apply 1 and 3\n\nComments on `course-map.md`: …",
      selectionComments: {
        count: 2,
        block: "Comments on `course-map.md`:\n\n1. Line 3 · \"x\"",
        typedText: "apply 1 and 3"
      }
    });

    expect(html).toContain("apply 1 and 3");
    expect(html).toContain("<details");
    expect(html).toContain("2 comments");
    expect(html).toContain("Comments on");
    // The raw composed text is not duplicated outside the disclosure.
    expect(html.indexOf("Comments on")).toBeGreaterThan(html.indexOf("<details"));
  });

  it("shows only the disclosure when the user sent without typing", () => {
    const html = renderTranscript({
      id: "run-2-user",
      kind: "user",
      text: "Comments on `course-map.md`: …",
      selectionComments: {
        count: 1,
        block: "Comments on `course-map.md`: …",
        typedText: ""
      }
    });

    expect(html).toContain("1 comment");
    expect(html).not.toContain("assistant-user-typed-text");
  });

  it("falls back to the composed text for entries without the ephemeral field", () => {
    const html = renderTranscript({
      id: "restored-user",
      kind: "user",
      text: "restored composed text"
    });

    expect(html).toContain("restored composed text");
    expect(html).not.toContain("<details");
  });
});

describe("selection comment transitions (pure)", () => {
  it("marks pending comments sent and reverts them on failure", () => {
    const comments = [comment({ id: "c1" }), comment({ id: "c2" })];
    const sent = markSelectionCommentsSent(comments, ["c1"]);

    expect(sent.find((item) => item.id === "c1")?.status).toBe("sent");
    expect(sent.find((item) => item.id === "c2")?.status).toBe("pending");

    const reverted = revertSelectionCommentsToPending(sent, ["c1"]);
    expect(reverted.every((item) => item.status === "pending")).toBe(true);
  });

  it("clears sent comments entirely after the fade (no sent trace)", () => {
    const comments = markSelectionCommentsSent([comment({ id: "c1" }), comment({ id: "c2" })], ["c1", "c2"]);
    const cleared = clearSentSelectionComments(comments, ["c1", "c2"]);

    expect(cleared).toEqual([]);
  });

  it("does not clear comments that were reverted before the fade finished", () => {
    const sent = markSelectionCommentsSent([comment({ id: "c1" })], ["c1"]);
    const reverted = revertSelectionCommentsToPending(sent, ["c1"]);
    const cleared = clearSentSelectionComments(reverted, ["c1"]);

    expect(cleared).toHaveLength(1);
    expect(cleared[0].status).toBe("pending");
  });

  it("discards a single comment by id", () => {
    const comments = [comment({ id: "c1" }), comment({ id: "c2" })];

    expect(removeSelectionComment(comments, "c1").map((item) => item.id)).toEqual(["c2"]);
  });

  it("filters to pending comments only", () => {
    const comments = [comment({ id: "c1" }), comment({ id: "c2", status: "sent" })];

    expect(pendingSelectionComments(comments).map((item) => item.id)).toEqual(["c1"]);
  });

  it("sorts anchored comments by position with orphans last", () => {
    const sorted = sortSelectionCommentsForDisplay([
      comment({ id: "orphan", from: 0, to: 0, createdAt: new Date(5).toISOString() }),
      comment({ id: "late", from: 40, to: 50 }),
      comment({ id: "early", from: 2, to: 6 })
    ]);

    expect(sorted.map((item) => item.id)).toEqual(["early", "late", "orphan"]);
  });

  it("flattens and truncates excerpts", () => {
    expect(selectionCommentExcerpt("line one\nline two")).toBe("line one⏎line two");

    const long = selectionCommentExcerpt("x".repeat(80));
    expect(long).toHaveLength(46);
    expect(long.endsWith("…")).toBe(true);
  });
});
