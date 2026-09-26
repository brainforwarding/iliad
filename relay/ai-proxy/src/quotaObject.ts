// The day's quota Durable Object (`quota:YYYY-MM-DD`, SQLite-backed) and the
// Worker-side client for it. One DO per UTC day: rollover is structural, and
// a request that straddles midnight settles into the DO that reserved it.
// The DO keeps one alarm at min(next sweep, day + 2 days); at day + 2 it
// deletes all of its storage.

import type { DurableObjectNamespaceLike, DurableObjectStateLike } from "./cloudflareTypes.js";
import type { QuotaPolicy } from "./config.js";
import {
  QuotaCore,
  type DayStats,
  type IssueInstallInput,
  type IssueInstallResult,
  type ReserveInput,
  type ReserveResult,
  type SettleInput,
  type SettleResult
} from "./quotaCore.js";

type QuotaOps = {
  reserve: { input: ReserveInput; output: ReserveResult };
  settle: { input: SettleInput; output: SettleResult };
  refund: { input: { day: string; id: string; reason: string }; output: { refunded: boolean } };
  install: { input: IssueInstallInput; output: IssueInstallResult };
  record: { input: { day: string; code: string }; output: { ok: true } };
  stats: { input: { day: string }; output: DayStats | null };
};

export type QuotaOp = keyof QuotaOps;

const OPS = new Set<string>(["reserve", "settle", "refund", "install", "record", "stats"]);

export class QuotaDayObject {
  private core: QuotaCore | null = null;

  constructor(
    private readonly state: DurableObjectStateLike,
    _env?: unknown,
    private readonly now: () => number = Date.now
  ) {}

  async fetch(request: Request): Promise<Response> {
    const op = new URL(request.url).pathname.slice(1);
    if (request.method !== "POST" || !OPS.has(op)) return new Response(null, { status: 404 });
    let input: Record<string, unknown>;
    try {
      input = (await request.json()) as Record<string, unknown>;
    } catch {
      return new Response(null, { status: 400 });
    }
    try {
      const output = this.run(op as QuotaOp, input);
      if (op !== "stats") await this.ensureAlarm();
      return Response.json(output);
    } catch {
      // Never echo the error: codes only. The Worker maps a 500 to a refusal.
      return new Response(null, { status: 500 });
    }
  }

  async alarm(): Promise<void> {
    if (!this.hasTables()) return;
    const core = this.getCore();
    const deleteAt = core.deleteAt();
    if (deleteAt === null) return;
    const now = this.now();
    if (now >= deleteAt) {
      await this.state.storage.deleteAlarm();
      await this.state.storage.deleteAll();
      this.core = null;
      return;
    }
    core.sweep(now);
    const next = core.nextAlarm(now);
    if (next !== null) await this.state.storage.setAlarm(next);
  }

  private run(op: QuotaOp, input: Record<string, unknown>): unknown {
    if (op === "stats") return this.hasTables() ? this.getCore().stats() : null;
    const core = this.getCore();
    switch (op) {
      case "reserve":
        return core.reserve({ ...(input as unknown as ReserveInput), nowMs: this.now() });
      case "settle":
        return core.settle(input as unknown as SettleInput);
      case "refund":
        return { refunded: core.refund(input as unknown as QuotaOps["refund"]["input"]) };
      case "install":
        return core.issueInstall(input as unknown as IssueInstallInput);
      case "record": {
        const { day, code } = input as unknown as QuotaOps["record"]["input"];
        core.record(day, code);
        return { ok: true };
      }
    }
  }

  /** Sets the one alarm to the earliest thing it must do; never pushes an earlier alarm out. */
  private async ensureAlarm() {
    const next = this.getCore().nextAlarm(this.now());
    if (next === null) return;
    const current = await this.state.storage.getAlarm();
    if (current === null || current > next) await this.state.storage.setAlarm(next);
  }

  private hasTables(): boolean {
    if (this.core) return true;
    return this.state.storage.sql
      .exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'")
      .toArray().length > 0;
  }

  private getCore(): QuotaCore {
    this.core ??= new QuotaCore(this.state.storage);
    return this.core;
  }
}

/** Worker-side client: one stub per UTC day. */
export class QuotaClient {
  constructor(
    private readonly namespace: DurableObjectNamespaceLike,
    private readonly locationHint?: string
  ) {}

  async call<Op extends QuotaOp>(day: string, op: Op, input: QuotaOps[Op]["input"]): Promise<QuotaOps[Op]["output"]> {
    const stub = this.namespace.get(
      this.namespace.idFromName(`quota:${day}`),
      this.locationHint ? { locationHint: this.locationHint } : undefined
    );
    const response = await stub.fetch(
      new Request(`https://quota/${op}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input)
      })
    );
    if (!response.ok) throw new QuotaUnavailableError();
    return (await response.json()) as QuotaOps[Op]["output"];
  }
}

export class QuotaUnavailableError extends Error {
  constructor() {
    super("quota_unavailable");
    this.name = "QuotaUnavailableError";
  }
}

export type { QuotaPolicy };
