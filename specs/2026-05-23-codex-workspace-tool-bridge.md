# Codex Workspace Tool Bridge Spec

Date: 2026-05-23
Status: implemented

## Product Intent

Iliad's main assistant should behave like a real workspace agent. When a user
asks it to improve, rewrite, create, or organize Markdown documents, Codex
should be able to reason with workspace context and attempt file changes through
its native runtime. Iliad must remain the approval boundary: every Codex file
change becomes a pending Iliad proposal shown in the document-native red/green
review UI, and the real Markdown files are saved only when the user accepts
those changes in Iliad.

The design must not bend the product around the model. The goal is not a hidden
temp-workspace patch generator. The goal is a Codex-style agent connected to the
actual workspace, with its write attempts intercepted into Iliad's proposal
system before disk mutation.

## Relationship To Prior Specs

This spec supersedes the implementation assumptions in
[Codex Agent Runtime Provider](./2026-05-23-codex-agent-runtime-provider.md)
where they conflict with this product decision. That prior spec remains useful
for the authentication split and provider seam:

- Codex/ChatGPT account auth powers the main future agent runtime.
- OpenAI Platform API key remains available for transcription, images, realtime,
  embeddings, and fallback text runs.
- The existing `AgentRuntimeProvider` seam is the right insertion point.

This spec builds on:

- [Iliad Agent Vision](../docs/agent-vision.md)
- [Core Agent Proposal Architecture](./2026-05-23-core-agent-proposal-architecture.md)
- [Document Native Review UI](./2026-05-23-document-native-review-ui.md)
- [Agent Thinking Summaries](./2026-05-23-agent-thinking-summaries.md)
- [Agent Context Management](./2026-05-23-agent-context-management.md)
- [Assistant Experience Review](./2026-05-23-assistant-experience-review.md)

## Evidence From Current Code And Codex Protocol

Current Iliad code already has the pieces needed for the approval boundary:

- `AgentService.startRun()` normalizes provider output into
  `AgentDraftFileChange[]`, then persists `AgentChangeProposal` records.
- `AgentProposalStore` owns accept/reject/stale logic and writes files only
  after Iliad actions.
- The editor review extension renders proposed edits as red removed text and
  green inserted text in the document.
- `CodexAppServerClient` already manages app-scoped Codex auth and status
  through `codex app-server --listen stdio://`.

Generated Codex app-server schema from `codex-cli 0.133.0` shows the runtime
supports the bridge we need:

- `thread/start` accepts `cwd`, `sandbox`, `approvalPolicy`,
  `approvalsReviewer`, `baseInstructions`, `developerInstructions`, and
  `ephemeral`.
- `turn/start` accepts `threadId`, text input, `cwd`, `sandboxPolicy`, `model`,
  `effort`, and `summary`.
- The server emits thinking and progress notifications including
  `item/reasoning/summaryTextDelta`, `item/agentMessage/delta`,
  `turn/plan/updated`, `turn/started`, and `turn/completed`.
- File-change events include `item/fileChange/patchUpdated` with
  `{ path, kind, diff }` changes and `turn/diff/updated`.
- The server can ask the client to approve file changes through
  `item/fileChange/requestApproval`. Responses can be `accept`,
  `acceptForSession`, `decline`, or `cancel`.
- JSON-RPC request ids can be numbers or strings.

The critical implementation detail is that Iliad's client must recognize
server requests separately from normal JSON-RPC responses. Today, a message with
a numeric `id` is treated only as a response, so an approval request would
stall.

## Goals

- Make connected Codex account users run the main chat through Codex app-server
  instead of the OpenAI API-key text provider.
- Pass the real workspace root as Codex `cwd` so the runtime is workspace-aware.
- Let Codex attempt Markdown file changes using its native file-change flow.
- Capture file-change patches and convert them into Iliad
  `AgentDraftFileChange[]`.
- Decline Codex file-change approval requests after capturing proposed changes,
  so Codex does not write directly to real course files.
- Keep accept/reject/write responsibility inside `AgentProposalStore`.
- Stream Codex reasoning summaries and final assistant text into the existing
  thinking/chat UI.
- Remove the renderer-side chat block that requires an OpenAI API key when
  Codex is connected.
- Keep OpenAI API-key provider as fallback when Codex is disconnected or
  unavailable.
- Keep OpenAI API key for dictation and future media features.
- Add tests around the app-server protocol bridge, patch conversion, provider
  selection, and no-direct-write guarantees.

## Non-Goals

- No hidden temp copy as the canonical runtime workspace.
- No direct writes to real Markdown files before Iliad approval.
- No delete-file or rename proposal support in this first slice.
- No command execution approval in this first slice.
- No browser/MCP/terminal UI.
- No visible subagent manager yet.
- No provider picker unless needed for fallback debugging.
- No attempt to support every Codex event shape; normalize only what we use.
- No non-Markdown artifact builders as part of the core agent. Rubrics,
  handouts, deck outlines, and course materials are Markdown files.

## User Flow

1. User opens a Markdown workspace and connects Codex through the existing
   device-code login UI.
2. Settings shows Codex is connected and makes clear that the chat agent now
   uses Codex, while dictation still uses the OpenAI API key if configured.
3. User asks: "improve the intro" or "create an annex".
4. Iliad starts a Codex thread/turn with the real `workspaceRoot` as `cwd`.
5. The chat shows subtle thinking/progress summaries from Codex.
6. If Codex proposes file changes, Iliad captures the patch events and declines
   direct Codex approval.
7. Iliad saves the captured changes as pending proposal records.
8. The chat stays clean: a concise message says the proposal is ready for
   review, without dumping diffs or full document text.
9. The document shows red/green proposed changes. The user accepts or rejects
   individual hunks or all changes using Iliad's existing review UI.

If Codex is disconnected:

1. The current OpenAI API-key text provider continues to run when an API key is
   available.
2. If neither Codex nor an OpenAI API key is available, the user sees the
   current missing-key style error, updated to mention either connecting Codex
   or adding an API key.

## Runtime Architecture

### Provider Selection

`AgentService.startRun()` chooses providers in this order:

1. `codex-app-server`, when Codex account status is connected and app-server is
   available.
2. `openai-api`, when an OpenAI API key is available.
3. Failure response when neither runtime is available.

Codex failures should not silently retry through OpenAI on the same user prompt
after `thread/start` has been sent. Silent fallback after that point could
create duplicate or inconsistent proposals. Safe fallback is allowed only before
Codex thread creation begins.

### Codex Thread Start

Start an ephemeral thread for each Iliad run:

```ts
thread/start {
  cwd: request.workspaceRoot,
  sandbox: "workspace-write",
  approvalPolicy: "on-request",
  approvalsReviewer: "user",
  ephemeral: true,
  baseInstructions,
  developerInstructions
}
```

Use `workspace-write` so Codex has the correct tool affordance. Use
`on-request` and `approvalsReviewer: "user"` so file writes go through an
approval request that Iliad can decline after capture.

### Codex Turn Start

Send a text input containing:

- response language;
- mode instruction;
- current active file path, when present;
- recent chat turns;
- current user request;
- workspace/editing policy.

The wire shape is:

```ts
turn/start {
  threadId,
  input: [{ type: "text", text, text_elements: [] }]
}
```

If a turn-level sandbox override is used, it must use the object-shaped
`sandboxPolicy` form, for example `{ type: "workspaceWrite", ... }`. The
`"workspace-write"` string is only for `thread/start`'s legacy `sandbox`.

The policy must say:

- the workspace is the user's real Markdown workspace;
- Codex may inspect and propose edits or new Markdown files;
- Codex should not use shell commands for this v1;
- Codex should keep visible responses concise;
- all write attempts will be reviewed by the app before disk persistence.
- durable course artifacts should be normal Markdown documents, not separate
  provider-specific artifact types.

### Server Request Handling

`CodexAppServerClient` must distinguish:

- response: message has `id` and no `method`;
- server request: message has `id` and `method`;
- notification: message has `method` and no `id`.

For server requests:

- `item/fileChange/requestApproval`: respond immediately with
  `{ id, result: { decision: "decline" } }`. The request does not include a
  patch, so the provider must rely on accumulated `patchUpdated` events and
  finalize proposals on `turn/completed`.
- `item/commandExecution/requestApproval`: respond immediately with
  `{ id, result: { decision: "decline" } }`.
- `item/permissions/requestApproval`: respond with a no-grant/decline response
  when the schema permits it; otherwise fail the turn with a clear unsupported
  permission request error.
- Unknown request methods: respond with
  `{ id, error: { code, message } }`, and log a redacted diagnostic.

This keeps the Codex turn moving without granting direct write or command
execution permission.

Command execution is disabled by policy and declined by approval. Additionally,
if any command execution start/output/completion event appears in v1, treat the
run as a hard runtime failure and do not create a success response. The
implementation should also guard the active Markdown snapshot when practical so
unexpected command mutation is not presented as a pending proposal.

### Event Capture

The Codex provider collects:

- assistant text from `item/agentMessage/delta`;
- thinking summaries from `item/reasoning/summaryTextDelta`;
- file changes from `item/fileChange/patchUpdated`;
- optional aggregate diff from `turn/diff/updated` for diagnostics;
- completion from `turn/completed`.

Reasoning deltas normalize into existing `thinking_delta` events.
`thinking_done` is derived from `item/completed` or `turn/completed` because the
schema provides reasoning delta/part events but no dedicated summary-done event.
We do not expose raw Codex event names to React.

Do not create proposals during approval handling. Proposal conversion runs after
`turn/completed`, using the final accumulated file-change state.

### Patch Conversion

For v1, support Markdown file changes only. Codex file-change kinds use
`change.kind.type`:

- `change.kind.type === "add"`: parse the added content from the unified diff and create a
  `create_file` draft only for a pure add patch if the path is a safe relative
  `.md` path that does not already exist.
- `change.kind.type === "update"`: read the current base file from the workspace, apply the
  unified diff to the base content in memory, and create an `edit_file` draft.
- `change.kind.type === "delete"`: skip and append a concise unsupported-change note.
- `change.kind.type === "update"` with `move_path`: skip and append a concise
  unsupported-change note.

All path handling must stay inside the active workspace, reject hidden/absolute
or parent-segment paths, and reuse existing Markdown path safety rules where
possible.

The converter must validate both the Codex event path and diff header paths.
Reject the change if the event path disagrees with the `---`/`+++` paths, if the
diff includes `rename from`, `rename to`, incompatible old/new paths, or a
delete-like `/dev/null` target for an update.

The unified-diff applicator must be strict:

- support standard multi-hunk unified diffs;
- support `/dev/null` source only for pure adds;
- support `\ No newline at end of file`;
- preserve LF/CRLF behavior from the base content where practical;
- fail on context mismatch, malformed hunks, negative line counts, unsupported
  metadata, or path/header mismatch.

The base content and hash in each proposal must come from the real workspace at
proposal-creation time. Codex-provided hashes are not trusted. If the current
workspace content does not match the patch context, do not create a proposal.

### Proposal Source

Add a proposal source kind for Codex:

```ts
source: {
  kind: "codex_app_server"
}
```

This avoids mislabeling Codex proposals as legacy marker adapter output.

## UX Requirements

Settings Codex copy after connection:

```text
Agente Codex                              Conectado
El chat usa Codex. Dictado usa la clave API de OpenAI.
Conectado como person@example.com
Actualizar   Desconectar
```

When disconnected:

```text
Agente Codex
Conecta Codex para usar tu cuenta de ChatGPT con el agente.
Si no lo conectas, el chat usa la clave API de OpenAI.
```

Chat behavior:

- Show thinking/progress as the existing subtle animated row.
- Cap displayed Codex thinking summaries aggressively. The chat should show
  short progress labels, not a verbose reasoning transcript.
- Never show raw Codex patches, command output, or full replacement documents in
  chat.
- If changes are captured, the provider response text sent to React is only:
  "Preparé una propuesta. Revísala en el documento." The renderer must never
  receive provider prose plus proposal cards for Codex edits.
- If Codex attempted unsupported delete/rename: include one short note after the
  proposal sentence only when there is no persistent proposal-card error that
  already communicates it.
- If no changes are captured: show Codex's concise final answer.

## Failure States

- Codex disconnected and no API key: show a setup error with both options.
- Codex app-server unavailable before `thread/start` is sent and API key exists:
  fallback to OpenAI API provider.
- Codex app-server unavailable after turn start: show a retryable runtime error;
  do not fallback silently.
- Codex returns no completion: request-timeout error.
- Patch cannot be parsed or applied: do not create a corrupt proposal; show a
  concise failure and log diagnostics.
- File changed between patch capture and proposal creation: use current file as
  base only if the patch applies cleanly to current content; otherwise fail the
  proposal creation and ask the user to retry.
- Direct write unexpectedly occurs: detect changed content when possible, create
  an error diagnostic, and do not claim the change is pending. This should be
  treated as a bug because approval requests should be declined.

## Security And Permissions

- Codex auth remains app-server managed under Iliad's app-scoped `CODEX_HOME`.
- Do not copy or print Codex tokens.
- Main process owns app-server communication.
- Renderer receives only sanitized account metadata, run events, and proposal
  records.
- Decline command execution approvals in v1.
- Decline file-change approvals in v1 after capturing patch state.
- Do not pass OpenAI API keys into Codex app-server environment.
- Keep diagnostics redacted: paths may be logged when they are workspace
  relative; no tokens, auth files, raw env, or full document content in logs.

## Tests

Required unit tests:

- `CodexAppServerClient` dispatches server requests separately from responses
  and replies to file-change and command-approval requests.
- JSON-RPC ids work when they are strings or numbers.
- Codex provider starts a thread with real `cwd`, `workspace-write`,
  `on-request`, `approvalsReviewer: "user"`, and `ephemeral: true`.
- Codex provider starts a turn with text input and emits thinking deltas.
- Approval requests arriving before patch events do not finalize proposals
  early; proposals finalize on `turn/completed`.
- File-change patch events become `AgentDraftFileChange[]`.
- File-change approval requests are declined.
- Command approval requests are declined.
- Permission approval requests are declined or fail fast without granting access.
- Any command execution event fails the run in v1.
- Update patch conversion reads real workspace content, applies the diff in
  memory, hashes the base, and creates an edit proposal.
- Add patch conversion creates a create-file proposal for safe Markdown paths.
- Delete/rename changes are skipped with a clear note.
- Unsafe paths are rejected.
- Event path and diff header path mismatch is rejected.
- Malformed or context-mismatched unified patches do not create proposals.
- Provider selection chooses Codex when connected, OpenAI API when Codex is not
  connected, and no silent fallback after a Codex turn starts.
- Chat can send with connected Codex even when no OpenAI API key is configured.
- Proposal source is `codex_app_server`.

Required local verification:

- `npm test -- --run`
- `npm run typecheck`
- `npm run build`

Manual smoke, if account/rate limits permit:

- Connect Codex.
- Ask for a small edit to an active Markdown file.
- Confirm the real file is not changed before review acceptance.
- Confirm the document-native diff appears.
- Accept one hunk and confirm only that change writes to disk.
- Reject another proposal and confirm no write occurs.

## Review Panel

Use three reviewers before implementation:

- Codex runtime reviewer: JSON-RPC protocol, approvals, event ordering,
  provider fallback.
- Proposal/diff reviewer: patch parsing, path safety, stale protection,
  proposal mapping.
- Minimal UX reviewer: settings copy, chat cleanliness, failure messages.

## Review Feedback

- Codex runtime/protocol reviewer: accepted string/number JSON-RPC ids, full
  JSON-RPC approval envelopes, text input shape, object-shaped turn sandbox
  policy, `change.kind.type`, approval-before-patch ordering, command-event
  fail-fast behavior, before-`thread/start` fallback boundary, permission
  approval handling, and deriving `thinking_done` from item/turn completion.
- Proposal/diff reviewer: accepted strict JSON-RPC request handling, new
  `codex_app_server` source type, source injection into proposal creation,
  strict unified-diff parsing, event/header path validation, pure-add handling,
  and delete/rename rejection.
- Minimal UX reviewer: accepted shorter settings copy, no OpenAI API-key send
  gate when Codex is connected, capped thinking display, and a sanitized Codex
  provider response whenever proposals are created.
