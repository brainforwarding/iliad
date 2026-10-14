import { afterEach, describe, expect, it, vi } from "vitest";
import {
  commentMarginStorageKey,
  readCommentMarginVisible,
  writeCommentMarginVisible
} from "../../src/preferences/commentMarginPreferences";

function stubLocalStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  vi.stubGlobal("localStorage", {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    })
  });
  return store;
}

describe("comment margin preference", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts hidden and ignores unknown stored values", () => {
    stubLocalStorage();
    expect(readCommentMarginVisible()).toBe(false);
    stubLocalStorage({ [commentMarginStorageKey]: "yes" });
    expect(readCommentMarginVisible()).toBe(false);
  });

  it("remembers the choice", () => {
    const store = stubLocalStorage();
    writeCommentMarginVisible(true);
    expect(store.get(commentMarginStorageKey)).toBe("shown");
    expect(readCommentMarginVisible()).toBe(true);
    writeCommentMarginVisible(false);
    expect(readCommentMarginVisible()).toBe(false);
  });

  it("falls back to hidden when storage throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      }
    });
    expect(readCommentMarginVisible()).toBe(false);
    expect(() => writeCommentMarginVisible(true)).not.toThrow();
  });
});
