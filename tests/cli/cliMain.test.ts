import { lstat, mkdir, mkdtemp, readlink, realpath, writeFile, chmod } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { directoryIsOnPath, installCliCommand } from "../../electron/cli/installCommand";
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

describe("installCliCommand", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await realpath(await mkdtemp(path.join(os.tmpdir(), "iliad-install-")));
  });

  it("links into the first writable folder and reports PATH membership", async () => {
    const readOnly = path.join(dir, "ro");
    const writable = path.join(dir, "rw");
    await mkdir(readOnly);
    await mkdir(writable);
    await chmod(readOnly, 0o500);
    const wrapper = path.join(dir, "iliad-wrapper");
    await writeFile(wrapper, "#!/bin/sh\n");

    const result = await installCliCommand({
      wrapperPath: wrapper,
      directories: [path.join(dir, "missing"), readOnly, writable],
      pathValue: `/usr/bin:${writable}`,
      createMissingDirectory: null
    });

    expect(result).toEqual({ linkPath: path.join(writable, "iliad"), directory: writable, onPath: true });
    expect((await lstat(result.linkPath)).isSymbolicLink()).toBe(true);
    expect(await readlink(result.linkPath)).toBe(wrapper);

    // Reinstall replaces our own symlink.
    await installCliCommand({ wrapperPath: wrapper, directories: [writable], pathValue: "", createMissingDirectory: null });
    expect(await readlink(result.linkPath)).toBe(wrapper);
  });

  it("never overwrites a real file and creates ~/.local/bin when needed", async () => {
    const taken = path.join(dir, "taken");
    await mkdir(taken);
    await writeFile(path.join(taken, "iliad"), "someone else's");
    const localBin = path.join(dir, "home", ".local", "bin");

    const result = await installCliCommand({
      wrapperPath: "/w",
      directories: [taken, localBin],
      pathValue: "/usr/bin",
      createMissingDirectory: localBin
    });

    expect(result).toMatchObject({ directory: localBin, onPath: false });
    await expect(
      installCliCommand({ wrapperPath: "/w", directories: [taken], pathValue: "", createMissingDirectory: null })
    ).rejects.toThrow(/No writable folder/);
  });

  it("matches PATH entries exactly", () => {
    expect(directoryIsOnPath("/opt/homebrew/bin", "/usr/bin:/opt/homebrew/bin/")).toBe(true);
    expect(directoryIsOnPath("/opt/homebrew/bin", "/usr/bin:/opt/homebrew/sbin")).toBe(false);
  });
});

describe("IliadWindowManager CLI state", () => {
  it("tracks active documents, finds the longest containing workspace, and lists status", async () => {
    const { IliadWindowManager } = await import("../../electron/window/windowManager");
    const manager = new IliadWindowManager();
    const book = manager.createIliadWindow({ launchWorkspace: { name: "book", path: "/w/book" } });
    const chapters = manager.createIliadWindow({ launchWorkspace: { name: "chapters", path: "/w/book/chapters" } });

    expect(manager.findWindowForPath("/w/book/chapters/03.md")?.webContentsId).toBe(chapters.webContents.id);
    expect(manager.findWindowForPath("/w/book/intro.md")?.webContentsId).toBe(book.webContents.id);
    expect(manager.findWindowForPath("/w/bookish/a.md")).toBeNull();

    manager.setActiveDocument(book.webContents.id, "/w/book/intro.md");
    manager.setActiveDocument(chapters.webContents.id, "/elsewhere/x.md");
    manager.focusWindow(book);

    expect(manager.listWindowStatus()).toEqual([
      { workspace: "/w/book", document: "/w/book/intro.md", relativePath: "intro.md", focused: true },
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
