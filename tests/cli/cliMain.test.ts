import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runCliOpenRequest, type CliOpenSteps } from "../../src/app/useCliBridge";
import type { FileTreeNode } from "../../src/types/iliad";

const fakeWindows = vi.hoisted(() => ({ nextId: 1, created: [] as Array<Record<string, unknown>> }));

vi.mock("electron", () => ({ BrowserWindow: class {}, ipcMain: { handle: vi.fn() } }));
vi.mock("../../electron/window/createWindow.js", () => ({
  createWindow: () => {
    const id = fakeWindows.nextId++;
    const listeners: Record<string, () => void> = {};
    const window = {
      webContents: { id, send: vi.fn() },
      isDestroyed: () => false,
      isMinimized: () => false,
      isVisible: () => true,
      focus: vi.fn(),
      on: (event: string, listener: () => void) => {
        listeners[event] = listener;
      },
      emit: (event: string) => listeners[event]?.()
    };
    fakeWindows.created.push(window);
    return window;
  }
}));

describe("IliadWindowManager CLI state", () => {
  it("tracks active documents, finds the longest containing workspace, and lists status", async () => {
    const { IliadWindowManager } = await import("../../electron/window/windowManager");
    const manager = new IliadWindowManager();
    const book = manager.createIliadWindow({ launchWorkspace: { name: "book", path: "/w/book" } });
    const chapters = manager.createIliadWindow({ launchWorkspace: { name: "chapters", path: "/w/book/chapters" } });

    expect(manager.findWindowForPath("/w/book/chapters/03.md")?.webContentsId).toBe(chapters.webContents.id);
    expect(manager.findWindowForPath(path.resolve("/w/book/intro.md"))?.webContentsId).toBe(book.webContents.id);
    expect(manager.findWindowForPath("/w/bookish/a.md")).toBeNull();

    manager.setActiveDocument(book.webContents.id, path.resolve("/w/book/intro.md"));
    manager.setActiveDocument(chapters.webContents.id, "/elsewhere/x.md");
    manager.focusWindow(book);

    expect(manager.listWindowStatus()).toEqual([
      { workspace: "/w/book", document: path.resolve("/w/book/intro.md"), relativePath: "intro.md", focused: true },
      { workspace: "/w/book/chapters", document: null, relativePath: null, focused: false }
    ]);

    // Switching workspace clears the active document.
    manager.setWindowWorkspace(book.webContents.id, { name: "other", path: "/w/other" });
    expect(manager.getActiveDocument(book.webContents.id)).toBeNull();
  });

  it("queues open requests per window and holds them until the workspace contains the file", async () => {
    const { IliadWindowManager } = await import("../../electron/window/windowManager");
    const manager = new IliadWindowManager();
    const window = manager.createIliadWindow({ launchWorkspace: { name: "book", path: "/w/book" } }) as unknown as {
      webContents: { id: number; send: ReturnType<typeof vi.fn> };
      emit: (event: string) => void;
    };
    const id = window.webContents.id;
    const reply = manager.cliOpenRequests.request(id, { path: "/w/book/a.md", line: 2 });

    expect(window.webContents.send).toHaveBeenCalledWith("cli:open-requested");
    const request = manager.takeCliOpenRequest(id);
    expect(request).toMatchObject({ path: "/w/book/a.md", line: 2 });
    manager.cliOpenRequests.complete(id, request!.id, { ok: true });
    await expect(reply).resolves.toEqual({ ok: true });

    const outside = manager.cliOpenRequests.request(id, { path: "/w/other/b.md", line: null });
    expect(manager.takeCliOpenRequest(id)).toBeNull();
    window.emit("closed");
    await expect(outside).resolves.toMatchObject({ ok: false });
  });
});

describe("runCliOpenRequest", () => {
  const node: FileTreeNode = {
    name: "a.md",
    path: "/w/a.md",
    relativePath: "a.md",
    kind: "markdown"
  } as FileTreeNode;

  function steps(overrides: Partial<CliOpenSteps> = {}): CliOpenSteps {
    return {
      findNode: vi.fn(async () => node),
      prepareNavigation: vi.fn(),
      openNode: vi.fn(async () => ({ kind: "markdown" as const, path: node.path })),
      revealLine: vi.fn(async () => true),
      ...overrides
    };
  }

  it("opens through openNode and reveals the line", async () => {
    const s = steps();
    expect(await runCliOpenRequest({ id: "r", path: "/w/a.md", line: 9 }, s)).toEqual({ ok: true });
    expect(s.prepareNavigation).toHaveBeenCalledWith(node);
    expect(s.openNode).toHaveBeenCalledWith(node);
    expect(s.revealLine).toHaveBeenCalledWith("/w/a.md", 9);
  });

  it("skips the reveal without a line", async () => {
    const s = steps();
    expect(await runCliOpenRequest({ id: "r", path: "/w/a.md", line: null }, s)).toEqual({ ok: true });
    expect(s.revealLine).not.toHaveBeenCalled();
  });

  it("reports a missing node, a failed open (e.g. save failed) and a failed reveal", async () => {
    expect(await runCliOpenRequest({ id: "r", path: "/w/x.md", line: null }, steps({ findNode: async () => null }))).toMatchObject({
      ok: false,
      error: expect.stringMatching(/not in this Iliad window/)
    });
    expect(
      await runCliOpenRequest({ id: "r", path: "/w/a.md", line: null }, steps({ openNode: async () => ({ kind: "error" }) }))
    ).toMatchObject({ ok: false, error: expect.stringMatching(/could not open/) });
    expect(await runCliOpenRequest({ id: "r", path: "/w/a.md", line: 4 }, steps({ revealLine: async () => false }))).toMatchObject({
      ok: false,
      error: expect.stringMatching(/line 4/)
    });
  });
});
