import { describe, expect, it } from "vitest";
import {
  compactChatThreadAge,
  fallbackChatThreadTitle,
  visibleHistoryEntries
} from "../../src/assistant/chatHistory";

describe("chat history helpers", () => {
  it("formats compact relative ages", () => {
    const now = new Date("2026-05-25T12:00:00.000Z");

    expect(compactChatThreadAge("2026-05-25T11:59:20.000Z", now)).toBe("1m");
    expect(compactChatThreadAge("2026-05-25T10:00:00.000Z", now)).toBe("2h");
    expect(compactChatThreadAge("2026-05-23T12:00:00.000Z", now)).toBe("2d");
    expect(compactChatThreadAge("2026-05-04T12:00:00.000Z", now)).toBe("3w");
  });

  it("extracts fallback titles from user Markdown", () => {
    expect(fallbackChatThreadTitle("# Guia rapida: estrategias para activar...")).toBe(
      "Guia rapida: estrategias para activar"
    );
    expect(fallbackChatThreadTitle("deberiamos tener una guia con estrategias...")).toBe(
      "deberiamos tener una guia con estrategias"
    );
  });

  it("keeps only visible transcript fields for persistence", () => {
    const entries = visibleHistoryEntries([
      {
        id: "assistant",
        kind: "assistant",
        text: "Visible",
        createdAt: "2026-05-25T12:00:00.000Z",
        contextManifest: { workspaceId: "secret" }
      },
      { id: "blank", kind: "user", text: "" }
    ]);

    expect(entries).toEqual([
      {
        id: "assistant",
        kind: "assistant",
        text: "Visible",
        createdAt: "2026-05-25T12:00:00.000Z"
      }
    ]);
  });

  it("preserves valid source metadata and drops invalid source metadata", () => {
    const entries = visibleHistoryEntries([
      {
        id: "remote",
        kind: "user",
        text: "Remote question",
        createdAt: "2026-05-25T12:00:00.000Z",
        source: "telegram"
      },
      {
        id: "invalid-source",
        kind: "assistant",
        text: "Answer",
        createdAt: "2026-05-25T12:00:01.000Z",
        source: "relay"
      } as never
    ]);

    expect(entries).toEqual([
      expect.objectContaining({ id: "remote", source: "telegram" }),
      expect.not.objectContaining({ source: expect.anything() })
    ]);
  });

  it("strips the ephemeral receipt fields (activities, attachments) from persisted entries", () => {
    const entries = visibleHistoryEntries([
      {
        id: "assistant",
        kind: "assistant",
        text: "Visible",
        createdAt: "2026-06-11T12:00:00.000Z",
        contextManifest: { workspaceId: "secret" },
        activities: [{ activityId: "read", kind: "document_read" }],
        attachments: [{ relativePath: "rubrica.md", label: "rubrica.md" }]
      } as never
    ]);

    expect(entries).toEqual([
      {
        id: "assistant",
        kind: "assistant",
        text: "Visible",
        createdAt: "2026-06-11T12:00:00.000Z"
      }
    ]);
  });
});
