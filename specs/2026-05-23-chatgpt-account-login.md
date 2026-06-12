# OpenAI API Key Onboarding And ChatGPT Login Feasibility Spec

Date: 2026-05-23
Status: reviewed spec, partially superseded

Superseded note: this spec remains correct that ChatGPT login is not a general
OpenAI API-billing replacement. It is superseded for the main agent runtime by
the Codex account path documented in
[`docs/agent-runtime-roadmap.md`](../docs/agent-runtime-roadmap.md). Current
direction: Codex account auth may power the agent; OpenAI API keys still power
dictation/media and fallback API features.

## Product Intent

Clarify why Iliad uses an OpenAI API key today, improve the setup experience,
and document whether personal ChatGPT account login can replace API-key setup.

Narrowed decision: do not ship ChatGPT web session reuse,
ChatGPT-subscription billing for OpenAI API calls, or a generic `Use my ChatGPT
subscription` surface. Codex account auth is allowed for the Codex agent
runtime. API-key onboarding remains the path for dictation/media and fallback
OpenAI API usage.

## Source Material

Official OpenAI documentation:

- API authentication:
  <https://developers.openai.com/api/reference/overview#authentication>
- API quickstart:
  <https://developers.openai.com/api/docs/quickstart>
- Project API keys:
  <https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/projects/subresources/api_keys>
- ChatGPT vs API billing:
  <https://help.openai.com/en/articles/9039756-managing-billing-settings-on-chatgpt-web-and-platform>
- Moving ChatGPT subscription to API:
  <https://help.openai.com/en/articles/8156019-how-can-i-move-my-chatgpt-subscription-to-the-api>
- ChatGPT Actions OAuth:
  <https://developers.openai.com/api/docs/actions/authentication>

Key current findings:

- The OpenAI API uses API keys for authentication.
- API keys are passed as HTTP Bearer credentials.
- OpenAI says ChatGPT and API billing are separate products.
- OpenAI says ChatGPT subscriptions cannot be moved to API usage; API usage is
  billed separately by tokens.
- The Project API Keys API can list, retrieve, and delete project keys, but it
  does not issue user API keys. Users authorize themselves to generate keys.
- ChatGPT Actions OAuth is for ChatGPT calling a third-party API on behalf of a
  user. It is not an OAuth flow for a desktop app to obtain OpenAI API access.
  In other words, ChatGPT Actions OAuth authenticates ChatGPT to Iliad or
  another third-party API; it does not authenticate Iliad to OpenAI.

## Current State

Iliad supports one local authentication path:

- User pastes an OpenAI API key in the agent settings panel.
- Electron stores the key locally via `AgentSettingsStore`.
- Electron uses the key in the local main-process backend, not in the renderer.
- The renderer only receives whether a key exists.

This is compatible with OpenAI API authentication, but copy/paste is not ideal.

## Feasibility Conclusion

The requested version, "use my ChatGPT subscription to power API calls," is not
currently supported by the official docs reviewed for this spec.

Do not implement a hidden ChatGPT web-login/session-token integration. It would
depend on private ChatGPT web internals, would likely break, and could violate
platform expectations. Iliad should only use documented API authentication.

## Goals

- Preserve the current API-key path.
- Improve the setup UX so API-key entry feels less technical.
- Document officially supported alternatives.
- Avoid promising that ChatGPT Plus/Pro subscriptions pay for API use.
- Keep credentials local for v1 unless a future server/proxy is explicitly
  designed and reviewed.

## Non-Goals

- No scraping ChatGPT web sessions.
- No storing ChatGPT cookies.
- No use of unofficial reverse-engineered ChatGPT APIs.
- No OAuth claim unless OpenAI publishes a public OAuth flow for API access.
- No app-hosted proxy in this spec.
- No shared Iliad API key for users.

## Supported Product Paths

### Path A: Keep Local API Key, Improve UX

Recommended near-term path.

UX:

- Keep the local API key setting.
- Add a clearer setup button: `Get an API key`.
- Open the OpenAI API key page in the browser.
- Explain that an OpenAI API key is required and ChatGPT Plus/Pro does not
  include API usage.
- Store only the key locally.

Pros:

- Officially supported now.
- No backend required.
- User controls billing.
- Keeps Iliad local-first.

Cons:

- Users still need an API platform account and billing setup.
- ChatGPT subscription users may be confused without clear copy.

### Path B: Organization/School Managed API Key

For institutional deployments, an admin can provision an API key or service
account key and distribute it through managed app configuration.

Pros:

- Good for workshops or schools.
- Avoids each teacher creating API billing.

Cons:

- Requires secure managed distribution, such as MDM or equivalent.
- Shared keys create spend, attribution, revocation, and leakage risk.
- Should use project-level budgets, rate limits, rotation, audit attribution,
  and per-user/per-device credentials where possible.
- This is not ChatGPT account login.

### Path C: Iliad Cloud Proxy With Iliad Accounts

Future product option, not v1.

Iliad could run a backend that authenticates Iliad users and calls OpenAI using
Iliad-managed OpenAI credentials. Billing would be Iliad-managed, not the
user's personal ChatGPT subscription.

Pros:

- Best user onboarding.
- Enables rate limits, quotas, analytics, and institution billing.

Cons:

- Requires backend, account system, privacy/security review, billing model, and
  abuse controls.
- Changes Iliad from local-only to cloud-assisted.

### Path D: Wait For Official OpenAI OAuth For API Access

If OpenAI later publishes a public OAuth flow that grants scoped API access to
third-party apps, Iliad can revisit this. The reviewed docs do not currently
describe such a flow.

## UX Recommendations

Settings should avoid a misleading `Login with ChatGPT` button for now.

Recommended copy:

- Primary: `OpenAI API key`
- Helper: `Requires an OpenAI API key. ChatGPT Plus/Pro does not include API usage.`
- Link/button: `Get an API key`
- Storage note: `Saved locally on this computer.`
- Secondary helper: `Create or copy a key from OpenAI Platform. API usage is
  billed by OpenAI separately.`

If a future cloud proxy exists, separate it clearly:

- `Use Iliad account`
- `Use my OpenAI API key`

Do not show Iliad account auth unless the cloud proxy exists and billing is
explicitly Iliad-managed. Do not mix ChatGPT subscription language with API-key
setup.

## Security Requirements

- Never expose API keys to renderer logs or UI after saving.
- Renderer never receives key material.
- IPC should expose only bounded API-call operations and key-presence metadata.
- Logs and crash reports must redact secrets.
- Current local settings storage is an accepted v1 risk, not the final
  credential-storage design.
- Require a separate OS keychain migration spec before broader distribution.
- Do not persist bearer tokens from undocumented login flows.
- Do not ask for a ChatGPT email/password inside Iliad.

## Tests

For near-term UX improvements:

- Settings opens with current API-key behavior preserved.
- `Get an API key` opens the official API keys page.
- Saving/replacing/removing local key works as before.
- Missing-key errors remain clear.
- No ChatGPT subscription copy implies API usage is included.

For any future auth-provider work:

- Threat model review.
- Token storage review.
- Logout/revocation flow.
- Expired-token recovery.
- Per-user usage-limit behavior.

## Rollout

No implementation should happen from this spec beyond copy/link cleanup unless
the product decision is to improve the current API-key setup. A real
account-login feature requires a new supported authentication primitive from
OpenAI or an Iliad-hosted backend design.

## Open Questions

- Do we want a small API-key onboarding polish pass now?
- Is Iliad expected to stay purely local, or will it eventually have cloud
  accounts?
- For schools/workshops, should we support managed key distribution?
- Should local API keys move to OS keychain storage before broader release?
