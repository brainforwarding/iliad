import { describe, expect, it } from "vitest";
import {
  AUTOCOMPLETE_MAX_AVOID_CHARS,
  AUTOCOMPLETE_MAX_DIRECTION_CHARS,
  AUTOCOMPLETE_MAX_HEADING_CHARS,
  AUTOCOMPLETE_MAX_PREFIX_CHARS,
  AUTOCOMPLETE_MAX_SENTENCE_OUTPUT_CHARS,
  AUTOCOMPLETE_MAX_SUFFIX_CHARS,
  AUTOCOMPLETE_MAX_TITLE_CHARS,
  GROQ_MODEL,
  TIGHTEN_MAX_INPUT_CHARS,
  TIGHTEN_MAX_INSTRUCTION_CHARS,
  buildWritingAiPrompt,
  parseWritingAiTask,
  promptUtf8Bytes
} from "../../../electron/writing/groq/prompts/index.js";
import { costNano } from "../src/quotaCore.js";
import { issueToken, parseSigningKeys } from "../src/tokens.js";
import {
  autocompleteTask,
  Harness,
  parseProxyStream,
  selectionTask,
  simpleCompletion,
  SIGNING_KEYS,
  streamedContent
} from "./helpers.js";

const DAY_MS = 86_400_000;

async function errorOf(response: Response) {
  return ((await response.clone().json()) as { error: { code: string; resetAt?: string; scope?: string } }).error;
}

function reservationFor(task: Record<string, unknown>) {
  const parsed = parseWritingAiTask(task);
  if (!parsed.ok) throw new Error("bad task");
  const prompt = buildWritingAiPrompt(parsed.task);
  return costNano(promptUtf8Bytes(prompt) + 150, prompt.maxCompletionTokens, 150, 600);
}

describe("routes", () => {
  it("serves healthz, 404s unknown paths, 405s wrong methods, and never sends CORS headers", async () => {
    const harness = new Harness();
    const health = await harness.request(new Request("https://proxy.test/healthz"));
    expect(await health.response.json()).toEqual({ ok: true });

    const responses = [
      health.response,
      (await harness.request(new Request("https://proxy.test/nope"))).response,
      (await harness.request(new Request("https://proxy.test/v1/generate"))).response,
      (await harness.request(new Request("https://proxy.test/v1/generate", { method: "OPTIONS", headers: { Origin: "https://evil.test" } }))).response,
      (await harness.request(new Request("https://proxy.test/v1/install", { method: "PUT" }))).response
    ];
    expect(responses.map((response) => response.status)).toEqual([200, 404, 405, 405, 405]);
    for (const response of responses) {
      for (const [name] of response.headers) expect(name.toLowerCase().startsWith("access-control-")).toBe(false);
    }
    // Successful responses carry no CORS headers either.
    const token = await harness.token();
    const ok = await harness.generate(autocompleteTask(), { token });
    expect(ok.response.status).toBe(200);
    expect([...ok.response.headers.keys()].some((name) => name.startsWith("access-control-"))).toBe(false);
  });

  it("fails closed (503 free_tier_disabled) on invalid config and on the kill switch", async () => {
    const broken = new Harness({ GLOBAL_DAILY_NANO_USD: "lots" });
    expect((await broken.install()).status).toBe(503);
    const off = new Harness({ FREE_TIER_ENABLED: "false" });
    const install = await off.install();
    expect(install.status).toBe(503);
    expect(await errorOf(install)).toEqual({ code: "free_tier_disabled" });
    const generated = await off.generate(autocompleteTask(), { token: "v1.k1.x.y" });
    expect(generated.response.status).toBe(503);
    expect(off.groq.calls).toHaveLength(0);
  });
});

describe("POST /v1/install", () => {
  it("issues a token and validates the request strictly", async () => {
    const harness = new Harness();
    const response = await harness.install();
    expect(response.status).toBe(200);
    const { token } = (await response.json()) as { token: string };
    expect(token).toMatch(/^v1\.k1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

    expect((await harness.install({ extra: { extra: 1 } })).status).toBe(400);
    expect((await harness.install({ extra: { client: "other" } })).status).toBe(400);
    expect((await harness.install({ version: "banana" })).status).toBe(400);
    const outdated = await harness.install({ version: "0.3.2" });
    expect(outdated.status).toBe(426);
    expect(await errorOf(outdated)).toEqual({ code: "client_outdated" });

    const noIp = await harness.request(
      new Request("https://proxy.test/v1/install", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client: "iliad-md", version: "0.4.0" }) })
    );
    expect(noIp.response.status).toBe(400);
    const wrongType = await harness.request(
      new Request("https://proxy.test/v1/install", { method: "POST", headers: { "Content-Type": "text/plain", "CF-Connecting-IP": "1.2.3.4" }, body: JSON.stringify({ client: "iliad-md", version: "0.4.0" }) })
    );
    expect(wrongType.response.status).toBe(400);
  });

  it("limits new tokens per network (429 install_limited with resetAt)", async () => {
    const harness = new Harness();
    for (let index = 0; index < 5; index += 1) expect((await harness.install()).status).toBe(200);
    const refused = await harness.install();
    expect(refused.status).toBe(429);
    expect(await errorOf(refused)).toEqual({ code: "install_limited", resetAt: "2026-09-26T00:00:00.000Z" });
    // IPv4 leading zeros are the same network.
    expect((await harness.install({ ip: "203.000.113.007" })).status).toBe(429);
    expect((await harness.install({ ip: "203.0.113.8" })).status).toBe(200);
  });

  it("limits new tokens per IPv6 /48 across many /64s", async () => {
    const harness = new Harness();
    for (let index = 0; index < 20; index += 1) {
      expect((await harness.install({ ip: `2001:db8:77:${index.toString(16)}::1` })).status).toBe(200);
    }
    expect((await harness.install({ ip: "2001:db8:77:ff::1" })).status).toBe(429);
    expect((await harness.install({ ip: "2001:db8:78:1::1" })).status).toBe(200);
  });

  it("refreshes an expired token within the window with the same sub, uncounted", async () => {
    const harness = new Harness({ IP_DAILY_NEW_INSTALLS: "1" });
    const token = await harness.token();
    const sub = JSON.parse(atob(token.split(".")[2].replaceAll("-", "+").replaceAll("_", "/"))).sub;

    harness.clock.advance(31 * DAY_MS);
    const task = autocompleteTask();
    const expired = await harness.generate(task, { token });
    expect(expired.response.status).toBe(401);
    expect(await errorOf(expired.response)).toEqual({ code: "token_expired" });

    const refreshed = await harness.install({ refresh: token });
    expect(refreshed.status).toBe(200);
    const fresh = ((await refreshed.json()) as { token: string }).token;
    expect(JSON.parse(atob(fresh.split(".")[2].replaceAll("-", "+").replaceAll("_", "/"))).sub).toBe(sub);
    // Not counted: a second, non-refresh install on this network still fits the limit of 1.
    expect((await harness.install()).status).toBe(200);
    expect((await harness.generate(task, { token: fresh })).response.status).toBe(200);
  });

  it("issues a new, counted sub when the refresh token is too old or invalid", async () => {
    const harness = new Harness({ IP_DAILY_NEW_INSTALLS: "5" });
    const token = await harness.token();
    const sub = JSON.parse(atob(token.split(".")[2].replaceAll("-", "+").replaceAll("_", "/"))).sub;
    harness.clock.advance((30 + 60) * DAY_MS + 1000);
    const response = await harness.install({ refresh: token });
    const fresh = ((await response.json()) as { token: string }).token;
    expect(JSON.parse(atob(fresh.split(".")[2].replaceAll("-", "+").replaceAll("_", "/"))).sub).not.toBe(sub);
    const garbage = await harness.install({ refresh: "v1.k1.bad.bad" });
    expect(garbage.status).toBe(200);
    const stats = await harness.stats();
    expect(stats.stats.installsIssued).toBe(2);
  });
});

describe("POST /v1/generate", () => {
  it("streams content only, pins model and params, and settles at actual usage", async () => {
    const harness = new Harness();
    const token = await harness.token();
    harness.groq.scripts.push({ steps: simpleCompletion("the gulls had gone inland.", { usage: { prompt: 420, completion: 90 } }) });
    const task = autocompleteTask();
    const { response, text } = await harness.generate(task, { token });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(streamedContent(text)).toBe("the gulls had gone inland.");
    expect(text).not.toContain("thinking about it");
    expect(text).not.toContain("usage");
    expect(text).not.toContain("channel");
    expect(text).not.toContain("x_groq");
    const frames = parseProxyStream(text);
    expect(frames.at(-1)).toBe("[DONE]");
    expect(frames.at(-2)).toEqual({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });

    const call = harness.groq.calls[0];
    expect(call.url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(call.headers.get("authorization")).toBe("Bearer gsk_test_key");
    const parsed = parseWritingAiTask(task);
    if (!parsed.ok) throw new Error("task");
    const prompt = buildWritingAiPrompt(parsed.task);
    expect(call.body).toEqual({
      model: GROQ_MODEL,
      reasoning_effort: "low",
      include_reasoning: false,
      stream: true,
      stream_options: { include_usage: true },
      n: 1,
      messages: prompt.messages,
      max_completion_tokens: 768
    });

    const stats = await harness.stats();
    expect(stats.stats).toMatchObject({ requests: 1, spentNano: 420 * 150 + 90 * 600, reservedNano: 0, openReservations: 0 });
  });

  it("handles top-level usage and ✦ AI selection tasks in EN and ES", async () => {
    const harness = new Harness();
    const token = await harness.token();
    harness.groq.scripts.push({ steps: simpleCompletion("We must act now.", { usageShape: "top", usage: { prompt: 300, completion: 40 } }) });
    const tighten = await harness.generate(selectionTask(), { token });
    expect(streamedContent(tighten.text)).toBe("We must act now.");
    harness.groq.scripts.push({ steps: simpleCompletion("Debemos actuar ya.", { usage: { prompt: 300, completion: 40 } }) });
    const edit = await harness.generate(selectionTask({ language: "es", mode: "edit", instruction: "Más directo." }), { token });
    expect(streamedContent(edit.text)).toBe("Debemos actuar ya.");
    expect((await harness.stats()).stats.spentNano).toBe(2 * (300 * 150 + 40 * 600));
  });

  it("forwards a selection output between 8,001 and 12,000 chars (cap = task maxOutputChars)", async () => {
    const harness = new Harness();
    const token = await harness.token();
    const text = "x".repeat(TIGHTEN_MAX_INPUT_CHARS);
    const long = "y".repeat(11_000);
    harness.groq.scripts.push({ steps: simpleCompletion(long, { usage: { prompt: 1500, completion: 3000 } }) });
    const { text: out } = await harness.generate(selectionTask({ mode: "edit", instruction: "Expand.", text, selection: { from: 0, to: text.length } }), { token });
    expect(streamedContent(out)).toBe(long);
    expect(parseProxyStream(out).at(-2)).toMatchObject({ choices: [{ finish_reason: "stop" }] });
  });

  it("caps forwarded output: aborts upstream, ends with length, charges the full reservation", async () => {
    const harness = new Harness();
    const token = await harness.token();
    harness.groq.scripts.push({ steps: [...simpleCompletion("z".repeat(AUTOCOMPLETE_MAX_SENTENCE_OUTPUT_CHARS + 100)).slice(0, -2), { hang: true }] });
    const task = autocompleteTask();
    const { text } = await harness.generate(task, { token });
    expect(streamedContent(text)).toHaveLength(AUTOCOMPLETE_MAX_SENTENCE_OUTPUT_CHARS);
    const frames = parseProxyStream(text);
    expect(frames.at(-2)).toEqual({ choices: [{ index: 0, delta: {}, finish_reason: "length" }] });
    expect(frames.at(-1)).toBe("[DONE]");
    expect(harness.groq.calls[0].aborted).toBe(true);
    expect((await harness.stats()).stats.spentNano).toBe(reservationFor(task));
  });

  describe("validation", () => {
    const limits: Array<[string, (n: number) => Record<string, unknown>, number]> = [
      ["prefix", (n) => autocompleteTask({ prefix: "p".repeat(n) }), AUTOCOMPLETE_MAX_PREFIX_CHARS],
      ["suffix", (n) => autocompleteTask({ suffix: "s".repeat(n) }), AUTOCOMPLETE_MAX_SUFFIX_CHARS],
      ["documentTitle", (n) => autocompleteTask({ documentTitle: "t".repeat(n) }), AUTOCOMPLETE_MAX_TITLE_CHARS],
      ["headingPath count", (n) => autocompleteTask({ headingPath: Array.from({ length: n }, () => "h") }), 8],
      ["heading length", (n) => autocompleteTask({ nearbyHeadings: ["h".repeat(n)] }), AUTOCOMPLETE_MAX_HEADING_CHARS],
      ["direction", (n) => autocompleteTask({ direction: "d".repeat(n) }), AUTOCOMPLETE_MAX_DIRECTION_CHARS],
      ["avoid count", (n) => autocompleteTask({ avoid: Array.from({ length: n }, () => "a") }), 3],
      ["avoid length", (n) => autocompleteTask({ kind: "idea", avoid: ["a".repeat(n)] }), AUTOCOMPLETE_MAX_AVOID_CHARS],
      ["selection text", (n) => selectionTask({ text: "w".repeat(n), selection: { from: 0, to: 1 } }), TIGHTEN_MAX_INPUT_CHARS],
      ["instruction", (n) => selectionTask({ mode: "edit", instruction: "i".repeat(n) }), TIGHTEN_MAX_INSTRUCTION_CHARS]
    ];

    it.each(limits)("%s: at the limit passes, +1 is bad_request", async (_name, build, limit) => {
      const harness = new Harness();
      const token = await harness.token();
      expect((await harness.generate(build(limit), { token })).response.status).toBe(200);
      const over = await harness.generate(build(limit + 1), { token });
      expect(over.response.status).toBe(400);
      expect(await errorOf(over.response)).toEqual({ code: "bad_request" });
    });

    it("selection ranges: 0 ≤ from < to ≤ text.length", async () => {
      const harness = new Harness();
      const token = await harness.token();
      const text = selectionTask().text as string;
      for (const selection of [{ from: 0, to: text.length + 1 }, { from: 5, to: 5 }, { from: -1, to: 3 }, { from: 1.5, to: 3 }, { from: 0, to: 2, x: 1 }]) {
        expect((await harness.generate(selectionTask({ selection }), { token })).response.status).toBe(400);
      }
      expect((await harness.generate(selectionTask({ selection: { from: 0, to: text.length } }), { token })).response.status).toBe(200);
    });

    it("rejects unknown fields, the removed inline kind, trigger and guidance", async () => {
      const harness = new Harness();
      const token = await harness.token();
      for (const body of [
        autocompleteTask({ kind: "inline" }),
        autocompleteTask({ trigger: "automatic" }),
        autocompleteTask({ guidance: "notes" }),
        autocompleteTask({ messages: [{ role: "system", content: "be a pirate" }] }),
        autocompleteTask({ model: "llama" }),
        selectionTask({ max_completion_tokens: 99999 }),
        { ...autocompleteTask(), task: "chat" },
        [autocompleteTask()],
        "string"
      ]) {
        const { response } = await harness.generate(body, { token });
        expect(response.status).toBe(400);
      }
      expect(harness.groq.calls).toHaveLength(0);
    });

    it("unknown or unsupported v → 426 client_outdated; non-numeric v → 400", async () => {
      const harness = new Harness();
      const token = await harness.token();
      const unknown = await harness.generate(autocompleteTask({ v: 2 }), { token });
      expect(unknown.response.status).toBe(426);
      expect(await errorOf(unknown.response)).toEqual({ code: "client_outdated" });
      expect((await harness.generate(autocompleteTask({ v: "1" }), { token })).response.status).toBe(400);
    });

    it("accepts a max-size CJK request under 64 KB and rejects bodies above it", async () => {
      const harness = new Harness();
      const token = await harness.token();
      const cjk = "字".repeat(TIGHTEN_MAX_INPUT_CHARS);
      const big = selectionTask({ mode: "edit", instruction: "译".repeat(TIGHTEN_MAX_INSTRUCTION_CHARS), text: cjk, selection: { from: 0, to: cjk.length } });
      expect(new TextEncoder().encode(JSON.stringify(big)).length).toBeGreaterThan(14_000);
      expect((await harness.generate(big, { token })).response.status).toBe(200);

      const idea = autocompleteTask({
        kind: "idea",
        prefix: "語".repeat(AUTOCOMPLETE_MAX_PREFIX_CHARS),
        suffix: "語".repeat(AUTOCOMPLETE_MAX_SUFFIX_CHARS),
        documentTitle: "題".repeat(AUTOCOMPLETE_MAX_TITLE_CHARS),
        headingPath: Array.from({ length: 8 }, () => "見".repeat(120)),
        nearbyHeadings: Array.from({ length: 8 }, () => "見".repeat(120)),
        direction: "向".repeat(240),
        avoid: Array.from({ length: 3 }, () => "避".repeat(AUTOCOMPLETE_MAX_AVOID_CHARS))
      });
      const bytes = new TextEncoder().encode(JSON.stringify(idea)).length;
      expect(bytes).toBeLessThanOrEqual(64 * 1024);
      expect((await harness.generate(idea, { token })).response.status).toBe(200);

      const oversized = await harness.generate(null, { token, rawBody: JSON.stringify({ pad: "x".repeat(64 * 1024) }) });
      expect(oversized.response.status).toBe(413);
      expect(await errorOf(oversized.response)).toEqual({ code: "too_large" });
    });

    it("rejects wrong content types, malformed JSON and invalid UTF-8", async () => {
      const harness = new Harness();
      const token = await harness.token();
      expect((await harness.generate(autocompleteTask(), { token, contentType: "text/plain" })).response.status).toBe(400);
      expect((await harness.generate(null, { token, rawBody: "{not json" })).response.status).toBe(400);
      const invalidUtf8 = await harness.request(
        new Request("https://proxy.test/v1/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "CF-Connecting-IP": harness.ip, "X-Iliad-Client": "iliad-md/0.4.0" },
          body: new Uint8Array([0x7b, 0xff, 0x7d])
        })
      );
      expect(invalidUtf8.response.status).toBe(400);
    });

    it("requires CF-Connecting-IP, the client header, a current client, and a valid token", async () => {
      const harness = new Harness({ DENY_SUBJECTS: "" });
      const token = await harness.token();
      const cases: Array<[Parameters<Harness["generate"]>[1], number, string]> = [
        [{ token, ip: null }, 400, "bad_request"],
        [{ token, ip: "not-an-ip" }, 400, "bad_request"],
        [{ token, client: null }, 400, "bad_request"],
        [{ token, client: "iliad-md/0.3.9" }, 426, "client_outdated"],
        [{}, 401, "invalid_token"],
        [{ token: `${token}x` }, 401, "invalid_token"]
      ];
      for (const [options, status, code] of cases) {
        const { response } = await harness.generate(autocompleteTask(), options);
        expect(response.status).toBe(status);
        expect((await errorOf(response)).code).toBe(code);
      }
    });

    it("DENY_SUBJECTS revokes a sub", async () => {
      const harness = new Harness();
      const token = await harness.token();
      const sub = JSON.parse(atob(token.split(".")[2].replaceAll("-", "+").replaceAll("_", "/"))).sub;
      harness.env.DENY_SUBJECTS = sub;
      const { response } = await harness.generate(autocompleteTask(), { token });
      expect(response.status).toBe(401);
      expect(await errorOf(response)).toEqual({ code: "invalid_token" });
    });
  });

  describe("quotas", () => {
    it("per install: quota_exhausted with resetAt, no Groq call", async () => {
      const harness = new Harness({ INSTALL_DAILY_REQUESTS: "3" });
      const token = await harness.token();
      for (let index = 0; index < 3; index += 1) expect((await harness.generate(autocompleteTask(), { token })).response.status).toBe(200);
      const { response } = await harness.generate(autocompleteTask(), { token });
      expect(response.status).toBe(429);
      expect(await errorOf(response)).toEqual({ code: "quota_exhausted", scope: "install", resetAt: "2026-09-26T00:00:00.000Z" });
      expect(harness.groq.calls).toHaveLength(3);
    });

    it("per network: two installs on one IP share the network quota; another /64 does not", async () => {
      const harness = new Harness({ IP_DAILY_REQUESTS: "2" });
      const a = await harness.token();
      const b = await harness.token();
      expect((await harness.generate(autocompleteTask(), { token: a })).response.status).toBe(200);
      expect((await harness.generate(autocompleteTask(), { token: b })).response.status).toBe(200);
      const refused = await harness.generate(autocompleteTask(), { token: b });
      expect(await errorOf(refused.response)).toMatchObject({ code: "quota_exhausted", scope: "network" });
      expect((await harness.generate(autocompleteTask(), { token: b, ip: "198.51.100.1" })).response.status).toBe(200);
    });

    it("global cap: global_cap with resetAt once the worst case no longer fits", async () => {
      const task = autocompleteTask();
      const harness = new Harness({ GLOBAL_DAILY_NANO_USD: String(reservationFor(task) + 1) });
      const token = await harness.token();
      harness.groq.scripts.push({ steps: simpleCompletion("ok", { usageShape: "none" }) });
      expect((await harness.generate(task, { token })).response.status).toBe(200);
      const { response } = await harness.generate(task, { token });
      expect(response.status).toBe(429);
      expect(await errorOf(response)).toEqual({ code: "global_cap", resetAt: "2026-09-26T00:00:00.000Z" });
    });

    it("a config tightening applies on the next request and sticks for the day", async () => {
      const harness = new Harness();
      const token = await harness.token();
      expect((await harness.generate(autocompleteTask(), { token })).response.status).toBe(200);
      harness.env.INSTALL_DAILY_REQUESTS = "1";
      expect((await harness.generate(autocompleteTask(), { token })).response.status).toBe(429);
      harness.env.INSTALL_DAILY_REQUESTS = "50";
      expect((await harness.generate(autocompleteTask(), { token })).response.status).toBe(429);
      harness.clock.value = Date.parse("2026-09-26T00:00:00Z");
      expect((await harness.generate(autocompleteTask(), { token })).response.status).toBe(200);
    });

    it("UTC rollover: 23:59:59.999 and 00:00 use different day objects; a straddling request settles into its own day", async () => {
      const harness = new Harness({ INSTALL_DAILY_REQUESTS: "1" });
      const token = await harness.token();
      harness.clock.value = Date.parse("2026-09-25T23:59:59.999Z");
      harness.groq.scripts.push({
        steps: [
          { frame: { choices: [{ index: 0, delta: { content: "late" }, finish_reason: null }] } },
          { delayMs: 20 },
          { frame: { choices: [{ index: 0, delta: {}, finish_reason: "stop" }], x_groq: { usage: { prompt_tokens: 10, completion_tokens: 5 } } } },
          { raw: "data: [DONE]\n\n" }
        ]
      });
      const pending = harness.request(harness.generateRequest(autocompleteTask(), { token }));
      const { response, ctx } = await pending;
      harness.clock.value = Date.parse("2026-09-26T00:00:00.000Z");
      await response.text();
      await ctx.settle();
      const day25 = harness.namespace.day("2026-09-25").storage.dump();
      expect(day25).toContain(`"spent_nano":${10 * 150 + 5 * 600}`);
      expect((await harness.generate(autocompleteTask(), { token })).response.status).toBe(200);
      expect(harness.namespace.objects.has("quota:2026-09-26")).toBe(true);
      const refused = await harness.generate(autocompleteTask(), { token });
      expect(await errorOf(refused.response)).toMatchObject({ resetAt: "2026-09-27T00:00:00.000Z" });
    });

    it("passes the configured location hint to the day object", async () => {
      const harness = new Harness({ QUOTA_LOCATION_HINT: "enam" });
      await harness.token();
      expect(harness.namespace.locationHints).toContain("enam");
    });
  });

  describe("upstream failures", () => {
    it.each([
      [401, 502, "upstream_error"],
      [403, 502, "upstream_error"],
      [500, 502, "upstream_error"],
      [404, 502, "upstream_error"]
    ])("Groq %s before the first byte → %s %s, request and reservation refunded", async (status, proxyStatus, code) => {
      const harness = new Harness({ INSTALL_DAILY_REQUESTS: "1" });
      const token = await harness.token();
      harness.groq.scripts.push({ status });
      const { response } = await harness.generate(autocompleteTask(), { token });
      expect(response.status).toBe(proxyStatus);
      expect(await errorOf(response)).toEqual({ code });
      expect(await response.text()).not.toContain("upstream said no");
      const stats = await harness.stats();
      expect(stats.stats).toMatchObject({ requests: 0, reservedNano: 0, spentNano: 0 });
      expect(stats.stats.counters[`upstream_${status}`]).toBe(1);
      // The refunded request did not use up the quota of 1.
      expect((await harness.generate(autocompleteTask(), { token })).response.status).toBe(200);
      if (status === 401) expect(harness.logs).toContainEqual({ code: "upstream_status", status: 401 });
    });

    it("Groq 429 → 503 upstream_busy with Retry-After passthrough capped at 60 s", async () => {
      const harness = new Harness();
      const token = await harness.token();
      harness.groq.scripts.push({ status: 429, headers: { "Retry-After": "7" } });
      const busy = await harness.generate(autocompleteTask(), { token });
      expect(busy.response.status).toBe(503);
      expect(busy.response.headers.get("retry-after")).toBe("7");
      expect(await errorOf(busy.response)).toEqual({ code: "upstream_busy" });
      harness.groq.scripts.push({ status: 429, headers: { "Retry-After": "3600" } });
      expect((await harness.generate(autocompleteTask(), { token })).response.headers.get("retry-after")).toBe("60");
      expect((await harness.stats()).stats.requests).toBe(0);
    });

    it("network failure before the first byte → 502, refunded", async () => {
      const harness = new Harness();
      const token = await harness.token();
      harness.groq.scripts.push({ networkError: true });
      const { response } = await harness.generate(autocompleteTask(), { token });
      expect(response.status).toBe(502);
      expect((await harness.stats()).stats).toMatchObject({ requests: 0, spentNano: 0 });
    });

    it("no first byte in time → 504 upstream_timeout, settled at the full reservation", async () => {
      const harness = new Harness();
      const token = await harness.token();
      harness.groq.scripts.push({ hangBeforeHeaders: true });
      const task = autocompleteTask();
      const { response } = await harness.generate(task, { token });
      expect(response.status).toBe(504);
      expect(await errorOf(response)).toEqual({ code: "upstream_timeout" });
      expect(harness.groq.calls[0].aborted).toBe(true);
      expect((await harness.stats()).stats).toMatchObject({ requests: 1, spentNano: reservationFor(task), reservedNano: 0 });
    });

    it("in-band upstream error mid-stream → in-band upstream_error, full charge", async () => {
      const harness = new Harness();
      const token = await harness.token();
      harness.groq.scripts.push({
        steps: [
          { frame: { choices: [{ index: 0, delta: { content: "partial" }, finish_reason: null }] } },
          { frame: { error: { message: "Groq exploded", type: "server_error" } } }
        ]
      });
      const task = autocompleteTask();
      const { text } = await harness.generate(task, { token });
      const frames = parseProxyStream(text);
      expect(frames.at(-1)).toEqual({ error: { code: "upstream_error" } });
      expect(text).not.toContain("exploded");
      expect((await harness.stats()).stats.spentNano).toBe(reservationFor(task));
    });

    it("idle timeout → in-band upstream_timeout; total timeout too", async () => {
      const harness = new Harness();
      const token = await harness.token();
      harness.groq.scripts.push({ steps: [{ frame: { choices: [{ index: 0, delta: { content: "a" } }] } }, { hang: true }] });
      const idle = await harness.generate(autocompleteTask(), { token });
      expect(parseProxyStream(idle.text).at(-1)).toEqual({ error: { code: "upstream_timeout" } });
      expect(harness.groq.calls[0].aborted).toBe(true);

      harness.timeouts = { firstByteMs: 500, idleMs: 100, totalMs: 250 };
      harness.clock = harness.clock; // same clock; total uses deps.now
      const steps = [];
      for (let index = 0; index < 20; index += 1) {
        steps.push({ frame: { choices: [{ index: 0, delta: { content: "b" } }] } }, { delayMs: 30 });
      }
      harness.groq.scripts.push({ steps });
      const realNow = Date.now;
      const start = realNow();
      harness.clock.now = () => Date.parse("2026-09-25T12:00:00Z") + (realNow() - start);
      const total = await harness.generate(autocompleteTask(), { token });
      expect(parseProxyStream(total.text).at(-1)).toEqual({ error: { code: "upstream_timeout" } });
      expect(harness.groq.calls[1].aborted).toBe(true);
    });

    it("client abort mid-stream aborts the upstream fetch and still settles (waitUntil)", async () => {
      const harness = new Harness();
      harness.timeouts = { firstByteMs: 2000, idleMs: 2000, totalMs: 5000 };
      const token = await harness.token();
      harness.groq.scripts.push({ steps: [{ frame: { choices: [{ index: 0, delta: { content: "start" } }] } }, { hang: true }] });
      const controller = new AbortController();
      const task = autocompleteTask();
      const { response, ctx } = await harness.request(harness.generateRequest(task, { token, signal: controller.signal }));
      const reader = response.body!.getReader();
      const first = await reader.read();
      expect(new TextDecoder().decode(first.value)).toContain("start");
      controller.abort();
      await reader.cancel().catch(() => undefined);
      await ctx.settle();
      expect(harness.groq.calls[0].aborted).toBe(true);
      expect(ctx.promises).toHaveLength(1);
      expect((await harness.stats()).stats).toMatchObject({ spentNano: reservationFor(task), reservedNano: 0 });
    });
  });

  describe("admin stats", () => {
    it("requires the admin token and serves aggregates only", async () => {
      const harness = new Harness();
      const token = await harness.token();
      await harness.generate(autocompleteTask(), { token });
      const denied = await harness.request(new Request("https://proxy.test/v1/admin/stats", { headers: { Authorization: "Bearer nope" } }));
      expect(denied.response.status).toBe(401);
      const stats = await harness.stats("2026-09-25");
      expect(stats.stats).toMatchObject({ requests: 1, installsIssued: 1, distinctSubjects: 1 });
      expect(JSON.stringify(stats)).not.toContain("inst_");
      const tooOld = await harness.request(
        new Request("https://proxy.test/v1/admin/stats?day=2026-09-20", { headers: { Authorization: `Bearer ${harness.env.ADMIN_TOKEN}` } })
      );
      expect(tooOld.response.status).toBe(400);
      expect(harness.namespace.objects.has("quota:2026-09-20")).toBe(false);
      const noAdmin = new Harness({ ADMIN_TOKEN: undefined });
      expect((await noAdmin.request(new Request("https://proxy.test/v1/admin/stats"))).response.status).toBe(404);
    });
  });

  it("tokens signed with a rotated-out kid are rejected; a verify-only kid still works", async () => {
    const harness = new Harness();
    const old = parseSigningKeys(SIGNING_KEYS)!;
    const token = await issueToken(old, { sub: "inst_AAAAAAAAAAAAAAAAAAAAAA", nowMs: harness.clock.now(), ttlDays: 30 });
    const oldKey = JSON.parse(SIGNING_KEYS).k1.key;
    const newKey = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
    harness.env.TOKEN_SIGNING_KEYS = JSON.stringify({ k2: { key: newKey, signs: true }, k1: { key: oldKey, signs: false, verifiesUntil: "2026-10-01T00:00:00Z" } });
    expect((await harness.generate(autocompleteTask(), { token })).response.status).toBe(200);
    const fresh = await harness.token();
    expect(fresh.startsWith("v1.k2.")).toBe(true);
    harness.env.TOKEN_SIGNING_KEYS = JSON.stringify({ k2: { key: newKey, signs: true } });
    expect((await harness.generate(autocompleteTask(), { token })).response.status).toBe(401);
    expect((await harness.generate(autocompleteTask(), { token: fresh })).response.status).toBe(200);
  });

  it("the burst rate limiter refuses with 429 rate_limited and Retry-After", async () => {
    const harness = new Harness();
    let calls = 0;
    harness.env.INSTALL_RATE_LIMITER = { limit: async () => ({ success: ++calls <= 3 }) };
    for (let index = 0; index < 3; index += 1) expect((await harness.install()).status).toBe(200);
    const limited = await harness.install();
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    expect(await errorOf(limited)).toEqual({ code: "rate_limited" });
  });
});
