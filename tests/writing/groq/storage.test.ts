import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ILIAD_AI_PROXY_BUILTIN_URL,
  ILIAD_AI_PROXY_HOST_ALLOWLIST,
  allowedProxyOrigin,
  proxyUrlIsPlaceholder
} from "../../../electron/writing/groq/config";
import { ProxyEndpointResolver, parseDevProxyUrl } from "../../../electron/writing/groq/endpoint";
import { InstallTokenStore } from "../../../electron/writing/groq/installToken";
import { GroqKeyStore, type SafeStorageLike } from "../../../electron/writing/groq/keyStore";
import { legacyWritingSettingsPath, migrateLegacyWritingSettings } from "../../../electron/writing/groq/migration";
import { createAutocompletePartialEmitter, stableAutocompletePrefix } from "../../../electron/writing/groq/partials";
import { writePrivateFileAtomic } from "../../../electron/writing/groq/privateFile";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "iliad-ai-store-"));
  dirs.push(dir);
  return dir;
}

const mode = async (file: string) => (await stat(file)).mode & 0o777;

const fakeSafeStorage: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (text) => Buffer.from(`enc:${Buffer.from(text).toString("hex")}`),
  decryptString: (buffer) => {
    const value = buffer.toString();
    if (!value.startsWith("enc:")) throw new Error("decrypt failed");
    return Buffer.from(value.slice(4), "hex").toString();
  }
};

describe("GroqKeyStore (safeStorage)", () => {
  it("round-trips through safeStorage, never writes plaintext, and keeps mode 0600", async () => {
    const dir = await tempDir();
    const store = new GroqKeyStore(dir, { safeStorage: fakeSafeStorage });
    expect(await store.getState()).toEqual({ state: "none", last4: null });

    expect(await store.setKey("  gsk_secretKey1234 ")).toEqual({ state: "ok", last4: "1234" });
    const file = path.join(dir, "ai", "settings.json");
    const raw = await readFile(file, "utf8");
    expect(raw).not.toContain("gsk_secretKey1234");
    expect(JSON.parse(raw)).toEqual({ storage: "safeStorage", groqApiKeyEnc: expect.any(String) });
    expect(await mode(file)).toBe(0o600);

    // A fresh store (new launch) decrypts it.
    expect(await new GroqKeyStore(dir, { safeStorage: fakeSafeStorage }).read()).toEqual({ state: "ok", key: "gsk_secretKey1234" });

    expect(await store.setKey(null)).toEqual({ state: "none", last4: null });
    await expect(stat(file)).rejects.toThrow();
  });

  it("reports unreadable (never none) when decryption fails, the file is corrupt, or encryption went away", async () => {
    const dir = await tempDir();
    await new GroqKeyStore(dir, { safeStorage: fakeSafeStorage }).setKey("gsk_abcd");
    const failing: SafeStorageLike = { ...fakeSafeStorage, decryptString: () => { throw new Error("keychain denied"); } };
    expect(await new GroqKeyStore(dir, { safeStorage: failing }).getState()).toEqual({ state: "unreadable", last4: null });
    expect(await new GroqKeyStore(dir, { safeStorage: { ...fakeSafeStorage, isEncryptionAvailable: () => false } }).getState())
      .toEqual({ state: "unreadable", last4: null });

    await writeFile(path.join(dir, "ai", "settings.json"), "{corrupt", "utf8");
    const corrupt = new GroqKeyStore(dir, { safeStorage: fakeSafeStorage });
    expect((await corrupt.getState()).state).toBe("unreadable");
    // Remove clears the unreadable state.
    expect(await corrupt.setKey(null)).toEqual({ state: "none", last4: null });
  });

  it("falls back to a 0600 plaintext file only when encryption is unavailable", async () => {
    const dir = await tempDir();
    const store = new GroqKeyStore(dir, { safeStorage: { ...fakeSafeStorage, isEncryptionAvailable: () => false } });
    await store.setKey("gsk_plainKEY9");
    const file = path.join(dir, "ai", "settings.json");
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ storage: "plain", groqApiKey: "gsk_plainKEY9" });
    expect(await mode(file)).toBe(0o600);
    expect(await store.getState()).toEqual({ state: "ok", last4: "KEY9" });
  });

  it("fixes the mode of an existing permissive file on write", async () => {
    const dir = await tempDir();
    const file = path.join(dir, "ai", "settings.json");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, "{}", { mode: 0o644 });
    await chmod(file, 0o644);
    await new GroqKeyStore(dir, { safeStorage: fakeSafeStorage }).setKey("gsk_x1234");
    expect(await mode(file)).toBe(0o600);
  });
});

describe("legacy Gemini settings migration", () => {
  async function legacy(contents: string, fileMode = 0o644) {
    const dir = await tempDir();
    const file = legacyWritingSettingsPath(dir);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, "utf8");
    await chmod(file, fileMode);
    return { dir, file };
  }

  it("removes geminiApiKey, keeps other historical fields, and ends 0600 (from a 0644 legacy file)", async () => {
    const { dir, file } = await legacy(JSON.stringify({ openAiApiKey: "sk-old", geminiApiKey: "AIzaLegacy", model: "x" }));
    expect(await migrateLegacyWritingSettings(dir)).toEqual({ ok: true, outcome: "rewritten" });
    const raw = await readFile(file, "utf8");
    expect(raw).not.toContain("AIzaLegacy");
    expect(JSON.parse(raw)).toEqual({ openAiApiKey: "sk-old", model: "x" });
    expect(await mode(file)).toBe(0o600);
    // Idempotent.
    expect(await migrateLegacyWritingSettings(dir)).toEqual({ ok: true, outcome: "unchanged" });
    expect(await readdir(path.dirname(file))).toEqual(["settings.json"]);
  });

  it("deletes the file when only the Gemini key was in it", async () => {
    const { dir, file } = await legacy(JSON.stringify({ geminiApiKey: "AIzaOnly" }));
    expect(await migrateLegacyWritingSettings(dir)).toEqual({ ok: true, outcome: "deleted" });
    await expect(stat(file)).rejects.toThrow();
  });

  it("deletes an unparsable file that may hold a Gemini key; tightens an unrelated one", async () => {
    const withKey = await legacy('{"geminiApiKey": "AIza', 0o644);
    expect(await migrateLegacyWritingSettings(withKey.dir)).toEqual({ ok: true, outcome: "deleted" });
    const other = await legacy("not json", 0o644);
    expect(await migrateLegacyWritingSettings(other.dir)).toEqual({ ok: true, outcome: "unchanged" });
    expect(await mode(other.file)).toBe(0o600);
  });

  it("does nothing without a legacy file and never creates the new key file", async () => {
    const dir = await tempDir();
    expect(await migrateLegacyWritingSettings(dir)).toEqual({ ok: true, outcome: "absent" });
    await expect(stat(path.join(dir, "ai"))).rejects.toThrow();
  });

  it("runs, awaited, before the writing IPC is registered in main", async () => {
    const main = await readFile(path.join(process.cwd(), "electron", "main.ts"), "utf8");
    const migrate = main.indexOf("await migrateLegacyWritingSettings(userDataPath)");
    expect(migrate).toBeGreaterThan(0);
    expect(migrate).toBeLessThan(main.indexOf("registerWritingSettingsIpc({"));
    expect(migrate).toBeLessThan(main.indexOf("registerAutocompleteIpc({"));
    expect(migrate).toBeLessThan(main.indexOf("registerTightenIpc({"));
  });
});

describe("atomic private writes", () => {
  it("leaves no partial or temp file when the final rename fails", async () => {
    const dir = await tempDir();
    const target = path.join(dir, "ai", "settings.json");
    await mkdir(target, { recursive: true }); // a directory where the file should go: rename fails
    await expect(writePrivateFileAtomic(target, '{"groqApiKey":"x"}')).rejects.toThrow();
    expect(await readdir(path.dirname(target))).toEqual(["settings.json"]);
    expect((await stat(target)).isDirectory()).toBe(true);
  });
});

describe("InstallTokenStore", () => {
  it("stores the token 0600 with issuedAt and treats a corrupt file as missing", async () => {
    const dir = await tempDir();
    const store = new InstallTokenStore(dir, () => Date.UTC(2026, 8, 25));
    expect(await store.read()).toBeNull();
    await store.write("v1.k.payload.sig");
    const file = path.join(dir, "ai", "install.json");
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ token: "v1.k.payload.sig", issuedAt: "2026-09-25T00:00:00.000Z" });
    expect(await mode(file)).toBe(0o600);
    expect(await new InstallTokenStore(dir).read()).toBe("v1.k.payload.sig");

    await writeFile(file, '{"token": "has space"}', "utf8");
    expect(await new InstallTokenStore(dir).read()).toBeNull();
    await store.clear();
    expect(await store.read()).toBeNull();
  });
});

describe("proxy URL allowlist and ai.json relocation", () => {
  const allow = ["*.acct.workers.dev", "ai.iliad.md"];

  it("allows only HTTPS origins on the allowlist", () => {
    expect(allowedProxyOrigin("https://iliad-ai.acct.workers.dev", allow)).toBe("https://iliad-ai.acct.workers.dev");
    expect(allowedProxyOrigin("https://iliad-ai.acct.workers.dev/", allow)).toBe("https://iliad-ai.acct.workers.dev");
    expect(allowedProxyOrigin("https://ai.iliad.md", allow)).toBe("https://ai.iliad.md");
    for (const bad of [
      "http://ai.iliad.md",
      "https://evil.workers.dev",
      "https://a.b.acct.workers.dev",
      "https://acct.workers.dev",
      "https://ai.iliad.md.evil.com",
      "https://user:pw@ai.iliad.md",
      "https://ai.iliad.md:8443",
      "https://ai.iliad.md/path",
      "https://ai.iliad.md/?q=1",
      "not a url",
      42
    ]) {
      expect(allowedProxyOrigin(bad, allow)).toBeNull();
    }
  });

  it("keeps the built-in URL marked as a placeholder until the lead sets it (release blocker)", () => {
    // When the real subdomain is set, the built-in URL must itself pass the allowlist.
    if (proxyUrlIsPlaceholder(ILIAD_AI_PROXY_BUILTIN_URL)) {
      expect(allowedProxyOrigin(ILIAD_AI_PROXY_BUILTIN_URL)).toBeNull();
      expect(ILIAD_AI_PROXY_HOST_ALLOWLIST.some((pattern) => pattern.includes("REPLACE"))).toBe(true);
    } else {
      expect(allowedProxyOrigin(ILIAD_AI_PROXY_BUILTIN_URL)).toBe(ILIAD_AI_PROXY_BUILTIN_URL.replace(/\/$/, ""));
    }
  });

  it("parses the dev override (http allowed for the local fake proxy)", () => {
    expect(parseDevProxyUrl("http://127.0.0.1:8787/")).toBe("http://127.0.0.1:8787");
    expect(parseDevProxyUrl("ftp://x")).toBeNull();
    expect(parseDevProxyUrl("")).toBeNull();
  });

  function relocationFetch(body: unknown, status = 200) {
    return vi.fn<typeof fetch>(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));
  }

  it("relocates to an allowlisted proxyUrl from ai.json and caches it; fetches at most once a day", async () => {
    const dir = await tempDir();
    let now = Date.UTC(2026, 8, 25, 12);
    const fetchImpl = relocationFetch({ v: 1, proxyUrl: "https://ai.iliad.md" });
    const resolver = new ProxyEndpointResolver(dir, { builtinUrl: "https://iliad-ai.acct.workers.dev", fetchImpl, now: () => now });

    expect(await resolver.resolve()).toEqual({ ok: true, baseUrl: "https://iliad-ai.acct.workers.dev" });
    await resolver.settled();
    expect(await resolver.resolve()).toEqual({ ok: true, baseUrl: "https://ai.iliad.md" });
    await resolver.settled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const cacheFile = path.join(dir, "ai", "endpoint.json");
    expect(JSON.parse(await readFile(cacheFile, "utf8"))).toMatchObject({ proxyUrl: "https://ai.iliad.md" });
    expect(await mode(cacheFile)).toBe(0o600);

    // A new launch reads the cache without fetching again the same day.
    const next = new ProxyEndpointResolver(dir, { builtinUrl: "https://iliad-ai.acct.workers.dev", fetchImpl, now: () => now });
    expect(await next.resolve()).toEqual({ ok: true, baseUrl: "https://ai.iliad.md" });
    await next.settled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    now += 24 * 60 * 60 * 1000;
    await next.resolve();
    await next.settled();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["an off-allowlist host", { v: 1, proxyUrl: "https://evil.example.com" }],
    ["plain HTTP", { v: 1, proxyUrl: "http://ai.iliad.md" }],
    ["an unknown version", { v: 2, proxyUrl: "https://ai.iliad.md" }],
    ["garbage", "<html>"]
  ])("ignores %s", async (_name, body) => {
    const dir = await tempDir();
    const resolver = new ProxyEndpointResolver(dir, { builtinUrl: "https://iliad-ai.acct.workers.dev", fetchImpl: relocationFetch(body) });
    await resolver.resolve();
    await resolver.settled();
    expect(await resolver.resolve()).toEqual({ ok: true, baseUrl: "https://iliad-ai.acct.workers.dev" });
  });

  it("keeps the cached relocation when ai.json fails", async () => {
    const dir = await tempDir();
    await mkdir(path.join(dir, "ai"), { recursive: true });
    await writeFile(path.join(dir, "ai", "endpoint.json"), JSON.stringify({ proxyUrl: "https://ai.iliad.md", checkedAt: "2000-01-01T00:00:00.000Z" }));
    const fetchImpl = vi.fn<typeof fetch>(async () => { throw new TypeError("fetch failed"); });
    const resolver = new ProxyEndpointResolver(dir, { builtinUrl: "https://iliad-ai.acct.workers.dev", fetchImpl });
    expect(await resolver.resolve()).toEqual({ ok: true, baseUrl: "https://ai.iliad.md" });
    await resolver.settled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await resolver.resolve()).toEqual({ ok: true, baseUrl: "https://ai.iliad.md" });
  });

  it("uses the dev override without touching ai.json", async () => {
    const fetchImpl = relocationFetch({ v: 1, proxyUrl: "https://ai.iliad.md" });
    const resolver = new ProxyEndpointResolver(await tempDir(), { devOverrideUrl: "http://127.0.0.1:9", fetchImpl });
    expect(await resolver.resolve()).toEqual({ ok: true, baseUrl: "http://127.0.0.1:9" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports proxy_not_configured for a placeholder built-in URL", async () => {
    const resolver = new ProxyEndpointResolver(await tempDir(), {
      builtinUrl: "https://iliad-ai.REPLACE.workers.dev",
      fetchImpl: relocationFetch("", 404)
    });
    expect(await resolver.resolve()).toEqual({ ok: false, reason: "proxy_not_configured" });
    await resolver.settled();
  });
});

describe("streaming partials (moved from the Gemini module)", () => {
  it("keeps only whole words once three are stable", () => {
    expect(stableAutocompletePrefix("one two")).toBe("");
    expect(stableAutocompletePrefix("one two three fo")).toBe("one two three ");
    expect(stableAutocompletePrefix("una línea tranquila des")).toBe("una línea tranquila ");
  });

  it("emits growing prefixes at most every 100 ms and never with reasoning markers", () => {
    let now = 0;
    const emitted: string[] = [];
    const emit = createAutocompletePartialEmitter((text) => emitted.push(text), () => now);
    emit("one two three four");
    now = 50;
    emit("one two three four five six");
    now = 150;
    emit("one two three four five six");
    expect(emitted).toEqual(["one two three ", "one two three four five "]);

    const guarded: string[] = [];
    createAutocompletePartialEmitter((text) => guarded.push(text), () => 1000)("<|channel|>analysis one two three four");
    expect(guarded).toEqual([]);
  });
});
