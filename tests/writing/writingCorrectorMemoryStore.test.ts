import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WritingCorrectorMemoryStore } from "../../electron/writingCorrector/writingCorrectorMemoryStore";

const electronMock = vi.hoisted(() => ({
  fromWebContents: vi.fn(),
  handle: vi.fn(),
  getPath: vi.fn(() => "/tmp"),
  on: vi.fn(),
  openExternal: vi.fn()
}));

vi.mock("electron", () => ({
  app: {
    getPath: electronMock.getPath,
    on: electronMock.on
  },
  BrowserWindow: {
    fromWebContents: electronMock.fromWebContents
  },
  ipcMain: {
    handle: electronMock.handle
  },
  shell: {
    openExternal: electronMock.openExternal
  }
}));

let root = "";
let userData = "";

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "iliad-corrector-memory-workspace-"));
  userData = await mkdtemp(path.join(os.tmpdir(), "iliad-corrector-memory-userdata-"));
  electronMock.fromWebContents.mockReset();
  electronMock.handle.mockReset();
  delete process.env.VITE_DEV_SERVER_URL;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(userData, { recursive: true, force: true });
});

function trustedEvent() {
  electronMock.fromWebContents.mockReturnValue({});
  return {
    sender: {},
    senderFrame: { url: "file:///Applications/Iliad.app/index.html" }
  } as never;
}

describe("WritingCorrectorMemoryStore", () => {
  it("persists document ignores and dictionary words across store instances", async () => {
    const store = new WritingCorrectorMemoryStore(userData);
    await store.ignoreIssue(root, "doc.md", "en", "writing-issue:v1:en:im");
    await store.addDictionaryWord("en", "Iliad");

    const reopened = new WritingCorrectorMemoryStore(userData);
    const memory = await reopened.getForDocument(root, "doc.md", "en");

    expect(memory.ignoredIssueFingerprints).toEqual(["writing-issue:v1:en:im"]);
    expect(memory.customWords).toEqual(["iliad"]);
  });

  it("scopes ignored issue memory by workspace and document path", async () => {
    const otherRoot = await mkdtemp(path.join(os.tmpdir(), "iliad-corrector-memory-other-workspace-"));

    try {
      const store = new WritingCorrectorMemoryStore(userData);
      await store.ignoreIssue(root, "a.md", "en", "fingerprint-a");
      await store.ignoreIssue(root, "b.md", "en", "fingerprint-b");
      await store.ignoreIssue(otherRoot, "a.md", "en", "fingerprint-other");

      expect(await store.getForDocument(root, "a.md", "en")).toMatchObject({
        ignoredIssueFingerprints: ["fingerprint-a"]
      });
      expect(await store.getForDocument(root, "b.md", "en")).toMatchObject({
        ignoredIssueFingerprints: ["fingerprint-b"]
      });
      expect(await store.getForDocument(otherRoot, "a.md", "en")).toMatchObject({
        ignoredIssueFingerprints: ["fingerprint-other"]
      });
    } finally {
      await rm(otherRoot, { recursive: true, force: true });
    }
  });

  it("keeps dictionary words language-scoped", async () => {
    const store = new WritingCorrectorMemoryStore(userData);
    await store.addDictionaryWord("en", "Circles");
    await store.addDictionaryWord("es", "círculos");

    expect(await store.getForDocument(root, "doc.md", "en")).toMatchObject({
      customWords: ["circles"]
    });
    expect(await store.getForDocument(root, "doc.md", "es")).toMatchObject({
      customWords: ["círculos"]
    });
  });
});

describe("writing corrector memory IPC", () => {
  it("registers action-specific handlers on ipcMain", async () => {
    const { registerWritingCorrectorMemoryIpc } = await import("../../electron/ipc/writingCorrectorMemory");
    registerWritingCorrectorMemoryIpc({ store: new WritingCorrectorMemoryStore(userData) });

    const channels = electronMock.handle.mock.calls.map((call) => call[0]);
    expect(channels).toContain("writing-corrector-memory:get");
    expect(channels).toContain("writing-corrector-memory:ignore");
    expect(channels).toContain("writing-corrector-memory:add-dictionary-word");
  });

  it("loads, ignores, and adds dictionary words through trusted IPC handlers", async () => {
    const {
      handleAddWritingCorrectorDictionaryWordIpc,
      handleGetWritingCorrectorMemoryIpc,
      handleIgnoreWritingCorrectorIssueIpc
    } = await import("../../electron/ipc/writingCorrectorMemory");
    const store = new WritingCorrectorMemoryStore(userData);
    const resolveWorkspaceRootForSession = (_event: unknown, workspaceSessionId: string) =>
      workspaceSessionId === "session-1" ? root : null;

    expect(
      await handleIgnoreWritingCorrectorIssueIpc(
        trustedEvent(),
        {
          workspaceSessionId: "session-1",
          documentRelativePath: "doc.md",
          language: "en",
          fingerprint: "fingerprint-im"
        },
        store,
        resolveWorkspaceRootForSession
      )
    ).toMatchObject({ ignoredIssueFingerprints: ["fingerprint-im"] });

    expect(
      await handleAddWritingCorrectorDictionaryWordIpc(
        trustedEvent(),
        {
          language: "en",
          word: "Iliad"
        },
        store
      )
    ).toEqual({ customWords: ["iliad"] });

    expect(
      await handleGetWritingCorrectorMemoryIpc(
        trustedEvent(),
        {
          workspaceSessionId: "session-1",
          documentRelativePath: "doc.md",
          language: "en"
        },
        store,
        resolveWorkspaceRootForSession
      )
    ).toEqual({
      ignoredIssueFingerprints: ["fingerprint-im"],
      customWords: ["iliad"]
    });
  });

  it("rejects untrusted senders without touching the store", async () => {
    const {
      handleAddWritingCorrectorDictionaryWordIpc,
      handleGetWritingCorrectorMemoryIpc,
      handleIgnoreWritingCorrectorIssueIpc
    } = await import("../../electron/ipc/writingCorrectorMemory");
    const store = {
      getForDocument: vi.fn(),
      ignoreIssue: vi.fn(),
      addDictionaryWord: vi.fn()
    };
    electronMock.fromWebContents.mockReturnValue(null);
    const untrusted = {
      sender: {},
      senderFrame: { url: "file:///Applications/Iliad.app/index.html" }
    } as never;

    expect(await handleGetWritingCorrectorMemoryIpc(untrusted, {}, store, () => root)).toEqual({
      ignoredIssueFingerprints: [],
      customWords: []
    });
    expect(await handleIgnoreWritingCorrectorIssueIpc(untrusted, {}, store, () => root)).toEqual({
      ignoredIssueFingerprints: [],
      customWords: []
    });
    expect(await handleAddWritingCorrectorDictionaryWordIpc(untrusted, {}, store)).toEqual({ customWords: [] });
    expect(store.getForDocument).not.toHaveBeenCalled();
    expect(store.ignoreIssue).not.toHaveBeenCalled();
    expect(store.addDictionaryWord).not.toHaveBeenCalled();
  });

  it("rejects document paths that escape the workspace", async () => {
    const { handleIgnoreWritingCorrectorIssueIpc } = await import("../../electron/ipc/writingCorrectorMemory");
    const store = { ignoreIssue: vi.fn() };

    await expect(
      handleIgnoreWritingCorrectorIssueIpc(
        trustedEvent(),
        { workspaceSessionId: "session-1", documentRelativePath: "../evil.md", language: "en", fingerprint: "fp" },
        store,
        () => root
      )
    ).rejects.toThrow();
    await expect(
      handleIgnoreWritingCorrectorIssueIpc(
        trustedEvent(),
        { workspaceSessionId: "session-1", documentRelativePath: "/abs/evil.md", language: "en", fingerprint: "fp" },
        store,
        () => root
      )
    ).rejects.toThrow();
    expect(store.ignoreIssue).not.toHaveBeenCalled();
  });
});
