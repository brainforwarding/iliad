# Telegram Remote History Persistence

Date: 2026-05-27
Status: implemented
Roadmap: `specs/2026-05-27-telegram-remote-chat-roadmap.md`
Branch: `feat/telegram-history-persistence`

## Problem

Telegram Remote Chat works end to end, but remote questions and answers are not
saved in Iliad's assistant history. If the user asks Iliad something from their
phone, the desktop app has no durable transcript to reopen later.

## Product Intent

Telegram should behave like another input channel into the same local Iliad
assistant, not like a separate bot with separate memory. A user should be able
to ask from Telegram and later open Iliad on the computer, go to History, and
continue from the saved remote transcript.

This step creates the durable history foundation only. It does not yet add
conversation selection or switching; that is the next roadmap item.

## Goals

- Persist accepted Telegram ask turns into the existing assistant history store.
- Save the Telegram user's question and Iliad's final reply in the same thread.
- Save final remote failures for accepted asks as error entries when the
  desktop has a valid paired workspace context.
- Use a stable default remote thread per workspace until explicit remote
  conversation selection exists.
- Mark persisted remote entries internally as Telegram-origin entries so a
  later UI polish can distinguish them without reparsing text.
- Store only visible transcript text and small non-secret origin metadata.
- Do not persist context manifests, provider payloads, relay secrets, device
  secrets, pairing tokens, raw relay envelopes, or workspace file contents.
- Make the History view refresh from disk when opened so remote turns saved in
  Electron main appear without restarting Iliad.
- Keep history persistence best-effort: a history write failure must not change
  the Telegram response.
- Avoid history data loss when desktop and Telegram touch the same thread.

## Non-Goals

- No visible Telegram badge in transcript or history rows.
- No active remote conversation selector.
- No Telegram `/new`, `/history`, or `/switch` commands.
- No relay protocol changes.
- No relay-side conversation storage.
- No context manifest disclosure for loaded remote answers.
- No AI-generated title generation for remote-only threads in this step.

## System Flow

For a valid paired ask:

```text
Telegram ask
  -> relay forwards request
  -> Electron TelegramRemoteService validates settings/workspace
  -> read-only agent run executes
  -> TelegramRemoteService creates RemoteResponse
  -> TelegramRemoteService appends visible remote transcript entries
  -> relay sends RemoteResponse to Telegram
```

Until the next spec, the thread id should be stable and workspace-local:

```text
telegram-remote
```

The existing `AgentChatHistoryStore` already scopes threads by normalized
workspace root, so the same thread id can safely exist in multiple workspaces.

## Persistence Rules

Accepted ask:

- An ask is accepted for history only after paired-chat/workspace validation,
  non-empty text validation, max-length validation, deadline-before-start
  validation, and busy validation have all passed.
- Accepted asks persist a final turn even if the terminal result is an error.
- Pre-accept rejections do not persist.

Persist success:

- user entry:
  - `kind: "user"`
  - text is the normalized Telegram question
  - `source: "telegram"`
- assistant entry:
  - `kind: "assistant"`
  - text is the same visible answer sent to Telegram, including the `Sources:`
    block built from `RemoteAnswerSource[]`
  - `source: "telegram"`

Persist final accepted-ask failures:

- Save the user question and one `kind: "error"` entry with the final message
  returned to Telegram.
- Persist accepted terminal failures for agent/provider errors, no verified
  sources, edit-shaped answers, thrown `startRun` failures, and deadline expiry
  after the run starts.
- Do not persist disabled, unpaired, missing-workspace, expired-before-start,
  empty, oversized, or busy rejections.

Idempotency:

- Entry ids should derive from a hash or sanitized form of the remote request id:
  - `telegram:<request-key>:user`
  - `telegram:<request-key>:assistant`
  - `telegram:<request-key>:error`
- If a request key already exists in the thread, replay must not append or
  mutate the existing turn, even if the replayed payload differs.

Atomicity:

- Add a store-level append API, not a `getThread` + `saveThread` sequence.
- The append API must read, dedupe, append, preserve existing title/titleSource
  and createdAt, prune the workspace, and write inside one queued store
  mutation.
- Electron main should use one shared `AgentChatHistoryStore` instance for the
  renderer `AgentService` and `TelegramRemoteService`, or otherwise guarantee
  the same per-file queue across both paths.
- Renderer saves for an existing thread must preserve Telegram-origin entries
  that are already in the store but absent from the renderer's stale incoming
  transcript. This prevents a desktop follow-up from deleting a phone turn that
  arrived while the thread was open.

Privacy:

- The persisted thread must not include context manifests, `manifestId`,
  provider metadata, raw relay envelopes, Telegram chat ids, Telegram usernames,
  device secrets, pairing tokens, relay secrets, or workspace file contents.
- The optional entry origin metadata may contain only a small enum such as
  `"telegram"`.

## Desktop History Refresh

The renderer currently loads chat history when the workspace changes. Remote
history writes happen in Electron main, outside the renderer's transcript state.

Add a small refresh path so opening History reloads thread summaries from the
existing IPC:

```text
History button clicked
  -> if opening History, call listChatThreads(workspace.path)
  -> render updated summaries
```

This is enough for this step. Live push notifications from main to renderer can
wait until remote activity needs real-time desktop UI.

Refresh semantics:

- Expose a `refreshChatThreads` method from `useAssistantRun`.
- Call it only when the History view transitions from closed to open.
- Guard async refresh results by workspace and request sequence so a stale
  response cannot overwrite summaries for a newer workspace.
- Use the existing loading state while refreshing.
- If refresh fails, keep the current summaries and log a warning.
- Do not increment `historyMutationGeneration` for refresh; it must not suppress
  in-flight transcript saves or title updates.

## Implementation Notes

- Update `electron/remote/telegramRemoteService.ts`.
- Add an atomic append method to `electron/agent/chatHistoryStore.ts`.
- Share an `AgentChatHistoryStore` instance through Electron main so the
  renderer `AgentService` and `TelegramRemoteService` coordinate on one queued
  history writer.
- Extend `AgentChatHistoryEntry` types in Electron and renderer with optional
  `source?: "desktop" | "telegram"`.
- Update `electron/agent/chatHistoryStore.ts` to sanitize and preserve only the
  allowed source enum.
- Update `src/assistant/chatHistory.ts` and `AssistantEntry` so renderer saves
  preserve valid `source` values and drop invalid metadata.
- Add a refresh method in `src/assistant/useAssistantRun.ts` and call it from
  `src/components/AssistantPanel.tsx` when opening History.
- Keep the default remote thread id internal and export it only if tests need
  it.
- Add a local formatter such as `visibleRemoteAnswerText(text, sources)` for
  persisted assistant text. It should match Telegram's plain text shape:
  answer, blank line, `Sources:`, and one `- relative/path.md[:line]` per
  source. Do not include `manifestId`.

## Tests

- `tests/remote/telegramRemoteService.test.ts`:
  - successful Telegram ask creates or appends to the default remote history
    thread;
  - saved assistant text includes source paths;
  - repeated request id does not duplicate entries;
  - agent errors/no-source/edit-shaped answers persist user plus error;
  - post-start deadline expiry and thrown agent errors persist user plus error;
  - disabled/unpaired/missing-workspace/busy/empty/oversized rejections do not
    persist history.
- `tests/agent/chatHistoryStore.test.ts`:
  - optional `source: "telegram"` survives sanitization;
  - invalid source values are dropped;
  - context manifests and unrelated metadata are still stripped.
- `tests/assistant/chatHistory.test.ts`:
  - `visibleHistoryEntries` preserves valid `source: "telegram"` and drops
    invalid metadata.
- Add focused coverage for atomic append/idempotency and for preserving
  Telegram-origin entries when a stale renderer save updates the same thread.
- Add focused coverage for the History-open refresh path where practical.
- Existing assistant history tests continue to pass.
- Run focused tests, full test suite, typecheck, CSS lint when touched, and
  production build before merge.

## Review Panel

- Backend/history reviewer: persistence rules, privacy, idempotency, and tests.
- Frontend reviewer: History refresh path, renderer state risk, and type
  compatibility.

The review panel completed. The final spec incorporates the requested
corrections: store-level atomic append, shared history writer coordination,
accepted failure boundaries, deterministic idempotency, Telegram-origin metadata
preservation, stale renderer-save protection, and guarded History refresh.
