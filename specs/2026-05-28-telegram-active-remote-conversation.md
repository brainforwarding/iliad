# Telegram Active Remote Conversation

Date: 2026-05-28
Status: implemented
Roadmap: `specs/2026-05-27-telegram-remote-chat-roadmap.md`
Branch: `feat/telegram-active-remote-thread`

## Problem

Telegram Remote Chat now persists remote turns in assistant history, but all
Telegram asks still use the default remote history thread. The user cannot
explicitly choose which desktop conversation Telegram should continue.

That makes handoff incomplete: the user can see Telegram turns later, but cannot
say "this is the one conversation my phone should continue now."

## Product Intent

Telegram should be connected to exactly one Iliad conversation at a time. The
desktop app should make that connection explicit and provide a simple way to
move it to the currently open conversation.

This is a local desktop routing decision. The relay should remain unaware of
Iliad conversation ids.

## Goals

- Add a local `activeThreadId` to Telegram Remote Chat settings.
- Use the active remote thread for Telegram asks:
  - load prior user/assistant entries from that thread as conversation messages;
  - run the remote read-only agent with that conversation history;
  - append the Telegram turn back to that same thread.
- Preserve existing users by falling back to the default `telegram-remote`
  thread when no active remote thread is configured.
- Let the desktop user move remote access to the currently active conversation.
- Show the selected remote conversation in the existing Remote access settings
  card with minimal, clean copy.
- Keep only one remote conversation selected at a time.
- Keep the relay protocol unchanged.
- Keep remote access read-only.

## Non-Goals

- No Telegram `/new`, `/history`, or `/switch` commands.
- No list of all conversations inside settings.
- No visual badge in transcript rows.
- No live notification when Telegram appends to the active desktop transcript.
- No relay-side conversation storage.
- No multi-device or multi-chat routing.
- No remote editing or proposal review.

## UX

In `Agent settings -> Remote access -> Telegram Remote Chat`, show one compact
conversation routing row after pairing status and before privacy/read-only copy:

```text
Iliad chat: <title>    Use this chat
```

Rules:

- If the selected remote thread is the currently open desktop thread, show the
  current thread title or a short "This chat" fallback.
- If a selected remote thread exists in history, show its title.
- If there is no valid `activeThreadId`, show "Default remote chat".
- If a configured `activeThreadId` is valid but its title is not available,
  show "Selected chat".
- Show the adjacent "Use this chat" action only when:
  - Telegram Remote Chat is enabled;
  - the desktop has an active saved/current thread id;
  - that id is not already the selected remote thread.
- If the current chat is blank and has no thread id, do not show the action.
- After success, refresh the row, hide the action, and rely on that row change
  as feedback.

The control should stay in the same quiet link-action style as Enable, Disable,
Pair, and Revoke. Do not add a modal, dropdown, second card, or large
explanatory block.

## System Flow

### Binding From Desktop

```text
User opens an existing conversation or sends a first desktop message
  -> activeThreadId exists in renderer state
  -> user opens settings
  -> clicks Use this chat
  -> renderer sends remote:update-settings { activeThreadId, workspaceSessionId }
  -> Electron validates trusted sender and current workspace session
  -> RemoteSettingsStore persists activeThreadId
```

### Telegram Ask

```text
Telegram ask
  -> TelegramRemoteService validates paired chat and bound workspace
  -> resolve targetThreadId from settings once, fallback telegram-remote
  -> load that thread's prior user/assistant entries
  -> start read-only agent run with prior messages and current prompt
  -> append final Telegram turn into the captured targetThreadId
```

## Data Model

Extend local remote settings:

```ts
interface TelegramRemoteSettings {
  activeThreadId?: string;
  activeThreadWorkspaceRoot?: string;
}
```

Sanitization:

- Accept only the same thread-id contract used by chat history:
  `/^[A-Za-z0-9._:-]{1,120}$/`.
- Empty, invalid, or missing values are omitted from settings and route to
  `telegram-remote`.
- The value is local metadata only. It must not be sent to the relay.
- Store `activeThreadWorkspaceRoot` with `activeThreadId`.
- If remote chat is enabled for a different `boundWorkspaceRoot`, clear
  `activeThreadId` and `activeThreadWorkspaceRoot`.
- Use `activeThreadId` only when `activeThreadWorkspaceRoot` matches the current
  bound workspace. Otherwise route to `telegram-remote`.

## Agent Context

Remote runs should use the selected thread's prior visible conversation:

- include only `kind: "user"` and `kind: "assistant"` entries;
- preserve chronological order;
- omit status/error entries from provider messages;
- omit context manifests, source metadata, provider payloads, and any non-text
  fields;
- do not include the current Telegram question in `messages`; the current
  question appears only in `prompt` through `remoteAskPrompt(text)`.

The final prompt remains the current Telegram question through
`remoteAskPrompt(text)`.

## Persistence

Reuse the atomic append API from the history persistence step.

- Success and accepted terminal errors append to the selected active remote
  thread.
- Resolve `targetThreadId` exactly once after remote context validation and
  before loading history. Pass that captured value through agent context and all
  success/error persistence paths. Do not re-read settings for persistence after
  the remote run starts.
- Replays with the same remote request id remain idempotent across the
  workspace, not just inside one thread. If a request id was already persisted
  in any thread for the workspace, replay after changing `activeThreadId` must
  not append that turn to the new thread.
- Existing fallback behavior continues for settings files that do not yet have
  `activeThreadId`.
- Clearing chat history does not need special remote-settings cleanup in this
  step. If the selected thread was cleared, the next Telegram ask may recreate
  that thread id with the new remote turn.

## IPC And Trust Boundary

- Extend trusted remote settings IPC to accept `{ enabled?, activeThreadId?,
  workspaceSessionId? }`.
- Process `activeThreadId` even when `enabled` is omitted. Do not return early
  just because `enabled` is absent.
- Require a current `workspaceSessionId` when changing `activeThreadId`.
- Resolve that workspace session and require it to match the currently bound
  remote workspace when remote is enabled. Reject mismatches.
- Active-thread-only updates must not call relay `sync`; the relay remains
  unaware of Iliad conversation ids.
- Do not expose `deviceSecret` or any relay secrets.
- Do not add relay protocol fields.

## Renderer State

- Expose the routing state through `TelegramRemoteConnectionState`, such as:
  - selected Iliad chat label;
  - whether `Use this chat` is available;
  - action for selecting the current chat.
- Update all type surfaces:
  - backend `remoteTypes.ts`;
  - `RemoteSettingsStore` update/sanitize types;
  - public renderer types in `src/types/iliad.ts`;
  - public update request type;
  - `useAssistantRun` optional remote API type.
- Guard remote settings refreshes and updates with request sequencing so stale
  `getSettings()` responses cannot overwrite a newer `Use this chat` update.

## Tests

- `tests/remote/telegramRemoteService.test.ts`:
  - uses `settings.activeThreadId` for history append instead of default;
  - falls back to `telegram-remote` when missing;
  - loads prior user/assistant messages from the selected thread for the agent
    request;
  - asserts `messages` contains prior entries only and does not include the
    current Telegram question;
  - omits status/error entries from remote agent messages;
  - captures target thread once; if settings change while the agent promise is
    pending, the final turn appends to the original target;
  - replay with the same request id after changing active thread does not append
    to the new thread.
- `tests/remote/remoteIpc.test.ts`:
  - trusted IPC can set `activeThreadId` for the current workspace session;
  - invalid/empty active thread ids are sanitized or ignored;
  - changing active thread requires a valid workspace session;
  - active-thread-only update works without `enabled`;
  - active-thread-only update rejects a workspace session that does not match
    the bound remote workspace;
  - active-thread-only update does not relay sync.
- `tests/assistant/codexSettingsCopy.test.ts`:
  - remote card renders selected conversation copy;
  - `Use this chat` appears only when eligible;
  - copy says `Iliad chat: ...` and distinguishes default, selected current
    thread, known historical thread, and unknown configured thread;
  - no action appears for blank/no-thread state or already-selected state.
- Existing history persistence tests continue to pass.
- Run focused tests, full test suite, typecheck, CSS lint, and production build.

## Review Panel

- UI/UX reviewer: minimal settings hierarchy, copy, action placement, and
  whether "Use this chat" is clear without adding heavy UI.
- Backend/history reviewer: settings model, remote service conversation
  loading, fallback behavior, idempotency, and privacy boundary.
- Frontend reviewer: renderer state, IPC call shape, settings render tests, and
  race risks.

The review panel completed. The final spec incorporates the requested
corrections: destination copy uses `Iliad chat`, the action is adjacent and
named `Use this chat`, active-thread routing is workspace-scoped, target thread
selection is captured once per ask, replay idempotency is workspace-wide, and
active-thread-only IPC updates are explicitly supported without relay sync.
