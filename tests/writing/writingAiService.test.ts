import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleAutocompleteIpc } from "../../electron/ipc/autocomplete";
import { handleTightenCancelIpc, handleTightenIpc } from "../../electron/ipc/tighten";
import { handleSetGroqKeyIpc, handleSetRecordingShortcutIpc, handleWarmWritingAiIpc, handleWritingAssistStatusIpc } from "../../electron/ipc/writingSettings";
import { GroqKeyStore, type SafeStorageLike } from "../../electron/writing/groq/keyStore";
import { GROQ_MODEL, PREFERENCES_LABEL_V3, PREFERENCES_RULE_V3, WRITING_STYLE_RULES } from "../../electron/writing/groq/prompts/index";
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

describe("whole-document context and preferences per route (spec 2026-09-27)", () => {
  const DOC = "# Harbor\n\nMara Quint ran the Kestrel ferry.\n\n## Morning\n\nShe walked into the ";
  const contextRequest = {
    requestId: "r2", workspaceSessionId: "s", documentRelativePath: "a.md", language: "en", prefix: "She walked into the ", suffix: "",
    headingPath: ["Harbor", "Morning"], documentTitle: "a", nearbyHeadings: [], suggestionKind: "sentence",
    document: { text: DOC, cursor: DOC.length }, preferences: "  Short sentences.  "
  };
  const deps = (service: WritingAiService) => ({ service, controllers: new Map(), resolveWorkspaceRootForSession: () => "/ws" });

  it("own key: prompt v3 (writing rules) with the document, the outline and the preferences", async () => {
    const { service, groq } = await ownKeyService((_request, _body, response) => groqStream(response, "quiet room."));
    expect(await handleAutocompleteIpc(event, contextRequest, deps(service))).toEqual({ ok: true, insert: "quiet room." });
    const [system, user] = (groq.seen[0].body as { messages: Array<{ content: string }> }).messages.map((message) => message.content);
    expect(system).toContain(WRITING_STYLE_RULES.en);
    expect(system).toContain(PREFERENCES_RULE_V3.en);
    expect(user).toContain(`<<<DOCUMENT>>>\n${DOC}<<<CURSOR>>>\n<<<END_DOCUMENT>>>`);
    expect(user).toContain("## Morning  ← cursor");
    expect(user).toContain(`${PREFERENCES_LABEL_V3}\n<<<PREFERENCES>>>\nShort sentences.\n<<<END_PREFERENCES>>>`);
  });

  it("own key: ✦ AI edit sends the v3 rules plus the edit override; the name prompt has no style rules", async () => {
    const { service, groq } = await ownKeyService((_request, _body, response) => groqStream(response, "Harbor notes"));
    const selectionFrom = DOC.indexOf("Mara");
    await handleTightenIpc(event, {
      requestId: "t", text: "Mara Quint ran the Kestrel ferry.", selection: { from: 0, to: 33 }, language: "es", mode: "edit", instruction: "Expand.",
      document: { text: DOC, selectionFrom, selectionTo: selectionFrom + 33 }, preferences: "Frases cortas."
    }, { service, controllers: new Map() });
    const edit = (groq.seen[0].body as { messages: Array<{ content: string }> }).messages[0].content;
    expect(edit).toContain(WRITING_STYLE_RULES.es);
    expect(edit).toContain("La instrucción de edición prevalece sobre este estilo por defecto");
    expect(edit).toContain(PREFERENCES_RULE_V3.es);

    await service.suggestName({ language: "en", text: "We met on Tuesday to plan the spring workshop." }, new AbortController().signal);
    const name = (groq.seen[1].body as { messages: Array<{ content: string }> }).messages[0].content;
    expect(name).toMatch(/^Give a short title/);
    expect(name).not.toContain(WRITING_STYLE_RULES.en);
  });

  it("free route: autocomplete, selection and name send v3 tasks with the document, the outline and the preferences", async () => {
    const proxy = await startFakeAiProxy();
    cleanups.push(() => proxy.close());
    const service = new WritingAiService(await userDataDir(), {
      isPackaged: false,
      env: { ILIAD_AI_PROXY_URL: proxy.url },
      clientVersion: "0.4.0",
      diagnostics: quietDiagnostics()
    });
    await handleAutocompleteIpc(event, contextRequest, deps(service));
    const selectionFrom = DOC.indexOf("Mara");
    await handleTightenIpc(event, {
      requestId: "t", text: "Mara Quint ran the Kestrel ferry.", selection: { from: 0, to: 33 }, language: "en", mode: "edit", instruction: "Expand.",
      document: { text: DOC, selectionFrom, selectionTo: selectionFrom + 33 }, preferences: "  Short sentences.  "
    }, { service, controllers: new Map() });
    const generated = proxy.requests.filter((request) => request.path === "/v1/generate").map((request) => request.body);
    expect(generated[0]).toEqual({
      v: 3, task: "autocomplete", language: "en", kind: "sentence", extend: false, document: `${DOC}<<<CURSOR>>>`,
      outline: "# Harbor\n## Morning  ← cursor", preferences: "Short sentences.",
      documentTitle: "a", headingPath: ["Harbor", "Morning"], direction: "", avoid: []
    });
    await service.suggestName({ language: "es", text: "Nos reunimos el martes." }, new AbortController().signal);
    expect(proxy.requests.filter((request) => request.path === "/v1/generate").at(-1)?.body).toEqual({
      v: 3, task: "name", language: "es", text: "Nos reunimos el martes."
    });
    expect(generated[1]).toEqual({
      v: 3, task: "selection", language: "en", mode: "edit", instruction: "Expand.", text: "Mara Quint ran the Kestrel ferry.",
      selection: { from: 0, to: 33 }, document: "# Harbor\n\n<<<PASSAGE>>>\n\n## Morning\n\nShe walked into the ", preferences: "Short sentences."
    });
  });

  it("rejects preferences over the limit as too_long before any request", async () => {
    const { service, groq } = await ownKeyService((_request, _body, response) => groqStream(response, "x"));
    const preferences = "p".repeat(1001);
    expect(await handleAutocompleteIpc(event, { ...contextRequest, preferences }, deps(service))).toEqual({ ok: false, reason: "too_long" });
    expect(await handleTightenIpc(event, { requestId: "t", text: TEXT, selection: { from: 16, to: 29 }, language: "en", preferences }, { service, controllers: new Map() })).toEqual({ ok: false, reason: "too_long" });
    expect(groq.seen).toHaveLength(0);
  });

  it("✦ AI edit: sends the reference and the passage separately and rejects an answer copying the reference", async () => {
    const distant = "The Kestrel Point lighthouse was decommissioned in 1987 after the new radar station opened.";
    const doc = `# Harbor\n\n${distant}\n\n${TEXT}\n\nEnd.`;
    const selectionFrom = doc.indexOf(TEXT) + 16;
    const request = {
      requestId: "t2", text: TEXT, selection: { from: 16, to: 29 }, language: "en", mode: "edit", instruction: "Expand.",
      document: { text: doc, selectionFrom, selectionTo: selectionFrom + 13 }, preferences: "Plain words."
    };
    const echo = await ownKeyService((_request, _body, response) => groqStream(response, `wordy. ${distant}`));
    expect(await handleTightenIpc(event, request, { service: echo.service, controllers: new Map() })).toEqual({ ok: false, reason: "provider" });
    const user = (echo.groq.seen[0].body as { messages: Array<{ content: string }> }).messages[1].content;
    expect(user).toContain(`<<<REFERENCE>>>\n# Harbor\n\n${distant}\n\n<<<PASSAGE>>>\n\nEnd.\n<<<END_REFERENCE>>>`);
    expect(user).toContain("<<<EDITABLE_PASSAGE>>>\nThis passage is <<<ILIAD_TIGHTEN_SELECTION_START>>>rather wordy.<<<ILIAD_TIGHTEN_SELECTION_END>>>\n<<<END_EDITABLE_PASSAGE>>>");

    const fine = await ownKeyService((_request, _body, response) => groqStream(response, "rather long-winded."));
    expect(await handleTightenIpc(event, request, { service: fine.service, controllers: new Map() })).toEqual({
      ok: true,
      rewrite: "This passage is rather long-winded.",
      unchanged: false
    });
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

describe("tighten:cancel", () => {
  it("aborts only for a trusted sender and a non-empty request id", () => {
    const controllers = new Map<string, AbortController>();
    const run = new AbortController();
    const anon = new AbortController();
    controllers.set("1:t1", run);
    controllers.set("1:anon", anon);
    const untrusted = { sender: { id: 1 }, senderFrame: { url: "https://evil.example" } } as never;
    const trusted = { sender: { id: 1 }, senderFrame: { url: "file:///app/index.html" } } as never;

    handleTightenCancelIpc(untrusted, "t1", controllers);
    expect(run.signal.aborted).toBe(false);
    handleTightenCancelIpc(trusted, "", controllers);
    handleTightenCancelIpc(trusted, "  ", controllers);
    handleTightenCancelIpc(trusted, 42, controllers);
    expect(anon.signal.aborted).toBe(false);

    handleTightenCancelIpc(trusted, "t1", controllers);
    expect(run.signal.aborted).toBe(true);
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

describe("writing:set-recording-shortcut", () => {
  it("pauses the app menu's shortcuts for a trusted window only, and only for a boolean", () => {
    const setIgnoreMenuShortcuts = vi.fn();
    const sender = { id: 1, setIgnoreMenuShortcuts };
    handleSetRecordingShortcutIpc({ sender, senderFrame: { url: "https://evil.example" } } as never, true);
    handleSetRecordingShortcutIpc({ sender, senderFrame: { url: "file:///app/index.html" } } as never, "yes");
    expect(setIgnoreMenuShortcuts).not.toHaveBeenCalled();
    handleSetRecordingShortcutIpc({ sender, senderFrame: { url: "file:///app/index.html" } } as never, true);
    handleSetRecordingShortcutIpc({ sender, senderFrame: { url: "file:///app/index.html" } } as never, false);
    expect(setIgnoreMenuShortcuts.mock.calls).toEqual([[true], [false]]);
  });
});

describe("connection warm-up", () => {
  const keyStoreIn = (state: "ok" | "none" | "unreadable") => ({
    read: async () => (state === "ok" ? { state, key: "gsk_ownkey1234" } : { state }) as never,
    getState: async () => ({ state, last4: state === "ok" ? "1234" : null }),
    setKey: async () => ({ state, last4: null })
  });
  const warmService = async (state: "ok" | "none" | "unreadable", extra: Record<string, unknown> = {}) => {
    let now = 1_000_000;
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("", { status: 200 }));
    const service = new WritingAiService(await userDataDir(), {
      keyStore: keyStoreIn(state), fetchImpl, isPackaged: true, env: {}, diagnostics: quietDiagnostics(), now: () => now, ...extra
    });
    return { service, fetchImpl, advance: (ms: number) => (now += ms) };
  };

  it("own key: one bodiless, unauthenticated HEAD to Groq, at most once a minute", async () => {
    const { service, fetchImpl, advance } = await warmService("ok");
    expect(await service.warmConnection()).toBe("own-key");
    expect(await service.warmConnection()).toBe("skipped");
    advance(59_999);
    expect(await service.warmConnection()).toBe("skipped");
    advance(1);
    expect(await service.warmConnection()).toBe("own-key");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe("https://api.groq.com/openai/v1/models");
    expect(init).toMatchObject({ method: "HEAD" });
    expect(init?.headers).toBeUndefined();
    expect(init?.body).toBeUndefined();
  });

  it("free: GET /healthz on the proxy (never /v1/generate or ai.json), rate-limited", async () => {
    const { service, fetchImpl } = await warmService("none");
    expect(await service.warmConnection()).toBe("free");
    expect(await service.warmConnection()).toBe("skipped");
    expect(fetchImpl.mock.calls.map(([url, init]) => [String(url), init?.method])).toEqual([
      ["https://iliad-ai.quiet-bush-25b1.workers.dev/healthz", "GET"]
    ]);
  });

  it("nothing when AI is blocked or the free proxy isn't configured", async () => {
    const blocked = await warmService("unreadable");
    expect(await blocked.service.warmConnection()).toBe("skipped");
    expect(blocked.fetchImpl).not.toHaveBeenCalled();

    const unconfigured = await warmService("none", { proxyEndpoint: { peek: async () => ({ ok: false, reason: "proxy_not_configured" }) } });
    expect(await unconfigured.service.warmConnection()).toBe("skipped");
    expect(unconfigured.fetchImpl).not.toHaveBeenCalled();
  });

  it("a real request counts as use: no warm-up right after it", async () => {
    const { service, groq } = await ownKeyService((_request, _body, response) => groqStream(response, "quiet room."));
    expect(await autocomplete(service)).toEqual({ ok: true, insert: "quiet room." });
    expect(await service.warmConnection()).toBe("skipped");
    expect(groq.seen).toHaveLength(1);
  });

  it("IPC: only trusted windows, and a failing warm-up never reaches the renderer", async () => {
    const warmConnection = vi.fn(async (): Promise<"own-key" | "free" | "skipped"> => {
      throw new Error("offline");
    });
    await handleWarmWritingAiIpc({ sender: { id: 1 }, senderFrame: { url: "https://evil.example" } } as never, { warmConnection });
    expect(warmConnection).not.toHaveBeenCalled();
    await expect(handleWarmWritingAiIpc(event, { warmConnection })).resolves.toBeUndefined();
    expect(warmConnection).toHaveBeenCalledOnce();
  });
});
