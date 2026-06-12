# ChatGPT Login Research Summary And Recommendation

Date: 2026-05-23

Status: research snapshot, partially superseded. The current product direction
is in [`../../agent-vision.md`](../../agent-vision.md) and
[`../../agent-runtime-roadmap.md`](../../agent-runtime-roadmap.md): Codex
account auth can power the main workspace agent, while OpenAI API keys remain
the stable path for media/API features such as dictation and for fallback text
runs. This document is still useful for limitations and anti-patterns.

## Research Documents

- [Official OpenAI And Codex Auth Findings](./official-openai-codex-auth.md)
- [OpenClaw And Third-Party ChatGPT Login Patterns](./openclaw-and-third-party-patterns.md)
- [OpenClaw Auth Deep Dive](./openclaw-auth-deep-dive.md)
- [Iliad Feasibility And Limitations For ChatGPT Login](./iliad-feasibility-and-limitations.md)

## Short Answer

The earlier conclusion should be narrowed, not discarded.

It is too broad to say "ChatGPT login is not allowed" in general. Official OpenAI docs now clearly support "Sign in with ChatGPT" for Codex surfaces such as the Codex app, Codex CLI, and Codex IDE extension. OpenAI's Codex authentication docs say Codex supports both "Sign in with ChatGPT for subscription access" and "Sign in with an API key for usage-based access." They also say the browser login returns an access token to the Codex CLI or IDE extension.

That does not mean Iliad can safely replace API keys with a ChatGPT subscription login for arbitrary OpenAI API calls. The official docs still distinguish Codex subscription access from normal OpenAI Platform API usage. API-key usage is billed through the OpenAI Platform account, and OpenAI's billing docs state that ChatGPT and API Platform billing are separate systems.

OpenClaw appears to work because it is using a Codex-style provider path, not because ChatGPT subscriptions are a general API-billing substitute. That path may be suitable for Codex-like coding-agent clients or Codex-compatible runtimes, but it is not yet a documented, stable third-party desktop-app auth product for Iliad's current document assistant.

## What We Learned

Official OpenAI evidence:

- Codex supports ChatGPT sign-in for subscription access in supported Codex clients.
- Codex also supports API-key sign-in for usage-based access.
- Codex access tokens are documented for trusted Codex local workflows, especially enterprise automation.
- For general OpenAI API calls, OpenAI still points developers to Platform API keys.
- ChatGPT subscriptions and OpenAI Platform API billing remain separate.

OpenClaw and third-party evidence:

- OpenClaw documents an `openai-codex` auth/provider path and routes some model use through Codex-style credentials.
- OpenClaw stores and refreshes OAuth-style auth profiles, can import Codex CLI credentials, and bridges credentials into a Codex runtime.
- Smaller tools appear to call private or semi-private ChatGPT/Codex backend endpoints directly. That is a much riskier pattern than using a documented OpenAI API.
- Community reports show real limitations: rate-limit confusion, profile bugs, refresh failures, private endpoint fragility, and model availability churn.

Iliad feasibility evidence:

- Iliad's current assistant uses the documented OpenAI API-key pattern for Responses API calls.
- Dictation uses `/v1/audio/transcriptions`, also through the API-key path.
- Thinking summaries depend on Responses API streaming events.
- A Codex-style login may not support transcription, current Responses API behavior, arbitrary model IDs, or Iliad's document-editing workflow without a deeper provider abstraction.

## Product Recommendation

Use precise labels and split the surfaces:

- `Codex agent` for the main workspace agent runtime.
- `OpenAI API key` for dictation, images, realtime, embeddings, and fallback
  text/API runs.

Do not ship a generic `Use my ChatGPT subscription` label. It implies that all
Iliad usage, including dictation, is covered by ChatGPT plans, which is not the
contract.

## Hard Gates And Limitations

Before expanding account auth beyond the current Codex runtime path, Iliad still
needs answers for:

1. Is the auth path officially documented for third-party desktop apps, or only for OpenAI Codex clients?
2. Does the resulting credential work with Iliad's required capabilities: text responses, streaming, thinking summaries, structured edits, and audio transcription?
3. Which endpoint is used: public OpenAI Platform API, Codex app server/runtime, or private ChatGPT backend?
4. What billing/usage limit applies: API token billing, ChatGPT agentic usage limits, Codex credits, or Iliad-managed billing?
5. How are access tokens, refresh tokens, generated API keys, account IDs, and revocation handled?
6. Can secrets be stored in the OS keychain instead of plain JSON before release?
7. What does logout do, and does it revoke only a local token, an OAuth grant, a generated API key, or all of them?
8. What features are disabled when this provider lacks API parity, especially dictation?

## What Not To Do

- Do not ask users for their ChatGPT email/password.
- Do not store ChatGPT cookies.
- Do not scrape browser sessions.
- Do not call private `chatgpt.com/backend-api` endpoints as a production dependency.
- Do not imply ChatGPT Plus/Pro automatically covers Iliad's OpenAI API usage.
- Do not hide dictation/transcription limitations behind a generic login button.

## Current Next Step

Continue improving the Codex runtime through the Markdown-first agent roadmap:
context manifests, document tools, evented runs, local history, and bounded
subagents. Treat ChatGPT/Codex account auth as an agent-runtime feature, not as
a general OpenAI API credential.

## Source Anchors

Official OpenAI sources checked during orchestration:

- OpenAI Codex authentication: https://developers.openai.com/codex/auth
- OpenAI Codex CLI: https://developers.openai.com/codex/cli
- OpenAI help: Using Codex with your ChatGPT plan: https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan
- OpenAI help: ChatGPT and Platform billing: https://help.openai.com/en/articles/9039756-billing-settings-in-chatgpt-vs-platform
- OpenAI help: ChatGPT subscription and API billing separation: https://help.openai.com/en/articles/8156019-is-api-usage-included-in-chatgpt-subscriptions-even-if-i-have-a-paid-chatgpt-account

See the three linked research docs for additional OpenClaw, source-code, community, and Iliad-code references.
