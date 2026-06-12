# Official OpenAI And Codex Auth Findings

## Executive Summary

As of May 23, 2026, official OpenAI documentation does not establish a general way for an ordinary third-party desktop app to let users "sign in with ChatGPT" and then make arbitrary OpenAI Platform API calls against the user's ChatGPT subscription. The documented OpenAI Platform API authentication model remains API-key based, and OpenAI states that ChatGPT and API Platform billing are separate.

OpenAI does document "Sign in with ChatGPT" for Codex products: the Codex app, Codex CLI, Codex IDE extension, and Codex cloud. That support is product-specific. Codex documentation distinguishes subscription access through ChatGPT sign-in from usage-based access through an API key.

OpenAI also documents OAuth flows for ChatGPT Apps, Apps SDK/MCP connectors, and GPT Actions. Those flows authenticate a ChatGPT user to a third-party application's own authorization server while ChatGPT acts as the client. They do not document a public OpenAI OAuth flow that lets a third-party desktop application obtain OpenAI API access or spend a user's ChatGPT subscription.

## What Is Officially Supported

OpenAI Platform API calls are authenticated with API keys. The API reference says the API uses API keys for authentication and shows bearer-token use with `Authorization: Bearer OPENAI_API_KEY`. It also says usage from API requests counts against the selected organization and project.

Source: https://platform.openai.com/docs/api-reference/authentication

OpenAI separately documents that ChatGPT and API Platform billing are managed separately. The Help Center says ChatGPT and the API Platform "use separate billing systems," and another Help Center article says the API service is billed and managed separately from ChatGPT.

Sources:
- https://help.openai.com/en/articles/9039756-managing-billing-settings-on-chatgpt-web-and-platform
- https://help.openai.com/en/articles/8156019-is-api-usage-included-in-chatgpt-subscriptions-even-if-i-have-a-paid-chatgpt-account

Codex supports two OpenAI sign-in methods. The Codex authentication page lists "Sign in with ChatGPT for subscription access" and "Sign in with an API key for usage-based access." It says Codex cloud requires ChatGPT sign-in, while the CLI and IDE extension support both sign-in methods. The same page says general OpenAI API calls should continue to use Platform API keys.

Source: https://developers.openai.com/codex/auth

Codex CLI is an official OpenAI local coding agent. Its setup page says ChatGPT Plus, Pro, Business, Edu, and Enterprise plans include Codex, and first run prompts the user to authenticate with a ChatGPT account or API key.

Source: https://developers.openai.com/codex/cli

The Codex app is an official OpenAI desktop experience for Codex threads. Its documentation says the app is available on macOS and Windows and lets users sign in with a ChatGPT account or an OpenAI API key. It also notes that if the user signs in with an API key, some functionality such as cloud threads may not be available.

Source: https://developers.openai.com/codex/app

The Codex IDE extension is official and supports local IDE use. The documentation says Codex plans include the IDE extension, and the JetBrains IDE integration supports signing in with ChatGPT, an API key, or a JetBrains AI subscription.

Source: https://developers.openai.com/codex/ide

Codex access tokens are supported for ChatGPT Business and Enterprise workspaces. They are for trusted, non-interactive Codex local workflows that need ChatGPT workspace identity or Codex entitlements. OpenAI explicitly frames these as Codex-local automation credentials and says Platform API keys should be used for general OpenAI API calls.

Source: https://developers.openai.com/codex/enterprise/access-tokens

ChatGPT Apps and Apps SDK connectors can authenticate users to an app's own backend. The Apps SDK authentication guide says an authenticated MCP server is expected to implement OAuth 2.1, with ChatGPT acting as the client on behalf of the user. ChatGPT then attaches the resulting third-party access token to MCP requests. This is account linking between ChatGPT and the app's service, not a way for the app to log into OpenAI.

Sources:
- https://developers.openai.com/apps-sdk/build/auth
- https://developers.openai.com/apps-sdk/deploy/connect-chatgpt

GPT Actions support no authentication, API-key authentication, and OAuth for calls from ChatGPT to the developer's API. The OAuth documentation describes ChatGPT showing a "Sign in to [domain]" button and using the developer-provided authorization URL, token URL, client ID, client secret, and scopes.

Source: https://platform.openai.com/docs/actions/authentication

## What Is Not Established Or Not Supported

Official sources found for this research do not document a public "Sign in with ChatGPT" OAuth product for arbitrary third-party desktop applications that want to call the OpenAI Platform API on behalf of a user's ChatGPT account.

The Codex ChatGPT sign-in flow is documented for OpenAI Codex surfaces and Codex access tokens are documented for Codex local workflows. Those docs do not say third-party applications can reuse the same token flow, register OAuth clients, exchange ChatGPT identity for Platform API access, or charge general API usage to a user's ChatGPT subscription.

The Apps SDK and GPT Actions OAuth flows run in the opposite direction from Iliad's proposed desktop-login question. They let ChatGPT connect to a third-party app or API using that app's auth system. They do not make OpenAI an OAuth identity provider for a third-party desktop app's OpenAI API calls.

No official source found says ChatGPT Plus, Pro, Business, Enterprise, or other ChatGPT subscriptions include arbitrary OpenAI Platform API usage for third-party apps. The official billing sources instead distinguish ChatGPT subscriptions from API billing.

## Capability And Billing Boundaries

For OpenAI Platform API usage, the documented billing boundary is the API organization/project. Requests authenticated with API keys are billed through the Platform account at standard API rates, separate from ChatGPT billing.

Sources:
- https://platform.openai.com/docs/api-reference/authentication
- https://help.openai.com/en/articles/9039756-managing-billing-settings-on-chatgpt-web-and-platform

For Codex, the documented boundary depends on sign-in method. With ChatGPT sign-in, Codex usage follows ChatGPT workspace permissions, RBAC, and ChatGPT Enterprise retention/residency settings. With an API key, usage follows the API organization's retention and data-sharing settings and is billed at standard API rates.

Source: https://developers.openai.com/codex/auth

Codex pricing is documented as included in ChatGPT Free, Go, Plus, Pro, Business, Edu, or Enterprise plans, with separate API-key usage for CLI, SDK, or IDE extension automation. The API-key option is described as token-based API pricing and excludes cloud-based Codex features such as GitHub code review and Slack integration.

Source: https://developers.openai.com/codex/pricing

Model and modality boundaries also matter. OpenAI's model pages list Codex-oriented models such as GPT-5-Codex, GPT-5.2-Codex, and GPT-5.3-Codex as optimized for agentic coding and show audio as not supported for those models. Audio and transcription are documented under separate realtime/audio and speech-to-text models such as `gpt-realtime-whisper`, GPT-4o transcription models, and `whisper-1`.

Sources:
- https://developers.openai.com/api/docs/models/all
- https://developers.openai.com/api/docs/models/gpt-5-codex
- https://developers.openai.com/api/docs/models/gpt-5.3-codex
- https://developers.openai.com/api/docs/models/whisper-1

Nothing in the official Codex sign-in documentation found here says that ChatGPT subscription-based Codex access covers general audio transcription APIs, realtime APIs, or other non-Codex Platform API calls made by a third-party desktop app.

## Implications For Iliad

Iliad should not assume that "Sign in with ChatGPT" can replace API-key entry for its own desktop app's ordinary OpenAI API calls. The supported implementation options are:

- Ask users for an OpenAI Platform API key and make clear that usage is billed through their API Platform account.
- Operate Iliad through Iliad's own backend/API key and bill users through Iliad's own product model, subject to OpenAI Platform terms and production controls.
- Build a ChatGPT App or connector if the desired experience is inside ChatGPT, using Iliad's own OAuth/account system for user linking.
- Use Codex ChatGPT sign-in or Codex access tokens only for workflows that are actually Codex local/cloud workflows and only within the documented Codex product boundaries.

For audio or transcription features, Iliad should plan around OpenAI Platform audio/transcription APIs and their API-key/billing model unless OpenAI publishes a separate official entitlement mechanism. The current official sources do not establish ChatGPT subscription pass-through for those APIs.

## Sources

- OpenAI API authentication: https://platform.openai.com/docs/api-reference/authentication
- ChatGPT versus API Platform billing: https://help.openai.com/en/articles/9039756-managing-billing-settings-on-chatgpt-web-and-platform
- Moving ChatGPT subscription to API / separate API billing: https://help.openai.com/en/articles/8156019-is-api-usage-included-in-chatgpt-subscriptions-even-if-i-have-a-paid-chatgpt-account
- Codex authentication: https://developers.openai.com/codex/auth
- Codex CLI: https://developers.openai.com/codex/cli
- Codex app: https://developers.openai.com/codex/app
- Codex IDE extension: https://developers.openai.com/codex/ide
- Codex access tokens: https://developers.openai.com/codex/enterprise/access-tokens
- Codex pricing: https://developers.openai.com/codex/pricing
- Apps SDK authentication: https://developers.openai.com/apps-sdk/build/auth
- Apps SDK connect from ChatGPT: https://developers.openai.com/apps-sdk/deploy/connect-chatgpt
- GPT Action authentication: https://platform.openai.com/docs/actions/authentication
- OpenAI models overview: https://developers.openai.com/api/docs/models/all
- GPT-5-Codex model: https://developers.openai.com/api/docs/models/gpt-5-codex
- GPT-5.3-Codex model: https://developers.openai.com/api/docs/models/gpt-5.3-codex
- Whisper model: https://developers.openai.com/api/docs/models/whisper-1
