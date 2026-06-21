# Contextual External Review Strip

## Problem

Always-on external file capture made the sidebar pending-review strip more
important, but the first implementation showed the same global actions even
when the changed document was already open in review. In that state, the editor
toolbar already offers the concrete file-level choices, so the sidebar buttons
read as duplicate controls.

There is also a visual issue in source-rendered review diffs: inserted prose
lines are shifted a few pixels to the right before the user keeps the change.
Accepted text then aligns normally, which makes the review state look less
polished than the final document.

## Decision

The sidebar strip is contextual:

- No pending review items: render no strip.
- One pending review item, and that exact item is already visible in the
  editor review: render the count only. Do not show `Review` or the bulk restore
  action because the editor toolbar already has `Keep changes` and
  `Restore previous version`.
- Pending review exists but no review item is currently visible: show
  `Review` and the bulk action.
- Multiple pending review items: keep the strip actions visible, even if one
  item is currently open, because the strip still helps move through the set
  and exposes the bulk restore operation.

The bulk action copy changes from `Undo outside changes...` to
`Restore all...`. The ellipsis remains because the action is bulk and should
continue to confirm consequences before touching files.

The primary review action is shortened from `Review outside changes` to
`Review`. The strip summary already says these are pending review items, and the
short label avoids wrapping in a narrow sidebar.

Inserted source-rendered review lines should align with normal editor text for
prose. List insertions can keep their list-specific indentation.

Deleted files must remain visible in the file tree as review rows even though
the path no longer exists on disk. A deleted Markdown file should appear in its
former folder with the deleted-file styling, including the strikethrough name,
so the pending review count always maps to visible reviewable items.

Pending dots belong primarily to changed files. Folders should show pending
dots only when they are collapsed and hiding changed descendants. Once a folder
is expanded and the changed file rows are visible, the folder dot should
disappear. This keeps parent folders useful as breadcrumbs without competing
with the actual changed files.

Bulk restore must reconcile renderer state from the main process after the
action finishes. External filesystem review proposals are session-scoped and may
be removed entirely after the restore, so the renderer must reload proposals,
refresh the tree, clear any active review target, and reload the active document
from disk when the visible review was restored.

## Rationale

The editor review toolbar is the best place for file-level decisions because it
is adjacent to the diff. The sidebar is better at orientation: telling the user
that there are pending items, helping them open review when they are elsewhere,
and providing the rare bulk restore command.

Keeping the strip instead of deleting it covers common external-agent workflows:
the user may be looking at a clean file while an agent edits another file, or
there may be several files pending at once. In those cases the sidebar needs to
remain visible and actionable.

## Key Tests

- File tree renders no pending strip when the pending review count is zero.
- File tree renders both actions when review items exist and no review item is
  already visible.
- File tree renders only the count when there is exactly one pending review item
  and it is already visible in the editor review.
- File tree keeps both actions visible for multiple pending review items even
  when one item is visible.
- Busy state disables the visible strip actions.
- English and Spanish sidebar copy uses `Review` / `Revisar` and
  `Restore all...` / `Restaurar todo...`.
- Source-rendered inserted prose has no extra left padding; accepted text and
  review text should share the same visual start line.
- A deleted file whose path is missing from disk still appears as a virtual
  deleted row under its former parent folder.
- Expanded folders with visible changed descendants do not show pending dots;
  collapsed folders with hidden changed descendants do.
- Bulk restore of an external review replaces stale renderer proposal state
  with `agent:list-proposals`, refreshes the file tree, and reloads the active
  document if the visible review was restored.

## Visual QA

Use a fresh temp workspace and the Electron dev app:

1. Open a document, then edit that same file externally. The editor shows the
   diff and toolbar; the sidebar shows only `1 pending review item`.
2. Edit a second file externally while the first file is still open. The sidebar
   shows the count and both strip actions.
3. Navigate to a clean file while review items remain pending. The sidebar shows
   the count and both strip actions.
4. Keep the visible file change. Accepted prose aligns exactly where the green
   inserted source line appeared during review.
5. Delete one Markdown file externally. Its former folder shows the struck
   deleted-file row when expanded, and the pending review count includes that
   row.
6. Expand folders that contain pending files. The actual changed file rows keep
   their dots; expanded parent folders do not.
7. With several external review items visible, choose `Restore all...`. All
   review rows and dots disappear, deleted files reappear as normal files, and
   the editor leaves the read-only review view.
