import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleAutocompleteIpc } from "../../electron/ipc/autocomplete";
import { handleDocumentNameCancelIpc, handleDocumentNameIpc } from "../../electron/ipc/documentName";
import { handleTightenIpc } from "../../electron/ipc/tighten";
import { cleanDocumentNameOutput, NAME_MAX_INPUT_CHARS } from "../../electron/writing/documentName";
import { AgentRuntimeError } from "../../electron/writing/errors";
import { GroqKeyStore, type SafeStorageLike } from "../../electron/writing/groq/keyStore";
import { WritingAiService } from "../../electron/writing/writingAiService";
import { startFakeAiProxy, type FakeAiProxy } from "../fixtures/fakeAiProxy";

vi.mock("electron", () => ({
  app: { getPath: () => os.tmpdir() },
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { fromWebContents: () => ({}) }
}));

const cleanups: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function userDataDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "iliad-doc-name-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function recordingDiagnostics() {
  const records: unknown[] = [];
  const push = (record: unknown) => records.push(record);
  return { records, logger: { info: push, warn: push, debug: push, error: push, log: push, flush: vi.fn(async () => undefined) } };
}

const fakeSafeStorage: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (text) => Buffer.from(`enc:${Buffer.from(text).toString("hex")}`),
  decryptString: (buffer) => Buffer.from(buffer.toString().slice(4), "hex").toString()
};

async function proxy() {
  const server = await startFakeAiProxy();
  cleanups.push(() => server.close());
  return server;
}

async function freeService(server: FakeAiProxy) {
  const diagnostics = recordingDiagnostics();
  const service = new WritingAiService(await userDataDir(), {
    isPackaged: false,
    env: { ILIAD_AI_PROXY_URL: server.url },
    clientVersion: "0.4.0",
    diagnostics: diagnostics.logger
  });
  return { service, diagnostics };
}

const frame = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`;

async function ownKeyService(reply: (response: http.ServerResponse) => void) {
  const seen: unknown[] = [];
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (part) => (body += part));
    request.on("end", () => {
      seen.push(JSON.parse(body));
      reply(response);
    });
  });
  cleanups.push(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const dir = await userDataDir();
  await new GroqKeyStore(dir, { safeStorage: fakeSafeStorage }).setKey("gsk_ownkey1234");
  const diagnostics = recordingDiagnostics();
  const service = new WritingAiService(dir, {
    safeStorage: fakeSafeStorage,
    fetchImpl: (input, init) => fetch(String(input).replace("https://api.groq.com/openai/v1", base), init),
    isPackaged: false,
    env: {},
    diagnostics: diagnostics.logger
  });
  return { service, seen, diagnostics };
}

function groqStream(response: http.ServerResponse, text: string, finishReason: string | null = "stop") {
  response.writeHead(200, { "Content-Type": "text/event-stream" });
  response.write(frame({ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] }));
  if (finishReason) response.write(frame({ choices: [{ index: 0, delta: {}, finish_reason: finishReason }] }));
  response.end("data: [DONE]\n\n");
}

const event = { sender: { id: 7, isDestroyed: () => false, send: vi.fn() }, senderFrame: { url: "file:///app/index.html" } } as never;
const TEXT = "We met on Tuesday to plan the spring workshop. SECRETMARKER budget, venue and speakers are still open.";

function suggest(service: Parameters<typeof handleDocumentNameIpc>[2]["service"], request: Record<string, unknown> = {}, controllers = new Map<string, AbortController>()) {
  return handleDocumentNameIpc(event, { requestId: "n1", language: "en", text: TEXT, ...request }, { service, controllers });
}

describe("cleanDocumentNameOutput", () => {
  it.each([
    ["Spring workshop plan", "Spring workshop plan"],
    ["  \"Spring workshop plan.\"  ", "Spring workshop plan"],
    ["“Plan de sesión”", "Plan de sesión"],
    ["`Plan`", "Plan"],
    ["**Spring   workshop**", "Spring workshop"],
    ["'Why we sleep?'", "Why we sleep"],
    ["Notes…", "Notes"],
    ["Plan\t de   sesión!", "Plan de sesión"]
  ])("cleans %j to %j", (raw, expected) => {
    expect(cleanDocumentNameOutput(raw)).toBe(expected);
  });

  it.each([
    ["", "empty"],
    ["   ", "blank"],
    ["\"\"", "only quotes"],
    ["...", "only punctuation"],
    ["Title\nSecond line", "multi-line"],
    ["Bad\u0007title", "control character"],
    ["x".repeat(81), "overlong"]
  ])("rejects %j (%s)", (raw) => {
    expect(cleanDocumentNameOutput(raw)).toBeNull();
  });

  it("accepts exactly 80 characters", () => {
    expect(cleanDocumentNameOutput("x".repeat(80))).toBe("x".repeat(80));
  });
});

describe("ai-name:run", () => {
  it("sends the name, autocomplete and selection tasks as v3 on the free route", async () => {
    const server = await proxy();
    const { service } = await freeService(server);

    expect(await suggest(service)).toEqual({ ok: true, title: "Spring workshop plan" });
    await handleAutocompleteIpc(event, {
      requestId: "a1", workspaceSessionId: "s", documentRelativePath: "a.md", language: "en", prefix: "She walked into the ",
      suffix: "", headingPath: [], documentTitle: "a", nearbyHeadings: [], suggestionKind: "sentence"
    }, { service, controllers: new Map(), resolveWorkspaceRootForSession: () => "/ws" });
    await handleTightenIpc(event, { requestId: "t1", text: "This is really wordy.", selection: { from: 0, to: 21 }, language: "en" }, {
      service,
      controllers: new Map()
    });

    const generated = server.requests.filter((request) => request.path === "/v1/generate").map((request) => request.body);
    expect(generated[0]).toEqual({ v: 3, task: "name", language: "en", text: TEXT });
    expect(generated.slice(1).map((body) => {
      const { v, task } = body as { v: number; task: string };
      return { v, task };
    })).toEqual([{ v: 3, task: "autocomplete" }, { v: 3, task: "selection" }]);
  });

  it("answers client_outdated on every free-route task when the Worker does not serve v3", async () => {
    const server = await proxy();
    server.state.supportedPromptVersions = [1, 2];
    const { service } = await freeService(server);

    expect(await suggest(service)).toEqual({ ok: false, reason: "client_outdated" });
    expect(
      await handleAutocompleteIpc(event, {
        requestId: "a1", workspaceSessionId: "s", documentRelativePath: "a.md", language: "en", prefix: "She walked into the ",
        suffix: "", headingPath: [], documentTitle: "a", nearbyHeadings: [], suggestionKind: "sentence"
      }, { service, controllers: new Map(), resolveWorkspaceRootForSession: () => "/ws" })
    ).toEqual({ ok: false, reason: "client_outdated" });
    expect(
      await handleTightenIpc(event, { requestId: "t1", text: "This is really wordy.", selection: { from: 0, to: 21 }, language: "en" }, {
        service,
        controllers: new Map()
      })
    ).toMatchObject({ ok: false, reason: "client_outdated" });
  });

  it("passes resetAt with free_exhausted", async () => {
    const server = await proxy();
    server.state.globalCapReached = true;
    const { service } = await freeService(server);

    expect(await suggest(service)).toEqual({ ok: false, reason: "free_exhausted", resetAt: server.resetAt() });
  });

  it("uses the own key directly and cleans the title", async () => {
    const { service, seen } = await ownKeyService((response) => groqStream(response, "\"Spring workshop plan.\""));

    expect(await suggest(service, { language: "es" })).toEqual({ ok: true, title: "Spring workshop plan" });
    expect(seen[0]).toMatchObject({ max_completion_tokens: 512 });
    expect(JSON.stringify(seen[0])).toContain("Da un título breve");
  });

  it.each([
    ["length", "failed"],
    ["content_filter", "failed"],
    [null, "failed"]
  ])("offers only a clean stop (%s → %s)", async (finish, reason) => {
    const { service } = await ownKeyService((response) => groqStream(response, "Spring plan", finish));
    expect(await suggest(service)).toEqual({ ok: false, reason });
  });

  it("fails on an unusable title and on reasoning markers", async () => {
    const multi = await ownKeyService((response) => groqStream(response, "Title\nAnd an explanation"));
    expect(await suggest(multi.service)).toEqual({ ok: false, reason: "failed" });
    const marker = await ownKeyService((response) => groqStream(response, "<think>x</think> Plan"));
    expect(await suggest(marker.service)).toEqual({ ok: false, reason: "failed" });
  });

  it("maps own-key 401 to invalid_api_key and 429 to rate_limited", async () => {
    const unauthorized = await ownKeyService((response) => {
      response.writeHead(401);
      response.end();
    });
    expect(await suggest(unauthorized.service)).toEqual({ ok: false, reason: "invalid_api_key" });
    const limited = await ownKeyService((response) => {
      response.writeHead(429);
      response.end();
    });
    expect(await suggest(limited.service)).toEqual({ ok: false, reason: "rate_limited" });
  });

  it("logs the document_name area and never the text or title", async () => {
    const { service, diagnostics } = await ownKeyService((response) => groqStream(response, "TITLEMARKER plan"));
    await suggest(service);
    const logged = JSON.stringify(diagnostics.records);
    expect(logged).toContain("document_name.ai.completed");
    expect(logged).not.toContain("SECRETMARKER");
    expect(logged).not.toContain("TITLEMARKER");
  });

  it("validates the request before any AI call", async () => {
    const service = { suggestName: vi.fn(async () => "Plan") };
    expect(await suggest(service, { text: "   " })).toEqual({ ok: false, reason: "empty" });
    expect(await suggest(service, { text: 42 })).toEqual({ ok: false, reason: "empty" });
    expect(await suggest(service, { text: "x".repeat(NAME_MAX_INPUT_CHARS + 1) })).toEqual({ ok: false, reason: "too_long" });
    expect(await suggest(service, { requestId: "" })).toEqual({ ok: false, reason: "empty" });
    expect(service.suggestName).not.toHaveBeenCalled();
    expect(await suggest(service, { text: "x".repeat(NAME_MAX_INPUT_CHARS), language: "fr" })).toEqual({ ok: true, title: "Plan" });
    expect(service.suggestName).toHaveBeenCalledWith({ language: "en", text: "x".repeat(NAME_MAX_INPUT_CHARS) }, expect.any(AbortSignal));
  });

  it("refuses untrusted senders", async () => {
    const service = { suggestName: vi.fn(async () => "Plan") };
    const untrusted = { sender: { id: 7 }, senderFrame: { url: "https://evil.example" } } as never;
    expect(await handleDocumentNameIpc(untrusted, { requestId: "n1", language: "en", text: TEXT }, { service, controllers: new Map() })).toEqual({
      ok: false,
      reason: "untrusted"
    });
    expect(service.suggestName).not.toHaveBeenCalled();
  });

  it("times out, cancels, and keeps a single flight per window", async () => {
    const waitForAbort = (_request: unknown, signal: AbortSignal) =>
      new Promise<string>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new AgentRuntimeError({ code: "request_canceled", userMessage: "", retryable: false })));
      });
    const service = { suggestName: vi.fn(waitForAbort) };
    const controllers = new Map<string, AbortController>();

    await expect(
      handleDocumentNameIpc(event, { requestId: "slow", language: "en", text: TEXT }, { service, controllers, timeoutMs: 10 })
    ).resolves.toEqual({ ok: false, reason: "timeout" });

    const first = suggest(service, { requestId: "first" }, controllers);
    const second = suggest(service, { requestId: "second" }, controllers);
    await expect(first).resolves.toEqual({ ok: false, reason: "aborted" });
    expect([...controllers.keys()]).toEqual(["7:second"]);

    const untrusted = { sender: { id: 7 }, senderFrame: { url: "https://evil.example" } } as never;
    handleDocumentNameCancelIpc(untrusted, "second", controllers);
    handleDocumentNameCancelIpc(event, "", controllers);
    expect(controllers.get("7:second")?.signal.aborted).toBe(false);
    handleDocumentNameCancelIpc(event, "second", controllers);
    await expect(second).resolves.toEqual({ ok: false, reason: "aborted" });
    expect(controllers.size).toBe(0);
  });
});
