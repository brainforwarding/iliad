# Live External Change Capture With Git Guards

Date: 2026-06-20
Status: reviewed and implemented

Supersedes:

- `specs/2026-06-17-external-agent-change-capture.md`
- `specs/2026-06-18-pending-review-drift-ux.md` where behavior conflicts

## Product Intent

Iliad should let writers keep using normal Markdown files while also reviewing
changes made by external agents or tools while Iliad is open. Opening a
workspace should feel like a clean slate: current files are accepted workspace
state, even when the folder is already dirty in Git.

From that point forward, Iliad may capture live external Markdown mutations as
reviewable proposals. Git may help detect that an outside tool already accepted
or committed changes, but Git must not be the primary source of Iliad review
state.

## Core Rule

Iliad review state is session-local and proposal-based.

- On app launch or workspace open, the current Markdown files become the
  session baseline.
- Pre-existing Git dirtiness must not create Iliad pending changes.
- Markdown edits made outside Iliad while the workspace is open may become
  Iliad proposals.
- Persisted pending proposals from an older Iliad session remain review
  artifacts and must be labeled as such; they are not evidence that the current
  files are dirty.
- Git state is advisory. It can stop unsafe restores or reset a capture
  baseline after an external commit, but it does not define what Iliad should
  show for review.

## Definitions

- **Session baseline**: the Markdown snapshot captured after a workspace opens
  and Iliad has flushed or loaded the active document. This is not Git `HEAD`.
- **Capture baseline**: the in-memory Markdown snapshot used by one live
  external-capture interval.
- **Iliad-owned write**: a write caused by Iliad itself: editor autosave,
  proposal accept/reject, create/rename/delete file actions, image insertion,
  or capture restore.
- **External write**: a filesystem mutation not known to be Iliad-owned.
- **Proposal artifact**: persisted review state in `AgentProposalStore`.
- **Git advisory snapshot**: current Git `HEAD` and index identity, when the
  workspace is inside a Git repository.

## Desired Behavior

### Opening A Workspace

1. Iliad reads the file tree and active file normally.
2. Iliad treats the current Markdown content as the baseline.
3. Iliad loads persisted proposals and renders them as pending review artifacts.
4. Iliad does not diff the workspace against Git or create external proposals
   from pre-existing uncommitted changes.
5. If external capture is enabled, Iliad arms a live capture only after local
   editor state is saved, persisted proposals have finished loading, and no
   mutable proposals or agent runs are active.

### External Edit While Iliad Is Open

1. Iliad has an armed capture baseline.
2. An external tool changes, creates, or deletes visible Markdown files.
3. The watcher reports a Markdown event.
4. Iliad waits briefly for batched writes.
5. Iliad verifies the event is not caused by an Iliad-owned write.
6. Iliad compares the capture baseline with current disk content.
7. Iliad saves one proposal containing supported file changes.
8. Iliad restores disk to the capture baseline so the review UI has stable
   accept/reject semantics.
9. Iliad opens the first pending review target and restarts capture only after
   mutable review work is gone.

### External Commit While Iliad Is Open

If the workspace is Git-backed and Git `HEAD` changes during capture:

1. Iliad assumes an outside tool may have accepted changes outside Iliad.
2. Iliad must not restore files to the old capture baseline.
3. Iliad discards the active capture baseline.
4. Iliad refreshes the file tree and active document from disk when safe.
5. Iliad starts a new clean capture baseline after local state is saved.
6. Optional notice: external Git changes were accepted outside Iliad.

If Git is unavailable, not installed, or the workspace is not in a repository,
capture still works without Git guards.

## Git Policy

Do not use `git diff` as Iliad review input.

Use Git only for guardrails. Main process should expose a small helper with
this contract:

```ts
type GitAdvisorySnapshot =
  | { status: "unavailable"; reason: "git_missing" | "not_repo" | "unborn_head" | "timeout" | "error" }
  | { status: "ok"; repositoryRoot: string; head: string; indexIdentity: string };

type GitAdvisoryCheck =
  | { status: "ok" }
  | { status: "head_changed" }
  | { status: "index_changed" }
  | { status: "unsafe"; reason: "git_missing" | "timeout" | "error" };
```

Rules:

- record `git rev-parse --show-toplevel`, `git rev-parse HEAD`, and a cheap
  index identity at capture start when available;
- before destructive restore, re-check those values;
- if `HEAD` changed, return a `git_baseline_changed` result and do not restore;
- if the index identity changed but `HEAD` did not, continue only when the
  touched Markdown paths still match the captured post-change content exactly;
- if Git was unavailable, not a repository, timed out, or had an unborn `HEAD`
  at capture start, capture behaves as non-Git for that session;
- if a valid Git snapshot was captured at start, re-check failure before
  restore is unsafe and must not fail open.

This preserves the product rule: Git can say "do not undo this," but Git does
not say "show this as an Iliad change."

## Proposal Model

Extend file-level proposal kinds:

```ts
type AgentProposalFileChange =
  | AgentEditFileProposal
  | AgentCreateFileProposal
  | AgentDeleteFileProposal;

interface AgentDeleteFileProposal {
  id: string;
  kind: "delete_file";
  status: AgentProposalFileStatus;
  relativePath: string;
  baseHash: string;
  baseContent: string;
  unifiedDiff: string;
  error?: string;
}
```

Extend draft changes:

```ts
type AgentDraftFileChange =
  | EditDraft
  | CreateDraft
  | DeleteDraft;

interface DeleteDraft {
  kind: "delete_file";
  relativePath: string;
  baseHash: string;
  baseContent: string;
  unifiedDiff: string;
  summary: string;
}
```

Deletes are first-class proposal files:

- capture: deleted Markdown files become `delete_file` proposals;
- restore: the deleted file is restored to base content while pending review
  exists;
- file tree: pending delete appears as a red pending row or red badge on the
  real restored file;
- editor: deletion review uses `mode: "delete_file"` and renders `baseContent`
  as read-only all-red review content;
- accept: deletes the Markdown file from disk after stale checks;
- reject: marks the proposal file rejected and never mutates Markdown. In the
  normal live-capture path the base file is already restored by finalization, so
  rejecting leaves it intact. For old/stale proposals where the file is already
  missing, reject still remains state-only and must not resurrect old content.

Hunk-level delete acceptance is out of scope for MVP. Delete proposals are
accepted or rejected at file level only.

## Capture State Machine

Renderer state should be explicit:

- `idle`: no baseline exists.
- `arming`: flushing saves and asking main to snapshot.
- `armed`: baseline exists; waiting for external Markdown watcher events.
- `finalizing`: comparing snapshots, saving proposal, and restoring baseline.
- `suspended`: local unsaved editor changes, agent run, mutable proposal, or
  unloaded proposal state, mutable proposal, or unsafe Git transition prevents
  capture from being armed.

Rules:

- Starting capture never holds the workspace mutation lease.
- Restoring baseline always holds the workspace mutation lease.
- Iliad-owned writes must be tagged with a short-lived mutation marker so the
  watcher can ignore them.
- If the user starts typing while `armed` and no external event is pending,
  discard the in-memory capture and move to `suspended`; do not restore.
- If a watcher event is pending and the active editor becomes unsaved, wait for
  save or fail with a notice; do not overwrite unsaved text.
- Do not call `loadDocument` over unsaved local text.
- When mutable proposals exist, do not arm new capture. Pending review already
  owns the user's attention and disk state may intentionally be restored.
- Capture must not arm until proposal load state is `loaded`. An empty initial
  `agentProposals` array while `listProposals()` is still in flight is not
  enough.

## Main-Process Capture API

Existing IPC may remain, but finish responses need a Git-guard result:

```ts
type ExternalAgentCaptureFinishResponse =
  | { status: "proposal"; proposal: AgentChangeProposal; ... }
  | { status: "empty"; ... }
  | { status: "git_baseline_changed"; captureId: string; unsupportedNotes: string[] }
  | { status: "unsafe"; captureId: string; message: string; unsupportedNotes: string[] };
```

`unsupported_restored` should disappear once deletes are supported. Unsupported
cases should become `unsafe` when Iliad cannot restore confidently. A
`git_baseline_changed` or `unsafe` result clears the capture session without
restoring files.

## Editor Review Semantics

The editor must distinguish:

- real document buffer;
- virtual create/delete review buffer;
- edit review overlay on the real restored base file.

Edit review:

- current editor content must match reconstructed proposal content;
- stale review must show an explicit stale toolbar state, not silently remove
  the diff;
- selecting a review target must not reload the document to the wrong content
  after the review state is set.

Create review:

- virtual read-only file with all-green content.

Delete review:

- `mode: "delete_file"` read-only review over `baseContent`;
- file-level accept/reject actions only;
- the file tree row remains visible as pending delete until accepted/rejected.

## UI

- Writing assists toggle copy remains capture-oriented: `Capture external edits`.
- File-tree pending strip remains the place that explains persisted proposals.
- Pending create rows use green styling.
- Pending edit rows use amber styling.
- Pending delete rows/badges use red styling.
- A pending row is always a review artifact, not necessarily a real disk file.
- Bulk discard rejects proposals only; it must not save or mutate Markdown files.
- Bulk discard of delete proposals is state-only and must not restore missing
  files from old proposal artifacts.

## Implementation Plan

1. Add the superseding proposal/delete types in main and renderer type files.
2. Update `markdownChangeContract` and `proposalStore` to build, apply, reject,
   stale-check, and recompute delete proposals.
3. Update `markdownCapture` to emit delete drafts and restore deleted files as
   normal reviewable changes instead of unsupported notes.
4. Add a small Git advisory helper in main. Capture Git identity at start and
   verify before restore.
5. Replace implicit capture effects in `App` with a single explicit lifecycle
   helper or reducer matching the state machine.
6. Add a main-process Iliad-owned write marker API used by all filesystem
   mutation paths. The marker should cover renderer IPC file writes and
   main-process proposal/capture writes, and the workspace watcher should tag or
   ignore matching events.
7. Update pending file-tree helpers and `FileTree` styling for deletes.
8. Update editor review derivation/rendering for delete proposals and stale edit
   visibility.
9. Keep old persisted edit/create proposals compatible. Delete proposals only
   appear after this change.

## Key Tests

### Main Process

- Opening a Git-dirty workspace and starting capture creates no proposal when no
  live changes occur.
- External edit while capture is armed creates an edit proposal and restores the
  base file.
- External create while capture is armed creates a create proposal and removes
  the new file until accepted.
- External delete while capture is armed creates a delete proposal and restores
  the deleted file until accepted.
- Accepting a delete proposal removes the file.
- Rejecting a delete proposal is state-only and leaves the restored file intact
  when it exists.
- Rejecting an old delete proposal for an already-missing file does not recreate
  the file.
- If Git `HEAD` changes between capture start and finish, finish returns
  `git_baseline_changed`, does not restore, and clears the capture session.
- If a valid Git snapshot was captured at start and Git cannot be re-checked
  before restore, finish returns `unsafe` and does not restore.
- If only the Git index identity changes and touched paths still match the
  captured post-change content, finish may proceed.
- If only the Git index identity changes and a touched path drifted, finish
  returns `unsafe` and does not restore.
- If touched paths change again before restore, finish returns or throws an
  unsafe result and performs no partial restore.
- Capture restore obtains the workspace mutation lease; observing does not.

### Renderer / App

- On workspace load, persisted pending proposals render in the pending-review
  strip but pre-existing disk changes do not create new proposals.
- Capture does not arm until `listProposals()` has resolved for the workspace.
- A slow `listProposals()` that later returns mutable proposals prevents arming.
- Capture does not arm while save status is `unsaved`, an agent run is active,
  or mutable proposals exist.
- Local editor typing while armed discards/suspends capture without restoring
  disk.
- Iliad-owned saves do not trigger external proposals.
- Iliad-owned proposal accept, delete accept, create/rename/trash actions, image
  insertion, and capture restore do not trigger external proposals.
- If a watcher event is pending and the user types before finalization, Iliad
  does not call `loadDocument`, does not restore over unsaved text, and surfaces
  a notice or unsafe result.
- External edit on the active file opens review with visible diff decorations.
- Stale edit review shows the stale toolbar state rather than silently hiding
  the review.
- External create appears as a green virtual file tree row and opens all-green
  read-only review.
- External delete appears as a red pending delete row/badge and opens all-red
  review.
- Bulk discard rejects proposal state without calling `flushSave`.

### File Tree Helpers

- `buildPendingFileTreeChanges` includes `delete_file`.
- Real files with pending delete are decorated as pending delete.
- Missing files with pending delete are shown as virtual red rows.
- Parent folders containing pending delete descendants show pending markers.
- Newest proposal wins when multiple proposals target the same path, including
  delete-vs-edit collisions.

### Editor Review

- Delete review hunks are generated from `baseContent` to empty content.
- Delete review renders removed lines and no inserted lines.
- Delete review exposes file-level accept/reject only.
- Create review remains read-only and all-green.
- Edit review remains editable outside blocked review ranges only where current
  behavior already allows it.

## Rollout Notes

- This is a behavior correction for an unshipped/unmerged capture feature, so no
  migration prompt is required.
- Persisted old proposals are still valid because edit/create shapes remain
  compatible.
- If old external-agent proposals exist from development, users can discard them
  through the pending-review strip.
