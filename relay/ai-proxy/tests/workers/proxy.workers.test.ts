// Runs inside workerd (see vitest.workers.config.ts). Not part of root
// `npm test` (it imports `cloudflare:test`); run with
// `npm --prefix relay/ai-proxy run test:workers`.

import { env, runDurableObjectAlarm, runInDurableObject, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

type Env = { QUOTA: DurableObjectNamespace; ADMIN_TOKEN: string };
const testEnv = env as unknown as Env;

let ipCounter = 10;
const nextIp = () => `198.51.100.${ipCounter++}`;

async function install(ip = nextIp()): Promise<string> {
  const response = await SELF.fetch("https://proxy.test/v1/install", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
    body: JSON.stringify({ client: "iliad-md", version: "0.4.0" })
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { token: string }).token;
}

function task(prefix = "The lighthouse keeper opened the door and ") {
  return {
    v: 1, task: "autocomplete", language: "en", kind: "sentence", extend: false, prefix,
    suffix: "", documentTitle: "", headingPath: [], nearbyHeadings: [], direction: "", avoid: []
  };
}

function generate(token: string, body: unknown, ip = nextIp(), signal?: AbortSignal) {
  return SELF.fetch("https://proxy.test/v1/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "CF-Connecting-IP": ip,
      "X-Iliad-Client": "iliad-md/0.4.0"
    },
    body: JSON.stringify(body),
    signal
  });
}

async function stats() {
  const response = await SELF.fetch("https://proxy.test/v1/admin/stats", { headers: { Authorization: `Bearer ${testEnv.ADMIN_TOKEN}` } });
  const json = (await response.json()) as { stats: { requests?: number; spentNano?: number; reservedNano?: number; openReservations?: number; counters?: Record<string, number> } };
  return { requests: 0, spentNano: 0, reservedNano: 0, openReservations: 0, counters: {}, ...json.stats };
}

function todayStub() {
  const day = new Date().toISOString().slice(0, 10);
  return testEnv.QUOTA.get(testEnv.QUOTA.idFromName(`quota:${day}`));
}

async function until(check: () => Promise<boolean>, ms = 5_000) {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe("Iliad AI proxy in workerd", () => {
  it("serves healthz with no CORS headers", async () => {
    const response = await SELF.fetch("https://proxy.test/healthz", { headers: { Origin: "https://example.com" } });
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("streams content only and settles real usage in the SQLite day object", async () => {
    const before = await stats();
    const token = await install();
    const response = await generate(token, task());
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("Hello from ");
    expect(text).not.toContain("secret reasoning");
    expect(text).not.toContain("usage");
    expect(text.trim().endsWith("data: [DONE]")).toBe(true);
    await until(async () => (await stats()).openReservations === 0);
    const after = await stats();
    expect(after.requests - before.requests).toBe(1);
    expect(after.spentNano - before.spentNano).toBe(300 * 150 + 40 * 600);
  });

  it("concurrent requests never exceed the install limit (atomic reserve)", async () => {
    const token = await install();
    const responses = await Promise.all(Array.from({ length: 12 }, () => generate(token, task())));
    const statuses = responses.map((response) => response.status);
    await Promise.all(responses.map((response) => response.text()));
    expect(statuses.filter((status) => status === 200)).toHaveLength(5);
    expect(statuses.filter((status) => status === 429)).toHaveLength(7);
    const refused = await generate(token, task());
    expect(((await refused.json()) as { error: { code: string; resetAt: string } }).error).toMatchObject({
      code: "quota_exhausted",
      resetAt: expect.stringMatching(/T00:00:00\.000Z$/)
    });
  });

  it("refunds a request when Groq fails before the first byte", async () => {
    const token = await install();
    const before = await stats();
    const response = await generate(token, task("[[scenario:status500]] and then "));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: { code: "upstream_error" } });
    const after = await stats();
    expect(after.requests).toBe(before.requests);
    expect(after.counters.upstream_500 ?? 0).toBe((before.counters.upstream_500 ?? 0) + 1);
  });

  it("client abort propagates to the upstream fetch (enable_request_signal) and settles in full", async () => {
    await SELF.fetch("https://fake-groq.test/reset").catch(() => undefined);
    const token = await install();
    const before = await stats();
    const controller = new AbortController();
    const response = await generate(token, task("[[scenario:hang]] and then "), nextIp(), controller.signal);
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain("first words");
    controller.abort();
    await reader.cancel().catch(() => undefined);
    // The pump notices the abort, cancels upstream and settles via waitUntil.
    await until(async () => {
      const current = await stats();
      return current.openReservations === 0 && current.requests === before.requests + 1;
    });
    const after = await stats();
    expect(after.counters.settled_without_usage ?? 0).toBe((before.counters.settled_without_usage ?? 0) + 1);
    expect(after.spentNano - before.spentNano).toBeGreaterThan(300 * 150 + 40 * 600);
  });

  it("the alarm sweeps stale reservations at full and keeps one alarm", async () => {
    const stub = todayStub();
    // Make sure the day exists, then plant a stale reservation directly in SQLite.
    await install();
    await runInDurableObject(stub, async (_instance, state: DurableObjectState) => {
      state.storage.sql.exec(
        `INSERT INTO reservations (id, subject, netkey, nano, in_tokens, out_tokens, in_rate, out_rate, created)
         VALUES ('stale', 'inst_xxxxxxxxxxxxxxxxxxxxxx', 'n', 1000, 1, 1, 150, 600, ?)`,
        Date.now() - 10 * 60_000
      );
      state.storage.sql.exec("UPDATE global SET reserved_nano = reserved_nano + 1000 WHERE k = 1");
      await state.storage.setAlarm(Date.now() + 60_000);
    });
    const before = await stats();
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const after = await stats();
    expect(after.counters.swept ?? 0).toBe((before.counters.swept ?? 0) + 1);
    expect(after.reservedNano).toBe(before.reservedNano - 1000);
    const alarm = await runInDurableObject(stub, (_instance, state: DurableObjectState) => state.storage.getAlarm());
    expect(alarm).not.toBeNull();
    expect(alarm!).toBeGreaterThan(Date.now());
  });

  it("rejects unknown fields and unsupported versions before any upstream call", async () => {
    const token = await install();
    const unknown = await generate(token, { ...task(), guidance: "notes" });
    expect(unknown.status).toBe(400);
    const outdated = await generate(token, { ...task(), v: 9 });
    expect(outdated.status).toBe(426);
  });
});
