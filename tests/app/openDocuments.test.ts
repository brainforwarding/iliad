import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createOpenDocumentsState, cycleOpenDocument, openDocumentCloseNeighbor, openDocumentLabels,
  openDocumentsStorageKey, prepareOpenDocumentsRestore, readOpenDocumentsSession, recordOpenDocument,
  recordOpenDocumentsState, relocateOpenDocuments, removeOpenDocument, resolveOpenDocumentsSession,
  sanitizeOpenDocumentsSession, tabCycleDirection, writeOpenDocumentsSession,
  type OpenDocument
} from "../../src/app/useOpenDocuments";
import type { PathRelocation } from "../../src/preferences/namingCandidates";
import type { FileTreeNode } from "../../src/types/iliad";

function storage() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value)
  });
  return store;
}

function doc(relativePath: string, root = "/ws"): FileTreeNode {
  return { name: relativePath.split("/").at(-1)!, path: `${root}/${relativePath}`, relativePath, kind: "markdown" };
}

function opened(...paths: string[]) {
  return paths.reduce<OpenDocument[]>((documents, path) => recordOpenDocument(documents, "/ws", doc(path)), []);
}

afterEach(() => vi.unstubAllGlobals());

describe("open document session metadata", () => {
  it("keeps only safe, exact, normalized relative Markdown paths and a member active path", () => {
    expect(sanitizeOpenDocumentsSession({
      paths: ["a.md", "a.md", "A.md", "notes\\b.markdown", "/secret.md", "../secret.md", "x/../secret.md",
        "C:\\secret.md", "//host/secret.md", "./a.md", "x//a.md", "https://x.md", "nul\0.md", 7, "image.png"],
      activePath: "notes\\b.markdown", content: "must never persist", id: "never persist"
    })).toEqual({ paths: ["a.md", "A.md", "notes/b.markdown"], activePath: "notes/b.markdown" });
    expect(sanitizeOpenDocumentsSession({ paths: ["a.md"], activePath: "missing.md" }).activePath).toBeNull();
    expect(sanitizeOpenDocumentsSession(null)).toEqual({ paths: [], activePath: null });
  });

  it("isolates workspace keys and stores no editor state or absolute document paths", () => {
    const store = storage();
    writeOpenDocumentsSession("/ws-a", { paths: ["a.md"], activePath: "a.md" });
    writeOpenDocumentsSession("/ws-b", { paths: ["b.md"], activePath: "b.md" });
    expect(readOpenDocumentsSession("/ws-a")).toEqual({ paths: ["a.md"], activePath: "a.md" });
    expect(readOpenDocumentsSession("/ws-b")).toEqual({ paths: ["b.md"], activePath: "b.md" });
    expect(openDocumentsStorageKey("C:\\work\\notes\\")).toBe(openDocumentsStorageKey("C:/work/notes"));
    expect(openDocumentsStorageKey("/ws/A")).not.toBe(openDocumentsStorageKey("/ws/a"));
    expect(JSON.parse(store.get(openDocumentsStorageKey("/ws-a"))!)).toEqual({ paths: ["a.md"], activePath: "a.md" });
  });

  it("tolerates malformed JSON and unavailable storage", () => {
    const store = storage();
    store.set(openDocumentsStorageKey("/ws"), "{broken");
    expect(readOpenDocumentsSession("/ws").paths).toEqual([]);
    vi.stubGlobal("localStorage", { getItem: () => { throw Error("blocked"); }, setItem: () => { throw Error("blocked"); } });
    expect(readOpenDocumentsSession("/ws").paths).toEqual([]);
    expect(() => writeOpenDocumentsSession("/ws", { paths: [], activePath: null })).not.toThrow();
  });
});

describe("initial restoration and explicit activation", () => {
  it("waits for a ready tree, then restores ordered available paths and the last active target", () => {
    storage();
    writeOpenDocumentsSession("/ws", { paths: ["outline.md", "gone.md", "draft.md"], activePath: "draft.md" });
    const initial = createOpenDocumentsState("/ws");
    expect(prepareOpenDocumentsRestore(initial, [], false)).toBe(initial);
    const restored = prepareOpenDocumentsRestore(initial, [doc("draft.md"), doc("outline.md")], true);
    expect(restored.documents.map((document) => document.relativePath)).toEqual(["outline.md", "draft.md"]);
    expect(restored.restoreTarget?.relativePath).toBe("draft.md");
    expect(restored.activeId).toBeNull(); // App owns actual activation.
    expect(prepareOpenDocumentsRestore(restored, [], true)).toBe(restored); // Live deletion preserves the tabs.
  });

  it("an explicit open before tree readiness prevents a later restored activation", () => {
    storage();
    writeOpenDocumentsSession("/ws", { paths: ["old.md"], activePath: "old.md" });
    const initial = createOpenDocumentsState("/ws");
    const explicit = recordOpenDocumentsState(initial, "/ws", doc("requested.md"));
    expect(explicit.restoration).toBe("done");
    expect(explicit.restoreTarget).toBeNull();
    expect(prepareOpenDocumentsRestore(explicit, [doc("old.md"), doc("requested.md")], true)).toBe(explicit);
    expect(initial.documents).toEqual([]); // No activation is recorded before a successful open.
  });

  it("an explicit open supersedes a pending restored target without discarding restored inactive entries", () => {
    storage();
    writeOpenDocumentsSession("/ws", { paths: ["old.md", "notes.md"], activePath: "old.md" });
    const restored = prepareOpenDocumentsRestore(createOpenDocumentsState("/ws"), [doc("old.md"), doc("notes.md")], true);
    const explicit = recordOpenDocumentsState(restored, "/ws", doc("requested.md"));
    expect(explicit.documents.map((document) => document.relativePath)).toEqual(["old.md", "notes.md", "requested.md"]);
    expect(explicit.restoreTarget).toBeNull();
    expect(explicit.activeId).toBe(explicit.documents[2].id);
  });

  it("resolves only exact tree members owned by the workspace, with a surviving fallback", () => {
    const resolved = resolveOpenDocumentsSession("/ws", { paths: ["A.md", "a.md", "bad.md"], activePath: "gone.md" }, [
      doc("A.md"), doc("a.md"), { ...doc("bad.md"), path: "/outside/bad.md" }
    ]);
    expect(resolved.documents.map((document) => document.relativePath)).toEqual(["A.md", "a.md"]);
    expect(resolved.restoreTarget?.relativePath).toBe("A.md");
  });

  it("does not record cross-workspace, external, ghost, or failed opens", () => {
    storage();
    const initial = createOpenDocumentsState("/ws");
    expect(recordOpenDocumentsState(initial, "/another", doc("a.md", "/another"))).toBe(initial);
    expect(recordOpenDocumentsState(initial, "/ws", { ...doc("a.md"), kind: "external" })).toBe(initial);
    expect(recordOpenDocumentsState(initial, "/ws", { ...doc("a.md"), path: "pending:a.md" })).toBe(initial);
    expect(readOpenDocumentsSession("/ws").paths).toEqual([]);
  });
});

describe("open document identity and navigation", () => {
  it("reuses canonical entries and preserves order across repeated opens", () => {
    const documents = opened("draft.md", "outline.md");
    expect(recordOpenDocument(documents, "/ws", doc("draft.md"))).toBe(documents);
    const normalized = recordOpenDocument(documents, "/ws", { ...doc("outline.md"), path: "\\ws\\outline.md" });
    expect(normalized).toBe(documents);
    expect(opened("Draft.md", "draft.md")).toHaveLength(2);
  });

  it("chooses the right neighbor, then left, and removes only the requested entry", () => {
    const documents = opened("a.md", "b.md", "c.md");
    expect(openDocumentCloseNeighbor(documents, documents[1].id)).toBe(documents[2]);
    expect(openDocumentCloseNeighbor(documents, documents[2].id)).toBe(documents[1]);
    expect(openDocumentCloseNeighbor(documents.slice(0, 1), documents[0].id)).toBeNull();
    expect(openDocumentCloseNeighbor(documents, "missing")).toBeNull();
    expect(removeOpenDocument(documents, documents[1].id)).toEqual([documents[0], documents[2]]);
    expect(documents).toHaveLength(3);
  });

  it("keeps stable IDs and order through file and folder relocation", () => {
    const documents = opened("drafts/a.md", "drafts/nested/b.md", "drafts-old/c.md");
    const relocation: PathRelocation = { workspaceRoot: "/ws", oldPath: "/ws/drafts", newPath: "/ws/archive",
      oldRelativePath: "drafts", newRelativePath: "archive", reason: "move" };
    const moved = relocateOpenDocuments(documents, relocation);
    expect(moved.map((document) => document.id)).toEqual(documents.map((document) => document.id));
    expect(moved.map((document) => document.relativePath)).toEqual(["archive/a.md", "archive/nested/b.md", "drafts-old/c.md"]);
    const renamed = relocateOpenDocuments(moved, { ...relocation, oldPath: "/ws/archive/a.md", newPath: "/ws/archive/Plan.md",
      oldRelativePath: "archive/a.md", newRelativePath: "archive/Plan.md", reason: "auto-rename" });
    expect(renamed[0]).toEqual({ ...moved[0], name: "Plan.md", path: "/ws/archive/Plan.md", relativePath: "archive/Plan.md" });
    expect(recordOpenDocument(renamed, "/ws", doc("archive/Plan.md"))).toBe(renamed);
  });

  it("uses short distinguishing parent suffixes and distinguishes equal titles with different extensions", () => {
    const documents = opened("draft.md", "alpha/notes.md", "beta/notes.md", "a/shared/plan.md", "b/shared/plan.md", "draft.markdown");
    expect([...openDocumentLabels(documents).values()]).toEqual([
      "draft · draft.md", "notes · alpha", "notes · beta", "plan · a/shared", "plan · b/shared", "draft · draft.markdown"
    ]);
    expect([...openDocumentLabels(opened("draft.md", "a/draft.md", "unique.md")).values()]).toEqual([
      "draft · .", "draft · a", "unique"
    ]);
  });

  it("cycles in tab order and recognizes only available Ctrl+Tab app shortcuts", () => {
    const documents = opened("a.md", "b.md", "c.md");
    expect(cycleOpenDocument(documents, documents[2].id, 1)).toBe(documents[0]);
    expect(cycleOpenDocument(documents, documents[0].id, -1)).toBe(documents[2]);
    expect(cycleOpenDocument([], null, 1)).toBeNull();
    const key = { key: "Tab", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false,
      repeat: false, isComposing: false, defaultPrevented: false };
    expect(tabCycleDirection(key)).toBe(1);
    expect(tabCycleDirection({ ...key, shiftKey: true })).toBe(-1);
    for (const ignored of [{ ctrlKey: false }, { metaKey: true }, { altKey: true }, { isComposing: true }, { repeat: true }, { defaultPrevented: true }]) {
      expect(tabCycleDirection({ ...key, ...ignored })).toBeNull();
    }
  });
});
