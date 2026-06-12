# Codex File Change Capture Spec

Date: 2026-05-24
Status: implemented

## Problem

After switching the assistant runtime to Codex app-server with `gpt-5.5`,
Codex can answer that it edited the active Markdown file while Iliad shows no
pending diff. Diagnostics from the failing run showed:

- provider: `codex-app-server`;
- model: `gpt-5.5`;
- run completed successfully;
- `draftFileChangeCount: 0`;
- `proposalCount: 0`;
- no `item/fileChange/patchUpdated` notification was logged.

The file on disk was still modified directly. That breaks Iliad's core editing
contract: model-authored document changes must appear as pending accept/reject
review changes, not silently mutate course files.

## Documentation Findings

The current bridge relies on `item/fileChange/patchUpdated`. Official Codex
app-server docs do not describe that as the canonical file-edit event. They
describe:

- `fileChange` items: `{id, changes, status}` with `changes` containing
  `{path, kind, diff}`;
- `item/started` and `item/completed` lifecycle events for every item;
- `item/completed` as the authoritative final state;
- `item/fileChange/outputDelta` as deprecated, with current app-server versions
  using `fileChange` items and `turn/diff/updated` instead;
- `turn/diff/updated` as an aggregate latest unified diff across file changes
  in the turn.

The locally generated Codex app-server TypeScript schema agrees:

- `ThreadItem` includes `{ type: "fileChange", id, changes, status }`.
- `ItemStartedNotification` and `ItemCompletedNotification` both carry a full
  `ThreadItem`.
- `TurnDiffUpdatedNotification` carries `{ threadId, turnId, diff }`.
- `FileChangePatchUpdatedNotification` still exists in the generated schema,
  but it is not the documented source of truth.

References checked:

- OpenAI Codex app-server README:
  `https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md`
- OpenAI app-server architecture article:
  `https://openai.com/index/unlocking-the-codex-harness/`
- Local Codex CLI schema generated with `codex app-server generate-ts`.

## Product Intent

The assistant may use Codex as a real file-editing agent, but Iliad remains the
review authority. If Codex changes or creates Markdown files, the user should see
those changes in the document review UI and choose accept/reject. The chat panel
should stay clean and should not be the place where diffs live.

## Options Considered

### Option A: Keep Listening Only For `patchUpdated`

Pros:
- Smallest code change: none.
- Existing tests cover the old event.

Cons:
- Already fails with current app-server behavior.
- Not aligned with current public app-server docs.
- Does not protect against direct disk writes.

Decision: reject.

### Option B: Use Documented `fileChange` Items Only

Listen to `item/started` and `item/completed`, extract `fileChange.changes`,
and convert those diffs to Iliad proposals.

Pros:
- Matches official app-server docs.
- Keeps current conversion pipeline.
- Small and direct.

Cons:
- If Codex mutates disk without emitting a `fileChange` item, Iliad still misses
  the change.
- If Codex applies changes before the host creates the proposal, the real file
  may be dirty and the review UI can become stale unless we restore it.

Decision: necessary, but not sufficient by itself.

### Option C: Use Filesystem Snapshot/Diff As Canonical

Snapshot Markdown files before the run, compare after the run, create proposals
from filesystem differences, then restore original files until the user accepts.

Pros:
- Captures all actual file mutations regardless of event shape.
- Protects the accept/reject contract.
- Handles direct disk writes from Codex.

Cons:
- Scanning a large workspace is more expensive than consuming protocol events.
- A user editing files concurrently during a run can be mistaken for a Codex
  change unless we keep the scope narrow.
- New-file detection across the whole workspace needs path safety and filtering.

Decision: use as a safety fallback and restore mechanism, not the only source.

### Option D: Run Codex In A Temp Workspace

Copy relevant context into a temporary workspace, run Codex there, compare temp
vs real workspace, and propose changes.

Pros:
- Strongest isolation. Codex never mutates the real course folder.
- Easy to compare final temp state with real files.

Cons:
- Product owner already rejected changing the app to work through temp folders.
- More complex for relative assets, images, links, new files, and future context
  selection.
- Higher maintenance cost for v1.

Decision: reject for this slice.

## Recommended Design

Use a hybrid, real-workspace capture path:

1. **Protocol-first**: collect file changes from documented `fileChange` items on
   `item/started` and `item/completed`; keep supporting `item/fileChange/patchUpdated`
   as a compatibility fallback.
2. **Restore-on-capture**: after the turn completes and before returning to the
   renderer, restore any touched existing Markdown files to their pre-run content
   and remove captured new Markdown files. The pending proposal then becomes the
   only way changes persist.
3. **Disk reconciliation**: always compare visible Markdown workspace files
   before/after the run. Protocol items are preferred, but filesystem
   reconciliation catches missed, malformed, partial, or extra direct mutations.
4. **Diagnostics**: log whether changes came from `item/completed`,
   `patchUpdated`, or disk fallback. Never log raw document text.

This keeps the app behavior the user wants: Codex can edit real files, but Iliad
intercepts and renders those edits as pending document diffs.

## Scope

### In Scope

- Existing Markdown file updates.
- New visible Markdown files.
- Capturing changes from:
  - `item/started` with `item.type = "fileChange"`;
  - `item/completed` with `item.type = "fileChange"`;
  - legacy `item/fileChange/patchUpdated`.
- Disk fallback for Markdown files only.
- Restoring captured direct disk mutations before the renderer is updated.
- Redacted diagnostics for source and counts.
- Unit tests for the regression.

### Out Of Scope

- Delete, rename, and move proposals.
- Non-Markdown file edits.
- Temp workspace isolation.
- Live streaming of partial file diffs during generation.
- UI changes beyond existing proposal rendering.

## Detailed Flow

### Before Turn Start

Build a run snapshot:

- Include the active Markdown file from `request.activeFile`, using its supplied
  `content` and `baseHash`.
- Also scan visible workspace Markdown files to detect new-file collisions and
  direct disk fallback changes.
- Ignore hidden paths and ignored directories such as `node_modules`,
  `dist`, and `dist-electron`.
- Skip symlinks unless their real path is verified to stay inside the workspace.

The snapshot stores only:

- relative path;
- absolute path;
- content for Markdown files;
- whether the file existed.

### During The Turn

Capture file changes from:

- `item/started` when the item is a `fileChange`;
- `item/completed` when the item is a `fileChange`;
- `item/fileChange/patchUpdated` for compatibility.

For the same item id, completed item data wins over started/delta data.

Capture `turn/diff/updated` only as a diagnostic count/source for now. Do not
parse it into proposals in this slice because per-file `changes` are safer and
already include path/kind.

### After Turn Completion

1. Convert captured fileChange items into `AgentDraftFileChange[]` using existing
   strict diff conversion and the pre-run snapshot as the base. Do not read
   update base content from disk after the turn because Codex may already have
   applied the edit.
2. Always compare the post-run Markdown snapshot against the pre-run snapshot:
   - changed existing Markdown file -> `edit_file` draft;
   - new visible Markdown file -> `create_file` draft;
   - removed file -> unsupported note.
3. Merge protocol and disk-derived changes by relative path:
   - prefer a successfully converted protocol draft when the disk result matches
     that draft's proposed content;
   - use disk-derived drafts for extra or missed mutations;
   - if protocol and disk disagree, prefer the disk-derived draft and add a
     diagnostic note, because it reflects what actually happened to the file.
4. Restore the workspace conservatively:
   - for existing files, write back pre-run content only when current disk
     content exactly matches the proposed replacement captured for review;
   - for new files, remove them only when current disk content exactly matches
     the captured proposal content;
   - if current disk content does not match the captured proposal content, fail
     visibly instead of overwriting or deleting unknown user/process edits;
   - do not touch files outside visible Markdown scope.
4. Return draft proposals to `AgentService`, which already saves them and renders
   the document diff UI.

### Concurrency

This v1 should block concurrent assistant runs per workspace. `AgentService`
already tracks active runs by `runId`; this slice should add a workspace-level
guard so two Codex turns cannot mutate and restore the same workspace
simultaneously.

If a user or another process edits a Markdown file while a Codex run is active,
restore must be conditional. If the post-run file differs from the captured
proposal content, the provider should fail visibly and leave the file untouched
instead of overwriting unknown edits.

## Failure States

- If conversion of a captured diff fails, keep the assistant text but include a
  concise note that a Codex change could not be converted for review.
- If restoration fails or would overwrite unknown content, fail the run with an
  actionable error. Silent mutation or user-data loss is worse than a visible
  failure.
- If a new file already existed before the run, do not treat it as a create
  proposal.
- If a direct disk delete is detected, restore the file when possible and add an
  unsupported note.

## Tests

- Provider converts documented `item/completed` `fileChange` item into a review
  proposal.
- Provider accepts `item/started` `fileChange` when no completed item arrives.
- Completed fileChange item overrides started/patch data for the same item id.
- Provider detects a direct disk edit with no fileChange event, returns an
  `edit_file` proposal, and restores the original file.
- Provider detects a direct new Markdown file with no fileChange event, returns a
  `create_file` proposal, and removes the file until accepted.
- Provider reconciles a valid protocol change plus an extra silent disk mutation.
- Provider uses pre-run snapshot content, not post-run disk content, as the base
  for protocol diff conversion.
- Provider refuses to restore/delete when the current disk file no longer matches
  the captured proposal content.
- Workspace-level concurrent Codex runs are blocked.
- Symlinked Markdown paths are skipped or rejected.
- Provider logs source/count diagnostics without raw Markdown content.
- Existing patchUpdated tests continue passing.

## Review Revisions

- Accepted backend/runtime review feedback that disk reconciliation must always
  run, not only when protocol capture is absent.
- Accepted feedback that restoration must be conditional to avoid overwriting
  user edits or deleting user-created files.
- Accepted feedback that protocol diff conversion must use the pre-run snapshot
  as base content.
- Accepted feedback to add a workspace-level concurrent-run guard.
- Accepted feedback to account for symlinks during recursive scan and restore.

## Rollout

Push to `master` after local tests, typecheck, build, and review smoke pass.
There are no migrations or separate deploy surfaces in this repo.
