import { describe, expect, it } from "vitest";
import {
  WRITING_PREFERENCES_MAX_CHARS,
  WRITING_PREFERENCES_STORAGE_KEY,
  clampWritingPreferences,
  readWritingPreferences,
  saveWritingPreferences,
  writingPreferencesForRequest
} from "../../src/preferences/writingPreferences";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key)
  };
}

const broken = {
  getItem: () => { throw new Error("denied"); },
  setItem: () => { throw new Error("quota"); },
  removeItem: () => { throw new Error("denied"); }
};

describe("writing preferences store", () => {
  it("uses its own key and round-trips the text as typed", () => {
    const storage = memoryStorage();
    expect(WRITING_PREFERENCES_STORAGE_KEY).toBe("iliad:writing-preferences");
    expect(saveWritingPreferences("Short sentences. ", storage)).toBe("Short sentences. ");
    expect(readWritingPreferences(storage)).toBe("Short sentences. ");
  });

  it("removes the entry when cleared or whitespace only", () => {
    const storage = memoryStorage({ [WRITING_PREFERENCES_STORAGE_KEY]: "old" });
    saveWritingPreferences("  \n ", storage);
    expect(storage.data.has(WRITING_PREFERENCES_STORAGE_KEY)).toBe(false);
    expect(readWritingPreferences(storage)).toBe("");
  });

  it("holds the text to 1,000 characters", () => {
    const storage = memoryStorage({ [WRITING_PREFERENCES_STORAGE_KEY]: "a".repeat(1500) });
    expect(readWritingPreferences(storage)).toHaveLength(WRITING_PREFERENCES_MAX_CHARS);
    expect(saveWritingPreferences("b".repeat(1200), storage)).toHaveLength(1000);
    expect(clampWritingPreferences(42)).toBe("");
  });

  it("survives storage failures: reads empty, keeps the session value", () => {
    expect(readWritingPreferences(broken)).toBe("");
    expect(saveWritingPreferences("Keep my voice.", broken)).toBe("Keep my voice.");
    expect(saveWritingPreferences("", broken)).toBe("");
    expect(readWritingPreferences(null)).toBe("");
  });

  it("sends the trimmed text, or nothing when empty", () => {
    expect(writingPreferencesForRequest("  Plain Spanish.\n")).toBe("Plain Spanish.");
    expect(writingPreferencesForRequest("   ")).toBeUndefined();
    expect(writingPreferencesForRequest("")).toBeUndefined();
    expect(writingPreferencesForRequest(undefined)).toBeUndefined();
    expect(writingPreferencesForRequest("x".repeat(1200))).toHaveLength(1000);
  });
});
