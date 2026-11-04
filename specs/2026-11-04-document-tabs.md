# Document Tabs for a Small Writing Set

Date: 2026-11-04
Status: implemented; native QA complete; implementation review and release pending

## Writing Need

A writer works on two or three documents, such as a draft, an outline, and
research notes. They want those documents to stay visible and return to the
same place in each without finding them in the folder tree again.

Keep several documents open, with one active document receiving typing and
writing assists. This changes navigation, without adding multi-document AI or
requiring simultaneous editors.

## What VS Code Does

VS Code presents open files as tabs. Its optional Open Editors section also
lists open editors above the folder tree. A preview slot is reused while
browsing; editing or double-clicking makes the file remain open. These are
separate choices: tabs can be hidden while an open-editor list still provides
navigation. [Official user-interface documentation](https://code.visualstudio.com/docs/editing/getting-started/userinterface)

The source separates document state from its presentation. `EditorGroupModel`
maintains the ordered open editors, recently used order, active selection,
preview editor, and serialization. Opening an existing editor activates its
entry instead of creating a second copy. Preview replacement is an explicit
operation in that model. [Editor group model](https://github.com/microsoft/vscode/blob/6e35f5ceffa04ac728a0fb3a0dd6fb9cdb4ff100/src/vs/workbench/common/editor/editorGroupModel.ts#L195)

`OpenEditorsView` subscribes to group events for opens, closes, activation,
dirty state, and label changes. The list reflects the same editor model;
adding the list does not remove the need to manage document lifetimes.
[Open Editors view](https://github.com/microsoft/vscode/blob/6e35f5ceffa04ac728a0fb3a0dd6fb9cdb4ff100/src/vs/workbench/contrib/files/browser/views/openEditorsView.ts#L133)

VS Code can combine separate folders in a multi-root workspace. Its workspace
model contains multiple folder roots and resolves a resource to its containing
folder. Git repository membership does not define the tab boundary.
[Multi-root documentation](https://code.visualstudio.com/docs/editing/workspaces/multi-root-workspaces),
[workspace source](https://github.com/microsoft/vscode/blob/6e35f5ceffa04ac728a0fb3a0dd6fb9cdb4ff100/src/vs/platform/workspace/common/workspace.ts#L266)

Source inspected at commit `6e35f5ceffa04ac728a0fb3a0dd6fb9cdb4ff100`.
The recommendation below is an Iliad design decision informed by those patterns.

## Recommended First Version

Add ordinary document tabs within the existing folder window. Keep one editor
visible and one active save pipeline. Each deliberate Markdown open creates a
document entry or activates its existing entry. With one document open, show
its path/breadcrumb in the top row. Show tabs in that same area only when two
or more documents are open; closing back to one restores the path/breadcrumb.
Keep this rule across writing, sidebar-hidden, and outside-review screens.
No preview/pinning distinction
in this version, so the file tree's double-click-to-rename gesture stays intact.

| Presentation | Value | Decision |
| --- | --- | --- |
| Tabs in the current topbar | The two or three open documents stay visible even with the sidebar hidden. | Build first. |
| Open Documents section above the file tree | Useful when many tabs are open or tabs are hidden. | Defer; it would duplicate the initial small set. |
| Mark open files in the existing tree | Shows which files belong to the open set without a second list. | Add a subtle open indicator, distinct from active and pending-review states. |

The open-document model should support another presentation later. The first
version does not need both a tab row and a duplicated list or a setting to
choose between them.

## Folders and Different Repositories

Iliad currently associates each window with one canonical workspace folder.
File operations, watchers, outside-change review, and CLI routing use that
folder. Preserve this boundary.

| Documents | First-version behavior |
| --- | --- |
| Inside the current folder, including different subfolders | Open as tabs in this window. |
| In separate Git repositories that are both inside the current folder | Repository membership alone does not prevent tabs; existing workspace file-access and exclusion rules still apply. |
| In different opened workspace folders | Keep a separate window and tab set for each folder. |
| Outside the current workspace | Keep existing open/link routing. Do not silently attach another root to this window. |

Cross-folder tabs are possible, but need an explicit multiple-folder workspace
design. Each root would need its own file tree, watcher, review baseline, save
scope, search scope, and CLI routing. An Open Documents list would have the same
requirements. Defer that extension until the small within-folder workflow has
been used. Do not broaden the chosen folder automatically to include siblings.

## Interaction

- A Markdown file open from the tree, recent documents, search, a local link,
  creation, duplication, or `iliad open` activates its tab. Opening the same
  canonical file again reuses the existing tab.
- New documents append to the tab order. Activating a document never reorders
  the tabs. Existing rename and move operations update the same entry.
- With one open document, retain the path/breadcrumb in the top row. With two
  or more, replace it with the tab strip in that same area. Restore the path
  when one document remains. Retain space for native window controls and review actions.
  Keep the active tab visible with horizontal overflow when necessary.
- Tabs show the document name without its extension. Add the shortest useful
  parent-folder suffix for duplicate names, and expose the relative path in a
  tooltip and accessible label.
- The active tab is visibly selected. Other tabs remain subdued. Close buttons
  are available on the active tab, hover, and keyboard focus. The file tree
  keeps its existing active highlight and creation-target selection semantics.
- Clicking a tab restores its selection and scroll position. Returning after
  a normal switch preserves that document's undo/redo history. Match existing
  document-opening focus behavior: a pointer open stays in reading mode until
  the writer enters the editor.
- Ctrl+Tab and Ctrl+Shift+Tab cycle in tab order on all platforms. Existing
  ⌘[ / ⌘] history still navigates visited documents. Reserve the tab shortcuts
  through the existing shortcut ownership rules.
- ⌘W closes the active document using the existing save/discard/cancel behavior.
  Closing an inactive tab leaves the active document unchanged. Closing the
  active tab selects the tab to its right, or the left neighbor if it was last.
  Closing the final tab shows the existing empty state.
- Provide keyboard-accessible tabs and close actions. Arrow keys/Home/End move
  tab focus; Enter/Space activates. Moving focus alone does not open a document
  or start editing it.

## Save and Review Safety

Preserve the existing save-before-navigation behavior. Before activating another
tab, finish saving the active document and its comments. If that fails or is
blocked by a conflict, keep the active document, open set, and history unchanged.
The failure remains visible through the existing UI.

Immediately before committing activation, recheck that the source document and
comments are fully saved. Typing or editing a comment during a target read must
trigger another flush or leave activation unchanged. Wait for in-flight saves,
and serialize document opens, closes, and workspace transitions. Do not clear a
review target before a possibly failing transition succeeds.

Closing a document with saved text still awaits pending comment writes. A failed
comment write keeps it open. Prepare the neighboring document before removing
the active entry, so a failed target read cannot strand the writer. Existing
"Close without saving" discards unsaved document text only; comments still
persist and a comment-write failure still prevents closing.

This means an inactive tab has a saved document, rather than a separate running
autosave timer. Retain its editor state in memory for undo, selection, and
scroll. The active persistence and comments hooks continue to serve one document
at a time. A tab strip backed only by paths and repeated disk loads would not
meet the undo requirement.

On activation, reconcile the target with current workspace/review state before
attaching a cached editor state. Reuse that state only when its source revision
still matches the relevant document baseline. Outside edits, accepted changes,
or deletion can invalidate a cache; use the existing outside-review flow and
rebuild the affected state as needed. Never overwrite newer disk text or apply
an old undo stack to different content.

Cache writing history and selection, with the scroll position of the actual
`.editor-surface` container. Build fresh transient/plugin state on activation;
review snapshots and pending create/delete views never replace a normal
document's cached writing state. Fresh active callbacks and read-only settings
must be installed before input. Cancel async assists and invalidate an activation
generation so a late A → B → A result cannot attach to the new activation.

Pending create/delete review views are temporary, not additional open files.
Show their target path in the top row instead of selecting an unrelated tab.
⌘W dismisses that temporary review and returns to the active writing document;
it does not discard the review or close the underlying document.

Outside-change review remains owned by the workspace and document path. Closing
a tab does not accept, restore, or dismiss pending changes. Files with pending
changes remain reachable through the existing review/file-tree affordances.
Read-only review views remain read-only. Background tabs do not run writing AI,
and a late AI result must not attach to the newly active document.

An in-app rename or move updates tab identity, cached state, and saved session
paths through the existing relocation callback. A missing file is handled
through existing deletion/review rules; closing or restoring its tab must not
silently recreate it. Different file names must never share an undo stack.

## State and Restoration

Add a small workspace-scoped open-document hook with an ordered list and active
document key. Keep editor state and scroll snapshots keyed by document identity.
Use canonical paths and existing path-comparison rules, not file names or a
blanket lowercase conversion. Preserve identity across in-app relocation.

Keep the save transition explicit: flush the current document/comments, snapshot
its editor state, resolve and reconcile the target, then commit activation. A
failed read also leaves the old activation and history intact. Serialize rapid
switches so a late file load cannot replace a more recent selection.

Persist only ordered workspace-relative paths and the last active path as local
display/session metadata, scoped by canonical workspace root. Reload document
contents from the filesystem; do not introduce a second content store or serialize
undo history. Restore paths after the workspace/tree is ready, drop unavailable
files safely, and load inactive documents lazily. No tab metadata goes into the
writer's Markdown or comments files.

Keep `iliad status` reporting the one active document in each window. `iliad open`
activates an existing tab or creates one through the normal save-before-open
path. The CLI does not need to expose every open tab for this feature.
An explicit open during startup wins over restored last-active metadata. Tab
activation records ordinary Back/Forward history; history may reopen a closed
file. Closing an intermediate tab preserves history; closing the final document
clears it, matching existing empty-state behavior.

## Implementation Outline

1. Add the open-document model and failure-safe activation/close transitions.
   Integrate it with existing file opens, relocation, history, and CLI paths.
2. Extend `CodeMirrorHost` with explicit document identity and an in-memory
   writing-state cache. Keep one mounted editor view; install a fresh target
   state with its cached history/selection when the source still matches. Keep
   transient review/AI state out of the cache. Capture/restore the outer editor
   surface's scroll and install fresh callbacks before accepting input.
3. Add the tab strip in the existing chrome and the small tree indicator. Keep
   existing breadcrumb rename behavior for the active document.
4. Add workspace-scoped path restoration and verify review/AI behavior across
   switches. Keep workspace changes and application/window closing behind the
   existing save guards before releasing the old state.

Relevant owners: `src/App.tsx`, `src/files/fileActions.ts`,
`src/app/useDocumentPersistence.ts`, `src/app/useSelectionComments.ts`,
`src/app/useOutsideReview.ts`, `src/app/useDocumentHistory.ts`,
`src/app/pathRelocation.ts`, `src/editor/CodeMirrorHost.tsx`,
`src/editor/documentSync.ts`, and the existing file tree/chrome components.

The main-process workspace ownership model can remain unchanged for this version.
Do not copy VS Code's editor-group framework to implement a single strip.

## Acceptance Checks

- Verify one document shows its path in writing, sidebar-hidden, and review
  views. Open a second document to reveal tabs; close back to one and verify
  the path returns in every view.
- Open draft, outline, and notes. All three remain visible; duplicate opens
  reuse tabs. Switching preserves each cursor, scroll position, and undo stack.
- Add a comment, switch tabs, and return. It is saved against the correct file.
- Trigger a failed save/read or a conflict during switching/closing. The current
  text remains visible and editable, and no tab/history transition is committed.
- Type or edit a comment while the target read is delayed. Every new edit is
  saved before switching; a failed comment write leaves the source open. Closing
  a saved-text document also awaits its comments.
- Click tabs rapidly and trigger a late AI response. Text, comments, and results
  never cross document boundaries.
- Edit an inactive document outside Iliad. Returning shows the correct review
  state; cached text cannot overwrite that edit. Closing its tab leaves review
  available.
- Rename/move an open file, including an automatic untitled-document rename.
  Tab order, identity, and history survive. Deletion never recreates the file.
- Open same-named files in different subfolders. Labels distinguish them and
  each keeps its own state.
- Close the active tab, an inactive tab, and the last tab. Verify the neighbor
  choice and existing save/discard/cancel actions.
- Restart and restore the open paths; gracefully skip missing paths. Verify
  independent tab sets in two folder windows.
- Test keyboard navigation, sidebar-hidden mode, topbar overflow at minimum
  window width, and review controls sharing the same row.

## Deferred Scope and Documentation

No split panes, editor groups, draggable reordering, preview/pinned/sticky tabs,
duplicate editor instances, tab-specific AI sessions, cross-folder roots, or
new background save/recovery system in this version.

The existing architecture and navigation-history notes deliberately deferred
tabs. This concrete draft/outline/notes workflow is the reason to revisit that
decision. When implementing, update those notes, the README's no-tabs claim,
and the product wording to distinguish several open documents from one active
writing/AI target. Keep the existing product and review boundaries intact.

## Review and Execution State

Independent spec review: GPT-6.1 Sol, High reasoning, 2026-11-04. Accepted its
concrete findings about late edits during reads, awaited comment saves on close,
review-only document identity, the outer scroll container, cancellation across
repeated activations, and startup/history precedence. The implementation keeps
one ordered open set and one active save pipeline; no editor-group framework or
background document persistence is needed.

Stages:

1. Definition/review and release preflight: spec reviewed; source checkout
   baseline preserved in `/tmp/iliad-tabs-baseline` to isolate pre-existing edits.
2. Implemented document model/transitions, editor history/cancellation, and tab
   UI as bounded workstreams; integrated focused regression checks.
3. Independent implementation review completed with GPT-6.1 Sol, High reasoning.
   Native app QA passed against the isolated release source. Final validation
   includes the full tests, typecheck, CSS lint, build, and production audit.
4. Released 0.8.0 from the isolated public-safe checkout using `docs/release.md`.
   Signed/notarized artifacts, public metadata/checksums, and the downloaded app
   workflow passed verification. Unrelated comments work remains preserved in
   the original checkout.

Observed QA on 2026-11-04:

- Native app switching preserved independent undo, selection, and outer scroll.
  Text and comment edits made during a delayed read saved to the source file.
- Failed text saves and failed comment saves during close retained the active
  document. Returning to an inactive outside-edited document showed read-only
  review; closing that review left the pending changes available.
- Cmd+W handled a review-only ghost, and renderer reload restored the open paths.
- Rendered Electron UI checks passed manual tab focus/activation, inactive close
  with focus restoration, and active-tab reveal within the strip. At 960px with
  the maximum sidebar, EN/ES review actions, comments, and error status fit in the
  same row. Component tests, CSS lint, and TypeScript passed in the source checkout.

A final folder-switch review removed a duplicate initial tree read. The
workspace hook now owns that read, so the transition finishes before restored
tabs become ready. Native delayed-read and A → B → A checks pass with separate
open sets and last-active restoration. Selecting the already-current folder
is a no-op and retains its tree, tabs, and active document.

Final review also covered the isolated public-comments adaptation. A session
version guard now preserves comment edits made during a companion write; its
regression test verifies a second write before navigation settles. The release
audit required a compatible Undici update from 7.30.0 to 7.30.1. No other
dependencies changed.

Release verification completed on 2026-11-04. All 1,241 tests across 123 files,
full typecheck, CSS lint, build, and the production dependency audit gate passed.
The downloaded public 0.8.0 ZIP matched its updater size/SHA512 and passed
codesign, Gatekeeper, and stapler checks. Its app passed the breadcrumb,
formatting shortcuts, tabs, independent undo/save, and close-to-one workflows.
See [the release record](../docs/release-0.8.0-verification.md).

Release preflight verified GitHub access, the signing identity, and the existing
`meetrec-notary` profile used by Iliad 0.7.0. No credentials were changed. The
release is [Iliad MD 0.8.0](https://github.com/brainforwarding/iliad/releases/tag/v0.8.0).
