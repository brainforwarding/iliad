# Chat History

## Problem

The assistant transcript is currently ephemeral. When a user starts a new chat, closes the app, or changes context, prior conversations are not available from the agent panel. This makes it difficult to return to useful exchanges, compare prior advice, or continue a conversation about a document.

Users also need the history UI to stay clean: the current empty "Nueva conversacion" state is an action, not history. It must not appear as a saved conversation.

## Goals

- Persist assistant conversations locally in Electron `userData`, scoped by workspace root.
- Add a history control in the assistant header, next to the new-chat control.
- Show saved conversations by title on the left and a compact relative age on the right, such as `1m`, `2h`, `2d`, or `3w`.
- Load a saved conversation when the user selects it from history.
- Keep "new conversation" as a header action only. Empty chats are not saved and are never listed in history.
- Generate a useful conversation title:
  - immediately use a deterministic fallback from the first meaningful user message;
  - after the first assistant answer, optionally ask the active text provider for a better title when the user has an OpenAI API key or a connected Codex account;
  - store the generated title as metadata only, never as a transcript entry.
- Keep title generation best-effort. Failure to generate a title must not interrupt the chat.
- Keep history local to the device for this phase.

## Non-Goals

- Cloud sync, account-level history, or cross-device history.
- Search, filters, favorites, pins, export, or manual rename.
- Showing unsaved empty conversations in history.
- Adding title-generation messages to the visible transcript.
- Sending title-generation prompts as future chat context.
- Importing legacy conversations. There are no persisted legacy conversations today.

## User Flow

### Header Layout

```text
Agent                                           [+] [clock] [settings] [close]
current conversation title
```

- `+` starts a blank current chat.
- `clock` opens the history popover.
- Settings and close keep their current behavior.
- If a saved conversation is active, its title can appear as small secondary header text below `Agent`.

### History Popover

```text
History

Today
  Guia para clase sincronica                         1m
  Estrategias de apertura                            2h

Yesterday
  Rubrica actividad diagnostica                       1d

Older
  Ajustes para cierre de sesion                       3w

Clear history
```

- Rows are sorted by most recently updated first.
- The title is left aligned and truncated if needed.
- The compact age is right aligned, small, and visually secondary.
- The active thread is indicated subtly.
- The popover never contains a "New conversation" row.

### Empty State

When there are no saved conversations:

```text
History

No saved conversations
```

The user still starts a new chat with the existing header `+` button.

### Selecting A Conversation

- Selecting a row loads that thread into the transcript and closes the popover.
- Selecting a row while an assistant run is active is disabled for this phase. The UI should avoid silently cancelling or replacing an in-flight run.

### Starting A New Conversation

- Pressing `+` keeps the existing behavior: cancel an active run if needed, clear the transcript, and prepare a blank current chat.
- The blank chat has no thread id until the user sends the first message.
- If the user never sends a message, nothing is saved and nothing appears in history.

## Title Behavior

### Fallback Title

On the first user message, create a title from the first meaningful words after stripping markdown syntax, links, code fences, and extra whitespace. Cap the result at a short display-safe length.

Examples:

- `deberiamos tener una guia con estrategias...` -> `deberiamos tener una guia con estrategias`
- `# Guia rapida: estrategias para activar...` -> `Guia rapida: estrategias para activar`

### AI Title

After the first assistant response in a thread:

- If the current assistant runtime can generate text through OpenAI API key or Codex login, start a background title request.
- The request should include only the first user message and the first assistant answer or a short assistant summary. It must not include full document contents, file manifests, secrets, or proposal patches.
- The prompt asks for a concise title in the conversation language and requires title-only output.
- The resulting title is sanitized before storage.
- If the provider is unavailable, fails, or returns unusable text, keep the fallback title.

This generated title is metadata. It is not appended to `entries`, not rendered in `AssistantTranscript`, and not included in future `chatMessages`.

## Data Model

Store a JSON file under:

```text
<Electron userData>/assistant/chat-history.json
```

Suggested shape:

```ts
type AgentChatThreadTitleSource = "fallback" | "ai";

type AgentChatHistoryEntry = {
  id: string;
  kind: "user" | "assistant" | "error" | "status";
  text: string;
  createdAt: string;
};

type AgentChatThread = {
  id: string;
  workspaceRoot: string;
  title: string;
  titleSource: AgentChatThreadTitleSource;
  createdAt: string;
  updatedAt: string;
  entries: AgentChatHistoryEntry[];
};

type AgentChatThreadSummary = {
  id: string;
  title: string;
  titleSource: AgentChatThreadTitleSource;
  updatedAt: string;
  messageCount: number;
};
```

Implementation notes:

- The top-level file is versioned:

  ```ts
  type AgentChatHistoryFile = {
    schemaVersion: 1;
    threads: AgentChatThread[];
  };
  ```

- Store workspace roots as resolved absolute paths.
- The main process assigns the stored `workspaceRoot` from the request. Renderer-provided roots on a thread are ignored or normalized before writing.
- Return only threads whose stored `workspaceRoot` matches the current normalized request workspace root.
- Do not persist empty threads.
- Persist visible transcript text only. Do not persist `contextManifest`, runtime request payloads, proposal patches, tool payloads, or provider diagnostics in chat history.
- Limit stored threads per workspace to a conservative number, such as 100 most recently updated threads.
- Tolerate missing JSON by returning empty history. If the JSON file is corrupt, rename it to a timestamped `.corrupt` backup and start from an empty history file on the next write.
- Use atomic temp-file-and-rename writes.
- Use queued read-modify-write mutations, following the proposal store pattern, so concurrent saves do not corrupt the JSON file.
- Merge concurrent transcript and title updates by field:
  - transcript saves update entries and timestamps;
  - title-generation updates update only `title` and `titleSource`;
  - transcript saves must preserve an existing AI title and must not revert it to fallback;
  - pending saves or title updates must not recreate a thread after `clearChatHistory()` removes the workspace history.

## IPC And Renderer API

Add preload methods under `window.iliad.agent`:

```ts
listChatThreads(workspaceRoot: string): Promise<AgentChatThreadSummary[]>;
getChatThread(request: { workspaceRoot: string; threadId: string }): Promise<AgentChatThread | null>;
saveChatThread(request: {
  workspaceRoot: string;
  thread: Omit<AgentChatThread, "workspaceRoot"> & { workspaceRoot?: string };
}): Promise<AgentChatThread>;
clearChatHistory(workspaceRoot: string): Promise<void>;
generateChatThreadTitle(request: {
  workspaceRoot: string;
  threadId: string;
  language: "en" | "es";
}): Promise<AgentChatThread | null>;
```

IPC handlers live beside the existing `agent:*` handlers and delegate to `AgentService`.

Title generation derives its prompt from the persisted sanitized thread in the main process. The renderer passes only `workspaceRoot`, `threadId`, and `language`, so it cannot accidentally send document contents or arbitrary hidden context through this metadata path.

## Renderer State

`useAssistantRun` owns the active local thread:

- `activeThreadId`
- `activeThreadTitle`
- `activeThreadTitleSource`
- `chatThreads`
- `loadChatThread(threadId)`
- `clearChatHistory()`

Saving behavior:

- The first user message creates the active thread id and fallback title.
- The hook saves whenever a non-empty active transcript changes.
- The list is refreshed or locally updated after saves and title updates.
- `newChat()` clears the active thread id and entries.
- `chatMessages` continues to derive only visible `user` and `assistant` transcript entries. Title-generation work is not included.
- `generateChatThreadTitle()` is only requested for the active thread after the first assistant answer. If the active thread changes before the response returns, the renderer updates only the history list and does not replace the visible header title.

## UX States

- Loading history: the history button remains visible; the popover can show a compact loading row if opened before the list returns.
- Empty history: show "No saved conversations".
- Active run: history rows and clear-history are disabled. The button may still open the popover.
- Save failure: keep the current transcript in memory and log diagnostics. Do not show disruptive error copy in the chat unless persistence repeatedly fails.
- Title-generation failure: keep fallback title silently.
- Clear history: require confirmation, then clear the active transcript only if it belongs to saved history. If the current transcript is unsaved and in progress, do not erase it unexpectedly.
- Popover copy follows the active app locale. English labels are `History`, `Today`, `Yesterday`, `This week`, `Older`, `Clear history`, and `No saved conversations`. Spanish labels are `Historial`, `Hoy`, `Ayer`, `Esta semana`, `Anterior`, `Borrar historial`, and `Sin conversaciones guardadas`.

## Security And Privacy

- History is local only. No cloud sync in this phase.
- Do not persist API keys, provider auth tokens, raw runtime request payloads, or environment details.
- Do not send document contents to title generation. Use only the first user message and a short assistant answer or summary.
- Normalize workspace paths before matching history records.
- Renderer-provided thread data is sanitized before writing to disk.
- Reject or ignore cross-workspace thread writes. Request workspace root is the source of truth.

## Tests

Required local tests:

- Store tests for save, list sorting, workspace scoping, get, clear, empty-thread exclusion, corrupt JSON recovery, and max-thread pruning.
- Title helper tests for fallback title extraction and generated-title sanitization.
- Relative-time helper tests for `1m`, `2h`, `2d`, and `3w` style output.
- Renderer component test that the popover renders title plus right-aligned compact age and does not render a "New conversation" row.
- Hook or integration test for `newChat()` not creating a listed history item.
- Service test that title generation updates metadata only and does not add transcript entries.
- IPC/store tests for workspace mismatch handling and renderer-supplied malformed thread sanitization.
- Race tests or focused store tests that concurrent transcript save and title update preserve both the latest transcript and AI title, and that clear-history is not undone by a stale pending write.
- Privacy test that generated-title requests derive their payload from stored visible transcript text only.

Verification commands:

```text
npm test -- tests/agent/chatHistoryStore.test.ts tests/assistant/chatHistory.test.ts tests/assistant/AssistantHistoryPopover.test.tsx
npm run typecheck
npm test
npm run build
```

## Rollout

This repo currently has a single trunk production branch, `master`. The feature should land through the isolated branch `codex/chat-history`, then be pushed to `master` only after local verification and any relevant remote checks are clean.

No database migration or external deployment provider change is required.

## Open Assumptions

- Local-only history is acceptable for the first version.
- The current Electron app is the only target for this feature.
- Compact ages should be language-neutral (`1m`, `2h`, `2d`, `3w`) rather than localized prose.
- The app can retain visible status/error entries in saved transcripts, but it must not retain context manifests and title generation must not save synthetic entries.
