# Outside Changes QA Matrix

Date: 2026-09-01 (updated 2026-09-24 for
`specs/2026-09-24-iliad-writing-surface.md`)
Status: living checklist for `specs/2026-09-01-workspace-baseline-review.md`

This is the ordered, exhaustive list of live cases for the workspace baseline,
outside-change review, conflict mode, and their interplay with the file tree,
the editor, Iliad's own file actions, per-chunk review, and companion files.
Iliad no longer has an internal agent (ADR-0021); its cases were removed and
the results log below keeps them only as history. Walk it
top to bottom in the built app on a disposable workspace. Record the result
per case in the Status column: `pass`, `fail (note)`, `n/a`, or blank.

How the live run is driven: the built app is launched with
`node_modules/.bin/electron . --remote-debugging-port=9222 <workspace>` and
driven over CDP (`Runtime.evaluate`, `Input.insertText`,
`Page.captureScreenshot`). Outside edits are plain shell writes. Kill any old
instance first; the single-instance lock forwards launches to a stale renderer.

Legend for expected file tree state:

- **amber dot** = edited outside Iliad (`is-markdown has-pending-indicator`)
- **green create row** = created outside Iliad (`is-pending-create`)
- **struck delete row** = deleted outside Iliad (ghost row)
- **count** = "N pending review items" strip with Keep all / Restore all

## A. Outside edits: detection and classification

| ID | Case | Expected | Status |
| --- | --- | --- | --- |
| A1 | Edit an existing file outside Iliad (not open) | amber dot on the row, count 1, no editor change | pass |
| A2 | Edit the active file outside Iliad (buffer clean) | editor switches to read-only review with green/red hunks, toolbar shows path and change count | pass |
| A3 | Create a new file outside Iliad | green create row, count +1; opening it shows all-green content | pass |
| A4 | Create a file inside a new outside-created folder | folder appears, green row inside, count +1 | pass |
| A5 | Delete an existing file outside Iliad | struck delete row stays visible, count +1; opening shows all-red content | pass |
| A6 | Empty an existing file outside Iliad (0 bytes) | treated as edit (amber), not delete; review shows all text removed | pass |
| A7 | Rename a file outside Iliad | delete row for old name + green row for new name, count 2 | pass |
| A8 | Move a file into another folder outside Iliad | same as A7 across folders | pass |
| A9 | Edit two files outside Iliad in one burst | one review set, count 2, both amber | pass |
| A10 | Write the same file 5 times within 1 s | one item, final content shown, count 1 | pass |
| A11 | Atomic-save pattern (write temp, rename over) as VS Code does | one edit item, no transient delete/create | pass |
| A12 | Delete then recreate the same content within 300 ms | no item published | pass |
| A13 | Outside edit then revert to the exact baseline content | item disappears, count back to 0; if it was the active review the editor returns to normal | pass |
| A14 | Outside change to a non-Markdown file | no item; the tree refreshes only for rename events, not for plain content changes | pass |
| A15 | Outside change inside `node_modules` or a hidden folder | ignored | pass |
| A16 | Replace a Markdown file with a symlink | shows as a delete item (the symlink is not a regular file); Restore refuses with a clear error and never follows the link; no crash | pass (delete item shown; see corrected expectation) |
| A17 | `git checkout` that changes several Markdown files | N items appear; Keep all / Restore all work | pass |
| A18 | Large burst: 50 files created outside | items appear once, UI stays responsive | pass (61 items in 1.6 s) |

## B. Review actions on outside items

| ID | Case | Expected | Status |
| --- | --- | --- | --- |
| B1 | Keep all on an outside edit | no disk write, item cleared, editor shows outside content editable, count -1 | pass |
| B2 | Restore all on an outside edit | baseline content written back, item cleared, editor reloads baseline | pass |
| B3 | Keep an outside-created file | item cleared, file stays, row becomes normal | pass |
| B4 | Move to Trash an outside-created file | file moved to macOS Trash, row gone, empty parent folder removed | pass |
| B5 | Confirm deletion of an outside delete | baseline forgets the file, ghost row gone | pass |
| B6 | Restore file on an outside delete | file recreated with baseline content, row normal | pass |
| B7 | Keep an emptied file | baseline is now empty content | pass |
| B8 | Restore an emptied file | text comes back | pass |
| B9 | Keep all (tree strip) with mixed edit/create/delete | all items cleared, disk untouched | pass |
| B10 | Restore all (tree strip) with mixed items | edits restored, creates trashed, deletes recreated, count 0 | pass |
| B11 | Act on an item after the file changed again outside | action reports stale, review refreshes with the newer content, nothing written | pass (fixed; the stale path re-verified live under Bx1 and Bx3 on 2026-09-02) |
| B12 | Act on an item after the outside tool reverted it | item is gone before the click; no error | pass |
| B13 | Restore all when the Trash is unavailable for one create | others restored, that one reported, count shows the remainder | pass |
| B14 | Keep then edit again outside | new item diffs against the kept content, not the original | pass |
| B15 | Restore while Git HEAD changed since the review | first click blocked with a notice and review refreshed; second click succeeds | pass |

## C. File tree and navigation while items are pending

| ID | Case | Expected | Status |
| --- | --- | --- | --- |
| C1 | Click an amber row | opens read-only review of that file | pass |
| C2 | Click a green create row | opens all-green virtual document, no file loaded into the editor buffer | pass |
| C3 | Click a struck delete row | opens all-red virtual document | pass |
| C4 | Navigate to another file while reviewing | review target clears, other file opens normally, item stays pending | pass |
| C5 | Back/Forward across a reviewed file | history works; reopening a file with a pending outside edit enters review again (never an editable copy of the outside content) | pass |
| C6 | Close the document (tab x) while reviewing | editor empty, item stays pending | pass |
| C7 | Pending count matches visible marked rows at all times | count equals amber + green + struck rows | pass |
| C8 | After Trash of an outside-created file that was open | editor falls back to previous document or empty state, no stale buffer | pass |
| C9 | Collapse/expand folders with pending rows | markers persist | pass |
| C10 | File tree search with pending rows | marked rows still marked in results | pass |

## D. Conflict mode (dirty buffer + outside write)

| ID | Case | Expected | Status |
| --- | --- | --- | --- |
| D1 | Type in file A, outside tool writes A before autosave | conflict banner, status "Changed outside Iliad", buffer keeps typed text and stays editable, amber dot, count 1 | pass |
| D2 | Keep typing while in conflict | status stays conflict, no autosave, no error | pass |
| D3 | Restore previous version | banner gone, typed text kept and saved to disk, count 0 | pass |
| D4 | Keep outside changes, cancel the confirm | nothing happens, still in conflict | pass |
| D5 | Keep outside changes, accept the confirm | buffer replaced by outside content, saved state, count 0 | pass (fixed 2026-09-02, see log) |
| D6 | Outside tool reverts the file to baseline while in conflict | banner gone, typed text autosaves normally | pass |
| D7 | Outside tool writes A again while in conflict | banner stays, review item updates to the newest content, buffer untouched | pass |
| D8 | Navigate to another file while in conflict | navigation blocked like an unsaved error; the conflict banner stays as the explanation | pass |
| D9 | Close document while in conflict | close dialog offers save/discard; save fails again with conflict; discard closes | pass |
| D10 | Switch workspace while in conflict | blocked until resolved | pass |
| D11 | Type in file B while A has a pending outside item | B saves normally, A's item untouched | pass |
| D12 | Rename the conflicted file from the tree | flush fails with conflict, rename does not proceed, notice shown | pass |
| D13 | Outside tool deletes the file while dirty | conflict with delete item; Restore recreates with typed text; Keep closes the document | pass |
| D14 | App language switched to Spanish while in conflict | banner and status in Spanish, actions still work | pass |

## E. Iliad-owned writes never become outside items

| ID | Case | Expected | Status |
| --- | --- | --- | --- |
| E1 | Type and autosave | no item | pass |
| E2 | New document via + | no item, file appears normal | pass |
| E3 | New folder via + | no item | pass |
| E4 | Rename a file in Iliad | no item; a later outside edit of the new name shows as edit, not create | pass |
| E5 | Rename a folder in Iliad with files inside | no items; later outside edit inside shows as edit | pass |
| E6 | Move a file by drag to another folder | no item | pass |
| E7 | Duplicate a file | no item for the copy | pass |
| E8 | Move a file to Trash in Iliad | no delete item | pass |
| E9 | Rename a file that has a pending outside item | item follows the new name | pass |
| E10 | Trash a file that has a pending outside item | item disappears | pass |
| E11 | Paste an image (asset write) | no item | pass |
| E12 | ✦ AI result or autocomplete accept | no item (goes through autosave) | |

## G. Workspace lifecycle

| ID | Case | Expected | Status |
| --- | --- | --- | --- |
| G1 | Open workspace with a dirty Git tree | no items (disk at open is the baseline) | pass |
| G2 | Switch to another workspace and back after more than 5 s | items from the first workspace are gone (session-scoped); within 5 s the baseline is kept | pass |
| G3 | Reload the renderer (Cmd+R in dev) with items pending | items return after reload | pass (CDP Page.reload) |
| G4 | Open the same workspace in a second window | both windows show the same items; acting in one updates the other | pass (second window via recents list) |
| G5 | Close the last window, reopen within 5 s | baseline kept | pass |
| G6 | Quit and relaunch with outside changes made while closed | no items (clean slate on open) | pass |

## H. Watcher and platform

| ID | Case | Expected | Status |
| --- | --- | --- | --- |
| H1 | Delete the workspace folder's subfolder that is being watched | no crash, tree refreshes | pass |
| H2 | Watcher error (simulate by removing and recreating the workspace root) | watcher restarts with backoff; notice if it cannot | pass with caveat (root recreated at the same path never reattaches; see log) |
| H3 | Workspace on an external volume (Trash across volumes) | reject create still works via system Trash | pass (ExFAT volume; file lands in that volume's Trash) |
| H4 | Very long file names / unicode names outside | items display correctly | pass |

## X. Added from the review of the matrix (2026-09-01)

Cases proposed by a review of the matrix against the code. Rows marked
"fixed" were addressed in code before the live run.

| ID | Case | Expected | Status |
| --- | --- | --- | --- |
| Bx1 | Outside edit lands after Restore validated but before the write | Restore reports the file changed again; nothing written (fixed: final recheck before the write) | pass (7 trials, 1-30 ms) |
| Bx2 | Outside-created file changes after validation but before Trash | same as Bx1 (fixed) | pass (re-verified 2026-09-02: 12 trials at 0-25 ms, C2 never trashed) |
| Ax1 | Symlink swapped in between safety check and write | write fails with ELOOP, never follows the link (fixed: O_NOFOLLOW) | blocked live (swap cannot be timed from outside); covered by unit test (symlink target is refused as unsafe_path) |
| Gx2 | External Restore in A, switch to B before it completes | B untouched (fixed) | pass (500 items restored) |
| Ex1 | Rename or move a folder holding several pending items | items follow the new paths and the renderer updates immediately (fixed: publish on structural records) | pass |
| Ex2 | Drag a pending-edited file or a folder with pending descendants | drag is disabled for them (product decision; no stale UI) | pass |
| Dx1 | Two windows autosave the same clean file | one saves; the other enters conflict with its buffer intact | pass |
| Dx2 | Window A in conflict; window B keeps the outside version | A re-conflicts on save (expected hash no longer matches) | pass |
| Dx3 | Click the conflicted file's amber row while the banner is visible | buffer stays editable and unchanged; no read-only review replaces it | pass |
| Dx4 | Outside write at ~899 ms and ~901 ms after typing begins | both end in conflict, never a silent overwrite | pass |
| Ax2 | Create a file, then replace its contents within 300 ms | published create shows the final content (fixed: second observation wins) | pass |
| Ax3 | fs.watch change with null filename | full scan finds the edit | blocked (cannot force a null-filename event from outside) |
| Ax4 | Replace a baseline Markdown file with a directory | shows as delete; Restore refuses safely; nested files inside are new creates | pass (re-verified 2026-09-02: ghost row opens the delete review; Reject refused visibly, Accept clears) |
| Ax5 | Dot-files and atomic-save temp names | ignored; only the final visible file gets one create item | pass |
| Ax6 | .markdown, .mdown, .mkd and uppercase extensions | classified and reviewed like .md | pass |
| Ax7 | Names with leading/trailing spaces | exact on-disk name kept (fixed: no trimming) | pass |
| Ax8 | NFC/NFD names and case-only renames on APFS | one stable identity per file; actions addressable | pass |
| Ax9 | Very long basename and deep nested path with spaces and unicode | detection and actions work or fail visibly | pass (with H4) |
| Bx3 | Two windows act on the same item at once | exactly one succeeds; the other reports stale | pass (re-verified 2026-09-02: loser shows the refreshed notice in 8 of 8 trials) |
| Cx1 | Virtual create/delete review selected, then disk reverts | virtual editor, target, selection, and count all clear | pass |
| Cx2 | History destination deleted outside while pending | history skips it; delete review still reachable from the tree | pass |
| Gx3 | Older pull result arrives after a newer push; reload during an action | newest snapshot wins; no resurrected terminal items | pass |
| Gx4 | One of two windows switches away | the other keeps baseline and review | pass |
| Hx1 | Watcher retries exhausted, then an outside edit | degraded notice; reattach or reload performs a full scan | blocked (cannot force retry exhaustion) |
| Hx2 | Delete a watched folder with several baseline files | each file becomes a delete item; Restore rebuilds the hierarchy | pass |

## I. Per-chunk review of outside edits

Future manual checks (Stage B of the writing-surface spec).

| ID | Case | Expected | Status |
| --- | --- | --- | --- |
| I1 | Outside edit with three separate chunks, Keep the middle one | no disk write; that chunk leaves the review, the other two stay; count unchanged until the last chunk is decided | |
| I2 | Restore one chunk | disk equals disk minus that chunk (guarded replacement); other chunks stay pending; held original in the Trash | |
| I3 | Keep one chunk, Restore another, Keep the last | item clears; disk is the mix the writer chose; baseline equals disk | |
| I4 | Act on a chunk after the file changed again outside | `stale` notice, review refreshes, nothing written | |
| I5 | Restore a chunk while the file is held open by a writer that writes after the check | newer bytes never lost (held file kept or a `name (outside copy N).md` appears) | |
| I6 | After Keep/Restore | focus moves to the next chunk's Keep button; Esc and Tab do nothing on outside chunks | |
| I7 | Keep a chunk while the buffer is in conflict | disk is never loaded over the dirty buffer; autosave resumes only when disk equals the saved text | |
| I8 | Whitespace-only chunk next to a text chunk | shown as its own chunk (known; backlog: merge with neighbour) | |
| I9 | Keep all / Restore all from the file toolbar and from the tree strip | same result as deciding each chunk | |
| I10 | App language Spanish | chunk and file labels translated; actions work | |

## J. Companion files (notes and comments)

Future manual checks (Stage D of the writing-surface spec).

| ID | Case | Expected | Status |
| --- | --- | --- | --- |
| J1 | Outside tool edits or creates `name.notes.md` / `name.comments.md` | no review item, no amber dot, no count change | |
| J2 | Outside tool deletes a handled comment entry and edits the document | comment disappears from the editor; the document edit is reviewed per chunk | |
| J3 | Restore that document edit | the removed comment comes back if its quote is found again | |
| J4 | Add a comment on a selection | `name.comments.md` created beside the document; tree shows "Comments · 1" under the active document | |
| J5 | Delete the last comment | `name.comments.md` moved to the Trash | |
| J6 | Writing assists → Open notes | empty `name.notes.md` created and opened; Back returns to the document | |
| J7 | Rename, move, duplicate, trash a document with both companions | companions follow (duplicate picks a stem free for the group); no outside items | |
| J8 | Unrelated `name.notes.md` already at the rename/move target | action refused; nothing overwritten | |
| J9 | Create or rename a document to `x.notes.md` | refused | |
| J10 | Outside edit to a comment's quote while the document is open | comment re-anchors from the file; ambiguous duplicate becomes detached ("N detached comments") | |
| J11 | Autosave of comments while an outside tool writes the comments file | three-way merge by id; no comment lost; outside deletion wins unless edited here | |

## Results log

Fill in as cases are run. Bugs found during the run are listed here with the
fix commit or file. Entries before 2026-09-24 mention the removed internal
agent (Codex proposals, Accept/Reject labels); they are kept as history.

- 2026-09-01: block A + B run by a QA agent on the built app (15 pass, 3
  fail). B11: Restore acted on the refreshed item and overwrote a never-shown
  outside version; fixed in `workspaceBaseline.ts` (`locateReviewItem` now
  returns stale after a refresh). B12: a stale result surfaced as "Agent
  request failed" and the buffer kept content no longer on disk; fixed
  (stale is a notice; the active document reloads when its item vanishes
  under a clean buffer; an orphan conflict shows a Reload banner). B13: the
  sidebar Reject all stopped at the first failing file; fixed (outside items
  go through `restoreAll`, per-item errors are collected).
- 2026-09-01: block C + D run by a QA agent (25 pass, 2 fail). B11 again:
  after the stale notice the review toolbar dropped and the editor held the
  unreviewed newer text; fixed (stale keeps the review target). D5: after
  Keep with confirmation the buffer was not replaced and the next keystroke
  overwrote the kept outside version; fixed (pull and push with the same
  revision are applied once, persistence refs update synchronously, the
  buffer loads before the review refresh).
- 2026-09-02: block E + F run by a QA agent (16 pass, 1 fail, 6 blocked).
  E12 and F5-F9 need a connected provider; the app instance showed Codex as
  "Not connected". D5 re-verified: still failing (after Keep the buffer is
  not replaced and the editor stops taking any new value, even when another
  file is opened). F1: the internal proposal reported "The document changed
  since this proposal was created" instead of the outside-drift message, and
  its hunks stayed stale after the outside item was restored.
- 2026-09-02: D5 root cause found by driving the built app over CDP. It was
  not the review flow: `@uiw/react-codemirror` 4.25.x defers every external
  `value` update behind a "typing latch" (a 200-tick counter on a 1 ms
  `setInterval`). Under timer clamping or an occluded window the latch holds
  for seconds, and any keystroke re-arms it, so the editor kept the old
  buffer while app state already held the kept outside version (or another
  file), and the next keystroke autosaved the stale text over it. Reproduced
  without any outside change: type one character, open another file within
  the same second, the editor never switches. Fixed by mounting `EditorView`
  from Iliad (`src/editor/CodeMirrorHost.tsx`) with a synchronous document
  sync (`src/editor/documentSync.ts`); the wrapper dependency is removed.
  Re-verified live: Keep replaces the buffer, later typing saves on top of
  the kept version, opening another file works.
- 2026-09-02: F1 fixed. The proposal store now asks the guarded writer
  whether the path has an outside item pending (`hasPendingReview`) before
  comparing disk with the proposal, so the file reports "outside changes
  waiting for review" and its hunks stay pending instead of going stale; and
  when disk matches the proposal again (after Restore) stale hunks are revived
  (`reviveStaleHunks`), so accept and apply work. Unit tests cover both paths.
- 2026-09-02: F1/Fx8 re-verified and block G run by a QA agent (12 pass,
  0 fail). Observations: `buildReviewQueueItems` hides an internal item whose
  path holds an outside item (`external_drift_same_path`), so the
  pending-review message is reached only through the IPC guard; the UI shows
  the outside item and the internal card returns after Restore. There is no
  product path to a second window on the same workspace (a second CLI launch
  focuses the existing window); G4 used a second window switched through the
  recents list. With no provider connected the agent panel opens on Agent
  settings, which hides the Pending changes card behind the back arrow.
- 2026-09-02: block H and the X cases run by a QA agent (24 pass, 3 fail,
  2 blocked). Ax4: a baseline file replaced by a folder produced no delete
  item because the confirmation pass read the path as unsafe; fixed
  (`checkPathSafety` reports the folder case and `readDiskPathState` treats
  it as absent, so the delete item appears, Restore is refused with "A folder
  has taken this file's name.", and Markdown inside the folder shows as new
  files). Bx2: a write landing 3-7 ms after Reject on an outside-created file
  was trashed unreviewed (5 of 10 trials); fixed by moving the file with an
  atomic rename into a hidden sibling folder first, verifying the held
  content against the reviewed hash, and trashing that (a writer opening the
  path afterwards creates a new file there, which becomes a new create item;
  a mismatch puts the file back, or beside a newer one as an "outside copy").
  H2 caveat: deleting and recreating the workspace root does not reattach;
  the unavailable screen only offers Open Folder (known gap, recorded).
- 2026-09-02: Bx3 fixed. The agent's detail showed the real path: a losing
  single Reject (the file changed between the review's last look and the
  write, or the other window acted first) threw the raw IPC text "Error
  invoking remote method 'agent:reject-proposal-file': ... The file changed
  again outside Iliad" as an uncaught renderer exception, and one Bx1 trial
  hit the same path. `restore` now returns a stale result for that case (a
  notice, nothing written), `restoreAll` counts such items as stale rather
  than as failures and reports stale when nothing it was asked to restore is
  left, and the renderer's Reject all shows the refreshed-review notice.
  Observations kept as follow-ups: the losing window of a two-window
  conflict (Dx1/Dx2) can only "Reload from disk", there is no in-app way to
  keep its typed text; the sidebar Accept all / Reject all are hidden when
  the only pending item is the one under review.
- 2026-09-02: re-verification on the rebuilt app. Bx2 passes (12 trials at
  0-25 ms, the newer write never reached the Trash; the Trash entries keep
  the original basename; no hidden folder left behind). Ax4 shows the delete
  item, but it decorated the folder row that now holds the file's name, so
  it could not be opened on its own; fixed (`buildFileTreeDisplayNodes` gives
  a change its own virtual row when a real folder has the file's path). Bx3:
  the raw text is gone, but the loser showed no notice because the stale
  result is built from a review that is already empty, and the sidebar
  Reject all replaced the notice with "Discarded pending changes"; fixed
  (a reject whose file is missing from the result is stale, and the bulk
  handler skips its own notice on a stale outcome). Error text from failed
  IPC calls no longer carries Electron's "Error invoking remote method"
  prefix (unwrapped once in `electron/preload.ts`).
- 2026-09-02: third re-verification. Bx3 passes (single-item and Reject all
  races, the loser shows the refreshed-review notice, no raw text, no
  exceptions). A winning single Reject sometimes shows no notice (cosmetic,
  winner side; a winning Accept always shows "Applied reviewed changes").
  Ax4: the ghost row appears and the refusal text is clean, but opening the
  ghost row failed with "Reopen the original document" because the target
  selection treated the folder at that path as the document; fixed (only a
  Markdown node counts as the document; the delete is reviewed virtually).
  The preload IPC wrapper briefly called itself and broke startup; fixed
  before this run.
- 2026-09-02: Ax4 passes on the final build. Residual seen by the agent: the
  refusal notice was accompanied by an unhandled rejection in the console,
  because review actions rethrow after reporting so bulk callers can collect
  failures; fire-and-forget call sites (editor toolbar, conflict banner,
  sidebar card) now swallow the rethrow. Codex-dependent cases (E12, F5-F9,
  Fx1-Fx6) remain blocked until a provider is connected; Ax3 and Hx1 cannot
  be forced from outside.
