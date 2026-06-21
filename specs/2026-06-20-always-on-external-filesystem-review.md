# Always-On External Filesystem Review

Date: 2026-06-20
Status: reviewed; ready for implementation

Supersedes, where behavior conflicts:

- `specs/2026-06-17-external-agent-change-capture.md`
- `specs/2026-06-18-pending-review-drift-ux.md`
- `specs/2026-06-20-live-external-change-capture-git-guards.md`

## Review Panel

This spec was reviewed by four external agents:

- product/UX review;
- state-machine and data-model review;
- filesystem, watcher, and Git-safety review;
- QA and live visual-test review.

Accepted review changes are incorporated below:

- action labels use writer-facing file outcomes instead of abstract
  accept/reject language where the outcome is destructive;
- external review is session-scoped and does not survive workspace reopen;
- live-disk external proposals require external-specific apply/reject logic;
- hunk-level external edit decisions are out of MVP;
- watcher events are hints only and always reconcile through full snapshots;
- Iliad-owned writes update or reconcile the workspace baseline;
- destructive actions re-check path identity, Git advisory state, and reviewed
  content before writing;
- live/visual tests use fresh workspaces or a verified reset contract.

## Product Intent

Iliad is a local Markdown editor. Writers should be able to keep Iliad open
while another tool, person, script, or coding agent edits the same Markdown
workspace. Iliad should notice those live filesystem changes and present them
with the same calm review surface it uses for assistant edits.

Opening Iliad is a clean slate. Whatever is on disk at workspace open is the
accepted workspace state for Iliad, even if Git says the folder is dirty. From
that point forward, Iliad tracks live outside changes against the version Iliad
last reviewed.

The writer-facing model is:

> Iliad noticed changes made outside Iliad. Choose whether to keep those changes
> or restore the version Iliad last reviewed.

Do not expose implementation terms such as baseline, snapshot, external
filesystem, or review set in the UI.

## Core Decisions

1. External filesystem review is always on for the active workspace.
2. There is no Writing Assists toggle for external review.
3. Git is advisory only. Git can explain that repository state changed or block
   stale destructive writes, but it does not define Iliad's review state.
4. Iliad must not restore files immediately just to make review possible.
   Outside edits stay on disk while the review UI shows the cumulative diff.
5. Existing pending external review never blocks capturing more outside
   changes. If the same path changes again, the visible review updates against
   the same accepted workspace state.
6. If a path returns to the accepted workspace state, the pending review for
   that path disappears because there is nothing left to keep or restore.
7. New Markdown files are text additions. Opening one shows the whole document
   as green added text.
8. Deleted Markdown files are file lifecycle changes. The file tree keeps a
   visible deleted row and opening it shows the old contents as removed text.
9. A cleared file is not a deleted file. If the path still exists and is empty,
   Iliad shows a normal edit where all previous text was removed.
10. External edit MVP is file-level. Hunk-level keep/restore for live-disk
    external edits is explicitly out of scope.

## Definitions

- **Workspace baseline**: implementation term for the accepted Markdown state
  of the active Iliad session. It is captured from disk on workspace open and
  updated by successful Iliad writes and external-review decisions.
- **Current disk snapshot**: the latest visible Markdown state on disk. This is
  never "minus Iliad-owned writes"; snapshots always read actual disk state.
- **External review set**: the mutable, session-scoped review artifact
  representing the diff between workspace baseline and current disk snapshot.
- **Iliad-owned write**: an expected filesystem write caused by Iliad, including
  editor autosave, proposal accept/reject, file creation, rename, move to Trash,
  image insertion, or external-review restore/revert.
- **External write**: a filesystem mutation not known to be caused by Iliad.
- **Reviewed disk state**: the content or absence state that was on disk when
  the current external review item was generated.
- **Changed back to baseline**: a path no longer differs from the workspace
  baseline: edited content matches again, a created path disappeared, or a
  deleted path reappeared with its baseline content.

## Session Scope

External filesystem baselines and review sets are session-scoped.

- On workspace open, clear or ignore any persisted external-filesystem review
  artifacts for that workspace.
- Do not show pending external review from a previous Iliad process launch.
- Persisted assistant-generated proposals may remain visible because those are
  intentional review artifacts, not live filesystem capture.
- The implementation may persist the active external review proposal during a
  session for reuse by existing renderer code, but it must be marked
  `sessionScoped: true` and deleted or hidden on the next workspace open.

## Opening A Workspace

1. Iliad reads the current visible Markdown file tree.
2. Iliad records current visible Markdown files as the workspace baseline.
3. Iliad shows no new external review items for pre-existing Git dirtiness or
   pre-existing files.
4. Iliad removes or hides previous session-scoped external review artifacts.
5. External review starts after the initial tree, active document, and proposal
   load have settled enough that Iliad will not confuse its own startup work for
   outside edits.

## Snapshot Classification

Every refresh compares the workspace baseline with a settled current disk
snapshot by normalized workspace-relative Markdown path:

| Baseline path | Current disk path | Classification |
| --- | --- | --- |
| absent | absent | no item |
| absent | regular file | new file |
| regular file | absent | deleted file |
| regular file | regular file with same content | no item |
| regular file | regular empty file with different content | cleared file, represented as edit |
| regular file | regular file with different content | edit |
| any | symlink, directory, hidden path, ignored path, or unsafe ancestor | unsafe path drift |

Only classify from a settled snapshot after debounce. Atomic-save patterns can
briefly delete, recreate, or empty files; those transient states must not become
review items unless they remain true after debounce.

Watcher events are hints only. Any Markdown-relevant watcher event, null
filename, watcher restart, Git-change notice, or marker-clear verification may
trigger a full visible Markdown snapshot diff. Changed path lists may optimize
refresh timing, but they must not define correctness.

## Baseline Updates From Iliad Writes

Successful Iliad-owned writes must reconcile the workspace baseline.

- Editor autosave updates the baseline for that file when there is no pending
  external review item for the same path.
- Iliad create/rename/move-to-Trash/delete actions update the baseline for the
  affected paths when there is no pending external review item for those paths.
- Assistant proposal application updates the baseline for affected paths when
  there is no pending external review item for those paths.
- If Iliad writes a path that currently has pending external review, destructive
  external actions for that path become unavailable until Iliad refreshes and
  recomputes the path state.

Iliad-owned write markers suppress event attribution, not disk reconciliation.
Marker-covered watcher events should enqueue a delayed full refresh after the
marker clears. Where possible, record expected post-Iliad-write hashes for
marked paths; if settled disk content differs from that expected hash, treat it
as outside drift and refresh review.

## External Edit While Iliad Is Open

1. An outside tool changes a Markdown file.
2. The workspace watcher reports a possible Markdown change.
3. Iliad debounces briefly to let batched writes settle.
4. Iliad takes a current disk snapshot and compares it with the workspace
   baseline.
5. Iliad updates one external review set for all changed Markdown paths.
6. The changed file remains on disk with the outside content.
7. The editor displays a read-only external review view with diff decorations
   against the version Iliad last reviewed.
8. If the file changes again externally, Iliad recomputes the same review set
   cumulatively.

External review views are read-only for MVP. If the user wants to edit the file,
they must first keep the outside changes or restore the previous version.

## External Change Returns To Baseline

If a path no longer differs from the workspace baseline:

- remove that path from the external review set;
- if no paths differ, remove the external review set entirely;
- clear file tree markers and review toolbar actions for that external review;
- if the user was looking at the review, return to the normal editor view;
- optionally show a transient notice:
  `Outside change was undone; this file matches the version Iliad last reviewed.`

Do not ask the user to act on a change that no longer exists.

## File States And UI Copy

### Edited Markdown File

For a baseline file that still exists with different content:

- file tree: amber marker, pencil/dot icon, accessible label
  `Changed outside Iliad`;
- editor: read-only external review of the changed file;
- toolbar banner: `This file changed outside Iliad.`;
- actions: `Keep changes` / `Restore previous version`;
- keep: advance the workspace baseline to current disk content;
- restore: write the baseline content back to disk.

### New Markdown File

For a file that did not exist in the workspace baseline and exists now:

- file tree: green marker or row, plus-file icon, accessible label
  `New outside Iliad`;
- editor: read-only review showing the whole document as green added text;
- toolbar banner: `This file was created outside Iliad.`;
- actions: `Keep file` / `Move to Trash`;
- keep: advance the workspace baseline to include the file's current content;
- move to Trash: remove the file recoverably if it still matches the reviewed
  content.

If recoverable deletion is unavailable, block bulk rejection for new files or
require explicit per-file confirmation. Do not hard-delete a new outside file
from a bulk action without a recovery path.

### Deleted Markdown File

For a baseline file that no longer exists:

- file tree: visible ghost row at the old path, red marker, removed-file icon,
  dimmed/struck label, accessible label `Deleted outside Iliad`;
- editor: read-only virtual document showing baseline content as all-red
  removed text;
- toolbar banner: `This file was deleted outside Iliad.`;
- actions: `Confirm deletion` / `Restore file`;
- confirm deletion: advance the workspace baseline so the file is absent;
- restore file: write the baseline content back to disk.

If the file reappears with baseline content before action, remove the item. If
it reappears with different content, convert the item into an edit.

### Cleared Markdown File

For a baseline file that still exists but is empty:

- file tree: amber edit marker, accessible label `Emptied outside Iliad`;
- editor: read-only edit review showing all baseline text as removed;
- toolbar banner: `This file was emptied outside Iliad.`;
- actions: `Keep empty file` / `Restore text`;
- keep: advance the baseline to empty content;
- restore: write the baseline content back to disk.

Cleared files must not use deleted-file tree styling.

### Mixed External Changes

When several paths differ at the same time, Iliad shows one external review set
with file-level items for each path. The sidebar count counts reviewable file
items, not raw watcher events.

The pending strip should use explicit copy:

- `Review`;
- `Restore all...` for bulk restore/reject.

When exactly one review item exists and that item is already visible in the
editor review, the pending strip should render only the review count. The editor
toolbar already owns the file-level decision in that state.

The bulk confirmation should summarize consequences, for example:
`This will restore 2 edited files, move 1 new file to Trash, and restore 1 deleted file.`

## Live External Action Semantics

External review actions must use external-specific proposal resolution logic.
The normal generated-proposal apply/reject paths are not correct because
outside content is already on disk.

For every file action:

1. Do not auto-flush unsaved editor content for a path that has pending external
   review.
2. Re-resolve the canonical workspace root and normalized POSIX relative path.
3. Reject hidden, ignored, absolute, escaping, or non-Markdown paths.
4. `lstat` ancestors and targets immediately before destructive writes.
5. Reject symlinks, non-regular files, directory replacements, or unsafe
   ancestors as `unsafe_path_drift`.
6. Re-check the Git advisory snapshot when Git was available at review refresh.
7. Compare current disk against the reviewed disk state, not against generated
   proposal reconstruction.
8. On drift, refresh the external review set instead of applying the stale
   action.

### Keep Edited File

- If current disk still equals the reviewed replacement, mark the item kept and
  advance the baseline to current disk content.
- Do not rewrite the file.

### Restore Edited File

- If current disk still equals the reviewed replacement, write the baseline
  content back using an Iliad-owned write marker.
- Leave the baseline unchanged.

### Keep New File

- If the file still exists and equals the reviewed content, add it to the
  baseline.
- If the file disappeared, clear the item.
- If the file changed, refresh and keep it pending with the newer content.

### Move New File To Trash

- If the file still exists and equals the reviewed content, move it to Trash or
  an Iliad recovery quarantine with an Iliad-owned write marker.
- If the file disappeared, clear the item.
- If the file changed, refresh and keep it pending.

### Confirm Deleted File

- If the file is still absent, remove it from the baseline.
- If it reappeared with baseline content, clear the item.
- If it reappeared with different content, refresh as an edit.

### Restore Deleted File

- If the file is still absent, recreate parent directories as needed and write
  the baseline content back with an Iliad-owned write marker.
- If it reappeared with baseline content, clear the item.
- If it reappeared with different content, refresh as an edit.

### Bulk Undo Outside Changes

MVP should use all-or-none preflight:

1. Acquire the workspace mutation lease.
2. Preflight every affected path with the same path, Git, and reviewed-state
   checks as per-file actions.
3. If any path is unsafe or drifted, write nothing, refresh the external review
   set, and show the first blocking error.
4. If all paths are safe, apply all restore/trash operations with Iliad-owned
   markers.
5. Run a final full refresh.

## Hunk-Level External Edits

Hunk-level keep/restore for external edits is out of MVP.

- External edit reviews may show hunks visually.
- Inline hunk buttons must be hidden or disabled for external live-disk review.
- File-level actions are the only supported external edit decisions.

This avoids unsafe partial writes while the external tool may keep editing the
same file.

## Git Policy

Iliad must not use `git diff` as review input.

Git-backed workspaces are common, but Git is a repository history tool and
Iliad's external review is a live editor baseline. These can coexist if Git
only informs safety and messaging:

- workspace open treats current disk as baseline regardless of Git dirtiness;
- moving Git `HEAD` outside Iliad does not by itself create external review
  items;
- if Git `HEAD` changes and filesystem still differs from Iliad baseline,
  Iliad recomputes external review from filesystem state;
- if Git `HEAD` changes and filesystem matches baseline, no review is shown.

Each external review refresh should record a Git advisory snapshot when
available:

```ts
type GitAdvisorySnapshot =
  | { status: "unavailable"; reason: "git_missing" | "not_repo" | "unborn_head" | "timeout" | "error" }
  | { status: "ok"; repositoryRoot: string; head: string; indexIdentity: string };
```

Before any destructive write, restore, or trash operation:

- if Git was available during refresh but cannot be checked now, block and
  refresh;
- if `HEAD` changed, block and refresh;
- if only the index identity changed, proceed only when touched paths still
  match the reviewed disk snapshot exactly;
- if Git was unavailable during refresh, do not require Git for that action.

Optional notice copy:
`Repository changed outside Iliad; outside changes were refreshed from disk.`

## Data Model

External review may reuse `AgentChangeProposal` only if it has explicit
external metadata and external-specific action branches.

```ts
interface AgentChangeProposal {
  metadata?: ExternalReviewMetadata;
}

interface ExternalReviewMetadata {
  kind: "external_filesystem";
  baselineId: string;
  snapshotId: string;
  liveDisk: true;
  sessionScoped: true;
}
```

Each external file item must provide or derive reviewed/baseline identity:

```ts
type ReviewPathState = "present" | "absent";

interface ExternalReviewFileIdentity {
  baselineState: ReviewPathState;
  baselineContentHash?: string;
  reviewedState: ReviewPathState;
  reviewedContentHash?: string;
}
```

For external edit/delete files:

- `baseContent` is the workspace baseline content;
- `baseHash` is the baseline hash;
- `replacement` is the reviewed disk content for edit files;
- `reviewedContentHash` is the hash of `replacement` or `content`;
- `reviewedState` is `present` for edit/create and `absent` for delete.

The active external proposal should use stable file ids by normalized relative
path so repeated refreshes update the same visible file item instead of creating
one item per watcher event.

When the diff becomes empty, the active external proposal should be deleted,
hidden, or marked terminal so `fileHasMutableReview` returns false and the
pending strip/tree/editor clear.

## Capture State Machine

Replace one-shot `start -> finish -> restore -> stop` capture with a live
baseline tracker:

- `idle`: no workspace.
- `initializing`: reading initial baseline and clearing previous external
  session artifacts.
- `watching`: baseline exists; waiting for possible outside Markdown changes.
- `refreshing`: debounced full snapshot and proposal reconciliation in progress.
- `applying`: keep/restore/trash is mutating baseline and/or disk.
- `paused`: local unsaved editor content or an unsafe condition prevents
  destructive actions; passive refresh may still continue.

Rules:

- Existing pending external review must not prevent `watching` or `refreshing`.
- External review refresh must never restore disk.
- Iliad-owned writes are marked, but marker-covered events schedule
  reconciliation after the marker clears.
- If the active editor has unsaved text for a path with pending external review,
  do not auto-flush or overwrite it. Disable external actions for that path or
  route through an explicit save/reload decision in a later enhancement.
- If a watcher event occurs during an agent run, do not discard it. Debounce and
  refresh after the current Iliad-owned mutation marker clears.

## Implementation Plan

1. Keep this reviewed spec as the source of truth.
2. Update external capture API semantics so main process can:
   - start a session-scoped workspace baseline;
   - refresh the active external review set without restoring disk;
   - clear stale external review when disk returns to baseline;
   - advance baseline on keep/confirm actions;
   - restore or trash on undo actions.
3. Clear or hide session-scoped external review artifacts on workspace open.
4. Remove the Writing Assists external-capture preference and UI switch.
5. Remove renderer gating that blocks external refresh while mutable proposals
   exist.
6. Add external-specific branches to proposal file application/rejection, or add
   new external-review IPC methods and route UI actions through them.
7. Disable hunk-level external actions for MVP.
8. Keep Iliad-owned mutation markers around writes and add marker-clear
   reconciliation so external drift is not hidden.
9. Update file tree labels and styling:
   - `Discard all` -> `Restore all...`;
   - pending strip primary action -> `Review`;
   - hide pending strip actions when the only pending review item is already
     visible in the editor review;
   - deleted file row uses ghost/deleted styling and accessible text;
   - pending create/delete rows remain visible when no real file node exists.
10. Update editor review labels for edited/new/deleted/cleared states.
11. Add stale/drift handling so obsolete actions refresh instead of applying.

## Key Tests

### Main Process

- Starting a workspace baseline in a Git-dirty folder creates no review item.
- Previous session-scoped external proposals are cleared or hidden on workspace
  open.
- External edit creates an edit review and leaves edited content on disk.
- A second external edit to the same file updates the same review cumulatively.
- Reverting a file externally back to baseline removes the review item.
- External create creates a new-file review and leaves the file on disk.
- External create followed by external delete removes the review item.
- Keeping a new file advances the baseline and keeps the file.
- Moving a new file to Trash uses a recoverable path and removes empty created
  parent directories only when safe.
- External delete creates a delete review and leaves the file absent.
- Deleted file reappearing with baseline content removes the review item.
- Deleted file reappearing with different content becomes an edit review.
- Confirming a delete advances the baseline and leaves the file absent.
- Restoring a delete recreates missing parents and writes baseline content back.
- Clearing a file creates an edit review, not a delete review.
- Keeping an edit advances baseline without rewriting identical disk content.
- Restoring an edit writes baseline content back with an Iliad-owned marker.
- External hunk actions are unavailable for live-disk external edits.
- Accept/restore/trash re-read current disk before destructive action and
  refresh when reviewed content drifted.
- Iliad-owned writes update baseline when no external review targets the path.
- Iliad-owned writes for paths with pending external review force refresh before
  destructive actions.
- Marker-matched watcher events enqueue delayed reconciliation after marker
  clear.
- Git `HEAD` movement does not create review items by itself.
- Git/index drift during destructive action blocks stale writes as specified.
- Unsafe path drift through symlink/directory/hidden replacement blocks
  destructive action and leaves review pending with an error state.

### Baseline-Changing Sequences

- Edit kept, then old content restored externally creates a new pending edit.
- Edit restored, then the same outside edit appears again.
- New file kept, then deleted externally becomes a delete review.
- New file moved to Trash, then recreated externally becomes a new-file review.
- Delete confirmed, then recreated externally becomes a new-file review.
- Deleted file restored, then deleted externally again becomes a delete review.
- Clear kept, then original content restored externally becomes an edit.

### Path Lifecycle Matrix

For each transition, assert final review kind, reviewed content, count, and
stable file item id:

- baseline absent -> present -> present changed: one new-file item with latest
  content;
- baseline absent -> present -> absent: no item;
- baseline present -> changed -> changed again: one edit item against original
  baseline with latest replacement;
- baseline present -> changed -> absent: one delete item;
- baseline present -> absent -> present same: no item;
- baseline present -> absent -> present changed: one edit item;
- baseline present -> empty: one edit/cleared item;
- baseline present -> symlink/directory: unsafe path drift.

Rapid writes within the debounce window must produce one item per final path
state, not one item per watcher event.

### Mixed Changes And Bulk Actions

- Mixed edit/create/delete shows the correct count and distinct row states.
- Per-file keep/restore updates only that file and refreshes remaining items.
- Bulk undo preflights all paths and writes nothing if one path drifted.
- Bulk undo succeeds for all safe paths and final refresh clears the review set.

### Renderer / App

- External review is active without a Writing Assists toggle.
- The Writing Assists popover no longer contains `Capture external edits`.
- If the renderer restarts or remounts while the main process still has an
  active capture for the workspace, the next auto-arm call reclaims that
  capture instead of failing.
- Reclaimed captures schedule an immediate refresh so changes that happened
  while the renderer had no capture state still become review items.
- Existing pending external review does not block watching or refresh.
- Markdown watcher events trigger debounced full snapshot refresh.
- If current disk equals baseline after refresh, the pending strip disappears.
- The sidebar count reflects changed file items.
- Pending strip says `Review` and `Restore all...` when its actions are
  visible.
- Pending strip hides its actions when the only pending item is already visible
  in the editor review.
- Review opens the first mutable external item.
- Active-file external edit shows diff decorations without requiring app reload.
- External review views are read-only.
- Routine external review creation does not show a toast/banner; the sidebar
  strip, file markers, and review toolbar are the visible notification.
- While a review is already visible, Iliad does not poll/re-render unchanged
  external proposals. Further external writes are picked up from workspace
  watcher events and merged cumulatively.
- If a Markdown watcher event arrives while the renderer has no active capture
  state, the renderer attempts to reclaim any active main-process capture. A
  reclaimed capture schedules immediate finish so renderer reloads or transient
  state loss do not silently hide outside edits.
- Main-process external capture writes diagnostics JSONL events for start,
  resume, finish, refresh, cancel, and failures. Logs include capture ids,
  counts, statuses, and sanitized error summaries, but never Markdown content,
  relative file paths, or absolute workspace paths.
- If an external agent writes again after a review is visible but before the
  writer clicks `Keep changes` or `Restore previous version`, the action
  refreshes once and applies to the latest live disk state. The first click
  must not be consumed merely refreshing a stale proposal.
- Unsaved editor content is not auto-flushed or overwritten by external action.
- Applying or undoing external review clears the correct sidebar markers.

### File Tree

- Pending edit rows/badges are amber and expose `Changed outside Iliad`.
- Pending new files are green, selectable, and expose `New outside Iliad`.
- Pending deleted files are red, selectable while absent from disk, visually
  ghosted/struck, and expose `Deleted outside Iliad`.
- Cleared files expose `Emptied outside Iliad` and use edit styling.
- Parent folders show markers for pending descendants.
- Newest cumulative review state wins for repeated changes to one path.

### Editor Review

- New file review renders all lines inserted.
- Deleted file review renders all lines removed.
- Cleared file review renders all baseline lines removed in edit mode.
- Repeated external edits rebuild hunks against the original baseline.
- Returning to baseline removes review decorations and review toolbar.
- Delete review exposes file-level actions only.
- External edit review hides hunk-level controls.
- Reclaiming an already active capture uses the original baseline and produces
  a cumulative review from that baseline to current disk.
- Refreshing the same active review target updates the displayed diff without
  re-running file navigation or review reveal.
- Toolbar labels match state:
  `Keep changes`, `Restore previous version`, `Keep file`, `Move to Trash`,
  `Confirm deletion`, `Restore file`, `Keep empty file`, `Restore text`.

### Live Test Harness / Reset Contract

Automated and visual tests should use a fresh temp workspace and fresh temp
Electron userData per case whenever possible.

If reusing a workspace, the reset helper must verify before each case:

- disk equals the fixture;
- no active external review proposal exists;
- no pending file-tree markers exist;
- watcher debounce work is idle;
- mutation markers have cleared;
- active editor text matches disk or no file is open.

### Visual QA

Use macOS `screencapture` against the Electron dev app for these states. Save
screenshots with predictable names under a temp visual-test directory.

1. `01-clean.png`: clean workspace, no pending strip.
2. `02-edit.png`: edited file, amber marker, compact pending strip, green
   inserted paragraph aligned with normal prose, read-only review toolbar.
3. `03-edit-cumulative.png`: same file edited again, one pending item,
   cumulative diff visible.
4. `04-reverted.png`: file restored externally to baseline, no pending strip or
   marker.
5. `05-new-file.png`: green pending row, `New outside Iliad`, whole document
   green, actions `Keep file` and `Move to Trash`.
6. `06-deleted-file.png`: red/struck ghost row, `Deleted outside Iliad`, deleted
   document all red, actions `Confirm deletion` and `Restore file`.
7. `07-cleared-file.png`: amber edit marker, `Emptied outside Iliad`, all old
   text red, not deleted styling.
8. `08-mixed.png`: mixed edit/create/delete, correct count and distinct row
   states.
9. `09-post-action.png`: after keeping/restoring one mixed item, count and
   markers update without stale buttons.
10. `10-unsaved-conflict.png`: unsaved editor plus outside change does not
    overwrite local text and disables/reroutes destructive actions.

Between visual cases, use a fresh workspace/userData or the verified reset
contract above. The revert-to-baseline case intentionally performs the external
revert as the test action rather than cleanup.
