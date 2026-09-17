# Workspace Baseline Review

Date: 2026-09-01
Status: implemented (2026-09-01)

Supersedes, where behavior conflicts:

- `specs/2026-06-17-external-agent-change-capture.md`
- `specs/2026-06-20-always-on-external-filesystem-review.md` (implementation
  sections; product decisions are kept unless listed under "Changed
  decisions")
- `specs/2026-06-21-contextual-external-review-strip.md` (transport only)

## Review

The draft was reviewed by Codex (gpt-5.6, reasoning effort xhigh) with four
lenses: state machine and data model, filesystem and concurrency, Codex
hardening, product and scope. All thirteen findings were accepted. The changes
they produced are marked "(review)" below. In short:

- Codex runs now write a durable recovery journal before the sandbox opens, and
  stale journals are restored and converted to proposals on the next attach.
- Every accepted Markdown write goes through one serialized, identity-checked
  compare-and-swap primitive in main; `expectedHash` alone was not safe.
- Cancel and timeout enter a termination state that keeps handlers and the
  lease alive, interrupts the turn, waits for a terminal notification, and
  resets the app-server process if that fails, before any restore.
- The editor conflict is a separate mode with the writer's buffer visible and
  editable, not the existing read-only review view made editable.
- Watcher errors restart with backoff and force a full scan; attach after zero
  subscribers reconciles before answering.
- The baseline-write table uses the exact persisted create content, folder
  moves reconcile both prefixes, and the legacy `applyPatch` /
  `applyNewDocument` surface is deleted.
- Iliad mutations hold an in-flight lock in the baseline service; markers stay
  attribution hints only.
- Restore helpers validate and restore per path and report `unrestored[]`.
- Scoped refreshes are limited to `change` events on known regular Markdown
  files; everything else is a full scan; create and delete items need a second
  observation.
- Pull and push both carry a revision and the renderer discards older results.
- Git advisory state is captured when the reviewed path/hash set changes.
- The follow-up sketch is reframed as an attributed external-review source that
  needs an ADR before model output may persist before acceptance.

## Why

Iliad has two review pipelines that answer the same question, "what changed on
disk relative to the version Iliad last reviewed?", and both answer it badly in
the moments that matter:

- The external review baseline lives only in the renderer-driven capture
  session. Main never updates it on Iliad writes, so the renderer cancels the
  whole session whenever the editor is dirty (`src/App.tsx`, effect on
  `saveStatus === "unsaved"`). An outside write that lands while the writer is
  typing is folded into the next baseline and never shown. Typing in file B
  deletes the pending review of file A in main and leaves a ghost proposal in
  the renderer whose actions fail with "Proposal not found".
- Watcher events that match an Iliad mutation marker or the Codex lease are
  dropped instead of deferred (`electron/ipc/workspace.ts`). Iliad renames and
  Codex runs leave the baseline stale.
- Autosave has no disk conflict check (`src/app/useDocumentPersistence.ts`). A
  dirty buffer silently overwrites an outside edit.
- The Codex runtime writes to the real workspace and Iliad restores files
  afterwards, but restore runs only on the success path
  (`electron/agent/runtime/codexAppServerProvider.ts`). Cancel, the 300 s
  timeout, and app-server death leave Codex writes on disk with no proposal,
  and no `turn/interrupt` is ever sent, so Codex keeps writing after cancel.
  Restore itself stops at the first mismatch after already restoring earlier
  files. An Iliad crash mid-run loses the snapshot entirely.
- `proposalStore.ts` flips hunks to `accepted` before the disk write. A failed
  write leaves the proposal permanently inconsistent.
- `useAgentProposals.ts` loads applied content into whichever file is active
  after two awaits, so navigating during an accept pushes another file's text
  into the new buffer.
- Rejecting an outside-created file renames it into `userData`, which is not
  the system Trash the label promises and fails across volumes.

The product direction decided on 2026-09-01 is that disk review is the engine
and the chat panel is a thin, optional client on top of it. This spec builds
that engine as a main-process service and fixes the data-loss paths in the
existing internal-agent flow. It does not route Codex writes through the new
engine; see "Out of scope".

## Goals

1. One main-process owner for the accepted workspace state (the "baseline") and
   for the external review derived from it. The renderer subscribes; it does
   not drive the lifecycle.
2. Every Iliad-owned write updates the baseline in main, per path, inside the
   same serialized operation that performs the write.
3. Watcher hints are never dropped. Marker, lease, and in-flight mutation
   suppression defer reconciliation; they do not cancel it.
4. Concurrent edits to one file (dirty buffer plus outside write) are refused
   at the write boundary and surfaced as a decision, never resolved by
   last-writer-wins.
5. Codex runs restore captured writes on every exit path, including an Iliad
   crash, and report any path they could not restore.
6. The proposal store marks hunks only after the write succeeds, and the
   renderer never loads applied content into a different file.
7. Rejected outside-created files go to the system Trash.

## Non-goals and out of scope

- Routing Codex file changes through the baseline instead of snapshot/restore.
  See "Follow-up: Codex as an attributed external-review source".
- Persisting the baseline across app restarts. The baseline stays
  session-scoped (captured on workspace open). The service API is written so a
  persisted store can be slotted in later.
- Hunk-level keep/restore for outside edits. Outside review stays file-level.
- Rename detection for outside moves. They remain delete plus create.
- Non-Markdown files.
- Removing or slimming the chat panel.
- Consolidating the duplicated path validators and diff builders across
  `electron/agent/`. Listed as a follow-up.

## Changed decisions

Relative to `specs/2026-06-20-always-on-external-filesystem-review.md`:

- There is no capture session, capture id, or start/finish/cancel IPC. The
  baseline exists for as long as a window has the workspace open.
- Git advisory state is captured on workspace open, whenever the reviewed
  path/hash set changes, and after each destructive outside-review action. It
  is checked only before destructive writes (review).
- A dirty editor buffer no longer pauses or cancels outside review. It is a
  per-path conflict handled at write time.
- Outside review of the active file no longer requires the editor to be saved
  first. Refresh runs regardless; the editor's buffer is protected by the
  write primitive instead.

## Architecture

### `WorkspaceBaselineService` (new, `electron/review/workspaceBaseline.ts`)

One instance per app, keyed by canonical workspace root. It owns:

```ts
interface WorkspaceBaselineState {
  workspaceRoot: string;                  // canonical
  baseline: Map<string, BaselineEntry>;   // relativePath -> { content, hash }
  review: Map<string, ExternalReviewItem>;// derived, keyed by relativePath
  reviewRevision: number;                 // bumps on every review change
  gitSnapshot: GitAdvisorySnapshot;
  refresh: {
    timer: NodeJS.Timeout | null;
    pendingPaths: Set<string> | null;     // null => full scan requested
    inFlight: Promise<void> | null;
    rerunRequested: boolean;
  };
  mutationsInFlight: number;              // Iliad-owned writes in progress
  writeQueue: Promise<void>;              // serializes guarded writes
  subscribers: Set<WebContents>;
  releaseTimer: NodeJS.Timeout | null;    // grace period after last detach
}

interface ExternalReviewItem {
  relativePath: string;                   // POSIX, normalized
  kind: "edit" | "create" | "delete";
  baselineContent: string | null;         // null for create
  baselineHash: string | null;
  diskContent: string | null;             // null for delete
  diskHash: string | null;
}
```

`ExternalReviewItem` is the internal record. The renderer keeps receiving the
existing `AgentChangeProposal` shape with `metadata.kind === "external_filesystem"`,
built by a pure projection function (`projectExternalReview(state)`), so the
review UI, file tree overlay, and review queue keep working unchanged. Proposal
and file ids stay stable per workspace and path
(`proposal-external-filesystem-<workspace fingerprint>` and
`external-file-<path hash>`), which is what the renderer already assumes.

Public API (paths are workspace-relative POSIX unless noted):

```ts
class WorkspaceBaselineService {
  attach(workspaceRoot: string, sender: WebContents): Promise<ExternalReviewSnapshot>;
  detach(workspaceRoot: string, sender: WebContents): void;

  // Hints from the watcher. Never dropped.
  noteDiskChange(workspaceRoot: string, hint: { relativePath: string | null; eventType: "change" | "rename" | "unknown" }): void;
  noteWatcherRestarted(workspaceRoot: string): void;

  // Iliad-owned mutation wrapper: holds the in-flight lock, marks paths, runs
  // the operation, records the baseline from the operation's result, then
  // schedules reconciliation of the affected paths.
  runIliadMutation<T>(workspaceRoot: string, options: {
    paths: string[];                      // relative paths touched
    operation: () => Promise<T>;
    record: (result: T) => BaselineRecord[]; // what to record on success
  }): Promise<T>;

  // The only accepted way to write Markdown that must respect the baseline.
  writeMarkdownIfUnchanged(workspaceRoot: string, request: {
    relativePath: string;
    content: string;
    expected: { kind: "absent" } | { kind: "hash"; hash: string } | { kind: "any" };
  }): Promise<{ status: "written" } | { status: "conflict"; reason: "pending_review" | "disk_changed" | "unsafe_path" }>;

  // Review actions (dispatched from AgentService when the proposal id matches).
  keep(workspaceRoot: string, relativePath: string): Promise<ExternalReviewActionResult>;
  restore(workspaceRoot: string, relativePath: string): Promise<ExternalReviewActionResult>;
  restoreAll(workspaceRoot: string): Promise<ExternalReviewActionResult>;

  currentReview(workspaceRoot: string): ExternalReviewSnapshot;
  refreshNow(workspaceRoot: string): Promise<void>;
}

interface ExternalReviewSnapshot {
  workspaceRoot: string;
  revision: number;
  proposal: AgentChangeProposal | null;
}

type BaselineRecord =
  | { op: "set"; relativePath: string; content: string }
  | { op: "remove"; relativePath: string }
  | { op: "move"; fromRelativePath: string; toRelativePath: string; directory: boolean }
  | { op: "reconcile"; relativePath: string };
```

### Guarded write primitive (review)

`writeMarkdownIfUnchanged` is the single compare-and-swap for accepted Markdown
writes. It runs on the workspace's `writeQueue`, so writes for one workspace
are serialized with each other and with review actions:

1. Normalize the path; reject hidden, ignored, absolute, escaping, and
   non-Markdown paths.
2. `lstat` every ancestor from the workspace root down and the target itself.
   Reject symlinks, non-regular targets, and directory replacements.
3. If the path has a pending review item, return `conflict/pending_review`.
4. Read the current content (or note absence). Compare against `expected`:
   `absent` requires no file; `hash` requires an existing file with that hash;
   `any` skips the check (used only by restore actions, whose own hash checks
   ran one step earlier on the same queue).
5. Write with `writeFile(path, content, { flag: "r+" | "wx" })` matching the
   expectation, so a file that appears or disappears between step 4 and the
   write fails instead of being clobbered. On `EEXIST`/`ENOENT` return
   `conflict/disk_changed`.
6. Record the baseline entry, then release the queue slot.

Callers: editor saves (`file:write-markdown`), proposal store writes (edit,
hunk, create, delete), and restore actions. `proposalStore.ts` receives a
`markdownWriter` in its constructor and no longer imports `writeFile`
directly. Delete goes through the same queue with an `rm` guarded by the same
identity checks.

### Lifecycle

- `attach` is called from the `workspace:watch` IPC handler, which is the
  moment a window commits to a workspace. First attach for a root runs the
  Codex journal recovery (see "Codex runtime hardening"), then takes a full
  Markdown snapshot as the baseline and captures the git advisory snapshot.
  Attach after the subscriber count dropped to zero (a renderer reload inside
  the grace period) runs a full reconcile before returning the current review
  (review). Attach returns the current `ExternalReviewSnapshot`.
- `detach` is called from `workspace:unwatch` and on `webContents` destroy.
  When the last subscriber leaves, the state is dropped after a 5 s grace
  period so a renderer reload does not lose the baseline.
- App quit disposes everything.

### Watcher (review)

`electron/ipc/workspace.ts` keeps one `fs.watch` per window but forwards every
Markdown-relevant event to `noteDiskChange`, regardless of markers or lease.
The renderer-facing `workspace:changed` (tree refresh) keeps its current marker
gating. On watcher `error`, the watcher is recreated with bounded backoff
(500 ms, 1 s, 2 s, 4 s, capped at 8 s, reset on 30 s of health) and
`noteWatcherRestarted` forces a full scan before the watcher is considered
healthy. If recreation keeps failing, the state stays "unwatched" and the
renderer is told through the existing change event with `watcherDegraded:
true` so it can show a quiet notice.

### Refresh loop

There is exactly one refresh loop per workspace, in main.

1. `noteDiskChange` adds the hint to `pendingPaths` and (re)starts a settle
   timer of 1200 ms. Scoped refresh is allowed only for `change` events whose
   filename resolves to a path that is a regular Markdown file in the baseline
   or on disk at the last refresh. Any `rename` event, unknown filename,
   ignored or temporary name (atomic-save patterns), watcher restart, or first
   refresh after attach sets `pendingPaths = null` (full scan) (review).
2. When the timer fires and either the Codex lease is held or
   `mutationsInFlight > 0`, the refresh is deferred and the timer re-armed for
   1000 ms. Codex's own restore happens before the lease is released, so nothing
   transient is shown. Anything Codex could not restore is picked up once the
   lease clears.
3. The refresh reads disk for `pendingPaths` only or walks the whole visible
   Markdown tree. A scoped path that turns out to be a directory, symlink, or
   unsafe ancestor upgrades the refresh to a full scan.
4. Classification per path:

   | Baseline | Disk | Item |
   | --- | --- | --- |
   | absent | absent | none |
   | absent | regular file | create |
   | regular file | absent | delete |
   | regular file | same content | none |
   | regular file | different content (including empty) | edit |
   | any | symlink, directory, hidden, ignored, unsafe ancestor | unsafe path drift; item removed, note logged |

   A path that classifies as `create` or `delete` is published only after a
   second observation 300 ms later agrees (review). Edits publish on the first
   observation.
5. Items are stored, `reviewRevision` bumps only if the projected review
   actually changed (compared by path plus hashes), and every subscriber gets
   `agent:external-review-changed` with the full `ExternalReviewSnapshot`. When
   the path/hash set changed, the git advisory snapshot is recaptured (review).
6. If a refresh is requested while one is in flight, `rerunRequested` is set
   and the loop runs once more after the current pass. Pending paths from both
   requests are merged.

### Baseline updates from Iliad writes

Every write handler wraps its operation in `runIliadMutation`, which records
after the underlying operation succeeds and before returning to the renderer:

| Handler | Baseline record |
| --- | --- |
| `file:write-markdown` | through `writeMarkdownIfUnchanged`; `set(path, content)` |
| `file:create-markdown` | `set(path, <exact content written>)`; `createMarkdownFile` returns the content it wrote (review) |
| `file:duplicate` (Markdown) | `reconcile(newPath)` (re-read from disk) |
| `file:rename`, `file:move` (file) | `move(from, to)` |
| `file:rename`, `file:move` (folder) | `move(from, to, directory: true)`: every baseline entry and every pending review item under the old prefix moves to the new prefix, then both prefixes are reconciled (review) |
| `file:trash` (file) | `remove(path)` |
| `file:trash` (folder) | `remove` for every entry under the prefix |
| assistant proposal apply (edit, hunk, create) | through `writeMarkdownIfUnchanged`; `set(path, resultingContent)` |
| assistant proposal apply (delete) | guarded `rm`; `remove(path)` |
| Tighten / selection tools | nothing; they edit the buffer and go through autosave |
| image assets | nothing; non-Markdown |

Legacy `applyPatch` and `applyNewDocument` (service, IPC, preload, types) are
deleted in this change; they have no renderer callers (review).

Structural operations (rename, move, trash) on a path that has a pending
outside item go ahead; the item is moved or removed with the baseline entry
and the affected paths are reconciled, so the review reflects the new disk
truth rather than blocking the user.

### Editor save and conflict mode

`file:write-markdown` takes `expected` from the renderer: `{ kind: "hash",
hash }` for a file the renderer loaded or last saved, computed as SHA-256 of
`savedText` (same algorithm as main's `hashMarkdown`; both already use SHA-256
of UTF-8). The renderer never sends `any`. When the renderer has no trusted
identity for the path it does not write; it re-reads and shows the conflict
(review). Persistence owns that identity: `loadDocument` establishes it from
the text it is given, which the callers guarantee equals disk (open reads
disk; proposal apply returns the content it wrote; keep reloads from disk),
and rename/move relocate it without changing it.

Main returns `conflict` instead of throwing, with the reason. The renderer
(`useDocumentPersistence.ts`) then enters **conflict mode** (review):

- `saveStatus` becomes `"conflict"`. The buffer is kept exactly as typed.
  Typing while in conflict keeps the status `conflict` and does not re-arm
  autosave. `documentCloseRequiresChoice` treats `conflict` like `unsaved`.
- The editor keeps showing `documentText`, editable, with no review diff
  overlay. A narrow conflict banner above the editor says the file changed
  outside Iliad and offers **Restore previous version** and **Keep outside
  changes**. The outside review item still exists in the review queue and file
  tree; selecting it from the tree opens the normal read-only review of the
  disk content (which is safe because it does not touch the buffer).
- **Restore previous version** calls the external restore action. Disk now
  equals `savedText`, so the renderer sets `saveStatus` to `unsaved`, re-arms
  autosave, and the writer's edits win. The buffer is not reloaded.
- **Keep outside changes** asks for confirmation ("Your unsaved edits in this
  file will be discarded.") and then calls the external keep action, then
  reloads the editor from disk. This is the only path that discards the
  buffer.
- If the outside item for that path disappears on its own (the outside tool
  reverted the file), the next review push clears the conflict: the renderer
  sets `saveStatus` to `unsaved` and retries the save once.

Every `flushSave` caller that treats a throw as "stop navigation" keeps
working: a conflict result throws a typed `DocumentConflictError` from
`saveCurrentDocument`, so open/rename/trash/switch stop exactly as they do for
other save failures, and the conflict banner explains why.

### Review actions

`AgentService.applyProposalFile`, `rejectProposalFile`, and `rejectProposal`
keep their IPC shape. When the proposal id equals the external review id for
that workspace they dispatch to the baseline service; otherwise to the proposal
store.

- `keep(path)`: on the write queue, re-read disk, confirm it matches the
  reviewed hash (refresh and return `stale` otherwise), then `set` or `remove`.
  No disk write.
- `restore(path)`: on the write queue, git advisory check, re-read disk and
  confirm the reviewed hash, then for edit and delete write the baseline
  content back through the guarded primitive with `expected: any`; for create
  move the file to the system Trash with `shell.trashItem`. If `trashItem`
  fails, the action fails with a clear message and nothing is deleted. Then
  reconcile the path.
- `restoreAll`: validate every item first (hash and safety), then act on each,
  continuing past individual failures, then reconcile all. The result lists
  restored and unrestored paths.

After every action the service refreshes the affected paths and pushes the new
snapshot, so the renderer never has to guess the post-action state.

### IPC and preload

Removed: `agent:external-capture-start`, `agent:external-capture-finish`,
`agent:external-capture-cancel`, `agent:apply-patch`,
`agent:apply-new-document`, their preload methods, the
`ExternalAgentCapture*` and legacy apply types, and the `externalCapture`
strings.

Added:

- `agent:get-external-review` (`workspaceSessionId`) returns the current
  `ExternalReviewSnapshot`. Trusted sender and session checks as the removed
  handlers had.
- `agent:external-review-changed` push event carrying an
  `ExternalReviewSnapshot`, exposed as
  `window.iliad.agent.onExternalReviewChanged(listener)` returning an
  unsubscribe function, mirroring `onRunEvent`.
- `file:write-markdown` accepts `expected` and returns
  `{ status: "written", savedAt } | { status: "conflict", reason }`.
- `agent:apply-proposal-file`, `agent:reject-proposal-file`,
  `agent:reject-proposal`, `agent:resolve-proposal-hunk` gain the trusted
  sender check the capture handlers had.

### Renderer

`src/App.tsx` loses the seven external-capture effects, the timers, the
`externalCapture` state, and `debugExternalCapture`. It gains one effect that
subscribes to `onExternalReviewChanged` for the current workspace and one
initial `getExternalReview` call after proposals load. Both feed a single
handler in `useAgentProposals`:

```ts
applyExternalReviewUpdate(snapshot: ExternalReviewSnapshot): void
```

which ignores snapshots for another workspace or with a revision lower than
the last applied one (review), replaces or removes the external proposal in
`agentProposals`, clears `agentReviewTarget` if it pointed at a removed
external file, refreshes the file tree when the item set changed by path, and
auto-selects the review target for the active file using the existing
`externalReviewTargetForActiveFile` and `externalActiveFileAutoSelectionDecision`
helpers, except when the active file is in conflict mode (then the banner owns
the decision). When the active file's item disappears and the editor was in
the read-only review view, the editor reloads from disk as it does today.

`useAgentProposals.applyAgentProposalFile` and `resolveAgentProposalHunk`
compare the active file's relative path after the IPC await, using
`activeFileRelativePathRef`, before calling `loadDocument`.

### Codex runtime hardening

**Recovery journal (review).** Before `thread/start` with a `workspace-write`
sandbox, the provider writes
`userData/assistant/codex-runs/<runId>.json` containing the workspace root,
run id, timestamp, and the pre-run snapshot (path, hash, content for every
visible Markdown file). The journal is deleted after restore completes. On
first `attach` for a workspace, `AgentService.recoverCodexRunJournals` reads
every journal for that root, diffs the journal snapshot against disk, restores
the journal content for every changed or missing path whose current disk
state is a regular file or absent, saves the disk content as a persisted
proposal with `source.kind = "codex_app_server"` and the journal's run id, and
then deletes the journal. Paths that cannot be restored safely are left on
disk and logged; they surface as outside changes once the baseline is taken.
Journals older than 7 days whose workspace no longer exists are pruned.

**Termination state (review).** Abort and the 300 s completion timeout no
longer reject `completion` directly. They enter `terminating`:

1. Keep the request and notification handlers and the lease.
2. Send `turn/interrupt` (`{ threadId, turnId }`) through a new
   `CodexAppServerClient.interruptTurn`. If ids are unknown because
   `turn/start` timed out, skip to step 4.
3. Wait up to 10 s for a terminal `turn/completed` notification for this turn
   (any status, including `interrupted`).
4. If no terminal notification arrived, call `client.resetTransport()`, which
   kills the app-server process and rejects pending requests. The next client
   call re-spawns it.
5. Only then run reconcile and restore, release the lease, and detach
   handlers. The run fails with `request_canceled` or `request_timeout` as
   before.

Transport `exit` or `error` during a run rejects `completion` immediately
through a new `client.onClosed` subscription; the provider then goes straight
to step 5.

**Guaranteed, per-path restore (review).** Reconcile and restore run on every
exit after `preRunSnapshot` exists. `codexFileChangeCapture.ts` gains
`validateCapturedRestore` and `restoreCapturedSafely` that evaluate and apply
each path independently and return `{ restored: string[], unrestored: Array<{
relativePath, reason }> }`. Success keeps the current draft conversion. Every
other exit restores, then rethrows the original error with the unrestored
paths attached to the diagnostic event and to the user-facing message
("Codex changed these files and Iliad could not restore them; they now appear
as outside changes: ..."). After restore the provider requests a full baseline
refresh for the workspace before releasing the lease.

### Proposal store ordering

In `applyProposalFile` (edit) and `resolveProposalHunk`, compute the next
content from a copy of the hunk statuses, write it through the guarded
primitive, and only then commit the statuses to the stored proposal. On write
failure or conflict the stored hunks are untouched, `file.status` becomes
`failed` (or `stale` on `disk_changed`) with the error, and the next attempt
reconstructs the same expected content.

## Files

Main:

- new `electron/review/workspaceBaseline.ts` (service, refresh loop,
  classification, guarded write, review actions)
- new `electron/review/externalReviewProjection.ts` (pure projection to
  `AgentChangeProposal`)
- new `electron/agent/runtime/codexRunJournal.ts`
- `electron/agent/agentService.ts`: delete the capture session code and the
  legacy apply APIs; dispatch external actions to the service; journal
  recovery; pass the guarded writer to the store
- `electron/agent/proposalStore.ts`: ordering fix; writes through the injected
  writer
- `electron/agent/runtime/codexAppServerProvider.ts`,
  `codexAppServerClient.ts`, `codexFileChangeCapture.ts`: journal,
  termination state, close propagation, per-path restore
- `electron/ipc/workspace.ts`: forward hints; attach/detach; watcher restart
- `electron/ipc/files.ts`: `runIliadMutation`; `expected`
- `electron/fs/fileOps.ts`: `createMarkdownFile` returns its content
- `electron/ipc/agent.ts`: remove capture and legacy handlers; add
  get/subscribe; trusted sender checks on proposal actions
- `electron/preload.ts`, `electron/main.ts` (service construction and wiring)

Renderer:

- `src/types/iliad.ts`
- `src/App.tsx`: remove capture state machine; subscribe; conflict banner
- `src/app/useAgentProposals.ts`: `applyExternalReviewUpdate`; active-path
  guard after awaits
- `src/app/useDocumentPersistence.ts`: `expected`, `conflict` status,
  `DocumentConflictError`
- `src/i18n/strings.ts`: remove capture strings; add conflict copy
- `src/components/EditorPane.tsx`: no change in review wiring; conflict mode
  renders the plain editor
- `src/styles/`: conflict banner styles in the responsibility file for the
  editor toolbar

Docs:

- `docs/architecture.md`: replace the external capture description with the
  baseline service; note the conflict boundary under "Save and Navigation
  Safety"
- `docs/internal-agent-review-workflow.md`: update the regression matrix

## Tests

Main (`tests/review/workspaceBaseline.test.ts`, replacing
`tests/agent/externalAgentCapture.test.ts`):

- attach captures baseline; outside edit, create, delete, and clear classify
  correctly; return-to-baseline removes the item
- create/delete need a second observation; a transient atomic-save delete does
  not publish
- hinted `change` refresh touches only hinted paths; `rename` and unknown
  hints trigger a full scan; a hinted path that became a directory upgrades to
  a full scan
- refresh during Codex lease or in-flight mutation is deferred and runs after
- coalescing: a refresh requested during an in-flight refresh runs once more
- `runIliadMutation` records after success and reconciles after failure;
  folder move relocates entries and pending items; trash removes
- `writeMarkdownIfUnchanged` returns `pending_review`, `disk_changed` (hash
  mismatch, file appeared, file vanished), `unsafe_path` (symlink target,
  symlink ancestor), and `written`
- keep advances baseline without writing; restore writes baseline content;
  restore of a created file calls `trashItem` and fails cleanly when it
  throws; `restoreAll` continues past failures and reports them
- git HEAD change blocks restore once and the review is refreshed
- subscribers receive a snapshot with a higher revision only when the review
  changed; detach then attach with a write in between reconciles first;
  watcher error restarts and full-scans

Codex (`tests/agent/codexAppServerProvider.test.ts`,
`codexFileChangeCapture.test.ts`, new `codexRunJournal.test.ts`):

- journal exists during the turn and is gone after restore
- recovery restores changed files from a stale journal and persists a proposal
- abort sends `turn/interrupt`, waits for `turn/completed`, restores
- abort without a terminal notification resets the transport, then restores
- timeout follows the same path
- transport close rejects the run promptly and restores
- per-path restore reports unrestored paths and still restores the rest

Proposal store (`tests/agent/proposalStore.test.ts`):

- a write failure during file accept leaves hunks pending and a retry succeeds
- the same for hunk resolve; a `disk_changed` conflict marks stale

Renderer (`tests/app/`):

- `useDocumentPersistence` handles conflict: status `conflict`, buffer
  preserved, typing keeps `conflict`, no autosave re-arm, restore returns to
  `unsaved` and saves, keep reloads, item disappearance retries once
- `applyExternalReviewUpdate` replaces, removes, clears the target, ignores
  stale revisions and other workspaces, auto-selects for the active file
- `applyAgentProposalFile` does not call `loadDocument` when the active file
  changed during the await

IPC (`tests/agent/agentIpc.test.ts`): capture and legacy handlers gone;
get-external-review rejects untrusted senders; proposal action handlers reject
untrusted senders.

## Manual QA

Run live on 2026-09-01 against the built app driven over the Chromium
debugging port: outside edit and outside create appear as review items with
tree markers; Keep advances the baseline without writing; rejecting an
outside-created file lands it in the macOS Trash; typing while an outside tool
edits the same file shows the conflict banner with the buffer editable; Restore
keeps the typed text and saves it; Keep discards after confirmation; an
Iliad-created document produces no outside item. The live run caught one race
(the conflict flag was read after the refresh had already cleared it, so
Restore reloaded from disk and lost the buffer); it is fixed by reading the
flag before any await. Codex cancel and force-quit cases were covered by unit
tests only.

The systematic run on 2026-09-02 (`docs/outside-changes-qa-matrix.md`) found
two more defects. Keep left the editor on the discarded buffer and the next
keystroke autosaved it over the kept version; the cause was outside this
spec: `@uiw/react-codemirror` deferred external value updates behind a typing
latch, so the editor is now hosted by Iliad with a synchronous document sync
(`src/editor/CodeMirrorHost.tsx`, see `docs/architecture.md` "Editor Host").
And an internal proposal on a path with a pending outside item reported
generic drift and stayed stale after Restore; the proposal store now asks the
guarded writer for pending review first (`hasPendingReview`) and revives stale
hunks when disk matches the proposal again.

The X cases (from the Codex review of the matrix) found three more. A file
replaced by a folder produced no delete item (the confirmation pass read the
path as unsafe); `readDiskPathState` now treats that folder as the file being
absent, so the delete shows and Restore is refused visibly. Rejecting an
outside-created file had a 3-7 ms window in which a newer outside write went
to the Trash unreviewed; the file is now renamed into a hidden sibling folder
first (atomic), verified against the reviewed hash, and trashed from there,
so a writer that opens the path afterwards creates a new file that becomes a
new create item. And a losing Reject all (the other window won) returned a
silent success; `restoreAll` reports stale when nothing it was asked to
restore is left, and the renderer shows the refreshed-review notice.

Use a disposable workspace. In addition to the external regression cases in
`docs/internal-agent-review-workflow.md`:

1. Type continuously in file A while an outside tool edits file A. Confirm the
   conflict banner appears, the typed text stays editable, Restore keeps the
   typed text and saves it, and Keep asks before discarding.
2. Type in file B while an outside tool edits file A. Confirm A's review
   appears and B saves normally.
3. Rename a folder in Iliad, then edit a file inside it outside Iliad. Confirm
   only that edit appears as outside change.
4. Start a Codex run that edits two files and cancel it mid-run. Confirm disk
   is restored, no review appears, and the transcript shows the cancel.
5. Kill the `codex` process during a run. Confirm the run fails promptly and
   disk is restored.
6. Force-quit Iliad during a Codex run that has already written a file. Reopen
   the workspace. Confirm the file is restored and a Codex proposal is pending.
7. Reject an outside-created file. Confirm it is in the macOS Trash.
8. Accept an internal proposal file while `chmod 444` on the file. Confirm the
   proposal shows failed and a retry after `chmod 644` succeeds.
9. Save a file in Iliad with an atomic-save editor (VS Code, BBEdit) open on
   the same workspace and confirm no spurious create/delete items appear.

## Follow-up: Codex as an attributed external-review source

The next step in the product direction lets Codex, or any harness, write to
the workspace and lets the baseline review carry attribution (which run, which
tool) and hunk-level keep/restore derived from `diff(baseline, disk)`. That
conflicts with the current `agent-vision.md` rule that model-authored changes
must not persist before acceptance, and with this spec's rule that Iliad-owned
writes advance the baseline. It therefore needs its own ADR that updates
`agent-vision.md` first, and a spec that decides baseline persistence in
`userData`, attribution records, and the editor's review rendering when the
buffer equals disk. This spec keeps the service's records and projection free
of capture-session concepts so that work is additive (review).

## Other follow-ups

- Consolidate the eight path validators, three diff builders, and four
  apply-to-text implementations under `electron/agent/markdownChangeContract.ts`.
- The run-event subscription in `useAssistantRun.ts` re-subscribes on language
  change; move labels out of its dependency list.
- Delete the `tool_call` proposal source and the unused `baseHash` on run
  requests.
