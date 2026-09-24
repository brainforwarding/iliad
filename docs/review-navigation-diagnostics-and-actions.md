# Review Navigation Diagnostics And Accept/Reject Controls

This document records the changes made to diagnose intermittent review-navigation jumps and to replace ambiguous review controls with explicit accept/reject actions.

> **Current state (2026-09-24).** The internal agent, its assistant panel and
> proposal cards were removed (ADR-0021). Review now covers outside changes
> only; the review hook is `src/app/useOutsideReview.ts` and the logging helper
> is `src/review/reviewDebug.ts`. Outside edits use **Keep / Restore** per
> chunk and **Keep all / Restore all** per file and in the tree strip;
> creates use **Keep file / Move to Trash** and deletions **Confirm deletion /
> Restore file** (spec `specs/2026-09-24-iliad-writing-surface.md`, V6). The
> Accept/Reject labels below are history. Renderer events tied to assistant
> runs no longer exist.

## Context

The observed bug was: after several files change, the user can move between changed files, but occasionally the app returns to another changed file. The right next step was to stop guessing and add logs at the state transitions that can change the active document or active review target.

The UI concern was separate but related: a `Review` button was ambiguous and sometimes did not behave usefully. The requested model was:

- global/pending-review controls: `Accept all` and `Reject all`;
- editor controls for the file currently in view: `Accept changes` and `Reject changes`;
- inline per-change controls should use the same accept/reject language.

## Files Added

### `src/review/reviewDebug.ts` (then `src/assistant/reviewDebug.ts`)

Added a small logging helper:

- `logReviewNavigation(event, details)`
- Logs with the prefix `[review-nav]`.
- Enabled automatically in dev builds.
- Enabled in packaged builds when:

```js
localStorage.setItem("iliad.debug.reviewNavigation", "1")
```

Disable packaged-build logging with:

```js
localStorage.removeItem("iliad.debug.reviewNavigation")
```

## Navigation Instrumentation

### `src/app/useOutsideReview.ts` (then `src/app/useAgentProposals.ts`)

Added logging around the central review-target state machine:

- `active_file_changed`
  - logs previous file path, current file path, and active relative path.
- `active_file_cleared_review_target`
  - logs when normal active-file navigation clears the current review target.
- `review_action_start`
  - logs file/hunk/proposal accept/reject operations.
- `review_action_finish`
  - logs completed review actions.
- `review_action_error`
  - logs review action failures.
- `review_action_blocked`
  - logs when another review action is already in flight.
- `select_target_start`
  - logs every explicit review-target selection request.
- `select_target_refetch_proposals`
  - logs when the proposal is not in renderer state and the app refetches proposals.
- `select_target_invalid`
  - logs missing proposal/file/workspace mismatches.
- `select_target_flush_save`
  - logs when selecting a review target requires saving first.
- `select_target_missing_edit_node`
  - logs edit reviews whose file cannot be found in the tree.
- `select_target_open_edit_node`
  - logs review selection that opens a different file.
- `select_target_open_edit_node_failed`
  - logs when that open did not produce a Markdown document.
- `select_target_reveal_edit`
  - logs reveal requests for edit reviews.
- `select_target_reveal_create`
  - logs reveal requests for proposed new files.
- `select_target_open_delete_node`
  - logs delete-review selection that opens a file.
- `select_target_open_delete_node_failed`
  - logs failed delete-review opens.
- `select_target_set`
  - logs the final `setAgentReviewTarget` decision.
- `select_target_clear_requested`
  - logs explicit clearing of review target.

### `src/App.tsx`

Added logs around app-level navigation signals:

- `manual_review_target_change`
  - user explicitly selected a pending review target.
- `external_capture_active_file_target`
  - external-change capture selected the active file as a review target.
- `file_tree_open_node`
  - user opened a real file-tree node.
- `file_tree_open_pending_change`
  - user opened a pending review item from the file tree.
- `bulk_accept_pending_changes_start`
  - sidebar bulk keep started (now `Keep all`).
- `bulk_accept_pending_changes_finish`
  - sidebar bulk keep finished.
- `bulk_reject_pending_changes_start`
  - sidebar bulk restore started (now `Restore all`).
- `bulk_reject_pending_changes_finish`
  - sidebar bulk restore finished.

## Control Behavior Changes

### File Tree Pending Review Strip

Files changed:

- `src/App.tsx`
- `src/components/FileTree.tsx`
- `src/i18n/strings.ts`
- `tests/components/FileTreePendingReview.test.tsx`
- `tests/i18n/writingAssistsCopy.test.ts`

What changed:

- Replaced the file-tree pending strip action labels:
  - old: `Review`
  - old: `Restore all...` / `Discard all...`
  - new: `Accept all`
  - new: `Reject all`
- Replaced the old "jump to first pending review target" behavior.
- `Accept all` now iterates `reviewQueue.visibleItems` and calls `applyAgentProposalFile` for each visible pending review item.
- `Reject all` now iterates `reviewQueue.visibleItems` and calls `rejectAgentProposalFile` for each visible pending review item.
- Both bulk actions mark editor navigation during an active run and log their start/end.

This removes a navigation route from that strip. The strip no longer moves the user into a different changed file just to review; it directly accepts or rejects the pending set.

### Editor Review Toolbar And Inline Controls

Files changed:

- `src/i18n/strings.ts`
- `src/app/useOutsideReview.ts` (then `src/app/useAgentProposals.ts`)
- Existing editor wiring in `src/components/EditorPane.tsx` consumes these labels.

What changed:

- Top editor review toolbar for the current file now always says:
  - `Accept changes`
  - `Reject changes`
- The partial-review fallback label also says:
  - `Reject changes`
- Inline hunk controls now say:
  - `Accept changes`
  - `Reject changes`

The intent is that editor-surface actions are scoped to the file/change currently visible, while sidebar actions are bulk actions. (Superseded: the current labels are the specialized ones listed at the top of this document.)

## How To Capture The Next Repro

1. Open DevTools for the app.
2. In a dev build, logs are already enabled.
3. In a packaged build, run:

```js
localStorage.setItem("iliad.debug.reviewNavigation", "1")
```

4. Clear the console.
5. Have an outside tool (Claude Code, Codex, a script) change several files.
6. Navigate through changed files the way that previously caused the jump.
7. If the app jumps to another file, copy all console lines beginning with:

```text
[review-nav]
```

The most useful events to look for are:

- `external_capture_active_file_target`
- `manual_review_target_change`
- `file_tree_open_pending_change`
- `select_target_open_edit_node`
- `select_target_set`
- `active_file_cleared_review_target`

Those should show whether the jump came from external-capture auto-targeting, a file-tree pending item click, or active-file/review state reconciliation.

## Verification

Focused tests run:

```sh
npm test -- tests/components/FileTreePendingReview.test.tsx tests/i18n/writingAssistsCopy.test.ts
```

Result:

- the focused test files passed (at the time, together with the removed assistant card test).

Typecheck run:

```sh
npm run typecheck
```

Result:

- renderer TypeScript passed;
- Electron TypeScript passed.

Earlier full-suite verification after the main change set:

```sh
npm test
```

Result:

- 94 test files passed.
- 759 tests passed.

## Notes

The app repo already had a dirty worktree with review-related changes before this instrumentation and control update. This document describes the additional diagnostic logging and accept/reject UI changes layered on top of that existing review work.
