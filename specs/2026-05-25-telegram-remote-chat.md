# Telegram Remote Chat

Date: 2026-05-25
Status: phased implementation spec, revised for current context architecture on 2026-05-27

## Problem

Iliad is currently useful only when the user is at the desktop app. A remote
surface would let the user ask questions about the open Markdown workspace from
a phone, without building a full mobile editor.

There are two possible remote-access shapes:

- a mobile web/PWA reader for opening Markdown documents directly;
- a chat bridge where the user asks questions and Iliad answers from the local
  Markdown workspace.

The chat bridge is the smaller first experiment. It avoids a mobile document UI,
app-store packaging, cross-device editing, and remote proposal review. It also
tests the shared foundation any later remote surface needs: a secure cloud relay
between a phone-side channel and an online desktop Iliad instance.

## Product Intent

Create a Telegram bot that lets one paired private Telegram chat ask read-only
questions about the currently open Iliad workspace while the desktop app is
online and remote chat is enabled.

Telegram is a channel into Iliad. It is not a new context system, not a separate
agent backend, and not a workspace sync service.

The first version is read-only and answer-oriented:

```text
Telegram user
  -> Telegram Bot API webhook
  -> Iliad relay
  -> desktop Iliad outbound WebSocket
  -> Electron main remote service
  -> Iliad read-only agent run
  -> local Markdown document tools / selected provider runtime
```

The AI/provider call is initiated by desktop Iliad. The relay and Telegram do
not call the model and do not receive workspace files. With Codex, desktop
Iliad invokes the Codex app-server runtime. With the OpenAI API fallback,
desktop Iliad invokes the OpenAI Responses API using the locally configured API
key. In both cases, Electron main owns the workspace boundary, tool execution,
context receipts, cancellation, and provider selection.

A user should be able to send:

```text
What did I decide about the final project rubric?
```

Iliad should answer concisely and cite the Markdown files it used:

```text
The final project rubric is meant to assess...

Sources:
- rubrics/final-project.md
- syllabus/week-8.md
```

This is not a mobile document browser. If users later want to inspect full
files, skim long documents, or browse the tree, that should become a separate
PWA reader built on the same relay foundation.

## Current Branch Scope

This implementation is intentionally phased. The 2026-05-27 branch implements
the desktop-side foundation and the read-only agent contract:

- local remote settings and renderer settings UI;
- local device credentials for future relay auth;
- workspace-bound enable/disable/revoke controls;
- structured remote status/ask request handling in Electron main;
- runtime validation for relay JSON envelopes;
- a read-only `remote_read_only` agent run profile;
- proposal suppression and provider-specific read-only enforcement;
- manifest-derived source validation for remote answers.

It does not yet ship the public Telegram path:

- no Cloudflare Worker/Durable Object relay package;
- no Telegram webhook deployment;
- no pairing token, QR code, or `t.me` deep link;
- no outbound desktop WebSocket connection to a relay.

Until the relay and pairing phases are implemented, Telegram Remote Chat must
remain treated as an experimental desktop foundation, not an end-to-end user
feature.

## Goals

- Add a secure cloud relay path for one paired private Telegram chat.
- Add a desktop-side remote service that opens an outbound WebSocket to the
  relay only when the user enables Telegram Remote Chat.
- Route Telegram messages to the currently online desktop Iliad instance.
- Run remote questions through a read-only Iliad agent profile in Electron main.
- Reuse Iliad-owned Markdown document tools for local context access:
  `list_documents`, `search_documents`, and `read_document`.
- Keep all file access workspace-relative, visible, Markdown-only, bounded, and
  inside the active workspace.
- Record context manifest receipts for remote runs, including document searches
  and reads.
- Include source citations as relative Markdown paths in every substantive
  Telegram answer.
- Return clear offline/error messages when desktop Iliad is not reachable.
- Keep all writes and proposal review disabled in V1.
- Avoid storing Markdown document contents, raw prompts, raw answers, or
  provider responses in the relay.
- Make paired Telegram chats revocable from the desktop app and from Telegram.

## Non-Goals

- No native iOS or Android app.
- No PWA reader in this spec.
- No remote Markdown editing.
- No accepting, rejecting, or applying proposals from Telegram.
- No creating document-edit proposals from Telegram V1.
- No agent-auth setup from Telegram.
- No direct document dumps by default.
- No full workspace sync to the relay.
- No relay-side embeddings or semantic index in V1.
- No hidden whole-workspace upload to a provider.
- No shell, git, package-manager, Python/script execution, browser automation,
  arbitrary MCP connector access, or system inspection.
- No group-chat support in V1.
- No multi-user team workspaces.
- No durable relay conversation history beyond operational metadata.

## Architecture Boundary

Telegram Remote Chat has four separate layers:

```text
Channel
  Telegram private chat and bot commands.

Relay
  Pairing, routing, desktop presence, rate limits, and Telegram formatting.

Desktop Iliad harness
  Remote authorization, workspace selection, context policy, document tools,
  provider calls, context manifests, and cancellation.

Provider runtime
  Codex app-server as the preferred agent runtime, or OpenAI Responses API as a
  fallback when configured.
```

The relay owns routing metadata only. It must not own workspace state. The
desktop app remains the trust boundary for local files and model/tool access.

This follows Iliad's current context architecture:

```text
assistant rules
+ remote-channel user-turn packet
+ local document tools, when supported
+ current Telegram user request
```

Unlike the desktop assistant panel, Telegram should not automatically treat the
open editor file as implicit user-visible context. A remote user may not know
what file is open on the computer. The remote run should be workspace-scoped by
default and use model-directed document discovery for named or implied workspace
references.

The active desktop Markdown file may be included only when one of these is true:

- the Telegram message explicitly asks about the current/open document;
- a future desktop setting opts into including the active file for remote asks;
- the remote request includes an explicit file reference resolved by the same
  Markdown document-tool contract.

## Remote Run Profile

Telegram V1 should use a dedicated read-only run profile:

```ts
type RemoteRunProfile = {
  channel: "telegram";
  mode: "remote_read_only";
  writes: false;
  proposals: false;
  documentTools: true;
  shell: false;
  browser: false;
  mcp: false;
  sourcesRequired: true;
  contextManifest: true;
};
```

This profile must be enforced in Electron main and provider adapters, not only
in prompt text. It is not enough to reuse the normal desktop chat run and ask
the model not to edit.

Read-only enforcement requirements:

- OpenAI API remote prompts omit edit/proposal instructions such as
  `FULL_REPLACEMENT` and `NEW_DOCUMENT`.
- OpenAI API remote results that still contain proposal markers are treated as
  plain answer text or rejected; they are never saved as proposals.
- Codex remote runs use a read-only sandbox/tool policy and must not start with
  write-capable workspace permissions.
- Codex file-change events or disk changes during a remote run fail the run and
  restore the workspace from the pre-run snapshot.
- No remote run can call `applyPatch`, `applyNewDocument`, or proposal-store
  mutation paths.
- Provider results for remote runs must return an empty proposal list even if a
  model attempts to produce edit output.

The provider-specific adapter can differ:

- Codex app-server path: expose the same safe Iliad Markdown document tools as
  Codex dynamic tools, record live activity when available, and persist final
  context receipts.
- OpenAI API path: run the Responses API function-call loop with the same
  `list_documents`, `search_documents`, and `read_document` tools.

Both paths must produce the same user-visible contract: concise answer,
relative source paths, and metadata-only receipts for what was searched/read.

## User Experience

### Desktop

Add a small remote-access setting in the assistant settings area:

- "Telegram Remote Chat"
- status: disabled, pairing, connected, offline, error
- button: enable
- button: disable
- paired account display:
  - Telegram display name or username when available;
  - paired timestamp;
  - "Revoke" action.

When the user enables Telegram access:

1. Iliad requests a short-lived pairing token from the relay.
2. Iliad shows a QR code and a copyable `t.me/...` deep link.
3. The user opens the link on their phone.
4. Telegram starts the bot with the pairing token.
5. The relay binds that Telegram `chat_id` to this desktop device.
6. Iliad shows the paired Telegram account.

The desktop UI should make the privacy boundary explicit:

```text
Telegram messages and Iliad replies pass through Telegram. Markdown files stay
on this computer unless quoted or summarized in a reply.
```

The desktop should also show that remote chat is read-only:

```text
Remote chat can answer questions with sources. It cannot edit files or approve
changes.
```

### Telegram

The Telegram interaction should feel like a practical command/chat surface, not
a full app.

Supported V1 commands:

- `/start <pairing_token>` pairs a Telegram chat with a desktop session.
- `/status` reports whether desktop Iliad is online and which workspace label
  is active.
- `/ask <question>` asks a read-only question over the active workspace.
- Any non-command text in a paired private chat behaves like `/ask`.
- `/help` lists the supported commands and privacy note.
- `/unlink` revokes the Telegram chat pairing.

Optional V1.1 commands, if the base path is stable:

- `/files <query>` returns a small list of matching Markdown paths.
- `/sources` returns the source list for the previous answer.

Telegram responses should be short enough to read in chat. Long answers should
be summarized and split only when necessary.

## Context Policy

Telegram questions use Iliad's current context principles:

- context is built fresh per run;
- old file reads do not silently become persistent hidden context;
- attached or resolved Markdown is untrusted reference material;
- model-directed document discovery must be bounded and receipted;
- workspace availability is not proof that a file was read;
- no whole-workspace prompt upload.

Remote asks differ from desktop asks in their default context:

```text
Desktop assistant panel
  active Markdown file snapshot
  + explicit chips/@mentions
  + recent visible desktop chat
  + document tools
  + current message

Telegram Remote Chat
  active workspace identity
  + optional recent Telegram-visible turns
  + document tools
  + current Telegram message
```

For V1, Telegram follow-up context is local-only and conservative. Telegram
webhooks do not provide prior chat history, and the relay must not store raw
prompts or answers. Desktop Iliad may keep a short remote transcript containing
only visible Telegram user/assistant text. If included in a model request, cap it
to recent visible turns and never include old hidden file snapshots, raw tool
outputs, or Markdown context payloads. Revoking or disabling remote chat clears
the local remote transcript for that pairing.

Remote chat is bound to the workspace that is active when the desktop enables or
pairs Telegram. If the desktop switches to a different workspace, remote asks
should fail with a clear stale-workspace/disabled message until the user
reenables or confirms remote access for the new workspace. This prevents a phone
from querying whichever workspace happens to be open later.

When the user names a locatable workspace item such as "the final rubric",
"the Odisea course", "session 1", "the style guide", or "the checklist", and
the answer depends on that content, the model should use local Markdown tools to
search/list/read before answering.

If discovery fails, finds no useful Markdown, or returns multiple plausible
matches that cannot be disambiguated safely, the bot should ask a focused
clarification instead of continuing broad search loops or hallucinating.

Every substantive answer must include source paths derived by desktop Iliad from
context manifest `document_read` rows. Do not trust source paths that appear only
in model prose. If a workspace-content answer has no read-backed source, desktop
should return a controlled clarification or error such as "I could not verify
which Markdown file supports that answer."

## Privacy Model

Telegram is convenient but not private in the same way as the local desktop app.
The implementation must assume that prompts, answers, and cited snippets sent
through Telegram are visible to Telegram infrastructure.

Rules:

- Do not send full Markdown files to Telegram unless the user explicitly asks
  for a specific excerpt in a future spec.
- Do not store Markdown content in the relay database.
- Do not log prompts, answers, document snippets, or provider payloads in
  plaintext relay logs.
- Do not include raw document content in operational metrics.
- Do not expose hidden files, ignored folders, external files, or non-Markdown
  files.
- Do not answer from a workspace unless a paired desktop session is currently
  online and remote chat is enabled.
- Give the desktop user a one-click revoke/disable path.
- Treat relative paths as sensitive metadata. Store only what is needed for
  debugging and user-visible source attribution.

This V1 is acceptable for personal and low-sensitivity notes. It is not a
confidential enterprise remote-access model until end-to-end encryption,
stronger audit controls, and admin policy exist.

## Relay Architecture

Use a cloud relay with one long-lived WebSocket from desktop Iliad and normal
HTTPS webhooks from Telegram.

Recommended implementation:

- Cloudflare Worker for HTTP routes and Telegram webhook handling.
- Cloudflare Durable Object per paired desktop session or stable device id.
- Durable Object WebSockets for routing messages between Telegram webhook
  handlers and the desktop app.
- Small database/KV storage for pairing records and revocation metadata.

The relay owns routing and auth metadata only. It does not own workspace state
and does not run provider/model calls.

Conceptual relay routes:

```text
POST /telegram/webhook/<secret>
POST /api/pairing/start
POST /api/pairing/complete
POST /api/pairing/revoke
GET  /api/desktop/connect?device_id=...
```

The Telegram webhook handler should acknowledge quickly. If the desktop run may
take more than a few seconds, the relay should enqueue/forward the request and
send typing indicators or a short "working" message through Telegram while the
desktop completes the run.

## Desktop Remote Service

Add an Electron main-process service under a new remote area:

```text
electron/remote/
  remoteSettingsStore.ts
  remoteRelayClient.ts
  telegramRemoteService.ts
  remoteTypes.ts
```

Responsibilities:

- Store remote-chat enabled/disabled state locally.
- Store relay device id and paired Telegram metadata locally.
- Open and maintain the outbound WebSocket only while enabled.
- Reconnect with backoff when the relay is reachable.
- Stop immediately when disabled or when the app quits.
- Receive remote requests from the relay.
- Validate that the request belongs to the paired chat.
- Validate request size, deadline, and one-active-run limits.
- Start a read-only remote agent run.
- Return structured responses and errors to the relay.
- Cancel active remote work when remote chat is disabled or revoked.

Do not expose this service through a local unauthenticated HTTP server. The
desktop connection should be outbound-only in V1.

## Remote Request Contract

Use a small versioned JSON envelope between relay and desktop.

```ts
type RemoteRequest =
  | {
      version: 1;
      id: string;
      type: "status";
      chatId: string;
      createdAt: string;
      deadlineAt: string;
    }
  | {
      version: 1;
      id: string;
      type: "ask";
      chatId: string;
      createdAt: string;
      deadlineAt: string;
      text: string;
    };

type RemoteResponse =
  | {
      version: 1;
      id: string;
      ok: true;
      type: "status";
      desktopOnline: true;
      workspaceLabel: string;
      remoteChatEnabled: true;
    }
  | {
      version: 1;
      id: string;
      ok: true;
      type: "answer";
      text: string;
      sources: Array<{
        relativePath: string;
        line?: number;
      }>;
      manifestId?: string;
    }
  | {
      version: 1;
      id: string;
      ok: false;
      error: {
        code:
          | "desktop_offline"
          | "not_paired"
          | "remote_disabled"
          | "workspace_unavailable"
          | "empty_question"
          | "question_too_long"
          | "busy"
          | "deadline_exceeded"
          | "rate_limited"
          | "agent_unavailable"
          | "unknown";
        message: string;
      };
    };
```

Relay-to-desktop requests must include a short deadline. Desktop should reject
or cancel requests that exceed that deadline rather than letting remote runs
pile up.

## Remote Ask Flow

V1 should avoid pretending that the agent saw the whole workspace. It should use
bounded document tools and cite what was used.

Recommended flow:

1. Telegram receives a private chat message.
2. Relay validates webhook secret, chat pairing, group-chat rejection, and rate
   limits.
3. Relay forwards a versioned `ask` request to the paired online desktop
   session.
4. Desktop validates chat id, enabled state, active workspace, text length,
   one-active-run policy, and deadline.
5. Desktop starts a read-only remote run through the same agent/context service
   used by the desktop assistant, with `channel: "telegram"` and writes
   disabled.
6. The provider receives remote-channel assistant rules, the current Telegram
   question, and safe Markdown document tools.
7. The model uses `search_documents`, `list_documents`, and `read_document` only
   when needed to answer content-dependent workspace questions.
8. Electron main validates and executes tool calls, enforces budgets, and
   records context manifest receipts.
9. The model returns a concise answer with source paths.
10. Desktop returns structured answer text, source paths, and optional manifest
    id to the relay.
11. Relay formats the Telegram message and sends it.

If reusing `AgentService.startRun` creates unwanted proposal/review coupling,
add a narrow read-only `RemoteQuestionService` that shares the same document
tools, provider adapters, prompt policy, event handling, and context manifest
store.

Do not implement a separate Telegram-only pre-retrieval pipeline unless the
shared model-directed tool path is not available. If a temporary pre-retrieval
path is needed, it must use the same document-tool contract and create the same
context receipts.

## Telegram Formatting

Telegram messages have formatting and length constraints. The relay should own
Telegram-specific response formatting so desktop remains Telegram-agnostic.

Rules:

- Keep normal answers under Telegram's message length limit.
- Split long answers at paragraph boundaries when needed.
- Escape MarkdownV2 or use plain text until escaping is reliable.
- Include source paths as plain lines to avoid broken formatting.
- Use `sendChatAction` with `typing` while waiting for desktop responses.
- Send clear offline, disabled, busy, and failed messages.

## Rate Limits And Abuse Controls

Add conservative limits before exposing the webhook publicly:

- One paired private chat per desktop device in V1.
- Reject group chats.
- Per-chat request rate limit, for example 10 asks per 10 minutes.
- Per-request maximum question length, for example 2,000 characters.
- One active remote ask per desktop device; later requests get a busy message.
- Pairing tokens expire quickly, for example after 10 minutes.
- Pairing tokens are single-use.
- Webhook path includes a high-entropy secret.
- Desktop relay auth uses a stored device secret, not only the device id.
- Desktop request envelopes include `deadlineAt`.

The relay should avoid echoing sensitive details in errors. User-facing errors
can be specific enough to act on: offline, not paired, disabled, busy, timed
out, or failed.

## Data Storage

Desktop local storage:

- remote enabled flag;
- relay device id;
- device secret;
- paired Telegram account metadata;
- last connected timestamp;
- last error summary;
- optional local remote transcript metadata;
- context manifests for remote runs, using the same metadata-only rules as local
  assistant runs.

Relay storage:

- device id;
- hashed device secret or equivalent auth material;
- paired Telegram chat id;
- Telegram display metadata if needed for desktop display;
- pairing token hash and expiry;
- revocation status;
- rate-limit counters;
- timestamps.

Do not store in the relay:

- Markdown document contents;
- raw prompts;
- raw answers;
- provider responses;
- full context payloads;
- context manifests.

## Implementation Plan

### Phase 1: Local Types And Desktop Service

- Add remote service modules under `electron/remote/`.
- Add local settings store for enabled state and paired metadata.
- Add a disabled-by-default settings UI entry.
- Add desktop request handlers for `status` and read-only local `ask`.
- Add the `channel: "telegram"` read-only run profile.
- Add tests for enable/disable, pairing metadata, request authorization,
  runtime envelope validation, workspace binding, source validation,
  disable/revoke cancellation, and one-active-run behavior.

### Phase 2: Relay Prototype

- Add a small relay package or separate deployable directory, for example
  `relay/telegram/`.
- Implement pairing token creation and completion.
- Implement Telegram webhook handling.
- Implement Durable Object session routing.
- Implement desktop WebSocket connect/auth/reconnect.
- Implement webhook secret validation, group-chat rejection, device-secret
  desktop auth, pairing revocation, `/unlink`, per-chat rate limits, request
  deadlines, and one-active-device routing before enabling ask traffic.
- Add a local relay development mode where possible.

### Phase 3: Read-Only Ask Flow

- Implement remote ask using a first-class read-only run profile in the shared
  agent/context pathway or a narrow `RemoteQuestionService` that shares the same
  document tools and provider adapters.
- Enforce read-only behavior in provider prompts, proposal persistence, and
  Codex sandbox/tool policy.
- Require enabled remote settings, paired chat id, bound workspace match, request
  deadline, and one-active-run guard before invoking the provider.
- Expose the safe Markdown document tools to the selected provider.
- Enforce read limits, tool-call limits, answer length limits, and one-active-run
  policy.
- Derive source paths from manifest `document_read` rows, not model prose.
- Record context manifests for searches and reads.
- Add Telegram answer formatting and chunking.
- Add tests with fixture Markdown workspaces.

### Phase 4: Relay Safety And Product Hardening

- Add revoke/unlink paths from desktop and Telegram.
- Add rate limiting and busy responses.
- Add redacted diagnostics.
- Add copy for privacy, read-only behavior, and failure modes.
- Add manual QA scripts for pairing, offline desktop, disabled remote, and
  normal ask flows.

## Tests

Desktop tests:

- Remote service does not connect while disabled.
- Remote service connects only with stored device auth.
- Requests from unpaired chat ids are rejected.
- `/status` fails cleanly with no workspace.
- `ask` rejects empty and overlong questions.
- `ask` uses the read-only remote run profile.
- `ask` does not create proposals or write files.
- OpenAI remote prompts omit edit/proposal marker instructions.
- OpenAI remote responses with proposal markers are not saved as proposals.
- Codex remote runs start with read-only sandbox/tool policy.
- Codex file-change events or disk writes during a remote run fail the run and
  restore the workspace.
- `ask` uses only Markdown document tools and respects document limits.
- `ask` records context manifest receipts for document searches and reads.
- `ask` returns only sources derived from manifest document-read rows.
- Active remote run blocks a second concurrent ask.
- Disable/revoke cancels active remote work.
- Telegram remote asks do not auto-include the active desktop file unless the
  request explicitly asks for it or a future setting enables it.
- Remote asks fail or require reconfirmation after the desktop workspace changes
  from the workspace bound during pairing/enabling.
- Revoke/disable clears local remote transcript for the pairing.

Relay tests:

- Telegram webhook rejects invalid secret paths.
- `/start` with a valid token completes pairing.
- Expired or reused pairing tokens fail.
- Group chat messages are rejected.
- Offline desktop returns a clear Telegram message.
- Connected desktop receives the correct request envelope.
- Long desktop responses are split safely.
- Rate limits are enforced per chat.
- `/unlink` revokes the pairing before any later ask can reach desktop.
- Device WebSocket auth uses the stored device secret.
- Relay logs do not include raw prompt, answer, provider payload, or Markdown
  content.

Manual QA:

- Pair from QR/deep link.
- Ask a question that should cite one file.
- Ask a question that should cite multiple files.
- Ask a named workspace question that requires document discovery.
- Ask while desktop is offline.
- Ask after remote access is disabled.
- Ask while another remote ask is running.
- Unlink from Telegram and confirm desktop shows revoked state.
- Re-pair the same Telegram account.

Run for Iliad changes:

- `npm run typecheck`
- `npm test`
- `npm run build`

Run relay tests with the relay package's own command once that package exists.

## Acceptance Criteria

- Telegram is only a channel into desktop Iliad.
- The relay never calls the AI provider directly.
- The relay never stores workspace content, raw prompts, raw answers, provider
  responses, or context manifests.
- Desktop Iliad owns provider calls, document tools, context policy, receipts,
  and cancellation.
- Remote V1 is read-only and cannot create or apply Markdown proposals.
- Remote read-only behavior is enforced in code, not only in prompts.
- Remote asks use the same safe Markdown document-tool contract as the desktop
  assistant.
- Every content-dependent answer cites relative Markdown source paths derived
  from manifest document-read rows.
- Context receipts distinguish workspace availability from actual document
  search/read activity.
- Active desktop file context is not silently included in every Telegram ask.
- Remote access is bound to the workspace enabled/paired on desktop, and
  workspace switches require reconfirmation before remote asks continue.
- Security controls needed for public webhook exposure, including webhook secret
  validation, group rejection, rate limiting, revoke/unlink, device-secret auth,
  one-active-run, and deadlines, are in place before ask is enabled.
- Offline, disabled, unpaired, busy, and timeout states return clear Telegram
  messages.

## Rollout

Keep this behind an explicit experimental setting. The desktop app should ship
with Telegram Remote Chat disabled by default.

Recommended rollout order:

1. Local development with a test bot and development relay.
2. Internal dogfood with personal workspaces only.
3. Add redacted diagnostics and clearer failure messages.
4. Decide whether the next remote surface should be:
   - richer Telegram commands;
   - a PWA Markdown reader;
   - remote proposal review.

Do not add remote writes until the read-only relay, pairing, revocation, context
receipts, and privacy model have been exercised in real use.

## Open Questions

- Should the active file ever be auto-included for remote asks, or only when the
  Telegram user explicitly asks about it?
- Should answers use Codex by default when connected, or should remote chat
  require the OpenAI API fallback until Codex dynamic tool receipts are stable?
- How much exact Markdown can be included in an answer before this starts to
  feel like document exfiltration rather than question answering?
- Should there be a workspace allowlist, or is "current open workspace only"
  enough for V1?
- Should the relay live in this repository or a separate deployment repository?
- Should V1 support multiple desktops under one Telegram bot account, or only
  one paired desktop?

## References

- [Current context architecture](../docs/context-management/current-architecture.md)
- [Model-directed context tools](../docs/context-management/model-directed-context-tools.md)
- [Context architecture decisions](../docs/context-management/decisions.md)
- [OpenClaw Codex runtime research](../docs/context-management/openclaw-codex-runtime-research.md)
- Telegram Bot API `setWebhook`:
  <https://core.telegram.org/bots/api#setwebhook>
- Telegram Bot API `sendMessage` and formatting:
  <https://core.telegram.org/bots/api#sendmessage>
- Cloudflare Durable Objects WebSockets:
  <https://developers.cloudflare.com/durable-objects/best-practices/websockets/>
