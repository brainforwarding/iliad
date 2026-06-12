# OpenClaw And Third-Party ChatGPT Login Patterns

## Executive Summary

OpenClaw and several adjacent projects advertise or implement "ChatGPT subscription" access by using OpenAI Codex authentication rather than ordinary OpenAI Platform API keys. The clearest evidence is OpenClaw's own provider docs and source code: users sign in with `openclaw models auth login --provider openai-codex`, OpenClaw stores OAuth credentials in its auth profile store, and OpenClaw's Codex app-server bridge passes ChatGPT/Codex token material into a Codex runtime login RPC.

This is not the same as a standard OpenAI API integration. Official OpenAI docs say Codex can be used with eligible ChatGPT plans through supported Codex clients, and that Codex limits vary by plan and task size. They do not establish a general-purpose "use a ChatGPT subscription as API billing" contract for arbitrary third-party services. Some third-party code, especially smaller tools, appears to reuse Codex OAuth tokens directly against ChatGPT/Codex backend endpoints. That pattern is more fragile and looks closer to client impersonation or reverse-engineered transport than to the public OpenAI API.

For Iliad, these findings prove that real projects are trying to route coding-agent traffic through ChatGPT/Codex subscription credentials. They do not prove that Iliad can safely or durably offer "login with ChatGPT" for API-like access. The strongest engineering conclusion is that any such path would carry model-catalog churn, rate-limit opacity, token-refresh complexity, endpoint fragility, security exposure, and terms/compliance ambiguity unless OpenAI provides an explicit supported integration surface for Iliad.

## Evidence Found

- **OpenClaw project docs (confidence: project docs).** OpenClaw documents two OpenAI auth paths: OpenAI Platform API key access and "Codex subscription" access. The Codex path uses `openclaw onboard --auth-choice openai-codex` or `openclaw models auth login --provider openai-codex`, then recommends canonical `openai/gpt-*` model refs routed through a bundled Codex app-server harness. Source: https://documentation.openclaw.ai/providers/openai

- **OpenClaw repository docs (confidence: source code / project docs).** The public repo says `openai-codex` is now mainly an auth/profile namespace, while new model refs should use `openai/gpt-*`; legacy `openai-codex/gpt-*` refs are repaired by `openclaw doctor --fix`. It also documents auth ordering where a subscription profile can be tried before an API-key backup. Source: https://github.com/openclaw/openclaw/blob/main/docs/providers/openai.md

- **OpenClaw OAuth concepts (confidence: source code / project docs).** OpenClaw describes a PKCE OAuth flow against `auth.openai.com`, local callback or pasted redirect URL, token storage under `~/.openclaw/agents/<agentId>/agent/auth-profiles.json`, automatic refresh, and limited Codex CLI credential bootstrapping. Source: https://github.com/openclaw/openclaw/blob/main/docs/concepts/oauth.md

- **OpenClaw auth bridge source (confidence: source code).** `extensions/codex/src/app-server/auth-bridge.ts` resolves `openai-codex` OAuth profiles, refreshes token credentials, clears inherited `CODEX_API_KEY` / `OPENAI_API_KEY` when a subscription credential is selected, and sends either `chatgptAuthTokens` or API-key login params to the Codex app-server via `account/login/start`. Source: https://github.com/openclaw/openclaw/blob/4c210e22fa973068134c0544d0c6ff0f14a683d4/extensions/codex/src/app-server/auth-bridge.ts

- **OpenClaw Codex CLI reuse source (confidence: source code).** `src/agents/cli-credentials.ts` can read Codex CLI credentials from macOS Keychain or `~/.codex/auth.json`. `external-cli-sync.ts` treats Codex CLI credentials as bootstrap-only for `openai-codex:default`, with local OpenClaw refresh tokens becoming canonical after OpenClaw owns the profile. Sources: https://github.com/openclaw/openclaw/blob/4c210e22fa973068134c0544d0c6ff0f14a683d4/src/agents/cli-credentials.ts and https://github.com/openclaw/openclaw/blob/4c210e22fa973068134c0544d0c6ff0f14a683d4/src/agents/auth-profiles/external-cli-sync.ts

- **OpenAI official Codex docs (confidence: official).** OpenAI says Codex is included with eligible ChatGPT plans, users sign in with their ChatGPT account, usage limits vary by plan, and larger codebases or long-running tasks consume more of the allowance. The same article lists OpenAI-controlled Codex clients: Codex app, CLI, IDE extension, and web. Source: https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan

- **OpenAI Codex CLI sign-in docs (confidence: official).** OpenAI documents "Sign in with ChatGPT" for Codex CLI as linking a ChatGPT identity to an API account and creating a CLI-generated key. It also says the ChatGPT OAuth authorization and generated API key are separate revocation surfaces. Source: https://help.openai.com/en/articles/11381614-api-codex-cli-and-sign-in-with-chatgpt

- **Clawlet implementation (confidence: source code).** The `mosaxiv/clawlet` repo implements `openai-codex` OAuth itself in Go, with a hard-coded OpenAI OAuth client id, PKCE, `auth.openai.com` token exchange, device-code endpoints, persistent tokens at `~/.clawlet/auth/codex.json`, refresh-token handling, and import from `~/.codex/auth.json`. Source: https://github.com/mosaxiv/clawlet/blob/7ec97df3e8bffc48c4a86b42b4a64cdc6161d1c2/llm/openai_codex_oauth.go

- **Clawlet transport implementation (confidence: source code).** Clawlet sends the resulting OAuth bearer token and `chatgpt-account-id` header to `https://chatgpt.com/backend-api/codex/responses`, using SSE and a Responses-like payload. That is strong evidence of a reverse-engineered or private Codex/ChatGPT backend transport rather than the public OpenAI Platform Responses API. Source: https://github.com/mosaxiv/clawlet/blob/c6ea754c8932c16591a973d30a97abb26b9a12a6/llm/openai_codex.go

- **Other project/docs examples (confidence: project docs).** OpenPRX, Hermes, and Hindsight all describe OpenAI Codex / ChatGPT Plus or Pro subscription auth, usually by device-code login or by reading Codex CLI credentials. Their docs state no ordinary API key is needed, token refresh is handled locally, and usage counts against subscription/Codex quota rather than OpenAI Platform API billing. Sources: https://docs.openprx.dev/ja/prx/providers/openai-codex, https://openclawlaunch.com/zh/hermes/codex, https://hindsight.vectorize.io/developer/models

## Likely Technical Pattern

Known:

- Official OpenAI Codex supports ChatGPT account sign-in for Codex clients and plan-based Codex usage.
- OpenClaw exposes this as `openai-codex` auth, but increasingly routes actual model refs through `openai/gpt-*` plus a Codex app-server runtime.
- OpenClaw stores OAuth credentials in its own auth profile store, refreshes them, can bootstrap from Codex CLI credentials, and passes selected credentials into a Codex runtime login RPC.
- Some smaller implementations do not use a Codex app-server. They manually perform OAuth/device-code login, store refresh tokens, then call ChatGPT/Codex backend endpoints with bearer tokens and ChatGPT account identifiers.

Inferred:

- The "Codex-style auth" pattern is not a single stable public API surface. It is a family of strategies around the same credential source: OpenAI ChatGPT/Codex OAuth tokens.
- OpenClaw's newer architecture may be less brittle than direct `chatgpt.com/backend-api` calls because it delegates more behavior to the Codex app-server. It is still sensitive to Codex app-server protocol, model catalog, account quota, and auth-profile behavior.
- Direct backend callers are likely imitating Codex client behavior. They depend on undocumented endpoint paths, headers, client ids, token claims, and streaming event shapes.

Not established:

- I did not find official OpenAI documentation saying third-party products may offer a general "use your ChatGPT subscription instead of API billing" integration.
- I did not find an official public OAuth product for third-party apps to exchange a user's ChatGPT subscription into normal OpenAI API entitlements.

## Limitations And Risks

- **Terms and support risk.** OpenAI officially documents ChatGPT-plan access for Codex clients. Third-party reuse of Codex tokens for API-like services is not clearly documented as a supported OpenAI integration surface. OpenClaw docs assert external-tool support, but that is project documentation, not an OpenAI source.

- **Quota opacity and rate limits.** OpenAI states Codex limits vary by plan and task complexity. OpenClaw docs also warn that Codex OAuth limits can differ from the ChatGPT website/app experience. Community reports describe cooldowns, 5-hour/week windows, and cases where browser ChatGPT still works while OpenClaw/Codex is rate-limited. Sources: https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan, https://docs.openclaw.ai/help/faq-first-run, https://www.reddit.com/r/OpenaiCodex/comments/1s1jd4l/openclaw_chatgpt_oauth_openaicodex_hitting_rate/, https://www.reddit.com/r/openclaw/comments/1t7y5dm/openclaw_error_rate_limited/

- **Model availability churn.** OpenClaw docs distinguish current canonical refs from legacy `openai-codex/*` refs and warn that some Codex model ids are not exposed or are rejected by live requests. That means model naming and availability can change underneath existing configs.

- **Auth-profile and refresh fragility.** OpenClaw issue reports show multi-account OAuth profiles collapsing into `openai-codex:default`, OAuth callback success followed by post-callback failures, remote/VPS OAuth hangs after pasted redirect URLs, and refresh-token reuse failures. Sources: https://github.com/openclaw/openclaw/issues/40106, https://github.com/openclaw/openclaw/issues/43057, https://github.com/openclaw/openclaw/issues/41885, https://www.reddit.com/r/openclaw/comments/1s1z8q1/cant_repair_oauth_token_refresh_failed_for/

- **Scope and endpoint mismatch.** A closed OpenClaw bug report says OAuth completed but direct use of the stored token against the public Responses API failed with a missing `api.responses.write` scope. That supports the distinction between Codex/ChatGPT OAuth tokens and normal OpenAI Platform API tokens. Source: https://github.com/openclaw/openclaw/issues/36660

- **Private endpoint / bot-protection fragility.** Direct backend-call implementations depend on `chatgpt.com/backend-api/codex/responses`. Community reports allege Cloudflare or bot-protection failures for non-browser clients hitting ChatGPT backend endpoints. This is anecdotal but consistent with the fragility expected from non-public browser/backend surfaces. Source: https://www.reddit.com/r/openclaw/comments/1sn42pc/oauth_on_codex_is_blocked_by_cloud_flare/

- **Secret-handling risk.** These flows store access and refresh tokens that effectively authorize Codex/ChatGPT usage. If stored in local JSON, copied between hosts, exposed in logs, or mounted into shared containers, the blast radius is broader than an ordinary short-lived web session.

- **Operational fit.** Subscription-backed Codex access is bounded by opaque plan limits, not provisioned API RPM/TPM contracts. It may be acceptable for personal, low-volume coding-agent use; it is a poor fit for production, team, or customer-facing workloads unless OpenAI offers explicit quota, governance, billing, and revocation controls.

## What This Does And Does Not Prove For Iliad

This proves:

- There is real market demand for "use my ChatGPT/Codex subscription" in coding-agent tools.
- Public projects have working or recently working implementations of Codex-style OAuth, including OpenClaw's app-server bridge and smaller direct-backend implementations.
- The implementation surface includes enough moving parts that mature projects have had to add auth stores, refresh locks, CLI import rules, model-route migration, doctor repairs, fallback profiles, and cooldown handling.

This does not prove:

- That OpenAI provides Iliad with a supported public "Login with ChatGPT for API access" product.
- That ChatGPT subscription entitlements can be safely converted into durable API-like quota for Iliad users.
- That third-party token reuse is compliant, stable, or suitable for production.
- That OpenClaw's current route, Clawlet's direct route, or any hosted wrapper will continue working as OpenAI changes Codex clients, model catalogs, OAuth scopes, backend endpoints, rate limits, or bot defenses.

Implication for Iliad:

- Treat Codex-style ChatGPT login as a research finding and potential future integration only if OpenAI exposes a clear supported path. Do not base core Iliad auth, billing, or model access on copied Codex tokens or private ChatGPT backend calls. If Iliad explores this further, the next step should be an official OpenAI partner/support inquiry and a threat-model review of refresh-token custody.

## Sources

- OpenAI Help Center, "Using Codex with your ChatGPT plan" (official): https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan
- OpenAI Help Center / Developer Docs, "Codex CLI and Sign in with ChatGPT" / Codex CLI (official): https://help.openai.com/en/articles/11381614-api-codex-cli-and-sign-in-with-chatgpt
- OpenClaw OpenAI provider docs (project docs): https://documentation.openclaw.ai/providers/openai
- OpenClaw first-run FAQ (project docs): https://docs.openclaw.ai/help/faq-first-run
- OpenClaw OpenAI provider docs in repo (source/project docs): https://github.com/openclaw/openclaw/blob/main/docs/providers/openai.md
- OpenClaw OAuth concepts in repo (source/project docs): https://github.com/openclaw/openclaw/blob/main/docs/concepts/oauth.md
- OpenClaw Codex harness docs in repo (source/project docs): https://github.com/openclaw/openclaw/blob/4c210e22fa973068134c0544d0c6ff0f14a683d4/docs/plugins/codex-harness.md
- OpenClaw Codex app-server auth bridge (source code): https://github.com/openclaw/openclaw/blob/4c210e22fa973068134c0544d0c6ff0f14a683d4/extensions/codex/src/app-server/auth-bridge.ts
- OpenClaw CLI credential reader (source code): https://github.com/openclaw/openclaw/blob/4c210e22fa973068134c0544d0c6ff0f14a683d4/src/agents/cli-credentials.ts
- OpenClaw external CLI sync (source code): https://github.com/openclaw/openclaw/blob/4c210e22fa973068134c0544d0c6ff0f14a683d4/src/agents/auth-profiles/external-cli-sync.ts
- OpenClaw issue 36660, token lacks public Responses API scope (community/source issue): https://github.com/openclaw/openclaw/issues/36660
- OpenClaw issue 40106, multi-account profile overwrite (community/source issue): https://github.com/openclaw/openclaw/issues/40106
- OpenClaw issue 41885, remote OAuth hang (community/source issue): https://github.com/openclaw/openclaw/issues/41885
- OpenClaw issue 43057, OAuth success followed by auth failure (community/source issue): https://github.com/openclaw/openclaw/issues/43057
- Clawlet OpenAI Codex OAuth implementation (source code): https://github.com/mosaxiv/clawlet/blob/7ec97df3e8bffc48c4a86b42b4a64cdc6161d1c2/llm/openai_codex_oauth.go
- Clawlet ChatGPT backend Codex transport (source code): https://github.com/mosaxiv/clawlet/blob/c6ea754c8932c16591a973d30a97abb26b9a12a6/llm/openai_codex.go
- DeepWiki page for Clawlet OpenAI Codex OAuth (community/source summary): https://deepwiki.com/mosaxiv/clawlet/6.2-openai-codex-oauth
- OpenPRX OpenAI Codex provider docs (project docs): https://docs.openprx.dev/ja/prx/providers/openai-codex
- Hermes Codex login guide on OpenClaw Launch (project docs): https://openclawlaunch.com/zh/hermes/codex
- Hindsight model docs, OpenAI Codex setup (project docs): https://hindsight.vectorize.io/developer/models
- Reddit, OpenClaw + ChatGPT OAuth rate-limit discussion (community/anecdotal): https://www.reddit.com/r/OpenaiCodex/comments/1s1jd4l/openclaw_chatgpt_oauth_openaicodex_hitting_rate/
- Reddit, OpenClaw rate-limited while ChatGPT browser works (community/anecdotal): https://www.reddit.com/r/openclaw/comments/1t7y5dm/openclaw_error_rate_limited/
- Reddit, Codex OAuth refresh-token failure discussion (community/anecdotal): https://www.reddit.com/r/openclaw/comments/1s1z8q1/cant_repair_oauth_token_refresh_failed_for/
- Reddit, alleged Cloudflare/backend-api blocking (community/anecdotal): https://www.reddit.com/r/openclaw/comments/1sn42pc/oauth_on_codex_is_blocked_by_cloud_flare/
