import { describe, expect, it, vi } from "vitest";
import { handleAutocompleteIpc } from "../../electron/ipc/autocomplete";

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp" },
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { fromWebContents: () => ({}) }
}));

const event = { sender: { id: 7, isDestroyed: () => false, send: vi.fn() }, senderFrame: { url: "file:///app/index.html" } } as never;

describe("autocomplete IPC request normalization", () => {
  it("drops notes text and old automatic fields; every request is an explicit length", async () => {
    const autocompleteIdea = vi.fn(async () => "quiet room.");
    const result = await handleAutocompleteIpc(event, {
      requestId: "r1",
      workspaceSessionId: "s",
      documentRelativePath: "a.md",
      language: "en",
      prefix: "She walked into the ",
      suffix: "",
      headingPath: [],
      documentTitle: "a",
      nearbyHeadings: [],
      // An older renderer could still send these; they must not reach the model.
      guidance: "Author's private notes",
      trigger: "automatic",
      suggestionKind: "inline"
    } as never, {
      service: { autocompleteIdea },
      controllers: new Map(),
      resolveWorkspaceRootForSession: () => "/ws"
    });

    expect(result).toEqual({ ok: true, insert: "quiet room." });
    const sent = (autocompleteIdea.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(sent.suggestionKind).toBe("sentence");
    expect(sent).not.toHaveProperty("guidance");
    expect(sent).not.toHaveProperty("trigger");
    expect(JSON.stringify(sent)).not.toContain("private notes");
  });
});
