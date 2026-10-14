import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseCommentsFile, serializeCommentsFile } from "../../src/comments/commentsFile";
import { commentToEntry, mergeCommentEntries, readdRestoredComments } from "../../src/comments/commentsMerge";
import {
  absorbCommentsDisk,
  emptyCommentsDisk,
  readCommentsDisk,
  writeCommentsSession,
  type CommentsFileIo,
  type CommentsSessionState
} from "../../src/comments/commentsSession";
import type { SelectionComment, WriteMarkdownResult } from "../../src/types/iliad";

const hash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

function comment(id: string, quote: string, text: string, documentText: string): SelectionComment {
  const from = documentText.indexOf(quote);
  return {
    id,
    workspacePath: "/ws",
    documentRelativePath: "doc.md",
    from: Math.max(0, from),
    to: from >= 0 ? from + quote.length : 0,
    quote,
    occurrence: 1,
    prefix: "",
    comment: text,
    createdAt: "",
    status: "pending"
  };
}

/** An in-memory comments file with the guarded write semantics of main. */
function fakeDisk(initial: string | null) {
  const state = { text: initial, writes: 0 };
  const io: CommentsFileIo = {
    read: async () => (state.text === null ? { status: "absent" } : { status: "present", content: state.text, hash: hash(state.text) }),
    write: async (text, expected): Promise<WriteMarkdownResult> => {
      const matches = expected.kind === "absent" ? state.text === null : state.text !== null && hash(state.text) === expected.hash;
      if (!matches) {
        return { status: "conflict", reason: "disk_changed" };
      }
      state.text = text;
      state.writes += 1;
      return { status: "written", savedAt: "" };
    },
    remove: async (expectedHash): Promise<WriteMarkdownResult> => {
      if (state.text === null || hash(state.text) !== expectedHash) {
        return { status: "conflict", reason: "disk_changed" };
      }
      state.text = null;
      state.writes += 1;
      return { status: "written", savedAt: "" };
    },
    hash: async (text) => hash(text)
  };
  return { state, io };
}

const doc = "Alpha passage here. Beta passage there. Gamma passage last.";

function session(overrides: Partial<CommentsSessionState> = {}): CommentsSessionState {
  return {
    workspacePath: "/ws",
    documentRelativePath: "doc.md",
    comments: [],
    disk: emptyCommentsDisk,
    loaded: false,
    dirty: false,
    documentText: doc,
    ...overrides
  };
}

describe("three-way comment merge by id", () => {
  const base = [
    { id: "a", quote: "Alpha", comment: "one" },
    { id: "b", quote: "Beta", comment: "two" },
    { id: "c", quote: "Gamma", comment: "three" }
  ];

  it("lets an outside deletion win unless the comment was edited here", () => {
    const local = [comment("a", "Alpha", "one", doc), comment("b", "Beta", "two (edited here)", doc), comment("c", "Gamma", "three", doc)];
    const fresh = [base[2]];
    const result = mergeCommentEntries(base, local, fresh);

    expect(result.entries.map(({ entry }) => [entry.id, entry.comment])).toEqual([
      ["c", "three"],
      ["b", "two (edited here)"]
    ]);
    expect(result.removedOutside.map((item) => item.id)).toEqual(["a"]);
  });

  it("keeps local deletions and creations and outside additions and edits", () => {
    const local = [comment("a", "Alpha", "one", doc), comment("n", "Gamma", "new here", doc)];
    const fresh = [
      { id: "a", quote: "Alpha", comment: "one (edited outside)" },
      { id: "b", quote: "Beta", comment: "two" },
      { id: "x", quote: "passage", comment: "added outside" }
    ];
    const result = mergeCommentEntries(base, local, fresh);

    expect(result.entries.map(({ entry }) => [entry.id, entry.comment])).toEqual([
      ["a", "one (edited outside)"],
      ["x", "added outside"],
      ["n", "new here"]
    ]);
    expect(result.removedOutside).toEqual([]);
  });
});

describe("comments file sync", () => {
  it("merges on disk_changed and retries the write once", async () => {
    const original = serializeCommentsFile([
      { id: "a", quote: "Alpha", comment: "one" },
      { id: "b", quote: "Beta", comment: "two" }
    ]);
    const { state, io } = fakeDisk(original);
    const current = session();
    absorbCommentsDisk(current, await readCommentsDisk(io));
    expect(current.comments.map((item) => item.id)).toEqual(["a", "b"]);

    // Here: a new comment. Outside (meanwhile): an agent handled "a" and deleted it.
    current.comments = [...current.comments, comment("n", "Gamma", "new here", doc)];
    current.dirty = true;
    state.text = serializeCommentsFile([{ id: "b", quote: "Beta", comment: "two" }]);

    const outcome = await writeCommentsSession(current, io);

    expect(outcome.removedOutside.map((item) => item.id)).toEqual(["a"]);
    expect(parseCommentsFile(state.text ?? "").map((entry) => entry.id)).toEqual(["b", "n"]);
    expect(current.dirty).toBe(false);
    expect(current.disk.text).toBe(state.text);
  });

  it("surfaces an error when the file keeps changing", async () => {
    const { io } = fakeDisk(null);
    const flaky: CommentsFileIo = { ...io, write: async () => ({ status: "conflict", reason: "disk_changed" }) };
    const current = session({ loaded: true, dirty: true, comments: [comment("n", "Gamma", "x", doc)] });

    await expect(writeCommentsSession(current, flaky)).rejects.toThrow(/keeps changing/);
  });

  it("does not write when only positions changed, and removes the file with the last comment", async () => {
    const text = serializeCommentsFile([{ id: "a", quote: "Alpha", comment: "one" }]);
    const { state, io } = fakeDisk(text);
    const current = session();
    absorbCommentsDisk(current, await readCommentsDisk(io));

    current.comments = current.comments.map((item) => ({ ...item, from: item.from + 1, to: item.to + 1 }));
    current.dirty = true;
    expect((await writeCommentsSession(current, io)).fileListChanged).toBe(false);
    expect(state.writes).toBe(0);

    current.comments = [];
    current.dirty = true;
    expect((await writeCommentsSession(current, io)).fileListChanged).toBe(true);
    expect(state.text).toBeNull();
  });

  it("creates the file exclusively for the first comment", async () => {
    const { state, io } = fakeDisk(null);
    const current = session();
    absorbCommentsDisk(current, await readCommentsDisk(io));
    current.comments = [comment("n", "Beta", "first", doc)];
    current.dirty = true;

    expect((await writeCommentsSession(current, io)).fileListChanged).toBe(true);
    expect(parseCommentsFile(state.text ?? "")[0]).toMatchObject({ id: "n", quote: "Beta", comment: "first" });
  });

  it("does not rewrite an outside-written file just because it was read", async () => {
    const { io } = fakeDisk("> Alpha\n\nhand-written\n");
    const current = session();
    const { needsWrite } = absorbCommentsDisk(current, await readCommentsDisk(io));

    expect(needsWrite).toBe(false);
    expect(current.comments[0]).toMatchObject({ quote: "Alpha", comment: "hand-written", from: 0, to: 5 });
  });

  it("writes occurrence and prefix only for quotes that repeat in the document", () => {
    const text = "the cat and the cat";
    const second = { ...comment("r", "the cat", "second", text), from: 12, to: 19 };

    expect(commentToEntry(second, text)).toMatchObject({ occurrence: 2, prefix: "the cat and " });
    expect(commentToEntry(comment("u", "and", "unique", text), text)).toEqual({ id: "u", quote: "and", comment: "unique" });
  });

  it("detaches a duplicate whose stored prefix no longer matches", async () => {
    const text = "the cat and the cat";
    const { io } = fakeDisk(
      serializeCommentsFile([{ id: "d", quote: "the cat", comment: "x", occurrence: 2, prefix: "a dog and " }])
    );
    const current = session({ documentText: text });
    absorbCommentsDisk(current, await readCommentsDisk(io));

    expect(current.comments[0].from).toBe(current.comments[0].to);
  });
});

describe("comments removed outside and a restore (V17)", () => {
  it("re-adds removed comments whose quote is found again after the restore", async () => {
    const before = "Alpha passage here. Beta passage there.";
    const { state, io } = fakeDisk(
      serializeCommentsFile([
        { id: "a", quote: "Alpha passage", comment: "tighten" },
        { id: "b", quote: "Beta passage", comment: "keep" }
      ])
    );
    const current = session({ documentText: before });
    absorbCommentsDisk(current, await readCommentsDisk(io));

    // An agent rewrote the Alpha passage and deleted the handled comment.
    state.text = serializeCommentsFile([{ id: "b", quote: "Beta passage", comment: "keep" }]);
    current.documentText = "Rewritten opening. Beta passage there.";
    const { removedOutside } = absorbCommentsDisk(current, await readCommentsDisk(io));
    expect(removedOutside.map((item) => item.id)).toEqual(["a"]);

    // Still rewritten: nothing comes back.
    expect(readdRestoredComments(removedOutside, current.comments, current.documentText).readded).toEqual([]);

    // The writer restored the outside edit: the passage is back, so is the comment.
    const restored = readdRestoredComments(removedOutside, current.comments, before);
    expect(restored.readded).toMatchObject([{ id: "a", from: 0, to: "Alpha passage".length }]);
    expect(restored.stillRemoved).toEqual([]);
  });
});

describe("review fixes", () => {
  it("re-anchors from the fresh entry when an outside tool changed occurrence or prefix", () => {
    const text = "the cat and the cat";
    const base = [{ id: "d", quote: "the cat", comment: "x", occurrence: 1, prefix: "" }];
    const local = [{ ...comment("d", "the cat", "x", text), from: 0, to: 7 }];
    const fresh = [{ id: "d", quote: "the cat", comment: "x", occurrence: 2, prefix: "the cat and " }];

    const result = mergeCommentEntries(base, local, fresh);
    expect(result.entries[0].local).toBeNull();
    expect(result.entries[0].entry).toMatchObject({ occurrence: 2, prefix: "the cat and " });

    const unchanged = mergeCommentEntries(base, local, base);
    expect(unchanged.entries[0].local).toBe(local[0]);
  });

  it("plans the V17 re-add for a document restored while it was not open", async () => {
    const { planRestoredReadd } = await import("../../src/comments/commentsMerge");
    const removed = [comment("a", "Alpha passage", "tighten", "Alpha passage here.")];

    // Opened later: applied at once against the loaded text.
    expect(planRestoredReadd({ textAtNotice: null, expiresAt: null }, removed, [], "Alpha passage here.")).toMatchObject({
      action: "apply",
      readded: [{ id: "a", from: 0 }]
    });
    // The open document before the reload reaches the buffer: wait.
    expect(planRestoredReadd({ textAtNotice: "Rewritten.", expiresAt: Date.now() + 1000 }, removed, [], "Rewritten.")).toEqual({
      action: "wait"
    });
    expect(planRestoredReadd({ textAtNotice: "x", expiresAt: 1 }, removed, [], "Alpha passage", 2)).toEqual({ action: "drop" });
  });
});

describe("comment authors", () => {
  it("keeps by=ai through a read, a local change and the write", async () => {
    const original = serializeCommentsFile([
      { id: "w", quote: "Alpha", comment: "mine" },
      { id: "ai-1", quote: "Beta", comment: "feedback", author: "ai" }
    ]);
    const { state, io } = fakeDisk(original);
    const current = session();
    absorbCommentsDisk(current, await readCommentsDisk(io));

    expect(current.comments.map((item) => item.author ?? "writer")).toEqual(["writer", "ai"]);

    current.comments = [...current.comments, comment("n", "Gamma", "new here", doc)];
    current.dirty = true;
    await writeCommentsSession(current, io);

    expect(parseCommentsFile(state.text ?? "").map((entry) => [entry.id, entry.author ?? "writer"])).toEqual([
      ["w", "writer"],
      ["ai-1", "ai"],
      ["n", "writer"]
    ]);
  });

  it("keeps an AI comment's author when an agent appends while Iliad writes", async () => {
    const { state, io } = fakeDisk(serializeCommentsFile([{ id: "w", quote: "Alpha", comment: "mine" }]));
    const current = session();
    absorbCommentsDisk(current, await readCommentsDisk(io));

    current.comments = current.comments.map((item) => ({ ...item, comment: "mine, edited" }));
    current.dirty = true;
    state.text = `${state.text}\n---\n\n<!-- iliad:comment id=ai-9 by=ai -->\n> Gamma\n\nAgent note.\n`;

    await writeCommentsSession(current, io);

    expect(parseCommentsFile(state.text ?? "").map((entry) => [entry.id, entry.comment, entry.author ?? "writer"])).toEqual([
      ["w", "mine, edited", "writer"],
      ["ai-9", "Agent note.", "ai"]
    ]);
    expect(current.comments.find((item) => item.id === "ai-9")?.author).toBe("ai");
  });

  it("takes the author from the file when an outside tool changes it", () => {
    const base = [{ id: "x", quote: "Alpha", comment: "one" }];
    const local = [comment("x", "Alpha", "one", doc)];
    const fresh = [{ id: "x", quote: "Alpha", comment: "one", author: "ai" as const }];
    const result = mergeCommentEntries(base, local, fresh);

    expect(result.entries[0]).toMatchObject({ entry: { id: "x", author: "ai" }, local: null });
  });

  it("writes a local AI comment's author when it is new to the file", () => {
    const local = [{ ...comment("ai-2", "Beta", "fresh", doc), author: "ai" as const }];
    const result = mergeCommentEntries([], local, []);

    expect(result.entries[0].entry).toMatchObject({ id: "ai-2", author: "ai" });
    expect(commentToEntry(local[0], doc)).toMatchObject({ author: "ai" });
  });

  it("keeps by=ai on an AI comment re-added by a restore, and writes it back", async () => {
    const before = "Alpha passage here. Beta passage there.";
    const { state, io } = fakeDisk(
      serializeCommentsFile([
        { id: "ai-a", quote: "Alpha passage", comment: "too long", author: "ai" },
        { id: "b", quote: "Beta passage", comment: "keep" }
      ])
    );
    const current = session({ documentText: before });
    absorbCommentsDisk(current, await readCommentsDisk(io));

    state.text = serializeCommentsFile([{ id: "b", quote: "Beta passage", comment: "keep" }]);
    current.documentText = "Rewritten opening. Beta passage there.";
    const { removedOutside } = absorbCommentsDisk(current, await readCommentsDisk(io));
    const restored = readdRestoredComments(removedOutside, current.comments, before);

    current.documentText = before;
    current.comments = [...current.comments, ...restored.readded];
    current.dirty = true;
    await writeCommentsSession(current, io);

    expect(parseCommentsFile(state.text ?? "").map((entry) => [entry.id, entry.author ?? "writer"])).toEqual([
      ["b", "writer"],
      ["ai-a", "ai"]
    ]);
  });

  it("keeps a detached AI comment and its author on the next write", async () => {
    const { state, io } = fakeDisk(
      serializeCommentsFile([
        { id: "w", quote: "Alpha", comment: "mine" },
        { id: "ai-x", quote: "a passage that is gone", comment: "feedback", author: "ai" }
      ])
    );
    const current = session();
    absorbCommentsDisk(current, await readCommentsDisk(io));

    expect(current.comments.find((item) => item.id === "ai-x")).toMatchObject({ from: 0, to: 0, author: "ai" });

    current.comments = current.comments.map((item) => (item.id === "w" ? { ...item, comment: "mine, edited" } : item));
    current.dirty = true;
    await writeCommentsSession(current, io);

    expect(parseCommentsFile(state.text ?? "").find((entry) => entry.id === "ai-x")).toMatchObject({
      quote: "a passage that is gone",
      author: "ai"
    });
  });

  it("keeps an agent's AI comment when the writer deletes their last comment at the same time", async () => {
    const { state, io } = fakeDisk(serializeCommentsFile([{ id: "w", quote: "Alpha", comment: "mine" }]));
    const current = session();
    absorbCommentsDisk(current, await readCommentsDisk(io));

    current.comments = [];
    current.dirty = true;
    state.text = `${state.text}\n---\n\n<!-- iliad:comment id=ai-1 by=ai -->\n> Beta\n\nAgent note.\n`;

    await writeCommentsSession(current, io);

    expect(parseCommentsFile(state.text ?? "")).toEqual([{ id: "ai-1", quote: "Beta", comment: "Agent note.", author: "ai" }]);
  });
});

