# Internal Agent Review Integrity

Date: 2026-06-21
Status: reviewed; ready for implementation

Related specs:

- `specs/2026-05-23-core-agent-proposal-architecture.md`
- `specs/2026-05-23-document-native-review-ui.md`
- `specs/2026-06-20-always-on-external-filesystem-review.md`
- `specs/2026-06-21-contextual-external-review-strip.md`

## Review Panel

This spec was reviewed by four external agents:

- product/UX review;
- state-machine and data-model review;
- implementation-risk review;
- QA and live visual-test review.

Accepted review changes are incorporated below:

- source is first-class in the review queue model;
- the sidebar strip uses source-aware counts and bulk actions;
- same-run same-path internal duplicates are treated as a creation bug with a
  defensive UI grouping fallback;
- different-run same-path internal proposals stay separately reachable;
- mixed internal/external changes on the same path are explicitly blocked until
  live disk drift is resolved;
- deterministic fixtures are required before live LLM visual smoke tests;
- the external regression matrix and reset contract are part of this spec, not
  a vague final step.

## Problem

The external filesystem review work improved live outside-agent workflows, but
it also exposed weaknesses in the internal assistant proposal flow.

Observed in the app:

- A single request to the internal assistant to add more formulas produced two
  duplicate-looking `Pending changes` cards in the assistant panel for
  `research/excel-formulas.md`.
- The file tree/editor showed one changed path while the assistant panel showed
  two proposal cards, so the review surfaces disagreed.
- Acting on a small red deletion, likely a trailing blank-line deletion, made
  unrelated green suggestions disappear. That can be either a state bug or a
  hunk-boundary UX bug: the UI appeared to offer a local decision, but the
  action affected more than the user thought.
- The shared sidebar pending-review strip now uses external-friendly copy such
  as `Restore all...`; internal assistant proposals still need proposal-native
  semantics so users do not confuse "discard proposal" with "restore files on
  disk."

The fix must preserve the new external-agent behavior. Internal assistant
review and external filesystem review are related surfaces, not the same state
machine.

## Current Code Observations

These are initial observations from the current codebase, not final blame:

- `AssistantPendingProposals` renders one card per visible pending proposal.
  It does not group proposals by run, file, or source-specific review target.
- `AssistantPendingProposals` receives the raw `agentProposals` array. Active
  external filesystem proposals can be appended to that array by
  `AgentService.listProposals(...)`, so source filtering cannot rely on caller
  discipline.
- `buildPendingFileTreeChanges` deduplicates pending file-tree markers by
  normalized path and keeps the newest item. This can make the tree show one
  changed file while the assistant panel still shows multiple cards for the
  same path.
- `mutableReviewFileCount(...)` counts raw mutable proposal files, which can
  diverge from path-deduped file-tree markers and from visible assistant cards.
- `pendingReviewState` currently has a test that keeps all mutable proposals
  even when they target the same path. That is valid for preserving review
  artifacts, but it is not enough for a clear UI.
- Internal edit files support hunk-level review through
  `resolveProposalHunk(...)`; external edit files are read-only and file-level.
- `rejectProposalFile(...)` rejects all remaining mutable hunks in an internal
  edit file. That is correct for file-level `Reject remaining`, but it must not
  be reachable from a control that visually reads as "reject this one line."

## Product Model

Iliad should expose one coherent review queue while preserving source-specific
behavior:

- Internal assistant proposal: "The assistant proposed changes. Review, accept,
  or discard the proposed work."
- External filesystem change: "The file changed outside Iliad. Keep the disk
  change or restore the version Iliad last reviewed."

Writers should never need to understand proposal ids, hunk ids, session
baselines, or live disk snapshots.

## Decisions

### Source-Aware Review Items

Every visible pending review item must carry a source:

- `internal_agent`: persisted assistant proposal;
- `external_filesystem`: session-scoped live disk change.

Shared helpers may aggregate both sources for counts and file tree markers, but
commands must route through source-specific semantics.

Introduce a derived review queue model. Storage can remain proposal-based, but
the renderer must not drive UI from raw proposals:

```ts
type ReviewQueueSource = "internal_agent" | "external_filesystem";

interface ReviewQueueItem {
  id: string;
  source: ReviewQueueSource;
  groupId: string;
  proposalId: string;
  fileId: string;
  runId: string;
  kind: "edit_file" | "create_file" | "delete_file";
  relativePath: string;
  normalizedRelativePath: string;
  updatedAt: string;
  visibleInFileTree: boolean;
  blockedReason?: "external_drift_same_path" | "stale" | "missing_file" | "path_collision";
}
```

One visible review target is one source-scoped file-level review item. A
multi-file internal proposal therefore contributes one assistant run group, but
one queue item per reviewable file.

### Assistant Panel Shows Internal Proposal Groups Only

The assistant panel pending section is for internal assistant proposals. It must
not show external filesystem review items.

The panel groups internal proposals by assistant run/proposal. A proposal card
shows one file row per unique normalized Markdown path. A one-file proposal can
remain visually compact, but it is still modeled as a run group containing one
file row.

If multiple pending internal proposals target the same file:

- if they came from the same run, this is a proposal-creation bug. The main
  process must coalesce duplicate same-run/same-path draft changes before
  saving. If conflicting draft kinds target the same path in one run, fail the
  proposal for that path instead of saving ambiguous review rows;
- if a same-run duplicate still reaches the renderer, the panel defensively
  groups it into one file row and surfaces one stored error, not two identical
  cards;
- if they came from different runs, keep both review artifacts. Show them as
  separate run cards ordered newest first. The file row label can remain the
  path, but the card must include stable run context such as title, run order,
  created/updated time, or model so the rows do not look accidental;
- the file tree marker points to the newest unblocked queue item for that path.
  Older same-path proposals remain reachable from the assistant panel. If
  accepting a newer proposal makes an older proposal stale, the older proposal
  remains visible as stale with `Discard` available.

### File Tree Count Matches Visible Review Targets

The sidebar pending review count should count visible review targets, not raw
stored proposal records. If several internal proposals target the same file and
only one file tree marker is visible, the UI must still offer a way to reach the
other proposals or avoid counting them in the file-tree strip.

The implementation approach is:

1. Introduce a normalized `ReviewQueueItem` model used by the
   assistant panel, file tree strip, and first-review navigation.
2. Proposal storage remains unchanged except for coalescing invalid same-run
   duplicate file entries before save.

### Sidebar Strip Is Source-Aware

The sidebar strip is an orientation surface, not the owner of proposal state.

- No queue items: render no strip.
- One queue item already visible in the editor review: render the count only.
- Internal-only queue: show `Review`; show `Discard all...` only when more than
  one internal queue item exists. Discarding internal proposals is state-only
  and must not restore or rewrite workspace files.
- External-only queue: keep the contextual behavior from
  `specs/2026-06-21-contextual-external-review-strip.md`, including
  `Restore all...` for bulk external restore.
- Mixed internal and external queue: show `Review` only. Do not show a bulk
  button until there is a source-picker or source-specific bulk menu.

`Review` opens the newest unblocked queue item. If the newest item is blocked,
open the newest actionable item and keep the blocked item visible in its source
surface with its error.

### Mixed Source Same Path

If an internal assistant proposal and an external filesystem review item target
the same normalized path, live disk safety wins:

- the file tree marker and direct file open route to the external filesystem
  review item;
- the internal proposal remains visible in the assistant panel but is blocked
  with a document-changed/stale message;
- internal hunk/file accept actions for that path are disabled while external
  drift is pending;
- `Discard` remains available for the internal proposal because it is
  state-only;
- after the external item is kept or restored, the internal proposal is
  revalidated against disk. If its base hash still matches, it becomes
  reviewable. If not, it remains stale and the user can discard it or ask the
  assistant to regenerate.

### Hunk Controls Must Match Hunk Scope

Internal hunk decisions must affect exactly the visually associated hunk.

If a diff hunk contains separated visual changes, the editor must either:

- split the hunk into smaller reviewable units before rendering, or
- render the hunk as one grouped unit so the user understands that one action
  applies to the whole group.

Implementation rule for this pass:

- split whitespace-only additions/deletions into standalone hunks when they are
  separated from non-whitespace changes by at least one unchanged line;
- otherwise render one continuous hunk group with a single action area that
  visually spans every red/green decoration affected by that hunk.

Rejecting one pending hunk must not reject other pending hunks. Accepting one
pending hunk must not accept other pending hunks. When other pending hunks
remain, the active editor review stays open.

File-level actions remain broad:

- `Accept all` accepts all remaining mutable hunks for an internal edit file.
- `Reject all` or `Reject remaining` rejects all remaining mutable hunks for an
  internal edit file.
- After one hunk is accepted, the broad reject label must be `Reject remaining`
  because it does not roll back accepted hunks.

### Whitespace-Only Changes

Whitespace-only hunks, including trailing blank-line additions or deletions,
must be reviewable without making nearby content appear to vanish unexpectedly.

Whitespace-only hunks need a visible minimum row height, a hover/active target,
and hunk controls attached to that row or to the containing hunk group. A
zero-height blank-line decoration is not acceptable.

### Internal Proposal Actions Do Not Create External Review

Any disk write caused by internal assistant proposal acceptance must be tracked
as an Iliad-owned write. The external filesystem watcher must not surface the
accepted internal proposal as a new outside change.

Rejecting an internal proposal or hunk should not write to disk unless previous
accepted hunks already wrote intentional changes.

This invariant belongs at the service boundary. `AgentService.applyProposalFile`
and `AgentService.resolveProposalHunk` must remain wrapped as Iliad-owned
workspace mutations. If a future internal reject path writes to disk, it must be
wrapped too.

### Action Idempotence And Busy State

Every review action must visibly enter a busy state or complete on first click.

Repeated clicks while the same action is in flight must be ignored or disabled.
If a stale proposal, missing file, or disk race prevents completion, the UI must
show the stored error and refresh proposals/tree state.

Error behavior:

- stale edit: keep the proposal visible, disable accept actions, keep `Discard`
  enabled, and show copy equivalent to `This document changed after the
  proposal was created. Ask the assistant to regenerate it.`;
- missing file: keep the proposal visible as stale/failed, disable accept
  actions, keep `Discard` enabled;
- create path collision: keep the proposal visible as stale, disable `Create`,
  keep `Discard` enabled;
- repeated click while busy: submit one IPC/action only and leave buttons
  disabled until the result refreshes.

## Implementation Plan

1. Add a source-aware pending review view model.
   - Derive visible assistant-panel groups from internal proposals only.
   - Derive file-tree review targets from source-aware items.
   - Keep external filesystem items session-scoped and excluded from assistant
     chat cards.
2. Replace raw pending inputs in `App.tsx`.
   - `pendingReviewCount`, first-review navigation, file-tree pending markers,
     and sidebar bulk actions should read from the queue view, not independently
     from raw proposals.
3. Update assistant pending UI.
   - Render internal run/proposal groups only.
   - Render one row per unique file target inside multi-file proposals.
   - Avoid duplicate-looking same-run/same-file cards.
   - Make different-run same-file proposals distinguishable.
   - Route `Review` to the chosen file-level review target.
   - Route `Discard` to internal proposal rejection only.
4. Coalesce invalid same-run duplicate file entries before proposal save.
   - Same run plus same normalized path must not create duplicate stored files.
   - Conflicting duplicate kinds should fail closed with a stored error.
5. Tighten hunk decision behavior.
   - Add tests proving one hunk decision leaves unrelated hunks pending.
   - Audit rendered hunk grouping for separated additions plus blank-line
     deletion.
   - Keep editor review open when mutable hunks remain.
6. Add keyed busy/error handling.
   - Disable duplicate clicks for internal file/hunk actions.
   - Refresh proposal state after action results and failures.
7. Align pending counts.
   - Sidebar count should match visible review queue items.
   - File tree dots should remain file/path oriented.
   - Assistant panel can show proposal groups separately from the file tree.
8. Run external review regression.
   - The changes must not alter external keep/restore semantics.

## Key Tests

### Unit Tests

- `proposalStore.resolveProposalHunk` accepting one hunk writes only that hunk
  and leaves other hunks pending.
- `proposalStore.resolveProposalHunk` rejecting one hunk leaves other hunks
  pending and does not write unrelated proposal text.
- `proposalStore.rejectProposalFile` rejects remaining hunks but preserves
  already accepted hunks.
- Internal proposal apply writes are wrapped so the external capture watcher
  classifies them as Iliad-owned.
- Source-aware review queue excludes external filesystem proposals from
  assistant pending cards.
- Source-aware review queue groups same-run/same-file internal proposal records
  into one visible card.
- Different-run proposals for the same file are distinguishable and reachable.
- Sidebar pending count matches the derived visible review queue count.
- Internal-only sidebar bulk action discards proposals without touching files.
- External-only sidebar bulk action restores external disk drift.
- Mixed-source sidebar strip hides bulk actions.
- Mixed internal/external same-path queue blocks internal accept actions until
  external drift is resolved.
- Internal proposal acceptance advances or reconciles the external filesystem
  baseline when no external item exists for that path.
- If an external item already exists for a path, internal accept actions are
  blocked or forced through stale refresh instead of silently rewriting over
  live disk drift.

### Component Tests

- Assistant pending section renders one card for a single-run edit of one file.
- Assistant pending section does not render external filesystem proposals.
- Assistant pending section does not render duplicate-looking cards for
  same-run/same-file proposals.
- Assistant pending section renders one run group with file rows for a
  multi-file internal proposal.
- Different-run same-path proposal cards include distinguishable run context.
- Editor review stays visible after rejecting one hunk when another hunk is
  still pending.
- Broad reject label becomes `Reject remaining` after any hunk is accepted.
- Busy state disables hunk/file review actions during an in-flight operation.
- Rendered hunk controls visually cover every decoration affected by that hunk.
- Whitespace-only hunk rows have visible height and reachable controls.

### Integration Tests

- Run an internal assistant edit proposal with additions and a trailing blank
  line deletion; reject only the blank-line hunk; additions remain pending.
- Run an internal assistant edit proposal, accept one hunk, reject remaining,
  and verify accepted text remains in the document.
- Run two internal requests against the same file and verify panel/tree/editor
  navigation stays understandable.
- Run one internal request touching two files and verify one assistant run card,
  two file rows, two queue items, and correct review routing.
- Close/reopen the assistant panel and reload proposals; internal proposals
  remain visible while session-scoped external proposals do not survive
  workspace reopen.
- Double-click an internal hunk/file action and verify one IPC/action is
  dispatched.
- Force stale edit, missing file, and create-path collision results; verify the
  active review does not silently close and `Discard` remains available.
- Accept an internal assistant proposal while external capture is active and
  verify no outside-change review item appears for that accepted write.
- Create an internal proposal and external filesystem review for the same path;
  verify external review owns the file tree/editor route and internal accept is
  blocked until external drift is resolved.
- Keep/restore external edits after internal proposal changes and verify both
  sources remain independent.

### Required External Regression Matrix

Carry forward the external filesystem review cases from
`specs/2026-06-20-always-on-external-filesystem-review.md` and
`specs/2026-06-21-contextual-external-review-strip.md`:

- dirty Git workspace at app open does not create Iliad pending review;
- repeated external edits stack against the session baseline;
- external edit to active file;
- external edit to non-active file;
- external create file;
- external delete file with virtual struck row;
- external clear file as an edit, not deletion;
- external change returns to baseline and clears review;
- stale reviewed-content drift blocks destructive restore/trash actions;
- unsafe path drift is not acted on destructively;
- Git advisory drift is surfaced without redefining review state;
- unsaved editor conflicts do not get overwritten silently;
- contextual sidebar strip count-only state when the only item is visible;
- sidebar actions visible for multiple pending external items;
- expanded-folder pending-dot behavior;
- external bulk restore reconciles renderer proposals, tree, and active editor;
- session restart clears session-scoped external review;
- external review hides hunk-level accept/reject controls.

### Live Visual QA

Use deterministic fixtures first, then one live assistant smoke test.

Deterministic visual setup:

- create a temp workspace seeded from the relevant `my-docs` fixture;
- inject or save a known proposal fixture rather than relying on live LLM
  output for hunk-scope and duplicate-card checks;
- use a fresh Electron `userData` directory where possible.

Live smoke test with Electron dev build and screenshots:

1. Ask the internal assistant to add several formulas to
   `research/excel-formulas.md`.
2. Confirm the assistant panel shows one clear pending group for the request.
3. Confirm the editor shows green additions and any red deletions in review.
4. Reject one small hunk. Confirm other pending green additions remain visible.
5. Accept remaining hunks. Confirm the final document aligns normally and no
   external review item appears.
6. Ask a second internal assistant edit to the same file before resolving the
   first in a disposable workspace. Confirm the duplicate state is clear and
   reachable.
7. Edit a different file externally. Confirm external review still uses
   `Keep changes` / `Restore previous version` and does not appear in the
   assistant panel.

## Verified Reset Contract

Before and after each destructive visual test, assert:

- temp workspace files match the test baseline;
- no persisted internal proposals remain for that workspace unless the test
  intentionally starts with persisted proposals;
- no active assistant run artifacts remain;
- no active external capture session remains;
- no selected stale review target remains;
- no pending file-tree markers remain;
- watcher debounce is idle;
- Iliad-owned mutation markers have cleared;
- active editor text equals disk for the selected file.

## Implementation Audit Questions

- Does the implementation drive all visible counts and navigation from the
  source-aware review queue?
- Do different-run same-path internal proposals remain separately reachable
  while same-run duplicates are coalesced or failed before save?
- Are whitespace-only hunks visible enough that their action scope is clear?
- Do stale, missing-file, path-collision, and repeated-click tests prove the
  review does not silently close or mutate the wrong source?

## Non-Goals

- No Git-backed review model.
- No hunk-level decisions for external filesystem changes.
- No attempt to merge competing internal proposals automatically across
  different user requests.
- No marketing screenshot capture in this implementation pass; that is tracked
  separately in `docs/post-fix-marketing-screenshot-plan.md`.
