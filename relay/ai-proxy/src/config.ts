// Worker config (spec §4 "Config"). Parsed and validated on every request;
// anything invalid or missing fails closed (503 `free_tier_disabled`), never
// open. Limits change with `wrangler deploy`, no app release.

import { MIN_PROMPT_OVERHEAD_TOKENS, PROMPT_VERSIONS, type PromptVersion } from "../../../electron/writing/groq/prompts/index.js";
import type { AiProxyEnv } from "./cloudflareTypes.js";
import { base64Decode } from "./crypto.js";
import { parseSigningKeys, type SigningKeys } from "./tokens.js";

/** The per-day quota policy, snapshotted into the day's Durable Object. */
export interface QuotaPolicy {
  capNano: number;
  inRate: number;
  outRate: number;
  installLimit: number;
  ipLimit: number;
  ipNewInstalls: number;
  ip48NewInstalls: number;
}

export interface ProxyConfig {
  freeTierEnabled: boolean;
  policy: QuotaPolicy;
  denySubjects: ReadonlySet<string>;
  supportedPromptVersions: ReadonlySet<PromptVersion>;
  promptOverheadTokens: number;
  tokenTtlDays: number;
  tokenRefreshDays: number;
  minClientVersion: Semver;
  locationHint: string | undefined;
  groqApiKey: string;
  signingKeys: SigningKeys;
  ipHashKey: Uint8Array;
  adminToken: string | null;
}

export type ConfigResult = { ok: true; config: ProxyConfig } | { ok: false; field: string };

type IntVar = "INSTALL_DAILY_REQUESTS" | "IP_DAILY_REQUESTS" | "IP_DAILY_NEW_INSTALLS" | "IP48_DAILY_NEW_INSTALLS" | "GLOBAL_DAILY_NANO_USD"
  | "INPUT_NANO_USD_PER_TOKEN" | "OUTPUT_NANO_USD_PER_TOKEN" | "PROMPT_OVERHEAD_TOKENS" | "TOKEN_TTL_DAYS" | "TOKEN_REFRESH_DAYS";

const LOCATION_HINTS = new Set(["wnam", "enam", "sam", "weur", "eeur", "apac", "oc", "afr", "me"]);

export function parseConfig(env: AiProxyEnv): ConfigResult {
  const fail = (field: string): ConfigResult => ({ ok: false, field });

  const freeTier = env.FREE_TIER_ENABLED;
  if (freeTier !== "true" && freeTier !== "false") return fail("FREE_TIER_ENABLED");

  const ints: Record<string, number> = {};
  const intFields: Array<[IntVar, number]> = [
    ["INSTALL_DAILY_REQUESTS", 0],
    ["IP_DAILY_REQUESTS", 0],
    ["IP_DAILY_NEW_INSTALLS", 0],
    ["IP48_DAILY_NEW_INSTALLS", 0],
    ["GLOBAL_DAILY_NANO_USD", 0],
    ["INPUT_NANO_USD_PER_TOKEN", 1],
    ["OUTPUT_NANO_USD_PER_TOKEN", 1],
    ["PROMPT_OVERHEAD_TOKENS", MIN_PROMPT_OVERHEAD_TOKENS],
    ["TOKEN_TTL_DAYS", 1],
    ["TOKEN_REFRESH_DAYS", 0]
  ];
  for (const [name, min] of intFields) {
    const value = parseNonNegativeInt(env[name] as string | undefined);
    if (value === null || value < min) return fail(name);
    ints[name] = value;
  }

  const versions = parseVersionList(env.SUPPORTED_PROMPT_VERSIONS);
  if (!versions) return fail("SUPPORTED_PROMPT_VERSIONS");

  const minClientVersion = parseSemver(env.MIN_CLIENT_VERSION);
  if (!minClientVersion) return fail("MIN_CLIENT_VERSION");

  const denySubjects = parseDenyList(env.DENY_SUBJECTS ?? "");
  if (!denySubjects) return fail("DENY_SUBJECTS");

  const locationHint = env.QUOTA_LOCATION_HINT?.trim() || undefined;
  if (locationHint !== undefined && !LOCATION_HINTS.has(locationHint)) return fail("QUOTA_LOCATION_HINT");

  if (!env.GROQ_API_KEY || /\s/.test(env.GROQ_API_KEY)) return fail("GROQ_API_KEY");
  const signingKeys = parseSigningKeys(env.TOKEN_SIGNING_KEYS);
  if (!signingKeys) return fail("TOKEN_SIGNING_KEYS");
  const ipHashKey = env.IP_HASH_KEY ? base64Decode(env.IP_HASH_KEY.trim()) : null;
  if (!ipHashKey || ipHashKey.length < 32) return fail("IP_HASH_KEY");
  const adminToken = env.ADMIN_TOKEN && env.ADMIN_TOKEN.length >= 32 ? env.ADMIN_TOKEN : null;

  return {
    ok: true,
    config: {
      freeTierEnabled: freeTier === "true",
      policy: {
        capNano: ints.GLOBAL_DAILY_NANO_USD,
        inRate: ints.INPUT_NANO_USD_PER_TOKEN,
        outRate: ints.OUTPUT_NANO_USD_PER_TOKEN,
        installLimit: ints.INSTALL_DAILY_REQUESTS,
        ipLimit: ints.IP_DAILY_REQUESTS,
        ipNewInstalls: ints.IP_DAILY_NEW_INSTALLS,
        ip48NewInstalls: ints.IP48_DAILY_NEW_INSTALLS
      },
      denySubjects,
      supportedPromptVersions: versions,
      promptOverheadTokens: ints.PROMPT_OVERHEAD_TOKENS,
      tokenTtlDays: ints.TOKEN_TTL_DAYS,
      tokenRefreshDays: ints.TOKEN_REFRESH_DAYS,
      minClientVersion,
      locationHint,
      groqApiKey: env.GROQ_API_KEY,
      signingKeys,
      ipHashKey,
      adminToken
    }
  };
}

function parseNonNegativeInt(value: string | undefined): number | null {
  if (typeof value !== "string" || !/^\d{1,15}$/.test(value.trim())) return null;
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseVersionList(value: string | undefined): ReadonlySet<PromptVersion> | null {
  if (!value) return null;
  const versions = new Set<PromptVersion>();
  for (const part of value.split(",")) {
    const trimmed = part.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const version = Number(trimmed);
    // Every listed version must have a frozen prompts/vN.ts in this build.
    if (!(PROMPT_VERSIONS as readonly number[]).includes(version)) return null;
    versions.add(version as PromptVersion);
  }
  return versions.size ? versions : null;
}

function parseDenyList(value: string): ReadonlySet<string> | null {
  const subjects = new Set<string>();
  for (const part of value.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (!/^inst_[A-Za-z0-9_-]{8,64}$/.test(trimmed)) return null;
    subjects.add(trimmed);
  }
  return subjects;
}

// ---------------------------------------------------------------------------
// Client versions (`X-Iliad-Client: iliad-md/<version>`).

export type Semver = readonly [number, number, number];

export function parseSemver(value: string | undefined | null): Semver | null {
  if (typeof value !== "string") return null;
  // Prerelease/build suffixes are accepted and ignored (0.4.0-beta.1 ≥ 0.4.0).
  const match = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:[-+][0-9A-Za-z.-]{1,64})?$/.exec(value.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareSemver(left: Semver, right: Semver): number {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

/** `iliad-md/<semver>` → the version; anything else → null. */
export function parseClientHeader(value: string | null): Semver | null {
  if (!value) return null;
  const match = /^iliad-md\/(\S{1,80})$/.exec(value.trim());
  return match ? parseSemver(match[1]) : null;
}
