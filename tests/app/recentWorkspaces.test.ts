import { afterEach, describe, expect, it, vi } from "vitest";
import { mergeRecentWorkspaces, persistWorkspace } from "../../src/app/useWorkspace";

const ws = (name: string, path: string) => ({ name, path });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("mergeRecentWorkspaces", () => {
  it("puts the newest first", () => {
    const result = mergeRecentWorkspaces([ws("a", "/a")], ws("b", "/b"));
    expect(result.map((w) => w.path)).toEqual(["/b", "/a"]);
  });

  it("dedupes by path (case-insensitive), moving the re-opened folder to the top", () => {
    const result = mergeRecentWorkspaces([ws("a", "/a"), ws("b", "/b")], ws("A", "/A"));
    expect(result.map((w) => w.path)).toEqual(["/A", "/b"]);
    expect(result).toHaveLength(2);
  });

  it("caps the list length, dropping the oldest", () => {
    const start = [ws("1", "/1"), ws("2", "/2"), ws("3", "/3")];
    const result = mergeRecentWorkspaces(start, ws("4", "/4"), 3);
    expect(result.map((w) => w.path)).toEqual(["/4", "/1", "/2"]);
  });

  it("does not persist runtime workspace session ids", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => {
        values.delete(key);
      },
      setItem: (key: string, value: string) => {
        values.set(key, value);
      }
    });

    persistWorkspace({ name: "docs", path: "/docs", sessionId: "runtime-session" });

    expect(JSON.parse(values.get("iliad:last-workspace") ?? "{}")).toEqual({
      name: "docs",
      path: "/docs"
    });
  });
});
