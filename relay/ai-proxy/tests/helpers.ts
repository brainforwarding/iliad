// Test doubles for the Worker: node:sqlite-backed Durable Object storage,
// an in-process DO namespace, a scripted fake Groq upstream, a clock and a
// waitUntil collector. No Wrangler, Cloudflare login or network needed.

import { DatabaseSync } from "node:sqlite";
import type { AiProxyEnv, DurableObjectStorageLike, ExecutionContextLike, SqlValue } from "../src/cloudflareTypes.js";
import { base64UrlEncode } from "../src/crypto.js";
import { QuotaDayObject } from "../src/quotaObject.js";
import { handleRequest, type WorkerDeps } from "../src/worker.js";
import type { Logger } from "../src/log.js";

export class SqliteStorage implements DurableObjectStorageLike {
  db = new DatabaseSync(":memory:");
  alarm: number | null = null;
  private depth = 0;

  sql = {
    exec: (query: string, ...bindings: SqlValue[]) => {
      const rows = this.db.prepare(query).all(...bindings) as Record<string, SqlValue>[];
      return { toArray: () => rows };
    }
  };

  transactionSync<T>(fn: () => T): T {
    const name = `sp${this.depth}`;
    this.db.exec(`SAVEPOINT ${name}`);
    this.depth += 1;
    try {
      const result = fn();
      this.depth -= 1;
      this.db.exec(`RELEASE ${name}`);
      return result;
    } catch (error) {
      this.depth -= 1;
      this.db.exec(`ROLLBACK TO ${name}`);
      this.db.exec(`RELEASE ${name}`);
      throw error;
    }
  }

  async getAlarm() {
    return this.alarm;
  }

  async setAlarm(time: number) {
    this.alarm = time;
  }

  async deleteAlarm() {
    this.alarm = null;
  }

  async deleteAll() {
    this.db.close();
    this.db = new DatabaseSync(":memory:");
  }

  /** Every row of every table, as text (privacy assertions). */
  dump(): string {
    const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
    return JSON.stringify(tables.map(({ name }) => ({ name, rows: this.db.prepare(`SELECT * FROM "${name}"`).all() })));
  }

  tableNames(): string[] {
    return (this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((row) => row.name);
  }
}

export class Clock {
  constructor(public value = Date.parse("2026-09-25T12:00:00.000Z")) {}
  now = () => this.value;
  advance(ms: number) {
    this.value += ms;
  }
}

export class FakeNamespace {
  readonly objects = new Map<string, { object: QuotaDayObject; storage: SqliteStorage }>();
  readonly locationHints: Array<string | undefined> = [];

  constructor(private readonly clock: Clock) {}

  idFromName(name: string) {
    return { toString: () => name };
  }

  get(id: { toString(): string }, options?: { locationHint?: string }) {
    this.locationHints.push(options?.locationHint);
    return { fetch: (request: Request) => this.entry(id.toString()).object.fetch(request) };
  }

  entry(name: string) {
    let entry = this.objects.get(name);
    if (!entry) {
      const storage = new SqliteStorage();
      entry = { object: new QuotaDayObject({ storage }, undefined, this.clock.now), storage };
      this.objects.set(name, entry);
    }
    return entry;
  }

  day(day: string) {
    return this.entry(`quota:${day}`);
  }
}

export function testSecret(bytes = 32): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return base64UrlEncode(value);
}

export const SIGNING_KEYS = JSON.stringify({ k1: { key: testSecret(), signs: true } });

export function baseEnv(namespace: FakeNamespace, overrides: Partial<AiProxyEnv> = {}): AiProxyEnv {
  return {
    QUOTA: namespace,
    FREE_TIER_ENABLED: "true",
    INSTALL_DAILY_REQUESTS: "50",
    IP_DAILY_REQUESTS: "150",
    IP_DAILY_NEW_INSTALLS: "5",
    IP48_DAILY_NEW_INSTALLS: "20",
    DENY_SUBJECTS: "",
    SUPPORTED_PROMPT_VERSIONS: "1",
    GLOBAL_DAILY_NANO_USD: "5000000000",
    INPUT_NANO_USD_PER_TOKEN: "150",
    OUTPUT_NANO_USD_PER_TOKEN: "600",
    PROMPT_OVERHEAD_TOKENS: "150",
    TOKEN_TTL_DAYS: "30",
    TOKEN_REFRESH_DAYS: "60",
    MIN_CLIENT_VERSION: "0.4.0",
    GROQ_API_KEY: "gsk_test_key",
    TOKEN_SIGNING_KEYS: SIGNING_KEYS,
    IP_HASH_KEY: testSecret(),
    ADMIN_TOKEN: "admin-token-0123456789abcdef0123456789",
    ...overrides
  };
}

export class WaitUntil implements ExecutionContextLike {
  readonly promises: Promise<unknown>[] = [];
  waitUntil(promise: Promise<unknown>) {
    this.promises.push(promise);
  }
  async settle() {
    // Settling can register nothing new, but loop in case a promise chains another.
    let seen = 0;
    while (seen < this.promises.length) {
      const batch = this.promises.slice(seen);
      seen = this.promises.length;
      await Promise.allSettled(batch);
    }
  }
}

// ---------------------------------------------------------------------------
// Fake Groq upstream.

export type UpstreamStep =
  | { frame: unknown }
  | { raw: string }
  | { delayMs: number }
  | { hang: true };

export interface UpstreamScript {
  status?: number;
  headers?: Record<string, string>;
  steps?: UpstreamStep[];
  /** Reject the fetch itself (network failure). */
  networkError?: boolean;
  /** Never resolve the fetch until aborted. */
  hangBeforeHeaders?: boolean;
}

export interface UpstreamCall {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
  signal: AbortSignal | null;
  aborted: boolean;
  bodyCanceled: boolean;
}

export class FakeGroq {
  readonly calls: UpstreamCall[] = [];
  scripts: UpstreamScript[] = [];
  defaultScript: UpstreamScript = { steps: simpleCompletion("A calm reply.") };

  fetch: typeof fetch = async (input, init) => {
    const signal = (init?.signal ?? null) as AbortSignal | null;
    const call: UpstreamCall = {
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)),
      signal,
      aborted: false,
      bodyCanceled: false
    };
    this.calls.push(call);
    signal?.addEventListener("abort", () => (call.aborted = true), { once: true });
    const script = this.scripts.shift() ?? this.defaultScript;

    if (script.networkError) throw new TypeError("fetch failed");
    if (script.hangBeforeHeaders) {
      await new Promise((_, reject) => {
        if (signal?.aborted) reject(signal.reason);
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    }

    if (script.status && script.status !== 200) {
      return new Response(JSON.stringify({ error: { message: "upstream said no" } }), {
        status: script.status,
        headers: script.headers
      });
    }

    const encoder = new TextEncoder();
    const steps = script.steps ?? [];
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        for (const step of steps) {
          if (signal?.aborted) break;
          if ("delayMs" in step) {
            await sleep(step.delayMs);
          } else if ("hang" in step) {
            await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve(), { once: true }));
            break;
          } else if ("raw" in step) {
            controller.enqueue(encoder.encode(step.raw));
          } else {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(step.frame)}\n\n`));
          }
        }
        try {
          controller.close();
        } catch {
          // already canceled
        }
      },
      cancel() {
        call.bodyCanceled = true;
      }
    });
    return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  };
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function usageBlock(prompt: number, completion: number) {
  return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion, completion_tokens_details: { reasoning_tokens: 5 } };
}

/** Groq-shaped stream: content deltas, finish with x_groq.usage, trailing usage chunk, [DONE]. */
export function simpleCompletion(
  text: string,
  options: { usage?: { prompt: number; completion: number }; usageShape?: "x_groq" | "top" | "none"; finish?: string } = {}
): UpstreamStep[] {
  const usage = usageBlock(options.usage?.prompt ?? 400, options.usage?.completion ?? 60);
  const shape = options.usageShape ?? "x_groq";
  const steps: UpstreamStep[] = [
    { frame: { id: "c1", choices: [{ index: 0, delta: { role: "assistant", reasoning: "thinking about it" }, finish_reason: null }] } }
  ];
  for (const piece of text.match(/.{1,40}/gsu) ?? []) {
    steps.push({ frame: { id: "c1", choices: [{ index: 0, delta: { content: piece, channel: "final" }, finish_reason: null }] } });
  }
  steps.push({
    frame: {
      id: "c1",
      choices: [{ index: 0, delta: {}, finish_reason: options.finish ?? "stop" }],
      ...(shape === "x_groq" ? { x_groq: { id: "req", usage } } : shape === "top" ? { usage } : {})
    }
  });
  if (shape !== "none") steps.push({ frame: { id: "c1", choices: [], usage } });
  steps.push({ raw: "data: [DONE]\n\n" });
  return steps;
}

// ---------------------------------------------------------------------------
// Harness.

export class Harness {
  clock = new Clock();
  namespace = new FakeNamespace(this.clock);
  groq = new FakeGroq();
  logs: Parameters<Logger>[0][] = [];
  env: AiProxyEnv;
  ip = "203.0.113.7";
  timeouts = { firstByteMs: 200, idleMs: 200, totalMs: 1_000 };

  constructor(overrides: Partial<AiProxyEnv> = {}) {
    this.env = baseEnv(this.namespace, overrides);
  }

  deps(): WorkerDeps {
    return {
      fetch: this.groq.fetch,
      now: this.clock.now,
      log: (event) => this.logs.push(event),
      timeouts: this.timeouts
    };
  }

  async request(request: Request) {
    const ctx = new WaitUntil();
    const response = await handleRequest(request, this.env, ctx, this.deps());
    return { response, ctx };
  }

  async install(options: { ip?: string; version?: string; refresh?: string; extra?: Record<string, unknown> } = {}) {
    const { response, ctx } = await this.request(
      new Request("https://proxy.test/v1/install", {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": options.ip ?? this.ip },
        body: JSON.stringify({ client: "iliad-md", version: options.version ?? "0.4.0", ...(options.refresh ? { refresh: options.refresh } : {}), ...options.extra })
      })
    );
    await ctx.settle();
    return response;
  }

  async token(ip?: string): Promise<string> {
    const response = await this.install({ ip });
    if (response.status !== 200) throw new Error(`install failed: ${response.status}`);
    return ((await response.json()) as { token: string }).token;
  }

  generateRequest(body: unknown, options: { token?: string; ip?: string | null; client?: string | null; signal?: AbortSignal; contentType?: string; rawBody?: string } = {}) {
    const headers: Record<string, string> = { "Content-Type": options.contentType ?? "application/json" };
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    if (options.ip !== null) headers["CF-Connecting-IP"] = options.ip ?? this.ip;
    if (options.client !== null) headers["X-Iliad-Client"] = options.client ?? "iliad-md/0.4.0";
    return new Request("https://proxy.test/v1/generate", {
      method: "POST",
      headers,
      body: options.rawBody ?? JSON.stringify(body),
      signal: options.signal
    });
  }

  async generate(body: unknown, options: Parameters<Harness["generateRequest"]>[1] = {}) {
    const { response, ctx } = await this.request(this.generateRequest(body, options));
    const text = await response.text();
    await ctx.settle();
    // A readable copy, so callers can inspect the body again.
    return { response: new Response(text, { status: response.status, headers: response.headers }), text, ctx };
  }

  async stats(day?: string) {
    const { response } = await this.request(
      new Request(`https://proxy.test/v1/admin/stats${day ? `?day=${day}` : ""}`, {
        headers: { Authorization: `Bearer ${this.env.ADMIN_TOKEN}` }
      })
    );
    return (await response.json()) as { stats: Record<string, unknown> & { counters: Record<string, number>; spentNano: number; reservedNano: number; requests: number; openReservations: number } };
  }
}

export function autocompleteTask(overrides: Record<string, unknown> = {}) {
  return {
    v: 1,
    task: "autocomplete",
    language: "en",
    kind: "sentence",
    extend: false,
    prefix: "The harbor was quiet that morning, and ",
    suffix: "",
    documentTitle: "Notes",
    headingPath: ["Chapter one"],
    nearbyHeadings: [],
    direction: "",
    avoid: [],
    ...overrides
  };
}

export function selectionTask(overrides: Record<string, unknown> = {}) {
  const text = "Before. It is really very important that we all take the steps. After.";
  return {
    v: 1,
    task: "selection",
    language: "en",
    mode: "tighten",
    text,
    selection: { from: 8, to: 64 },
    ...overrides
  };
}

/** Parses the proxy's SSE output into its frames. */
export function parseProxyStream(text: string): Array<Record<string, unknown> | "[DONE]"> {
  return text
    .split("\n\n")
    .filter((frame) => frame.startsWith("data: "))
    .map((frame) => frame.slice(6))
    .map((data) => (data === "[DONE]" ? "[DONE]" : (JSON.parse(data) as Record<string, unknown>)));
}

export function streamedContent(text: string): string {
  return parseProxyStream(text)
    .map((frame) => (frame === "[DONE]" ? "" : ((frame.choices as Array<{ delta?: { content?: string } }> | undefined)?.[0]?.delta?.content ?? "")))
    .join("");
}
