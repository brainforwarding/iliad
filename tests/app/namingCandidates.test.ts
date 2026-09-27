import { afterEach, describe, expect, it, vi } from "vitest";
import { applyPathRelocation } from "../../src/app/pathRelocation";
import { relocateHistoryStackPaths } from "../../src/app/useDocumentHistory";
import {
  dropNamingCandidate,
  isNamingCandidate,
  maxNamingCandidates,
  namingCandidatesStorageKey,
  namingCandidatesToDrop,
  readNamingCandidates,
  recordNamingCandidate,
  relocateNamingCandidates,
  sanitizeNamingCandidates,
  writeNamingCandidates,
  type PathRelocation
} from "../../src/preferences/namingCandidates";
import type { FileTreeNode } from "../../src/types/iliad";

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

function doc(relativePath: string): FileTreeNode {
  return { name: relativePath.split("/").pop() ?? relativePath, path: `/ws/${relativePath}`, relativePath, kind: "markdown" };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("naming candidates", () => {
  it("records exact document paths, normalized and de-duplicated", () => {
    let list = recordNamingCandidate([], "drafts\\untitled.md");
    list = recordNamingCandidate(list, "./drafts/untitled.md");
    list = recordNamingCandidate(list, "untitled-2.md");
    expect(list).toEqual(["drafts/untitled.md", "untitled-2.md"]);
    expect(isNamingCandidate(list, "drafts/untitled.md")).toBe(true);
    expect(isNamingCandidate(list, "drafts/untitled-3.md")).toBe(false);
  });

  it("never records companions, non-Markdown files or unsafe paths", () => {
    expect(recordNamingCandidate([], "untitled.comments.md")).toEqual([]);
    expect(recordNamingCandidate([], "image.png")).toEqual([]);
    expect(recordNamingCandidate([], "../outside.md")).toEqual([]);
    expect(sanitizeNamingCandidates(["a.md", 3, null, "a.md", "b.txt"])).toEqual(["a.md"]);
  });

  it("caps the list, keeping the most recent", () => {
    const many = Array.from({ length: maxNamingCandidates + 5 }, (_, index) => `untitled-${index}.md`);
    const list = sanitizeNamingCandidates(many);
    expect(list).toHaveLength(maxNamingCandidates);
    expect(list.at(-1)).toBe(`untitled-${maxNamingCandidates + 4}.md`);
  });

  it("drops a document", () => {
    expect(dropNamingCandidate(["a.md", "b.md"], "a.md")).toEqual(["b.md"]);
  });

  it("relocates on move, drops on a manual rename, consumes on auto-rename", () => {
    const list = ["drafts/untitled.md", "other.md"];
    expect(relocateNamingCandidates(list, "drafts/untitled.md", "archive/untitled.md", "move")).toEqual([
      "archive/untitled.md",
      "other.md"
    ]);
    expect(relocateNamingCandidates(list, "drafts/untitled.md", "drafts/Plan.md", "manual-rename")).toEqual(["other.md"]);
    expect(relocateNamingCandidates(list, "drafts/untitled.md", "drafts/plan.md", "auto-rename")).toEqual(["other.md"]);
  });

  it("keeps documents inside a renamed or moved folder as candidates", () => {
    const list = ["drafts/untitled.md", "drafts-old/untitled.md"];
    expect(relocateNamingCandidates(list, "drafts", "Borradores", "manual-rename")).toEqual([
      "Borradores/untitled.md",
      "drafts-old/untitled.md"
    ]);
    expect(relocateNamingCandidates(list, "drafts", "archive/drafts", "move")).toEqual([
      "archive/drafts/untitled.md",
      "drafts-old/untitled.md"
    ]);
  });

  it("drops vanished (once seen) and reviewed candidates", () => {
    const candidates = ["seen-gone.md", "fresh.md", "present.md", "Reviewed.md"];
    const tree = [doc("present.md"), doc("Reviewed.md")];
    const { drop, present } = namingCandidatesToDrop(candidates, {
      tree,
      seenInTree: new Set(["seen-gone.md"]),
      reviewedRelativePaths: ["reviewed.md"]
    });
    expect(drop).toEqual(["seen-gone.md", "Reviewed.md"]);
    expect(present).toEqual(["present.md", "Reviewed.md"]);
  });

  it("applies only reviews while the tree is not loaded", () => {
    const { drop, present } = namingCandidatesToDrop(["a.md", "b.md"], {
      tree: null,
      seenInTree: new Set(["a.md", "b.md"]),
      reviewedRelativePaths: ["b.md"]
    });
    expect(drop).toEqual(["b.md"]);
    expect(present).toEqual([]);
  });

  it("stores candidates per workspace and survives broken storage", () => {
    const store = stubLocalStorage();
    writeNamingCandidates("/ws-a", ["untitled.md"]);
    writeNamingCandidates("/ws-b", ["notes/untitled-2.md"]);
    expect(readNamingCandidates("/ws-a")).toEqual(["untitled.md"]);
    expect(readNamingCandidates("/ws-b")).toEqual(["notes/untitled-2.md"]);
    writeNamingCandidates("/ws-a", []);
    expect(JSON.parse(store.get(namingCandidatesStorageKey) as string)).toEqual({ "/ws-b": ["notes/untitled-2.md"] });

    stubLocalStorage({ [namingCandidatesStorageKey]: "{not json" });
    expect(readNamingCandidates("/ws-a")).toEqual([]);

    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      }
    });
    expect(() => writeNamingCandidates("/ws-a", ["a.md"])).not.toThrow();
    expect(readNamingCandidates("/ws-a")).toEqual([]);
  });
});

describe("applyPathRelocation", () => {
  it("relocates recents, Back/Forward history and candidates for a manual rename", () => {
    let history = ["/ws/drafts/untitled.md", "/ws/other.md"];
    const recents: Array<[string, string, string]> = [];
    const candidates: PathRelocation[] = [];
    const relocation: PathRelocation = {
      workspaceRoot: "/ws",
      oldPath: "/ws/drafts/untitled.md",
      newPath: "/ws/drafts/Plan.md",
      oldRelativePath: "drafts/untitled.md",
      newRelativePath: "drafts/Plan.md",
      reason: "manual-rename"
    };

    applyPathRelocation(relocation, {
      relocateRecent: (...args) => recents.push(args),
      relocateHistoryPaths: (oldPath, newPath) => {
        history = relocateHistoryStackPaths(history, oldPath, newPath);
      },
      relocateNamingCandidates: (value) => candidates.push(value)
    });

    expect(history).toEqual(["/ws/drafts/Plan.md", "/ws/other.md"]);
    expect(recents).toEqual([["/ws", "drafts/untitled.md", "drafts/Plan.md"]]);
    expect(candidates).toEqual([relocation]);
  });
});
