import { describe, expect, it, vi } from "vitest";
import { writingGuidanceStorageKey } from "../../src/editor/ideaAutocomplete/options";
import { legacyNotesText, migrateLegacyWritingNotes } from "../../src/notes/legacyWritingNotes";
import type { WriteMarkdownResult } from "../../src/types/iliad";

function storage(entries: Record<string, string>) {
  const map = new Map(Object.entries(entries));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    }
  };
}

const key = writingGuidanceStorageKey("/ws", "chapter.md");

describe("legacy writing notes migration", () => {
  it("formats the voice line, then the facts", () => {
    expect(legacyNotesText({ enabled: true, voice: " Close third. ", facts: "Mara is left-handed.\nRain all week." })).toBe(
      "Close third.\n\nMara is left-handed.\nRain all week.\n"
    );
    expect(legacyNotesText({ voice: "", facts: "" })).toBe("");
  });

  it("writes the notes file only if absent, then removes the key", async () => {
    const store = storage({ [key]: JSON.stringify({ enabled: true, voice: "Warm.", facts: "Fact." }) });
    const writeIfAbsent = vi.fn(async (): Promise<WriteMarkdownResult> => ({ status: "written", savedAt: "" }));

    await expect(
      migrateLegacyWritingNotes({ storage: store, workspacePath: "/ws", documentRelativePath: "chapter.md", writeIfAbsent })
    ).resolves.toBe("written");
    expect(writeIfAbsent).toHaveBeenCalledWith("Warm.\n\nFact.\n");
    expect(store.map.has(key)).toBe(false);
  });

  it("leaves an existing notes file alone and still removes the key", async () => {
    const store = storage({ [key]: JSON.stringify({ voice: "Warm.", facts: "" }) });
    const writeIfAbsent = async (): Promise<WriteMarkdownResult> => ({ status: "conflict", reason: "disk_changed" });

    await expect(
      migrateLegacyWritingNotes({ storage: store, workspacePath: "/ws", documentRelativePath: "chapter.md", writeIfAbsent })
    ).resolves.toBe("kept-existing");
    expect(store.map.has(key)).toBe(false);
  });

  it("keeps the key when the write failed for another reason, and does nothing without one", async () => {
    const store = storage({ [key]: JSON.stringify({ voice: "Warm." }) });
    const unsafe = async (): Promise<WriteMarkdownResult> => ({ status: "conflict", reason: "unsafe_path" });

    await migrateLegacyWritingNotes({ storage: store, workspacePath: "/ws", documentRelativePath: "chapter.md", writeIfAbsent: unsafe });
    expect(store.map.has(key)).toBe(true);

    const writeIfAbsent = vi.fn();
    await expect(
      migrateLegacyWritingNotes({ storage: storage({}), workspacePath: "/ws", documentRelativePath: "chapter.md", writeIfAbsent })
    ).resolves.toBe("none");
    expect(writeIfAbsent).not.toHaveBeenCalled();
  });
});
