import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CompactionCacheStore, compactionPrefixHash } from "../../electron/agent/compactionCacheStore";
import type { ConversationHistoryMessage } from "../../electron/agent/conversationHistory";

let tempDirs: string[] = [];

async function userDataDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "iliad-compaction-cache-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

function message(role: "user" | "assistant", content: string): ConversationHistoryMessage {
  return { role, content };
}

function thread(count: number) {
  return Array.from({ length: count }, (_, index) => message(index % 2 === 0 ? "user" : "assistant", `turn ${index}`));
}

function entryFor(messages: ConversationHistoryMessage[], count: number, summary: string) {
  return {
    prefixMessageCount: count,
    prefixHash: compactionPrefixHash(messages.slice(0, count)),
    summary,
    estimatedTokens: 10,
    model: "gpt-5.5"
  };
}

describe("compaction prefix hash", () => {
  it("is injective across message boundaries (security property, not convenience)", () => {
    // A concatenation-based hash would alias these; crafted document content
    // quoted into a thread must never collide a different prefix into a
    // cached summary.
    const single = [message("user", 'a"],["user","b')];
    const pair = [message("user", "a"), message("user", "b")];

    expect(compactionPrefixHash(single)).not.toBe(compactionPrefixHash(pair));

    const newlineAlias = [message("user", "a\nuser\nb")];
    expect(compactionPrefixHash(newlineAlias)).not.toBe(compactionPrefixHash(pair));
  });

  it("changes when any covered content or role changes", () => {
    const base = [message("user", "hola"), message("assistant", "hola!")];
    const contentChanged = [message("user", "hola"), message("assistant", "hola?")];
    const roleChanged = [message("user", "hola"), message("user", "hola!")];

    expect(compactionPrefixHash(base)).not.toBe(compactionPrefixHash(contentChanged));
    expect(compactionPrefixHash(base)).not.toBe(compactionPrefixHash(roleChanged));
  });
});

describe("compaction cache store", () => {
  it("round-trips an entry and is workspace-agnostic by construction", async () => {
    const store = new CompactionCacheStore(await userDataDir());
    const messages = thread(10);

    await store.put(entryFor(messages, 4, "## Decisions\n- foo"), store.clearGeneration());

    const hit = await store.lookup(messages, 6);
    expect(hit).toMatchObject({ text: "## Decisions\n- foo", coveredMessageCount: 4 });

    // Content-addressed: the identical prefix arriving from anywhere hits.
    const otherStoreView = await store.lookup([...messages.slice(0, 4), message("user", "different suffix")], 4);
    expect(otherStoreView).toMatchObject({ coveredMessageCount: 4 });
  });

  it("misses when covered content changed and when nothing is omitted", async () => {
    const store = new CompactionCacheStore(await userDataDir());
    const messages = thread(10);

    await store.put(entryFor(messages, 4, "summary"), store.clearGeneration());

    const edited = [message("user", "EDITED"), ...messages.slice(1)];
    expect(await store.lookup(edited, 6)).toBeNull();
    expect(await store.lookup(messages, 0)).toBeNull();
  });

  it("prefers the largest covered prefix among matches", async () => {
    const store = new CompactionCacheStore(await userDataDir());
    const messages = thread(12);

    await store.put(entryFor(messages, 2, "small"), store.clearGeneration());
    await store.put(entryFor(messages, 6, "large"), store.clearGeneration());

    expect(await store.lookup(messages, 8)).toMatchObject({ text: "large", coveredMessageCount: 6 });
    // An entry covering more than the omitted prefix is not eligible.
    expect(await store.lookup(messages, 4)).toMatchObject({ text: "small", coveredMessageCount: 2 });
  });

  it("deletes the superseded predecessor in the same mutation (rolling supersession)", async () => {
    const store = new CompactionCacheStore(await userDataDir());
    const messages = thread(12);
    const predecessor = entryFor(messages, 4, "old summary");

    await store.put(predecessor, store.clearGeneration());
    await store.put(entryFor(messages, 8, "rolled summary"), store.clearGeneration(), predecessor.prefixHash);

    expect(await store.lookup(messages, 10)).toMatchObject({ text: "rolled summary", coveredMessageCount: 8 });
    // The predecessor is gone: a lookup that could only match it misses.
    expect(await store.lookup(messages, 5)).toBeNull();
  });

  it("evicts least-recently-used entries past the cap", async () => {
    const store = new CompactionCacheStore(await userDataDir());

    for (let index = 0; index < 65; index += 1) {
      const messages = [message("user", `thread-${index}`), message("assistant", "ok")];
      await store.put(entryFor(messages, 1, `summary-${index}`), store.clearGeneration());
    }

    const oldest = [message("user", "thread-0"), message("assistant", "ok")];
    const newest = [message("user", "thread-64"), message("assistant", "ok")];
    expect(await store.lookup(oldest, 1)).toBeNull();
    expect(await store.lookup(newest, 1)).toMatchObject({ text: "summary-64" });
  });

  it("clearAll wipes everything and an in-flight generation cannot write back", async () => {
    const store = new CompactionCacheStore(await userDataDir());
    const messages = thread(8);

    await store.put(entryFor(messages, 2, "kept"), store.clearGeneration());

    const staleGeneration = store.clearGeneration();
    await store.clearAll();
    await store.put(entryFor(messages, 4, "post-clear write"), staleGeneration);

    expect(await store.lookup(messages, 6)).toBeNull();
  });

  it("backs up a corrupt file and continues empty", async () => {
    const userData = await userDataDir();
    const storePath = path.join(userData, "assistant", "compaction-cache.json");
    await mkdir(path.dirname(storePath), { recursive: true });
    await writeFile(storePath, "{not json", "utf8");

    const store = new CompactionCacheStore(userData);
    const messages = thread(4);

    expect(await store.lookup(messages, 2)).toBeNull();
    await store.put(entryFor(messages, 2, "fresh"), store.clearGeneration());
    expect(await store.lookup(messages, 2)).toMatchObject({ text: "fresh" });

    const files = await readdir(path.dirname(storePath));
    expect(files.some((name) => name.endsWith(".corrupt"))).toBe(true);
  });

  it("persists across instances and never stores thread identity", async () => {
    const userData = await userDataDir();
    const first = new CompactionCacheStore(userData);
    const messages = thread(6);

    await first.put(entryFor(messages, 3, "persisted"), first.clearGeneration());

    const second = new CompactionCacheStore(userData);
    expect(await second.lookup(messages, 5)).toMatchObject({ text: "persisted", coveredMessageCount: 3 });

    const raw = await readFile(path.join(userData, "assistant", "compaction-cache.json"), "utf8");
    expect(raw).not.toContain("thread");
    expect(raw).not.toContain("workspaceRoot");
  });
});
