import { describe, expect, it } from "vitest";
import { utf8ByteLength } from "../../../electron/writing/groq/prompts/index.js";
import type { QuotaPolicy } from "../src/config.js";
import { dayStartMs } from "../src/errors.js";
import { costNano, QuotaCore, RESERVATION_MAX_AGE_MS, RETENTION_MS, SWEEP_INTERVAL_MS, type ReserveInput } from "../src/quotaCore.js";
import { QuotaClient, QuotaDayObject } from "../src/quotaObject.js";
import { Clock, FakeNamespace, SqliteStorage } from "./helpers.js";

const DAY = "2026-09-25";
const NOW = Date.parse(`${DAY}T12:00:00Z`);

const POLICY: QuotaPolicy = {
  capNano: 5_000_000_000,
  inRate: 150,
  outRate: 600,
  installLimit: 50,
  ipLimit: 150,
  ipNewInstalls: 5,
  ip48NewInstalls: 20
};

let seq = 0;
function reserveInput(overrides: Partial<ReserveInput> = {}): ReserveInput {
  seq += 1;
  return {
    day: DAY,
    id: `r${seq}`,
    subject: "inst_aaaaaaaaaaaaaaaaaaaaaa",
    netkey: "net-a",
    inTokens: 1000,
    outTokens: 768,
    policy: POLICY,
    nowMs: NOW,
    ...overrides
  };
}

function core() {
  const storage = new SqliteStorage();
  return { core: new QuotaCore(storage), storage };
}

describe("quota core", () => {
  it("enforces the install limit at 49/50/51", () => {
    const { core: quota } = core();
    for (let index = 0; index < 49; index += 1) expect(quota.reserve(reserveInput()).ok).toBe(true);
    expect(quota.reserve(reserveInput()).ok).toBe(true); // 50th
    expect(quota.reserve(reserveInput())).toEqual({ ok: false, code: "quota_exhausted", scope: "install" }); // 51st
    // Another install on another network is unaffected.
    expect(quota.reserve(reserveInput({ subject: "inst_bbbbbbbbbbbbbbbbbbbbbb", netkey: "net-b" })).ok).toBe(true);
  });

  it("enforces the network limit across installs", () => {
    const { core: quota } = core();
    const policy = { ...POLICY, ipLimit: 3 };
    expect(quota.reserve(reserveInput({ policy, subject: "inst_1111111111111111111111" })).ok).toBe(true);
    expect(quota.reserve(reserveInput({ policy, subject: "inst_2222222222222222222222" })).ok).toBe(true);
    expect(quota.reserve(reserveInput({ policy, subject: "inst_3333333333333333333333" })).ok).toBe(true);
    expect(quota.reserve(reserveInput({ policy, subject: "inst_4444444444444444444444" }))).toEqual({
      ok: false,
      code: "quota_exhausted",
      scope: "network"
    });
    expect(quota.reserve(reserveInput({ policy, subject: "inst_4444444444444444444444", netkey: "net-z" })).ok).toBe(true);
  });

  it("books the worst case, refuses past the cap, and releases on settle with usage", () => {
    const { core: quota } = core();
    const nano = costNano(1000, 768, 150, 600); // 610,800
    const policy = { ...POLICY, capNano: nano * 2 + 10 };
    const a = reserveInput({ policy });
    const b = reserveInput({ policy });
    expect(quota.reserve(a)).toEqual({ ok: true, nano });
    expect(quota.reserve(b)).toEqual({ ok: true, nano });
    expect(quota.reserve(reserveInput({ policy }))).toEqual({ ok: false, code: "global_cap" });

    const settled = quota.settle({ day: DAY, id: a.id, usage: { promptTokens: 400, completionTokens: 60 } });
    expect(settled).toEqual({ settled: true, chargedNano: 400 * 150 + 60 * 600, releasedNano: nano - 96_000 });
    expect(quota.stats()).toMatchObject({ spentNano: 96_000, reservedNano: nano, requests: 2 });
    // Worst case still does not fit (96,000 spent + one open reservation + one more > cap)…
    expect(quota.reserve(reserveInput({ policy })).ok).toBe(false);
    // …until the second settle releases its room too.
    quota.settle({ day: DAY, id: b.id, usage: { promptTokens: 400, completionTokens: 60 } });
    expect(quota.reserve(reserveInput({ policy })).ok).toBe(true);
  });

  it("settles aborts and missing usage at the full reservation", () => {
    const { core: quota } = core();
    const input = reserveInput();
    const reserved = quota.reserve(input);
    expect(reserved.ok).toBe(true);
    const result = quota.settle({ day: DAY, id: input.id, usage: null });
    expect(result).toEqual({ settled: true, chargedNano: costNano(1000, 768, 150, 600), releasedNano: 0 });
    // Settling twice is a no-op.
    expect(quota.settle({ day: DAY, id: input.id, usage: null })).toEqual({ settled: false });
    expect(quota.stats()).toMatchObject({ requests: 1, reservedNano: 0, openReservations: 0 });
  });

  it("refunds count and reservation when upstream fails before the first byte", () => {
    const { core: quota } = core();
    const policy = { ...POLICY, installLimit: 1 };
    const input = reserveInput({ policy });
    expect(quota.reserve(input).ok).toBe(true);
    expect(quota.reserve(reserveInput({ policy })).ok).toBe(false);
    expect(quota.refund({ day: DAY, id: input.id, reason: "upstream_500" })).toBe(true);
    expect(quota.stats()).toMatchObject({ requests: 0, reservedNano: 0, spentNano: 0 });
    expect(quota.stats().counters.upstream_500).toBe(1);
    expect(quota.reserve(reserveInput({ policy })).ok).toBe(true);
  });

  it("counts usage above the reservation (a broken premise) and books it", () => {
    const { core: quota } = core();
    const input = reserveInput({ inTokens: 10, outTokens: 10 });
    quota.reserve(input);
    const result = quota.settle({ day: DAY, id: input.id, usage: { promptTokens: 20, completionTokens: 10 } });
    expect(result).toMatchObject({ settled: true, chargedNano: 20 * 150 + 10 * 600 });
    expect(quota.stats().counters.usage_over_reservation).toBe(1);
  });

  describe("policy snapshot", () => {
    it("applies a mid-day cap decrease at once; an increase waits for the next UTC day", () => {
      const { core: quota } = core();
      const nano = costNano(1000, 768, 150, 600);
      expect(quota.reserve(reserveInput({ policy: { ...POLICY, capNano: nano * 10 } })).ok).toBe(true);
      // Tighten to exactly one request's room: the next reservation is refused at once.
      expect(quota.reserve(reserveInput({ policy: { ...POLICY, capNano: nano } }))).toEqual({ ok: false, code: "global_cap" });
      // Loosen again the same day: the tightening sticks.
      expect(quota.reserve(reserveInput({ policy: { ...POLICY, capNano: nano * 100 } }))).toEqual({ ok: false, code: "global_cap" });
      expect(quota.stats().policy?.capNano).toBe(nano);
      // The next UTC day (a fresh DO) takes the looser value.
      const next = new QuotaCore(new SqliteStorage());
      expect(next.reserve(reserveInput({ day: "2026-09-26", policy: { ...POLICY, capNano: nano * 100 } })).ok).toBe(true);
      expect(next.stats().policy?.capNano).toBe(nano * 100);
    });

    it("never undoes a same-day tightening of limits", () => {
      const { core: quota } = core();
      quota.reserve(reserveInput({ policy: { ...POLICY, installLimit: 50 } }));
      quota.reserve(reserveInput({ policy: { ...POLICY, installLimit: 2 } }));
      expect(quota.reserve(reserveInput({ policy: { ...POLICY, installLimit: 50 } }))).toEqual({
        ok: false,
        code: "quota_exhausted",
        scope: "install"
      });
      expect(quota.stats().policy?.installLimit).toBe(2);
    });

    it("applies a rate increase to new reservations only; open ones settle at their stored rates", () => {
      const { core: quota } = core();
      const old = reserveInput();
      expect(quota.reserve(old)).toEqual({ ok: true, nano: costNano(1000, 768, 150, 600) });
      const pricier = { ...POLICY, inRate: 300, outRate: 1200 };
      expect(quota.reserve(reserveInput({ policy: pricier }))).toEqual({ ok: true, nano: costNano(1000, 768, 300, 1200) });
      // The old reservation settles at the rates it was admitted with.
      expect(quota.settle({ day: DAY, id: old.id, usage: { promptTokens: 100, completionTokens: 10 } })).toMatchObject({
        chargedNano: 100 * 150 + 10 * 600
      });
      // A later rate decrease the same day never lowers a charge.
      const cheap = reserveInput({ policy: { ...POLICY, inRate: 1, outRate: 1 } });
      expect(quota.reserve(cheap)).toEqual({ ok: true, nano: costNano(1000, 768, 300, 1200) });
    });

    it("keeps spent + reserved <= cap across a mid-day rate increase, even when a reservation filled the cap", () => {
      const { core: quota } = core();
      const nano = costNano(1000, 768, 150, 600);
      const policy = { ...POLICY, capNano: nano };
      const invariant = () => {
        const stats = quota.stats();
        expect(stats.spentNano + stats.reservedNano).toBeLessThanOrEqual(policy.capNano);
      };
      const filler = reserveInput({ policy });
      expect(quota.reserve(filler)).toEqual({ ok: true, nano });
      invariant();
      // A refused request carries a rate increase; it persists for new reservations only.
      const pricier = { ...policy, inRate: 300, outRate: 1200 };
      expect(quota.reserve(reserveInput({ policy: pricier }))).toEqual({ ok: false, code: "global_cap" });
      expect(quota.stats().policy).toMatchObject({ inRate: 300, outRate: 1200 });
      invariant();
      // Cut stream: the filler settles in full, at its stored rates, never above the cap.
      expect(quota.settle({ day: DAY, id: filler.id, usage: null })).toEqual({ settled: true, chargedNano: nano, releasedNano: 0 });
      invariant();
      expect(quota.stats().spentNano).toBe(nano);
    });

    it("keeps the invariant when a reservation settles with full usage after a rate increase, and via the sweep", () => {
      const { core: quota } = core();
      const nano = costNano(1000, 768, 150, 600);
      const policy = { ...POLICY, capNano: nano * 2 };
      const a = reserveInput({ policy });
      const b = reserveInput({ policy });
      expect(quota.reserve(a).ok).toBe(true);
      expect(quota.reserve(b).ok).toBe(true);
      quota.reserve(reserveInput({ policy: { ...policy, inRate: 1000, outRate: 5000 } }));
      quota.settle({ day: DAY, id: a.id, usage: { promptTokens: 1000, completionTokens: 768 } });
      quota.sweep(NOW + RESERVATION_MAX_AGE_MS);
      const stats = quota.stats();
      expect(stats.openReservations).toBe(0);
      expect(stats.spentNano).toBe(nano * 2);
      expect(stats.spentNano + stats.reservedNano).toBeLessThanOrEqual(policy.capNano);
    });

    it("the kill switch is not part of the snapshot (handled in the Worker), and install limits snapshot too", () => {
      const { core: quota } = core();
      expect(quota.issueInstall({ day: DAY, net: "n", net48: null, refresh: false, policy: { ...POLICY, ipNewInstalls: 1 } })).toEqual({ ok: true });
      expect(quota.issueInstall({ day: DAY, net: "n", net48: null, refresh: false, policy: POLICY })).toEqual({ ok: false, code: "install_limited" });
    });
  });

  it("limits issuance per network key and per IPv6 /48; refreshes are not counted", () => {
    const { core: quota } = core();
    const policy = { ...POLICY, ipNewInstalls: 2, ip48NewInstalls: 3 };
    expect(quota.issueInstall({ day: DAY, net: "a64", net48: "x48", refresh: false, policy }).ok).toBe(true);
    expect(quota.issueInstall({ day: DAY, net: "a64", net48: "x48", refresh: false, policy }).ok).toBe(true);
    expect(quota.issueInstall({ day: DAY, net: "a64", net48: "x48", refresh: false, policy }).ok).toBe(false);
    expect(quota.issueInstall({ day: DAY, net: "b64", net48: "x48", refresh: false, policy }).ok).toBe(true);
    expect(quota.issueInstall({ day: DAY, net: "c64", net48: "x48", refresh: false, policy }).ok).toBe(false);
    expect(quota.issueInstall({ day: DAY, net: "a64", net48: "x48", refresh: true, policy }).ok).toBe(true);
    expect(quota.stats()).toMatchObject({ installsIssued: 3, installsRefreshed: 1 });
  });

  it("integer nano-USD arithmetic stays exact and bounded (property test)", () => {
    const { core: quota } = core();
    let random = 42;
    const next = (max: number) => {
      random = (random * 1_103_515_245 + 12_345) % 2 ** 31;
      return random % max;
    };
    const policy = { ...POLICY, installLimit: 10_000, ipLimit: 10_000, capNano: 200_000_000 };
    let expectedSpent = 0;
    for (let index = 0; index < 400; index += 1) {
      const input = reserveInput({ policy, inTokens: 1 + next(30_000), outTokens: 1 + next(4096) });
      const reserved = quota.reserve(input);
      if (!reserved.ok) continue;
      const stats = quota.stats();
      expect(stats.spentNano + stats.reservedNano).toBeLessThanOrEqual(policy.capNano);
      const mode = next(3);
      const usage = mode === 0 ? null : { promptTokens: next(input.inTokens + 1), completionTokens: next(input.outTokens + 1) };
      const settled = quota.settle({ day: DAY, id: input.id, usage });
      if (!settled.settled) throw new Error("not settled");
      expectedSpent += usage ? usage.promptTokens * 150 + usage.completionTokens * 600 : reserved.nano;
      expect(Number.isSafeInteger(settled.chargedNano)).toBe(true);
    }
    const stats = quota.stats();
    expect(stats.spentNano).toBe(expectedSpent);
    expect(stats.reservedNano).toBe(0);
    expect(stats.spentNano).toBeLessThanOrEqual(policy.capNano);
  });

  it("input reservation from UTF-8 bytes covers CJK, emoji and random text", () => {
    const samples = ["简体中文的句子", "𠀀𠀁𠀂", "👩‍👩‍👧‍👦 family", "é́́́", "\ud800lone", "plain ascii"];
    let random = 7;
    for (let index = 0; index < 50; index += 1) {
      let text = "";
      for (let char = 0; char < 40; char += 1) {
        random = (random * 48_271) % 2_147_483_647;
        const code = random % 0x10ffff;
        text += code >= 0xd800 && code <= 0xdfff ? "x" : String.fromCodePoint(code);
      }
      samples.push(text);
    }
    for (const sample of samples) {
      const bytes = utf8ByteLength(sample);
      expect(bytes).toBe(new TextEncoder().encode(sample).length);
      // Byte-level BPE never yields more tokens than bytes; the reservation adds the template overhead on top.
      expect(bytes).toBeGreaterThanOrEqual([...sample].length);
    }
  });

  it("fails closed when a cost would leave the safe-integer range", () => {
    expect(() => costNano(2 ** 52, 1, 150, 600)).toThrow();
  });
});

describe("quota Durable Object", () => {
  function objectFor(clock: Clock) {
    const storage = new SqliteStorage();
    const object = new QuotaDayObject({ storage }, undefined, clock.now);
    const namespace = { idFromName: (name: string) => ({ toString: () => name }), get: () => ({ fetch: (request: Request) => object.fetch(request) }) };
    return { storage, object, client: new QuotaClient(namespace) };
  }

  it("keeps one alarm at min(next sweep, deleteAt) and never pushes it out", async () => {
    const clock = new Clock(NOW);
    const { storage, object, client } = objectFor(clock);
    const deleteAt = dayStartMs(DAY) + RETENTION_MS;

    await client.call(DAY, "install", { day: DAY, net: "n", net48: null, refresh: false, policy: POLICY });
    expect(storage.alarm).toBe(deleteAt);

    const first = reserveInput();
    await client.call(DAY, "reserve", first);
    expect(storage.alarm).toBe(NOW + SWEEP_INTERVAL_MS);

    clock.advance(60_000);
    await client.call(DAY, "reserve", reserveInput());
    expect(storage.alarm).toBe(NOW + SWEEP_INTERVAL_MS); // not pushed to +6 min

    // The sweep settles reservations older than 2 min at full and reschedules.
    clock.value = NOW + SWEEP_INTERVAL_MS;
    await object.alarm();
    const stats = await client.call(DAY, "stats", { day: DAY });
    expect(stats?.openReservations).toBe(0);
    expect(stats?.counters.swept).toBe(2);
    expect(stats?.spentNano).toBe(2 * costNano(1000, 768, 150, 600));
    expect(storage.alarm).toBe(deleteAt);
  });

  it("sweeps only reservations older than 2 minutes", async () => {
    const clock = new Clock(NOW);
    const { storage, object, client } = objectFor(clock);
    await client.call(DAY, "reserve", reserveInput());
    clock.advance(RESERVATION_MAX_AGE_MS + SWEEP_INTERVAL_MS - 60_000);
    await client.call(DAY, "reserve", reserveInput());
    clock.value = NOW + SWEEP_INTERVAL_MS;
    await object.alarm();
    expect((await client.call(DAY, "stats", { day: DAY }))?.openReservations).toBe(1);
    expect(storage.alarm).toBe(NOW + 2 * SWEEP_INTERVAL_MS);
  });

  it("deletes all storage at day + 2 days", async () => {
    const clock = new Clock(NOW);
    const { storage, object, client } = objectFor(clock);
    await client.call(DAY, "reserve", reserveInput());
    await client.call(DAY, "settle", { day: DAY, id: `r${seq}`, usage: { promptTokens: 1, completionTokens: 1 } });
    clock.value = dayStartMs(DAY) + RETENTION_MS;
    await object.alarm();
    expect(storage.tableNames()).toEqual([]);
    expect(storage.alarm).toBeNull();
  });

  it("stats never create storage for a day without data", async () => {
    const clock = new Clock(NOW);
    const { storage, client } = objectFor(clock);
    expect(await client.call(DAY, "stats", { day: DAY })).toBeNull();
    expect(storage.tableNames()).toEqual([]);
    expect(storage.alarm).toBeNull();
  });

  it("concurrent reserves (interleaved promises) never exceed the install limit", async () => {
    const clock = new Clock(NOW);
    const namespace = new FakeNamespace(clock);
    const client = new QuotaClient(namespace);
    const results = await Promise.all(
      Array.from({ length: 80 }, () => client.call(DAY, "reserve", reserveInput()))
    );
    expect(results.filter((result) => result.ok)).toHaveLength(50);
    expect((await client.call(DAY, "stats", { day: DAY }))?.requests).toBe(50);
  });

  it("returns a bare 500 (no text) when an operation throws", async () => {
    const clock = new Clock(NOW);
    const { object } = objectFor(clock);
    const response = await object.fetch(new Request("https://quota/reserve", { method: "POST", body: JSON.stringify({ day: DAY, id: "x", subject: "s", netkey: "n", inTokens: 2 ** 60, outTokens: 1, policy: POLICY }) }));
    expect(response.status).toBe(500);
    expect(await response.text()).toBe("");
  });
});
