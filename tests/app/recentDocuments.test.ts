import { afterEach, describe, expect, it, vi } from "vitest";
import {
  filterExistingRecentDocuments,
  isRecordableDocumentPath,
  maxStoredRecentDocuments,
  normalizeRecentPath,
  readRecentDocuments,
  recentDayLabel,
  recentDocumentItems,
  recentDocumentsStorageKey,
  recordRecentDocument,
  relocateRecentDocuments,
  writeRecentDocuments,
  type RecentDocumentEntry
} from "../../src/preferences/recentDocuments";
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

const en = { today: "Today", yesterday: "Yesterday" };
const es = { today: "Hoy", yesterday: "Ayer" };
// Sunday 27 September 2026, midday local time.
const now = new Date(2026, 8, 27, 12, 0, 0);

function daysAgo(days: number, hour = 9) {
  return new Date(2026, 8, 27 - days, hour, 0, 0).toISOString();
}

function doc(relativePath: string): FileTreeNode {
  return { name: relativePath.split("/").pop() ?? relativePath, path: `/ws/${relativePath}`, relativePath, kind: "markdown" };
}

const tree: FileTreeNode[] = [
  doc("readme.md"),
  {
    name: "essays",
    path: "/ws/essays",
    relativePath: "essays",
    kind: "directory",
    children: [doc("essays/on-walking.md"), doc("essays/on-walking.comments.md")]
  },
  { name: "cover.png", path: "/ws/cover.png", relativePath: "cover.png", kind: "external" }
];

describe("recent documents store", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes workspace-relative paths", () => {
    expect(normalizeRecentPath("./essays\\on-walking.md")).toBe("essays/on-walking.md");
    expect(normalizeRecentPath("/a//b.md")).toBe("a/b.md");
    expect(normalizeRecentPath("../outside.md")).toBeNull();
    expect(normalizeRecentPath("")).toBeNull();
  });

  it("records only real Markdown documents, never comment companions", () => {
    expect(isRecordableDocumentPath("essays/on-walking.md")).toBe(true);
    expect(isRecordableDocumentPath("notes.markdown")).toBe(true);
    expect(isRecordableDocumentPath("essays/on-walking.comments.md")).toBe(false);
    expect(isRecordableDocumentPath("cover.png")).toBe(false);

    const entries = recordRecentDocument([], "essays/on-walking.comments.md", now);
    expect(entries).toEqual([]);
  });

  it("puts the latest open first, de-duplicates and caps at ten", () => {
    let entries: RecentDocumentEntry[] = [];
    for (let index = 0; index < 12; index += 1) {
      entries = recordRecentDocument(entries, `doc-${index}.md`, now);
    }
    expect(entries).toHaveLength(maxStoredRecentDocuments);
    expect(entries[0].relativePath).toBe("doc-11.md");
    expect(entries.at(-1)?.relativePath).toBe("doc-2.md");

    entries = recordRecentDocument(entries, "./doc-5.md", now);
    expect(entries[0].relativePath).toBe("doc-5.md");
    expect(entries.filter((entry) => entry.relativePath === "doc-5.md")).toHaveLength(1);
    expect(entries).toHaveLength(maxStoredRecentDocuments);
  });

  it("follows renames and folder moves", () => {
    const entries: RecentDocumentEntry[] = [
      { relativePath: "essays/on-walking.md", openedAt: daysAgo(0) },
      { relativePath: "readme.md", openedAt: daysAgo(1) },
      { relativePath: "essays/drafts/idea.md", openedAt: daysAgo(2) }
    ];

    expect(relocateRecentDocuments(entries, "readme.md", "intro.md").map((entry) => entry.relativePath)).toEqual([
      "essays/on-walking.md",
      "intro.md",
      "essays/drafts/idea.md"
    ]);
    expect(relocateRecentDocuments(entries, "essays", "archive/essays").map((entry) => entry.relativePath)).toEqual([
      "archive/essays/on-walking.md",
      "readme.md",
      "archive/essays/drafts/idea.md"
    ]);
    // A prefix that is not a path boundary is left alone.
    expect(relocateRecentDocuments(entries, "ess", "x")).toEqual(entries);
    // Renamed to a non-document: dropped. Colliding with a newer entry: the newer wins.
    expect(relocateRecentDocuments(entries, "readme.md", "readme.txt").map((entry) => entry.relativePath)).toEqual([
      "essays/on-walking.md",
      "essays/drafts/idea.md"
    ]);
    const collided = relocateRecentDocuments(entries, "essays/drafts/idea.md", "essays/on-walking.md");
    expect(collided).toEqual([entries[0], entries[1]]);
  });

  it("filters stale entries against the tree without dropping them from storage", () => {
    const entries: RecentDocumentEntry[] = [
      { relativePath: "gone.md", openedAt: daysAgo(0) },
      { relativePath: "essays/on-walking.md", openedAt: daysAgo(0) },
      { relativePath: "readme.md", openedAt: daysAgo(3) }
    ];

    expect(filterExistingRecentDocuments(entries, tree).map((entry) => entry.relativePath)).toEqual([
      "essays/on-walking.md",
      "readme.md"
    ]);
  });

  it("labels days as Today, Yesterday, a weekday or a short date (EN and ES)", () => {
    expect(recentDayLabel(daysAgo(0, 1), now, "en", en)).toBe("Today");
    expect(recentDayLabel(daysAgo(1, 23), now, "en", en)).toBe("Yesterday");
    expect(recentDayLabel(daysAgo(2), now, "en", en)).toBe("Friday");
    expect(recentDayLabel(daysAgo(10), now, "en", en)).toBe("Sep 17");
    expect(recentDayLabel(new Date(2025, 11, 30).toISOString(), now, "en", en)).toBe("Dec 30, 2025");

    expect(recentDayLabel(daysAgo(0), now, "es", es)).toBe("Hoy");
    expect(recentDayLabel(daysAgo(1), now, "es", es)).toBe("Ayer");
    expect(recentDayLabel(daysAgo(2), now, "es", es)).toBe("Viernes");
    expect(recentDayLabel(daysAgo(10), now, "es", es)).toMatch(/^17 sept?\.?$/);
    expect(recentDayLabel("not a date", now, "en", en)).toBe("");
  });

  it("builds at most five rows with name, folder and day", () => {
    const entries: RecentDocumentEntry[] = [
      { relativePath: "essays/on-walking.md", openedAt: daysAgo(0) },
      { relativePath: "readme.md", openedAt: daysAgo(1) }
    ];

    expect(recentDocumentItems(entries, tree, now, "en", en)).toEqual([
      {
        relativePath: "essays/on-walking.md",
        name: "on-walking",
        folder: "essays",
        dayLabel: "Today",
        openedAt: entries[0].openedAt
      },
      { relativePath: "readme.md", name: "readme", folder: "", dayLabel: "Yesterday", openedAt: entries[1].openedAt }
    ]);

    const many = Array.from({ length: 8 }, (_, index) => doc(`d${index}.md`));
    const manyEntries = many.map((node) => ({ relativePath: node.relativePath, openedAt: daysAgo(0) }));
    expect(recentDocumentItems(manyEntries, many, now, "en", en)).toHaveLength(5);
  });

  it("stores one list per workspace root under iliad:recent-documents", () => {
    const store = stubLocalStorage();
    writeRecentDocuments("/ws-a", recordRecentDocument([], "a.md", now));
    writeRecentDocuments("/ws-b", recordRecentDocument([], "b.md", now));

    expect(recentDocumentsStorageKey).toBe("iliad:recent-documents");
    expect(Object.keys(JSON.parse(store.get(recentDocumentsStorageKey) ?? "{}"))).toEqual(["/ws-a", "/ws-b"]);
    expect(readRecentDocuments("/ws-a").map((entry) => entry.relativePath)).toEqual(["a.md"]);
    expect(readRecentDocuments("/ws-c")).toEqual([]);
  });

  it("survives corrupt or unavailable storage", () => {
    stubLocalStorage({ [recentDocumentsStorageKey]: "{not json" });
    expect(readRecentDocuments("/ws")).toEqual([]);

    stubLocalStorage({
      [recentDocumentsStorageKey]: JSON.stringify({ "/ws": [{ relativePath: "x.comments.md", openedAt: now.toISOString() }, 3] })
    });
    expect(readRecentDocuments("/ws")).toEqual([]);

    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      }
    });
    expect(readRecentDocuments("/ws")).toEqual([]);
    expect(() => writeRecentDocuments("/ws", [])).not.toThrow();
  });
});
