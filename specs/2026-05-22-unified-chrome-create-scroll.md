# Unified Chrome, File Creation, and Document Scroll

## Problem

The app currently fixes the macOS traffic-light overlap by reserving a full-width window chrome row, then adds a separate document topbar below it. That solves one collision but makes the writing surface feel heavy and wastes vertical space. The sidebar header also still exposes global actions that are either unclear or misplaced: rename is a file-level action, not a workspace-level action, and switching workspaces does not belong in the primary writing sidebar yet.

The `+` action appears dead because it depends on `window.prompt()`. If the prompt does not appear clearly, is dismissed, appears behind the window, or returns an empty value, nothing visible happens. Trackpad scrolling also remains unreliable because the app over-constrains the layout with hidden overflow and relies on a fragile CodeMirror wheel handler instead of a clear scroll owner with a native macOS overlay scrollbar.

## Goals

- Replace the two-row title/header model with one useful top bar.
- Keep the macOS traffic-light area separate from sidebar content, without reserving an empty full-width row.
- Show the active Markdown document name once, in an Obsidian-style tab/dent in the unified top bar.
- Remove the visible open-folder action from the sidebar header for now.
- Remove global/sidebar-header rename.
- Keep the root workspace folder name read-only.
- Make `+` create a Markdown file immediately and visibly.
- Put rename affordances on individual Markdown file rows only.
- Make trackpad/mouse-wheel scrolling move the document and show the native/overlay vertical scrollbar.
- Keep hidden files and folders hidden.

## Non-Goals

- No search, bookmarks, tabs beyond the one active document label, command palette, or workspace switcher.
- No root folder/workspace rename.
- No folder rename in this pass.
- No multi-file create dialog.
- No custom fake scrollbar.
- No broad typography redesign beyond the spacing needed for the chrome and scroll fixes.

## UX Target

Windowed layout:

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ ● ● ●                                      ╭─ guia-markdown.md ─╮      [⛶] │
├───────────────────────────────┬──────────────────────────────────────────────┤
│ mis-docs-antigravity        + │                                              │
│                               │                                              │
│ [md] guia-markdown.md      ✎  │              Guía de Markdown                │
│ [md] planificacion_gil...  ✎  │                                              │
│ [dir] assets                  │  Markdown permite escribir documentos con     │
│ [txt] archivo.txt             │  estructura usando texto simple.             │
│ [pdf] Gilgamesh.pdf           │                                              │
└───────────────────────────────┴──────────────────────────────────────────────┘
```

Fullscreen keeps the same single top bar, but the traffic-light space is visually quiet because macOS owns those controls:

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│                                            ╭─ guia-markdown.md ─╮      [⛶] │
├───────────────────────────────┬──────────────────────────────────────────────┤
│ mis-docs-antigravity        + │                                              │
│                               │                                              │
│ [md] guia-markdown.md      ✎  │              Guía de Markdown                │
│ [md] planificacion_gil...  ✎  │                                              │
│ [dir] assets                  │  Markdown permite escribir documentos con     │
└───────────────────────────────┴──────────────────────────────────────────────┘
```

## Functional Flow

### Unified top bar

- `.app-shell` has two rows: unified topbar and content.
- The topbar has a left area matching the sidebar width and a right editor area.
- The left topbar area reserves only the macOS traffic-light safe space and remains draggable.
- The right topbar area contains the active document tab/dent and the existing focus button.
- The sidebar toggle remains available as the leftmost control in the editor area of the unified topbar, not inside the editor document body.
- The current document name appears only once.
- The previous separate `.document-topbar` is removed from the editor body.

### Sidebar actions

- Sidebar header shows:
  - read-only workspace name
  - one `+` button
- Sidebar header does not show:
  - rename
  - open/switch folder
- `+` is clickable and visibly creates a file.

### Create Markdown file

- Clicking `+` flushes any pending save.
- The app calls `createMarkdown(workspace.path, workspace.path, "untitled.md")` directly.
- The backend's existing uniqueness logic creates `untitled.md`, `untitled-2.md`, etc.
- Only one create operation may run at a time; the `+` button is disabled or visibly busy while pending.
- The refreshed tree is the source of truth after creation.
- The new file appears in the tree, opens immediately, and enters inline rename mode only after the refreshed/hydrated node exists.
- Failure shows the existing error toast.

### Row-level rename

- Markdown rows show a pencil only on hover or keyboard focus.
- Each row is a non-nested interactive layout: a row open/toggle button plus a separate rename button/input.
- Clicking the row pencil starts inline rename for that file.
- Inline rename:
  - `Enter` commits.
  - `Escape` cancels.
  - Blur commits if the value changed, otherwise cancels.
  - Empty names cancel.
- Rename keeps the file in its current directory.
- Rename edits the visible basename/stem; the app owns the `.md` extension.
- If a renderer or IPC caller sends a basename without an extension, the main process appends `.md`.
- Rename rejects `/`, `\`, `..`, leading `.`, and explicit non-Markdown extensions.
- Rename failures show the existing error toast and keep the row usable.
- Only Markdown files are renameable in this pass.
- If the renamed file is the active document, `activeFile` updates to the refreshed renamed node.
- If a non-active file is renamed, the currently open document remains open.

### Document scrolling

- The document editor has one practical scroll owner: CodeMirror's `.cm-scroller`.
- `.cm-scroller` must have native `overflow: auto`.
- Parent containers may constrain height but must not intercept wheel events in a way that prevents `.cm-scroller` from scrolling.
- Add a capture-level wheel fallback at the editor surface if needed, scrolling `.cm-scroller` directly when native wheel handling fails.
- Do not implement a fake scrollbar. The expected indicator is the native macOS overlay scrollbar, visible while scrolling and fading afterward.

## Security and Data Safety

- New files and renames must remain inside the current workspace root.
- Existing Electron IPC guards continue to enforce workspace containment.
- The main-process rename handler must enforce basename-only Markdown filenames, not only renderer validation.
- Hidden files/folders remain filtered by the directory reader.
- No destructive file operations are introduced.

## Implementation Notes

- Create a small topbar component or inline layout in `App.tsx`; keep it close to the current app shell until there is a broader navigation model.
- Remove `window.prompt()` from create and rename paths.
- Replace `renameActiveFile` with `renameNode(file, requestedName)` so rename is tied to a specific row.
- Update `FileTree` props for `creatingFile`, `renamingPath`, `onStartRename`, `onCancelRename`, and `onCommitRename`.
- Remove `canRename`, `onRenameActive`, and `onOpenWorkspace` from the visible sidebar header.
- Remove `editorWheelScrollExtension` from CodeMirror extensions if the capture-level fallback replaces it.
- Keep existing save/refresh/open flows: create/rename should flush pending edits before file operations.

## Required Verification

- `npm run typecheck`
- `npm run build`
- Local dev smoke start with `npm run dev`, then stop it.
- Manual UI checks in Electron:
  - In windowed mode, only one top row appears.
  - Sidebar content starts below the topbar and does not collide with macOS traffic lights.
  - The active document name appears once.
  - Sidebar header has workspace name and `+` only.
  - Clicking `+` creates and opens an `untitled*.md` file.
  - Row pencil appears only for Markdown rows on hover/focus.
  - Trackpad/mouse-wheel scroll moves the document.
  - Native overlay scrollbar appears while scrolling.

## Open Assumptions

- Keeping the existing focus-mode button is acceptable because it already exists and is not a new feature.
- Keeping the existing sidebar toggle behavior is acceptable only if it does not add visible clutter; if it does, it should be deferred.
- Workspace switching remains available only from the launch state or future menu/command flow, not from the primary sidebar header.
