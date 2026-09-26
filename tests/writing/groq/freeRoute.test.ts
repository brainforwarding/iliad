import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleAutocompleteIpc } from "../../../electron/ipc/autocomplete";
import { handleTightenIpc } from "../../../electron/ipc/tighten";
import { SELECTION_MAX_OUTPUT_CHARS } from "../../../electron/writing/groq/prompts/index";
import { WritingAiService } from "../../../electron/writing/writingAiService";
import { startFakeAiProxy, type FakeAiProxy } from "../../fixtures/fakeAiProxy";

vi.mock("electron", () => ({
  app: { getPath: () => os.tmpdir() },
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { fromWebContents: () => ({}) }
}));

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function userDataDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "iliad-free-route-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function proxy(options: Parameters<typeof startFakeAiProxy>[0] = {}) {
  const server = await startFakeAiProxy(options);
  cleanups.push(() => server.close());
  return server;
}

function recordingDiagnostics() {
  const records: unknown[] = [];
  const push = (record: unknown) => records.push(record);
  return { records, logger: { info: push, warn: push, debug: push, error: push, log: push, flush: vi.fn(async () => undefined) } };
}

async function freeService(server: FakeAiProxy, dir?: string) {
  const userData = dir ?? (await userDataDir());
  const diagnostics = recordingDiagnostics();
  const service = new WritingAiService(userData, {
    isPackaged: false,
    env: { ILIAD_AI_PROXY_URL: server.url },
    clientVersion: "0.4.0",
    diagnostics: diagnostics.logger
  });
  return { service, userData, diagnostics };
}

const event = { sender: { id: 7, isDestroyed: () => false, send: vi.fn() }, senderFrame: { url: "file:///app/index.html" } } as never;

function autocompleteRequest(overrides: Record<string, unknown> = {}) {
  return {
    requestId: `r${Math.random()}`,
    workspaceSessionId: "s",
    documentRelativePath: "a.md",
    language: "en",
    prefix: "She walked into the ",
    suffix: "",
    headingPath: [],
    documentTitle: "a",
    nearbyHeadings: [],
    suggestionKind: "sentence",
    ...overrides
  };
}

function runAutocomplete(service: WritingAiService, overrides: Record<string, unknown> = {}) {
  return handleAutocompleteIpc(event, autocompleteRequest(overrides), {
    service,
    controllers: new Map(),
    resolveWorkspaceRootForSession: () => "/ws"
  });
}

const TEXT = "This passage is really wordy.";

function runTighten(service: WritingAiService, request: Record<string, unknown> = {}) {
  return handleTightenIpc(event, { requestId: "t1", text: TEXT, selection: { from: 16, to: 29 }, language: "en", ...request }, {
    service,
    controllers: new Map()
  });
}

describe("free route (Iliad AI proxy)", () => {
  it("makes no network call at construction, issues a token lazily and streams through the proxy", async () => {
    const server = await proxy();
    const { service, userData } = await freeService(server);
    expect(server.requests).toHaveLength(0);
    expect((await service.writingAssistStatus()).ai.route).toBe("free");
    expect(server.requests).toHaveLength(0);

    const result = await runAutocomplete(service);
    expect(result).toEqual({ ok: true, insert: "a quiet line from the fake proxy." });
    expect(server.requests.map((request) => request.path)).toEqual(["/v1/install", "/v1/generate"]);

    const install = server.requests[0];
    expect(install.body).toEqual({ client: "iliad-md", version: "0.4.0" });
    const generate = server.requests[1];
    expect(generate.client).toBe("iliad-md/0.4.0");
    expect(generate.contentType).toBe("application/json");
    expect(generate.authorization).toMatch(/^Bearer v1\.fake\./);
    // A structured task: never messages, model or params.
    expect(generate.body).toMatchObject({ v: 1, task: "autocomplete", language: "en", kind: "sentence", prefix: "She walked into the " });
    expect(generate.body).not.toHaveProperty("messages");
    expect(generate.body).not.toHaveProperty("model");

    const tokenFile = path.join(userData, "ai", "install.json");
    expect((await stat(tokenFile)).mode & 0o777).toBe(0o600);
    const stored = JSON.parse(await readFile(tokenFile, "utf8")) as { token: string; issuedAt: string };
    expect(generate.authorization).toBe(`Bearer ${stored.token}`);

    // The token is reused.
    await runAutocomplete(service);
    expect(server.requests.map((request) => request.path)).toEqual(["/v1/install", "/v1/generate", "/v1/generate"]);
  });

  it("streams stable-word partials from the proxy", async () => {
    const server = await proxy();
    const { service } = await freeService(server);
    const send = vi.fn();
    const partialEvent = { ...(event as object), sender: { id: 8, isDestroyed: () => false, send } } as never;
    const result = await handleAutocompleteIpc(partialEvent, autocompleteRequest(), {
      service,
      controllers: new Map(),
      resolveWorkspaceRootForSession: () => "/ws"
    });
    expect(result).toEqual({ ok: true, insert: "a quiet line from the fake proxy." });
    expect(send).toHaveBeenCalledWith("autocomplete:partial", expect.objectContaining({ insert: expect.stringMatching(/^a quiet line/) }));
  });

  it.each([
    ["install quota", (server: FakeAiProxy) => { server.state.installDailyRequests = 0; }],
    ["global cap", (server: FakeAiProxy) => { server.state.globalCapReached = true; }],
    ["issuance limit", (server: FakeAiProxy) => { server.state.installsPerDay = 0; }]
  ])("maps the %s to one free_exhausted reason with resetAt, on autocomplete and ✦ AI", async (_name, exhaust) => {
    const server = await proxy();
    exhaust(server);
    const { service } = await freeService(server);

    const autocomplete = await runAutocomplete(service);
    expect(autocomplete).toEqual({ ok: false, reason: "free_exhausted", resetAt: server.resetAt() });
    const tighten = await runTighten(service);
    expect(tighten).toEqual({ ok: false, reason: "free_exhausted", resetAt: server.resetAt() });
    // No cooldown in main either: the next explicit request reaches the proxy again.
    const before = server.requests.length;
    await runAutocomplete(service);
    expect(server.requests.length).toBeGreaterThan(before);
  });

  it.each([
    [{ status: 503, code: "free_tier_disabled" }, "free_unavailable"],
    [{ status: 426, code: "client_outdated" }, "client_outdated"],
    [{ status: 503, code: "upstream_busy" }, "rate_limited"],
    [{ status: 502, code: "upstream_error" }, "provider"],
    [{ status: 504, code: "upstream_timeout" }, "timeout"],
    [{ status: 400, code: "bad_request" }, "provider"],
    [{ status: 413, code: "too_large" }, "provider"]
  ])("maps proxy refusal %o to %s without resetAt", async (refusal, reason) => {
    const server = await proxy();
    const { service } = await freeService(server);
    server.state.nextGenerateError = refusal;
    expect(await runAutocomplete(service)).toEqual({ ok: false, reason });
    server.state.nextGenerateError = refusal;
    const tighten = await runTighten(service);
    expect(tighten).toEqual({ ok: false, reason: reason === "timeout" ? "provider" : reason });
  });

  it("re-issues once on invalid_token and retries once, never looping", async () => {
    const server = await proxy();
    const { service } = await freeService(server);
    await runAutocomplete(service);
    server.tokens.clear(); // the proxy no longer knows the saved token (e.g. kid rotated)

    expect((await runAutocomplete(service)).ok).toBe(true);
    expect(server.requests.map((request) => request.path).slice(2)).toEqual(["/v1/generate", "/v1/install", "/v1/generate"]);

    server.state.alwaysUnauthorized = "invalid_token";
    const count = server.requests.length;
    expect(await runAutocomplete(service)).toEqual({ ok: false, reason: "provider" });
    expect(server.requests.slice(count).map((request) => request.path)).toEqual(["/v1/generate", "/v1/install", "/v1/generate"]);
  });

  it("refreshes an expired token with the same install identity", async () => {
    const server = await proxy();
    const { service } = await freeService(server);
    await runAutocomplete(service);
    const [firstToken] = [...server.tokens.keys()];
    const sub = server.tokens.get(firstToken)?.sub;
    server.expireAllTokens();

    expect((await runAutocomplete(service)).ok).toBe(true);
    const refresh = server.requests.find((request, index) => index > 1 && request.path === "/v1/install");
    expect(refresh?.body).toEqual({ client: "iliad-md", version: "0.4.0", refresh: firstToken });
    const latest = server.requests[server.requests.length - 1].authorization?.replace("Bearer ", "") ?? "";
    expect(latest).not.toBe(firstToken);
    expect(server.tokens.get(latest)?.sub).toBe(sub);
  });

  it("replaces a corrupt install token file by one re-issue", async () => {
    const server = await proxy();
    const userData = await userDataDir();
    await mkdir(path.join(userData, "ai"), { recursive: true });
    await writeFile(path.join(userData, "ai", "install.json"), "{not json", "utf8");
    const { service } = await freeService(server, userData);

    expect((await runAutocomplete(service)).ok).toBe(true);
    expect(server.requests.map((request) => request.path)).toEqual(["/v1/install", "/v1/generate"]);
  });

  it("aborting mid-stream closes the connection (the proxy sees it)", async () => {
    const server = await proxy({
      reply: () => ({ deltas: Array.from({ length: 50 }, (_, index) => `word${index} `), finishReason: "stop", delayMs: 20 })
    });
    const { service } = await freeService(server);
    const controller = new AbortController();
    const pending = service.autocompleteIdea({
      requestId: "a",
      language: "en",
      prefix: "Hello there, ",
      suffix: "",
      headingPath: [],
      documentTitle: "",
      nearbyHeadings: [],
      suggestionKind: "sentence",
      onPartial: () => controller.abort(),
      signal: controller.signal
    });
    await expect(pending).rejects.toBeTruthy();
    await vi.waitFor(() => expect(server.closedEarly).toBe(1));
  });

  it("maps an in-band upstream_timeout to timeout and upstream_error to provider", async () => {
    const server = await proxy({ reply: () => ({ deltas: ["partial "], inBandError: "upstream_timeout" }) });
    const { service } = await freeService(server);
    expect(await runAutocomplete(service)).toEqual({ ok: false, reason: "timeout" });
    server.state.reply = () => ({ deltas: ["partial "], inBandError: "upstream_error" });
    expect(await runAutocomplete(service)).toEqual({ ok: false, reason: "provider" });
  });

  it("reports an unreachable proxy as unreachable", async () => {
    const server = await proxy();
    const url = server.url;
    await server.close();
    const service = new WritingAiService(await userDataDir(), {
      isPackaged: false,
      env: { ILIAD_AI_PROXY_URL: url },
      diagnostics: recordingDiagnostics().logger
    });
    expect(await runAutocomplete(service)).toEqual({ ok: false, reason: "unreachable" });
  });

  it("refuses to send anything while the built-in proxy URL is a placeholder (packaged, no override)", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("{}", { status: 404 }));
    const service = new WritingAiService(await userDataDir(), {
      isPackaged: true,
      env: { ILIAD_AI_PROXY_URL: "http://127.0.0.1:1" },
      fetchImpl,
      diagnostics: recordingDiagnostics().logger
    });
    expect(await runAutocomplete(service)).toEqual({ ok: false, reason: "free_unavailable" });
    // Only the background ai.json check may run; never /v1/*.
    expect(fetchImpl.mock.calls.map(([url]) => String(url)).filter((url) => url.includes("/v1/"))).toEqual([]);
  });

  it("passes a selection rewrite between 8,001 and 12,000 characters end to end", async () => {
    const selected = "word ".repeat(800).trim(); // 3,999 chars → cap 11,997
    const rewrite = "x".repeat(10_000);
    const server = await proxy({ reply: () => ({ deltas: [rewrite.slice(0, 5000), rewrite.slice(5000)], finishReason: "stop" }) });
    const { service } = await freeService(server);
    const result = await handleTightenIpc(event, {
      requestId: "big",
      text: selected,
      selection: { from: 0, to: selected.length },
      language: "en",
      mode: "edit",
      instruction: "Expand this."
    }, { service, controllers: new Map() });
    expect(result).toMatchObject({ ok: true, rewrite });
    expect(rewrite.length).toBeLessThanOrEqual(SELECTION_MAX_OUTPUT_CHARS);
  });

  it("logs codes and counts only — never text, tokens or keys", async () => {
    const marker = "ZZMARKERZZ";
    const server = await proxy({ reply: () => ({ deltas: [`${marker} output`], finishReason: "stop" }) });
    const { service, diagnostics } = await freeService(server);
    await runAutocomplete(service, { prefix: `The ${marker} walked into the `, documentTitle: marker });
    server.state.installDailyRequests = 0;
    await runAutocomplete(service, { prefix: `The ${marker} walked into the ` });
    await runTighten(service, { text: `${marker} is really wordy text.`, selection: { from: 0, to: 10 } });

    const logged = JSON.stringify(diagnostics.records);
    expect(diagnostics.records.length).toBeGreaterThan(0);
    expect(logged).not.toContain(marker);
    expect(logged).not.toMatch(/v1\.fake\./);
    expect(logged).toContain("autocomplete.ai.completed");
    expect(logged).toContain("autocomplete.ai.failed");
    expect(logged).toContain('"route":"free"');
  });
});
