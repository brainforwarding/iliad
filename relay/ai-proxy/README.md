# Iliad AI proxy (Cloudflare Worker)

The free route for built-in writing AI: the app sends a structured writing task,
the Worker validates it, builds the prompt with the shared versioned module
(`electron/writing/groq/prompts/`), books the worst-case cost in the day's quota
Durable Object, calls Groq with Iliad's key, and streams back content only.
Spec: `specs/2026-09-25-groq-ai-free-tier.md` (§3 install identity, §4 Worker,
§5 error contract, "Worker deployment").

- Production: **`https://iliad-ai.quiet-bush-25b1.workers.dev`** (Worker
  `iliad-ai`, account "Admin@wer6.io's Account",
  `28887344eeefadc54750f68e4efcd22a`).
- No text is logged or stored. Observability, logs and Logpush are off
  (`wrangler.toml`); the only log line is `{ code, status }` from `src/log.ts`.
  DO storage holds subjects, hashed network keys, counts, nano-USD amounts, the
  day's policy snapshot, reservation ids and code counters, deleted after ≤ 48 h.

## Routes

| Route | Purpose |
| --- | --- |
| `POST /v1/install` | `{ "client": "iliad-md", "version", "refresh"? }` → `{ "token" }` |
| `POST /v1/generate` | Structured task (`v`, `task`, …), `Authorization: Bearer <token>`, `X-Iliad-Client: iliad-md/<version>` → SSE |
| `GET /healthz` | `{ "ok": true }` |
| `GET /v1/admin/stats?day=YYYY-MM-DD` | Aggregates only, `Authorization: Bearer <ADMIN_TOKEN>` |

Errors are `{ "error": { "code", "resetAt"?, "scope"? } }`; no CORS headers.

## Checks

From the repository root:

```sh
npm run proxy:typecheck      # also part of npm run typecheck
npm run proxy:test           # unit tests; also part of npm test
npm run proxy:test:workers   # workerd integration tests (package-local deps)
```

The integration tests need the package's own dependencies once:
`npm --prefix relay/ai-proxy install`.

## Secrets

Four secrets, never in the repo: `GROQ_API_KEY`, `TOKEN_SIGNING_KEYS` (JSON
`kid → { key, signs, verifiesUntil? }`), `IP_HASH_KEY` (base64, ≥ 32 bytes),
`ADMIN_TOKEN` (≥ 32 chars). Copies live in the owner's git-ignored repo-root
`.env.local` (mode 0600) as `GROQ_API_KEY`, `ILIAD_PROXY_SIGNING_KID`,
`ILIAD_PROXY_SIGNING_KEY`, `ILIAD_PROXY_IP_HASH_KEY`, `ILIAD_PROXY_ADMIN_TOKEN`
(needed for rotation continuity and admin stats).

Generate new values with `openssl rand -base64 32` (keys) and
`openssl rand -hex 32` (admin token), written straight into `.env.local`, never
echoed. Upload all four without printing them:

```sh
cd relay/ai-proxy
node scripts/secretsJson.mjs | npx wrangler secret bulk --name iliad-ai
# a subset: node scripts/secretsJson.mjs --only ADMIN_TOKEN | npx wrangler secret bulk --name iliad-ai
```

(From a git worktree, point the script at the main checkout's file with
`ILIAD_ENV_FILE=/path/to/iliad/.env.local`.)

## Deploy

```sh
cd relay/ai-proxy
npx wrangler deploy          # uses wrangler.toml; secrets persist across deploys
```

After every deploy or dashboard edit: Workers & Pages → `iliad-ai` →
Settings → Observability must show logs **off**, no Logpush, no Tail Worker.
Smoke: `curl https://iliad-ai.quiet-bush-25b1.workers.dev/healthz`, one install,
one generate, admin stats.

## Change limits

Edit `[vars]` in `wrangler.toml` and `npx wrangler deploy` (seconds, no app
release). The day's Durable Object snapshots the policy on its first request
and applies the **more conservative** of snapshot and current config:

- tightening (lower cap or limits, higher rates) applies on the next request
  and sticks for the rest of the UTC day;
- loosening applies from the next 00:00 UTC.

Kill switch: `FREE_TIER_ENABLED = "false"` (applies at once, not snapshotted).
Revoke installs: `DENY_SUBJECTS = "inst_…,inst_…"` (subjects appear nowhere
but in tokens; get one from a misbehaving client's token payload).

Never test tiny limits on production: they stick for the day. Use a throwaway
Worker (its own Durable Object namespace):

```sh
npx wrangler deploy --name iliad-ai-staging --var INSTALL_DAILY_REQUESTS:3
node scripts/secretsJson.mjs | npx wrangler secret bulk --name iliad-ai-staging
# … test against https://iliad-ai-staging.quiet-bush-25b1.workers.dev …
npx wrangler delete --name iliad-ai-staging
```

## Rotate the token signing key

Tokens live 30 days and refresh up to 60 days after expiry, so an old kid must
keep verifying for 90 days after it stops signing:

1. In `.env.local`: move `ILIAD_PROXY_SIGNING_KID`/`_KEY` to
   `ILIAD_PROXY_PREVIOUS_SIGNING_KID`/`_KEY`, set
   `ILIAD_PROXY_PREVIOUS_VERIFIES_UNTIL` to now + 90 days (ISO 8601), and write
   a new kid (e.g. `k2027a`) and `openssl rand -base64 32` key.
2. `node scripts/secretsJson.mjs --only TOKEN_SIGNING_KEYS | npx wrangler secret bulk --name iliad-ai`.
3. After the grace date, drop the previous kid from `.env.local` and upload again.

Emergency (key leaked): upload only the new kid. Every token signed with the
old kid is rejected (`invalid_token`); apps re-issue once.

## Rotate the IP hash key or admin token

Write a new value into `.env.local` and upload with `--only IP_HASH_KEY` or
`--only ADMIN_TOKEN`. A new IP hash key changes every network key, so per-IP
counters restart; rotate it right after 00:00 UTC.

## Admin stats

```sh
ADMIN_TOKEN=$(sed -n 's/^ILIAD_PROXY_ADMIN_TOKEN=//p' /path/to/iliad/.env.local)
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "https://iliad-ai.quiet-bush-25b1.workers.dev/v1/admin/stats?day=$(date -u +%F)"
```

Returns requests, installs issued/refreshed, distinct subjects and networks,
spent and reserved nano-USD (÷ 10⁹ = USD), open reservations, the day's
policy snapshot, and counters (`refused_*`, `upstream_<status>`,
`settled_without_usage`, `swept`, `usage_over_reservation`). Days older than
two days are gone.
