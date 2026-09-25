# Groq AI: Free by Default, Your Own Key Optional

Date: 2026-09-25
Status: v1 draft — for Codex xhigh review (not implemented)
Branch: `groq-ai-free-tier` (from `master` at `2cd1901`, Iliad MD 0.3.2)
ADR: ADR-0022 (draft, `docs/decisions.md`)
Design: Figma `i2BTwgceho8SqRYGZKjLhB`, page "AI: free + your Groq key
(2026-09-25)" (in progress; final UI details fold in from there)

## Reviewer brief

Review for: wrong assumptions about the current writing-AI code
(`electron/writing/`, `electron/ipc/{autocomplete,tighten,writingSettings}.ts`,
`src/editor/ideaAutocomplete/`, the ✦ AI overlay); whether the Worker's quota
accounting is really atomic and really bounded (per install, per IP, global
spend) under concurrency, aborts, crashes and the UTC day rollover; whether the
proxy can be used as a general-purpose free LLM; whether any document text can
reach logs or storage; reasoning-output leakage into suggestions; streaming and
cancel semantics end to end (renderer → main → Worker → Groq); the migration
off Gemini; and scope creep. Product decisions listed under "Decided" are
fixed by the owner; challenge the implementation, not the direction.

## Problem

Built-in AI (inline completion ⌘, ⌘. ⌘/ ⌘↵ and the ✦ AI selection menu) runs
only after the writer creates a Gemini key in Google AI Studio and pastes it
into Writing assists (ADR-0021). That is the first thing a new writer hits, it
reads as setup, and most people never do it. The owner wants AI to work on
first launch, free, with no account, and keep "bring your own key" for people
who want no limits or no Iliad server in the path.

## Decided (owner; not reopened here)

- Remove Gemini entirely. All built-in AI runs on Groq, model
  `openai/gpt-oss-120b`, `reasoning_effort: "low"`, streaming, over the
  OpenAI-compatible Chat Completions API at `https://api.groq.com/openai/v1`.
  Groq only: no model picker, no arbitrary OpenAI-compatible endpoint (later,
  for paid accounts).
- **Free by default**: no account, no setup. Requests go through an Iliad-run
  Cloudflare Worker ("Iliad AI proxy") that holds the Groq key as a secret and
  enforces three layers: per-install anonymous token quota (start 50
  requests/day), per-IP quota (start 150/day), global daily spend cap (start
  $5/day, estimated from Groq usage tokens at $0.15/1M input, $0.60/1M
  output). Limits live in Worker config and change without an app release.
  ✦ AI and completion share one quota. The Worker never stores or logs document
  text; only counters and costs. Identity must allow adding login (paid plan)
  later without a redesign.
- **BYOK**: the writer can paste their own Groq key; requests then go directly
  Mac → Groq, bypassing the proxy and its limits.
- No login now.
- UI shows no usage counters or remaining quota. It only says when the writer is
  out (their limit or the global cap), with a calm inline notice and "Use your
  own key".
- Privacy: free mode sends text through Iliad's server, so this needs an ADR
  updating `docs/product-vision.md`, a short privacy note (app and website), and
  honest copy.

## Goals

- G1 First launch: ⌘, / ⌘. / ⌘/ / ⌘↵ and ✦ AI work with no key, no account, no
  dialog.
- G2 One provider in the app (Groq, one model, one parameter set), with two
  routes: **free** (via the proxy) and **own key** (direct). Same prompts, same
  output cleaning, same review-first behavior on both.
- G3 A Worker that makes the free route safe to run in public: bounded daily
  spend no matter what clients do, per-install and per-network fairness, no
  text at rest or in logs, and no use as a general Groq gateway.
- G4 Gemini code, settings, strings, tests and docs are gone; saved Gemini keys
  are deleted from disk on first launch.
- G5 Honest disclosure of the free route in the app and on the website.

## Non-goals

- Login, accounts, payment, a paid plan (designed for, not built).
- Model picker, other providers, custom endpoints.
- Usage meters, quota displays, "n left today".
- Streaming the ✦ AI rewrite into the editor (the rewrite still lands whole in
  the inline review).
- Deploying the Worker or creating Cloudflare/Groq resources (the owner will
  provide access later). This change is code + docs only.
- Changing autocomplete interaction (keys, escalation, alternatives, Steer) or
  the inline review's safety checks.

## Current state (what exists today)

- `electron/writing/geminiText.ts` does one `generateContent` /
  `streamGenerateContent` call; `geminiAutocomplete.ts` parses Gemini SSE and
  emits stable-word partials (`stableAutocompletePrefix`, ≥100 ms apart);
  `writingAiService.ts` owns `autocompleteIdea`, `tightenSelection`,
  `writingAssistStatus`, Gemini finish-reason mapping, and diagnostics
  (`autocomplete.gemini.*`, `selection_ai.gemini.*`, no text).
- Prompts are provider-neutral already: `autocompleteInstructions` +
  `autocompleteModelInput` (`electron/writing/autocomplete.ts`) and
  `selectionTransformInstruction` + `tightenModelInput` (`tighten.ts`). Output
  cleaning (`cleanAutocompleteOutput`, `cleanTightenOutput`,
  `looksLikePreambleEcho`, `looksLikeTightenContextEcho`) runs in main after the
  provider call and is kept as is.
- Key storage: `userData/assistant/settings.json`, **plain JSON, file mode
  0600**, field `geminiApiKey` (not Keychain / `safeStorage`). Env fallbacks
  `GEMINI_API_KEY` / `GOOGLE_API_KEY`.
- IPC: `writing-assist:status`, `writing:get-gemini-key-state`,
  `writing:set-gemini-key`, `autocomplete:run|cancel|partial`,
  `tighten:run|cancel`; trust-gated (`isTrustedIpcSender`). Autocomplete is
  single-flight per sender with 18 s / 30 s (idea) timeouts; tighten 15 s.
- Renderer gating: `hasGeminiKey` in `src/App.tsx` gates ✦ AI (`enabled`) and
  automatic suggestions (`automaticEnabled: hasAiKey !== false` in
  `EditorPane.tsx`); without a key ✦ AI looks disabled and opens Writing
  assists at the key field.
- `relay/telegram/` (Cloudflare Worker package) and
  `scripts/benchmarkAutocomplete.mjs` / `npm run benchmark:autocomplete` were
  **removed** in `1de8393` (ADR-0021). They are recovered from `1de8393^` as
  templates: the relay's package layout (`package.json`, `tsconfig.json`,
  `wrangler.toml.example`, `src/`, `tests/`, root `relay:*` scripts), its
  `*Like` Cloudflare type shims, injected-storage unit tests without Wrangler,
  `crypto.ts` (Web Crypto HMAC/SHA-256, base64url, constant-time compare), and
  the benchmark's eight EN/ES cases.

## Design

### 1. Routes

```
renderer ──IPC──▶ main: WritingAiService ──▶ GroqClient ──┬─▶ Iliad AI proxy ──▶ Groq   (free)
                                                          └─▶ Groq                     (own key)
```

- Route selection in main, per request: own key saved (or `GROQ_API_KEY` in
  dev) → `own-key`; else → `free`. No silent fallback between routes: an own-key
  failure (invalid key, Groq 429) is shown as such, never retried through the
  free proxy, and a free-route "out" never uses a key the writer did not give.
- Dev overrides: `GROQ_API_KEY` (own-key route), `ILIAD_AI_PROXY_URL` (free
  route base URL, for `wrangler dev` or the fake server). Packaged builds ignore
  `ILIAD_AI_PROXY_URL` unless `ILIAD_DEV=1`, so a stray env var cannot reroute
  writers' text.
- The proxy base URL is a constant in `electron/writing/groq/config.ts`:
  `https://ai.iliad.md` (custom domain on the Worker; see Open questions).

### 2. App provider module (replaces Gemini)

New `electron/writing/groq/`:

- `prompts.ts` — **pure** (no Node/Electron imports): builds
  `{ messages, maxCompletionTokens }` from a typed `WritingAiTask`
  (autocomplete or selection) using the existing instruction/input builders,
  moved here from `autocomplete.ts` / `tighten.ts` (those files keep cleaning,
  validation and limits and re-export the builders). Also exports the pinned
  model params and the request limits. The Worker imports this file directly,
  so prompts, limits and token budgets have one source (section 4). A test
  fails if anything under `electron/writing/groq/prompts.ts`'s import graph
  imports `node:*`, `electron`, or DOM-only APIs.
- `sse.ts` — one OpenAI-compatible chat-completions SSE reader used for both
  routes: incremental UTF-8 decode, `\n\n` / `\r\n\r\n` frames, `data: [DONE]`,
  frame size cap (128 KB) and output cap (8,000 chars), reads **only**
  `choices[0].delta.content`; ignores `reasoning`, `reasoning_content`,
  `channel`, tool calls and any other field; tracks `finish_reason`; surfaces an
  in-band `{"error":{...}}` event as an `AgentRuntimeError`; honors the abort
  signal between reads and cancels the reader in `finally`.
- `client.ts` — `streamGroqText({ route, task, signal, onDelta })`:
  - own key: `POST https://api.groq.com/openai/v1/chat/completions` with
    `Authorization: Bearer <key>` and the body from `prompts.ts` plus the pinned
    params (below).
  - free: `POST <proxy>/v1/generate` with `Authorization: Bearer <install
    token>`, `X-Iliad-Client: iliad-md/<version>`, and the **structured task**
    (not messages; section 4). The response is the same SSE shape, so the same
    reader applies.
  - Maps HTTP/in-band errors to `AgentRuntimeError` codes (section 5). Never
    includes provider or proxy bodies in messages or diagnostics.
- `installToken.ts` — lazily obtains and stores the anonymous install token
  (section 3). No network call at launch; the first free request fetches it.
- `keyStore.ts` — own Groq key storage (section 6).

Pinned params (both routes; the Worker sets them itself on the free route):

```json
{ "model": "openai/gpt-oss-120b", "reasoning_effort": "low",
  "include_reasoning": false, "stream": true,
  "stream_options": { "include_usage": true },
  "max_completion_tokens": <per task>, "n": 1 }
```

No tools, no `response_format`, no `stop`, default temperature (tuned only if
the benchmark shows a reason). `max_completion_tokens` is treated as including
reasoning tokens (verify in Phase 0; budgets below leave headroom either way):
inline 512, sentence 768, paragraph 1024, idea 2048; selection transform
`min(6144, selectionTransformMaxOutputTokens(text, mode) + 1024)`.

`WritingAiService` keeps its public surface (`autocompleteIdea`,
`tightenSelection`, `writingAssistStatus`) so the IPC handlers and their
single-flight/timeouts are unchanged:

- Autocomplete: `onDelta` accumulates text and feeds the existing
  stable-word partial logic (`stableAutocompletePrefix`, moved from
  `geminiAutocomplete.ts` to `groq/partials.ts`). Returns the full text only on
  `finish_reason === "stop"`; `length` / `content_filter` / missing →
  `""` (no suggestion), exactly like today's non-`STOP` handling.
- Selection: aggregates the stream; `stop` → text; `length` →
  `output_truncated`; `content_filter` → `content_blocked`; anything else →
  `malformed_provider_response`. The IPC handler's cleaning and echo checks are
  unchanged.
- Reasoning leak guard (defense in depth, on top of reading `content` only): a
  suggestion or rewrite whose text contains harmony/control markers
  (`<|channel|>`, `<|message|>`, `<|start|>`, `<|end|>`, `<think>`) is
  discarded (`no_suggestion` / `malformed_provider_response`). Unit-tested.
- Diagnostics: `autocomplete.ai.completed|failed`,
  `selection_ai.ai.completed|failed` with `route`, `model`, `durationMs`,
  `firstDeltaMs`, `finishReason`, `outputTextChars`, `errorCode`; never text,
  keys, tokens, or proxy bodies. `agentErrorDiagnostic` prefix `GEMINI_` →
  `AI_`.

### 3. Anonymous install identity

- Token format (stateless, HMAC-signed by the Worker):
  `v1.<kid>.<base64url(JSON{sub,iat,kind})>.<base64url(HMAC-SHA256)>` where
  `sub = "inst_" + 128-bit random`, `kind = "install"`. The Worker verifies with
  `TOKEN_SIGNING_KEYS` (secret, JSON map `kid → key`, so keys rotate without
  invalidating live tokens). Nothing is stored per token; the only state is the
  daily counters.
- Issuance: `POST /v1/install` (body `{ "client": "iliad-md", "version" }`)
  returns `{ "token" }`. Rate limited per network key (section 4, default 5 new
  tokens/day per IPv4 or IPv6 /64). This bounds token farming; farming is also
  capped by the per-IP request quota and, ultimately, the global cap.
- App storage: `userData/ai/install.json` `{ token, issuedAt }`, mode 0600.
  Not Keychain: it is a quota handle, not a credential that protects anything
  of the writer's. No UI for it. A missing, corrupt, or 401-rejected token is
  replaced by one re-issue, then the request is retried once (never a loop).
- Login later: the proxy's quota subject is `subject = token.sub`, and limits
  are looked up by `token.kind` (`install` now; `account` later with a plan
  claim). A future `POST /v1/session` exchanges a login for a
  `kind: "account"` token with the same format; the counters, endpoints and app
  client do not change. Tokens carry no expiry now (`iat` only); account tokens
  will carry `exp`.
- No shared secret is embedded in the app to "sign requests": any secret in a
  distributed binary is public. The design assumes clients are untrusted and
  relies on quotas + the global cap, not on client authenticity. (App
  attestation / Turnstile are future options, section 10.)

### 4. Worker ("Iliad AI proxy")

Package `relay/ai-proxy/` (same layout and conventions as the removed
`relay/telegram/`): `package.json`, `tsconfig.json`, `wrangler.toml.example`,
`README.md`, `src/{worker,quotaObject,tokens,groq,sse,config,errors,
cloudflareTypes}.ts`, `tests/`. Root scripts `proxy:typecheck`, `proxy:test`.

**Endpoints** (all JSON errors `{ "error": { "code", "resetAt"? } }`, no CORS
headers — desktop only; browsers get no `Access-Control-Allow-Origin`):

| Route | Purpose |
| --- | --- |
| `POST /v1/install` | Issue an install token. |
| `POST /v1/generate` | One writing task; SSE response. |
| `GET /healthz` | `{ ok: true }` (no config, no counters). |
| `GET /v1/admin/stats?day=` | Aggregates only, `Authorization: Bearer ADMIN_TOKEN`. |

Everything else 404. Methods other than listed → 405. `Content-Type` must be
`application/json`; body ≤ 32 KB (checked on `Content-Length` and while
reading).

**What the app may send** (`POST /v1/generate`) — a structured task, never
chat messages, system prompts, model names or parameters:

```ts
type GenerateBody =
  | { v: 1; task: "autocomplete"; language: "en" | "es";
      kind: "inline" | "sentence" | "paragraph" | "idea"; trigger: "automatic" | "manual";
      extend: boolean; prefix: string; suffix: string; documentTitle: string;
      headingPath: string[]; nearbyHeadings: string[]; direction: string;
      guidance: string; avoid: string[] }
  | { v: 1; task: "selection"; language: "en" | "es"; mode: "tighten" | "edit";
      instruction?: string; text: string; selection: { from: number; to: number } };
```

The Worker validates every field against the same limits main enforces today
(prefix ≤ 2,500, suffix ≤ 1,000, title ≤ 120, ≤ 8 headings × 120, direction ≤
240, guidance ≤ 1,800, avoid ≤ 3 × 2,400; selection text ≤ 4,000, instruction ≤
1,000, `0 ≤ from < to ≤ text.length`; automatic ⇒ `kind = "inline"`), rejects
unknown fields and unknown `v` (`bad_request` / `client_outdated`), then builds
the messages with the shared `prompts.ts` and sets model and params itself.
Consequences:

- The proxy is not a general Groq gateway: system prompts are Iliad's, output
  length is pinned per task, and there is no messages/tools/model field to
  abuse. The residual "free LLM" surface is the ✦ AI typed instruction (≤ 1,000
  chars over ≤ 4,000 chars of text) and prompt injection inside document text;
  both are bounded by the same quotas and output caps, and have no side effects
  (no tools, no secrets in context, results only shown to the requester).
- Prompt changes ship in lockstep: the Worker must understand the `v` an app
  sends. Rule: **deploy the Worker before releasing an app with a new `v`**;
  the Worker keeps the previous `v`'s builder until the older app is below a
  threshold (in practice: two releases).

**Pipeline for `/v1/generate`:**

1. Kill switch: `FREE_TIER_ENABLED != "true"` → 503 `free_tier_disabled`.
   Client version below `MIN_CLIENT_VERSION` → 426 `client_outdated`.
2. Verify token → 401 `invalid_token`.
3. Validate and build the upstream request (400 `bad_request`, 413
   `too_large`).
4. Estimate cost: `inputTokens ≈ ceil(inputChars / 3) + 64` (conservative for
   EN/ES), `outputTokens = max_completion_tokens`; `reserveMicroUsd =
   in × INPUT_PRICE + out × OUTPUT_PRICE`.
5. **Reserve** in the day's quota Durable Object (atomic, below) →
   429 `quota_exhausted` (`scope: "install" | "network"`) or 429 `global_cap`,
   both with `resetAt` = next 00:00 UTC.
6. `fetch` Groq with the Worker secret `GROQ_API_KEY`, `signal` =
   `AbortSignal.any([request.signal, timeout])`. Upstream errors before the
   stream starts: 401/403 → 502 `upstream_error` (and an admin-stats counter;
   the writer is never told "invalid key" for Iliad's key); 429 → 503
   `upstream_busy` with `Retry-After` passthrough (capped 60 s); 5xx/other →
   502 `upstream_error`; no first byte in 10 s → 504 `upstream_timeout`.
7. Stream: a `TransformStream` re-emits OpenAI-compatible chunks containing
   only `choices[0].delta.content` and `finish_reason` (reasoning and every
   other field dropped), captures the final `usage` chunk (or
   `x_groq.usage`, whichever Groq sends; both handled) and does **not** forward
   it. Idle > 15 s between upstream chunks or total > 45 s → in-band
   `data: {"error":{"code":"upstream_timeout"}}` then close. Upstream stream
   errors → in-band `upstream_error`.
8. **Settle** via `ctx.waitUntil`: actual cost from usage if present; if the
   client aborted or usage is missing, `in_estimate + ceil(forwardedChars / 3)`
   output tokens (reasoning tokens unknown → add the per-kind reasoning
   allowance, 256). Settle never lowers the request count; it only replaces the
   reservation amount with the actual/estimated amount.

Client abort propagates: the app aborting its fetch disconnects the Worker
request; with the `enable_request_signal` compatibility flag `request.signal`
aborts the upstream Groq fetch, so an abandoned suggestion stops costing output
tokens. (Test in miniflare; if the flag is unavailable, fall back to detecting
a failed `writer.write` on the client side of the transform.)

**Counters: Durable Objects, not KV.**

- KV is eventually consistent with last-writer-wins and ~1 write/s per key:
  concurrent requests would read the same count and overspend; a spend cap
  built on KV is not a cap. D1 would work but adds a SQL round trip on every
  request for no gain. A Durable Object is single-threaded with transactional
  storage, so check-and-increment for all three layers happens in one atomic
  step.
- Topology: one DO per UTC day, named `quota:YYYY-MM-DD` (SQLite-backed).
  Day rollover is structural: the Worker picks the name from the request's
  arrival time (UTC); a request that straddles midnight settles into the DO that
  reserved it (the reservation carries its day). Each DO sets an alarm for
  day + 2 and deletes all its storage then, so counters live ≤ 48 h.
- Tables: `subjects(subject PK, count)`, `networks(netkey PK, count, installs)`,
  `global(k PK, count, reserved_micro, spent_micro)`,
  `reservations(id PK, subject, netkey, micro, created)` (rows removed on
  settle; unsettled rows older than 5 min are settled at their reservation by
  the alarm), `errors(code PK, count)`.
- Reserve (single `transactionSync`): read limits from the request (config is
  passed in from Worker env, so a limit change applies on the next request);
  reject if `subjects.count ≥ INSTALL_DAILY_REQUESTS`, `networks.count ≥
  IP_DAILY_REQUESTS`, or `spent + reserved + reserve > GLOBAL_DAILY_MICRO_USD`;
  otherwise increment both counts and `reserved`. Returns the reservation id.
- Throughput: all requests of a day serialize through one DO. At $5/day the
  ceiling is on the order of 10⁴ requests/day (section 9), far below one DO's
  capacity. Sharding plan when needed: per-subject and per-network DOs for the
  request counts plus the single day DO for spend only (spend is the only
  truly global check).
- Why not the Workers Rate Limiting binding: it is per-location, approximate,
  and has only short windows; fine as an extra WAF-style burst limiter, not for
  daily quotas or spend.

**Network key (per-IP quota):** from `CF-Connecting-IP` only (never
`X-Forwarded-For`). IPv4 → the full address; IPv6 → the /64 prefix. Stored as
`HMAC-SHA256(IP_HASH_KEY, day + ":" + prefix)` truncated to 16 bytes, so stored
keys are not IPs, and are not linkable across days. Shared networks (schools,
offices, CGNAT) are the known cost of a per-IP cap; 150/day is 3× the install
quota, and the limit is config.

**Config** (`[vars]` in `wrangler.toml`; secrets via `wrangler secret put`):

| Name | Default | Notes |
| --- | --- | --- |
| `FREE_TIER_ENABLED` | `"true"` | Kill switch. |
| `INSTALL_DAILY_REQUESTS` | `50` | Per `sub`, per UTC day. |
| `IP_DAILY_REQUESTS` | `150` | Per network key. |
| `IP_DAILY_NEW_INSTALLS` | `5` | Token issuance per network key. |
| `GLOBAL_DAILY_USD` | `5` | Spend cap. |
| `INPUT_USD_PER_MTOK` / `OUTPUT_USD_PER_MTOK` | `0.15` / `0.60` | Cost estimate. |
| `MIN_CLIENT_VERSION` | `0.4.0` | Below → `client_outdated`. |
| secrets | `GROQ_API_KEY`, `TOKEN_SIGNING_KEYS`, `IP_HASH_KEY`, `ADMIN_TOKEN` | Never in the repo. |

Changing a var is `wrangler deploy` (or the dashboard) — seconds, no app
release. Config is parsed and validated on each request; invalid config fails
closed (503 `free_tier_disabled`) rather than open.

**No text at rest or in logs.**

- The Worker never calls `console.*` with request bodies, prompts, outputs, or
  Groq error bodies; errors log only `{ code, status }`. A test greps `src/`
  for `console.` and allows only the structured logger, whose type accepts no
  strings other than enum codes.
- Workers observability: invocation logs contain method, URL path, status,
  and the connecting IP; keep them off (`[observability] enabled = false`) at
  launch, or on with head sampling if needed for debugging, documented in the
  privacy note. No Logpush, no Tail Workers.
- Durable Object storage holds only: subjects, hashed network keys, counts,
  microdollars, reservation ids, error-code counts.
- Groq side: enable **Zero Data Retention** in the Groq org's Data Controls
  (by default Groq keeps inference data up to 30 days only for abuse and
  reliability; ZDR removes that). Deployment checklist item.

**Abuse considerations** (bounded, not prevented): scripted clients using the
API directly (limited by install/IP quotas and output caps); token farming
(issuance limit per network); distributed abuse from many IPs (the global cap
bounds cost, but a determined attacker can exhaust the free tier for everyone
for a day — detection via admin stats, response: lower caps, WAF rules, kill
switch; Turnstile/attestation later); oversized or malformed bodies (32 KB,
schema); upstream key compromise (secret only in Worker; Groq console spend
limit as a second, independent cap).

### 5. Error contract

| Proxy code | HTTP | App `AgentErrorCode` | Autocomplete reason | ✦ AI reason |
| --- | --- | --- | --- | --- |
| `quota_exhausted` | 429 | `free_quota_exhausted` | `free_exhausted` | `free_exhausted` |
| `global_cap` | 429 | `free_global_cap` | `free_global_cap` | `free_global_cap` |
| `free_tier_disabled` | 503 | `free_unavailable` | `free_unavailable` | `free_unavailable` |
| `client_outdated` | 426 | `client_outdated` | `client_outdated` | `client_outdated` |
| `invalid_token` | 401 | (re-issue once, retry once) → `provider_unavailable` | `provider` | `provider` |
| `upstream_busy` | 503 | `rate_limited` | `rate_limited` | `rate_limited` |
| `upstream_error` / `upstream_timeout` | 502 / 504 / in-band | `provider_unavailable` / `request_timeout` | `provider` / `timeout` | `provider` / `timeout` |
| `bad_request` / `too_large` | 400 / 413 | `provider_unavailable` (bug; logged by code) | `provider` / `too_long` | `provider` / `too_long` |
| own key: Groq 401/403 | — | `invalid_api_key` | `invalid_api_key` | `invalid_api_key` |
| own key: Groq 429 | — | `rate_limited` | `rate_limited` | `rate_limited` |

`resetAt` from the proxy is kept in main; the renderer uses it only to pause
automatic requests until then (no display of time or counts). `quota_exhausted`
with `scope: "network"` uses the same copy as the per-install limit (the writer
cannot tell the difference and does not need to).

Renderer changes: `IdeaAutocompleteFailureReason` / `TightenFailureReason` gain
`free_exhausted`, `free_global_cap`, `free_unavailable`, `client_outdated`;
`no_key` is removed (there is always a route). Autocomplete cooldowns: the
three free "out" reasons suspend **automatic** requests until `resetAt` (or
until an own key is saved); manual requests still run and show the notice
again. `rate_limited` keeps today's cooldown.

### 6. Key storage and settings

- Own Groq key: `userData/ai/settings.json` field `groqApiKey`, encrypted with
  Electron `safeStorage` (Keychain-backed on macOS) and stored as base64
  (`groqApiKeyEnc`); plaintext is never written. If
  `safeStorage.isEncryptionAvailable()` is false (should not happen on macOS),
  fall back to today's 0600 plaintext file and record `storage: "plain"`.
  Mode 0600 either way.
- Validation on save: `GET https://api.groq.com/openai/v1/models` with the key
  (no tokens used). 401/403 → reject with "Groq didn't accept this key";
  network failure → save anyway and say it could not be checked. Shape check:
  no whitespace, ≤ 512 chars (keys start with `gsk_`; do not require it).
- `last4` for display only.
- Migration: on first launch of the new version, `WritingSettingsStore`
  rewrites `userData/assistant/settings.json` **without** `geminiApiKey`
  (other historical fields preserved, as today), and never reads it again. If
  the file then has no fields left, delete it. `GEMINI_API_KEY` /
  `GOOGLE_API_KEY` are no longer read.

IPC (update handler, preload and `src/types/iliad.ts` together; preload surface
test):

- `writing-assist:status` → `WritingAssistStatus`:
  `{ corrector, ai: { route: "free" | "own-key", model: "openai/gpt-oss-120b",
  freeState: "ok" | "exhausted" | "global_cap" | "unavailable" | "outdated",
  resetAt: string | null }, groqKey: { hasKey, last4 } }`. `freeState` is the
  last known state from a proxy response this UTC day (main memory only;
  starts `ok`). No counts.
- `writing:get-gemini-key-state` / `writing:set-gemini-key` →
  `writing:get-groq-key-state` / `writing:set-groq-key` (validate in main).
- `autocomplete:*`, `tighten:*` unchanged.

### 7. Prompt porting

- Gemini `systemInstruction` → `{ role: "system" }`; Gemini user content →
  `{ role: "user" }`. The instruction and input builders are unchanged in
  content (they are already provider-neutral); markers
  (`<<<PREFIX>>>`, `<<<ILIAD_TIGHTEN_SELECTION_START>>>`) stay.
- gpt-oss specifics added to the system prompt (EN/ES): "Reply with the
  insertion text only. No quotes, no Markdown code fences, no commentary." The
  harmony format's channels are handled by Groq; with `include_reasoning:
  false` and the `content`-only reader, analysis text cannot reach the cleaner.
- gpt-oss tendencies to test for in the benchmark and cleaners: wrapping output
  in quotes (already unwrapped), leading "Sure," (already rejected), Markdown
  bold on rewrites, echoing the prefix tail (`removeEchoedPrefix`), and
  `finish_reason: "length"` when low reasoning still exhausts a small budget
  (budgets above; Phase 0 measures it).
- Token budgets move from `geminiSelectionTransformMaxOutputTokens` /
  per-kind Gemini numbers to `prompts.ts` (section 2).

### 8. UI states and copy (EN / ES)

Final layout from the Figma page; behavior and copy here. Tone: calm, no
exclamation marks, no numbers.

Writing assists menu (settings only):

- Free route: no key field at the top anymore. Bottom row, quiet:
  "AI: free · Use your own Groq key" / "IA: gratis · Usar tu propia clave de
  Groq". Under it the privacy line:
  EN "Free AI sends the text near your cursor or selection through Iliad's
  server to Groq. Nothing is stored." + link "Privacy".
  ES "La IA gratis envía el texto cerca del cursor o de la selección a Groq a
  través del servidor de Iliad. No se guarda nada." + "Privacidad".
- "Use your own Groq key" expands the key field: label "Groq API key" / "Clave
  API de Groq"; placeholder "Paste your Groq API key" / "Pega tu clave API de
  Groq"; hint "Goes straight to Groq, with no daily limit from Iliad. Groq
  offers free keys." / "Va directo a Groq, sin límite diario de Iliad. Groq
  ofrece claves gratis."; buttons Save / Cancel / "Get a key"
  (`https://console.groq.com/keys`) — "Guardar" / "Cancelar" / "Obtener una
  clave".
- Own-key route: "Groq key ••••1234 · Change · Remove" / "Clave de Groq
  ••••1234 · Cambiar · Quitar". Privacy line: "Your text goes straight to
  Groq." / "Tu texto va directo a Groq."
- Save errors: "Groq didn't accept this key." / "Groq no aceptó esta clave.";
  "Saved. Iliad couldn't check it right now." / "Guardada. Iliad no pudo
  comprobarla ahora."; generic "Could not save the key. Try again." (existing).

Inline notices (in the autocomplete status spot near the cursor and in the ✦ AI
overlay; each with a "Use your own key" / "Usar tu propia clave" button that
opens Writing assists at the key field, reusing today's
`requestGeminiKey` → `requestGroqKey` flow):

| State | EN | ES |
| --- | --- | --- |
| Your limit / network limit | You've used today's free AI. It's back tomorrow. | Ya usaste la IA gratis de hoy. Vuelve mañana. |
| Global cap | Free AI has reached today's limit for everyone. It's back tomorrow. | La IA gratis llegó al límite de hoy para todos. Vuelve mañana. |
| Kill switch | Free AI is paused right now. | La IA gratis está en pausa por ahora. |
| Outdated | Update Iliad to keep using free AI. | Actualiza Iliad para seguir usando la IA gratis. |
| Proxy unreachable | Free AI isn't reachable. Check your connection. | No se pudo conectar con la IA gratis. Revisa tu conexión. |
| Own key rejected | Groq rejected your key. Check it in Writing assists. | Groq rechazó tu clave. Revísala en Ayudas de escritura. |
| Own key rate-limited | Your Groq key hit its rate limit. Try again shortly. | Tu clave de Groq llegó a su límite. Intenta de nuevo en un momento. |

Automatic suggestions show a notice at most once per session per state; manual
requests (keys, ✦ AI) always show it. ✦ AI is enabled on first launch (the
"disabled until key" styling in `src/styles/editor.css` is removed).

Strings: all `geminiKey*`, `noKey`, `addKey`, `editNoKey`, `noProvider`,
`autocompleteNeedsKey` and Gemini mentions in `src/i18n/strings.ts` are
removed or replaced by the keys above, EN and ES together.

### 9. Cost model and monitoring

Token estimates per request (EN/ES; ~3.5 chars/token; instructions ≈ 350
tokens; reasoning at `low` ≈ 50–250 tokens, to be measured):

| Request | Input tok | Output tok (incl. reasoning) | Cost |
| --- | --- | --- | --- |
| inline / automatic | ~1,300 | ~150 | ~$0.00029 |
| sentence | ~1,300 | ~250 | ~$0.00035 |
| paragraph | ~1,300 | ~400 | ~$0.00044 |
| idea | ~1,400 | ~900 | ~$0.00075 |
| ✦ AI, 1,500-char selection | ~1,000 | ~800 | ~$0.00063 |
| ✦ AI worst case (4,000 chars, edit) | ~1,700 | ~6,144 cap | ~$0.0039 |

- A fully used install (50 mixed requests) ≈ $0.02–0.04/day. $5/day ≈ 10k–15k
  typical requests ≈ 150–250 writers using the full quota daily (many more at
  typical use). Monthly worst case $150 Groq + Cloudflare Workers Paid $5.
- The reservation uses the cap (`max_completion_tokens`), so near the cap the
  Worker refuses slightly early rather than overspending; settle releases the
  difference.
- Monitoring: `GET /v1/admin/stats` (per day: requests, installs issued,
  distinct subjects, spent/reserved micro-USD, refusals by code, upstream
  errors by status). Groq console usage + an org **spend limit** (e.g. $200 /
  month) as an independent backstop. Cloudflare analytics for request volume.
  A weekly manual check at launch; alerting is future work.

### 10. Future (designed for, not built)

- Login + paid plan: `kind: "account"` tokens with `plan` and `exp`; limits by
  plan in config; the same `/v1/generate`. Paid accounts may later get a model
  picker or custom OpenAI-compatible endpoints (app-side routes).
- Turnstile or App Attest style checks on `/v1/install` if farming appears.
- Sharded counters (section 4) past ~10⁵ requests/day.

## Removal list

- Delete: `electron/writing/geminiText.ts`, `geminiAutocomplete.ts`,
  `tests/writing/geminiAutocomplete.test.ts`; Gemini parts of
  `writingAiService.ts`, `settingsStore.ts`, `errors.ts`
  (`missingGeminiKeyError`), `tighten.ts` (`TIGHTEN_GEMINI_THINKING_BUDGET`,
  `geminiSelectionTransformMaxOutputTokens`), `electron/ipc/writingSettings.ts`,
  `electron/preload.ts`, `src/types/iliad.ts` (`GeminiKeyState`,
  `provider: "gemini-api"`), `src/App.tsx`, `src/components/EditorPane.tsx`,
  `src/components/WritingAssistsMenu.tsx` (`GEMINI_KEY_URL`, `GeminiKeyRow`),
  `src/editor/selectionComments/overlay.tsx`, `src/styles/editor.css`,
  `src/i18n/strings.ts`, `tests/manual/autocomplete.tsx`, and tests
  (`writingAiService`, `agentErrors`, `tighten`, `writingAssistsMenu`,
  `preloadSurface`).
- Docs: `README.md` ("Gemini key" section → "AI: free, or your own Groq key"),
  `CLAUDE.md` (Gemini mentions), `docs/architecture.md` ("Writing AI and
  Outside Review"), `docs/product-vision.md` ("One Gemini key powers it" →
  new rule, per ADR-0022), `docs/decisions.md` (ADR-0022 accepted; ADR-0021
  amended by it), `docs/backlog.md`, `docs/research/writing-autocomplete-2026-09.md`
  (append a dated "Groq route" note; do not rewrite history).
- Release notes: "Built-in AI is now free and needs no setup. It runs on Groq
  (gpt-oss-120b) through Iliad's server, with a daily limit. You can add your
  own Groq key for no limit and a direct connection. Gemini is no longer
  supported; saved Gemini keys were removed from this Mac."

## Tests

App (root `npm test`):

- `groq/sse.ts`: chunks split mid-UTF-8 and mid-frame; `\r\n` frames; `[DONE]`;
  reasoning/reasoning_content/channel fields ignored; in-band error; frame and
  output caps; abort between reads cancels the reader; missing
  `finish_reason`.
- Leak guard: content containing `<|channel|>analysis` or `<think>` →
  discarded.
- `groq/client.ts` against a **fake Groq server** (local `http.createServer`
  emitting scripted SSE, used by both routes with the free route pointing at a
  fake proxy): request body pins model and params; own-key 401/429 mapping;
  proxy 429 `quota_exhausted` / `global_cap` / 426 / 503 mapping; 401
  `invalid_token` → one re-issue + one retry, never a loop; abort mid-stream
  closes the socket (server observes close).
- `installToken.ts`: lazy issuance, 0600 file, corrupt file → re-issue, no
  network at construction.
- `keyStore.ts`: safeStorage round trip (mocked), plaintext never written,
  migration deletes `geminiApiKey` and keeps other fields, env Gemini vars
  ignored.
- `prompts.ts` purity (import-graph test) and snapshot tests of messages per
  task/kind/language.
- `WritingAiService`: route selection (key → own-key, none → free, no
  fallback), finish-reason mapping, diagnostics contain no text (assert on the
  logged object).
- IPC: status shape, set-groq-key validation, preload surface.
- Renderer: new failure reasons map to the copy; automatic requests suspended
  until `resetAt` after `free_exhausted`, manual still runs; ✦ AI enabled with
  no key; Writing assists menu free/own-key states (EN/ES).

Worker (`relay/ai-proxy/tests`, run by root `npm test` and `npm run
proxy:test`; injected storage/clock/fetch like the old relay tests):

- Tokens: sign/verify, `kid` rotation, tampered payload/signature, unknown kid.
- Validation: every limit ±1, unknown fields, wrong `v`, automatic with
  non-inline kind, 32 KB body cap, wrong content type/method.
- Quota core (pure class over an injected transactional store): install limit
  at 49/50/51; network limit across two installs; IPv6 addresses in the same
  /64 share a key, different /64 do not; global cap with reservations; settle
  lowers reserved and sets spent; abort settles with the estimate; unsettled
  reservation swept by alarm; concurrent reserves (interleaved promises) never
  exceed a limit; day rollover (23:59:59.999 vs 00:00 UTC) uses a new DO and a
  straddling request settles to its reservation day; config change applies on
  the next request; invalid config fails closed.
- Streaming: reasoning deltas stripped; usage captured and not forwarded;
  `x_groq.usage` variant; upstream error mid-stream → in-band error; idle and
  total timeouts; client abort aborts the upstream fetch.
- Privacy: `console` spy sees no body/prompt/output strings in any test; DO
  storage dump contains only allowed keys.
- Integration (package-local, `npm --prefix relay/ai-proxy run test:workers`,
  `@cloudflare/vitest-pool-workers`/miniflare; not in root `npm test` because
  it needs Wrangler): real SQLite DO transactions, `enable_request_signal`
  abort propagation, alarms.

## Benchmark

Restore `npm run benchmark:autocomplete` (`scripts/benchmarkAutocomplete.mjs`,
recovered from `1de8393^`) on Groq:

- Routes: `GROQ_API_KEY` → direct; `ILIAD_AI_PROXY_URL` + a dev token → via the
  proxy (measures proxy overhead). `--dry-run` makes no requests.
- Cases: the eight EN/ES autocomplete cases plus four selection cases (tighten
  and edit, EN/ES) and one idea case.
- Report per route and kind: first-visible p50/p95, complete p50/p95,
  cleaner-accepted rate, `finish_reason` distribution (esp. `length`),
  reasoning-leak detections, usage tokens and estimated cost per case (feeds
  section 9). No prose or keys in output.

## Manual QA

1. Fresh profile (no `userData`): launch, type, ⌘, → suggestion appears; ⌥↓
   another; select text → ✦ AI → Shorten → inline review; Tab accepts.
2. Proxy down (`ILIAD_AI_PROXY_URL` to a closed port, dev build): calm
   "isn't reachable" notice; editor unaffected.
3. Out: point at `wrangler dev` with `INSTALL_DAILY_REQUESTS=2`; third request
   shows the notice + "Use your own key"; automatic suggestions stop; manual
   shows the notice again. Same with `GLOBAL_DAILY_USD=0.0001`.
4. Add own key → requests go direct (verify with the proxy stopped); remove key
   → back to free.
5. Invalid own key on save; revoked own key after save → "Groq rejected your
   key".
6. Upgrade from 0.3.x with a saved Gemini key → key gone from
   `assistant/settings.json`, no Gemini copy anywhere, AI works free.
7. Cancel paths: type through a streaming suggestion, Esc during ✦ AI, switch
   documents mid-request; `wrangler dev` shows the upstream request aborted.
8. EN and ES copy in every state; VoiceOver announces notices.

## Deployment (later, by the owner; not in this change)

1. Cloudflare: Workers Paid plan (recommended for CPU headroom), custom domain
   `ai.iliad.md` routed to the Worker.
2. Groq: org on the Developer tier, **ZDR enabled** in Data Controls, a
   dedicated API key for the proxy, an org spend limit.
3. `cp wrangler.toml.example wrangler.toml`; set vars; `wrangler secret put
   GROQ_API_KEY`, `TOKEN_SIGNING_KEYS`, `IP_HASH_KEY`, `ADMIN_TOKEN`.
4. `wrangler deploy`; smoke: `/healthz`, `/v1/install`, one `/v1/generate`
   with a dev token, `/v1/admin/stats`.
5. Only then release the app version that uses it (it must not ship pointing
   at an undeployed URL). Website privacy page live before the release.

## Phased plan

- **Phase 0 — measure** (no product change): Groq direct client + benchmark on
  the owner's key; confirm reasoning never leaks, budgets rarely hit `length`,
  latency p95 for sentence < 1.5 s; tune per-kind budgets/prompt lines.
- **Phase 1 — app**: provider module, own-key route, Gemini removal, key
  migration, status/IPC, strings, UI states against a fake proxy.
- **Phase 2 — Worker**: `relay/ai-proxy/` with unit + integration tests;
  `wrangler dev` QA with the app.
- **Phase 3 — docs and release**: ADR-0022 accepted, product-vision rule,
  architecture section, README, privacy note (app + website), release notes;
  deploy the Worker, then release. Phases 1–3 ship together: an app without
  the proxy would require a key again.
- **Later**: login + paid plan; attestation; sharding; other providers for paid
  accounts.

## Risks

- A distributed abuser exhausts the global cap daily → free AI "out" for
  everyone. Mitigations above; accepted for launch.
- Per-IP cap hurts shared networks (classrooms, offices). Config lever.
- gpt-oss quality in Spanish and for short inline continuations is unproven
  vs Gemini; Phase 0 gates the switch.
- Groq `usage` shape or `include_reasoning` behavior differs from docs →
  cost falls back to estimates (conservative), leak guard still holds.
- Prompt-version lockstep between app and Worker can break older apps if the
  Worker drops a `v` too early.
- Trust: some writers will not want text on Iliad's server. The privacy line,
  own-key route and the Autocomplete switch are the answers; see Open
  questions for a stronger opt-out.

## Open questions for the owner

1. **Automatic suggestions in free mode.** Automatic inline suggestions fire
   after a 450 ms pause; at 50/day they would use the free quota within minutes
   of writing and send text without an explicit action. Proposal: in free
   mode, automatic suggestions are off (explicit keys and ✦ AI only), with the
   switch note "Needs your own Groq key"; own key turns them on as today.
   Alternative: allow them and accept fast exhaustion.
2. Proxy URL: `ai.iliad.md` (custom domain, movable) vs a `workers.dev` URL.
3. `MIN_CLIENT_VERSION` / version: is the next release 0.4.0?
4. Should there be an explicit "Built-in AI off" switch (hides ✦ AI too) for
   writers who never want text to leave the Mac? Today only Autocomplete has a
   switch.
5. Own key storage: the spec upgrades to `safeStorage` (Keychain-backed); today's
   Gemini key was plaintext 0600 JSON. OK?

## Review

(pending — Codex xhigh)
