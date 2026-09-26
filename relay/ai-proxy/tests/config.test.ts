import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MEASURED_PROMPT_OVERHEAD_TOKENS } from "../../../electron/writing/groq/prompts/index.js";
import { compareSemver, parseClientHeader, parseConfig } from "../src/config.js";
import { baseEnv, Clock, FakeNamespace } from "./helpers.js";

const env = (overrides = {}) => baseEnv(new FakeNamespace(new Clock()), overrides);

describe("config", () => {
  it("parses the spec defaults", () => {
    const parsed = parseConfig(env());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.config.policy).toEqual({
      capNano: 5_000_000_000,
      inRate: 150,
      outRate: 600,
      installLimit: 50,
      ipLimit: 150,
      ipNewInstalls: 5,
      ip48NewInstalls: 20
    });
    expect(parsed.config.promptOverheadTokens).toBeGreaterThanOrEqual(2 * MEASURED_PROMPT_OVERHEAD_TOKENS);
    expect([...parsed.config.supportedPromptVersions]).toEqual([1]);
  });

  it.each([
    ["FREE_TIER_ENABLED", "yes"],
    ["INSTALL_DAILY_REQUESTS", "-1"],
    ["IP_DAILY_REQUESTS", "1.5"],
    ["GLOBAL_DAILY_NANO_USD", "5e9"],
    ["GLOBAL_DAILY_NANO_USD", "99999999999999999999"],
    ["INPUT_NANO_USD_PER_TOKEN", "0"],
    ["OUTPUT_NANO_USD_PER_TOKEN", ""],
    ["PROMPT_OVERHEAD_TOKENS", "100"],
    ["TOKEN_TTL_DAYS", "0"],
    ["SUPPORTED_PROMPT_VERSIONS", "1,2"],
    ["SUPPORTED_PROMPT_VERSIONS", ""],
    ["MIN_CLIENT_VERSION", "latest"],
    ["DENY_SUBJECTS", "not-a-subject"],
    ["QUOTA_LOCATION_HINT", "mars"],
    ["GROQ_API_KEY", undefined],
    ["TOKEN_SIGNING_KEYS", "{}"],
    ["IP_HASH_KEY", "short"]
  ])("fails closed on invalid %s=%s", (name, value) => {
    expect(parseConfig(env({ [name]: value }))).toEqual({ ok: false, field: name });
  });

  it("parses client headers and compares versions", () => {
    expect(parseClientHeader("iliad-md/0.4.0")).toEqual([0, 4, 0]);
    expect(parseClientHeader("iliad-md/0.4.0-beta.2")).toEqual([0, 4, 0]);
    expect(parseClientHeader("curl/8.0")).toBeNull();
    expect(parseClientHeader(null)).toBeNull();
    expect(compareSemver([0, 3, 9], [0, 4, 0])).toBeLessThan(0);
    expect(compareSemver([0, 10, 0], [0, 4, 0])).toBeGreaterThan(0);
  });

  it("wrangler.toml keeps request signals on, observability off and the spec defaults", () => {
    const toml = fs.readFileSync(path.resolve(__dirname, "../wrangler.toml"), "utf8");
    expect(toml).toMatch(/compatibility_flags\s*=\s*\[[^\]]*"enable_request_signal"/);
    expect(toml).toMatch(/\[observability\]\s*\nenabled\s*=\s*false/);
    expect(toml).toMatch(/\[observability\.logs\]\s*\nenabled\s*=\s*false/);
    expect(toml).toMatch(/new_sqlite_classes\s*=\s*\["QuotaDayObject"\]/);
    const vars: Record<string, string> = {};
    const section = toml.split("[vars]")[1].split(/\n\[/)[0];
    for (const match of section.matchAll(/^(\w+)\s*=\s*"([^"]*)"/gm)) vars[match[1]] = match[2];
    const parsed = parseConfig({ ...env(), ...vars });
    expect(parsed.ok).toBe(true);
    expect(vars).toMatchObject({
      FREE_TIER_ENABLED: "true",
      INSTALL_DAILY_REQUESTS: "50",
      IP_DAILY_REQUESTS: "150",
      IP_DAILY_NEW_INSTALLS: "5",
      IP48_DAILY_NEW_INSTALLS: "20",
      GLOBAL_DAILY_NANO_USD: "5000000000",
      INPUT_NANO_USD_PER_TOKEN: "150",
      OUTPUT_NANO_USD_PER_TOKEN: "600",
      PROMPT_OVERHEAD_TOKENS: "150",
      TOKEN_TTL_DAYS: "30",
      TOKEN_REFRESH_DAYS: "60",
      MIN_CLIENT_VERSION: "0.4.0",
      SUPPORTED_PROMPT_VERSIONS: "1"
    });
    for (const secret of ["GROQ_API_KEY", "TOKEN_SIGNING_KEYS", "IP_HASH_KEY", "ADMIN_TOKEN"]) {
      expect(toml).not.toMatch(new RegExp(`^${secret}\\s*=`, "m"));
    }
  });
});
