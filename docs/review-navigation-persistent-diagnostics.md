# Review Navigation Persistent Diagnostics

## Context

Iliad now handles internal-agent and external-file review well, but there is still an intermittent navigation bug:

- the user clicks a changed file in the file tree;
- the document opens or appears selected briefly;
- the editor returns to the previously active changed document.

The currently observed pattern is:

- orange edit -> regular file: stable;
- orange edit -> orange edit: stable;
- orange edit -> red deleted document: immediate return to the orange edit;
- orange edit -> green new document: delayed return to the orange edit.

There is already navigation instrumentation in `docs/review-navigation-diagnostics-and-actions.md`, but most of it goes only to renderer `console.info` with the `[review-nav]` prefix. That is not durable enough for this bug because user testing often happens outside DevTools, across app restarts, and while the app is being driven manually.

## Goal

Persist enough renderer-side review-navigation diagnostics to the existing JSONL diagnostics log so the next reproduction can prove which state transition causes the jump.

This is a diagnostics-only change. It must not change review selection, active document selection, proposal application, file-tree rendering, or capture behavior.

## Non-Goals

- Do not fix the navigation jump in this change.
- Do not add Markdown content, absolute document paths, or full proposal objects to logs.
- Do not require DevTools for the next reproduction.
- Do not replace the existing main-process proposal action diagnostics.

## Logging Policy

`logReviewNavigation(event, details)` should continue to print `[review-nav]` when debug logging is enabled, and should always attempt to persist a safe flattened diagnostic record through `window.iliad.diagnostics.log` when that API exists.

Persistence must not be gated by `reviewDebugEnabled()`. Console noise is optional; durable diagnostics for this bug are not.

Persisted records:

- `level`: `info`
- `area`: `review`
- `event`: `review_navigation.<event>`
- `details.source`: already added by diagnostics IPC as `renderer`

Because `electron/ipc/diagnostics.ts` only preserves primitive detail values, review-navigation details must be flattened before logging. Nested objects such as `{ target: { proposalId, fileId } }` must become fields such as:

- `targetProposalId`
- `targetFileId`
- `targetKind`
- `targetRel`

Persisted detail keys must not end in `path`. The shared diagnostics logger intentionally drops keys ending in `path`, so review-navigation fields use short `*Rel` names for workspace-relative identities.

The logger must be best-effort: diagnostics failures must never throw into UI code or block navigation.

Every persisted review-navigation record should include a renderer-local monotonic `navSeq` number. This is not a stable ID; it is only a per-window sequence that makes async click -> select -> open/reveal -> active-file-change order easy to inspect.

## Required Events

The existing events should be persisted where they already exist:

- `file_tree_open_node`
- `file_tree_open_pending_change`
- `file_tree_reveal_requested`
- `file_tree_reveal_completed`
- `file_tree_reveal_failed`
- `manual_review_target_change`
- `select_target_start`
- `select_target_refetch_proposals`
- `select_target_invalid`
- `select_target_flush_save`
- `select_target_missing_edit_node`
- `select_target_open_edit_node`
- `select_target_open_edit_node_failed`
- `select_target_reveal_edit`
- `select_target_reveal_create`
- `select_target_reveal_delete`
- `select_target_open_delete_node`
- `select_target_open_delete_node_failed`
- `select_target_set`
- `select_target_clear_requested`
- `active_file_changed`
- `active_file_cleared_review_target`
- `normal_navigation_cleared_review_target`
- `proposal_state_cleared_review_target`
- `external_capture_active_file_target`
- `assistant_run_initial_review_target`

## Additional Detail Fields

Add enough detail to distinguish the three concepts involved in the bug:

1. actual active editor file;
2. selected file-tree path;
3. active review target.

Where available, events should include these persisted field names:

- `activeRel`
- `previousActiveRel`
- `selectedTreePathKind`: `real`, `pending`, `workspace`, or `none`
- `selectedTreeRel`
- `targetProposalId`
- `targetFileId`
- `targetKind`: `edit_file`, `create_file`, or `delete_file`
- `targetRel`
- `nodeRel`
- `nodeKind`
- `nodeFound`
- `nodePathKind`: `real`, `pending`, or `none`
- `openedNode`: boolean
- `openResultKind`
- `revealPathKind`: `real`, `pending`, or `none`
- `revealRel`
- `ancestorFound`
- `rowFound`
- `clearReason`, when a review target is cleared

Do not log absolute file paths. If an existing debug call already passes an absolute path for console usefulness, the persistence layer must omit or classify it rather than write the raw value.

The persistence helper should use a positive allowlist for persisted keys. It may derive `*Rel` values only from:

- explicit relative fields such as `relativePath`, `activeRelativePath`, `previousActiveRelativePath`, and `selectedTreeRelativePath`;
- nested review targets after resolving their proposal file at the call site;
- `iliad-review://...` or `iliad-review-dir://...` pending paths, converted back to a relative identity.

It must not rename arbitrary absolute `path` fields into `*Rel`.

## Specific Enhancements

### `src/assistant/reviewDebug.ts`

Update `logReviewNavigation` so it:

- keeps the existing console behavior;
- calls `window.iliad.diagnostics?.log` with safe, flattened detail fields;
- ignores diagnostics failures.

Add helper functions in this file only:

- `safeReviewDiagnosticDetails(details)`
- `classifyPath(path)`
- `flattenTarget(prefix, value)` if needed.

The helper should preserve primitive values only from an allowlist. Fields named `path`, `currentPath`, `previousPath`, `nodePath`, or similar should not be persisted raw. Use `nodePathKind`, `revealPathKind`, or `selectedTreePathKind` when path classification is useful.

### `src/app/useAgentProposals.ts`

Keep existing log sites, but enrich the selection/reconciliation logs so the persisted trace can answer:

- Was the user selecting an edit/create/delete target?
- Did selection open a real node?
- Did selection only reveal a pending path?
- Did `active_file_changed` clear the active review target?
- Was the create/delete review target cleared because it did not match the current real active file?

The key event for the suspected bug is `active_file_cleared_review_target`; it should include:

- `clearReason`
- target id fields
- target kind and `targetRel`
- `activeRel`

Also add logs for two currently silent clearing paths:

- `normal_navigation_cleared_review_target`, emitted inside `clearReviewForNormalNavigation` when a real file-tree open clears the current target;
- `proposal_state_cleared_review_target`, emitted when proposal/file/workspace invalidation clears the target after a proposal refresh.

Both events must resolve the current target to its proposal file before logging so the persisted record includes `targetKind` and `targetRel`.

### `src/App.tsx`

Keep app-level log sites, but enrich:

- `manual_review_target_change`
- `file_tree_open_node`
- `file_tree_open_pending_change`
- reveal lifecycle handling for `reviewRevealPath`

These should include enough context to compare user intent with the later active-file effect.

`file_tree_reveal_requested` should be logged when `requestReviewReveal` is set.

`file_tree_reveal_completed` should be logged from `onRevealComplete`.

`file_tree_reveal_failed` should be logged if FileTree cannot find reveal ancestors or cannot find/register the target row. This is especially important for green proposed files because delayed reveal failure could look like a delayed navigation bounce.

## Reproduction Procedure After Implementation

1. Start the dev app against `/Users/sebastian/dev/iliad-site/my-docs`.
2. Ask the internal agent or an external editor to create a mixed proposal:
   - one edited existing document;
   - one proposed new document;
   - one proposed deleted document;
   - optionally one emptied document.
3. In the file tree, reproduce:
   - click orange edit, then red delete;
   - click orange edit, then green create;
   - click orange edit, then regular unchanged document;
   - click orange edit, then orange edit.
4. Inspect:

```sh
rg 'review_navigation\\.' "$HOME/Library/Application Support/iliad-dev/logs/iliad-$(date +%F).jsonl"
```

Expected result: the log sequence shows the user click, target selection, any open/reveal behavior, and the active-file reconciliation that either keeps or clears the review target.

## Tests

Add or update tests for the pure diagnostics helper:

- nested `target` details are flattened into primitive fields;
- unsafe absolute path fields are not persisted raw;
- `relativePath` input fields become safe `*Rel` output fields, not `*Path` output fields;
- persisted detail keys survive `sanitizeDiagnosticDetails`;
- diagnostics calls are best-effort and do not throw when `window.iliad.diagnostics.log` rejects;
- console logging remains enabled in dev behavior.

If the helper cannot be tested cleanly because of `import.meta.env.DEV`, extract pure helpers from `reviewDebug.ts` and test those directly.

No UI behavior tests are required for this diagnostics-only change.

## Acceptance Criteria

- The app writes `review_navigation.*` records into the JSONL diagnostics log during file-tree review navigation.
- Logs include enough context to distinguish orange edit, green create, and red delete review targets.
- Logs do not include Markdown content or raw absolute document paths.
- Existing console `[review-nav]` output still works.
- Existing tests pass.
