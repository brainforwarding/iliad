# Telegram Relay And Pairing Completion

Date: 2026-05-27
Status: reviewed for implementation
Base: builds on `specs/2026-05-25-telegram-remote-chat.md` and branch `feat/telegram-remote-chat`

## Problem

The Telegram Remote Chat desktop foundation exists: Iliad has local remote
settings, a read-only remote ask service, workspace binding, and read-only
provider enforcement. What remains is the actual channel path:

```text
Telegram private chat
  -> Telegram webhook
  -> Iliad relay
  -> desktop Iliad outbound WebSocket
  -> existing Electron remote service
```

This phase should implement that channel without requiring real Telegram or
Cloudflare credentials during development. Credentials should be needed only for
live deploy and manual pairing QA.

## Product Intent

Make Telegram Remote Chat usable end to end once a Telegram bot token and
Cloudflare deployment are configured, while keeping the local development loop
fully testable with mocks.

The relay is transport only. It owns pairing, routing, presence, rate limits,
and Telegram formatting. It does not call OpenAI/Codex, store workspace content,
or inspect Markdown.

## Current State

Already implemented in the prior branch:

- `electron/remote/telegramRemoteService.ts` validates remote `status` and
  `ask` requests and starts `remote_read_only` agent runs.
- `electron/remote/remoteSettingsStore.ts` stores enabled state, device id,
  device secret, paired chat metadata, last error, and bound workspace.
- `electron/ipc/remote.ts` exposes trusted renderer IPC for get/update/revoke
  settings and redacts `deviceSecret`.
- Assistant settings UI can enable/disable/revoke Telegram Remote Chat.

Missing:

- relay deployable code;
- Telegram webhook handling;
- pairing token/deep-link creation and completion;
- desktop outbound WebSocket client;
- relay-to-desktop request/response routing;
- Telegram response formatting and chunking;
- relay-side rate limits, group rejection, device auth, and `/unlink`;
- desktop UI affordance for pairing link/code.

## Goals

- Add a `relay/telegram/` deployable Cloudflare Worker/Durable Object package.
- Implement Telegram webhook parsing for private chat commands:
  `/start <token>`, `/status`, `/ask <question>`, `/help`, `/unlink`, and plain
  text as ask.
- Implement short-lived single-use pairing tokens.
- Implement desktop pairing start and revoke APIs authenticated by device secret.
- Implement outbound desktop WebSocket auth and remote request/response routing.
- Implement webhook idempotency, per-chat/per-device rate limits, and one
  in-flight request per device.
- Implement offline, disabled, unpaired, busy, timeout, and failed Telegram
  messages.
- Add a desktop `remoteRelayClient` that connects only when remote chat is
  enabled, using Iliad's deployed relay by default and an environment override
  for staging/local relay development.
- Add trusted IPC and settings UI controls for generating and displaying a
  pairing link/code.
- Keep all development and tests credential-free.
- Keep relay logs and stored data free of raw prompts, answers, provider
  payloads, Markdown content, context manifests, and device secrets.

## Non-Goals

- No production Cloudflare deployment in this branch.
- No real Telegram bot setup in this branch.
- No secrets committed to the repo.
- No relay-side AI/provider calls.
- No relay-side Markdown storage, indexing, embeddings, or context manifests.
- No remote editing or proposal review.
- No group chat support.
- No multi-desktop routing UI. The relay may store multiple devices internally,
  but product V1 still exposes one paired private chat per desktop device.
- No QR-code bitmap generation unless it can be added without new heavy
  dependencies. A copyable `t.me/<bot>?start=<token>` link/code is sufficient.
- No custom domain, E2EE, or production-grade sharding in this branch.

## Panel Selection

Use a focused panel because this crosses transport, security, UI, and tests:

- Spec/security reviewer: relay auth, storage, privacy, rate limits, webhook
  abuse cases, and desktop trust boundary.
- Relay/desktop implementation worker: `relay/telegram/` and
  `electron/remote/remoteRelayClient.ts`.
- UI/IPC implementation worker: pairing IPC/preload/types/settings UI.
- Verification worker: no edits; review diff and run relay, Electron, renderer,
  and build checks.

## Architecture

### Relay Package

Add:

```text
relay/telegram/
  README.md
  package.json
  tsconfig.json
  wrangler.toml.example
  src/
    cloudflareTypes.ts
    crypto.ts
    protocol.ts
    rateLimit.ts
    relayCore.ts
    telegram.ts
    worker.ts
```

The package should be TypeScript-only and should not require Cloudflare or
Telegram credentials for tests. The Worker adapter is thin; the core routing,
pairing, parsing, formatting, and rate-limit behavior live in pure modules.
The relay core uses injected `TelegramSender`, clock, random id generator,
storage, and WebSocket/session adapters so tests can run without Wrangler,
Telegram, Cloudflare login, or live Durable Objects.

For V1, use one Durable Object instance named `telegram-v1`. This is simpler
than per-device objects because `/start <token>` needs token lookup before a
device id is known. The single object stores only routing/auth metadata and is
acceptable for personal/internal dogfood. A future version can split into a
global token index plus per-device objects.

### Relay Storage

Durable Object storage may persist:

- device id;
- hash of device secret;
- paired Telegram chat id and display metadata;
- pairing token hash and expiry;
- revocation status;
- per-chat rate-limit counters;
- timestamps.

It must not persist:

- raw device secret;
- raw pairing token;
- raw Telegram prompt text beyond the active request in memory;
- raw desktop answer text beyond the active request in memory;
- Markdown contents;
- provider payloads;
- context manifests.
- workspace labels or workspace paths.

Active requests may keep prompt/answer text in memory only while routing a
single Telegram request. The durable record stores only active request ids,
deadlines, chat ids, and status needed to reject stale or duplicate responses.

### Relay Routes

Public Worker routes:

```text
POST /telegram/webhook/<secret>
POST /api/pairing/start
POST /api/pairing/revoke
GET  /api/desktop/connect
GET  /healthz
```

`/telegram/webhook/<secret>`:

- rejects when `<secret>` does not equal `TELEGRAM_WEBHOOK_SECRET`;
- returns HTTP 200 quickly for valid webhook envelopes and sends Telegram
  replies out-of-band through `sendMessage`;
- dedupes Telegram `update_id` plus message id with a TTL so webhook retries do
  not create duplicate desktop requests;
- rejects group/supergroup/channel updates with a concise message;
- accepts private chat messages only;
- maps commands to relay actions;
- sends all Telegram replies through `sendMessage`;
- uses plain text formatting until Markdown escaping is deliberately tested.

`/api/pairing/start`:

- accepts JSON `{ deviceId, deviceSecret }`;
- validates device id/secret lengths;
- stores only a hash of the device secret;
- if the device already exists, requires the presented secret to match the
  stored hash;
- never overwrites stored auth material on secret mismatch;
- rejects already-paired devices until `/unlink`, desktop revoke, or local
  disable clears the pair;
- keeps at most one pending pairing token per device, replacing any prior
  pending token after verifying the device secret;
- rate-limits by device id and request source;
- creates a high-entropy pairing token;
- stores only a hash of the token;
- expires the token after 10 minutes;
- returns `{ token, pairingSessionId, expiresAt, pairingUrl? }`;
- includes `pairingUrl` when `TELEGRAM_BOT_USERNAME` is configured.

`/api/pairing/revoke`:

- accepts JSON `{ deviceId, deviceSecret }`;
- validates the stored device secret hash;
- rate-limits failed auth attempts;
- clears paired chat metadata;
- invalidates pending pairing tokens and active request ids;
- notifies a connected desktop if present.

`/api/desktop/connect`:

- upgrades to WebSocket;
- expects the first client message to be
  `{ type: "desktop_auth", deviceId, deviceSecret }`;
- validates the stored device secret hash;
- closes unauthenticated sockets quickly and rate-limits failed auth attempts;
- marks the device online after auth;
- allows one active socket per device, replacing stale sockets.
- requires TLS relay URLs in desktop configuration. `https://` and `wss://` are
  accepted; `http://` and `ws://` are accepted only for localhost development
  hosts such as `localhost`, `127.0.0.1`, and `[::1]`.
- heartbeat pings mark sockets offline when they stop answering.

### Desktop Relay Protocol

Server to desktop:

```ts
type RelayToDesktopMessage =
  | { type: "remote_request"; request: RemoteRequest }
  | {
      type: "pairing_completed";
      pairingSessionId: string;
      chat: RemotePairedTelegramChat;
      expiresAt: string;
    }
  | { type: "pairing_revoked" }
  | { type: "ping" };
```

Desktop to server:

```ts
type DesktopToRelayMessage =
  | { type: "desktop_auth"; deviceId: string; deviceSecret: string }
  | { type: "remote_response"; id: string; response: RemoteResponse }
  | { type: "pong" };
```

Remote request deadlines should default to 60 seconds. The relay should return a
timeout message if no desktop response arrives before the deadline.

The relay generates high-entropy request ids, tracks one active request per
device, and requires the wrapper `id` plus nested `response.id` to match the
active request before sending any Telegram answer. Duplicate, stale, unknown, or
post-revoke responses are discarded. A revoke or `/unlink` invalidates active
requests and asks the desktop to clear local paired state, which cancels the
existing remote run through the desktop service.

### Desktop Relay Client

Add `electron/remote/remoteRelayClient.ts`.

Responsibilities:

- read relay base URL from `ILIAD_TELEGRAM_RELAY_URL` when present;
- otherwise use Iliad's deployed production relay URL;
- stay disconnected when remote chat is disabled;
- reject malformed relay URLs and non-TLS URLs except localhost development
  URLs before sending device credentials;
- start pairing through `/api/pairing/start`;
- revoke through `/api/pairing/revoke`;
- open a WebSocket to `/api/desktop/connect` when enabled and credentials exist;
- send `desktop_auth` as the first message;
- reconnect with bounded exponential backoff;
- pass `remote_request` messages to `TelegramRemoteService.handleRequest`;
- send `remote_response` messages back to the relay;
- apply `pairing_completed` and `pairing_revoked` messages to local settings;
- keep the returned `pairingSessionId` locally and ignore unsolicited, expired,
  or mismatched `pairing_completed` messages;
- clear pending pairing state on disable or revoke;
- store only redacted last-error summaries.

The desktop client must never expose `deviceSecret` to the renderer.

### Desktop Pairing UI

Extend the remote settings card:

- enabled/unpaired state shows a "Pair" action;
- pairing action requests a token from the relay and shows a copyable link or
  code with expiry;
- if a custom relay URL is malformed or unsafe, show a concise setup error;
- paired state continues to show display name/username and revoke;
- disabling or revoking clears the visible pairing link.

No QR bitmap is required in this branch. The link/code is enough for live QA.

## Telegram Flows

### Pairing

1. User enables Telegram Remote Chat in Iliad.
2. User clicks Pair.
3. Desktop calls relay `/api/pairing/start`.
4. Relay returns a token, `pairingSessionId`, and optional `t.me` URL.
5. User opens the link or sends `/start <token>` to the bot.
6. Relay validates token hash/expiry/single-use status.
7. Relay stores paired chat metadata.
8. Relay notifies connected desktop with `pairing_completed` containing the
   matching `pairingSessionId`.
9. Desktop persists paired chat metadata and refreshes UI.

### Ask

1. Telegram private chat sends `/ask <question>` or plain text.
2. Relay validates chat pairing and rate limit.
3. Relay creates a `RemoteAskRequest` with deadline.
4. Relay sends `remote_request` to the authenticated desktop socket.
5. Desktop runs the existing read-only remote ask flow.
6. Relay formats the `RemoteResponse` for Telegram.

Webhook retries for the same Telegram update are acknowledged but do not create
another request. If the desktop is already handling a request for that device,
the relay returns a busy message instead of queueing more work.

### Status

`/status` follows the same desktop routing as ask but uses `RemoteStatusRequest`.
If no desktop is connected, Telegram receives an offline message.

### Unlink/Revoke

- `/unlink` clears relay paired chat metadata and notifies desktop.
- Desktop Revoke calls `/api/pairing/revoke`, clears relay metadata, then clears
  local paired chat metadata.
- Both paths invalidate pending pairing tokens and active request ids.
- Late desktop responses after unlink/revoke are discarded.
- Later messages from that chat must not reach desktop.

## Failure States

- Custom relay URL missing on desktop: use Iliad's deployed relay default.
- Webhook secret mismatch: HTTP 404 or 403 without details.
- Group chat: "Telegram Remote Chat only works in a private chat."
- Pairing token expired/reused/unknown: "That pairing link expired. Create a new
  one in Iliad."
- Desktop offline: "Iliad is offline. Open Iliad on your computer and try again."
- Remote disabled/unpaired/workspace unavailable: relay forwards the desktop
  error in plain text.
- Busy/rate limited: ask user to try again shortly.
- Timeout: "Iliad took too long to answer. Try again."
- Bad desktop relay URL: "Set a secure Telegram relay URL before connecting."

## Security And Privacy

- All secrets are supplied by environment variables or local app settings.
- Do not commit `.env` files.
- Store hashes for device secrets and pairing tokens.
- Authenticate every desktop pairing/revoke request with device id plus device
  secret.
- Authenticate every desktop WebSocket before routing any Telegram message.
- Never send device credentials to malformed or non-TLS relay URLs, except
  explicit localhost development URLs.
- Use single-use pairing tokens with a short TTL.
- Reject group chats before pairing or asking.
- Rate-limit pairing start, revoke failures, WebSocket auth failures, duplicate
  webhook updates, `/status`, unpaired private chat commands, and asks.
- Keep active request prompt/answer text only in memory long enough to route the
  response.
- Keep logs redacted. Tests should assert relay logs/records do not include raw
  prompt, answer, provider payload, Markdown text, or device secret.

## Environment Variables

Desktop local override:

```text
ILIAD_TELEGRAM_RELAY_URL=https://your-worker.example.com
```

This override is optional for normal Iliad use. The desktop client defaults to:

```text
https://your-relay.example.com
```

Cloudflare Worker:

```text
TELEGRAM_BOT_TOKEN=...
TELEGRAM_WEBHOOK_SECRET=...
TELEGRAM_BOT_USERNAME=your_bot_name
```

Live setup also requires configuring Telegram `setWebhook` to:

```text
https://<relay>/telegram/webhook/<TELEGRAM_WEBHOOK_SECRET>
```

## Tests

Relay unit/integration tests:

- webhook rejects invalid secret path;
- valid webhook envelopes are acknowledged quickly and replies are sent through
  the injected Telegram sender;
- duplicate `update_id`/message id does not create a second desktop request;
- group chats are rejected;
- `/start <token>` completes valid pairing;
- expired/reused/unknown tokens fail;
- pairing start requires an existing matching device secret, rejects mismatches
  without overwriting auth material, limits pending token churn, rejects
  already-paired devices, and cleans up stale tokens;
- `/help` and `/status` produce useful messages;
- offline desktop returns offline message;
- connected desktop receives valid status/ask request envelopes;
- desktop answer is formatted with sources;
- long answers split under Telegram limits;
- rate limit blocks excessive asks;
- rate limits cover pairing start, bad revoke auth, bad WebSocket auth,
  duplicate webhook updates, `/status`, and unpaired command spam;
- `/unlink` revokes pairing, invalidates active requests, drops late responses,
  and prevents later routing;
- device WebSocket auth rejects bad secrets;
- `remote_response` wrapper ids and nested response ids must both match the
  active request;
- relay storage hashes device secrets and pairing tokens;
- relay storage does not contain raw prompts/answers/content, workspace labels,
  workspace paths, provider payloads, or context manifests.

Desktop tests:

- remote relay client stays disconnected when disabled;
- remote relay client uses the deployed relay by default and honors
  `ILIAD_TELEGRAM_RELAY_URL` as an override;
- remote relay client rejects malformed and non-TLS URLs before credentials are
  sent, while allowing localhost development URLs;
- start pairing calls relay with device credentials but returns only token/link
  metadata and `pairingSessionId` to renderer;
- WebSocket auth sends credentials only to relay client, not renderer;
- `remote_request` dispatches to `TelegramRemoteService.handleRequest`;
- `pairing_completed` updates local paired chat metadata only when it matches
  the pending pairing session and has not expired;
- unsolicited or mismatched `pairing_completed` messages are ignored;
- `pairing_revoked` clears local paired chat metadata and cancels active work;
- trusted IPC exposes start-pairing and still redacts `deviceSecret`;
- settings UI renders Pair/link/expiry states.

Full repo checks:

- `npm run typecheck`
- `npm test`
- `npm run lint:css`
- `npm run build`

Relay-specific checks:

- `npm run relay:typecheck`
- `npm run relay:test`

## Rollout

1. Land credential-free relay and desktop client behind explicit configuration.
2. Add real Cloudflare/Telegram secrets outside the repo.
3. Deploy Worker manually with Wrangler.
4. Configure Telegram webhook.
5. Run manual QA: pair, status, ask, offline, disabled, busy, unlink, re-pair.

## Acceptance Criteria

- Credentials are not required for automated tests.
- No secret values are committed or printed.
- Relay never calls the AI provider.
- Relay never stores workspace content, raw prompts, raw answers, provider
  payloads, or context manifests.
- Telegram private chat can pair through a short-lived token once live secrets
  are configured.
- Telegram asks route through the authenticated desktop WebSocket to the
  existing read-only remote service.
- Desktop settings can generate a pairing link/code without exposing the device
  secret.
- Disable/revoke/unlink stops future Telegram asks from reaching desktop.
- Late desktop responses after revoke/unlink do not send Telegram answers.
