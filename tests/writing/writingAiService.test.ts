import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleAutocompleteIpc } from "../../electron/ipc/autocomplete";
import { handleTightenIpc } from "../../electron/ipc/tighten";
import { handleSetGroqKeyIpc, handleWritingAssistStatusIpc } from "../../electron/ipc/writingSettings";
import { GroqKeyStore, type SafeStorageLike } from "../../electron/writing/groq/keyStore";
import { GROQ_MODEL } from "../../electron/writing/groq/prompts/index";
import { WritingAiService } from "../../electron/writing/writingAiService";
import { startFakeAiProxy } from "../fixtures/fakeAiProxy";

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
  const dir = await mkdtemp(path.join(os.tmpdir(), "iliad-writing-ai-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function quietDiagnostics() {
  const records: unknown[] = [];
  const push = (record: unknown) => records.push(record);
  return { records, info: push, warn: push, debug: push, error: push, log: push, flush: vi.fn(async () => undefined) };
}

/** A fake safeStorage: reversible, but the stored bytes never contain the plaintext. */
const fakeSafeStorage: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (text) => Buffer.from(`enc:${Buffer.from(text).toString("hex")}`),
  decryptString: (buffer) => {
    const value = buffer.toString();
    if (!value.startsWith("enc:")) throw new Error("decrypt failed");
    return Buffer.from(value.slice(4), "hex").toString();
  }
};

type GroqHandler = (request: http.IncomingMessage, body: string, response: http.ServerResponse) => void;

/** A fake Groq; `fetchImpl` rewrites api.groq.com to it. */
async function fakeGroq(handler: GroqHandler) {
  const seen: Array<{ url: string; auth: string | undefined; body: unknown }> = [];
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (part) => (body += part));
    request.on("end", () => {
      seen.push({ url: request.url ?? "", auth: request.headers.authorization, body: body ? JSON.parse(body) : null });
      handler(request, body, response);
    });
  });
  cleanups.push(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const fetchImpl: typeof fetch = (input, init) => fetch(String(input).replace("https://api.groq.com/openai/v1", base), init);
  return { fetchImpl, seen };
}

const frame = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`;

function groqStream(response: http.ServerResponse, text: string, finishReason: string | null = "stop") {
  response.writeHead(200, { "Content-Type": "text/event-stream" });
  response.write(frame({ choices: [{ index: 0, delta: { reasoning: "hidden analysis" }, finish_reason: null }] }));
  response.write(frame({ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] }));
  if (finishReason) response.write(frame({ choices: [{ index: 0, delta: {}, finish_reason: finishReason }] }));
  response.end("data: [DONE]\n\n");
}

const event = { sender: { id: 7, isDestroyed: () => false, send: vi.fn() }, senderFrame: { url: "file:///app/index.html" } } as never;
const TEXT = "This passage is rather wordy.";

function autocomplete(service: WritingAiService, prefix = "She walked into the ") {
  return handleAutocompleteIpc(event, {
    requestId: "r1", workspaceSessionId: "s", documentRelativePath: "a.md", language: "en", prefix, suffix: "",
    headingPath: [], documentTitle: "a", nearbyHeadings: [], suggestionKind: "sentence"
  }, { service, controllers: new Map(), resolveWorkspaceRootForSession: () => "/ws" });
}

function tighten(service: WritingAiService) {
  return handleTightenIpc(event, { requestId: "t1", text: TEXT, selection: { from: 16, to: 29 }, language: "en" }, {
    service,
    controllers: new Map()
  });
}

async function ownKeyService(handler: GroqHandler, options: { key?: string } = {}) {
  const dir = await userDataDir();
  const store = new GroqKeyStore(dir, { safeStorage: fakeSafeStorage });
  await store.setKey(options.key ?? "gsk_ownkey1234");
  const groq = await fakeGroq(handler);
  const proxy = await startFakeAiProxy();
  cleanups.push(() => proxy.close());
  const diagnostics = quietDiagnostics();
  const service = new WritingAiService(dir, {
    safeStorage: fakeSafeStorage,
    fetchImpl: groq.fetchImpl,
    isPackaged: false,
    env: { ILIAD_AI_PROXY_URL: proxy.url },
    diagnostics
  });
  return { service, groq, proxy, dir, diagnostics };
}

describe("WritingAiService route selection", () => {
  it("uses the own key directly (never the proxy) when a key is saved", async () => {
    const { service, groq, proxy } = await ownKeyService((_request, _body, response) => groqStream(response, "quiet room."));
    expect((await service.writingAssistStatus()).ai).toEqual({ route: "own-key", model: GROQ_MODEL });

    expect(await autocomplete(service)).toEqual({ ok: true, insert: "quiet room." });
    expect(groq.seen).toHaveLength(1);
    expect(groq.seen[0].auth).toBe("Bearer gsk_ownkey1234");
    expect(groq.seen[0].body).toMatchObject({ model: GROQ_MODEL, reasoning_effort: "low", include_reasoning: false, stream: true });
    expect(proxy.requests).toHaveLength(0);
  });

  it("blocks AI when the saved key is unreadable and never falls back to free", async () => {
    const dir = await userDataDir();
    await mkdir(path.join(dir, "ai"), { recursive: true });
    await writeFile(path.join(dir, "ai", "settings.json"), JSON.stringify({ storage: "safeStorage", groqApiKeyEnc: Buffer.from("garbage").toString("base64") }));
    const proxy = await startFakeAiProxy();
    cleanups.push(() => proxy.close());
    const fetchImpl = vi.fn<typeof fetch>();
    const service = new WritingAiService(dir, {
      safeStorage: fakeSafeStorage,
      fetchImpl,
      isPackaged: false,
      env: { ILIAD_AI_PROXY_URL: proxy.url },
      diagnostics: quietDiagnostics()
    });

    const status = await service.writingAssistStatus();
    expect(status.ai.route).toBe("blocked");
    expect(status.groqKey).toEqual({ state: "unreadable", last4: null, rejected: false });
    expect(await autocomplete(service)).toEqual({ ok: false, reason: "key_unreadable" });
    expect(await tighten(service)).toEqual({ ok: false, reason: "key_unreadable" });
    expect(proxy.requests).toHaveLength(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps own-key 401 to invalid_api_key (no free fallback) and marks the key rejected", async () => {
    const { service, proxy } = await ownKeyService((_request, _body, response) => {
      response.writeHead(401, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { message: "secret document text" } }));
    });
    expect(await autocomplete(service)).toEqual({ ok: false, reason: "invalid_api_key" });
    expect(await tighten(service)).toEqual({ ok: false, reason: "invalid_api_key" });
    expect(proxy.requests).toHaveLength(0);
    expect((await service.writingAssistStatus()).groqKey).toEqual({ state: "ok", last4: "1234", rejected: true });
  });

  it("maps own-key 429 to rate_limited", async () => {
    const { service } = await ownKeyService((_request, _body, response) => {
      response.writeHead(429);
      response.end();
    });
    expect(await autocomplete(service)).toEqual({ ok: false, reason: "rate_limited" });
    expect(await tighten(service)).toEqual({ ok: false, reason: "rate_limited" });
  });
});

describe("WritingAiService finish reasons and leak guard", () => {
  it.each([
    ["length", { ok: false, reason: "no_suggestion" }],
    ["content_filter", { ok: false, reason: "no_suggestion" }],
    [null, { ok: false, reason: "no_suggestion" }]
  ])("autocomplete offers only a clean stop (%s)", async (finish, expected) => {
    const { service } = await ownKeyService((_request, _body, response) => groqStream(response, "quiet room.", finish));
    expect(await autocomplete(service)).toEqual(expected);
  });

  it.each([
    ["length", "incomplete"],
    ["content_filter", "blocked"],
    [null, "provider"],
    ["tool_calls", "provider"]
  ])("✦ AI never offers a partial rewrite (%s -> %s)", async (finish, reason) => {
    const { service } = await ownKeyService((_request, _body, response) => groqStream(response, "wordy.", finish));
    expect(await tighten(service)).toEqual({ ok: false, reason });
  });

  it("cleans a stopped rewrite and merges it into the safe unit", async () => {
    const { service } = await ownKeyService((_request, _body, response) => groqStream(response, "```\nwordy.\n```\n"));
    expect(await tighten(service)).toEqual({ ok: true, rewrite: "This passage is wordy.", unchanged: false });
  });

  it.each(["<|channel|>analysis then text", "<think>hmm</think> text"])("discards output carrying reasoning markers (%s)", async (text) => {
    const { service } = await ownKeyService((_request, _body, response) => groqStream(response, text));
    expect(await autocomplete(service)).toEqual({ ok: false, reason: "no_suggestion" });
    expect(await tighten(service)).toEqual({ ok: false, reason: "provider" });
  });

  it("logs no text, key or provider body", async () => {
    const marker = "QQMARKERQQ";
    const { service, diagnostics } = await ownKeyService((_request, _body, response) => groqStream(response, `${marker} out.`));
    await autocomplete(service, `The ${marker} went into the `);
    await tighten(service);
    const logged = JSON.stringify(diagnostics.records);
    expect(logged).not.toContain(marker);
    expect(logged).not.toContain("gsk_ownkey1234");
    expect(logged).toContain('"route":"own-key"');
    expect(logged).toContain("selection_ai.ai.completed");
  });
});

describe("Groq key IPC (validated before saving)", () => {
  const trusted = { sender: { id: 1 }, senderFrame: { url: "file:///app/index.html" } } as never;

  async function keyService(status: number | "network") {
    const dir = await userDataDir();
    const validator = status === "network"
      ? vi.fn<typeof fetch>(async () => { throw new TypeError("fetch failed"); })
      : vi.fn<typeof fetch>(async () => new Response("{}", { status }));
    const service = new WritingAiService(dir, {
      safeStorage: fakeSafeStorage,
      fetchImpl: validator,
      diagnostics: quietDiagnostics()
    });
    return { service, dir, validator };
  }

  it("saves a key only after Groq returns 200, encrypted and never in plaintext", async () => {
    const { service, dir, validator } = await keyService(200);
    const result = await handleSetGroqKeyIpc(trusted, "  gsk_newKey9876  ", service);
    expect(result).toEqual({ ok: true, state: { state: "ok", last4: "9876", rejected: false } });
    expect(String(validator.mock.calls[0][0])).toBe("https://api.groq.com/openai/v1/models");
    const raw = await import("node:fs/promises").then((fs) => fs.readFile(path.join(dir, "ai", "settings.json"), "utf8"));
    expect(raw).not.toContain("gsk_newKey9876");
    expect(JSON.parse(raw)).toMatchObject({ storage: "safeStorage" });

    const status = await handleWritingAssistStatusIpc(trusted, service);
    expect(status).toEqual({
      corrector: { available: true, provider: "local" },
      ai: { route: "own-key", model: GROQ_MODEL },
      groqKey: { state: "ok", last4: "9876", rejected: false }
    });
    expect(JSON.stringify(status)).not.toMatch(/count|quota|remaining/i);

    expect(await handleSetGroqKeyIpc(trusted, null, service)).toEqual({ ok: true, state: { state: "none", last4: null, rejected: false } });
    expect((await service.writingAssistStatus()).ai.route).toBe("free");
  });

  it.each([
    [401, "rejected"],
    [403, "rejected"],
    [500, "unreachable"],
    ["network" as const, "unreachable"]
  ])("does not save a key Groq answers with %s (%s)", async (status, reason) => {
    const { service } = await keyService(status);
    expect(await handleSetGroqKeyIpc(trusted, "gsk_candidate", service)).toEqual({ ok: false, reason });
    expect((await service.getGroqKeyState()).state).toBe("none");
  });

  it("rejects malformed keys before any network call", async () => {
    const { service, validator } = await keyService(200);
    expect(await handleSetGroqKeyIpc(trusted, "has space", service)).toEqual({ ok: false, reason: "invalid_shape" });
    expect(await handleSetGroqKeyIpc(trusted, "x".repeat(513), service)).toEqual({ ok: false, reason: "invalid_shape" });
    expect(await handleSetGroqKeyIpc(trusted, 42, service)).toEqual({ ok: false, reason: "invalid_shape" });
    expect(validator).not.toHaveBeenCalled();
  });

  it("refuses untrusted senders", async () => {
    const { service } = await keyService(200);
    const untrusted = { sender: { id: 1 }, senderFrame: { url: "https://evil.example" } } as never;
    await expect(handleSetGroqKeyIpc(untrusted, "gsk_x", service)).rejects.toThrow();
    expect((await handleWritingAssistStatusIpc(untrusted, service)).ai.route).toBe("blocked");
  });
});

describe("dev env overrides", () => {
  it("reads GROQ_API_KEY and ILIAD_AI_PROXY_URL only when not packaged; never Gemini env vars", async () => {
    const env = { GROQ_API_KEY: "gsk_envkeyWXYZ", ILIAD_AI_PROXY_URL: "http://127.0.0.1:9", GEMINI_API_KEY: "g", GOOGLE_API_KEY: "g" };
    const dev = new WritingAiService(await userDataDir(), { isPackaged: false, env, diagnostics: quietDiagnostics() });
    expect((await dev.writingAssistStatus()).groqKey).toEqual({ state: "ok", last4: "WXYZ", rejected: false });

    // Packaged: no env key (free route) and never a request to the dev URL (stubbed fetch).
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ error: { code: "free_tier_disabled" } }, { status: 503 }));
    const packaged = new WritingAiService(await userDataDir(), { isPackaged: true, env, fetchImpl, diagnostics: quietDiagnostics() });
    expect((await packaged.writingAssistStatus()).groqKey.state).toBe("none");
    expect(await autocomplete(packaged)).toEqual({ ok: false, reason: "free_unavailable" });
    expect(fetchImpl.mock.calls.map(([url]) => String(url)).some((url) => url.includes("127.0.0.1"))).toBe(false);

    const noGroq = new WritingAiService(await userDataDir(), {
      isPackaged: false,
      env: { GEMINI_API_KEY: "g", GOOGLE_API_KEY: "g" },
      diagnostics: quietDiagnostics()
    });
    expect((await noGroq.writingAssistStatus()).ai.route).toBe("free");
  });
});
