import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clampSidebarWidth,
  defaultSidebarWidth,
  maximumPreferredSidebarWidth,
  minimumSidebarWidth,
  readSidebarWidth,
  sidebarWidthStorageKey
} from "../../src/preferences/sidebarPreferences";

function stubLocalStorage(initialValue: string | null) {
  const store = new Map<string, string>();

  if (initialValue !== null) {
    store.set(sidebarWidthStorageKey, initialValue);
  }

  vi.stubGlobal("localStorage", {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    })
  });
}

describe("sidebar width preferences", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("clamps widths to the sidebar interaction bounds", () => {
    expect(clampSidebarWidth(100)).toBe(minimumSidebarWidth);
    expect(clampSidebarWidth(276.4)).toBe(276);
    expect(clampSidebarWidth(999)).toBe(maximumPreferredSidebarWidth);
    expect(clampSidebarWidth(Number.NaN)).toBe(defaultSidebarWidth);
  });

  it("honors the effective viewport maximum without lowering the minimum", () => {
    expect(clampSidebarWidth(520, 360)).toBe(360);
    expect(clampSidebarWidth(180, 160)).toBe(minimumSidebarWidth);
  });

  it("reads a stored width and falls back for missing or invalid values", () => {
    stubLocalStorage("340");
    expect(readSidebarWidth()).toBe(340);

    stubLocalStorage("not-a-number");
    expect(readSidebarWidth()).toBe(defaultSidebarWidth);

    stubLocalStorage(null);
    expect(readSidebarWidth()).toBe(defaultSidebarWidth);
  });

  it("clamps persisted values on read", () => {
    stubLocalStorage("96");
    expect(readSidebarWidth()).toBe(minimumSidebarWidth);

    stubLocalStorage("900");
    expect(readSidebarWidth()).toBe(maximumPreferredSidebarWidth);
  });
});
