# Groq AI: Free by Default, Your Own Key Optional

Date: 2026-09-25
Status: v4 — aligned with the writing-assists spec (automatic suggestions
and writing notes removed there); v3 folded in the Codex xhigh review. Not
implemented. Implementation starts after the writing-assists spec ships on
`master` and is gated on the Phase 0 probes.
Related: [`2026-09-25-writing-assists-one-row.md`](./2026-09-25-writing-assists-one-row.md)
owns the Writing assists menu layout, the removal of automatic suggestions and
writing notes, the always-on announcement, the Privacy row, and ⌘↵. This spec
owns the provider, proxy, quota, key storage, notices, and the privacy page
content for the Groq release.
Branch: `groq-ai-free-tier` (from `master` at `2cd1901`, Iliad MD 0.3.2)
ADR: ADR-0023 (draft, `docs/decisions.md`)
Design: Figma `i2BTwgceho8SqRYGZKjLhB`, page "AI: free + your Groq key
(2026-09-25)" (node `42:2`); it is the source of truth for layout.

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

Built-in AI (inline completion ⌘, ⌘. ⌘/ and the ✦ AI selection menu) runs
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
- UI shows no usage counters or remaining quota, ever. It only says when the
  writer is out, with one calm inline notice for both the per-user and the
  global limit, showing the local reset time, plus "Use my key".
  The notice appears only on explicit requests.
- Quotas reset at 00:00 UTC; the Worker returns `resetAt` (ISO 8601) with
  every quota refusal.
- An own key is validated against Groq before it is saved. No silent fallback
  when an own key fails.
- Spanish UI uses "clave" (never "llave").
- Privacy: free mode sends text through Iliad's server, so this needs an ADR
  updating `docs/product-vision.md`, a short privacy note (app and website), and
  honest copy.

## Goals

- G1 First launch: ⌘, / ⌘. / ⌘/ and ✦ AI work with no key, no account, no
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
- Changing autocomplete interaction (keys, alternatives, Steer) or the inline
  review's safety checks; the writing-assists spec owns the menu, the removal
  of automatic suggestions and notes, and ⌘↵.
- A key recorder, key-hint chip, or ES-layout default for Full idea (Figma
  page `47:2`); tracked in `docs/backlog.md`.

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
- Autocomplete streams only when `onPartial` is set
  (`geminiAutocomplete.ts`); the autocomplete IPC always sets it, so every
  completion streams today. ✦ AI is a single non-streamed request.

### Measurements (owner's Mac, Chile, 2026-09-25)

Streaming, short "next sentence" prompt, 5 runs each, direct to Groq:

| Model | First content token (median, range) | Done |
| --- | --- | --- |
| `openai/gpt-oss-120b`, `reasoning_effort: "low"` | 609 ms (426–669) | 672 ms |
| `openai/gpt-oss-20b`, low | 1,047 ms (325–1,534) | — |

gpt-oss-120b low produced ~40 chars of reasoning, delivered in
`delta.reasoning`, separate from `delta.content`; it must never be shown. The
account's `/models` lists only gpt-oss-120b/20b and previews (no Llama). This
confirms the pinned model. A dev key is in the repo root `.env.local`
(git-ignored, `GROQ_API_KEY`) for benchmarks and live tests; it is never
printed, logged or committed.

### Baseline after the writing-assists spec

This spec assumes `specs/2026-09-25-writing-assists-one-row.md` has shipped
on `master` first. After it: no automatic suggestions (every request is
explicit: ⌘, ⌘. ⌘/ or ✦ AI), no `inline` kind, no writing notes (no
`guidance` field, no "Author's writing notes" prompt line), the menu uses one
row style with an AI key row and a Privacy row, and ⌘↵ no longer requests
suggestions (whether it stays as the ✦ AI menu opener is that spec's open
question). The "Current state" bullets above describe `master` before it.

## Design

### 1. Routes

```
renderer ──IPC──▶ main: WritingAiService ──▶ GroqClient ──┬─▶ Iliad AI proxy ──▶ Groq   (free)
                                                          └─▶ Groq                     (own key)
```

- Route selection in main, per request, from a three-state key store:
  `none` → `free`; `ok` (or `GROQ_API_KEY` in dev) → `own-key`; `unreadable`
  (a saved key that cannot be decrypted: re-signed build, Keychain denied,
  corrupt file) → **blocked**, with "Re-enter your Groq key" until the writer
  re-enters or removes it. An unreadable key is never treated as "no key",
  because that would silently send an own-key writer's text through Iliad's
  server. No silent fallback between routes: an own-key failure (invalid key,
  Groq 429) is shown as such, never retried through the free proxy, and a
  free-route "out" never uses a key the writer did not give.
- Dev overrides: `GROQ_API_KEY` (own-key route), `ILIAD_AI_PROXY_URL` (free
  route base URL, for `wrangler dev` or the fake server). Both are read only
  when `!app.isPackaged`, so no env var can reroute a packaged app's text.
- The proxy base URL is a built-in constant in `electron/writing/groq/config.ts`:
  the Worker's `workers.dev` URL (e.g. `https://iliad-ai.<account>.workers.dev`;
  recommended, owner to confirm). Why not `ai.iliad.md`: the `iliad.md` DNS
  zone is on Route 53, and a Cloudflare Worker custom domain requires the zone
  on Cloudflare, i.e. moving DNS. Trade-offs of `workers.dev`: the URL is baked
  into each app version (moving it later strands old versions), some
  corporate or school networks block `*.workers.dev`, and it looks less
  first-party in a network inspector. Mitigation: the optional `ai.json`
  relocation below (owner-pending).
- **Optional (owner to confirm): relocatable proxy.** The app may read
  `https://iliad.md/ai.json` (`{ "v": 1, "proxyUrl": "https://…" }`) to move
  the proxy without a release. Rules: fetched lazily with the first free
  request, then at most once a day, cached in `userData/ai/endpoint.json`;
  HTTPS only; `proxyUrl` must match an allowlist compiled into the app
  (`*.workers.dev` under Iliad's account subdomain, `ai.iliad.md`), otherwise
  ignored; any failure keeps the cached or built-in URL. No other field is
  read (no kill switch, no limits, no prompts). The install token is bound to
  the Worker's signing keys, not the hostname, so a move keeps tokens valid.

### 2. App provider module (replaces Gemini)

New `electron/writing/groq/`:

- `prompts/` — **pure** (no Node/Electron/DOM imports), versioned:
  `prompts/v1.ts` builds `{ messages, maxCompletionTokens, maxOutputChars }`
  from a typed `WritingAiTaskV1` (autocomplete or selection) using the existing
  instruction/input builders, moved here from `autocomplete.ts` / `tighten.ts`
  together with the selection markers and `normalizeTightenSelectionRange`
  (so the pure module never imports back from `tighten.ts`; those files keep
  cleaning and validation and re-export what they need). `prompts/limits.ts`
  holds request limits and pinned params; `prompts/index.ts` maps `v →
  builder`. The app always uses the newest `v`; the Worker imports the same
  files and serves every `v` it still lists, so prompts, limits and budgets
  have one source (section 4). A **frozen version** is never edited: a prompt
  change adds `v2.ts`. Golden snapshot tests keyed by `v` fail if an existing
  version's output changes. A purity test walks the import graph of
  `prompts/` and fails on `node:*`, `electron`, or DOM APIs (the Worker's
  tsconfig has Node types, so typechecking alone would not catch it).
- `sse.ts` — one OpenAI-compatible chat-completions SSE reader used for both
  routes: incremental UTF-8 decode, `\n\n` / `\r\n\r\n` frames, `data: [DONE]`,
  frame size cap (128 KB) and an output cap equal to the task's
  `maxOutputChars` from `prompts/` (the same number the Worker enforces, on
  both routes), reads **only**
  `choices[0].delta.content`; ignores `reasoning`, `reasoning_content`,
  `channel`, tool calls and any other field; tracks `finish_reason`; surfaces an
  in-band `{"error":{...}}` event as an `AgentRuntimeError`; honors the abort
  signal between reads and cancels the reader in `finally`.
- `client.ts` — `streamGroqText({ route, task, signal, onDelta })`:
  - own key: `POST https://api.groq.com/openai/v1/chat/completions` with
    `Authorization: Bearer <key>` and the body from `prompts/` plus the pinned
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
the benchmark shows a reason). `include_reasoning: false` is set, but the
reader ignores `delta.reasoning` regardless (measured: Groq sends reasoning
there when it is included). Budgets: sentence 768, paragraph 1024, idea
2048; selection transform
`min(4096, selectionTransformMaxOutputTokens(selectedText, mode) + 1024)`,
computed from the **selected** text (`tightenSelectedText`), as
`writingAiService.ts` does today, not the whole context.

**Phase 0 gate:** `max_completion_tokens` must be shown to bound reasoning +
content (request a tiny budget with a reasoning-heavy prompt and check
`usage.completion_tokens ≤ budget` and `finish_reason: "length"`). Groq's docs
do not state it. If it does not bound reasoning, the spend cap below cannot be
a hard bound, and the design must change (e.g. the Worker aborts upstream on a
reasoning-char budget) before Phase 2.

`WritingAiService` keeps its public surface (`autocompleteIdea`,
`tightenSelection`, `writingAssistStatus`) so the IPC handlers and their
single-flight/timeouts are unchanged:

- Autocomplete: `onDelta` accumulates text and feeds the existing
  stable-word partial logic (`stableAutocompletePrefix`, moved from
  `geminiAutocomplete.ts` to `groq/partials.ts`). Returns the full text only on
  `finish_reason === "stop"`; `length` / `content_filter` / missing →
  `""` (no suggestion), exactly like today's non-`STOP` handling.
- Selection: aggregates the stream; `stop` → text; `length` →
  `output_truncated`; `content_filter` (not documented by Groq, handled
  anyway) → `content_blocked`; anything else or missing →
  `malformed_provider_response`. The IPC handler's cleaning and echo checks are
  unchanged. `TIGHTEN_TIMEOUT_MS` (15 s) becomes 30 s so a full 4,000-char
  edit is not cut off by the app before the Worker's own limits apply.
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
  `v1.<kid>.<base64url(JSON{sub,iat,exp,kind})>.<base64url(HMAC-SHA256)>`
  where `sub = "inst_" + 128-bit random`, `kind = "install"`, `exp = iat + 30
  days` (`TOKEN_TTL_DAYS`). The Worker verifies with `TOKEN_SIGNING_KEYS`
  (secret, JSON map `kid → { key, signs, verifiesUntil }`): one kid signs, old
  kids keep verifying for a grace period, so rotation does not strand live
  installs. Nothing is stored per token; the only state is the daily counters.
- Expiry and refresh: an expired token gets 401 `token_expired`. The app then
  calls `POST /v1/install` with the expired token; if its signature is valid
  and it expired less than `TOKEN_REFRESH_DAYS` (60) ago, the Worker returns a
  new token with the **same `sub`** and it does not count against issuance
  limits. Older or invalid tokens get a fresh `sub` (counted). Expiry bounds
  how long a farmed stockpile stays usable; refresh keeps the per-install quota
  identity stable for real installs.
- Issuance: `POST /v1/install` (body `{ "client": "iliad-md", "version",
  "refresh"?: <expired token> }`, same body limits and content type rules as
  generate) returns `{ "token" }`. Refusals use the error contract (section
  5): 429 `install_limited` with `resetAt`, 400 `bad_request`, 426
  `client_outdated`, 503 `free_tier_disabled`. Rate limited per network key (section 4, default 5 new
  tokens/day per IPv4 or IPv6 /64) **and** per IPv6 /48 (default 20/day),
  since one IPv6 allocation holds thousands of /64s. This bounds token
  farming; farming is also capped by the per-IP request quota and, ultimately,
  the global cap.
- Revocation: tokens are stateless, so abuse response is a config denylist
  `DENY_SUBJECTS` (comma-separated `sub`s) checked on every request, plus
  rotating a `kid` out of `TOKEN_SIGNING_KEYS` (invalidates every token signed
  with it; clients re-issue once).
- App storage: `userData/ai/install.json` `{ token, issuedAt }`, mode 0600.
  Not Keychain: it is a quota handle, not a credential that protects anything
  of the writer's. No UI for it. A missing, corrupt, or 401-rejected token is
  replaced by one re-issue, then the request is retried once (never a loop).
- Login later: the proxy's quota subject is `subject = token.sub`, and limits
  are looked up by `token.kind` (`install` now; `account` later with a plan
  claim). A future `POST /v1/session` exchanges a login for a
  `kind: "account"` token with the same format; the counters, endpoints and app
  client do not change.
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
`application/json`; body ≤ 64 KB (checked on `Content-Length` and while
reading). The field limits allow ~14.8k UTF-16 chars, up to ~45 KB of UTF-8
for CJK text, so 64 KB never rejects a valid request; the field limits are the
real bound.

**What the app may send** (`POST /v1/generate`) — a structured task, never
chat messages, system prompts, model names or parameters:

```ts
type GenerateBody =
  | { v: 1; task: "autocomplete"; language: "en" | "es";
      kind: "sentence" | "paragraph" | "idea";
      extend: boolean; prefix: string; suffix: string; documentTitle: string;
      headingPath: string[]; nearbyHeadings: string[]; direction: string;
      avoid: string[] }
  | { v: 1; task: "selection"; language: "en" | "es"; mode: "tighten" | "edit";
      instruction?: string; text: string; selection: { from: number; to: number } };
```

The Worker validates every field against the same limits main enforces today
(prefix ≤ 2,500, suffix ≤ 1,000, title ≤ 120, ≤ 8 headings × 120, direction ≤
240, avoid ≤ 3 × 2,400 (`avoid` = the previous candidates for "Another",
not notes); selection text ≤ 4,000, instruction ≤ 1,000, `0 ≤ from < to ≤
text.length`), rejects
unknown fields and unknown `v` (`bad_request` / `client_outdated`), then builds
the messages with the shared `prompts/vN.ts` and sets model and params itself.
Consequences:

- The proxy is not a general Groq gateway: system prompts are Iliad's, output
  length is pinned per task, and there is no messages/tools/model field to
  abuse. The residual "free LLM" surface is the ✦ AI typed instruction (≤ 1,000
  chars over ≤ 4,000 chars of text), long `avoid` fields on `idea`,
  and prompt injection inside document text. They are bounded by quotas, token
  budgets, and a **Worker-side forwarded-output cap** per task
  (`maxOutputChars` from `prompts/`: the `AUTOCOMPLETE_MAX_*_OUTPUT_CHARS`
  values; for selections `max(400, 3 × selectedText.length)`, ≤ 12,000): the
  Worker aborts upstream and ends the stream with `finish_reason: "length"`
  once exceeded, which also saves cost. No side effects (no tools, no secrets
  in context, results only shown to the requester).
- Prompt versions: the Worker serves every `v` listed in
  `SUPPORTED_PROMPT_VERSIONS` from the frozen `prompts/vN.ts` files, so a newer
  Worker never changes an older app's prompts. Rule: **deploy the Worker before
  releasing an app with a new `v`**; drop a `v` only after the app that sends
  it is below `MIN_CLIENT_VERSION` (unknown `v` → 426 `client_outdated`).

**Pipeline for `/v1/generate`:**

1. Kill switch: `FREE_TIER_ENABLED != "true"` → 503 `free_tier_disabled`.
   Client version below `MIN_CLIENT_VERSION` → 426 `client_outdated`.
2. Verify token, then `DENY_SUBJECTS` → 401 `invalid_token`.
3. Validate and build the upstream request (400 `bad_request`, 413
   `too_large`).
4. Reserve an **upper bound**, not an estimate: `inputTokens = UTF-8 byte
   length of all messages + PROMPT_OVERHEAD_TOKENS` (byte-level BPE cannot
   produce more tokens than bytes for the text itself; the chat template /
   harmony framing adds a fixed overhead that Phase 0 measures per task and
   version, and config sets to at least 2× the measured maximum),
   `outputTokens = max_completion_tokens` (bounds reasoning + content, per the
   Phase 0 gate). Money is integer **nano-USD** (prices configured as integer
   nano-USD per token: $0.15/M = 150, $0.60/M = 600), so `reserve = in ×
   inRate + out × outRate` is exact integer math with no rounding.
5. **Reserve** in the day's quota Durable Object (atomic, below) →
   429 `quota_exhausted` (`scope: "install" | "network"`) or 429 `global_cap`,
   both with `resetAt` = next 00:00 UTC as ISO 8601. Immediately register
   `ctx.waitUntil(settled)` where `settled` is a promise resolved by step 8, so
   the Worker stays alive to settle even if the client disconnects.
6. `fetch` Groq with the Worker secret `GROQ_API_KEY`, `signal` =
   `AbortSignal.any([request.signal, timeout, outputCapController.signal])`.
   Upstream errors **before the first byte** release the reservation and
   **refund the request count** (nothing was billed): 401/403 → 502
   `upstream_error` (plus an admin-stats counter; the writer is never told
   "invalid key" for Iliad's key); 429 → 503 `upstream_busy` with `Retry-After`
   passthrough (capped 60 s); 5xx/other → 502 `upstream_error`; no first byte
   in 10 s → 504 `upstream_timeout` (settled at the full reservation: Groq may
   have started generating).
7. Stream: a `TransformStream` re-emits OpenAI-compatible chunks containing
   only `choices[0].delta.content` and `finish_reason` (`delta.reasoning`,
   `reasoning_content` and every other field dropped), captures usage from the
   final chunk (`x_groq.usage` per Groq's API reference, or top-level `usage`;
   both handled) and does **not** forward it. Forwarded content above the
   task's `maxOutputChars` → abort upstream, emit `finish_reason: "length"`,
   close. Idle > 15 s between upstream chunks or total > 45 s → in-band
   `data: {"error":{"code":"upstream_timeout"}}` then close. Upstream stream
   errors → in-band `upstream_error`. Every parse and stream step is wrapped:
   errors are mapped to codes and the original error (whose message can quote
   text, e.g. V8's `JSON.parse` errors) is never rethrown or logged.
8. **Settle** (from the transform's `flush`/`cancel` and the abort paths):
   with usage → actual cost, releasing the rest of the reservation; **without
   usage** (client abort, upstream cut, timeout) → the **full reservation**,
   because gpt-oss reasons before it writes content and aborted reasoning is
   still billed. Settle never lowers the request count except the
   before-first-byte refund in step 6.

Client abort propagates: the app aborting its fetch disconnects the Worker
request; `request.signal` then aborts the upstream Groq fetch, so an abandoned
suggestion stops costing tokens. This needs the opt-in `enable_request_signal`
compatibility flag (no default date), which `wrangler.toml.example` sets and
the integration test asserts. Aborts are charged the full reservation, so a
dropped signal costs budget but never breaks the cap.

**When the cap is a hard bound (and when it is not claimed to be).** Every
admitted request holds its worst-case cost in `reserved` before Groq is
called, `spent + reserved ≤ cap` is checked atomically under the day's
snapshotted policy, and reservation is only released when Groq's own usage says
the request cost less. That makes the cap hard **given three verified
premises**: (1) billed prompt tokens ≤ bytes + measured overhead, (2)
`max_completion_tokens` bounds billed reasoning + content, (3) configured rates
≥ Groq's billed rates. (1) and (2) are **release gates**: Phase 0 live probes
per task and prompt version, including adversarial Unicode (CJK, emoji, ZWJ
sequences, combining marks, random bytes as text), comparing `usage` against
the bound; re-run whenever a prompt version or the model changes. (3) is a
deployment check. Until the probes pass, docs and copy do not call the cap
hard, and the Groq org spend limit is the backstop.

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
  reserved it (the reservation carries its day). A DO has one alarm, so it is
  always set to `min(next sweep, day + 2)`: the sweep (every 5 min while
  reservations exist) settles unsettled reservations older than 2 min at their
  full amount; at day + 2 the DO deletes all its storage, so counters live
  ≤ 48 h.
- Tables: `subjects(subject PK, count)`, `networks(netkey PK, count, installs)`,
  `networks48(netkey PK, installs)`, `policy(k PK, cap_nano, in_rate,
  out_rate, install_limit, ip_limit)`, `global(k PK, count, reserved_nano,
  spent_nano)`, `reservations(id PK, subject, netkey, nano, in_rate, out_rate,
  created)` (rows removed on settle), `errors(code PK, count)`.
- Latency: the day DO lives in one location; each request adds a round trip to
  it (twice: reserve, settle; settle is off the response path). Create it with
  a location hint near the Groq region and measure the added latency in
  Phase 2 against the 609 ms baseline.
- Policy snapshot: the first request of a day writes the Worker's current
  policy (cap, rates, per-install and per-network limits) into the day DO's
  `policy` row. Later requests pass the current env policy, and the DO applies
  the **more conservative** of the two: `cap = min(snapshot, current)`,
  `rates = max(snapshot, current)`, `limits = min(snapshot, current)`. The
  more conservative value is written back, so a tightening takes effect on the
  next request and is never undone by a later loosening that day; loosening
  (higher cap, lower price, higher limits) applies from the next UTC day. Each
  reservation stores the rates it was reserved with, and settle uses those
  rates (or higher current ones), so a mid-day price change can never make a
  settled amount smaller than the reservation assumed. The kill switch is not
  part of the snapshot: it applies immediately.
- Reserve (single `transactionSync`) under the effective policy: reject if
  `subjects.count ≥ installLimit`, `networks.count ≥ ipLimit`, or `spent +
  reserved + reserve > cap`; otherwise increment both counts and `reserved`.
  Returns the reservation id.
- Throughput: all requests of a day serialize through one DO. At $5/day the
  ceiling is on the order of 10⁴ requests/day (section 9), far below one DO's
  capacity. Sharding plan when needed: per-subject and per-network DOs for the
  request counts plus the single day DO for spend only (spend is the only
  truly global check).
- Why not the Workers Rate Limiting binding: it is per-location, approximate,
  and has only short windows; fine as an extra WAF-style burst limiter, not for
  daily quotas or spend.

**Network key (per-IP quota):** from `CF-Connecting-IP` only (never
`X-Forwarded-For`). A missing or unparsable header → 400 `bad_request`; there
is never an "unknown" bucket. Canonicalization before hashing: IPv4 as dotted
decimal without leading zeros; IPv4-mapped IPv6 (`::ffff:a.b.c.d`) → the IPv4
address; IPv6 fully expanded, lowercase, then masked to /64 (quota and
issuance) and /48 (issuance). IPv4 → the full address; IPv6 → the /64 prefix. Stored as
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
| `IP48_DAILY_NEW_INSTALLS` | `20` | Token issuance per IPv6 /48. |
| `DENY_SUBJECTS` | `""` | Comma-separated revoked `sub`s. |
| `SUPPORTED_PROMPT_VERSIONS` | `"1"` | `v`s the Worker serves. |
| `GLOBAL_DAILY_NANO_USD` | `5000000000` | Spend cap ($5), integer. |
| `INPUT_NANO_USD_PER_TOKEN` / `OUTPUT_NANO_USD_PER_TOKEN` | `150` / `600` | $0.15 / $0.60 per 1M; must be ≥ Groq's billed rates. |
| `PROMPT_OVERHEAD_TOKENS` | set from Phase 0 | ≥ 2× measured template overhead. |
| `TOKEN_TTL_DAYS` / `TOKEN_REFRESH_DAYS` | `30` / `60` | Token expiry and refresh window. |
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
- Uncaught exceptions are logged by the platform with their message; V8
  parse errors quote input. Hence step 7's rule: every stage catches, maps to
  a code, and never rethrows the original error. A test throws inside each
  stage (body parse, validation, upstream SSE parse, transform) with a unique
  marker string in the input and asserts the marker appears in no recorded
  log, error, or response.
- Workers observability is **on by default for new Workers**: invocation logs
  contain method, path, status and the connecting IP. `wrangler.toml.example`
  sets `[observability] enabled = false` explicitly; the deployment checklist
  re-checks it after any dashboard edit. No Logpush, no Tail Workers.
- Durable Object storage holds only: subjects, hashed network keys, counts,
  nano-USD amounts, the day policy snapshot, reservation ids, error-code counts.
- Groq side: by default Groq may keep inference data up to 30 days for abuse
  and reliability. **Zero Data Retention in the Groq org's Data Controls is a
  blocking release gate**: the free route does not ship, and the "Iliad
  doesn't store this text" wording, the privacy page and the release notes do
  not go live, until
  ZDR is on and verified in the console.

**This is a bounded public service.** No CORS only affects browsers; curl
and native clients can call the proxy, and a 1,000-char instruction over a
4,000-char selection is expressive enough for general use. The design does
not pretend otherwise: it bounds what anyone gets (per-install, per-network,
global, per-request output) rather than preventing use. There is no path to
read another writer's text: responses go only to the caller, and the Worker
stores none. Launch scope includes Cloudflare **WAF rate-limiting rules** (per
IP: `/v1/install` ~3/min, `/v1/generate` ~30/min, block for 10 min) and bot
fight / managed challenge for non-app user agents on `/v1/install` if the
admin stats show automation. Turnstile or attestation stays future work.

**Abuse considerations** (bounded, not prevented): scripted clients using the
API directly (limited by install/IP quotas and output caps); token farming
(issuance limit per /64 and per /48; `DENY_SUBJECTS`); distributed abuse from
many IPs (the global cap bounds cost, but a determined attacker can exhaust the
free tier for everyone for a day — detection via admin stats, response: lower
caps, WAF rules, kill switch; Turnstile/attestation later); abort-before-content
attacks (charged the full reservation, step 8); oversized or malformed bodies
(64 KB, schema); upstream key compromise (secret only in Worker; Groq console spend
limit as a second, independent cap).

### 5. Error contract

| Proxy code | HTTP | App `AgentErrorCode` | Autocomplete reason | ✦ AI reason |
| --- | --- | --- | --- | --- |
| `quota_exhausted` | 429 | `free_quota_exhausted` | `free_exhausted` | `free_exhausted` |
| `global_cap` | 429 | `free_global_cap` | `free_exhausted` | `free_exhausted` |
| `free_tier_disabled` | 503 | `free_unavailable` | `free_unavailable` | `free_unavailable` |
| `client_outdated` | 426 | `client_outdated` | `client_outdated` | `client_outdated` |
| `invalid_token` | 401 | (re-issue once, retry once) → `provider_unavailable` | `provider` | `provider` |
| `token_expired` | 401 | (refresh via `/v1/install`, retry once) → `provider_unavailable` | `provider` | `provider` |
| `install_limited` (from `/v1/install`) | 429 | `free_quota_exhausted` | `free_exhausted` | `free_exhausted` |
| `upstream_busy` | 503 | `rate_limited` | `rate_limited` | `rate_limited` |
| `upstream_error` / `upstream_timeout` | 502 / 504 / in-band | `provider_unavailable` / `request_timeout` | `provider` / `timeout` | `provider` / `timeout` |
| `bad_request` / `too_large` | 400 / 413 | `provider_unavailable`, detail `proxy_bad_request` (an app bug; diagnostics log the code) | `provider` | `provider` |
| own key: Groq 401/403 | — | `invalid_api_key` | `invalid_api_key` | `invalid_api_key` |
| own key: Groq 429 | — | `rate_limited` | `rate_limited` | `rate_limited` |

Result shapes change (handler, preload and `src/types/iliad.ts` together):
`IdeaAutocompleteResult` and `TightenResult` failures become
`{ ok: false; reason; resetAt?: string }`; `resetAt` (ISO 8601, from the
proxy) is set only for `free_exhausted`. Per-install, per-network and global
refusals are one renderer reason and one message (owner decision); main keeps
the distinct `AgentErrorCode`s for diagnostics only. The renderer
formats it as a local time in the app language's locale
(`Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" })`); it
never shows counts.

Renderer changes: `IdeaAutocompleteFailureReason` / `TightenFailureReason` gain
`free_exhausted`, `free_unavailable`, `client_outdated`, `key_unreadable`; `no_key` is removed (there is always a route or a blocked
own key). `autocompleteReasonFromAgentError` and
`tightenReasonFromAgentError` are exhaustive switches and get explicit cases
for the new `AgentErrorCode`s. `tightenReasonFromAgentError` regex-matches
`detail` for `quota|limit|rate` and `auth` on `provider_unavailable`; new
codes are mapped before that branch, and proxy-derived `detail` values never
contain those words (tests pin both). `autocompleteCooldownMsForFailure`
gets cases for the new reasons.

`resetAt` reaches UI state (today it cannot: `IdeaAutocompleteStatus`
`failed` keeps only `reason`, and so does the selection overlay's error
state):

- `IdeaAutocompleteStatus` becomes `{ state: "failed"; reason; resetAt? }`;
  the overlay's `tightenState` error gains `resetAt?`; `EditorPane.tsx` passes
  both to the localized notice.
- Every request is explicit (automatic suggestions are removed by the
  writing-assists spec), so every refusal shows its notice. `free_exhausted`
  and the other free "out" reasons set **no cooldown**: the next explicit
  request goes to the proxy again and, if still out, shows the notice again
  (a refused request costs the Worker one DO round trip, no Groq call).
  `rate_limited` keeps today's cooldown.

### 6. Key storage and settings

- Own Groq key: `userData/ai/settings.json` field `groqApiKey`, encrypted with
  Electron `safeStorage` (Keychain-backed on macOS) and stored as base64
  (`groqApiKeyEnc`); plaintext is never written. If
  `safeStorage.isEncryptionAvailable()` is false (should not happen on macOS),
  fall back to today's 0600 plaintext file and record `storage: "plain"`.
  Mode 0600 either way.
- Validation before save (owner decision): `GET
  https://api.groq.com/openai/v1/models` with the key (no tokens used); the key
  is saved only on 200. 401/403 → "Groq didn't accept this key"; network
  failure or 5xx → not saved, "Couldn't reach Groq to check the key. Try
  again." Shape check first: no whitespace, ≤ 512 chars (keys start with
  `gsk_`; not required).
- Key states: `none`, `ok`, `unreadable` (decrypt failed; section 1). Status
  reports the state; `unreadable` shows "Re-enter your Groq key" with Change /
  Remove.
- `last4` for display only.
- Migration: an awaited, idempotent step in main startup, before the writing
  IPC handlers are registered (so no status or request can observe the old
  state). It rewrites `userData/assistant/settings.json` **without**
  `geminiApiKey` (other historical fields preserved, as today) via temp file +
  `rename` in the same directory, then explicit `chmod 0600`; if no fields
  remain, the file is deleted. Every write of `userData/ai/settings.json`,
  `install.json` and `endpoint.json` uses the same atomic write + explicit
  `chmod 0600` (today's `writeFile(…, { mode: 0o600 })` does not fix the mode
  of an existing file). A migration failure is logged by code and retried next
  launch; it never blocks the app. `GEMINI_API_KEY` / `GOOGLE_API_KEY` are no
  longer read.

IPC (update handler, preload and `src/types/iliad.ts` together; preload surface
test):

- `writing-assist:status` → `WritingAssistStatus`:
  `{ corrector, ai: { route: "free" | "own-key" | "blocked", model:
  "openai/gpt-oss-120b" }, groqKey: { state: "none" | "ok" | "unreadable",
  last4 } }`. No counts, no quota state: "out" is learned from request results
  (with `resetAt`), which is the only place the renderer needs it.
- `writing:get-gemini-key-state` / `writing:set-gemini-key` →
  `writing:get-groq-key-state` / `writing:set-groq-key` (validate against Groq
  in main; returns `{ ok: true, state } | { ok: false, reason:
  "rejected" | "unreachable" | "invalid_shape" }`).
- `autocomplete:*`, `tighten:*` channels unchanged; failure results gain
  `resetAt` (section 5).

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
  per-kind Gemini numbers to `prompts/` (section 2).

### 8. UI states and copy (EN / ES)

The menu's layout, row order and row style belong to the writing-assists
spec (one row style, Figma "Writing assists: one row style", node `57:133`);
this section only gives the AI key row's states and copy in that style, the
notices, and the privacy page content. Tone: calm, no exclamation marks, never
a count. Spanish uses "clave".

AI key row (one row: name, grey note, text link on the right):

| State | Name | Note | Link |
| --- | --- | --- | --- |
| Free (default) | AI included / IA incluida | Free, with a daily limit / Gratis, con un límite diario | Use my key / Usar mi clave |
| Own key | Groq key / Clave de Groq | ••••1234 | Change / Cambiar (Remove / Quitar in the expanded form) |
| Unreadable key | Groq key / Clave de Groq | Re-enter your key / Vuelve a ingresar tu clave | Change / Cambiar |

No separate privacy line in the menu. The writing-assists spec's Privacy row
sits directly under the AI key row and opens the privacy page, which is the
one place the full explanation lives; repeating a two-sentence disclosure in
the menu would break the one-row style and duplicate that row. The free/own
difference is still visible in the menu itself: the free row says "AI
included", the key form hint says the key goes straight to Groq.

- The privacy page (`https://iliad.md/privacy/`, `/es/privacidad/`, in the
  `iliad-site` repo; today it describes the Gemini route) must be updated
  before the free route ships. It enumerates the processors
  and what each sees: Cloudflare (runs the Worker; sees the request including
  text in transit and the connecting IP; Iliad's Worker logs are off, with
  Cloudflare's own platform handling described per its policy), Groq
  (generates the text; Zero Data Retention enabled on Iliad's account, with
  the date it was verified), and Iliad (stores only per-day counters keyed by
  a random install id and a daily-keyed hash of the network, deleted after
  ≤ 48 h; no text). It also covers the own-key route (text goes to Groq under
  the writer's own Groq account terms) and the `ai.json` fetch if adopted.
- "Use my key" / "Usar mi clave" expands the key form in place of the row
  (same row and link styles): label "Groq API key" /
  "Clave API de Groq"; placeholder "Paste your Groq API key" / "Pega tu clave
  API de Groq"; hint "Goes straight to Groq, with no daily limit from Iliad."
  / "Va directo a Groq, sin límite diario de Iliad."; buttons Save / Cancel /
  "Get a key" (`https://console.groq.com/keys`) — "Guardar" / "Cancelar" /
  "Obtener una clave". Save shows "Checking…" / "Comprobando…" while the key is
  validated.
- Save errors: "Groq didn't accept this key." / "Groq no aceptó esta clave.";
  "Couldn't reach Groq to check the key. Try again." / "No se pudo contactar a
  Groq para comprobar la clave. Intenta de nuevo."; generic "Could not save the
  key. Try again." (existing).

Inline notices (autocomplete status spot near the cursor, and the ✦ AI
overlay). All requests are explicit (⌘, ⌘. ⌘/ and ✦ AI), so a refusal always
shows its notice. Notices that concern the free route carry a "Use my key" /
"Usar mi clave" button, which opens Writing assists with the key form
expanded (today's `requestGeminiKey` → `requestGroqKey`).

| State | EN | ES |
| --- | --- | --- |
| Out (per-user, network or global) | Today's free AI has run out. It's back at {time}. | La IA gratis de hoy se agotó. Vuelve a las {time}. |
| Kill switch | Free AI is paused right now. | La IA gratis está en pausa por ahora. |
| Outdated | Update Iliad to keep using free AI. | Actualiza Iliad para seguir usando la IA gratis. |
| Proxy unreachable | Free AI isn't reachable. Check your connection. | No se pudo conectar con la IA gratis. Revisa tu conexión. |
| Own key rejected | Groq rejected your key. Check it in Writing assists. | Groq rechazó tu clave. Revísala en Ayudas de escritura. |
| Own key rate-limited | Your Groq key hit its rate limit. Try again shortly. | Tu clave de Groq llegó a su límite. Intenta de nuevo en un momento. |
| Own key unreadable | Re-enter your Groq key in Writing assists. | Vuelve a ingresar tu clave de Groq en Ayudas de escritura. |

`{time}` is `resetAt` (00:00 UTC) in the writer's local time and locale, e.g.
"9:00 PM" / "21:00" in Chile. Own-key notices never offer the free route.
✦ AI is enabled on first launch (the "disabled until key" styling in
`src/styles/editor.css` is removed).

Strings: all `geminiKey*`, `noKey`, `addKey`, `editNoKey`, `noProvider`,
`autocompleteNeedsKey` and Gemini mentions in `src/i18n/strings.ts` are
removed or replaced by the keys above, EN and ES together.

### 8b. Automatic suggestions — REMOVED

Closed: automatic suggestions are removed by
`specs/2026-09-25-writing-assists-one-row.md` (Decision 2).

### 9. Cost model and monitoring

Token estimates per request (EN/ES; ~3.5 chars/token; instructions ≈ 350
tokens; reasoning at `low` ≈ 50–250 tokens, to be measured):

| Request | Input tok | Output tok (incl. reasoning) | Cost |
| --- | --- | --- | --- |
| sentence | ~1,300 | ~250 | ~$0.00035 |
| paragraph | ~1,300 | ~400 | ~$0.00044 |
| idea | ~1,400 | ~900 | ~$0.00075 |
| ✦ AI, 1,500-char selection | ~1,000 | ~800 | ~$0.00063 |
| ✦ AI worst case (4,000 chars, edit) | ~1,700 | 4,096 cap | ~$0.0027 |

- A fully used install (50 mixed requests) ≈ $0.02–0.04/day. $5/day ≈ 10k–15k
  typical requests ≈ 150–250 writers using the full quota daily (many more at
  typical use). Monthly worst case $150 Groq + Cloudflare Workers Paid $5.
- Reservations are worst case (input bytes, `max_completion_tokens`): an
  sentence request reserves ~$0.0012, an idea ~$0.0017, a worst ✦ AI edit
  ~$0.0038. Near the cap the Worker refuses slightly early rather than
  overspending; settle with real usage releases the difference within
  seconds. Aborted requests (common: typing cancels suggestions) are charged
  their full reservation, so real spend is below the booked spend; the
  benchmark's usage numbers and admin stats show how far, and the cap can be
  raised accordingly.
- Monitoring: `GET /v1/admin/stats` (per day: requests, installs issued,
  distinct subjects, spent/reserved nano-USD, refusals by code, upstream
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
  new rule, per ADR-0023), `docs/decisions.md` (ADR-0023 accepted; ADR-0021
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
- `prompts/` purity (import-graph test) and golden snapshots of messages per
  `v`/task/kind/language (a v1 change fails); no import cycle with
  `tighten.ts`; selection budget uses the selected text.
- `WritingAiService`: route selection (`ok` → own-key, `none` → free,
  `unreadable` → blocked and **never** free), finish-reason mapping,
  diagnostics contain no text (assert on the logged object).
- Reason mappers: every new `AgentErrorCode` has an explicit case; a proxy
  `detail` never turns into `rate_limited`/`invalid_api_key` via the
  `tightenReasonFromAgentError` regex.
- IPC: status shape, set-groq-key (saved only on Groq 200; 401 → rejected;
  network → unreachable, not saved), `resetAt` passes through failure results,
  preload surface.
- Selection output between 8,001 and 12,000 chars passes end to end on both
  routes (app reader cap = task `maxOutputChars`).
- Migration: an existing legacy file with mode 0644 ends 0600 after
  migration; atomic write leaves no partial file on a simulated crash;
  migration completes before the first status call.
- `ai.json` (if adopted): off-allowlist host ignored; HTTP ignored; fetch
  failure keeps cache; at most one fetch per day.
- Renderer: `failed` status and the overlay error carry `resetAt`; after
  `free_exhausted` the next explicit request still reaches IPC (no cooldown)
  and shows the notice again; every reason maps to its copy; `{time}`
  formatted from `resetAt` in EN and ES locales; ✦ AI enabled with no key;
  AI key row free/own-key/unreadable states and the expanded form (EN/ES).

Worker (`relay/ai-proxy/tests`, run by root `npm test` and `npm run
proxy:test`; injected storage/clock/fetch like the old relay tests):

- Tokens: sign/verify, `kid` rotation with verify-only grace, tampered
  payload/signature, unknown kid; expiry → `token_expired`; refresh within the
  window keeps `sub` and is not counted; outside the window → new `sub`,
  counted; `/v1/install` 429 `install_limited` with `resetAt`.
- Network keys: missing/garbage `CF-Connecting-IP` → 400; IPv4 leading zeros,
  IPv4-mapped IPv6, compressed vs expanded IPv6 canonicalize to the same key.
- Policy: mid-day cap decrease applies at once, increase waits for the next
  UTC day; mid-day rate increase applies to new reservations and to settles
  of old ones; loosening never undoes a same-day tightening; integer nano-USD
  arithmetic with no floats (property test over random usages).
- Validation: every limit ±1, unknown fields, unknown/unsupported `v` → 426,
  `inline` kind, `trigger` or `guidance` fields (rejected as unknown), 64 KB body cap (a max-size CJK request
  passes), wrong content type/method; `DENY_SUBJECTS`.
- Quota core (pure class over an injected transactional store): install limit
  at 49/50/51; network limit across two installs; IPv6 addresses in the same
  /64 share a key, different /64 do not; /48 issuance limit; input reservation
  from UTF-8 bytes ≥ real tokens for CJK/emoji/random strings; global cap with
  reservations; settle with usage releases the rest; **abort or missing usage
  settles the full reservation**; pre-first-byte upstream failure refunds count
  and reservation; unsettled reservation swept by the alarm, and the single
  alarm is always `min(sweep, deleteAt)`; concurrent reserves (interleaved promises) never
  exceed a limit; day rollover (23:59:59.999 vs 00:00 UTC) uses a new DO and a
  straddling request settles to its reservation day; config change applies on
  the next request; invalid config fails closed.
- Streaming: `delta.reasoning` stripped; usage captured and not forwarded;
  `x_groq.usage` and top-level `usage` variants; forwarded-output cap aborts
  upstream and ends with `length`; upstream error mid-stream → in-band error;
  idle and total timeouts; client abort aborts the upstream fetch and still
  settles (the `waitUntil` registered at reserve).
- Privacy: a unique marker string in the body and in fake upstream output
  appears in no `console` call, thrown/recorded error, error response, or DO
  storage dump — including when each stage (body parse, validation, SSE
  parse, transform) is made to throw.
- Integration (package-local, `npm --prefix relay/ai-proxy run test:workers`,
  `@cloudflare/vitest-pool-workers`/miniflare, files named `*.workers.test.ts`
  under `relay/ai-proxy/tests/workers/`): real SQLite DO transactions,
  `enable_request_signal` present in config and abort propagation, alarms.
  A root `vitest.config.ts` excludes `relay/ai-proxy/tests/workers/**` (today
  root `npm test` is a bare `vitest run` that would pick them up and fail on
  `cloudflare:test`), and `npm run typecheck` gains `npm run proxy:typecheck`
  (neither `tsc -b` nor `electron/tsconfig.json` covers `relay/`).

## Benchmark

A **fresh** Groq/proxy harness behind `npm run benchmark:autocomplete`
(`scripts/benchmarkAutocomplete.mjs`). The removed script cannot be restored:
it imports deleted `dist-electron/agent/*` Gemini/OpenAI modules. Only its
eight EN/ES cases carry over, as shared fixtures in
`tests/fixtures/writingCases.ts`, used by the benchmark and the prompt
snapshot tests. CI (when added) runs the app and Worker typechecks and the
per-`v` snapshot matrix.

- Routes: `GROQ_API_KEY` (from the environment or the ignored repo-root
  `.env.local`; never printed) → direct; `ILIAD_AI_PROXY_URL` + a dev token →
  via the proxy (measures proxy + Durable Object overhead against the 609 ms
  direct baseline). `--dry-run` makes no requests.
- A `--budget-probe` mode runs the Phase 0 gates: (a) tiny
  `max_completion_tokens` on a reasoning-heavy prompt, asserting
  `completion_tokens ≤ budget`; (b) prompt-token overhead per task, kind and
  prompt version (`usage.prompt_tokens − bytes`), reporting the maximum for
  `PROMPT_OVERHEAD_TOKENS`; (c) adversarial Unicode inputs at every field's
  maximum, asserting `prompt_tokens ≤ bytes + overhead`.
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
3. Out: point at `wrangler dev` with `INSTALL_DAILY_REQUESTS=2`; the third
   explicit request shows "Today's free AI has run out. It's back at {time}."
   with the local time of 00:00 UTC + "Use my key"; the next request shows
   the notice again.
   Same message with `GLOBAL_DAILY_NANO_USD=100000`. Repeat in Spanish.
4. Add own key → requests go direct (verify with the proxy stopped); remove key
   → back to free.
5. Invalid own key on save (not saved); offline on save (not saved, "Couldn't
   reach Groq"); revoked own key after save → "Groq rejected your key", no
   free fallback; unreadable key (corrupt the encrypted field) → "Re-enter your
   Groq key", requests blocked, proxy receives nothing.
6. Upgrade from 0.3.x with a saved Gemini key → key gone from
   `assistant/settings.json`, no Gemini copy anywhere, AI works free.
7. Cancel paths: type through a streaming suggestion, Esc during ✦ AI, switch
   documents mid-request; `wrangler dev` shows the upstream request aborted.
8. EN and ES copy in every state; VoiceOver announces notices.

## Deployment (later, by the owner; not in this change)

1. Cloudflare: Workers Paid plan (recommended for CPU headroom); the
   `workers.dev` URL (or a custom domain, per the owner's choice); WAF
   rate-limiting rules for `/v1/install` and `/v1/generate`.
2. Groq (**blocking**): org on the Developer tier, **ZDR enabled and verified**
   in Data Controls, a dedicated API key for the proxy, an org spend limit,
   prices in config checked against the console (rates ≥ billed), Phase 0
   probes passed and `PROMPT_OVERHEAD_TOKENS` set from them.
3. `cp wrangler.toml.example wrangler.toml` (it sets `compatibility_flags =
   ["enable_request_signal"]`, `[observability] enabled = false`, the DO
   binding and SQLite migration); set vars; `wrangler secret put
   GROQ_API_KEY`, `TOKEN_SIGNING_KEYS`, `IP_HASH_KEY`, `ADMIN_TOKEN`.
4. `wrangler deploy`; confirm in the dashboard that observability is still
   off; smoke: `/healthz`, `/v1/install`, one `/v1/generate` with a dev token,
   `/v1/admin/stats`.
5. Only then release the app version that uses it (it must not ship pointing
   at an undeployed URL). Website privacy page live before the release.

## Phased plan

- **Phase 0 — measure** (no product change): Groq direct client + benchmark on
  the dev key; **gate**: `max_completion_tokens` bounds reasoning + content;
  confirm reasoning never reaches `content`, budgets rarely hit `length`,
  sentence first-visible p95 < 1.5 s (owner's first measurement: 609 ms
  median); check EN/ES quality by hand; tune per-kind budgets/prompt lines.
- **Phase 1 — app**: provider module, own-key route, Gemini removal, key
  migration, status/IPC, strings, UI states against a fake proxy.
- **Phase 2 — Worker**: `relay/ai-proxy/` with unit + integration tests;
  `wrangler dev` QA with the app.
- **Phase 3 — docs and release**: ADR-0023 accepted, product-vision rule,
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
  requests settle at their full reservation (conservative, free tier admits
  fewer requests), leak guard still holds.
- If Phase 0 shows `max_completion_tokens` does not bound reasoning, the spend
  cap loses its hard bound; the Worker design must change before Phase 2.
- Charging aborts in full makes booked spend exceed real spend, so the free
  tier fills earlier than $5 of real cost; tune the cap from admin stats vs
  Groq's bill.
- Prompt-version lockstep between app and Worker can break older apps if the
  Worker drops a `v` too early.
- Trust: some writers will not want text on Iliad's server. The privacy line,
  own-key route and the Autocomplete switch are the answers; see Open
  questions for a stronger opt-out.
- A saved own key that becomes unreadable blocks AI until re-entered (by
  design, to avoid a silent privacy downgrade).

## Open questions for the owner

Closed: automatic suggestions (removed; writing-assists spec).

1. ⌘↵ (shared with the writing-assists spec, which owns it): keep it only as
   the ✦ AI menu opener, or remove it. Either way it never requests
   suggestions; this spec does not depend on the answer.
2. Proxy URL. Recommended: `workers.dev` now (DNS stays on Route 53), plus the
   optional `https://iliad.md/ai.json` relocation file.
3. Next release version for `MIN_CLIENT_VERSION`. Recommended: 0.4.0.
4. An extra "Built-in AI off" switch. Recommended: no. After the
   writing-assists spec, text leaves the Mac only on an explicit request (a
   length key or ✦ AI), and the Autocomplete switch already hides the length
   keys.
5. Own key stored with `safeStorage` (Keychain-backed; today's Gemini key is
   plaintext 0600 JSON). Recommended: yes (an unreadable key then blocks AI
   until re-entered).
6. Install tokens expire after 30 days with a same-identity refresh within 60.
   Recommended: yes.
7. Aborted requests charged their full worst-case reservation (needed for a
   hard cap; the free tier admits fewer requests than $5 of real spend).
   Recommended: yes; revisit the cap once admin stats can be compared with
   the Groq bill.

## Alignment with the writing-assists spec (v4, 2026-09-25)

Rebased on `master` after `2026-09-25-writing-assists-one-row.md`. Removed
here because that spec owns them: the automatic-suggestions gate (section 8b
now REMOVED), the `inline` kind and `trigger` field, the notes `guidance`
field and prompt line, the automatic-only `freeOutUntil` gate, the in-menu
privacy line (the Privacy row replaces it), and ⌘↵ as a suggestion trigger.
Menu copy now follows that spec's row table ("AI included", "Free, with a
daily limit", "Use my key"). The key recorder, key-hint chip and ES-layout
default for Full idea (Figma `47:2`) are non-goals in both specs and tracked
in `docs/backlog.md`.

## Review — Codex xhigh (2026-09-25)

Codex (xhigh, read-only), after the owner fixed Codex auth, on v2:
**NO-GO**, 2 P0 / 6 P1 / 2 P2. All accepted; folded in as v3:

1. P0 the cap is not provably hard: prompt-token overhead and adversarial
   Unicode are untested, prices are assumed, float money. **Accepted:**
   `PROMPT_OVERHEAD_TOKENS` from measured overhead (≥ 2×), Phase 0 probes for
   overhead, adversarial Unicode and reasoning budget as release gates
   (`--budget-probe`), integer nano-USD math, rates ≥ billed as a deployment
   check, and no "hard cap" claim until the probes pass (section 4).
2. P0 mid-day config changes can break the reservation invariant.
   **Accepted:** per-day policy snapshot in the DO; tightening applies at once
   and sticks for the day, loosening next UTC day; each reservation stores
   its rates and settle never uses lower ones.
3. P1 app reader cap 8,000 vs Worker 12,000 for selections. **Accepted:** the
   reader uses the task's `maxOutputChars` from `prompts/` on both routes;
   end-to-end 8,001–12,000 test.
4. P1 `resetAt`/trigger cannot reach UI state; the shared cooldown would
   block manual requests. **Accepted:** status and overlay error carry
   `resetAt` and trigger; a separate automatic-only `freeOutUntil` gate;
   manual requests always reach the proxy (section 5).
5. P1 `/v1/install` outside the error contract; IP canonicalization.
   **Accepted:** `install_limited` 429 with `resetAt` mapped to the same "out"
   notice; missing/invalid `CF-Connecting-IP` → 400, never an unknown bucket;
   IPv4/IPv4-mapped/IPv6 canonicalization before hashing.
6. P1 still a public, capped general LLM; permanent tokens can be farmed and
   replayed. **Accepted:** the spec says so ("bounded public service"); tokens
   expire (30 days) with same-`sub` refresh (60 days) and verify-only kid
   grace; WAF rate-limiting rules in launch scope, challenges if automation
   shows up.
7. P1 "Nothing is stored" too broad. **Accepted:** copy is "Iliad doesn't
   store this text" / "Iliad no guarda este texto"; the privacy page
   enumerates Cloudflare, Groq and Iliad processing, metadata and retention,
   and the verified ZDR date.
8. P1 automatic suggestions in free mode must be decided before launch.
   **Accepted:** pre-Phase-1 gate; interim free-mode default manual-only;
   recommended resolution Option A (Figma `47:2`), owner-pending (section 8b).
9. P2 key migration file guarantees. **Accepted:** awaited idempotent startup
   migration before IPC registration; atomic temp-write + rename + explicit
   `chmod 0600` for all AI files; test with a 0644 legacy file.
10. P2 the old benchmark cannot be restored. **Accepted:** fresh harness;
    only the cases carry over as shared fixtures; CI runs app + Worker
    typecheck and the per-`v` snapshot matrix.

Also from the lead (owner-pending): proxy URL leaning `workers.dev`, with an
optional allowlisted `https://iliad.md/ai.json` to relocate it without a
release (section 1).

## Review — earlier passes

**Codex (xhigh, read-only) could not run** at first on 2026-09-25: two attempts
(`codex exec -s read-only -c 'model_reasoning_effort="xhigh"' …`) failed
after WebSocket reconnects with `401 Unauthorized: Incorrect API key provided`
from `chatgpt.com/backend-api/codex/responses`, although `codex login status`
reports a ChatGPT login. The auth needs fixing by the owner; the review prompt
is kept for a rerun. **A Codex xhigh pass is still owed before
implementation.**

Interim: an independent adversarial review (Claude subagent, read-only, same
prompt, checked against the code and current Groq/Cloudflare docs), on v1:
**GO-WITH-CHANGES**, 2 P0 / 6 P1 / 7 P2. Folded in as v2:

1. P0 settling aborted/usage-less requests at an estimate let
   abort-before-content attacks (billed reasoning, no content) overspend the
   cap. **Accepted:** without usage, settle at the full reservation; only real
   usage releases reservation (section 4 step 8, "Why the cap is a hard
   bound").
2. P0 `chars/3` is not an input upper bound (CJK, emoji, random strings), and
   whether `max_completion_tokens` bounds reasoning is undocumented.
   **Accepted:** reserve from UTF-8 bytes; the budget question is a Phase 0
   **gate**; the Worker also caps forwarded output per task.
3. P1 settle could be lost on disconnect; a DO has one alarm; the request
   signal flag is opt-in. **Accepted:** `waitUntil` registered at reserve, one
   alarm at `min(sweep, deleteAt)`, flag in `wrangler.toml.example` and
   asserted in the integration test.
4. P1 the renderer cannot get `resetAt`; reason mappers are exhaustive and
   the tighten `detail` regex would misclassify proxy codes. **Accepted:**
   failure results carry `resetAt`; explicit cases; tests pin the regex path.
   (`freeState` in status was dropped: request results carry the state.)
5. P1 one shared `prompts.ts` would silently change older apps' prompts.
   **Accepted:** frozen `prompts/vN.ts`, golden snapshots per `v`,
   `SUPPORTED_PROMPT_VERSIONS`; markers and range normalization move into the
   pure module to avoid a cycle with `tighten.ts`. Build feasibility was
   confirmed (NodeNext, esbuild bundles the relative import).
6. P1 V8 exception messages quote parsed text into platform logs; Workers
   observability is on by default. **Accepted:** every stage catches and maps
   to codes; a marker-string test across throwing stages; explicit
   `enabled = false` plus a deploy check.
7. P1 an undecryptable own key must not fall back to free. **Accepted:**
   `unreadable` key state blocks requests.
8. P1 "Nothing is stored" is false until Groq ZDR is on. **Accepted:** ZDR is
   a blocking release gate for the free route and its copy.
9. P2 the proxy remains a capped general LLM via edit instructions and long
   `idea` fields. **Accepted:** Worker-side forwarded-output cap per task.
10. P2 IPv6 allocations hold many /64s. **Accepted in part:** a /48 issuance
    limit. **Rejected:** per-ASN limits (an ASN is a whole ISP; one busy ISP
    would lock out its customers).
11. P2 32 KB body cap rejects valid CJK requests; `too_large` mapped
    inconsistently. **Accepted:** 64 KB; one mapping (`provider`).
12. P2 failed requests still cost quota. **Accepted:** refund count and
    reservation when upstream fails before the first byte (not after: Groq
    may have billed).
13. P2 15 s ✦ AI timeout vs a 4k edit; DO latency. **Accepted:** tighten
    timeout 30 s, edit budget capped at 4,096; DO location hint and measured
    overhead in Phase 2.
14. P2 root `vitest run` would pick up pool-workers tests; `relay/` not
    typechecked. **Accepted:** separate directory excluded by a root
    `vitest.config.ts`; `proxy:typecheck` in `npm run typecheck`.
15. P2 smaller: `ILIAD_DEV` escape hatch (**accepted:** env overrides only when
    `!app.isPackaged`); selection budget from selected text (**accepted**);
    `content_filter` undocumented (**accepted:** unknown → malformed); token
    revocation (**accepted:** `DENY_SUBJECTS` + `kid` rotation).

Also folded in (owner, via lead, same day): Spanish "clave"; reset at 00:00
UTC with `resetAt` and one message for all limits showing the local reset
time; Figma node `42:2` copy ("AI included — Free, with a daily limit", "Use
your own Groq key…"); key validated against Groq before save (never saved
unchecked); out-of-quota notice only on explicit requests; automatic
suggestions made a separable, pending decision (section 8b); measured latency
(gpt-oss-120b low: 609 ms median first token) and the dev key in
`.env.local` for Phase 0.
