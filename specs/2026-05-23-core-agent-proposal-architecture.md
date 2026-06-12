# Core Agent Proposal Architecture Spec

Date: 2026-05-23
Status: reviewed spec

## Product Intent

Iliad's agent should behave like a workspace-aware editor assistant, not like a chat bot that prints patches into the transcript. The first architectural step is to separate user-facing conversation from edit artifacts.

For this spec, the user-visible outcome is:

- assistant messages stay clean and readable;
- raw `FULL_REPLACEMENT`, `NEW_DOCUMENT`, fenced diffs, and full Markdown payloads do not render in chat;
- model-produced edits become typed proposal records with ids, target files, statuses, and provenance;
- proposals can be accepted or rejected through app actions, not by copying text from chat;
- the data model supports future document-native green/red review, multi-file proposals, new documents, and subagent-produced artifacts.

The inline document diff UI is the next spec. This spec creates the architecture it will use.

## Source Material

Internal research and prior specs:

- [Agent vision](../docs/agent-vision.md)
- [Doc-native review synthesis](../docs/research/doc-native-ai-review/synthesis-and-proposal.md)
- [Clean chat and edit artifact architecture](../docs/research/doc-native-ai-review/artifact-architecture.md)
- [Tabs and document lifecycle](../docs/research/doc-native-ai-review/tabs-and-document-lifecycle.md)
- [Agent context management](./2026-05-23-agent-context-management.md)
- [Agent panel v1 architecture](../docs/agent-panel-v1-architecture.md)
- [Source as contract](../docs/source-as-contract.md)

Current implementation:

- [electron/agent/openaiResponses.ts](../electron/agent/openaiResponses.ts)
- [electron/agent/agentService.ts](../electron/agent/agentService.ts)
- [electron/agent/types.ts](../electron/agent/types.ts)
- [electron/ipc/agent.ts](../electron/ipc/agent.ts)
- [electron/preload.ts](../electron/preload.ts)
- [src/components/AssistantPanel.tsx](../src/components/AssistantPanel.tsx)
- [src/App.tsx](../src/App.tsx)
- [src/types/iliad.ts](../src/types/iliad.ts)

External references:

- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling)
- [VS Code pending AI edits](https://code.visualstudio.com/docs/copilot/chat/review-code-edits)
- [Cursor diffs and review](https://docs.cursor.com/en/agent/review)

## Current Findings

The current implementation couples chat text and machine data:

- `openaiResponses.instructions()` asks the model to include a fenced diff and a `FULL_REPLACEMENT:` Markdown block when proposing an active-file edit.
- `extractFullReplacement()` and `extractNewDocument()` regex-parse those transport sections from the assistant's visible text.
- `AgentRunResponse.text` still contains the transport sections.
- `AssistantPanel` renders `result.text` directly in the transcript, then renders patch/new-document cards.
- `reviewTarget` lives inside `AssistantPanel`, so review state is tied to the transcript and panel lifecycle.
- `AgentPatchProposal` and `AgentCreateDocumentProposal` are separate single-file shapes. They cannot represent one run that touches several files.

This is the root of the current bad UX: the app is treating the model's transport format as user-facing prose.

## Goals

- Introduce a provider-neutral `AgentChangeProposal` aggregate.
- Store proposals in Electron main process, scoped by workspace.
- Return clean assistant text plus proposal ids from `agent:start-run`.
- Keep model transport data out of the rendered transcript and future chat history.
- Preserve current review-before-write safety.
- Keep existing file-level apply behavior working while moving it onto proposal ids.
- Support existing-file edits and new Markdown document creation in the same proposal model.
- Track proposal and file statuses: pending, applied, rejected, stale, and failed.
- Retain base-hash validation before applying edits to existing files.
- Keep path safety for generated new Markdown files.
- Leave the system ready for the second spec's document-native inline review layer.

## Non-Goals

- No CodeMirror green/red inline review in this spec.
- No hunk-level accept/reject yet.
- No full tabs implementation.
- No direct writes from the model without user approval.
- No multi-agent runtime or visible subagent manager.
- No workspace search, file-read tools, RAG, or hidden broad context expansion.
- No durable chat history redesign beyond keeping proposal transport out of assistant messages.
- No external provider deployment changes.
- No separate proposal types for rubrics, handouts, deck outlines, or other
  course-material categories. They are Markdown document proposals.

## Architecture Decision

Use a two-channel agent contract:

1. `assistantMessage`: user-facing prose only.
2. `proposals`: typed edit artifacts.

The renderer must never parse edits from rendered assistant text. The provider layer can still use a temporary legacy parser internally, but it must normalize parsed edits into typed proposals before returning data to React.

In the short term, keep the existing OpenAI marker prompt as a legacy adapter because it is already working and reduces provider migration risk. Strip its transport sections before UI render. In a follow-up provider hardening pass, replace the marker adapter with OpenAI Structured Outputs or a strict `propose_document_changes` tool.

This staged choice lets us fix the trust-breaking UI now without blocking on model/schema compatibility details.

## Proposal Model

Add a single aggregate:

```ts
type AgentProposalStatus =
  | "pending"
  | "partially_applied"
  | "applied"
  | "rejected"
  | "stale"
  | "failed";

interface AgentChangeProposal {
  id: string;
  runId: string;
  responseId?: string;
  workspaceRoot: string;
  title: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
  model: string;
  source: {
    kind: "openai_response" | "legacy_marker_adapter" | "tool_call" | "subagent";
    agentName?: string;
    parentRunId?: string;
  };
  status: AgentProposalStatus;
  files: AgentProposalFileChange[];
}
```

File changes:

```ts
type AgentProposalFileStatus =
  | "pending"
  | "applied"
  | "rejected"
  | "stale"
  | "failed";

type AgentProposalFileChange = AgentEditFileProposal | AgentCreateFileProposal;

interface AgentEditFileProposal {
  id: string;
  kind: "edit_file";
  status: AgentProposalFileStatus;
  relativePath: string;
  baseHash: string;
  baseContent: string;
  replacement: string;
  unifiedDiff: string;
  error?: string;
}

interface AgentCreateFileProposal {
  id: string;
  kind: "create_file";
  status: AgentProposalFileStatus;
  relativePath: string;
  content: string;
  unifiedDiff: string;
  error?: string;
}
```

Notes:

- `replacement` remains whole-file in this spec because hunk-level review is next.
- `baseContent` is stored so the next spec can render document-native red/green review after restart without rehydrating from Git or raw unified diffs.
- `files[]` supports multi-file proposals even if the first adapter produces at most one edit and one create file.
- `source.kind` allows future subagents to produce the same artifacts without changing the UI.
- `workspaceRoot` stays in the stored record but is not shown in the UI.
- File changes store `relativePath`, not absolute local paths. Apply code derives the absolute path from `workspaceRoot + relativePath` and revalidates it.

## Proposal Store

Add an Electron main-process store:

- File path: `${app.getPath("userData")}/assistant/proposals.json`.
- Scope reads by `workspaceRoot`.
- Store proposal records, including full `baseContent`, `replacement`, and generated document `content`. This is user document content, so it stays local in app `userData`.
- Do not store API keys, raw provider JSON, raw provider reasoning, or hidden provider state.
- Keep a bounded history, initially the latest 100 terminal proposal records across workspaces. Never evict `pending`, `partially_applied`, `stale`, or `failed` proposals without a user-facing cleanup rule.
- Use safe JSON read fallback: if the file is missing or malformed, return an empty list and overwrite on next write.
- Serialize read-modify-write operations in the main process so simultaneous run/apply/reject actions cannot lose updates.
- Persist atomically: write to a temporary file, then rename it over `proposals.json`.

Required methods:

- `listProposals(workspaceRoot): AgentChangeProposal[]`
- `getProposal(workspaceRoot, proposalId): AgentChangeProposal | null`
- `saveProposal(proposal): AgentChangeProposal`
- `applyProposalFile(workspaceRoot, proposalId, fileId): ApplyAgentProposalFileResponse`
- `rejectProposalFile(workspaceRoot, proposalId, fileId): AgentChangeProposal`
- `rejectProposal(workspaceRoot, proposalId): AgentChangeProposal`

Status rules:

- A proposal starts `pending`.
- Status is derived from file statuses after every mutation.
- If all files are `applied`, proposal status is `applied`.
- If all files are `rejected`, proposal status is `rejected`.
- If any file is `applied` and at least one other file is not `applied`, proposal status is `partially_applied`.
- If any file is `stale` and no file is `applied`, proposal status is `stale`.
- If any file is `failed` and no file is `applied` or `stale`, proposal status is `failed`.
- Otherwise, proposal status is `pending`.
- `rejectProposal` rejects only mutable files: `pending`, `stale`, or `failed`. It never rewrites or reclassifies `applied` files.
- Applying an already `applied` file returns idempotently with the current proposal and file result omitted.
- Rejecting an already `rejected` file returns idempotently with the current proposal.
- Applying a `rejected` file throws a clear state error.
- Provider/API failure does not create a proposal.
- Files become `failed` for unexpected filesystem or persistence failures where the proposal can still be updated with an actionable error.
- Generated-file path collisions are `stale`, not overwrite prompts.

## IPC Contract

Extend `window.iliad.agent` with:

- `listProposals(workspaceRoot)`
- `applyProposalFile({ workspaceRoot, proposalId, fileId })`
- `rejectProposalFile({ workspaceRoot, proposalId, fileId })`
- `rejectProposal({ workspaceRoot, proposalId })`

Change `startRun` response to:

```ts
interface AgentRunResponse {
  runId: string;
  responseId?: string;
  text: string;
  proposalIds: string[];
  proposals: AgentChangeProposal[];
  error?: AgentError;
}
```

For compatibility during implementation, legacy `patch` and `newDocument` fields may remain temporarily but should not be used by new UI code.

Define apply response:

```ts
type ApplyAgentProposalFileResponse =
  | {
      kind: "edit_file";
      proposal: AgentChangeProposal;
      fileId: string;
      status: AgentProposalFileStatus;
      content?: string;
    }
  | {
      kind: "create_file";
      proposal: AgentChangeProposal;
      fileId: string;
      status: AgentProposalFileStatus;
      file?: FileTreeNode;
      content?: string;
    };
```

`content` and `file` are present only when a write actually happened. Idempotent already-applied responses return the updated proposal/status without rewriting.

## Provider Boundary

### Immediate Implementation

Keep the existing marker prompt internally, but change the provider result:

- Extract edit and create-file proposals from provider text.
- Return clean assistant text plus draft file changes from `openaiResponses.ts`.
- Normalize drafts into `AgentChangeProposal` records in `AgentService`, where ids, source, timestamps, model, base hash, `baseContent`, statuses, and persistence are assigned.
- Strip all transport sections from `text` before returning to UI.
- If the stripped text is empty but proposals exist, return a concise fallback such as `I prepared changes for review.`
- Do not include stripped transport text in `chatMessages` for later turns.
- The renderer stores and resends only sanitized assistant text in transcript history.

The marker sections to strip:

- fenced ```diff blocks generated only for review, and only when a valid proposal was parsed from the same response;
- `FULL_REPLACEMENT:` plus its Markdown code block;
- `NEW_DOCUMENT:` plus its Markdown code block.

### Future Provider Hardening

Move from marker parsing to OpenAI Structured Outputs or a strict tool:

```ts
{
  assistantMessage: string;
  proposals: Array<
    | { kind: "edit_file"; relativePath: string; replacement: string; summary: string }
    | { kind: "create_file"; relativePath: string; content: string; summary: string }
  >;
}
```

The model must not supply `baseHash`, ids, timestamps, statuses, absolute paths, or source metadata. App code stamps those fields from the context snapshot and provider call result. This future change should not require UI changes because the UI consumes normalized `AgentChangeProposal` records.

## Renderer Behavior

### App Ownership

Proposal state should live above `AssistantPanel`, ideally in `App` or an app-level hook, because it affects:

- assistant transcript proposal references;
- future topbar or file-tree pending-review badges;
- file creation and tree refresh;
- active document reload after apply;
- workspace changes.

For this spec, implement the smallest practical version:

- load proposals for the current workspace when the workspace opens;
- refresh proposals after `startRun`, apply, and reject actions;
- store proposal records and active review target in app/workspace state;
- pass proposal ids, proposal summaries, selected review target, and action callbacks to `AssistantPanel`;
- keep `AssistantPanel` responsible for rendering transcript entries and invoking callbacks, not for owning durable proposal state.

Workspace-switch behavior:

- clear active review target;
- ignore or cancel in-flight runs that were started for the old workspace;
- reload proposals for the new workspace;
- prevent apply/reject calls when the proposal workspace does not match the active workspace.

### Assistant Panel

The assistant transcript should render:

- user message text;
- clean assistant prose;
- compact proposal controls, not proposal content.

Allowed temporary control:

```text
Pending changes
2 files
[Review] [Discard]
```

Not allowed:

- raw unified diff in the transcript;
- complete Markdown replacement in the transcript;
- `FULL_REPLACEMENT` or `NEW_DOCUMENT` labels;
- new document body dumped directly into chat.

The existing review drawer may remain as a temporary review surface until the document-native UI spec replaces it. It should read from `AgentChangeProposal`, not from legacy `AgentPatchProposal` or `AgentCreateDocumentProposal`.

Pending persisted proposals must be visible after app restart, panel close/reopen, or New Chat. Show them as a compact `Pending changes` section in the assistant panel, separate from transcript messages. New Chat clears conversational entries but does not discard stored proposals.

`Discard` means persisted rejection. It is not a local hide action. If a proposal has already-applied files, Discard rejects only remaining mutable files and leaves applied files applied.

The temporary review drawer is a review surface, not a chat entry. It may show file-scoped unified diffs or generated document content for review, but it must not append that content to the transcript. Closing the drawer only hides it; it does not reject or mutate the proposal.

## Apply And Reject Behavior

### Existing File Edit

On apply:

1. Read the current file from disk.
2. Hash it.
3. Compare with proposal `baseHash`.
4. If hashes differ, mark file `stale`, store the error, and return or throw a user-facing stale result without writing.
5. If hashes match, write `replacement`.
6. Mark file `applied`.
7. Recompute proposal aggregate status.
8. Return written content so the active editor can reload if it is showing that file.

On reject:

1. Mark file `rejected`.
2. Recompute proposal aggregate status.
3. Do not write to disk.
4. If persistence fails, return a failure error and leave in-memory state unchanged when possible.

### New Markdown File

On apply:

1. Validate `relativePath` is a relative Markdown path.
2. Reject hidden path segments, `.` / `..`, absolute paths, duplicate paths, and files outside workspace.
3. If the target path already exists, mark file `stale`, store an error, and do not overwrite.
4. Create parent directories as needed.
5. Write the proposed content.
6. Mark file `applied`.
7. Refresh the file tree and open the new file.

On reject:

1. Mark file `rejected`.
2. Do not create anything.

Failures:

- Missing proposal or file ids return a clear error and do not mutate other proposals.
- Invalid generated path marks that file `failed` with an error.
- Filesystem permission/write errors mark the file `failed` when the proposal record can be updated.
- If JSON persistence itself fails after a successful disk write, surface an error immediately and refresh proposals from disk on the next list call. Do not attempt a second file write automatically.

## UX States

Empty:

- No proposal controls shown.
- If persisted pending proposals exist, show the compact `Pending changes` section even if the transcript is empty.

Run with no proposal:

- Render only clean assistant answer.

Run with proposal:

- Render clean assistant answer and one compact `Review changes` control.
- If the assistant answer is empty after sanitization, use fallback copy.

Review:

- Temporary drawer can show the file-level unified diff or new document content.
- Apply and discard actions update the stored proposal.
- Closing the drawer hides it only.

Applied:

- Show a concise status row such as `Applied`.
- Remove or dim the proposal control.

Rejected:

- Remove or dim the proposal control.
- Rejected persisted proposals do not appear in the default pending section.

Stale:

- Show actionable error: `This document changed after the proposal was created. Ask the agent to regenerate it.`
- Keep the proposal visible until the user discards it.

Failed:

- Show stored `error` with an actionable retry, regenerate, or discard path when possible.

Provider error:

- Existing normalized errors remain.
- No proposal record is created.

## Security And Privacy

- Do not store OpenAI API keys in proposal records.
- Do not store raw provider JSON unless a future explicit diagnostics mode is added.
- Do not display workspace absolute paths in assistant transcript controls.
- Persisted proposal records do contain user Markdown content: base snapshots, replacements, and generated documents. Keep them local in app `userData` and bound retention.
- Preserve existing generated-document path safety checks.
- Only send active-file content to the provider in this spec.
- Do not claim workspace-wide awareness until file-read/search tools exist.

## Rollout

This is an in-repo Electron app change with no database migrations.

Branch flow:

- worktree branch: `codex/core-agent-architecture`
- production branch: `master`
- no development branch is present

Deployment:

- No `.github` workflows or deploy provider config are present.
- Verification is local build/typecheck plus git push to `master` when ready.

## Required Tests

Local checks:

- `npm run typecheck`
- `npm run build`

Manual/electron smoke checks where feasible:

- Ask a no-edit question: transcript contains only clean prose.
- Ask for a file edit: transcript does not contain `FULL_REPLACEMENT`, fenced diff, or full Markdown replacement; proposal appears as compact review control.
- Apply an edit: file writes only after approval and active editor reloads.
- Reject an edit: no file write occurs and proposal status changes.
- Ask for a new doc: transcript does not dump the new doc; proposal can be applied to create the file.
- Stale edit: modify the file after proposal creation, then apply; app reports stale state and does not overwrite.
- Restart or reopen panel after proposal creation: pending proposal is still visible.
- New Chat after proposal creation: transcript clears, pending proposal remains visible.
- Generated-file path collision: proposal file becomes stale and no overwrite occurs.
- Reject/discard: persisted status changes, and the proposal is no longer shown as pending.

Code-level checks to add if practical:

- provider sanitizer removes legacy transport sections;
- proposal store persists and lists proposals by workspace;
- proposal status recomputes correctly after apply/reject.
- apply response returns updated proposal and file result data.

## Open Questions

- Should rejected proposals remain visible in the default assistant panel or only in a future history view?
- Should the legacy `patch` and `newDocument` response fields be removed immediately or after the document-native UI spec? This spec recommends keeping them only if useful for incremental typing, but new code should not depend on them.
