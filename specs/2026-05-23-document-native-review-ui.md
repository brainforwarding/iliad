# Document-Native Review UI Spec

Date: 2026-05-23
Status: reviewed spec

## Product Intent

AI edits should appear where the writing happens: in the Markdown document. The chat should remain clean and should not show raw diffs, full replacements, or generated document bodies. The review surface should use the familiar diff grammar:

- additions are green pending text;
- removals are red pending text;
- replacements show red old text plus green proposed text;
- generated new documents show as all-green pending documents;
- each change can be accepted or rejected;
- each file/document can be accepted or rejected as a whole.

This spec builds on the core proposal architecture in [2026-05-23-core-agent-proposal-architecture.md](./2026-05-23-core-agent-proposal-architecture.md). It defines the first document-native review UI and the minimal proposal-store extensions needed to support hunk-level review.

## Source Material

Internal research:

- [Doc-native synthesis](../docs/research/doc-native-ai-review/synthesis-and-proposal.md)
- [CodeMirror inline diff research](../docs/research/doc-native-ai-review/codemirror-inline-diff.md)
- [Diff UX patterns](../docs/research/doc-native-ai-review/diff-ux-patterns.md)
- [Tabs and document lifecycle](../docs/research/doc-native-ai-review/tabs-and-document-lifecycle.md)

Current implementation:

- [src/components/EditorPane.tsx](../src/components/EditorPane.tsx)
- [src/editor/visualMarkdown/index.ts](../src/editor/visualMarkdown/index.ts)
- [src/App.tsx](../src/App.tsx)
- [src/components/AssistantPanel.tsx](../src/components/AssistantPanel.tsx)
- [electron/agent/proposalStore.ts](../electron/agent/proposalStore.ts)
- [electron/agent/types.ts](../electron/agent/types.ts)
- [src/types/iliad.ts](../src/types/iliad.ts)

External references:

- [CodeMirror decorations](https://codemirror.net/examples/decoration/)
- [CodeMirror reference](https://codemirror.net/docs/ref/)
- [VS Code AI edit review](https://code.visualstudio.com/docs/copilot/chat/review-code-edits)
- [Cursor diffs and review](https://docs.cursor.com/en/agent/review)
- [GitHub Desktop review changes](https://docs.github.com/en/desktop/making-changes-in-a-branch/committing-and-reviewing-changes-to-your-project-in-github-desktop)

## Current State

Iliad now has clean chat plus persisted proposal records:

- `AgentChangeProposal` records live in the Electron proposal store.
- Existing-file proposals contain `baseContent`, `baseHash`, `replacement`, `unifiedDiff`, status, and path metadata.
- Create-file proposals contain target path, generated content, `unifiedDiff`, and status.
- `AssistantPanel` renders a compact `Pending changes` section and a temporary drawer with full diff/content.
- `EditorPane` renders one CodeMirror editor with `visualMarkdown(...)` and no AI review decorations.

The next problem is that review still happens outside the document, in a drawer. The user should instead inspect and approve changes directly in the editor.

## Goals

- Render pending AI edits directly in `EditorPane`.
- Keep the canonical Markdown buffer unchanged until the user accepts a hunk or file.
- Add hunk-level accept/reject for existing-file edit proposals.
- Add file-level accept/reject all from the editor review toolbar.
- Show generated new Markdown files as virtual all-green pending documents before file creation.
- Keep assistant chat and transcript free of raw diff/content payloads.
- Preserve base-hash and path-safety guarantees before writes.
- Make review state survive app restart through persisted proposal hunk statuses.
- Avoid tabs for this release.
- Keep UI minimal and aligned with Iliad's existing chrome typography.

## Non-Goals

- No full tab system.
- No side-by-side split diff.
- No word-level diff highlighting inside changed lines.
- No multi-file review drawer redesign beyond selecting which file to review.
- No model/provider changes.
- No workspace search, RAG, or subagents.
- No editing of pending green insertion text before acceptance.
- No conflict resolution or hunk rebasing beyond stale detection.

## Core UX

### Existing File Edit

When the user clicks `Review` on a pending edit proposal:

1. Iliad opens the target Markdown document in the normal editor if it is not already active.
2. The editor enters AI review mode for that proposal file.
3. Existing text that would be removed or replaced is shown with a soft red background.
4. Proposed inserted/replacement text is shown as soft green pending text near the affected block.
5. A compact review toolbar appears above the editor content:
   - file name
   - unresolved count, for example `3 changes`
   - previous / next controls
   - `Accept all`
   - `Reject all` before any hunk is accepted, then `Reject remaining`
6. Previous / next selects the active hunk.
7. Per-hunk `Accept` / `Reject` controls appear only for the active or hovered hunk.
8. Accepting a hunk writes that hunk into the document immediately.
9. Rejecting a hunk leaves the document unchanged and marks that hunk rejected.
10. Accepted and rejected hunks disappear from the editor review overlay.
11. When no mutable hunks remain, the proposal file leaves the pending section even if its terminal status is `partially_applied`.

File-level reject never rolls back already-accepted hunks. Once any hunk has been accepted, the label becomes `Reject remaining` so users do not expect a Git-style full rollback.

### Generated New Document

When the user clicks `Review` on a create-file proposal:

1. The editor switches to a virtual review document for the proposed path.
2. The editor header/toolbar labels it as `Pending document: <relative path>`.
3. File-tree selection remains unchanged.
4. The generated content is displayed as all-green pending text.
5. The editor is read-only for the virtual document.
6. A compact toolbar shows the proposed relative path and:
   - `Create`
   - `Discard`
7. Creating the document uses the existing proposal-store create-file apply path.
8. After creation, Iliad refreshes the file tree and opens the new real document.
9. Discarding rejects the proposal file and does not create anything.

Generated files should not appear as if they already exist in the file tree unless a future virtual-files section is added.

### Assistant Panel

The assistant panel remains a clean command/status surface:

- keep the compact `Pending changes` list;
- selecting `Review` focuses the editor review surface;
- remove the temporary raw `<pre>` review drawer for files that can be reviewed in the editor;
- keep errors/statuses compact;
- do not show raw unified diffs or generated file bodies in chat.

If the active review target is stale or failed, the panel can show the stored error in the pending card, but the document surface should not try to render unsafe changes.

## Hunk Model

Extend `AgentEditFileProposal` with persisted hunks:

```ts
type AgentReviewHunkStatus = "pending" | "accepted" | "rejected" | "stale";

interface AgentReviewHunk {
  id: string;
  status: AgentReviewHunkStatus;
  anchorLine: number;
  oldStartLine: number;
  oldLines: string[];
  newLines: string[];
}
```

Rules:

- Hunks are line-based in this release.
- Hunks are generated from `baseContent` and `replacement` when the proposal is created.
- Existing proposals without `hunks` can derive hunks lazily on first list/apply/review.
- Lazy derivation must persist immediately through `ensureReviewHunks`; do not regenerate ids/statuses on every list or review call.
- A hunk is a contiguous non-equal diff chunk from an LCS line diff.
- Common lines are not stored as hunks.
- Hunk ids must be stable for a proposal file, for example `${fileId}-hunk-${index + 1}`.
- Hunk statuses are persisted.
- Line numbers are 1-based.
- `oldStartLine` is the first old line affected by the hunk, or the insertion point for insertion-only hunks.
- `anchorLine` is where CodeMirror should display insertion widgets. For insertion at beginning of file, anchor before line 1. For insertion at end of file, anchor after the final line.

Line-based review is a deliberate v1 choice. Paragraph or Markdown-AST hunks can be added later, but line hunks map cleanly to current stored full-document proposals and are predictable for CodeMirror positions.

## Content Reconstruction

Hunk-level accept/reject needs deterministic reconstruction from proposal state.

For an edit-file proposal:

1. Ensure hunks are already persisted through `ensureReviewHunks`.
2. For each equal chunk, output the base lines.
3. For each hunk:
   - `accepted`: output `newLines`;
   - `rejected`: output `oldLines`;
   - `pending`: output `oldLines`;
   - `stale`: output `oldLines`.
4. Join reconstructed segments into the current expected document with byte-for-byte separator preservation.

Split/join rules:

- Preserve the dominant line separator from `baseContent`; if none exists, use `\n`.
- Preserve whether `baseContent` and `replacement` end with a trailing newline.
- Represent lines internally as `{ text, lineBreak }` segments rather than using plain `split("\n")` when reconstructing.
- All-pending reconstruction must equal `baseContent` exactly.
- All-accepted reconstruction must equal `replacement` exactly.

Before accepting or rejecting a hunk:

1. Read the current file.
2. Reconstruct the expected current document from stored hunk statuses.
3. If the current file differs from expected content, mark unresolved hunks stale and do not write.
4. Update the requested hunk status.
5. Reconstruct the next document.
6. Write the next document if content changed.
7. Recompute file and proposal status.

This avoids applying patches by fuzzy line positions and keeps hunk decisions deterministic.

## Status Rules

Add file-level `partially_applied` support:

```ts
type AgentProposalFileStatus =
  | "pending"
  | "partially_applied"
  | "applied"
  | "rejected"
  | "stale"
  | "failed";
```

Edit-file status is derived from hunk statuses:

- any failed file operation -> `failed`;
- any stale hunk and at least one accepted hunk -> `partially_applied`;
- any stale hunk and no accepted hunks -> `stale`;
- any pending hunk and at least one accepted hunk -> `partially_applied`;
- any pending hunk and no accepted hunks -> `pending`;
- all hunks accepted -> `applied`;
- all hunks rejected -> `rejected`;
- all hunks resolved with a mix of accepted and rejected -> `partially_applied`;
- otherwise -> `pending`.

Proposal status follows the existing aggregate reducer, updated to understand file `partially_applied`.

Pending visibility is based on mutable work, not status text:

- an edit file is pending-visible only if it has unresolved hunks (`pending` or `stale`) or a failed file operation that can be discarded;
- a create-file proposal is pending-visible only while its file status is `pending`, `stale`, or `failed`;
- an edit file with all hunks accepted/rejected is not pending-visible, even if its final status is `partially_applied`;
- the proposal is hidden from the default pending list when no files are pending-visible.

Create-file proposals do not need hunks in this release:

- `pending` -> waiting for create/discard;
- `applied` -> created;
- `rejected` -> discarded;
- `stale` -> path collision or no longer safe;
- `failed` -> unexpected write/path error.

## IPC Contract

Add hunk actions:

```ts
interface ResolveAgentProposalHunkRequest {
  workspaceRoot: string;
  proposalId: string;
  fileId: string;
  hunkId: string;
  decision: "accept" | "reject";
}

interface ResolveAgentProposalHunkResponse {
  proposal: AgentChangeProposal;
  fileId: string;
  hunkId: string;
  status: AgentReviewHunkStatus;
  content?: string;
}
```

Existing file-level methods continue:

- `applyProposalFile` means accept all pending hunks for edit files, or create generated file for create-file proposals.
- `rejectProposalFile` means reject all pending/stale/failed hunks for edit files, or discard generated file proposals.
- `rejectProposal` means reject all mutable files in the proposal.

Renderer methods:

- `window.iliad.agent.resolveProposalHunk(request)`

Full implementation surface:

- Electron and renderer type files define request/response types.
- `electron/ipc/agent.ts` registers `agent:resolve-proposal-hunk`.
- `electron/preload.ts` exposes `resolveProposalHunk`.
- `AgentService.resolveProposalHunk` delegates to the proposal store.
- `AgentProposalStore.resolveProposalHunk` performs validation, reconstruction, write, status update, and persistence.
- Resolving an already accepted/rejected hunk is idempotent and returns the current proposal.
- App must call `flushSave()` before `resolveProposalHunk`, `applyProposalFile`, and reject/discard actions that depend on current file content.

## Editor Integration

Add a sibling editor feature:

```text
src/editor/aiReview/
  diff.ts
  extension.ts
  types.ts
```

Do not add this logic to `visualMarkdown`.

Shared diff/reconstruction helpers should be duplicated in Electron and renderer for this release if necessary. Do not change TypeScript build topology just to share a tiny helper module.

### `diff.ts`

Pure helpers:

- `buildLineReviewHunks(baseContent, replacement, fileId)`
- `reconstructContent(baseContent, hunks)`
- `reviewHunksForDisplay(currentContent, file)`

Equivalent helpers are also needed in Electron for store writes. Keep behavior covered by smoke tests so duplicated helper logic cannot drift silently.

### CodeMirror Extension

The extension receives:

```ts
interface EditorReviewState {
  file: AgentEditFileProposal | AgentCreateFileProposal;
  currentContent: string;
  mode: "edit_file" | "create_file";
  onAcceptHunk?: (hunkId: string) => void;
  onRejectHunk?: (hunkId: string) => void;
  onAcceptFile: () => void;
  onRejectFile: () => void;
}
```

Implementation guidance:

- Use a direct `StateField` decoration source for review widgets and line/mark decorations.
- Use `WidgetType` for green inserted text blocks, deletion previews, and mini action controls.
- Interactive widgets must implement `ignoreEvent` intentionally so buttons click reliably without breaking editor focus.
- Widget callbacks must stay current across React reconfiguration.
- Do not mutate CodeMirror DOM directly.
- Keep review CSS class names distinct: `cm-ai-review-*`.
- Pass review-changed line ranges into `visualMarkdown` and skip visual Markdown replacements on those lines in this release.
- Do not enable line numbers.
- A narrow gutter is optional; defer it unless implementation is simple.

### Existing File Decoration Rules

For pending hunks:

- hunk with only `newLines`: show green insertion widget at the insertion anchor;
- hunk with only `oldLines`: mark the old line range red;
- hunk with both old and new lines: mark old line range red and show green replacement widget after it;
- show inline mini controls only on the active or hovered hunk.

Accepted/rejected hunks are not decorated.

If current editor content no longer matches reconstructed expected content, do not render hunks; show a stale/conflict notice and require regenerate or discard.

### Create File Decoration Rules

For create-file proposals:

- pass `EditorPane` a virtual display file/path and a virtual value equal to the proposed content;
- label the toolbar/header as `Pending document: <relative path>`;
- display all virtual content with green pending insertion styling;
- set CodeMirror read-only;
- suppress `onChange`;
- disable image paste/drop for virtual review;
- never autosave virtual review content.

## App State And Navigation

`App` owns active review target and proposal records.

Add derived state:

- `activeReviewFile`: selected proposal file record.
- `editorReview`: review data passed into `EditorPane`.
- `virtualReviewFile`: a lightweight pseudo file for create-file review, never persisted through normal autosave.

Review selection behavior:

- existing edit-file review opens the target file through normal `openNode` navigation before showing inline review;
- create-file review switches the editor into virtual review mode without changing `activeFile`;
- create-file review overrides the editor display file/value while keeping file-tree selection and active document state unchanged;
- closing/clearing review returns to the previous active file when reviewing a create-file proposal;
- workspace change clears active review and reloads proposals as already specified.

Autosave:

- Existing-file hunk acceptance calls `flushSave()`, writes through proposal-store hunk resolution, then reloads document content from the response.
- File-level accept/reject/discard calls `flushSave()` first when acting on an existing file.
- Manual typing while review is pending is allowed, but unresolved review overlay should become stale if the file diverges from expected content.
- Virtual create-file review is read-only and never autosaves.

## UI Copy

Add labels in English and Spanish:

- `reviewToolbar.changes(count)`
- `reviewToolbar.previous`
- `reviewToolbar.next`
- `reviewToolbar.acceptAll`
- `reviewToolbar.rejectAll`
- `reviewToolbar.rejectRemaining`
- `reviewToolbar.create`
- `reviewToolbar.discard`
- `reviewToolbar.stale`
- `reviewToolbar.acceptChange`
- `reviewToolbar.rejectChange`
- `reviewToolbar.pendingDocument`

Use compact labels. Avoid explanatory paragraphs in the UI.

## Styling

Use subdued diff colors:

- green insertion background: soft green, readable over editor background;
- red deletion background: soft red, readable over editor background;
- red deletion text may use subtle strikethrough only when it remains legible;
- controls use existing assistant/editor chrome typography and 6-8px radius;
- no large cards inside the editor;
- review toolbar is slim, sticky within the editor shell or placed just above CodeMirror content.

Do not introduce bright GitHub-code-review colors directly; Iliad is a writing tool.

## Failure States

- Stale existing edit: show compact stale notice; disable hunk accept; allow reject remaining/discard.
- Failed proposal file: show stored error; allow discard.
- Generated path collision: show stale/error state; do not overwrite.
- Missing target file: mark stale/failed and show error.
- Hunk already accepted/rejected: hunk action is idempotent or hidden.
- Workspace mismatch: no review rendered.

## Required Tests

Local commands:

- `npm run typecheck`
- `npm run build`
- `git diff --check`

Pure helper smoke tests:

- diff base -> replacement creates stable hunks;
- reconstruction with all pending equals base;
- reconstruction with all accepted equals replacement;
- mixed accepted/rejected reconstructs expected content;
- create-file review path does not write until file-level apply;
- stale current file blocks hunk acceptance.
- reconstruction preserves no trailing newline, one trailing newline, blank final lines, and CRLF input.
- repeated identical lines diff into stable hunks.
- insertion at start and end of file anchors correctly.
- mixed accepted/rejected hunks no longer appear in the default pending list.
- accepted plus stale hunk status remains visible as partially applied/stale work.
- resolving an already accepted/rejected hunk is idempotent.

Manual/Electron checks:

- Existing-file proposal shows red/green marks in the editor, not chat.
- Accept one hunk writes only that hunk and removes its overlay.
- Reject one hunk keeps document text unchanged and removes its overlay.
- Accept all applies remaining hunks.
- Reject all discards remaining hunks.
- Generated new document shows all-green pending content; Create writes the file and opens it.
- Pending proposal survives closing/reopening assistant panel.
- Manual edit during pending review causes stale/conflict state instead of overwriting.
- Hunk action after unsaved typing flushes first.

Frontend visual checks:

- narrow assistant panel remains clean;
- editor toolbar text fits without overlapping;
- inline controls do not resize paragraphs or cover text;
- green/red review styling remains readable in serif, sans, and mono editor fonts.
- visual Markdown rendering is skipped on changed lines so review marks are not hidden by image/link/table widgets.

## Rollout

This is a local Electron app change on the single production branch:

- feature branch/worktree: `codex/document-native-review-ui`;
- production branch: `master`;
- no development branch is present;
- no `.github` workflows or deploy provider config are present.

Ship after local verification and remote `master` push.

## Open Questions

- Should generated virtual documents be selectable/copyable before creation? Nice to have, but not required.
- Should file-tree badges be added in this release? Not required; the pending proposal section remains the review entry point.
- Should we add keyboard shortcuts for accept/reject current hunk? Defer.
