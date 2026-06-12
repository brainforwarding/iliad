import { describe, expect, it } from "vitest";
import { TELEGRAM_CHUNK_MAX_LENGTH, TELEGRAM_REMOTE_REQUEST_VERSION, type RemoteResponse } from "../src/protocol.js";
import { chunkTelegramText, formatRemoteResponse, parseTelegramAction } from "../src/telegram.js";

describe("telegram formatting", () => {
  it("parses commands and plain text asks", () => {
    expect(parseTelegramAction(message("/start token-1"))).toEqual({ type: "pair", token: "token-1" });
    expect(parseTelegramAction(message("/ask What changed?"))).toEqual({ type: "ask", text: "What changed?" });
    expect(parseTelegramAction(message("/status@iliad_bot"))).toEqual({ type: "status" });
    expect(parseTelegramAction(message("What did I decide?"))).toEqual({ type: "ask", text: "What did I decide?" });
  });

  it("formats answers as plain text with sources and chunks long messages", () => {
    const response: RemoteResponse = {
      version: TELEGRAM_REMOTE_REQUEST_VERSION,
      id: "req-1",
      ok: true,
      type: "answer",
      text: "Use the workshop rubric.",
      sources: [
        { relativePath: "notes/workshop.md", line: 12 },
        { relativePath: "notes/workshop.md", line: 12 },
        { relativePath: "rubrics/final.md" }
      ],
      manifestId: "manifest-secret"
    };

    expect(formatRemoteResponse(response)).toEqual(["Use the workshop rubric.\n\nSources:\n- notes/workshop.md:12\n- rubrics/final.md"]);

    const chunks = chunkTelegramText("a".repeat(TELEGRAM_CHUNK_MAX_LENGTH + 20));
    expect(chunks).toHaveLength(2);
    expect(chunks.every((chunk) => chunk.length <= TELEGRAM_CHUNK_MAX_LENGTH)).toBe(true);
  });
});

function message(text: string) {
  return {
    message_id: 1,
    text,
    chat: { id: 10, type: "private" as const }
  };
}
