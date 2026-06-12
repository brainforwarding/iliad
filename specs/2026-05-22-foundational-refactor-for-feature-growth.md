# Foundational Refactor For Feature Growth

Date: 2026-05-22
Status: implementation-ready

## Product Intent

Iliad should remain a calm, local-first Markdown writing app while the codebase gets ready for larger editor and file-management features. This refactor must preserve the current user experience and move responsibilities out of the few files that currently own too much behavior.

The goal is not to make the app feel different. The goal is to make the next features easier to add without weakening autosave, file safety, visual Markdown behavior, or the minimal writing UI.

## Problem

Iliad is still small, but the current code structure is already concentrating too much responsibility in a few files:

- `src/App.tsx` owns workspace state, document persistence, file actions, context menus, link routing, typography preferences, notices, and layout.
- `src/editor/visualMarkdown.ts` owns Markdown parsing, CodeMirror decoration rules, widgets, active-line behavior, and feature-specific rendering for links, tables, images, tasks, quotes, headings, and inline styles.
- `electron/main.ts` owns window setup, app lifecycle, custom protocol handling, path safety, workspace reading, file operations, image asset handling, shell actions, and IPC registration.
- `src/styles.css` owns reset styles, app layout, sidebar UI, editor UI, popovers, toasts, responsive rules, and visual Markdown styling.

That is acceptable for a prototype, but it is a poor base for a Typora-scale feature backlog. Adding outline, search, find/replace, export, code fences, math, diagrams, shortcuts, preferences, or richer file management directly into these files would make changes harder to reason about and easier to break.

## Goals

- Preserve all current user-visible behavior.
- Reduce the size and responsibility of `App.tsx`, `visualMarkdown.ts`, `electron/main.ts`, and `styles.css`.
- Create clear owner modules for file actions, document persistence, preferences, visual Markdown features, Electron IPC, and styles.
- Make extracted pure helpers testable, and add focused tests if that can be done without pulling the refactor into a full Electron E2E suite.
- Keep preload API names and renderer `window.iliad` contracts stable.
- Keep the local-first security model intact in Electron main, including workspace boundary checks, hidden-path rejection, file type rules, and external URL restrictions.
- Keep CodeMirror as the editor and keep the current lightweight visual Markdown model.
- Update architecture documentation so future contributors know where new features belong.

## Non-Goals

- No new user-facing features.
- No redesign of the current UI.
- No replacement of CodeMirror.
- No full Markdown preview renderer.
- No Electron E2E suite.
- No new persistence format.
- No new Electron permissions.
- No preferences panel, command palette, search, outline, export, math, diagrams, theme system, or shortcut system in this pass.
- No broad dependency changes.
- No database, Supabase, backend service, or remote deployment work.

## Panel Selection

This change touches Electron file safety, renderer state, React components, CodeMirror decorations, CSS ownership, and docs. The workflow panel is:

- Architecture/spec reviewer: checks module boundaries, missing risks, and verification coverage before the spec is final.
- Implementation worker: performs the code extraction and behavior-preserving refactor in the worktree.
- Verification worker: independently reviews the final patch and runs the relevant local checks.

The orchestrator owns investigation, spec reconciliation, integration, final verification, commit decision, and worktree cleanup.

## Target Module Map

The refactor should move toward this concrete structure. Empty folders should not be added just to satisfy the diagram.

```text
electron/
  main.ts
  fs/
    fileOps.ts
    pathSafety.ts
    workspaceRegistry.ts
  ipc/
    assets.ts
    files.ts
    shell.ts
    workspace.ts
  window/
    createWindow.ts

src/
  App.tsx
  app/
    useDocumentPersistence.ts
    useWorkspace.ts
  components/
    EditorErrorBoundary.tsx
    EditorPane.tsx
    FileTree.tsx
    TreeContextMenu.tsx
    TypographyMenu.tsx
  editor/
    imageDropPaste.ts
    paths.ts
    visualMarkdown/
      activeRanges.ts
      blocks.ts
      index.ts
      inline.ts
      tables.ts
      widgets.ts
  files/
    fileActions.ts
    fileTree.ts
    pathUtils.ts
  preferences/
    editorPreferences.ts
  styles/
    app.css
    base.css
    chrome.css
    editor.css
    popovers.css
    sidebar.css
    visual-markdown.css
  types/
    iliad.ts
```

`src/components/EditorPane.tsx` remains a UI component that wires CodeMirror extensions. `src/editor/` is for editor helpers and CodeMirror extension modules, not app-level link routing or persistence.

## Architecture Decisions

### App Orchestration

`App.tsx` should become a composition layer:

- Render app shell and top-level components.
- Connect hooks/components together.
- Own high-level app mode state such as sidebar visibility, focus mode, transient error/notice state, selected tree path, and rename state.

It should not directly contain:

- filesystem action implementations
- save debounce implementation
- localStorage parsing for preferences/workspace
- path relocation utilities
- context menu rendering
- typography popover rendering

### Workspace And Persistence

Workspace loading and persisted-workspace storage should live in a renderer app hook/module.

Document persistence should own:

- document text and saved text
- save status and last saved timestamp
- debounced autosave
- save flushing before navigation, create, rename, duplicate, trash, and workspace switching
- save errors that block unsafe navigation

The save-before-navigation behavior is a critical invariant. If flushing fails, navigation or destructive file actions must stop.

### File Actions And Tree Helpers

File-tree helpers should expose stable, focused functions:

- `findNode`
- `parentDirectoryPath`
- `pathIsSameOrInside`
- `relocatePath`

File actions should expose semantic operations:

- `openNode`
- `createMarkdownFile`
- `createFolder`
- `renameNode`
- `duplicateNode`
- `moveNodeToTrash`
- `insertImage`
- `openDocumentLink`

These operations should preserve the current behavior:

- External files open through the operating system.
- Markdown files open inside Iliad.
- Create target is selected folder, selected file parent, active file parent, then workspace root.
- New Markdown documents open and enter inline rename mode.
- New folders enter inline rename mode.
- Rename updates active and selected paths when folders/files move.
- Trash of an active document or active document folder clears the editor.
- Local Markdown links open inside Iliad; supported external links open externally; unsupported heading links show the current notice.
- Visual Markdown link widgets only emit hrefs through the callback; workspace-aware link routing stays in app/file action code.

### Save And Navigation Behavior Matrix

| Behavior | Required outcome |
| --- | --- |
| Save flush fails before opening another Markdown file | Abort navigation, keep current document active, show save error |
| Save flush fails before opening a new workspace | Abort workspace switch, keep current workspace and active document |
| Save flush fails before create/rename/duplicate/trash | Abort the file operation |
| Folder rename contains active Markdown file | Relocate active file path to the renamed folder path |
| Folder rename contains selected tree path | Relocate selected path to the renamed folder path |
| Trash target contains active Markdown file | Clear active file, document text, saved text, save status, and last saved timestamp |
| Trash target contains selected or renaming path | Clear selected/renaming state as appropriate |
| Duplicate external file | Duplicate it, select it, and do not open it in the editor |
| Duplicate Markdown file | Duplicate it, select it, and open it in the editor |
| Heading-only local link | Keep current behavior and show the unsupported heading-link notice |

### Preferences

Editor typography preferences should move out of `App.tsx` into a focused preferences module:

- define defaults
- clamp font size
- validate font preset
- read/write `localStorage`
- expose React state helpers or a hook

Preferences remain local display settings and must not alter Markdown files.

### Visual Markdown

The visual Markdown extension should become a registry/composer rather than a single feature pile.

Each feature area should own its parsing and decoration creation:

- headings, blockquotes, and list line classes
- task checkboxes and bullet widgets
- images
- links
- inline strong/emphasis/code
- table detection and row widgets

Shared utilities should live in small modules:

- active line and selection range detection
- blocked range handling
- inline decoration scanning
- shared widgets

The visual layer must remain defensive: if decoration building fails, the editor should log the error and fall back to no visual decorations for that update instead of blanking.

Decoration ordering must match the current pipeline:

1. Collect table line metadata for the document.
2. For each line, compute active-line state and create one blocked-range list.
3. Add heading, blockquote, and list line classes.
4. If the line is an inactive table line, replace the full row/separator, add table line classes, and skip remaining inline decorators for that line.
5. On inactive non-table lines, hide heading, blockquote, task, bullet, image, strong, emphasis, and inline-code syntax in the current order, adding blocked ranges as replacements are created.
6. Add link widgets last, skipping image links, blocked ranges, and current selection intersections.
7. Return one sorted `DecorationSet` from the central composer.

Feature modules should share the same `ranges` array and blocked-range list through the central composer. They should not independently return separate decoration sets that could reorder or overlap decorations incorrectly.

### Electron Main Process

`electron/main.ts` should be reduced to app lifecycle wiring:

- register the `iliad-file` privileged scheme before app readiness
- install protocol handler after app readiness
- register IPC modules
- create the app window
- handle macOS activate and non-macOS quit behavior

Move file and IPC concerns into:

- `electron/window/createWindow.ts`: BrowserWindow creation and app loading
- `electron/fs/workspaceRegistry.ts`: allowed workspace root registration and asset protocol authorization
- `electron/fs/pathSafety.ts`: workspace boundary checks, visible path checks, Markdown extension/name validation, and external URL validation
- `electron/fs/fileOps.ts`: directory reads, read/write Markdown, create, rename, duplicate, trash metadata, image asset path helpers
- `electron/ipc/workspace.ts`: workspace dialog and tree reads
- `electron/ipc/files.ts`: file IPC handlers
- `electron/ipc/assets.ts`: image asset save and asset URL support
- `electron/ipc/shell.ts`: external URL/file opening

Renderer safety is not enough. Electron main must keep enforcing workspace boundaries, hidden-path rejection, Markdown file edit restrictions, safe rename rules, and external URL restrictions.

Electron security defaults must stay unchanged:

- `contextIsolation: true`
- `nodeIntegration: false`
- preload API shape unchanged
- no renderer imports into Electron main modules

#### IPC Validation Contracts

| IPC channel | Validation invariant | Return shape |
| --- | --- | --- |
| `workspace:open-dialog` | User-selected directory is remembered in workspace registry | `WorkspaceInfo | null` |
| `workspace:read-directory` | Workspace root is remembered before read; hidden/ignored paths excluded | `FileTreeNode[]` |
| `file:read-markdown` | `ensureMarkdownFile(workspaceRoot, filePath)` | `string` |
| `file:write-markdown` | `ensureMarkdownFile(workspaceRoot, filePath)` | `{ savedAt: string }` |
| `file:create-markdown` | Directory is visible and inside workspace; generated file remains visible and inside workspace | `FileTreeNode` |
| `folder:create` | Directory is visible and inside workspace; generated folder remains visible and inside workspace | `FileTreeNode` |
| `file:rename` | Source and destination are visible and inside workspace; file/folder name validation depends on source kind | `FileTreeNode` |
| `file:duplicate` | Source and duplicate target are visible and inside workspace; folders remain unsupported | `FileTreeNode` |
| `file:trash` | Target is visible and inside workspace and exists | `void` |
| `shell:open-url` | URL protocol is only `http:`, `https:`, or `mailto:` | `void` |
| `file:open-external` | Target is inside workspace; hidden paths remain allowed only if already referenced by a visible tree item behavior remains unchanged | `string` |
| `asset:save-image` | Document path is inside workspace; saved asset remains inside workspace assets directory | `SavedImageAsset` |
| `iliad-file://` protocol | File is inside a remembered workspace root | proxied file response or `403` |

### Styling

Split `src/styles.css` by responsibility and import through one central app stylesheet.

Required import order:

1. `base.css`
2. `chrome.css`
3. `sidebar.css`
4. `editor.css`
5. `visual-markdown.css`
6. `popovers.css`
7. media/responsive rules last, either at the bottom of `app.css` or in a final imported file

The split must preserve class names and visual intent. There should be no visual redesign during this stage.

Scroll guardrail:

- `.editor-surface` remains the scroll owner.
- `.editor-surface .cm-scroller` remains non-owner with `overflow: visible !important`.
- Runtime CodeMirror theme may still define `.cm-scroller` defaults, but global editor CSS must keep the app-level scroll geometry intact.

## Implementation Plan

### Stage 1: Electron Boundary Split

- Extract window creation from `electron/main.ts`.
- Extract workspace registry, path safety helpers, and file operation helpers.
- Register IPC handlers through small modules.
- Keep privileged scheme registration timing intact.
- Keep preload API names unchanged.
- Keep all current Electron behavior unchanged.

Verification:

- `npm run typecheck`
- `npm run build`
- Manual smoke path when possible: open workspace, create file/folder, rename, duplicate, move to Trash, open external file, open external URL.

### Stage 2: Renderer State, Preferences, And File Actions

- Move persisted workspace helpers into `src/app/useWorkspace.ts`.
- Move debounced save and flush-save logic into `src/app/useDocumentPersistence.ts`.
- Move tree/path helpers into `src/files/fileTree.ts` and `src/files/pathUtils.ts`.
- Move file action orchestration into `src/files/fileActions.ts`.
- Move typography storage/defaults into `src/preferences/editorPreferences.ts`.
- Keep `App.tsx` as the coordinator.

Verification:

- Pending edits still save before opening another file.
- Create file/folder still targets selected folder or selected file parent.
- Rename still updates active and selected paths.
- Trash of active document still clears the editor.
- Typography settings persist and reload.

### Stage 3: Component Split

- Extract `TreeContextMenu` from `App.tsx`.
- Extract `TypographyMenu` from `App.tsx`.
- Keep `FileTree` focused on tree rendering and inline rename.
- Keep `EditorPane` focused on CodeMirror setup and editor-level callbacks.

Verification:

- No visual regression in topbar, sidebar, context menu, typography popover, and editor.
- Keyboard Escape still closes transient UI.
- Pointer-down outside the menus still closes them.

### Stage 4: Visual Markdown Modularization

- Move shared decoration utilities into `visualMarkdown/activeRanges.ts`.
- Move shared widgets into `visualMarkdown/widgets.ts`.
- Split table parsing and table widgets into `visualMarkdown/tables.ts`.
- Split line/block decorations into `visualMarkdown/blocks.ts`.
- Split inline decoration rules into `visualMarkdown/inline.ts`.
- Keep `visualMarkdown/index.ts` as the public CodeMirror extension export.
- Preserve defensive fallback.

Verification:

- Headings, blockquotes, lists, tasks, images, tables, links, bold, italic, and inline code behave as before.
- Active-line/caret reveal rules still work.
- Link widgets still open through the provided callback.
- A malformed table or image does not crash the editor.

### Stage 5: CSS Split

- Move styles into responsibility-specific files.
- Import them from `src/styles/app.css`.
- Update `src/main.tsx` to import `src/styles/app.css`.
- Do not rename classes unless there is a direct maintainability gain.

Verification:

- `npm run build` emits CSS successfully.
- Compare desktop and narrow widths when a manual UI pass is possible.
- Confirm scroll ownership remains `.editor-surface`, not `.cm-scroller`.

### Stage 6: Documentation And Tests

- Update `docs/architecture.md` with the final module map.
- Add a short "where new features go" section.
- Keep the current verification notes and add smoke-test notes for easy regressions.
- If a lightweight test runner is added, cover pure helpers only: path/name safety, renderer path relocation, preference clamping/parsing, and visual Markdown table parsing. Do not add Electron E2E tests in this pass.

## Acceptance Criteria

- All current behavior remains intact.
- `App.tsx`, `electron/main.ts`, the public visual Markdown entry, and top-level CSS entry are smaller and more focused.
- New modules stay focused and have clear owners.
- `electron/main.ts` is lifecycle and registration code, not file operation code.
- `src/editor/visualMarkdown/index.ts` exports the same public `visualMarkdown` extension API.
- CSS is split without class-name or visual intent drift.
- Preload and `window.iliad` API names stay stable.
- `docs/architecture.md` reflects the new structure and tells future contributors where new feature work belongs.
- `npm run typecheck` passes.
- `npm run build` passes.

## Required Verification

Automated:

- `npm run typecheck`
- `npm run build`

If a test script is added:

- `npm test`

Manual Electron smoke checks when a display session is available:

- Open a workspace.
- Open Markdown files repeatedly.
- Create a document and folder at root and inside a selected folder.
- Rename Markdown documents without typing `.md`.
- Duplicate a file.
- Move a disposable file to Trash.
- Open an external file from the tree.
- Click external and local Markdown links.
- Change typography settings and reload.
- Trackpad/wheel scroll a long document.
- Confirm visual Markdown examples still render: headings, quotes, links, tables, images, task lists, bold, italic, and inline code.

Remote:

- No GitHub remote, CI, or deployment provider is configured in this repository, so there is no remote verification surface for this change.

## Risks And Mitigations

- Splitting `visualMarkdown.ts` can change decoration ordering.
  - Mitigation: preserve the exact pipeline and blocked-range behavior; keep one public extension composer.
- Splitting file actions can weaken save-before-navigation behavior.
  - Mitigation: make `flushSave` an explicit dependency of every navigation/destructive operation and keep errors blocking.
- Splitting Electron code can weaken workspace path safety.
  - Mitigation: centralize safety checks in Electron main modules and keep all IPC handlers using the contract table above.
- CSS splitting can cause subtle visual regressions if import order changes.
  - Mitigation: preserve source order through the central stylesheet and keep media rules last.
- A too-large one-shot refactor can make regressions hard to isolate.
  - Mitigation: implement in stages inside one branch and run typecheck/build after integration.

## Future Feature Readiness

This section is documentation only. Do not create these modules in this refactor unless they are required by an extraction above.

After this refactor, likely next feature areas should have obvious homes:

- Outline/table of contents: `src/editor/outline/` plus app shell component.
- Search/find-replace: `src/search/` and CodeMirror search integration.
- Export: `electron/ipc/export.ts` plus `src/export/`.
- Math/diagrams: dedicated visual Markdown feature modules with lazy rendering.
- Code fences: `src/editor/visualMarkdown/codeFences.ts`.
- Preferences panel: `src/preferences/` plus a settings component.
- Keyboard shortcuts/commands: `src/commands/`.

## Assumptions

- `master` is the production/trunk branch for this local-only repository.
- Branch and worktree mechanics apply for this change.
- The current CodeMirror-based visual editing model remains the right base.
- The refactor should be reviewed as architecture work, not as a product feature.
- No remote push/deploy will occur unless a remote is configured or the user asks for one.
