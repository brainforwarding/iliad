# Review Navigation Diagnostics And Accept/Reject Controls

This document records the changes made to diagnose intermittent review-navigation jumps and to replace ambiguous review controls with explicit accept/reject actions.

## Context

The observed bug was: after an agent changes several files, the user can move between changed files, but occasionally the app returns to another changed file. The right next step was to stop guessing and add logs at the state transitions that can change the active document or active review target.

The UI concern was separate but related: a `Review` button was ambiguous and sometimes did not behave usefully. The requested model was:

- global/pending-review controls: `Accept all` and `Reject all`;
- editor controls for the file currently in view: `Accept changes` and `Reject changes`;
- inline per-change controls should use the same accept/reject language.

## Files Added

### `src/assistant/reviewDebug.ts`

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

### `src/app/useAgentProposals.ts`

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

### `electron/agent/agentService.ts`

Added persisted main-process diagnostics for proposal actions. Renderer console logs are useful in dev, but packaged-window testing can lose them, and IPC failures such as `Proposal not found for this workspace` need evidence from the process that owns the proposal store.

The app now writes JSONL entries under:

```text
~/Library/Application Support/iliad-dev/logs/
```

For proposal action debugging, search for:

```text
agent.proposal_file.apply_started
agent.proposal_file.apply_finished
agent.proposal_file.apply_failed
agent.proposal_file.reject_started
agent.proposal_file.reject_finished
agent.proposal_file.reject_failed
agent.proposal.reject_started
agent.proposal.reject_finished
agent.proposal.reject_failed
```

Each entry includes safe identifiers and state only:

- workspace fingerprint;
- proposal id;
- requested file id;
- whether an external capture session was found;
- whether the proposal/file was found;
- source kind and metadata kind;
- proposal/file status;
- sanitized error details on failure.

It intentionally does not log Markdown content or absolute document paths.

Also exposed the existing file-level handlers from this hook so higher-level UI can call them directly:

- `applyAgentProposalFile`
- `rejectAgentProposalFile`

### `src/assistant/useAssistantRun.ts`

Added logging after an assistant run finishes and the app decides whether to auto-open a review target:

- `assistant_run_initial_review_target`

The log includes:

- run id;
- proposal ids returned by the run;
- active file when the run started;
- active file when the run finished;
- whether the user navigated during the run;
- the chosen review target, if any.

This is important because auto-targeting is one likely source of unexpected file jumps.

### `src/App.tsx`

Added logs around app-level navigation signals:

- `navigation_mark_without_running_run`
  - a navigation action happened when no assistant run was active.
- `navigation_mark_during_run`
  - user navigation happened while an assistant run was active.
- `running_run_changed`
  - assistant run id changed.
- `manual_review_target_change`
  - user explicitly selected a pending review target.
- `external_capture_active_file_target`
  - external-change capture selected the active file as a review target.
- `file_tree_open_node`
  - user opened a real file-tree node.
- `file_tree_open_pending_change`
  - user opened a pending review item from the file tree.
- `bulk_accept_pending_changes_start`
  - sidebar `Accept all` started.
- `bulk_accept_pending_changes_finish`
  - sidebar `Accept all` finished.
- `bulk_reject_pending_changes_start`
  - sidebar `Reject all` started.
- `bulk_reject_pending_changes_finish`
  - sidebar `Reject all` finished.

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

### Assistant Pending Proposal Cards

Files changed:

- `src/App.tsx`
- `src/components/AssistantPanel.tsx`
- `src/components/assistant/AssistantPendingProposals.tsx`
- `src/i18n/strings.ts`
- `tests/components/AssistantPendingProposals.test.tsx`

What changed:

- Replaced the card action label:
  - old: `Review`
  - new: `Accept all`
- Replaced the secondary action label:
  - old: `Discard`
  - new: `Reject all`
- The card now calls file-level review actions directly instead of opening review navigation.
- `Accept all` iterates every mutable file in that proposal and calls `onAcceptProposalFile`.
- `Reject all` iterates every mutable file in that proposal and calls `onRejectProposalFile`.
- Added a test that verifies both mutable files in a multi-file proposal are accepted/rejected.
- Kept the existing internal/external separation:
  - internal assistant proposals appear in the assistant card list;
  - external filesystem review proposals do not appear there.

### Editor Review Toolbar And Inline Controls

Files changed:

- `src/i18n/strings.ts`
- `src/app/useAgentProposals.ts`
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

The intent is that editor-surface actions are scoped to the file/change currently visible, while sidebar/assistant-card actions are bulk actions. File-system context stays in the toolbar header (`Pending document: ...`, `Pending delete: ...`) instead of changing the button labels to `Keep file`, `Move to Trash`, `Confirm deletion`, or similar specialized copy.

## How To Capture The Next Repro

1. Open DevTools for the app.
2. In a dev build, logs are already enabled.
3. In a packaged build, run:

```js
localStorage.setItem("iliad.debug.reviewNavigation", "1")
```

4. Clear the console.
5. Ask the agent to change several files.
6. Navigate through changed files the way that previously caused the jump.
7. If the app jumps to another file, copy all console lines beginning with:

```text
[review-nav]
```

The most useful events to look for are:

- `assistant_run_initial_review_target`
- `external_capture_active_file_target`
- `manual_review_target_change`
- `file_tree_open_pending_change`
- `select_target_open_edit_node`
- `select_target_set`
- `active_file_cleared_review_target`

Those should show whether the jump came from assistant auto-targeting, external-capture auto-targeting, a file-tree pending item click, or active-file/review state reconciliation.

## Verification

Focused tests run:

```sh
npm test -- tests/components/AssistantPendingProposals.test.tsx tests/components/FileTreePendingReview.test.tsx tests/i18n/writingAssistsCopy.test.ts
```

Result:

- 3 test files passed.
- 10 tests passed.

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
