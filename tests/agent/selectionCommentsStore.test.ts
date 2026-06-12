import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SelectionCommentsStore } from "../../electron/agent/selectionCommentsStore";
import type { SelectionComment } from "../../electron/agent/selectionCommentsStore";

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
  root = await mkdtemp(path.join(os.tmpdir(), "iliad-comments-workspace-"));
  userData = await mkdtemp(path.join(os.tmpdir(), "iliad-comments-userdata-"));
  electronMock.fromWebContents.mockReset();
  electronMock.handle.mockReset();
  delete process.env.VITE_DEV_SERVER_URL;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(userData, { recursive: true, force: true });
});

function comment(overrides: Partial<SelectionComment>): SelectionComment {
  return {
    id: "comment-test",
    workspacePath: root,
    documentRelativePath: "doc.md",
    from: 4,
    to: 12,
    quote: "selected",
    occurrence: 1,
    prefix: "the ",
    comment: "tighten this",
    createdAt: new Date(0).toISOString(),
    status: "pending",
    ...overrides
  };
}

function trustedEvent() {
  electronMock.fromWebContents.mockReturnValue({});
  return {
    sender: {},
    senderFrame: { url: "file:///Applications/Iliad.app/index.html" }
  } as never;
}

describe("SelectionCommentsStore", () => {
  it("round-trips comments through the temp userData dir", async () => {
    const store = new SelectionCommentsStore(userData);
    await store.replaceForDocument(root, "doc.md", [comment({ id: "comment-1" })]);

    const reopened = new SelectionCommentsStore(userData);
    const listed = await reopened.listForWorkspace(root);

    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      id: "comment-1",
      workspacePath: root,
      documentRelativePath: "doc.md",
      quote: "selected",
      comment: "tighten this",
      status: "pending"
    });
  });

  it("prunes non-pending comments on write", async () => {
    const store = new SelectionCommentsStore(userData);
    await store.replaceForDocument(root, "doc.md", [
      comment({ id: "comment-pending" }),
      comment({ id: "comment-sent", status: "sent" }),
      comment({ id: "comment-discarded", status: "discarded" })
    ]);

    const listed = await store.listForWorkspace(root);
    expect(listed.map((item) => item.id)).toEqual(["comment-pending"]);

    const raw = JSON.parse(await readFile(path.join(userData, "assistant", "selection-comments.json"), "utf8"));
    expect(raw).toHaveLength(1);
  });

  it("keys comments by workspace and document path", async () => {
    const otherRoot = await mkdtemp(path.join(os.tmpdir(), "iliad-comments-workspace-b-"));

    try {
      const store = new SelectionCommentsStore(userData);
      await store.replaceForDocument(root, "a.md", [comment({ id: "comment-a", documentRelativePath: "a.md" })]);
      await store.replaceForDocument(root, "b.md", [comment({ id: "comment-b", documentRelativePath: "b.md" })]);
      await store.replaceForDocument(otherRoot, "a.md", [
        comment({ id: "comment-other", workspacePath: otherRoot, documentRelativePath: "a.md" })
      ]);

      // Replacing a.md in the first workspace must not touch b.md or the other workspace.
      await store.replaceForDocument(root, "a.md", [
        comment({ id: "comment-a2", documentRelativePath: "a.md" })
      ]);

      const first = await store.listForWorkspace(root);
      const second = await store.listForWorkspace(otherRoot);

      expect(first.map((item) => item.id).sort()).toEqual(["comment-a2", "comment-b"]);
      expect(second.map((item) => item.id)).toEqual(["comment-other"]);
    } finally {
      await rm(otherRoot, { recursive: true, force: true });
    }
  });

  it("survives a corrupt store file by starting empty", async () => {
    const store = new SelectionCommentsStore(userData);
    await store.replaceForDocument(root, "doc.md", [comment({})]);
    await writeFile(path.join(userData, "assistant", "selection-comments.json"), "not json", "utf8");

    expect(await store.listForWorkspace(root)).toEqual([]);
  });
});

describe("selection comments IPC", () => {
  it("registers both handlers on ipcMain", async () => {
    const { registerSelectionCommentsIpc } = await import("../../electron/ipc/selectionComments");
    registerSelectionCommentsIpc({ store: new SelectionCommentsStore(userData) });

    const channels = electronMock.handle.mock.calls.map((call) => call[0]);
    expect(channels).toContain("selection-comments:list");
    expect(channels).toContain("selection-comments:save");
  });

  it("saves and lists through the registered handlers with a session resolver", async () => {
    const { registerSelectionCommentsIpc } = await import("../../electron/ipc/selectionComments");
    registerSelectionCommentsIpc({
      store: new SelectionCommentsStore(userData),
      resolveWorkspaceRootForSession: (_event, workspaceSessionId) =>
        workspaceSessionId === "session-1" ? root : null
    });

    const handlers = new Map(electronMock.handle.mock.calls.map((call) => [call[0], call[1]]));
    const save = handlers.get("selection-comments:save") as (...args: unknown[]) => Promise<SelectionComment[]>;
    const list = handlers.get("selection-comments:list") as (...args: unknown[]) => Promise<SelectionComment[]>;

    const saved = await save(trustedEvent(), "session-1", "doc.md", [comment({ id: "comment-ipc" })]);
    expect(saved.map((item) => item.id)).toEqual(["comment-ipc"]);

    const listed = await list(trustedEvent(), "session-1");
    expect(listed.map((item) => item.id)).toEqual(["comment-ipc"]);

    expect(await list(trustedEvent(), "unknown-session")).toEqual([]);
  });

  it("rejects untrusted senders without touching the store", async () => {
    const { handleListSelectionCommentsIpc, handleSaveSelectionCommentsIpc } = await import(
      "../../electron/ipc/selectionComments"
    );
    const store = {
      listForWorkspace: vi.fn(),
      replaceForDocument: vi.fn()
    };
    electronMock.fromWebContents.mockReturnValue(null);
    const untrusted = {
      sender: {},
      senderFrame: { url: "file:///Applications/Iliad.app/index.html" }
    } as never;

    expect(await handleListSelectionCommentsIpc(untrusted, "session-1", store, () => root)).toEqual([]);
    expect(
      await handleSaveSelectionCommentsIpc(untrusted, "session-1", "doc.md", [comment({})], store, () => root)
    ).toEqual([]);
    expect(store.listForWorkspace).not.toHaveBeenCalled();
    expect(store.replaceForDocument).not.toHaveBeenCalled();
  });

  it("rejects document paths that escape the workspace", async () => {
    const { handleSaveSelectionCommentsIpc } = await import("../../electron/ipc/selectionComments");
    const store = { replaceForDocument: vi.fn() };

    await expect(
      handleSaveSelectionCommentsIpc(trustedEvent(), "session-1", "../evil.md", [comment({})], store, () => root)
    ).rejects.toThrow();
    await expect(
      handleSaveSelectionCommentsIpc(trustedEvent(), "session-1", "/abs/evil.md", [comment({})], store, () => root)
    ).rejects.toThrow();
    await expect(
      handleSaveSelectionCommentsIpc(trustedEvent(), "session-1", "nested/../../evil.md", [comment({})], store, () => root)
    ).rejects.toThrow();
    expect(store.replaceForDocument).not.toHaveBeenCalled();
  });
});
