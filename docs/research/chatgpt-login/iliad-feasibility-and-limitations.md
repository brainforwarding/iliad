# Iliad Feasibility And Limitations For ChatGPT Login

Status: research snapshot, partially superseded. The current direction is a
split path: Codex account auth can power the main workspace agent, while OpenAI
API keys remain the stable path for dictation, images, realtime, embeddings,
and fallback API/text runs. See [`../../agent-runtime-roadmap.md`](../../agent-runtime-roadmap.md).

## Executive Summary

Iliad should keep the API-key/provider path as the stable media and fallback
API foundation. The app is built around documented OpenAI API authentication
for API-key features: a user supplies an OpenAI API key, Electron keeps the
secret in the main process, and dictation uses the audio transcription endpoint.
This matches OpenAI's public API contract.

A Codex-style account option is not a drop-in replacement for all Iliad
features. It is appropriate for the main Codex agent runtime, but it should not
be described as general API billing or as covering dictation/transcription.
The current public OpenAI API docs still describe API keys as the API
authentication primitive, and OpenAI's help docs state that ChatGPT
subscriptions and API billing are separate products.

The safe product stance is: label Codex account connection as the Codex agent
path, keep OpenAI API keys for API/media features, and do not scrape ChatGPT web
sessions, store ChatGPT cookies, ask users for ChatGPT passwords, or imply that
ChatGPT Plus/Pro usage covers Iliad API calls.

## Current Iliad Auth And Provider Flow

Iliad is local-first and currently tells users that the assistant stores the OpenAI key/model locally in Electron app data, not in workspace Markdown files ([README.md](README.md:22), [README.md](README.md:31)). The app also supports `OPENAI_API_KEY` for local development ([README.md](README.md:35)).

The stored settings shape is narrow: `openAiApiKey`, `model`, and `mode`. `AgentSettingsStore` writes JSON to `assistant/settings.json` under Electron `userData`, reports only `hasOpenAiApiKey` to the renderer, and falls back to `process.env.OPENAI_API_KEY` when no local key exists ([electron/agent/settingsStore.ts](electron/agent/settingsStore.ts:5), [electron/agent/settingsStore.ts](electron/agent/settingsStore.ts:35), [electron/agent/settingsStore.ts](electron/agent/settingsStore.ts:45)).

`AgentService.startRun` reads the key in Electron before contacting the provider. Missing keys return a normalized `missing_api_key` error; successful runs call `createOpenAiResponse` with `apiKey`, selected `model`, run request, abort signal, run-event callback, and diagnostics callback ([electron/agent/agentService.ts](electron/agent/agentService.ts:69), [electron/agent/agentService.ts](electron/agent/agentService.ts:72), [electron/agent/agentService.ts](electron/agent/agentService.ts:85)).

The OpenAI provider posts directly to `https://api.openai.com/v1/responses` with `Authorization: Bearer ${apiKey}`. The request uses `instructions`, `input`, `max_output_tokens: 4096`, optional streaming, optional `reasoning` with effort derived from Iliad mode, and optional `text.verbosity` ([electron/agent/openai/request.ts](electron/agent/openai/request.ts:17), [electron/agent/openai/request.ts](electron/agent/openai/request.ts:45)).

The provider is already defensive around Responses API parity. It starts with streaming plus reasoning summaries and text verbosity, retries without unsupported parameters, and falls back to a non-streaming Responses request when parameter support requires it ([electron/agent/openai/client.ts](electron/agent/openai/client.ts:153), [electron/agent/openai/client.ts](electron/agent/openai/client.ts:168), [electron/agent/openai/client.ts](electron/agent/openai/client.ts:185)).

Thinking summaries are progress-only. The stream parser ignores raw reasoning text, reads `response.reasoning_summary_text.delta` and `.done`, emits sanitized `thinking_delta`/`thinking_done` events, and resolves the final response from output text or the completed response payload ([electron/agent/openai/stream.ts](electron/agent/openai/stream.ts:36), [electron/agent/openai/stream.ts](electron/agent/openai/stream.ts:55), [electron/agent/openai/stream.ts](electron/agent/openai/stream.ts:65)).

The renderer never receives key material through the typed agent API. It can get/update settings, start runs, subscribe to run events, transcribe audio, cancel runs, and apply/reject proposals ([electron/preload.ts](electron/preload.ts:38), [src/types/iliad.ts](src/types/iliad.ts:257)). The UI opens settings when no key exists and blocks assistant sends until a prompt exists and the key condition is satisfied ([src/assistant/useAssistantRun.ts](src/assistant/useAssistantRun.ts:91), [src/assistant/useAssistantRun.ts](src/assistant/useAssistantRun.ts:184)).

Dictation is also bound to the API-key flow. The renderer records microphone audio with `MediaRecorder`, caps recordings at 45 seconds and 24 MB, sends transient bytes through IPC, and inserts the returned transcript into the composer without sending the message ([src/assistant/useDictation.ts](src/assistant/useDictation.ts:7), [src/assistant/useDictation.ts](src/assistant/useDictation.ts:269), [src/assistant/useDictation.ts](src/assistant/useDictation.ts:374)). Electron validates the sender for dictation IPC, validates MIME/size/request shape before provider use, and posts to `https://api.openai.com/v1/audio/transcriptions` with the same API key ([electron/ipc/agent.ts](electron/ipc/agent.ts:54), [electron/agent/transcription.ts](electron/agent/transcription.ts:41), [electron/agent/transcription.ts](electron/agent/transcription.ts:81)).

Current diagnostics are designed not to log raw secrets, prompts, payloads, paths, or document contents. The logger rejects detail keys matching secret/token/password/credential patterns and forbids content-like keys such as `prompt`, `payload`, `raw`, `document`, and `replacement` ([electron/diagnostics/logger.ts](electron/diagnostics/logger.ts:40), [electron/diagnostics/logger.ts](electron/diagnostics/logger.ts:65), [electron/diagnostics/logger.ts](electron/diagnostics/logger.ts:298)).

## Candidate Integration Options

1. Stable API-key/provider path.

   Keep the current API-key model and improve onboarding copy. This is the only path that cleanly matches the documented OpenAI API authentication model, current Iliad architecture, dictation, Responses streaming, normalized errors, and local-first product posture. The next product work should be copy/link polish and eventual OS keychain storage, not a new auth surface.

2. Codex-style ChatGPT login/provider path.

   Codex CLI documentation says first run prompts users to authenticate with a ChatGPT account or an API key. That indicates OpenAI has first-party account auth for Codex, but it does not establish a public, supported third-party auth mechanism that Iliad can embed. The reviewed official docs do not describe a desktop-app OAuth grant that lets Iliad obtain scoped OpenAI API access using a ChatGPT subscription.

   A legitimate version of this path would require OpenAI to publish an external-app flow with clear scopes, token storage guidance, refresh/revocation behavior, API endpoint compatibility, model entitlement behavior, and billing semantics. Without that, any implementation would likely rely on private ChatGPT web or Codex internals.

3. Iliad cloud proxy with Iliad accounts.

   Iliad could eventually authenticate Iliad users to an Iliad backend, then have the backend call OpenAI with Iliad-managed API credentials. This would produce the best onboarding, but it is not "use my ChatGPT subscription." It creates backend, account, billing, quota, abuse, privacy, and institutional deployment obligations that do not exist in the local-only API-key architecture.

4. Managed/institutional API-key provisioning.

   Schools or organizations could provision project keys or service-account credentials through managed configuration. This can reduce teacher/user setup friction, but shared keys introduce spend attribution, revocation, leakage, and per-user quota problems. It should be treated as deployment management, not as ChatGPT login.

## Capability Matrix

| Capability | API-key/provider path | Codex-style ChatGPT login/provider path | Implication for Iliad |
| --- | --- | --- | --- |
| Official API auth | Supported by OpenAI API docs through Bearer API keys. | Not documented as a third-party desktop-app API auth flow. | Keep API key as production path. |
| Billing | API usage is token-billed through the API platform. | ChatGPT subscription billing is separate from API billing. Codex-specific entitlements do not generalize to Iliad. | Do not say "use Plus/Pro to pay for Iliad." |
| Responses API | Current Iliad provider posts to `/v1/responses` and handles streaming/non-streaming fallback. | Unknown unless the login flow yields a normal API credential or official token accepted by `/v1/responses`. | Require parity proof before exposing. |
| Thinking summaries | Current provider requests `reasoning.summary` and tolerates unsupported-model errors. | Unknown; ChatGPT/Codex product summaries may not equal API `reasoning.summary` events. | Use app-authored statuses unless official API event parity exists. |
| Model selection | User can type a model ID; default is `gpt-5-mini`. API docs expose current API model IDs separately from ChatGPT product labels. | ChatGPT-visible models and Codex models may not map cleanly to arbitrary API model IDs. | Preserve explicit API model setting for API-key path; avoid ChatGPT model labels unless mapped by official docs. |
| Dictation/transcription | Supported through `/v1/audio/transcriptions` with `gpt-4o-mini-transcribe` and uploaded audio. | Unknown; Codex-style auth is coding-agent oriented and does not document third-party audio transcription entitlement. | Treat audio as unsupported until proven through official API credentials. |
| Rate limits and quota | API platform rate limits/quotas are provider errors; Iliad already normalizes 429 as `rate_limited`. | ChatGPT plan limits, Codex limits, and API rate limits may be separate and product-specific. | UX must identify which account/provider is limiting the user. |
| Offline/local privacy | Local-first app; provider calls only when user invokes assistant/dictation; no cloud proxy required. | Account login adds token refresh, sign-out, local browser/session state, and possibly cloud-assisted auth. | Larger threat model than a single API key. |
| Credential storage | Currently plain JSON under Electron `userData`, accepted only as v1 risk. | Would need access tokens, refresh tokens, expiry metadata, and revocation state. | Must move to OS keychain before any account login. |
| Revocation | User can delete/revoke API key in OpenAI Platform; Iliad currently lacks a remove-key UI. | Needs logout, token revocation, stale refresh recovery, and API-key cleanup if auth auto-creates keys. | Requires a full auth lifecycle spec. |
| Supportability | Uses documented endpoints and request shapes. | Fragile if based on private ChatGPT/Codex internals. | Do not ship unofficial auth. |

## Security And Storage Considerations

The current credential storage is too weak for a broader auth system. `AgentSettingsStore` writes the API key into a JSON file in app data ([electron/agent/settingsStore.ts](electron/agent/settingsStore.ts:26)). That is a reasonable prototype tradeoff only because the blast radius is a user-supplied API key and the renderer does not receive the secret. A ChatGPT-login path would likely involve refresh tokens or generated API keys that are more persistent and harder for users to understand. Those secrets should go to OS keychain/credential vault storage before release.

Iliad should not store ChatGPT cookies or browser session material. Cookies are broad ambient authority, can include unrelated ChatGPT state, are fragile across web changes, and are a poor fit for Electron app storage. Iliad also should not ask for ChatGPT email/password. Any future login must happen in a system browser or trusted OpenAI-owned auth surface using a documented flow.

Refresh and revocation are first-class requirements, not implementation details. A future account-login spec needs token expiry handling, explicit `Sign out`, local secret deletion, server-side revocation where supported, recovery from expired/revoked grants, and clear behavior when an auth grant remains active but an auto-generated API key has been revoked separately.

Diagnostics must remain secret-safe. The existing logger's redaction policy is a good baseline, but account login would add new sensitive fields such as `access_token`, `refresh_token`, `id_token`, `authorization_code`, `expires_at`, `account_id`, and possibly organization/project identifiers. Those must be classified before logging any auth errors.

Dictation adds a separate privacy dimension. Today the app sends audio bytes to OpenAI only for transcription and does not persist recordings ([specs/2026-05-23-agent-dictation.md](specs/2026-05-23-agent-dictation.md:201)). A login path must not obscure that audio is still leaving the device for transcription unless Iliad has a local transcription provider.

## UX Implications

The settings UI currently exposes a password field for an OpenAI API key, a freeform model field, mode buttons, and a save button ([src/components/assistant/AssistantSettings.tsx](src/components/assistant/AssistantSettings.tsx:30)). That UX should be clearer before adding another auth path: show why an API key is needed, link to the API key page, say it is saved locally, and state that ChatGPT subscriptions do not include API usage.

Do not use a button labeled `Sign in with ChatGPT` unless it is backed by an official supported flow and the copy is precise about billing. A misleading login button will create the exact product confusion the existing spec warned against: users will expect their ChatGPT subscription to power Iliad, while OpenAI's public billing docs separate ChatGPT and API billing ([specs/2026-05-23-chatgpt-account-login.md](specs/2026-05-23-chatgpt-account-login.md:11)).

Provider copy should be explicit:

- `Codex agent`: uses Codex account auth for the main workspace agent.
- `OpenAI API key`: stable, self-managed API billing for dictation/media and
  fallback OpenAI API features.
- `Sign in with OpenAI account`: do not use this generic label unless OpenAI
  documents it for third-party API access; display plan/billing/limits in that
  provider's terms.
- `Use Iliad account`: only if Iliad operates a cloud proxy and owns billing/quotas.

Error messages need provider-specific language. `The OpenAI API key was rejected` is correct for API keys ([electron/agent/errors.ts](electron/agent/errors.ts:96)), but account login needs different messages for expired session, revoked grant, missing API org billing, unsupported workspace, plan not eligible, and rate limits. Avoid collapsing those into generic "OpenAI failed" messages.

Dictation UX must remain honest. If ChatGPT login does not support `/v1/audio/transcriptions`, the microphone should say that dictation requires an OpenAI API key rather than silently failing. The current dictation missing-key copy is API-key-specific by design ([electron/agent/transcription.ts](electron/agent/transcription.ts:145), [src/assistant/useDictation.ts](src/assistant/useDictation.ts:381)).

## Historical Recommended Next Spec

This recommendation was for the pre-Codex-connection phase. Keep it as
background for API-key UX and storage work:

Write a narrow "API Key Onboarding And Credential Storage v1" spec. It should include:

- A settings copy update that keeps `OpenAI API key` as the production auth
  path for media/API features.
- A `Get an API key` link to the official OpenAI Platform API key page.
- A `Remove saved key` action, because the current update path saves/replaces keys but does not expose a clean deletion path.
- OS keychain migration for `openAiApiKey`, with JSON settings retaining only non-secret fields such as model and mode.
- Provider capability metadata for text Responses, streaming, reasoning summaries, and audio transcription, so future providers can disable unsupported controls explicitly.
- Tests for missing key, invalid key, rate limit, unsupported model, dictation missing key, and no-secret logging.

If product still wants generic OpenAI account login beyond the Codex agent
runtime, write a separate "OpenAI Account Login Feasibility Gate" spec with hard
entry criteria:

- OpenAI must document a third-party app auth flow for API access, not just ChatGPT Actions OAuth and not just first-party Codex client login.
- The flow must specify scopes, token lifetime, refresh, revocation, local storage requirements, and whether it creates or uses API keys.
- The flow must work for `/v1/responses` and `/v1/audio/transcriptions`, or Iliad must expose feature gaps before login.
- Billing copy must state whether usage is API-billed, included in a plan, credit-backed, or Iliad-managed.
- The implementation must ship behind a feature flag until provider conformance tests pass.

Safe product stance: "Iliad can use Codex account auth for the main agent and
OpenAI API keys for API/media features. ChatGPT subscriptions are separate from
general API usage."

## Sources And Code References

OpenAI sources:

- OpenAI API authentication: <https://developers.openai.com/api/reference/overview#authentication>
- OpenAI Responses create API: <https://developers.openai.com/api/reference/resources/responses/methods/create>
- OpenAI reasoning summaries guide: <https://developers.openai.com/api/docs/guides/reasoning>
- OpenAI audio transcription API: <https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create>
- OpenAI models catalog: <https://developers.openai.com/api/docs/models>
- OpenAI rate limits guide: <https://developers.openai.com/api/docs/guides/rate-limits>
- OpenAI Codex CLI docs: <https://developers.openai.com/codex/cli>
- OpenAI Help, ChatGPT vs API billing: <https://help.openai.com/en/articles/9039756-managing-billing-settings-on-chatgpt-web-and-platform>
- OpenAI Help, moving ChatGPT subscription to API: <https://help.openai.com/en/articles/8156019-how-can-i-move-my-chatgpt-subscription-to-the-api>
- OpenAI GPT Action authentication: <https://developers.openai.com/api/docs/actions/authentication>

Iliad code/spec references:

- [README.md](README.md:22)
- [specs/2026-05-23-chatgpt-account-login.md](specs/2026-05-23-chatgpt-account-login.md:1)
- [specs/2026-05-23-agent-dictation.md](specs/2026-05-23-agent-dictation.md:1)
- [specs/2026-05-23-agent-thinking-summaries.md](specs/2026-05-23-agent-thinking-summaries.md:1)
- [specs/2026-05-23-agent-architecture-stabilization.md](specs/2026-05-23-agent-architecture-stabilization.md:1)
- [electron/agent/settingsStore.ts](electron/agent/settingsStore.ts:1)
- [electron/agent/agentService.ts](electron/agent/agentService.ts:1)
- [electron/agent/openai/request.ts](electron/agent/openai/request.ts:1)
- [electron/agent/openai/client.ts](electron/agent/openai/client.ts:1)
- [electron/agent/openai/stream.ts](electron/agent/openai/stream.ts:1)
- [electron/agent/transcription.ts](electron/agent/transcription.ts:1)
- [electron/ipc/agent.ts](electron/ipc/agent.ts:1)
- [electron/preload.ts](electron/preload.ts:1)
- [electron/diagnostics/logger.ts](electron/diagnostics/logger.ts:1)
- [src/components/AssistantPanel.tsx](src/components/AssistantPanel.tsx:1)
- [src/components/assistant/AssistantSettings.tsx](src/components/assistant/AssistantSettings.tsx:1)
- [src/assistant/useAssistantRun.ts](src/assistant/useAssistantRun.ts:1)
- [src/assistant/useDictation.ts](src/assistant/useDictation.ts:1)
- [src/types/iliad.ts](src/types/iliad.ts:1)
