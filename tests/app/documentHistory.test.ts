import { describe, expect, it } from "vitest";
import { documentHistoryShortcut, relocateHistoryStackPaths } from "../../src/app/useDocumentHistory";
import { editorDefaultKeymap } from "../../src/editor/CodeMirrorHost";

describe("relocateHistoryStackPaths", () => {
  it("relocates only entries inside the moved path", () => {
    expect(
      relocateHistoryStackPaths(
        [
          "/workspace/drafts/one.md",
          "/workspace/drafts/section/two.md",
          "/workspace/drafts-old/three.md",
          "/workspace/root.md"
        ],
        "/workspace/drafts",
        "/workspace/archive/drafts"
      )
    ).toEqual([
      "/workspace/archive/drafts/one.md",
      "/workspace/archive/drafts/section/two.md",
      "/workspace/drafts-old/three.md",
      "/workspace/root.md"
    ]);
  });
});

describe("documentHistoryShortcut", () => {
  const key = (value: string, overrides: Partial<Parameters<typeof documentHistoryShortcut>[0]> = {}) =>
    documentHistoryShortcut({
      key: value,
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      repeat: false,
      isComposing: false,
      defaultPrevented: false,
      ...overrides
    });

  it("maps ⌘[ to Back and ⌘] to Forward (Ctrl too)", () => {
    expect(key("[")).toBe("back");
    expect(key("]")).toBe("forward");
    expect(key("[", { metaKey: false, ctrlKey: true })).toBe("back");
  });

  it("ignores other keys, extra modifiers and handled, held or composing keys", () => {
    expect(key("w")).toBeNull();
    expect(key("[", { metaKey: false })).toBeNull();
    expect(key("[", { shiftKey: true })).toBeNull();
    expect(key("]", { altKey: true })).toBeNull();
    expect(key("[", { repeat: true })).toBeNull();
    expect(key("[", { isComposing: true })).toBeNull();
    expect(key("]", { defaultPrevented: true })).toBeNull();
  });

  it("is not claimed by the editor's default keymap", () => {
    const keys = editorDefaultKeymap.map((binding) => binding.key);
    expect(keys).not.toContain("Mod-[");
    expect(keys).not.toContain("Mod-]");
    expect(keys).toContain("Mod-Alt-\\");
  });
});
