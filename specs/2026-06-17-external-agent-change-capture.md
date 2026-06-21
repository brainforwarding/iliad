# External Agent Change Capture Spec

Date: 2026-06-17
Status: reviewed spec

## Product Intent

Iliad should let writers use external agents with the same safety model as the built-in agent. If Claude Code, Codex CLI, Cursor, another automation tool, or a human collaborator edits Markdown files inside the workspace, Iliad should be able to turn those disk changes into reviewable proposals instead of silently showing stale editor buffers or immediately accepting outside writes.

The user-facing outcome:

- the user can start an explicit external-agent capture session;
- Iliad records the current Markdown state of the workspace;
- external tools can edit files on disk normally while the session is active;
- Iliad detects Markdown edits and new Markdown files after the session;
- detected changes appear in the same proposal/review UI used by the built-in agent;
- the workspace is restored to its pre-capture state so the user can accept or reject changes through Iliad;
- stale editor buffers are avoided for changes captured by this workflow.

## Current Findings

The app already has most of the required review machinery:

- `AgentDraftFileChange` is normalized into `AgentChangeProposal` by `electron/agent/markdownChangeContract.ts`.
- `AgentProposalStore` persists proposals and applies/rejects files with stale checks.
- `useAgentProposals` loads applied proposal content into the active editor when the active file matches.
- The Codex provider already snapshots Markdown files, reconciles disk changes, converts them to draft file changes, and restores the original disk state.

The current gap is that this disk-change capture is private to Codex provider execution. General external edits are not represented as proposals. The workspace watcher only refreshes the file tree for structural events and ignores normal file content change events.

## Goals

- Add an explicit capture mode for external agent changes.
- Reuse the existing `AgentChangeProposal` model and review UI.
- Reuse/generalize the existing Markdown snapshot, reconcile, and restore logic used by Codex.
- Support changed existing Markdown files and newly created Markdown files.
- Keep user approval as the only path that commits captured edits into the workspace.
- Refresh the active editor to the restored/base content after capture if the active file was touched.
- Keep the feature local-first and provider-neutral.

## Non-Goals

- No automatic always-on interception of every external filesystem edit.
- No support for file deletes in the MVP. Deleted Markdown files are restored and reported as unsupported notes.
- No support for renames/moves in the MVP. They are treated as delete + create where safely detectable, with delete restored.
- No conflict UI beyond the existing proposal stale behavior.
- No non-Markdown file review.
- No direct external-agent orchestration or process launching.
- No multi-user realtime collaboration semantics.

## Architecture Decision

Use an explicit tracking session:

1. `External changes` tracking is enabled by default in the global writing assists menu.
2. Renderer flushes any pending editor save before asking main to start capture.
3. Main process resolves the current workspace from `workspaceSessionId` and captures a Markdown snapshot.
4. User runs any external agent/tool outside Iliad.
5. The workspace watcher detects a visible Markdown filesystem event.
6. Renderer debounces briefly so external agents can finish batched writes.
7. Renderer flushes any pending editor save again.
8. Main process captures the post-session Markdown state.
9. Main process converts disk differences into `AgentDraftFileChange[]`.
10. Main process validates that every touched path can still be restored without guessing.
11. Main process saves one `AgentChangeProposal` with `source.kind = "external_agent"` before destructive restore/removal.
12. Main process restores touched files to the original/base state.
13. Renderer merges the proposal and opens the normal review target.

This should not be implemented as a silent auto-refresh of the editor. External agent edits are review artifacts, not trusted document state.

Capture is a guarded editing mode. While capture is active, Iliad should avoid treating its own writes as external writes. MVP enforcement is:

- observing a workspace does not hold the shared mutation lease;
- the lease is acquired only while finalizing/restoring captured changes;
- tracking pauses while the active editor has unsaved local edits;
- tracking pauses while an Iliad agent run is active or mutable proposals are pending;
- no `loadDocument(...)` over unsaved local editor text;

## Data Model

Extend proposal source:

```ts
interface AgentProposalSource {
  kind:
    | "openai_response"
    | "legacy_marker_adapter"
    | "tool_call"
    | "subagent"
    | "codex_app_server"
    | "external_agent";
  agentName?: string;
  parentRunId?: string;
}
```

New main-process session response types:

```ts
interface ExternalAgentCaptureStartResponse {
  captureId: string;
  workspaceRoot: string;
  startedAt: string;
  markdownFileCount: number;
}

type ExternalAgentCaptureFinishResponse =
  | {
      status: "proposal";
      captureId: string;
      proposal: AgentChangeProposal;
      restoredRelativePaths: string[];
      restoredCreateRelativePaths: string[];
      unsupportedNotes: string[];
    }
  | {
      status: "empty";
      captureId: string;
      restoredRelativePaths: string[];
      restoredCreateRelativePaths: string[];
      unsupportedNotes: string[];
    }
  | {
      status: "unsupported_restored";
      captureId: string;
      restoredRelativePaths: string[];
      restoredCreateRelativePaths: string[];
      unsupportedNotes: string[];
    };
```

The proposal should use:

- `runId`: `external-agent-${captureId}`
- `model`: `"external-agent"`
- `responseId`: omitted
- `source`: `{ kind: "external_agent", agentName?: string }`
- `title`: existing `markdownChangeProposalTitle(...)`
- `summary`: existing `markdownChangeProposalSummary(...)`

## IPC Contract

Add APIs under `window.iliad.agent`:

```ts
startExternalCapture(request: {
  workspaceSessionId: string;
  agentName?: string;
}): Promise<ExternalAgentCaptureStartResponse>;

finishExternalCapture(request: {
  workspaceSessionId: string;
  captureId: string;
}): Promise<ExternalAgentCaptureFinishResponse>;

cancelExternalCapture(request: {
  workspaceSessionId: string;
  captureId: string;
}): Promise<{
  status: "canceled";
  captureId: string;
  restoredRelativePaths: string[];
  restoredCreateRelativePaths: string[];
  unsupportedNotes: string[];
}>;
```

Validation:

- renderer-supplied `workspaceRoot` is not trusted for this feature;
- every IPC handler must verify `isTrustedAgentIpcSender`;
- main resolves `workspaceSessionId` to the current active workspace for that window/session;
- capture id must exist and match the workspace;
- at most one active external capture per workspace/window in MVP;
- capture state is in-memory only; app restart cancels active captures.
- finalizing/restoring external changes must acquire the workspace mutation lease, but observing external changes must not block built-in Codex/App Server runs.

## Provider-Neutral Capture Module

Introduce a provider-neutral module based on the existing Codex snapshot/reconcile/restore mechanics. Required API shape:

```ts
captureMarkdownWorkspaceSnapshot(options: {
  workspaceRoot: string;
  activeFile?: {
    relativePath: string;
    content: string;
    baseHash: string;
  };
}): Promise<MarkdownSnapshot>;

compareMarkdownSnapshots(options: {
  before: MarkdownSnapshot;
  after: MarkdownSnapshot;
  sourceLabel: string;
}): MarkdownCaptureDiff;

validateMarkdownCaptureRestore(options: {
  snapshot: MarkdownSnapshot;
  drafts: AgentDraftFileChange[];
  deletedRelativePaths?: string[];
}): Promise<MarkdownRestorePlan>;

restoreMarkdownCapture(plan: MarkdownRestorePlan): Promise<MarkdownRestoreResult>;
```

Requirements:

- user-facing notes and errors must use the caller-provided `sourceLabel`, not hard-coded `Codex`;
- restore is two-phase: validate all touched paths first, then write/remove;
- restore result includes restored edit paths and restored create paths;
- if validation fails, no restore writes are attempted;
- if proposal persistence fails, no restore writes are attempted.

## Renderer UX

MVP placement:

- Add a global `External changes` toggle to the writing assists menu.
- Default the toggle to on.
- Do not render an external-capture control inside the chat/assistant panel.
- There is no separate `Review external changes` button. The document diff is the review surface.
- When external Markdown changes are detected, merge the returned proposal into `agentProposals` and auto-select the first review target.
- If a watcher event produces no Markdown changes, restart tracking silently.
- If only unsupported changes are detected and restored, show a distinct notice, not the empty-change notice.
- If unsupported notes exist, show a non-blocking notice. Full note rendering can come later.
- Turning the global toggle off finalizes any active capture once; if no external changes exist, tracking simply stops.

The top-level editor should not auto-accept disk changes from this flow. If a touched file is active, refresh it to the restored base content so the proposal diff aligns with the editor state.

## Capture Semantics

Supported:

- Existing Markdown file content changed.
- New Markdown file created under a visible, safe workspace path.

Unsupported in MVP:

- Existing Markdown file removed: restore original file; add unsupported note.
- Existing Markdown file replaced by directory/symlink/unsafe node: fail capture with a clear error.
- New hidden/unsafe file: ignore.
- Non-Markdown file changes: ignore.

Restore behavior:

- Validate the full restore plan before writing anything.
- Save the proposal before writing/removing restored paths.
- For edit drafts, if current disk content equals the captured replacement, write the base content back.
- For create drafts, if current disk content equals the created content, remove the new file.
- If a file changed again before restore, fail the finish operation rather than guessing.
- Turning tracking off with no changes clears the capture without saving a proposal.

## Active Editor Semantics

After a successful finish:

- If the active Markdown file is among restored edit paths, call `loadDocument(baseContent)` for that proposal file.
- If the active file is among restored create paths, clear the active file after tree refresh unless review navigation immediately opens the virtual pending review file.
- Always refresh the file tree after finish because created files may have been removed during restore and proposal pending nodes should be shown by the existing pending tree overlay.
- `loadDocument` must cancel pending autosave timers before replacing editor state, or the caller must flush/cancel pending saves before calling it.

## Testing

Main process/unit tests:

- Capturing no changes returns `empty`.
- Editing one Markdown file produces one `edit_file` proposal and restores base content.
- Creating one Markdown file produces one `create_file` proposal and removes the created file.
- Mixed edit/create changes produce one multi-file proposal.
- Deleting a Markdown file restores it and returns no proposal file for the delete.
- Capture fails if a changed file mutates again before restore.
- Capture validates all restore paths before any restore write occurs.
- Proposal persistence failure leaves external changes on disk.
- IPC rejects untrusted sender, stale/wrong `workspaceSessionId`, wrong active window, and cross-workspace `captureId`.
- Observing external changes does not block Codex runs.
- Finalizing external changes while a Codex run is active waits/retries instead of failing visibly.
- Local editor autosaves are not captured as external proposals.

Renderer/unit tests:

- The global `External changes` preference defaults on and is rendered in the writing assists menu.
- Markdown watcher events auto-finalize capture.
- Finish with a proposal merges proposals and selects review target.
- Finish with touched active file reloads restored base content.
- Tracking pauses or restarts around unsaved local editor changes.
- Finish with delete-only unsupported changes shows unsupported-restored copy, not empty-copy.

Manual QA:

1. Open a workspace and a Markdown file.
2. Verify `External changes` is enabled in the writing assists menu.
3. Edit the file in another editor.
4. Verify Iliad automatically shows a normal inline proposal diff.
5. Accept the proposal.
6. Verify the disk file now contains the external edit.

## Open Questions

- Should finished external captures appear anywhere outside pending proposal controls?
- Should the app allow a capture scope of active file only vs whole workspace?
- Should future versions support automatic capture when a known external agent process is launched from Iliad?
- How should unsupported notes be surfaced once there are multiple files?

## MVP Implementation Plan

1. Add provider-neutral snapshot/reconcile/restore helpers for external capture.
2. Add an `ExternalAgentCaptureService` or methods on `AgentService` to manage in-memory captures and save generated proposals.
3. Add IPC/preload/type contracts.
4. Add a default-on writing assists menu toggle.
5. On watcher-triggered finish, refresh tree, merge proposal, auto-select review target, and reload active file base content when needed.
6. Pause tracking around local editor saves, Iliad agent runs, and mutable pending proposals.
7. Add focused tests for service behavior and renderer behavior.
