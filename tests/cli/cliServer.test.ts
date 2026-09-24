import { existsSync, statSync } from "node:fs";
import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotRunningError, decodeResponse, encodeRequest, sendRequest } from "../../bin/lib/protocol.mjs";
import { createCliRequestHandler, type CliWindowHost } from "../../electron/cli/commands";
import { CliOpenRequestQueue, normalizeCliOpenResult } from "../../electron/cli/openRequests";
import { encodeCliResponse, parseCliRequest } from "../../electron/cli/protocol";
import { startCliServer, type CliServer } from "../../electron/cli/server";

describe("CLI protocol codec", () => {
  it("round-trips requests between the CLI and main", () => {
    expect(parseCliRequest(encodeRequest({ cmd: "status" }).trim())).toEqual({ ok: true, request: { cmd: "status" } });
    expect(parseCliRequest(encodeRequest({ cmd: "open", path: "/a.md", line: 4 }).trim())).toEqual({
      ok: true,
      request: { cmd: "open", path: "/a.md", line: 4 }
    });
    expect(parseCliRequest(encodeRequest({ cmd: "open", path: "/a.md" }).trim())).toEqual({
      ok: true,
      request: { cmd: "open", path: "/a.md", line: null }
    });
  });

  it("rejects malformed requests", () => {
    expect(parseCliRequest("{").ok).toBe(false);
    expect(parseCliRequest("[]").ok).toBe(false);
    expect(parseCliRequest(JSON.stringify({ v: 2, cmd: "status" }))).toMatchObject({ ok: false, error: /protocol version/ });
    expect(parseCliRequest(JSON.stringify({ v: 1, cmd: "rm" }))).toMatchObject({ ok: false, error: "Unknown command: rm" });
    expect(parseCliRequest(JSON.stringify({ v: 1, cmd: "open" })).ok).toBe(false);
    expect(parseCliRequest(JSON.stringify({ v: 1, cmd: "open", path: "/a.md", line: 0 })).ok).toBe(false);
    expect(parseCliRequest(JSON.stringify({ v: 1, cmd: "open", path: "/a.md", line: 1.5 })).ok).toBe(false);
  });

  it("decodes responses defensively", () => {
    expect(decodeResponse(encodeCliResponse({ ok: true, windows: [] }).trim())).toEqual({ ok: true, windows: [] });
    expect(decodeResponse(encodeCliResponse({ ok: false, error: "x" }).trim())).toEqual({ ok: false, error: "x" });
    expect(decodeResponse("nope")).toMatchObject({ ok: false });
    expect(decodeResponse("{}")).toMatchObject({ ok: false });
  });

  it("normalizes renderer acknowledgements", () => {
    expect(normalizeCliOpenResult({ ok: true })).toEqual({ ok: true });
    expect(normalizeCliOpenResult({ ok: false, error: "E" })).toEqual({ ok: false, error: "E" });
    expect(normalizeCliOpenResult("junk")).toEqual({ ok: false, error: "Iliad could not open the document." });
  });
});

describe("CLI socket server", () => {
  let dir: string;
  let socketPath: string;
  let server: CliServer | null;
  let host: CliWindowHost;

  beforeEach(async () => {
    dir = await realpath(await mkdtemp(path.join(os.tmpdir(), "iliad-sock-")));
    socketPath = path.join(dir, "iliad.sock");
    server = null;
    await mkdir(path.join(dir, "book", "chapters"), { recursive: true });
    await mkdir(path.join(dir, "book", ".hidden"), { recursive: true });
    await writeFile(path.join(dir, "book", "chapters", "03.md"), "# 3\n");
    await writeFile(path.join(dir, "book", ".hidden", "x.md"), "# x\n");
    await writeFile(path.join(dir, "book", "notes.txt"), "x");
    await mkdir(path.join(dir, "loose"));
    await writeFile(path.join(dir, "loose", "b.md"), "# b\n");

    const bookRoot = path.join(dir, "book");
    host = {
      listWindowStatus: vi.fn(() => [
        { workspace: bookRoot, document: path.join(bookRoot, "chapters/03.md"), relativePath: "chapters/03.md", focused: true }
      ]),
      findWindowForPath: vi.fn((absolutePath: string) =>
        absolutePath.startsWith(`${bookRoot}/`) ? { webContentsId: 1, workspaceRoot: bookRoot } : null
      ),
      openWorkspaceWindow: vi.fn((workspace) => ({ webContentsId: 2, workspaceRoot: workspace.path })),
      focusWindow: vi.fn(),
      requestOpenDocument: vi.fn(async () => ({ ok: true as const }))
    };
  });

  afterEach(async () => {
    await server?.close();
  });

  async function start() {
    server = await startCliServer({ socketPath, handler: createCliRequestHandler({ host }) });
    return server;
  }

  it("listens with mode 0600 and answers status", async () => {
    await start();
    expect(statSync(socketPath).mode & 0o777).toBe(0o600);

    const response = await sendRequest(socketPath, { cmd: "status" });
    expect(response).toEqual({ ok: true, windows: (host.listWindowStatus as ReturnType<typeof vi.fn>).mock.results[0].value });
  });

  it("replaces a stale socket and removes the socket on close", async () => {
    // A crashed run leaves the path behind with nobody listening.
    await writeFile(socketPath, "");
    await expect(sendRequest(socketPath, { cmd: "status" })).rejects.toBeInstanceOf(NotRunningError);

    await start();
    expect((await sendRequest(socketPath, { cmd: "status" })).ok).toBe(true);
    await server!.close();
    server = null;
    expect(existsSync(socketPath)).toBe(false);
  });

  it("reports NotRunningError when nothing listens", async () => {
    await expect(sendRequest(socketPath, { cmd: "status" })).rejects.toBeInstanceOf(NotRunningError);
  });

  it("opens a file in the window whose workspace contains it and waits for the renderer", async () => {
    await start();
    const file = path.join(dir, "book", "chapters", "03.md");
    expect(await sendRequest(socketPath, { cmd: "open", path: file, line: 12 })).toEqual({ ok: true });
    expect(host.focusWindow).toHaveBeenCalledWith(1);
    expect(host.openWorkspaceWindow).not.toHaveBeenCalled();
    expect(host.requestOpenDocument).toHaveBeenCalledWith(1, { path: file, line: 12 });
  });

  it("opens a new window on the file's own folder when no window contains it", async () => {
    await start();
    const file = path.join(dir, "loose", "b.md");
    expect(await sendRequest(socketPath, { cmd: "open", path: file })).toEqual({ ok: true });
    expect(host.openWorkspaceWindow).toHaveBeenCalledWith(expect.objectContaining({ path: path.join(dir, "loose") }));
    expect(host.requestOpenDocument).toHaveBeenCalledWith(2, { path: file, line: null });
  });

  it("returns the renderer's failure", async () => {
    host.requestOpenDocument = vi.fn(async () => ({ ok: false as const, error: "Save failed." }));
    await start();
    expect(await sendRequest(socketPath, { cmd: "open", path: path.join(dir, "book", "chapters", "03.md") })).toEqual({
      ok: false,
      error: "Save failed."
    });
  });

  it("rejects missing, non-Markdown, relative and hidden paths", async () => {
    await start();
    expect(await sendRequest(socketPath, { cmd: "open", path: path.join(dir, "book", "none.md") })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/File not found/)
    });
    expect(await sendRequest(socketPath, { cmd: "open", path: path.join(dir, "book", "notes.txt") })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/Not a Markdown file/)
    });
    expect(await sendRequest(socketPath, { cmd: "open", path: "book/chapters/03.md" })).toMatchObject({ ok: false });
    expect(await sendRequest(socketPath, { cmd: "open", path: path.join(dir, "book", ".hidden", "x.md") })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/hidden/)
    });
    expect(host.requestOpenDocument).not.toHaveBeenCalled();
  });

  it("never opens a new window on a hidden or ignored folder, whichever spelling of the path", async () => {
    await mkdir(path.join(dir, ".private"));
    await writeFile(path.join(dir, ".private", "draft.md"), "# d\n");
    await mkdir(path.join(dir, "outside", "dist"), { recursive: true });
    await writeFile(path.join(dir, "outside", "dist", "x.md"), "# x\n");
    await symlink(path.join(dir, ".private"), path.join(dir, "visible-link"));
    await symlink(path.join(dir, "loose"), path.join(dir, ".hidden-link"));
    await start();

    for (const file of [
      path.join(dir, ".private", "draft.md"),
      path.join(dir, "outside", "dist", "x.md"),
      path.join(dir, "visible-link", "draft.md"),
      path.join(dir, ".hidden-link", "b.md")
    ]) {
      expect(await sendRequest(socketPath, { cmd: "open", path: file })).toMatchObject({
        ok: false,
        error: expect.stringMatching(/hidden or ignored/)
      });
    }

    expect(host.openWorkspaceWindow).not.toHaveBeenCalled();
    expect(host.requestOpenDocument).not.toHaveBeenCalled();
  });

  it("answers garbage with an error line", async () => {
    await start();
    const reply = await new Promise<string>((resolve) => {
      const socket = net.createConnection(socketPath, () => socket.write("not json\n"));
      let data = "";
      socket.setEncoding("utf8");
      socket.on("data", (chunk) => (data += chunk));
      socket.on("end", () => resolve(data));
    });
    expect(JSON.parse(reply)).toEqual({ ok: false, error: "Request is not valid JSON." });
  });
});

describe("CliOpenRequestQueue", () => {
  it("hands a request out once, and resolves when the renderer acknowledges", async () => {
    const notify = vi.fn();
    let id = 0;
    const queue = new CliOpenRequestQueue({ notify, createId: () => `r${++id}` });
    const reply = queue.request(7, { path: "/w/a.md", line: 3 });

    expect(notify).toHaveBeenCalledWith(7);
    expect(queue.take(7, () => false)).toBeNull();
    expect(queue.take(7)).toEqual({ id: "r1", path: "/w/a.md", line: 3 });
    expect(queue.take(7)).toBeNull();
    expect(queue.complete(7, "other", { ok: true })).toBe(false);
    expect(queue.complete(7, "r1", { ok: true })).toBe(true);
    await expect(reply).resolves.toEqual({ ok: true });
  });

  it("keeps a taken request until its ack and serves later ones in order", async () => {
    const notify = vi.fn();
    let id = 0;
    const queue = new CliOpenRequestQueue({ notify, createId: () => `r${++id}` });
    const first = queue.request(1, { path: "/a.md", line: null });
    expect(queue.take(1)).toMatchObject({ id: "r1" });

    const second = queue.request(1, { path: "/b.md", line: 2 });
    const third = queue.request(1, { path: "/c.md", line: null });
    // r1 is still in flight: nothing else is handed out yet.
    expect(queue.take(1)).toBeNull();

    notify.mockClear();
    expect(queue.complete(1, "r1", { ok: true })).toBe(true);
    await expect(first).resolves.toEqual({ ok: true });
    expect(notify).toHaveBeenCalledWith(1);

    expect(queue.take(1)).toMatchObject({ id: "r2", path: "/b.md" });
    queue.complete(1, "r2", { ok: false, error: "E" });
    await expect(second).resolves.toEqual({ ok: false, error: "E" });
    expect(queue.take(1)).toMatchObject({ id: "r3" });
    queue.complete(1, "r3", { ok: true });
    await expect(third).resolves.toEqual({ ok: true });
    expect(queue.take(1)).toBeNull();
  });

  it("times out each request, and settles in-flight and waiting ones when the window closes", async () => {
    vi.useFakeTimers();

    try {
      const queue = new CliOpenRequestQueue({ notify: () => undefined, timeoutMs: 10_000 });
      const lonely = queue.request(1, { path: "/a.md", line: null });
      vi.advanceTimersByTime(10_000);
      await expect(lonely).resolves.toEqual({ ok: false, error: "Iliad did not open the document in time." });

      const taken = queue.request(2, { path: "/b.md", line: null });
      expect(queue.take(2)).not.toBeNull();
      const waiting = queue.request(2, { path: "/c.md", line: null });
      queue.dropWindow(2);
      await expect(taken).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/closed/) });
      await expect(waiting).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/closed/) });
    } finally {
      vi.useRealTimers();
    }
  });
});
