# OpenClaw Auth Deep Dive

Date: 2026-05-23

## Summary

OpenClaw does not simply "log in with ChatGPT and call the normal OpenAI API." Its current implementation is a two-layer Codex stack:

1. A provider/auth layer named `openai-codex` that obtains and stores ChatGPT/Codex OAuth-style credentials.
2. A Codex runtime layer that either drives the official Codex app-server or, for compatibility routes, targets ChatGPT/Codex backend URLs.

The strongest lesson for Iliad is architectural, not copy-paste. OpenClaw keeps Codex subscription auth separate from direct OpenAI Platform API usage. Iliad should copy that separation. It should not copy OpenClaw's private endpoint usage, hard-coded OAuth client ID, or local refresh-token storage as a production integration.

The safer future path is to prototype an explicit `Codex account agent` provider using the official Codex app-server/SDK managed login modes, not to retrofit ChatGPT login into Iliad's existing OpenAI API-key provider.

## Source Snapshots Inspected

OpenClaw:

- Repository: `https://github.com/openclaw/openclaw`
- Commit inspected locally: `38e1654e098895d6677df257ec6b3f2b62a6b959`
- Local clone used for research: `/tmp/openclaw-auth-deep-dive`

OpenAI Codex:

- Repository: `https://github.com/openai/codex`
- Commit inspected locally: `7d47056ea42636271ac020b86347fbbef49490aa`
- Local clone used for comparison: `/tmp/openai-codex-auth-deep-dive`

Existing Iliad research this extends:

- [Official OpenAI And Codex Auth Findings](./official-openai-codex-auth.md)
- [OpenClaw And Third-Party ChatGPT Login Patterns](./openclaw-and-third-party-patterns.md)
- [Iliad Feasibility And Limitations For ChatGPT Login](./iliad-feasibility-and-limitations.md)
- [ChatGPT Login Research Summary And Recommendation](./summary-and-recommendation.md)

## OpenClaw's Mental Model

OpenClaw's own OpenAI provider docs say it keeps OpenAI developer APIs and Codex subscription agent usage separate:

- Agent turns use `openai/*` model refs through the native Codex app-server runtime by default.
- Non-agent OpenAI APIs such as images, embeddings, speech, and realtime remain direct OpenAI Platform API-key surfaces.
- Legacy `openai-codex/*` model refs are repaired toward `openai/*` plus Codex runtime routing.

Important source:

- `/tmp/openclaw-auth-deep-dive/docs/providers/openai.md`

This maps well to Iliad. If we ever support ChatGPT/Codex account login, it should be a separate provider/runtime path with explicit capability gaps. It should not be presented as a replacement for the current OpenAI API-key provider.

## Provider Registration

The main provider entry point is:

- `/tmp/openclaw-auth-deep-dive/extensions/openai/openai-codex-provider.ts`

`buildOpenAICodexProviderPlugin()` registers provider `openai-codex` with three auth methods:

- `oauth`: browser OAuth flow.
- `device-code`: device-code flow.
- API-key backup: normal OpenAI API-key profile, under `openai:default`.

The provider also:

- Sets the default model to the OpenAI/Codex default.
- Adds dynamic model compatibility for current Codex-oriented models.
- Normalizes model transport to `openai-codex-responses`.
- Resolves thinking policy for Codex models.
- Supports usage snapshots through Codex/ChatGPT usage endpoints.
- Refreshes OAuth credentials through plugin-owned refresh code.

Relevant code:

- `buildOpenAICodexProviderPlugin()`
- `runOpenAICodexOAuth()`
- `runOpenAICodexDeviceCode()`
- `refreshOpenAICodexOAuthCredential()`
- `normalizeCodexTransportFields()`

## Browser OAuth Flow

Browser OAuth is wrapped here:

- `/tmp/openclaw-auth-deep-dive/extensions/openai/openai-codex-oauth.runtime.ts`

The flow:

1. Performs a TLS/network preflight against `https://auth.openai.com/oauth/authorize`.
2. Shows user-facing instructions, with different copy for local and remote/VPS environments.
3. Calls `loginOpenAICodex()` from `@earendil-works/pi-ai/oauth`.
4. Uses `originator: "openclaw"`.
5. Opens a browser auth URL and expects a localhost callback.
6. Falls back to manual redirect URL entry when callback does not complete.
7. Rewrites common errors such as unsupported region and callback validation failure.
8. Returns OAuth credentials: access token, refresh token, expiry, and sometimes email.

What is useful to Iliad:

- TLS preflight and clear diagnostics.
- Remote/VPS fallback design.
- Manual paste fallback.
- Explicit progress states.

What is risky to copy:

- Depending on OpenClaw's external `loginOpenAICodex()` library as an OpenAI-supported auth product.
- Owning raw ChatGPT/Codex refresh tokens in Iliad without an explicit OpenAI-supported third-party auth contract.

## Device-Code Flow

Device-code auth is implemented directly here:

- `/tmp/openclaw-auth-deep-dive/extensions/openai/openai-codex-device-code.ts`

The flow:

1. `POST https://auth.openai.com/api/accounts/deviceauth/usercode`
2. Body includes `client_id: "app_EMoamEEZ73f0CkXaXp7hrann"`.
3. User is shown `https://auth.openai.com/codex/device` and a short user code.
4. OpenClaw polls `POST https://auth.openai.com/api/accounts/deviceauth/token`.
5. On success, the response includes an authorization code and code verifier.
6. OpenClaw exchanges that at `POST https://auth.openai.com/oauth/token`.
7. The token exchange uses redirect URI `https://auth.openai.com/deviceauth/callback`.
8. OpenClaw stores access token, refresh token, and expiry.

This matches the shape of OpenAI Codex app-server's official `chatgptDeviceCode` login mode, but OpenClaw is implementing the token acquisition itself.

What is useful to Iliad:

- Device-code UX is excellent for desktop apps when browser callbacks are fragile.
- Polling logic and timeout UX are worth copying conceptually.

What is risky to copy:

- Hard-coding OpenAI/Codex client ID `app_EMoamEEZ73f0CkXaXp7hrann`.
- Directly calling `auth.openai.com` device endpoints from Iliad as if they were public Platform API.
- Taking long-lived refresh-token custody before we have OS keychain storage and a documented support path.

## Credential Storage

OpenClaw stores auth profiles in:

- `~/.openclaw/agents/<agentId>/agent/auth-profiles.json`

Documented in:

- `/tmp/openclaw-auth-deep-dive/docs/concepts/oauth.md`
- `/tmp/openclaw-auth-deep-dive/docs/gateway/security/index.md`

Types and storage code:

- `/tmp/openclaw-auth-deep-dive/src/agents/auth-profiles/types.ts`
- `/tmp/openclaw-auth-deep-dive/src/agents/auth-profiles/store.ts`
- `/tmp/openclaw-auth-deep-dive/src/agents/auth-profiles/persisted.ts`

OAuth profile material can include:

- `access`
- `refresh`
- `expires`
- `provider`
- `email`
- `accountId`
- `chatgptPlanType`
- `idToken`

OpenClaw's security docs explicitly warn that `auth-profiles.json` may contain API keys and OAuth tokens and should be protected with tight permissions.

Implication for Iliad:

- Iliad should not store ChatGPT/Codex access or refresh tokens in its current plain JSON settings file.
- OS keychain storage should be a hard prerequisite before any account-login provider.
- A future provider needs logout, revocation, refresh-failure recovery, account switching, and no-secret diagnostics before release.

## Refresh And Race Handling

OpenClaw refresh logic is split across:

- `/tmp/openclaw-auth-deep-dive/extensions/openai/openai-codex-provider.runtime.ts`
- `/tmp/openclaw-auth-deep-dive/extensions/openai/openai-codex-provider.ts`
- `/tmp/openclaw-auth-deep-dive/src/agents/auth-profiles/oauth.ts`
- `/tmp/openclaw-auth-deep-dive/src/agents/auth-profiles/oauth-manager.ts`

Key behavior:

- `refreshOpenAICodexOAuthCredential()` calls plugin runtime `refreshOpenAICodexToken()`.
- The shared `createOAuthManager()` serializes refreshes and handles refresh-token reuse errors.
- External CLI credentials can be fallback/bootstrap material, but local refreshed credentials become canonical.
- Identity checks prevent overwriting a stored profile with a different account.

This is worth learning from. If Iliad ever stores rotating OAuth credentials, it needs a refresh manager. A naive "refresh whenever expired" implementation can race and invalidate rotating refresh tokens.

## Codex CLI Credential Import

OpenClaw can read existing Codex CLI credentials from:

- macOS Keychain service `Codex Auth`
- `$CODEX_HOME/auth.json`
- `~/.codex/auth.json`

Relevant code:

- `/tmp/openclaw-auth-deep-dive/src/agents/cli-credentials.ts`
- `/tmp/openclaw-auth-deep-dive/src/agents/auth-profiles/external-cli-sync.ts`

Important detail: OpenClaw treats Codex CLI import for `openai-codex` as `bootstrapOnly`. If OpenClaw already has a local OAuth profile, it keeps the local profile rather than letting stale CLI state replace it.

Implication for Iliad:

- Reading Codex CLI credentials could be a developer-only experiment, but it should not be a production onboarding path.
- Iliad should not copy or persist `~/.codex` credentials.
- If ever supported, it should be explicit, read-only, and clearly labeled as using the existing Codex CLI session.

## Codex App-Server Bridge

The core bridge is:

- `/tmp/openclaw-auth-deep-dive/extensions/codex/src/app-server/auth-bridge.ts`

The bridge:

1. Creates an isolated per-agent `CODEX_HOME`.
2. Resolves the selected auth profile.
3. Clears inherited `CODEX_API_KEY` and `OPENAI_API_KEY` when a subscription credential is selected.
4. Builds one of two login parameter shapes:
   - `{ type: "apiKey", apiKey }`
   - `{ type: "chatgptAuthTokens", accessToken, chatgptAccountId, chatgptPlanType }`
5. Sends `account/login/start` to the Codex app-server.
6. Responds to server-initiated `account/chatgptAuthTokens/refresh` requests by refreshing OpenClaw's OAuth credential and returning new token data.

This is the most important implementation detail. OpenClaw's subscription path is not "call `/v1/responses` with a ChatGPT token." It logs a Codex app-server into a ChatGPT/Codex account, then lets the Codex runtime own the agent loop.

## Transport And Endpoint Selection

OpenClaw defines the Codex backend base URL here:

- `/tmp/openclaw-auth-deep-dive/extensions/openai/base-url.ts`

It sets:

```text
https://chatgpt.com/backend-api/codex
```

The OpenAI transport layer detects native Codex backend URLs and strips unsupported normal Responses parameters:

- `/tmp/openclaw-auth-deep-dive/src/agents/openai-transport-stream.ts`

Notable behavior:

- `openai-codex-responses` is routed as an OpenAI-family stream, but with Codex-specific base URL handling.
- Native Codex backend URLs cause OpenClaw to delete unsupported fields such as `max_output_tokens`, `metadata`, `prompt_cache_retention`, `service_tier`, `temperature`, and `top_p`.
- For Codex responses, OpenClaw uses `instructions` differently from normal OpenAI Responses and ensures non-empty input.

Implication for Iliad:

- Directly calling `chatgpt.com/backend-api/codex` is not equivalent to the public OpenAI Responses API.
- Iliad's current structured edit behavior, thinking-summary behavior, and transcription behavior cannot be assumed to work unchanged.
- If we use Codex, we should talk to Codex app-server/SDK, not reimplement its private backend transport.

## Official OpenAI Codex App-Server Comparison

The OpenAI Codex repo documents app-server auth/account methods in:

- `/tmp/openai-codex-auth-deep-dive/codex-rs/app-server/README.md`
- `/tmp/openai-codex-auth-deep-dive/codex-rs/app-server-protocol/schema/typescript/v2/LoginAccountParams.ts`
- `/tmp/openai-codex-auth-deep-dive/sdk/python/src/openai_codex/api.py`

Official app-server auth modes include:

- `apiKey`: caller supplies an OpenAI API key.
- `chatgpt`: managed browser ChatGPT login. Codex owns OAuth and refresh tokens.
- `chatgptDeviceCode`: managed device-code ChatGPT login. Codex owns OAuth and refresh tokens.

The generated protocol schema also includes:

- `chatgptAuthTokens`: host app supplies an access token, ChatGPT account ID, and optional plan type.

Important distinction:

- The app-server README calls managed `chatgpt` recommended.
- `GetAccountParams` says external auth mode ignores `refreshToken`; clients should refresh tokens themselves and call `account/login/start` with `chatgptAuthTokens`.
- OpenClaw chooses the external-token route because OpenClaw owns the auth profile system and wants to bridge its tokens into Codex.

For Iliad, managed `chatgpt` or `chatgptDeviceCode` is safer to prototype than OpenClaw-style external `chatgptAuthTokens`, because Codex itself owns token persistence and refresh.

## Capability Gaps For Iliad

The current Iliad assistant uses:

- OpenAI Platform Responses API for document-aware assistant replies and reviewable edits.
- OpenAI Platform audio transcription for dictation.
- Renderer/Electron proposal state for inline document diffs.

OpenClaw's Codex path does not prove those all work under ChatGPT/Codex subscription auth.

Specific gaps:

- Dictation: Iliad uses `/v1/audio/transcriptions`. Codex account auth does not establish access to that API.
- Thinking summaries: Codex app-server may expose reasoning/progress differently from Responses API streaming events.
- Document editing: Codex app-server is built around workspace/files/tools. Iliad would need to map Codex file-change events into its existing Markdown pending-diff UI.
- Context: Codex has its own workspace/context/session model. Iliad's current assistant context builder is different.
- Model selection: Codex subscription-visible model names, API model IDs, and Codex runtime model catalog are related but not identical.
- Billing/limits: Codex plan usage follows ChatGPT/Codex plan limits and credits, not OpenAI Platform API billing.

## What We Should Replicate

Copy these ideas:

- Separate provider paths: `OpenAI API key` and `Codex account agent` should be different modes.
- Capability metadata per provider: text responses, file edits, thinking/progress, dictation, image input, rate-limit visibility.
- Explicit auth profile state: provider, account identity, expiry, plan type, and selected profile.
- Token refresh locking and identity checks.
- Logout and clear-auth lifecycle.
- Device-code UX as a fallback when browser callback is unreliable.
- Per-provider rate-limit display.
- Clearing inherited API keys when subscription auth is selected, to avoid using the wrong billing path.
- Redacted diagnostics around auth failures.

## What We Should Not Replicate

Do not copy these as production behavior:

- Hard-code OpenClaw's OAuth client ID.
- Implement private `auth.openai.com` Codex OAuth/device endpoints directly unless OpenAI documents them as public third-party endpoints.
- Call `https://chatgpt.com/backend-api/codex` directly from Iliad.
- Store ChatGPT/Codex refresh tokens in plain Electron app-data JSON.
- Import Codex CLI credentials silently.
- Tell users that ChatGPT Plus/Pro pays for Iliad's normal OpenAI API calls.
- Treat Codex account login as supporting dictation until transcription parity is proven.

## Recommended Replication Plan

### Phase 0: Keep Current Production Path

Keep the current OpenAI API-key provider as the production path for:

- Assistant responses.
- Reviewable Markdown edits.
- Thinking summaries from Responses API events.
- Dictation/transcription.

Improve the UX copy to explain that it uses OpenAI Platform API billing, not ChatGPT subscription billing.

### Phase 1: Build A Thin Codex App-Server Spike

Prototype outside the normal assistant provider path:

- Spawn official `codex app-server`.
- Call `initialize`.
- Call `account/read`.
- Start `account/login/start` with `type: "chatgptDeviceCode"` or `type: "chatgpt"`.
- Read `account/updated`.
- Read `account/rateLimits/read`.
- Start a minimal thread against a temporary workspace.
- Observe file-change events and see if they can map into Iliad's pending-diff model.

Do not store external tokens in Iliad for this spike. Let Codex managed login own its own token lifecycle.

### Phase 2: Evaluate Fit

Answer these before productizing:

- Can Codex app-server run reliably inside Iliad's Electron distribution on macOS and later Windows?
- Can it operate on Iliad's selected workspace without bypassing Iliad's approval model?
- Can file edits be captured as pending diffs rather than immediately mutating Markdown files?
- Can the UI stay minimal and document-centered?
- Can dictation stay API-key-only while assistant turns use Codex account auth?
- Can users understand which provider is active and which usage limit applies?

### Phase 3: Productize Only If The Spike Works

If the spike proves viable:

- Add provider picker:
  - `OpenAI API key`
  - `Codex account agent (experimental)`
- Add OS keychain storage before storing any Iliad-owned tokens.
- Prefer official managed `chatgpt` / `chatgptDeviceCode` app-server login.
- Avoid external `chatgptAuthTokens` unless OpenAI publishes a clear third-party app auth lifecycle.
- Keep dictation under OpenAI API key unless Codex exposes supported transcription.

## Updated Recommendation

OpenClaw proves the idea is technically real, and OpenAI's own Codex app-server now makes a supported direction much more plausible than the earliest Iliad spec assumed.

But the implementation we should learn from is not "clone OpenClaw auth." It is:

- Use the official Codex app-server/SDK if we want subscription-style Codex account login.
- Treat that as a separate agent runtime, not a normal OpenAI API-key replacement.
- Keep the current OpenAI API-key provider for general OpenAI API features such as dictation.

This changes the research conclusion from "do not do it" to "do not do it by copying OpenClaw's external-token bridge; prototype it as an official Codex app-server provider."

## Source References

OpenClaw source:

- OpenAI provider docs: `docs/providers/openai.md`
- OAuth storage docs: `docs/concepts/oauth.md`
- Security storage warning: `docs/gateway/security/index.md`
- Browser OAuth: `extensions/openai/openai-codex-oauth.runtime.ts`
- Device-code auth: `extensions/openai/openai-codex-device-code.ts`
- Provider registration: `extensions/openai/openai-codex-provider.ts`
- Provider runtime refresh: `extensions/openai/openai-codex-provider.runtime.ts`
- Codex backend URL: `extensions/openai/base-url.ts`
- Codex app-server auth bridge: `extensions/codex/src/app-server/auth-bridge.ts`
- Codex app-server protocol client: `extensions/codex/src/app-server/client.ts`
- Transport special-casing: `src/agents/openai-transport-stream.ts`
- Auth profile types/store: `src/agents/auth-profiles/types.ts`, `src/agents/auth-profiles/store.ts`
- Refresh manager: `src/agents/auth-profiles/oauth.ts`, `src/agents/auth-profiles/oauth-manager.ts`
- Codex CLI credential import: `src/agents/cli-credentials.ts`, `src/agents/auth-profiles/external-cli-sync.ts`
- Codex usage endpoint: `src/infra/provider-usage.fetch.codex.ts`

OpenAI Codex source:

- Auth docs pointer: `docs/authentication.md`
- App-server auth README: `codex-rs/app-server/README.md`
- Account processor: `codex-rs/app-server/src/request_processors/account_processor.rs`
- Login/account protocol schema: `codex-rs/app-server-protocol/schema/typescript/v2/LoginAccountParams.ts`
- Account read schema: `codex-rs/app-server-protocol/schema/typescript/v2/GetAccountParams.ts`
- Server request schema: `codex-rs/app-server-protocol/schema/typescript/ServerRequest.ts`
- Python SDK login methods: `sdk/python/src/openai_codex/api.py`
- Auth manager and external token comments: `codex-rs/login/src/auth/manager.rs`

Official OpenAI web docs:

- Codex authentication: https://developers.openai.com/codex/auth
- Codex CLI: https://developers.openai.com/codex/cli
- Using Codex with ChatGPT plan: https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan
- API authentication: https://platform.openai.com/docs/api-reference/authentication
