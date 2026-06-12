# Codex App-Server Account Connection Spec

Date: 2026-05-23
Status: implemented

## Product Intent

Let Iliad connect to a user's Codex/ChatGPT account through the official Codex
app-server managed login path, without treating that account as a general
OpenAI API key replacement.

This is the next runtime foundation step after
`2026-05-23-codex-agent-runtime-provider.md`. The user-visible outcome is a
small, honest settings section:

- users can connect a Codex account with a device code;
- Iliad can read account status and rate-limit status through Codex app-server;
- the current document assistant still uses the OpenAI API-key provider until
  Codex file-change events are mapped into Iliad proposals.

## Source Material

Internal:

- [Agent Runtime Roadmap](../docs/agent-runtime-roadmap.md)
- [Codex Agent Runtime Provider Spec](./2026-05-23-codex-agent-runtime-provider.md)
- [OpenClaw Auth Deep Dive](../docs/research/chatgpt-login/openclaw-auth-deep-dive.md)
- [ChatGPT Login Research Summary](../docs/research/chatgpt-login/summary-and-recommendation.md)

Current code:

- [Codex CLI probe](../electron/agent/runtime/codexProbe.ts)
- [Runtime provider types](../electron/agent/runtime/provider.ts)
- [Agent service](../electron/agent/agentService.ts)
- [Agent IPC](../electron/ipc/agent.ts)
- [Preload API](../electron/preload.ts)
- [Assistant settings UI](../src/components/assistant/AssistantSettings.tsx)

Local protocol investigation on 2026-05-23:

- `codex app-server --listen stdio://` speaks newline-delimited JSON over stdio.
- `initialize` returns user agent, `codexHome`, platform family, and platform OS.
- `account/read` returns `{ account: null, requiresOpenaiAuth: true }` when not
  signed in.
- `account/login/start` with `{ type: "chatgptDeviceCode" }` returns
  `verificationUrl`, `userCode`, and `loginId`.
- The server can emit `account/login/completed`, `account/updated`, and
  `account/rateLimits/updated` notifications.

Official OpenAI/Codex references:

- Codex auth: https://developers.openai.com/codex/auth
- Codex app-server: https://developers.openai.com/codex/app-server
- Codex CLI: https://developers.openai.com/codex/cli

## Goals

- Add a managed Codex app-server client in Electron main process.
- Use an app-scoped `CODEX_HOME` so Codex owns its own auth state.
- Support `account/read`, `account/login/start` with `chatgptDeviceCode`,
  `account/login/cancel`, `account/logout`, and `account/rateLimits/read`.
- Expose only account metadata and login instructions to the renderer.
- Do not expose access tokens, refresh tokens, cookies, or raw auth files.
- Add a compact Codex account settings section.
- Keep the live assistant provider unchanged: OpenAI API key remains the active
  chat/edit path.
- Add tests with a fake app-server process/protocol.

## Non-Goals

- No `chatgptAuthTokens` flow.
- No copied OpenClaw OAuth client IDs.
- No direct `chatgpt.com/backend-api/codex` calls.
- No ChatGPT email/password.
- No reading or copying `~/.codex/auth.json`.
- No switching live assistant runs to Codex yet.
- No Codex file writes to the user workspace.
- No subagents in this slice.
- No dictation through Codex account auth.

## User Flow

### First Visit With Existing API Key

- User opens settings.
- Existing `OpenAI API key` section remains as-is.
- A new compact section appears below it:

```text
Codex agent
Not connected
Use your Codex/ChatGPT account for the future agent runtime.
Current chat still uses the OpenAI API key.
[Connect Codex]
```

The copy must not imply that current chat or dictation has switched to Codex.

### Connect Codex

1. User clicks `Connect Codex`.
2. Main process starts or reuses Codex app-server with app-scoped `CODEX_HOME`.
3. Iliad sends `initialize`, `initialized`, and then `account/login/start` with
   `{ type: "chatgptDeviceCode" }`.
4. UI shows the device-code instructions:

```text
Go to auth.openai.com/codex/device
Code: ABCD-EFGH
[Open OpenAI] [Cancel]
```

5. User completes login in browser.
6. Main owns the pending `loginId`; the renderer cancels only the current
   pending login and never receives or logs the `loginId`.
7. UI polls account status or receives a refreshed status after completion.
8. Connected state shows email/plan if available.
9. If rate limits are available, show a quiet summary. If not, do not show a
   noisy error.

### Logout

- User clicks `Disconnect`.
- Main process calls `account/logout`.
- Main cancels any pending login, clears in-memory account/rate-limit state,
  and follows with `account/read`.
- UI returns to `Not connected` only after `account/logout` succeeds and the
  refreshed status is disconnected. On failure, keep the previous/unknown state
  and show a sanitized retryable error.

## Backend Design

Add `CodexAppServerClient` under `electron/agent/runtime/`.

Responsibilities:

- Start `codex app-server --listen stdio://` with:
  - `CODEX_HOME=<userData>/assistant/codex-home`
  - a strict env allowlist based on the existing Codex probe env helper
  - `PATH` and platform shell variables only when needed to find `codex`
  - no inherited auth variables
- Send newline-delimited JSON requests.
- Correlate responses by `id`.
- Collect relevant notifications.
- Initialize once per process and reuse the child.
- Timeout requests.
- Reject pending requests if the child exits.
- Restart only on demand after unexpected exit.
- Dispose the child on app quit.
- Redact diagnostics by allowlisting fields only.

Supported methods:

- `status(refreshToken = false): Promise<CodexAccountStatusResponse>`
- `startDeviceLogin(): Promise<CodexDeviceLoginResponse>`
- `cancelLogin(): Promise<CodexAccountStatusResponse>`
- `logout(): Promise<CodexAccountStatusResponse>`

The client should not parse or persist token files. Codex app-server owns its
own state under `CODEX_HOME`.

### Protocol Contract

All messages are one JSON object per line over stdio. The client must tolerate
notifications before responses, out-of-order responses, unknown notifications,
malformed JSON lines, duplicate response IDs, and child exit while requests are
pending.

Startup:

```json
{"id":1,"method":"initialize","params":{"clientInfo":{"name":"iliad","title":"Iliad","version":"0.1.0"},"capabilities":null}}
{"method":"initialized"}
```

Status read:

```json
{"id":2,"method":"account/read","params":{"refreshToken":false}}
```

`refreshToken` is always sent. The first implementation uses `false` for normal
polling; a future explicit reconnect/refresh action may use `true`.

Start device login:

```json
{"id":3,"method":"account/login/start","params":{"type":"chatgptDeviceCode"}}
```

Expected success:

```json
{"id":3,"result":{"type":"chatgptDeviceCode","verificationUrl":"https://auth.openai.com/codex/device","userCode":"ABCD-EFGH","loginId":"..."}}
```

Main process stores `loginId` only in memory. The renderer receives
`verificationUrl` and `userCode` only.

Cancel login:

```json
{"id":4,"method":"account/login/cancel","params":{"loginId":"main-owned-active-login-id"}}
```

The raw response is `{ "status": "canceled" | "notFound" }`; IPC returns a
composed status from the cancel result plus a follow-up `account/read`.

Logout:

```json
{"id":5,"method":"account/logout"}
```

The raw response is `{}` and the server may also emit `account/updated`. IPC
returns a composed status from logout plus a follow-up `account/read`.

Rate limits:

```json
{"id":6,"method":"account/rateLimits/read"}
```

Only call rate-limit read when the account is connected with ChatGPT and the
method is available. Missing or unsupported rate limits are not fatal for
account status.

## IPC / Preload Contract

Add trusted IPC handlers:

- `agent:codex-status`
- `agent:codex-start-device-login`
- `agent:codex-cancel-login`
- `agent:codex-logout`

Use the same trusted sender validation pattern as transcription and the Codex
CLI probe. Renderer receives only:

```ts
interface CodexAccountStatusResponse {
  available: boolean;
  connected: boolean;
  requiresOpenaiAuth: boolean;
  pendingLogin: boolean;
  account?: {
    type: "chatgpt" | "apiKey" | "amazonBedrock";
    email?: string;
    planType?: string;
  };
  rateLimits?: {
    limitId?: string | null;
    limitName?: string | null;
    planType?: string | null;
    primary?: {
      usedPercent?: number | null;
      windowDurationMins?: number | null;
      resetsAtUnixSeconds?: number | null;
      resetsAtIso?: string | null;
    };
    secondary?: {
      usedPercent?: number | null;
      windowDurationMins?: number | null;
      resetsAtUnixSeconds?: number | null;
      resetsAtIso?: string | null;
    };
    rateLimitReachedType?: string | null;
    credits?: {
      hasCredits?: boolean | null;
      unlimited?: boolean | null;
      balance?: string | null;
    };
  };
  error?: {
    code: string;
    message: string;
    detail?: string;
  };
}
```

```ts
interface CodexDeviceLoginResponse extends CodexAccountStatusResponse {
  login?: {
    verificationUrl: string;
    userCode: string;
  };
}
```

The renderer must not receive raw app-server JSON, raw stderr, `loginId`,
access tokens, refresh tokens, cookies, `CODEX_HOME`, or auth file paths.

## UI Requirements

- Keep the section small and plain; prefer a subsection, not a heavy bordered
  card.
- No provider picker yet.
- No disabled future runtime option.
- No claim that Codex is powering current chat until it does.
- Only show states that are actionable and quiet:
  - `Not connected` + `Connect Codex`
  - `Connecting` with device URL, code, `Open OpenAI`, `Cancel`
  - `Connected` with email or plan if available
  - `Unavailable` only if Codex app-server is missing or fails, with no alarm
    styling
- Rate limits are shown only when available; otherwise omit them.
- `Connect Codex`, `Open OpenAI`, `Cancel`, and `Disconnect` use secondary or
  link-style visual hierarchy so they do not compete with `Save settings`.
- Use wording:
  - `Codex agent`
  - `Connect Codex`
  - `Uses your Codex/ChatGPT account for the future agent runtime.`
  - `Current chat still uses the OpenAI API key.`
- Spanish copy should preserve the same boundary.
- Banned copy:
  - no `ChatGPT pays for API`
  - no `included API usage`
  - no `no API key needed for current chat`
  - no `current assistant uses Codex`

## Security Requirements

- Renderer never receives tokens.
- Renderer never receives `loginId`.
- Do not log auth URLs, user codes, login IDs, account email, full paths, raw
  JSON-RPC lines, stdout/stderr, or token-shaped strings.
- Diagnostics are allowlisted to event name, duration, request method, boolean
  connected state, and sanitized error code.
- Do not pass `OPENAI_API_KEY`, `CODEX_ACCESS_TOKEN`, `CHATGPT_*`, or similar
  auth variables into Codex app-server.
- Use an env allowlist instead of `{ ...process.env, CODEX_HOME }`.
- Use app-scoped `CODEX_HOME`; do not read `~/.codex`.
- Codex may cache credentials under the app-scoped `CODEX_HOME` in plaintext or
  the OS credential store, depending on Codex configuration. Iliad initiates
  this storage but never reads it; logout is the supported user-facing cleanup.
- Trusted sender validation required for all Codex auth IPC.
- Logout must call app-server `account/logout`.
- Request timeouts required.
- `Open OpenAI` must open only the exact allowlisted device-code URL
  `https://auth.openai.com/codex/device` from main process, or validate exact
  host/path before using a returned URL. Do not pass arbitrary app-server URLs
  to generic `openUrl`.

## Tests

Required:

- App-server client initializes and sends `account/read`.
- App-server client sends `initialized` after `initialize`.
- `account/read` always sends `{ refreshToken: false }` in normal status reads.
- Device-code login returns sanitized login metadata.
- Main process keeps `loginId`; renderer only receives URL and code.
- Account status maps ChatGPT account metadata without tokens.
- Rate-limit mapping tolerates missing data.
- Rate-limit mapping covers `rateLimitsByLimitId`, `primary`, `secondary`,
  `resetsAt` Unix seconds, and credits `{ hasCredits, unlimited, balance }`
  where `balance` is an optional string.
- Logout/cancel use the expected methods and refresh status afterward.
- IPC rejects untrusted calls for all four Codex auth handlers.
- Protocol tests cover malformed JSON, idless/unknown notifications,
  notifications interleaved before responses, out-of-order responses, duplicate
  response IDs, request timeout cleanup, child exit with pending requests,
  stderr redaction, `account/login/completed` failure, cancel `notFound`, logout
  notification-only updates, missing/old CLI or unsupported method, and
  multi-bucket rate-limit mapping.
- App quit disposes the app-server client and rejects pending requests.
- Settings UI strings include Codex account copy and do not say Codex powers
  current chat.
- Existing OpenAI assistant, dictation, proposal, typecheck, build, and smoke
  tests still pass.

## Rollout

- Ship behind honest copy in settings.
- Keep OpenAI API key provider as active live assistant path.
- Next implementation target is `Codex Proposal Bridge`: run a disposable Codex
  turn in a temporary workspace, capture file-change/diff events, and convert
  them into Iliad proposals.

## Review Notes

Reviewer feedback to incorporate before implementation:

- Runtime/backend reviewer accepted the account/status-only scope and required
  exact `initialize`/`initialized`, `account/read` params, response composition,
  lifecycle cleanup, and protocol fake-server tests.
- Security reviewer required env allowlisting, URL allowlisting, main-owned
  login handles, strict log redaction, stronger logout semantics, and explicit
  trusted IPC checks.
- UX reviewer required a quiet secondary settings section, not a large card or
  provider picker, with explicit copy that current chat still uses the OpenAI
  API key.
