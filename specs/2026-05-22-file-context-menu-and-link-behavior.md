# File Context Menu And Link Behavior

## Goals

- Remove the hover rename button from file tree rows.
- Move file and folder actions into a right-click context menu.
- Keep the file tree minimal and stable while still supporting common local file actions.
- Make rendered Markdown links behave like reading-mode links unless the caret is inside the link source.
- Open external web and mail links through the operating system instead of navigating inside the app.

## UX Decisions

- File tree rows do not expose inline action buttons on hover.
- Right-clicking a Markdown or external file shows `Duplicate`, `Rename`, and `Move to Trash`.
- Right-clicking a folder shows `Rename` and `Move to Trash`.
- Folder duplication is intentionally out of scope for this pass.
- Trash operations use the operating system Trash and ask for confirmation:
  - Files: `Move "name.md" to Trash?`
  - Folders: `Move "Folder" and its contents to Trash?`
- If the active document is moved to Trash, the editor clears instead of keeping a stale buffer.
- Rename keeps the existing inline rename input, but it is only entered from the context menu or creation flow.

## Link Behavior

- Default Markdown link rendering replaces `[label](url)` with a visible clickable `label`.
- Hovering a rendered link uses a pointer cursor and a subtle color shift.
- Clicking a rendered external link opens it through Electron `shell.openExternal`.
- Clicking a rendered local link opens the local Markdown target or external file target when available.
- Raw link syntax is revealed only when the editor caret or text selection intersects the actual link source range.
- Selecting or editing elsewhere on the same line must not reveal every link on that line.

## Non-Goals

- Native OS context menu integration.
- Folder duplication.
- Drag-and-drop moves.
- Rich link preview popovers.
- Full Markdown source/read mode switching.

## Verification

- Typecheck and production build must pass.
- Smoke test:
  - Right-click a file row and see the requested menu actions.
  - Duplicate a file and confirm the copy appears in the tree.
  - Move a disposable file to Trash and confirm it disappears.
  - Confirm external Markdown links call the external open path.
  - Confirm a link remains rendered when the line is selected but the caret is outside the link.
