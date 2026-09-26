import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { structuredLog } from "../src/log.js";
import { autocompleteTask, Harness, selectionTask } from "./helpers.js";

// No document text in logs, errors or storage (spec §4 "No text at rest or in
// logs"): a unique marker goes into request bodies and fake upstream output,
// each stage is made to fail, and the marker must appear nowhere but in
// content the caller legitimately receives.

const MARKER = "ZQX-PRIVATE-MARKER-7f3a";
const SRC = path.resolve(__dirname, "../src");

describe("privacy", () => {
  const consoleCalls: unknown[][] = [];

  beforeEach(() => {
    consoleCalls.length = 0;
    for (const method of ["log", "error", "warn", "info", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        consoleCalls.push(args);
      });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function assertClean(harness: Harness, outputs: string[]) {
    const everything = [
      JSON.stringify(consoleCalls),
      JSON.stringify(harness.logs),
      ...outputs,
      ...[...harness.namespace.objects.values()].map((entry) => entry.storage.dump())
    ].join("\n");
    expect(everything).not.toContain(MARKER);
  }

  it("keeps the marker out of logs, errors and storage when every stage fails", async () => {
    const harness = new Harness({ INSTALL_DAILY_REQUESTS: "100" });
    // Route everything through the real structured logger too.
    const deps = harness.deps.bind(harness);
    harness.deps = () => ({ ...deps(), log: (event) => { harness.logs.push(event); structuredLog(event); } });
    const token = await harness.token();
    const outputs: string[] = [];
    const run = async (body: unknown, options: Parameters<Harness["generate"]>[1] = {}) => {
      const result = await harness.generate(body, { token, ...options });
      outputs.push(result.text, JSON.stringify([...result.response.headers]));
      return result;
    };

    // Body parse: malformed JSON quoting the marker (V8 messages quote input).
    await run(null, { rawBody: `{"prefix": "${MARKER}` });
    await run(null, { rawBody: `{"v":1,"task":"autocomplete","prefix":"${MARKER}"}}` });
    // Validation: over-long field, unknown field named and valued with the marker.
    await run(autocompleteTask({ prefix: `${MARKER}${"p".repeat(3000)}` }));
    await run(autocompleteTask({ [MARKER]: MARKER }));
    await run(selectionTask({ selection: { from: 0, to: 9999 }, text: MARKER }));
    // Token and headers carrying the marker.
    await run(autocompleteTask(), { token: `v1.${MARKER}.x.y` });
    await run(autocompleteTask(), { client: `iliad-md/${MARKER}` });
    await run(autocompleteTask(), { ip: MARKER });
    // Install body with the marker.
    const install = await harness.request(
      new Request("https://proxy.test/v1/install", {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": harness.ip },
        body: `{"client":"iliad-md","version":"0.4.0","refresh":"${MARKER}","x":"${MARKER}"}`
      })
    );
    outputs.push(await install.response.text());

    // Upstream SSE parse: malformed event and an oversized frame, both quoting the marker.
    harness.groq.scripts.push({ steps: [{ raw: `data: {"choices":[${MARKER}\n\n` }] });
    await run(autocompleteTask({ prefix: `Once ${MARKER} said` }));
    harness.groq.scripts.push({ steps: [{ raw: `data: ${JSON.stringify({ pad: MARKER.repeat(20_000) })}\n\n` }] });
    await run(autocompleteTask());
    // Upstream in-band error with the marker in its message.
    harness.groq.scripts.push({ steps: [{ frame: { error: { message: `bad input: ${MARKER}`, code: MARKER } } }] });
    await run(autocompleteTask());
    // Upstream HTTP error whose body quotes the prompt.
    harness.groq.scripts.push({ status: 400 });
    await run(autocompleteTask({ prefix: MARKER }));
    // Upstream fetch throwing an error that carries the marker.
    const originalFetch = harness.groq.fetch;
    harness.groq.fetch = async () => {
      throw new Error(`connect failed for ${MARKER}`);
    };
    await run(autocompleteTask({ prefix: MARKER }));
    harness.groq.fetch = originalFetch;

    assertClean(harness, outputs);
    // The structured logger did run.
    expect(consoleCalls.length).toBeGreaterThan(0);
    for (const call of consoleCalls) {
      expect(call).toHaveLength(1);
      expect(Object.keys(JSON.parse(String(call[0]))).every((key) => key === "code" || key === "status")).toBe(true);
    }
  });

  it("maps a throwing quota object to a code without leaking the error", async () => {
    const harness = new Harness();
    const token = await harness.token();
    harness.env.QUOTA = {
      idFromName: (name: string) => ({ toString: () => name }),
      get: () => ({
        fetch: async () => {
          throw new Error(`storage exploded near ${MARKER}`);
        }
      })
    };
    const result = await harness.generate(autocompleteTask({ prefix: MARKER }), { token });
    expect(result.response.status).toBe(502);
    assertClean(harness, [result.text]);
  });

  it("delivers upstream content to the caller but never stores or logs it", async () => {
    const harness = new Harness();
    const token = await harness.token();
    harness.groq.scripts.push({
      steps: [
        { frame: { choices: [{ index: 0, delta: { content: `visible ${MARKER}`, reasoning: `hidden ${MARKER}` } }] } },
        { frame: { choices: [{ index: 0, delta: {}, finish_reason: "stop" }], x_groq: { usage: { prompt_tokens: 5, completion_tokens: 5 } } } },
        { raw: "data: [DONE]\n\n" }
      ]
    });
    const result = await harness.generate(autocompleteTask({ prefix: MARKER }), { token });
    expect(result.text).toContain(`visible ${MARKER}`);
    expect(result.text).not.toContain(`hidden ${MARKER}`);
    assertClean(harness, []);
  });

  it("src/ calls console only through the structured logger", () => {
    const offenders: string[] = [];
    for (const file of fs.readdirSync(SRC)) {
      const source = fs.readFileSync(path.join(SRC, file), "utf8");
      const uses = source.split("\n").filter((line) => /\bconsole\./.test(line) && !line.trim().startsWith("//"));
      if (file === "log.ts") {
        expect(uses).toEqual(["  console.log(JSON.stringify(line));"]);
      } else if (uses.length) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
