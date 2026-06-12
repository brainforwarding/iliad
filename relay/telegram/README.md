# Iliad Telegram Relay

Credential-free TypeScript relay for Telegram Remote Chat.

The relay is transport only. It owns pairing, Telegram webhook routing, desktop
WebSocket authentication, request timeouts, idempotency, rate limits, and
Telegram plain-text formatting. It does not call providers and does not persist
raw prompts, answers, workspace labels, workspace paths, provider payloads, or
context manifests.

## Local Checks

From the repository root:

```sh
npm run relay:typecheck
npm run relay:test
```

From this package:

```sh
npm run typecheck
npm test
```

The tests use injected storage, Telegram sender, clocks, IDs, and desktop
sessions. They do not require Telegram credentials, Wrangler, Cloudflare login,
or live Durable Objects.

## Worker Routes

```text
POST /telegram/webhook/<secret>
POST /api/pairing/start
POST /api/pairing/revoke
GET  /api/desktop/connect
GET  /healthz
```

Live deployment uses one Durable Object instance named `telegram-v1` via the
`TELEGRAM_RELAY` binding. Copy `wrangler.toml.example`, set the non-secret bot
username if desired, and configure secrets outside the repo:

```sh
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

Then configure Telegram to call:

```text
https://<relay>/telegram/webhook/<TELEGRAM_WEBHOOK_SECRET>
```

## Pairing

`POST /api/pairing/start` accepts:

```json
{ "deviceId": "device-id", "deviceSecret": "device-secret" }
```

It verifies an existing device secret hash, refuses mismatches without
overwriting auth material, rejects already paired devices, replaces any previous
pending token for the same authenticated device, stores only the token hash, and
returns:

```json
{
  "token": "copyable-token",
  "pairingSessionId": "pairing-session-id",
  "expiresAt": "2026-05-27T12:10:00.000Z",
  "pairingUrl": "https://t.me/your_bot_name?start=copyable-token"
}
```

`POST /api/pairing/revoke` accepts the same device credentials, clears paired
chat metadata, invalidates pending tokens and active request IDs, and notifies a
connected desktop.

## Privacy Boundary

Durable storage may contain device IDs, hashed device secrets, hashed pairing
tokens, paired Telegram chat metadata, dedupe keys, active request IDs and
deadlines, and timestamps. Raw prompts and answers are held only in memory while
routing a single active request.
