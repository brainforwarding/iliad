// Which proxy the free route talks to (spec §1).
//
// Order: dev override (`ILIAD_AI_PROXY_URL`, only when not packaged) → a
// relocation from `https://iliad.md/ai.json` cached in
// `userData/ai/endpoint.json` → the built-in URL. `ai.json` is fetched lazily
// (never at launch), in the background of a free request so it adds no
// latency, and at most once a day. Only `proxyUrl` is read, and only if it is
// HTTPS on the compiled-in allowlist; any failure keeps the cached or
// built-in URL.

import path from "node:path";
import {
  ILIAD_AI_PROXY_BUILTIN_URL,
  ILIAD_AI_RELOCATION_INTERVAL_MS,
  ILIAD_AI_RELOCATION_URL,
  allowedProxyOrigin,
  proxyUrlIsPlaceholder
} from "./config.js";
import { readPrivateJson, writePrivateJsonAtomic } from "./privateFile.js";

const RELOCATION_MAX_BYTES = 4096;
const RELOCATION_TIMEOUT_MS = 5000;

export function endpointCachePath(userDataPath: string) {
  return path.join(userDataPath, "ai", "endpoint.json");
}

export interface ProxyEndpointOptions {
  /** Dev override base URL (already gated on `!app.isPackaged` by the caller). */
  devOverrideUrl?: string | null;
  builtinUrl?: string;
  relocationUrl?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export type ProxyEndpoint = { ok: true; baseUrl: string } | { ok: false; reason: "proxy_not_configured" };

/** Parses the dev override: http(s) URL without credentials; returns its origin (plus path, trailing slash trimmed). */
export function parseDevProxyUrl(value: string | undefined | null): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

export class ProxyEndpointResolver {
  private readonly cachePath: string;
  private readonly devOverrideUrl: string | null;
  private readonly builtinUrl: string;
  private readonly relocationUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private cache: { proxyUrl: string | null; checkedAt: number } | null | undefined;
  private refreshing: Promise<void> | null = null;

  constructor(userDataPath: string, options: ProxyEndpointOptions = {}) {
    this.cachePath = endpointCachePath(userDataPath);
    this.devOverrideUrl = options.devOverrideUrl ?? null;
    this.builtinUrl = options.builtinUrl ?? ILIAD_AI_PROXY_BUILTIN_URL;
    this.relocationUrl = options.relocationUrl ?? ILIAD_AI_RELOCATION_URL;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  /** The base URL for this free request; may start a background `ai.json` check. */
  async resolve(): Promise<ProxyEndpoint> {
    if (this.devOverrideUrl) return { ok: true, baseUrl: this.devOverrideUrl };

    const cache = await this.readCache();
    if (!cache || this.now() - cache.checkedAt >= ILIAD_AI_RELOCATION_INTERVAL_MS) {
      void this.refreshInBackground();
    }

    const relocated = cache?.proxyUrl ? allowedProxyOrigin(cache.proxyUrl) : null;
    if (relocated) return { ok: true, baseUrl: relocated };
    if (proxyUrlIsPlaceholder(this.builtinUrl)) return { ok: false, reason: "proxy_not_configured" };
    return { ok: true, baseUrl: this.builtinUrl.replace(/\/+$/, "") };
  }

  /** For tests: resolves once a background refresh (if any) settles. */
  async settled(): Promise<void> {
    await this.refreshing;
  }

  private refreshInBackground(): Promise<void> {
    if (!this.refreshing) {
      this.refreshing = this.refresh().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  private async refresh(): Promise<void> {
    const previous = this.cache?.proxyUrl ?? null;
    let proxyUrl = previous;

    try {
      const response = await this.fetchImpl(this.relocationUrl, {
        method: "GET",
        headers: { Accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(RELOCATION_TIMEOUT_MS)
      });
      if (response.ok) {
        const text = await response.text();
        if (text.length <= RELOCATION_MAX_BYTES) {
          const parsed = JSON.parse(text) as unknown;
          if (parsed && typeof parsed === "object" && (parsed as { v?: unknown }).v === 1) {
            const candidate = allowedProxyOrigin((parsed as { proxyUrl?: unknown }).proxyUrl);
            // An off-allowlist or missing proxyUrl is ignored (keeps what we had).
            if (candidate) proxyUrl = candidate;
          }
        }
      } else {
        await response.body?.cancel().catch(() => undefined);
      }
    } catch {
      // Network, timeout or parse failure: keep the cached or built-in URL.
    }

    // Record the attempt either way, so ai.json is fetched at most once a day.
    this.cache = { proxyUrl, checkedAt: this.now() };
    await writePrivateJsonAtomic(this.cachePath, {
      ...(proxyUrl ? { proxyUrl } : {}),
      checkedAt: new Date(this.cache.checkedAt).toISOString()
    }).catch(() => undefined);
  }

  private async readCache() {
    if (this.cache !== undefined) return this.cache;
    const stored = await readPrivateJson(this.cachePath);
    if (stored.kind !== "ok") {
      this.cache = null;
      return null;
    }
    const checkedAt = typeof stored.value.checkedAt === "string" ? Date.parse(stored.value.checkedAt) : Number.NaN;
    this.cache = {
      proxyUrl: allowedProxyOrigin(stored.value.proxyUrl),
      checkedAt: Number.isFinite(checkedAt) && checkedAt <= this.now() ? checkedAt : 0
    };
    return this.cache;
  }
}
