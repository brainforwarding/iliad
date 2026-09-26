// Groq and Iliad AI proxy endpoints. Spec:
// specs/2026-09-25-groq-ai-free-tier.md §1 (routes, ai.json relocation), §6.

export const GROQ_API_BASE = "https://api.groq.com/openai/v1";
export const GROQ_CHAT_COMPLETIONS_URL = `${GROQ_API_BASE}/chat/completions`;
/** Key validation: lists models, uses no tokens (spec §6). */
export const GROQ_MODELS_URL = `${GROQ_API_BASE}/models`;
/** Longest key accepted before a network check (spec §6 shape check). */
export const GROQ_API_KEY_MAX_CHARS = 512;
/** Where "Get a key" in Writing assists sends the writer. */
export const GROQ_KEYS_PAGE_URL = "https://console.groq.com/keys";

// ---------------------------------------------------------------------------
// Free route: the Iliad AI proxy (Cloudflare Worker).
//
// >>> RELEASE BLOCKER: replace BOTH "REPLACE" placeholders below with the
// >>> Worker's real workers.dev account subdomain before shipping. While the
// >>> placeholder is present the free route refuses to send anything
// >>> (`free_unavailable`, detail `proxy_not_configured`): a placeholder host
// >>> could be registered by someone else, so text must never go there.

/** The Worker's built-in base URL (no path). Baked into each app version. */
export const ILIAD_AI_PROXY_BUILTIN_URL = "https://iliad-ai.REPLACE.workers.dev";

/**
 * The single allowlist for proxy hosts (built-in URL and `ai.json`
 * relocations). `*.` matches exactly one DNS label: workers under Iliad's
 * workers.dev account subdomain, plus the optional custom domain.
 */
export const ILIAD_AI_PROXY_HOST_ALLOWLIST: readonly string[] = ["*.REPLACE.workers.dev", "ai.iliad.md"];

/** Marker that means the proxy URL has not been set for this build. */
export const ILIAD_AI_PROXY_PLACEHOLDER = "REPLACE";

/** Optional relocation file: `{ "v": 1, "proxyUrl": "https://…" }` (spec §1). */
export const ILIAD_AI_RELOCATION_URL = "https://iliad.md/ai.json";
/** `ai.json` is fetched at most this often (and only with a free request). */
export const ILIAD_AI_RELOCATION_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Client name sent to `/v1/install` and in `X-Iliad-Client`. */
export const ILIAD_AI_CLIENT = "iliad-md";

/** Dev-only overrides (read only when the app is not packaged; spec §1). */
export const DEV_PROXY_URL_ENV = "ILIAD_AI_PROXY_URL";
export const DEV_GROQ_KEY_ENV = "GROQ_API_KEY";

function hostMatches(host: string, pattern: string): boolean {
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(1); // ".account.workers.dev"
    if (!host.endsWith(suffix)) return false;
    const label = host.slice(0, host.length - suffix.length);
    return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label);
  }
  return host === pattern;
}

/**
 * The normalized origin of an allowed proxy URL, or null. HTTPS only, default
 * port, no credentials, no path/query/fragment beyond "/", host on the allowlist.
 */
export function allowedProxyOrigin(value: unknown, allowlist: readonly string[] = ILIAD_AI_PROXY_HOST_ALLOWLIST): string | null {
  if (typeof value !== "string" || value.length > 256) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) return null;
  const host = url.hostname.toLowerCase();
  if (host.includes(ILIAD_AI_PROXY_PLACEHOLDER.toLowerCase())) return null;
  return allowlist.some((pattern) => hostMatches(host, pattern.toLowerCase())) ? url.origin : null;
}

/** True while the built-in URL still carries the placeholder (release blocker). */
export function proxyUrlIsPlaceholder(url: string): boolean {
  return url.includes(ILIAD_AI_PROXY_PLACEHOLDER);
}
