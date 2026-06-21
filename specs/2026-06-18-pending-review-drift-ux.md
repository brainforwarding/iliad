# Pending Review Drift UX Spec

Date: 2026-06-18
Status: implemented

## Product Intent

Iliad should make review state feel trustworthy when external agents edit a workspace. If the app has pending proposals from a previous session, users must understand that those rows are review artifacts, not files currently present on disk. Users also need a direct way to clear stale review state without touching the real Markdown files.

The current behavior is technically defensible but poor UX: pending `create_file` proposals are rendered as green virtual rows in the file tree. After a restart, old external-agent proposals can look like newly created files, even when the actual workspace has moved on and those files no longer exist. Disabling external change capture stops future captures, but it does not clear existing proposals, which is easy to misread.

## Goals

- Make pending review state visible outside the assistant chat.
- Give users one obvious place to review or discard all pending changes for the current workspace.
- Keep the real filesystem untouched when discarding proposals.
- Clarify that the writing-assists toggle controls future external-change capture, not existing pending review state.
- Preserve the current review mechanics for individual proposed file creates and edits.
- Keep the change small enough to ship immediately.

## Non-Goals

- Do not delete, create, rename, or rewrite workspace Markdown files as part of clearing pending review state.
- Do not add full `delete_file` proposal support in this iteration.
- Do not add a complex proposal-management screen.
- Do not change the proposal persistence model.
- Do not silently discard persisted proposals on app startup.

## Current Findings

- `AgentProposalStore` persists proposals across restarts in app support data.
- `isVisiblePendingProposal(...)` treats proposals as visible when at least one file still has mutable review work.
- `buildPendingFileTreeChanges(...)` turns mutable proposal files into file-tree pending changes.
- `buildFileTreeDisplayNodes(...)` inserts `pending-create` virtual rows when a `create_file` proposal path is not present in the real tree.
- A missing file is the normal pre-acceptance state for a `create_file` proposal, so hiding every missing proposed file would break legitimate review.
- Existing UI has per-proposal `Discard` inside `AssistantPendingProposals`, but no file-tree-level summary or bulk discard action.

## UX Decision

Add a compact pending-review strip at the top of the file tree whenever the current workspace has mutable proposal files.

The strip should show:

- count of pending review items;
- a `Review` action that opens the newest pending review target;
- a `Discard all` action that rejects every mutable proposal in the current workspace.

This keeps the file tree as the right surface for workspace state while avoiding a heavy new screen. It also makes old green virtual rows understandable: they are pending review items below a visible pending-review summary.

Rename the global writing-assists toggle copy from generic `External changes` to capture-oriented copy:

- English: `Capture external edits`
- Spanish: `Capturar ediciones externas`

This wording makes clear that the toggle controls future capture. It does not promise to clear existing pending changes.

## Behavior

When `pendingReviewCount > 0`:

1. File tree renders a pending-review strip above the scrollable file list.
2. The strip remains visible when file-tree search or content search is open.
3. The count is based on all mutable file-level review changes in current workspace proposals, not only visible virtual rows. This avoids under-counting when the file tree deduplicates pending rows by path.
4. `Review` opens the newest mutable proposal file using the same review-target path as clicking a pending row.
5. `Discard all` rejects each unique mutable proposal in the current workspace.
6. Discarding all proposals only mutates proposal state; it must not touch workspace files.
7. Bulk discard must use a state-only reject path that does not call `flushSave()`. Saving an unsaved editor buffer would write Markdown to disk and violate the purpose of a drift cleanup.
8. The strip disappears after all mutable proposal files become applied/rejected/stale-free.

When `pendingReviewCount === 0`:

1. The file tree behaves as it does now.
2. No pending-review strip is shown.

## Data And API Changes

No backend data model changes are required.

Renderer-only prop additions:

```ts
FileTreeProps {
  pendingReviewCount: number;
  pendingReviewBusy?: boolean;
  onReviewPendingChanges: () => void | Promise<void>;
  onDiscardPendingChanges: () => void | Promise<void>;
}
```

The parent `App` already owns `agentProposals`, `handleManualReviewTargetChange(...)`, and proposal rejection, so it can implement both actions without new IPC.

`useAgentProposals` should expose a state-only proposal rejection helper for bulk discard. The existing user-facing `rejectAgentProposal(...)` may keep its `flushSave()` behavior for normal assistant-panel flows, but the file-tree bulk discard path must avoid editor saves.

Implementation note: the sidebar uses explicit grid rows. The pending-review strip adds another non-scroll row, so CSS must handle all combinations:

- header + tree;
- header + search + tree;
- header + pending-review strip + tree;
- header + search + pending-review strip + tree.

## Tests

Add or update tests for:

- pending file-tree display renders the pending-review summary when pending changes exist;
- `Discard all` invokes the handler once and does not require a real file node;
- bulk discard derives proposal ids from mutable `agentProposals`, not deduplicated `pendingTreeChanges`;
- bulk discard uses state-only rejection and does not call `flushSave()`;
- Spanish and English strings include the renamed external-capture toggle.

Implemented coverage:

- `tests/components/FileTreePendingReview.test.tsx`
- `tests/app/useAgentProposalsActions.test.ts`
- `tests/assistant/pendingReviewState.test.ts`
- `tests/i18n/writingAssistsCopy.test.ts`

## Future Work

Add first-class delete proposals:

- represent Markdown deletions as `delete_file`;
- show pending deletions as red file-tree rows or red badges on formerly existing files;
- render deletion diffs in the editor;
- accept delete by removing/restoring accordingly;
- reject delete by keeping/restoring the base file.

This is deliberately out of scope for this UX patch because delete support touches proposal persistence, apply/reject semantics, review rendering, and filesystem restore behavior.
