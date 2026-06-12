import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentChatHistoryStore, fallbackChatThreadTitle, sanitizeGeneratedChatThreadTitle } from "../../electron/agent/chatHistoryStore";
import type { AgentChatThread } from "../../electron/agent/types";

let root = "";
let otherRoot = "";
let userData = "";

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "iliad-chat-history-workspace-"));
  otherRoot = await mkdtemp(path.join(os.tmpdir(), "iliad-chat-history-other-"));
  userData = await mkdtemp(path.join(os.tmpdir(), "iliad-chat-history-userdata-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(otherRoot, { recursive: true, force: true });
  await rm(userData, { recursive: true, force: true });
});

function thread(overrides: Partial<AgentChatThread> = {}): Omit<AgentChatThread, "workspaceRoot"> & { workspaceRoot?: string } {
  return {
    id: "thread-1",
    workspaceRoot: root,
    title: "Fallback title",
    titleSource: "fallback",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    entries: [
      {
        id: "entry-user",
        kind: "user",
        text: "Prepare a diagnostic activity",
        createdAt: new Date(0).toISOString()
      }
    ],
    ...overrides
  };
}

describe("AgentChatHistoryStore", () => {
  it("saves, lists sorted summaries, gets by workspace, and clears workspace history", async () => {
    const store = new AgentChatHistoryStore(userData);
    await store.saveThread({ workspaceRoot: root, thread: thread({ id: "older" }) });
    await new Promise((resolve) => setTimeout(resolve, 2));
    await store.saveThread({ workspaceRoot: root, thread: thread({ id: "newer", title: "Newer" }) });
    await store.saveThread({ workspaceRoot: otherRoot, thread: thread({ id: "other", workspaceRoot: otherRoot }) });

    const summaries = await store.listThreads(root);
    expect(summaries.map((summary) => summary.id)).toEqual(["newer", "older"]);
    expect(await store.getThread(root, "newer")).toMatchObject({ id: "newer", workspaceRoot: path.resolve(root) });
    expect(await store.getThread(otherRoot, "newer")).toBeNull();

    await store.clearWorkspace(root);
    expect(await store.listThreads(root)).toEqual([]);
    expect(await store.listThreads(otherRoot)).toHaveLength(1);
  });

  it("does not save empty threads", async () => {
    const store = new AgentChatHistoryStore(userData);

    await expect(
      store.saveThread({
        workspaceRoot: root,
        thread: thread({ entries: [] })
      })
    ).rejects.toThrow("Empty chat threads are not saved.");
    expect(await store.listThreads(root)).toEqual([]);
  });

  it("recovers corrupt JSON by renaming it aside", async () => {
    const storePath = path.join(userData, "assistant", "chat-history.json");
    await mkdir(path.dirname(storePath), { recursive: true });
    await writeFile(storePath, "{not-json", "utf8");

    const store = new AgentChatHistoryStore(userData);
    expect(await store.listThreads(root)).toEqual([]);
    const files = await readdir(path.dirname(storePath));
    expect(files.some((file) => file.endsWith(".corrupt"))).toBe(true);
  });

  it("prunes each workspace to the most recent 100 threads", async () => {
    const store = new AgentChatHistoryStore(userData);

    for (let index = 0; index < 101; index += 1) {
      await store.saveThread({ workspaceRoot: root, thread: thread({ id: `thread-${index}` }) });
    }

    expect(await store.listThreads(root)).toHaveLength(100);
  });

  it("uses the request workspace and sanitizes renderer supplied thread data", async () => {
    const store = new AgentChatHistoryStore(userData);
    const saved = await store.saveThread({
      workspaceRoot: root,
      thread: {
        ...thread({ workspaceRoot: otherRoot }),
        entries: [
          {
            id: "entry-user",
            kind: "user",
            text: "Visible text",
            createdAt: new Date(0).toISOString(),
            contextManifest: { secret: true }
          } as never,
          { id: "empty", kind: "assistant", text: "", createdAt: new Date(0).toISOString() }
        ]
      }
    });

    expect(saved.workspaceRoot).toBe(path.resolve(root));
    expect(saved.entries).toEqual([
      {
        id: "entry-user",
        kind: "user",
        text: "Visible text",
        createdAt: new Date(0).toISOString()
      }
    ]);
    expect(JSON.stringify(saved)).not.toContain("contextManifest");
  });

  it("preserves valid entry source metadata and drops invalid source values", async () => {
    const store = new AgentChatHistoryStore(userData);
    const saved = await store.saveThread({
      workspaceRoot: root,
      thread: thread({
        entries: [
          {
            id: "telegram-user",
            kind: "user",
            text: "Remote question",
            createdAt: new Date(0).toISOString(),
            source: "telegram"
          },
          {
            id: "bad-source",
            kind: "assistant",
            text: "Answer",
            createdAt: new Date(1).toISOString(),
            source: "relay"
          } as never
        ]
      })
    });

    expect(saved.entries).toEqual([
      expect.objectContaining({ id: "telegram-user", source: "telegram" }),
      expect.not.objectContaining({ source: expect.anything() })
    ]);
  });

  it("atomically appends entries and ignores replayed entry ids", async () => {
    const store = new AgentChatHistoryStore(userData);
    const first = await store.appendThreadEntries({
      workspaceRoot: root,
      threadId: "telegram-remote",
      entries: [
        {
          id: "telegram:key:user",
          kind: "user",
          text: "Remote question",
          createdAt: new Date(0).toISOString(),
          source: "telegram"
        },
        {
          id: "telegram:key:assistant",
          kind: "assistant",
          text: "Remote answer",
          createdAt: new Date(0).toISOString(),
          source: "telegram"
        }
      ]
    });
    const replay = await store.appendThreadEntries({
      workspaceRoot: root,
      threadId: "telegram-remote",
      entries: [
        {
          id: "telegram:key:user",
          kind: "user",
          text: "Changed question",
          createdAt: new Date(1).toISOString(),
          source: "telegram"
        },
        {
          id: "telegram:key:error",
          kind: "error",
          text: "Changed failure",
          createdAt: new Date(1).toISOString(),
          source: "telegram"
        }
      ]
    });

    expect(first.entries).toHaveLength(2);
    expect(replay.entries).toEqual(first.entries);
    await expect(store.getThread(root, "telegram-remote")).resolves.toMatchObject({
      entries: [
        expect.objectContaining({ text: "Remote question" }),
        expect.objectContaining({ text: "Remote answer" })
      ]
    });
  });

  it("preserves Telegram-origin entries missing from a stale renderer save", async () => {
    const store = new AgentChatHistoryStore(userData);
    await store.saveThread({ workspaceRoot: root, thread: thread() });
    await store.appendThreadEntries({
      workspaceRoot: root,
      threadId: "thread-1",
      entries: [
        {
          id: "telegram:key:user",
          kind: "user",
          text: "Remote question",
          createdAt: new Date(1).toISOString(),
          source: "telegram"
        },
        {
          id: "telegram:key:assistant",
          kind: "assistant",
          text: "Remote answer",
          createdAt: new Date(2).toISOString(),
          source: "telegram"
        }
      ]
    });

    const saved = await store.saveThread({
      workspaceRoot: root,
      thread: thread({
        entries: [
          ...thread().entries,
          { id: "desktop-follow-up", kind: "user", text: "Desktop follow up", createdAt: new Date(3).toISOString() }
        ]
      })
    });

    expect(saved.entries.map((entry) => entry.id)).toEqual([
      "entry-user",
      "telegram:key:user",
      "telegram:key:assistant",
      "desktop-follow-up"
    ]);
  });

  it("does not accept renderer supplied AI title metadata on transcript saves", async () => {
    const store = new AgentChatHistoryStore(userData);
    const saved = await store.saveThread({
      workspaceRoot: root,
      thread: thread({
        title: "Renderer title",
        titleSource: "ai"
      })
    });

    expect(saved.title).toBe("Prepare a diagnostic activity");
    expect(saved.titleSource).toBe("fallback");
  });

  it("preserves AI titles across transcript saves", async () => {
    const store = new AgentChatHistoryStore(userData);
    await store.saveThread({ workspaceRoot: root, thread: thread() });
    await store.updateThreadTitle(root, "thread-1", "AI title");
    const saved = await store.saveThread({
      workspaceRoot: root,
      thread: thread({
        title: "Fallback title",
        titleSource: "fallback",
        entries: [
          ...thread().entries,
          { id: "assistant", kind: "assistant", text: "Answer", createdAt: new Date(1).toISOString() }
        ]
      })
    });

    expect(saved.title).toBe("AI title");
    expect(saved.titleSource).toBe("ai");
    expect(saved.entries).toHaveLength(2);
  });

  it("does not resurrect a thread when clear is queued behind a pending save", async () => {
    const store = new AgentChatHistoryStore(userData);
    const savePromise = store.saveThread({ workspaceRoot: root, thread: thread() });
    const clearPromise = store.clearWorkspace(root);

    await expect(savePromise).rejects.toThrow("Chat history was cleared before this thread could be saved.");
    await clearPromise;
    expect(await store.listThreads(root)).toEqual([]);
  });

  it("extracts fallback titles and sanitizes generated titles", () => {
    expect(fallbackChatThreadTitle("# Guia rapida: [activar](https://example.test) clase...")).toBe(
      "Guia rapida: activar clase"
    );
    expect(fallbackChatThreadTitle("```ts\nconst secret = 1\n```\nUse strategies")).toBe("Use strategies");
    expect(sanitizeGeneratedChatThreadTitle('"Rubrica diagnostica."\n\n')).toBe("Rubrica diagnostica");
    expect(sanitizeGeneratedChatThreadTitle("- Rubrica diagnostica\nExplicacion extra")).toBe("Rubrica diagnostica");
  });
});
