import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AssistantHistoryView } from "../../src/components/assistant/AssistantHistoryView";
import { appStrings } from "../../src/i18n/strings";
import type { AgentChatThreadSummary } from "../../src/types/iliad";

describe("AssistantHistoryView", () => {
  it("renders saved thread titles with compact right-side ages and no new conversation row", () => {
    const threads: AgentChatThreadSummary[] = [
      {
        id: "thread-1",
        title: "Guia para clase sincronica",
        titleSource: "fallback",
        updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        messageCount: 2
      }
    ];

    const html = renderToStaticMarkup(
      <AssistantHistoryView
        activeThreadId="thread-1"
        disabled={false}
        labels={appStrings.en.assistant}
        loading={false}
        threads={threads}
        onBack={() => undefined}
        onClear={() => undefined}
        onSelect={() => undefined}
      />
    );

    expect(html).toContain("History");
    expect(html).toContain("Guia para clase sincronica");
    expect(html).toContain("<time");
    expect(html).toContain("2h");
    expect(html).not.toContain("New conversation");
    expect(html).not.toContain("New chat");
  });

  it("disables rows and clear history while a run is active", () => {
    const threads: AgentChatThreadSummary[] = [
      {
        id: "thread-1",
        title: "Saved chat",
        titleSource: "ai",
        updatedAt: new Date().toISOString(),
        messageCount: 2
      }
    ];

    const html = renderToStaticMarkup(
      <AssistantHistoryView
        activeThreadId={null}
        disabled
        labels={appStrings.en.assistant}
        loading={false}
        threads={threads}
        onBack={() => undefined}
        onClear={() => undefined}
        onSelect={() => undefined}
      />
    );

    expect(html.match(/disabled=""/g)?.length).toBe(2);
  });
});
