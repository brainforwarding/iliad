# Sidebar Root Background Selection

Date: 2026-06-15
Status: reviewed; ready for implementation
Scope: File tree creation target selection and workspace-root drop target.

## Problem

Iliad currently renders a visible `Workspace root` row at the bottom of the file
tree. Clicking it selects the workspace root as the target for new documents and
folders, then shows a toast: "New files will be created at the workspace root."

This is too explicit for a background state. The root is not really a file-tree
item in the same way a document or folder is. The visible row also takes space,
looks like a button, and makes a simple mental model feel heavier.

## Recommendation

Remove the visible `Workspace root` row and make empty file-tree space select the
workspace root silently.

The mental model:

- Rows are explicit file and folder targets.
- The file-tree background is the workspace-root target.

Clicking background space should clear any visible creation-target row
highlight. Internally, the creation target should become the workspace root.
There should be no toast.

## Interaction Rules

Clicking these targets should preserve current row behavior:

- Folder row: select that folder as the creation target and toggle expansion.
- Markdown row: select and open the document.
- External file row: select and open externally.
- Pending review row: open the pending review target.
- Rename input, search controls, toolbar buttons, context menus: do not select
  the root.

Clicking these areas should select the workspace root silently:

- Empty space below the last visible row.
- Empty gaps inside the tree scroll container that are not part of a row or
  control.
- Normal empty-tree states, such as an empty workspace message.

Visible row bands should span the available tree width. A click horizontally
aligned with a visible row is treated as row space, not workspace-root
background, even if the user clicks the blank indentation or right side of that
row.

The only immediate feedback is structural: any previously selected row loses its
selected highlight. Internally, `selectedTreePath === workspace.path` still
means the root is selected, but no visible row should represent that state. The
active/open document may remain visually active because that is a different
state from the creation target.

When the next create command uses the root target, the resulting item should be
inserted, selected, and revealed at the workspace root, so the action result is
clear without a toast.

## Drag And Drop Rules

The workspace root must remain a valid move target even after removing the
visible row.

- Dragging a file/folder over empty tree background should show the existing
  root drop target behavior as a non-row state on the tree scroll area, such as
  a subtle outline and background tint.
- Dropping a move payload on empty tree background should move the item to the
  workspace root.
- Dragging over actual rows should keep current row-specific folder drop
  behavior.
- Search result mode should not expose a root target. Background clicks and
  drops while search is open should not select or drop to the workspace root.

## Accessibility

Removing the visible root row removes a keyboard-focusable root row. The
existing `Escape` behavior should remain: when focus is in the sidebar and
search, rename, and context menus are inactive, pressing `Escape` silently
selects the workspace root internally and clears visible creation-target row
highlight.

If an additional keyboard path becomes necessary later, add a menu item or
shortcut rather than reintroducing a visible row.

## Implementation Notes

Current relevant behavior:

- `selectedTreePath === workspace.path` already means "workspace root selected."
- `resolveCreationDirectoryPath` already treats `selectedTreePath === workspacePath`
  as root.
- `FileTree` already has click/drop handlers on `.tree-scroll`.
- `FileTree` also renders a `.tree-root-target` row that should be removed.
- `App.tsx` currently sets a toast in `onSelectWorkspaceRoot`; this should become
  a silent state update.

Implementation should:

1. Remove the `.tree-root-target` row from `FileTree`.
2. Keep `.tree-scroll` background click handling, gated off while search is
   open.
3. Use an explicit background-event rule: select/drop root only when the event
   target is not inside `.tree-item`, content-search rows, buttons, inputs,
   rename forms, search controls, or menus.
4. Keep root drag/drop on `.tree-scroll` background and add a
   `.tree-scroll.is-root-drop-target` visual state with drag-leave cleanup.
5. Change `App.tsx` root selection callback to only set
   `setSelectedTreePath(workspace.path)`.
6. Remove unused root-row labels/styles:
   `selectWorkspaceRoot`, `workspaceRootSelected`, `FileTreeLabels.selectWorkspaceRoot`,
   and `.tree-root-target*`.
7. Keep `workspaceRoot` and `fileTreeMoveRootTarget`; they are still used for
   create labels and drag/drop status.

## Tests

Suggested focused tests:

- `resolveCreationDirectoryPath` continues to return workspace root when
  `selectedTreePath === workspacePath`.
- If a DOM test harness is practical, add focused coverage for background click
  routing and root drop target cleanup. Otherwise, treat the manual QA below as
  required.

Manual QA:

- Select a folder; verify it has selected highlight.
- Click empty space below the tree; verify selected highlight clears.
- Click New document; verify the document is created at workspace root.
- Click a folder row; click New document; verify the document is created in that
  folder.
- Drag a file to empty tree background; verify it moves to workspace root.
- Drag a file over empty tree background; verify the scroll area shows root drop
  feedback and clears it on drag leave.
- Use name search and content search; verify there is no root target row and
  background clicks/drops do not select or move to root.
- Focus the sidebar and press Escape with search, rename, and context menus
  inactive; verify selected row highlight clears and the next create action uses
  workspace root.
