import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultSettingsTab,
  readSettingsTab,
  settingsTabForKey,
  settingsTabStorageKey,
  writeSettingsTab
} from "../../src/preferences/settingsTab";

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

describe("settings tab preference", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to General and ignores unknown stored values", () => {
    stubLocalStorage();
    expect(readSettingsTab()).toBe(defaultSettingsTab);
    expect(defaultSettingsTab).toBe("general");
    stubLocalStorage({ [settingsTabStorageKey]: "chat" });
    expect(readSettingsTab()).toBe("general");
  });

  it("remembers the last tab under iliad:settings-tab", () => {
    const store = stubLocalStorage();
    writeSettingsTab("writing");
    expect(settingsTabStorageKey).toBe("iliad:settings-tab");
    expect(store.get("iliad:settings-tab")).toBe("writing");
    expect(readSettingsTab()).toBe("writing");
  });

  it("survives storage that throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      }
    });
    expect(readSettingsTab()).toBe("general");
    expect(() => writeSettingsTab("typography")).not.toThrow();
  });
});

describe("settings tab keys", () => {
  it("moves with the arrow keys, wrapping, and jumps with Home/End", () => {
    expect(settingsTabForKey("general", "ArrowRight")).toBe("typography");
    expect(settingsTabForKey("writing", "ArrowRight")).toBe("general");
    expect(settingsTabForKey("general", "ArrowLeft")).toBe("writing");
    expect(settingsTabForKey("typography", "Home")).toBe("general");
    expect(settingsTabForKey("typography", "End")).toBe("writing");
    expect(settingsTabForKey("typography", "Enter")).toBeNull();
  });
});
