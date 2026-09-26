// Quota core for one UTC day (spec §4 "Counters"). Pure logic over an
// injected SQLite-like store with synchronous transactions: in production the
// day's Durable Object storage, in unit tests node:sqlite. Every check-and-
// increment runs inside one `transactionSync`, so the three layers (per
// install, per network, global spend) are checked and booked atomically.
//
// Money is integer nano-USD. A reservation is the request's worst case
// (input bytes + overhead, max_completion_tokens) at the effective rates; it
// is only released when Groq's own usage says the request cost less.

import type { QuotaPolicy } from "./config.js";
import type { DurableObjectStorageLike, SqlValue } from "./cloudflareTypes.js";
import { DAY_MS, dayStartMs } from "./errors.js";

/** Unsettled reservations older than this are settled at their full amount by the sweep. */
export const RESERVATION_MAX_AGE_MS = 2 * 60_000;
/** Sweep cadence while reservations exist. */
export const SWEEP_INTERVAL_MS = 5 * 60_000;
/** Day storage is deleted at day start + 2 days: counters live ≤ 48 h. */
export const RETENTION_MS = 2 * DAY_MS;

export type QuotaStore = Pick<DurableObjectStorageLike, "sql" | "transactionSync">;

export interface UsageTokens {
  promptTokens: number;
  completionTokens: number;
}

export interface ReserveInput {
  day: string;
  id: string;
  subject: string;
  netkey: string;
  inTokens: number;
  outTokens: number;
  policy: QuotaPolicy;
  nowMs: number;
}

export type ReserveResult =
  | { ok: true; nano: number }
  | { ok: false; code: "quota_exhausted"; scope: "install" | "network" }
  | { ok: false; code: "global_cap" };

export interface SettleInput {
  day: string;
  id: string;
  usage: UsageTokens | null;
}

export type SettleResult = { settled: false } | { settled: true; chargedNano: number; releasedNano: number };

export interface IssueInstallInput {
  day: string;
  net: string;
  net48: string | null;
  refresh: boolean;
  policy: QuotaPolicy;
}

export type IssueInstallResult = { ok: true } | { ok: false; code: "install_limited" };

export interface DayStats {
  day: string | null;
  requests: number;
  installsIssued: number;
  installsRefreshed: number;
  distinctSubjects: number;
  distinctNetworks: number;
  spentNano: number;
  reservedNano: number;
  openReservations: number;
  policy: QuotaPolicy | null;
  counters: Record<string, number>;
}

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS subjects (subject TEXT PRIMARY KEY, count INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS networks (netkey TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0, installs INTEGER NOT NULL DEFAULT 0)",
  "CREATE TABLE IF NOT EXISTS networks48 (netkey TEXT PRIMARY KEY, installs INTEGER NOT NULL DEFAULT 0)",
  `CREATE TABLE IF NOT EXISTS policy (k INTEGER PRIMARY KEY, cap_nano INTEGER NOT NULL, in_rate INTEGER NOT NULL,
     out_rate INTEGER NOT NULL, install_limit INTEGER NOT NULL, ip_limit INTEGER NOT NULL,
     ip_new_installs INTEGER NOT NULL, ip48_new_installs INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS global (k INTEGER PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0,
     reserved_nano INTEGER NOT NULL DEFAULT 0, spent_nano INTEGER NOT NULL DEFAULT 0,
     installs INTEGER NOT NULL DEFAULT 0, refreshes INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS reservations (id TEXT PRIMARY KEY, subject TEXT NOT NULL, netkey TEXT NOT NULL,
     nano INTEGER NOT NULL, in_tokens INTEGER NOT NULL, out_tokens INTEGER NOT NULL, in_rate INTEGER NOT NULL,
     out_rate INTEGER NOT NULL, created INTEGER NOT NULL)`,
  "CREATE TABLE IF NOT EXISTS errors (code TEXT PRIMARY KEY, count INTEGER NOT NULL)"
];

/** The more conservative of two policies: lower cap and limits, higher rates. */
export function conservativePolicy(a: QuotaPolicy, b: QuotaPolicy): QuotaPolicy {
  return {
    capNano: Math.min(a.capNano, b.capNano),
    inRate: Math.max(a.inRate, b.inRate),
    outRate: Math.max(a.outRate, b.outRate),
    installLimit: Math.min(a.installLimit, b.installLimit),
    ipLimit: Math.min(a.ipLimit, b.ipLimit),
    ipNewInstalls: Math.min(a.ipNewInstalls, b.ipNewInstalls),
    ip48NewInstalls: Math.min(a.ip48NewInstalls, b.ip48NewInstalls)
  };
}

/** Exact integer cost; throws (fails closed) if it could leave the safe-integer range. */
export function costNano(inTokens: number, outTokens: number, inRate: number, outRate: number): number {
  const cost = inTokens * inRate + outTokens * outRate;
  if (![inTokens, outTokens, inRate, outRate, cost].every(Number.isSafeInteger) || cost < 0) {
    throw new Error("cost_out_of_range");
  }
  return cost;
}

export class QuotaCore {
  constructor(private readonly store: QuotaStore) {
    for (const statement of SCHEMA) store.sql.exec(statement);
  }

  reserve(input: ReserveInput): ReserveResult {
    return this.store.transactionSync(() => {
      this.ensureDay(input.day);
      const policy = this.effectivePolicy(input.policy);

      if (this.count("SELECT count AS n FROM subjects WHERE subject = ?", input.subject) >= policy.installLimit) {
        this.bump("refused_quota_install");
        return { ok: false, code: "quota_exhausted", scope: "install" } as const;
      }
      if (this.count("SELECT count AS n FROM networks WHERE netkey = ?", input.netkey) >= policy.ipLimit) {
        this.bump("refused_quota_network");
        return { ok: false, code: "quota_exhausted", scope: "network" } as const;
      }

      const nano = costNano(input.inTokens, input.outTokens, policy.inRate, policy.outRate);
      const global = this.global();
      if (global.spent + global.reserved + nano > policy.capNano) {
        this.bump("refused_global_cap");
        return { ok: false, code: "global_cap" } as const;
      }

      const sql = this.store.sql;
      sql.exec(
        "INSERT INTO subjects (subject, count) VALUES (?, 1) ON CONFLICT(subject) DO UPDATE SET count = count + 1",
        input.subject
      );
      sql.exec(
        "INSERT INTO networks (netkey, count) VALUES (?, 1) ON CONFLICT(netkey) DO UPDATE SET count = count + 1",
        input.netkey
      );
      sql.exec("UPDATE global SET count = count + 1, reserved_nano = reserved_nano + ? WHERE k = 1", nano);
      sql.exec(
        `INSERT INTO reservations (id, subject, netkey, nano, in_tokens, out_tokens, in_rate, out_rate, created)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        input.id, input.subject, input.netkey, nano, input.inTokens, input.outTokens, policy.inRate, policy.outRate, input.nowMs
      );
      return { ok: true, nano } as const;
    });
  }

  /**
   * With usage → actual cost at the reservation's own stored rates,
   * releasing the rest. Without usage (abort, cut stream, timeout) → the full
   * reservation: gpt-oss reasons before it writes, and aborted reasoning is
   * still billed. Never lowers the request count. A mid-day rate change never
   * reprices an open reservation: its worst case was admitted against the cap
   * at its own rates, so settling it higher could push spent past the cap.
   */
  settle(input: SettleInput): SettleResult {
    return this.store.transactionSync(() => {
      const row = this.reservation(input.id);
      if (!row) return { settled: false } as const;
      this.ensureDay(input.day);

      let charged: number;
      if (input.usage) {
        charged = costNano(input.usage.promptTokens, input.usage.completionTokens, row.inRate, row.outRate);
        if (input.usage.promptTokens > row.inTokens || input.usage.completionTokens > row.outTokens) {
          // A premise of the hard cap failed (spec §4): book the real cost anyway and count it.
          this.bump("usage_over_reservation");
        }
      } else {
        charged = row.nano;
        this.bump("settled_without_usage");
      }

      this.store.sql.exec(
        "UPDATE global SET reserved_nano = reserved_nano - ?, spent_nano = spent_nano + ? WHERE k = 1",
        row.nano, charged
      );
      this.store.sql.exec("DELETE FROM reservations WHERE id = ?", input.id);
      return { settled: true, chargedNano: charged, releasedNano: Math.max(0, row.nano - charged) } as const;
    });
  }

  /** Upstream failed before the first byte: nothing was billed, so release and give the request back. */
  refund(input: { day: string; id: string; reason: string }): boolean {
    return this.store.transactionSync(() => {
      const row = this.reservation(input.id);
      if (!row) return false;
      const sql = this.store.sql;
      sql.exec("UPDATE global SET count = count - 1, reserved_nano = reserved_nano - ? WHERE k = 1", row.nano);
      sql.exec("UPDATE subjects SET count = count - 1 WHERE subject = ? AND count > 0", row.subject);
      sql.exec("UPDATE networks SET count = count - 1 WHERE netkey = ? AND count > 0", row.netkey);
      sql.exec("DELETE FROM reservations WHERE id = ?", input.id);
      this.bump(input.reason);
      return true;
    });
  }

  issueInstall(input: IssueInstallInput): IssueInstallResult {
    return this.store.transactionSync(() => {
      this.ensureDay(input.day);
      if (input.refresh) {
        this.store.sql.exec("UPDATE global SET refreshes = refreshes + 1 WHERE k = 1");
        return { ok: true } as const;
      }
      const policy = this.effectivePolicy(input.policy);
      if (this.count("SELECT installs AS n FROM networks WHERE netkey = ?", input.net) >= policy.ipNewInstalls) {
        this.bump("refused_install_network");
        return { ok: false, code: "install_limited" } as const;
      }
      if (input.net48 !== null && this.count("SELECT installs AS n FROM networks48 WHERE netkey = ?", input.net48) >= policy.ip48NewInstalls) {
        this.bump("refused_install_48");
        return { ok: false, code: "install_limited" } as const;
      }
      const sql = this.store.sql;
      sql.exec(
        "INSERT INTO networks (netkey, installs) VALUES (?, 1) ON CONFLICT(netkey) DO UPDATE SET installs = installs + 1",
        input.net
      );
      if (input.net48 !== null) {
        sql.exec(
          "INSERT INTO networks48 (netkey, installs) VALUES (?, 1) ON CONFLICT(netkey) DO UPDATE SET installs = installs + 1",
          input.net48
        );
      }
      sql.exec("UPDATE global SET installs = installs + 1 WHERE k = 1");
      return { ok: true } as const;
    });
  }

  /** Counts a code (refusals, upstream statuses). Codes only, never text. */
  record(day: string, code: string): void {
    this.store.transactionSync(() => {
      this.ensureDay(day);
      this.bump(code);
    });
  }

  /** Settles every reservation older than RESERVATION_MAX_AGE_MS at its full amount. */
  sweep(nowMs: number): number {
    const day = this.day();
    if (!day) return 0;
    const stale = this.store.sql
      .exec("SELECT id FROM reservations WHERE created <= ?", nowMs - RESERVATION_MAX_AGE_MS)
      .toArray()
      .map((row) => String(row.id));
    for (const id of stale) {
      const result = this.settle({ day, id, usage: null });
      if (result.settled) this.store.transactionSync(() => this.bump("swept"));
    }
    return stale.length;
  }

  /** The single alarm: min(next sweep, deleteAt) while reservations exist, else deleteAt. */
  nextAlarm(nowMs: number): number | null {
    const day = this.day();
    if (!day) return null;
    const deleteAt = dayStartMs(day) + RETENTION_MS;
    const open = this.count("SELECT COUNT(*) AS n FROM reservations");
    return open > 0 ? Math.min(nowMs + SWEEP_INTERVAL_MS, deleteAt) : deleteAt;
  }

  deleteAt(): number | null {
    const day = this.day();
    return day ? dayStartMs(day) + RETENTION_MS : null;
  }

  stats(): DayStats {
    const global = this.global();
    const counters: Record<string, number> = {};
    for (const row of this.store.sql.exec("SELECT code, count FROM errors ORDER BY code").toArray()) {
      counters[String(row.code)] = Number(row.count);
    }
    return {
      day: this.day(),
      requests: global.count,
      installsIssued: global.installs,
      installsRefreshed: global.refreshes,
      distinctSubjects: this.count("SELECT COUNT(*) AS n FROM subjects WHERE count > 0"),
      distinctNetworks: this.count("SELECT COUNT(*) AS n FROM networks"),
      spentNano: global.spent,
      reservedNano: global.reserved,
      openReservations: this.count("SELECT COUNT(*) AS n FROM reservations"),
      policy: this.snapshot(),
      counters
    };
  }

  day(): string | null {
    const rows = this.store.sql.exec("SELECT v FROM meta WHERE k = 'day'").toArray();
    return rows.length ? String(rows[0].v) : null;
  }

  // -------------------------------------------------------------------------

  private ensureDay(day: string) {
    const current = this.day();
    if (current === null) {
      this.store.sql.exec("INSERT INTO meta (k, v) VALUES ('day', ?)", day);
      this.store.sql.exec("INSERT OR IGNORE INTO global (k) VALUES (1)");
    } else if (current !== day) {
      throw new Error("day_mismatch");
    }
  }

  /**
   * The day's policy: the first request snapshots the current env policy;
   * later requests apply the more conservative of snapshot and current and
   * write it back, so a tightening sticks for the day and a loosening waits
   * for the next UTC day.
   */
  private effectivePolicy(current: QuotaPolicy): QuotaPolicy {
    const snapshot = this.snapshot();
    const effective = snapshot ? conservativePolicy(snapshot, current) : current;
    if (!snapshot || !samePolicy(snapshot, effective)) {
      this.store.sql.exec(
        `INSERT INTO policy (k, cap_nano, in_rate, out_rate, install_limit, ip_limit, ip_new_installs, ip48_new_installs)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(k) DO UPDATE SET cap_nano = excluded.cap_nano, in_rate = excluded.in_rate, out_rate = excluded.out_rate,
           install_limit = excluded.install_limit, ip_limit = excluded.ip_limit,
           ip_new_installs = excluded.ip_new_installs, ip48_new_installs = excluded.ip48_new_installs`,
        effective.capNano, effective.inRate, effective.outRate, effective.installLimit, effective.ipLimit,
        effective.ipNewInstalls, effective.ip48NewInstalls
      );
    }
    return effective;
  }

  private snapshot(): QuotaPolicy | null {
    const rows = this.store.sql.exec("SELECT * FROM policy WHERE k = 1").toArray();
    if (!rows.length) return null;
    const row = rows[0];
    return {
      capNano: Number(row.cap_nano),
      inRate: Number(row.in_rate),
      outRate: Number(row.out_rate),
      installLimit: Number(row.install_limit),
      ipLimit: Number(row.ip_limit),
      ipNewInstalls: Number(row.ip_new_installs),
      ip48NewInstalls: Number(row.ip48_new_installs)
    };
  }

  private global() {
    const rows = this.store.sql.exec("SELECT * FROM global WHERE k = 1").toArray();
    const row = rows[0] ?? {};
    return {
      count: Number(row.count ?? 0),
      reserved: Number(row.reserved_nano ?? 0),
      spent: Number(row.spent_nano ?? 0),
      installs: Number(row.installs ?? 0),
      refreshes: Number(row.refreshes ?? 0)
    };
  }

  private reservation(id: string) {
    const rows = this.store.sql.exec("SELECT * FROM reservations WHERE id = ?", id).toArray();
    if (!rows.length) return null;
    const row = rows[0];
    return {
      subject: String(row.subject),
      netkey: String(row.netkey),
      nano: Number(row.nano),
      inTokens: Number(row.in_tokens),
      outTokens: Number(row.out_tokens),
      inRate: Number(row.in_rate),
      outRate: Number(row.out_rate)
    };
  }

  private count(query: string, ...bindings: SqlValue[]): number {
    const rows = this.store.sql.exec(query, ...bindings).toArray();
    return rows.length ? Number(rows[0].n ?? 0) : 0;
  }

  private bump(code: string) {
    this.store.sql.exec(
      "INSERT INTO errors (code, count) VALUES (?, 1) ON CONFLICT(code) DO UPDATE SET count = count + 1",
      code
    );
  }
}

function samePolicy(a: QuotaPolicy, b: QuotaPolicy): boolean {
  return a.capNano === b.capNano && a.inRate === b.inRate && a.outRate === b.outRate && a.installLimit === b.installLimit
    && a.ipLimit === b.ipLimit && a.ipNewInstalls === b.ipNewInstalls && a.ip48NewInstalls === b.ip48NewInstalls;
}
