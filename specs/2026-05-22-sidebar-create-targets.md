# Sidebar Create Targets

## Problem

The sidebar had one `+` action that always created a Markdown file at the workspace root. That made folder organization difficult: users could open or select a folder, but new files still appeared at the root, and there was no way to create a folder from the app.

## Goals

- Replace the single `+` with two explicit top actions:
  - New document
  - New folder
- Create new documents/folders inside the selected folder.
- If a file is selected, create beside that file.
- Fall back to the active document's folder, then workspace root.
- Show selected folder/file state minimally in the file tree.
- Keep the sidebar calm and avoid turning it into a heavy file manager.

## UX Decisions

- Use icon-only header buttons with tooltips: `New document` and `New folder`.
- Clicking any tree row selects it.
- Clicking a folder row also keeps the existing expand/collapse behavior.
- Active file remains the strongest highlight.
- Selected folder/file uses a weaker neutral highlight so it reads as the creation target, not the open document.
- After creation, refresh the tree and show inline rename at the created row.
- Creating inside a folder auto-expands the target folder so the new item is visible.

## Non-Goals

- No context menu.
- No delete/move-to-trash.
- No drag/drop moving.
- No multi-select.
- No folder picker in the create flow.

## Implementation Notes

- Add selected tree path state in `App`.
- Derive creation target:
  1. selected directory
  2. parent of selected file
  3. parent of active Markdown file
  4. workspace root
- Add Electron IPC for folder creation.
- Reuse backend path containment and hidden-path validation.
- Folder creation starts as `untitled folder`, using backend uniqueness.
- Folder rename uses inline rename for the newly created folder.

## Verification

- `npm run typecheck`
- `npm run build`
- Manual/Electron smoke:
  - New document at root.
  - New folder at root.
  - Select folder, create document inside it.
  - Select folder, create folder inside it.
  - Select file inside folder, create document beside it.
  - Selected folder state is visible but weaker than active file.
