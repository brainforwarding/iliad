# File Tree Root Target And Drag Drop

Date: 2026-06-15
Status: reviewed with UX/API/regression agents -> ready to implement
Scope: file-tree creation target selection and pointer drag/drop organization. File-tree search is out of scope and should not be reviewed in this pass.

> Review note: folded in three agent reviews covering UX/accessibility,
> implementation/API boundaries, and regression coverage. The revision keeps
> search explicitly out of scope, adds keyboard/status affordances for root
> selection, avoids moving rows tied to pending proposals, strengthens move IPC
> validation, and makes save/history/context side effects explicit.

## Problem

Iliad's file tree already lets users select a folder and then create new
documents or folders inside it. Once a folder has been selected, however, there
is no direct way to select the workspace root again. If an active document lives
inside a folder, clearing selection is not enough because create-target logic
falls back to the active document's parent. Users should be able to click the
tree's root surface and make the next New document/New folder action land at
the workspace root.

The tree also lacks direct organization gestures. Moving a file or folder
currently requires leaving Iliad for Finder/Explorer or using external tooling.
Drag/drop should make common moves feel immediate while preserving the calm,
minimal tree UI.

## Goals

- Let users explicitly select the workspace root as the next create target.
- Let users click the file-tree root surface to select the workspace root.
- Let keyboard users select the workspace root without leaving the tree.
- Make the root target visible enough that users can tell the next create action
  will happen at root, without adding a heavy file-manager chrome.
- Add drag/drop moves for real files and folders inside the workspace.
- Support moving an item into a folder and moving an item back to root.
- Provide a minimal keyboard/menu equivalent for moving an item back to root.
- Preserve the existing Markdown-file drag payload used by assistant context
  attachment drops.
- Keep pending proposal rows display-only for filesystem moves.
- Keep file-tree search behavior untouched in this pass.

## Non-Goals

- No file-tree search changes.
- No arbitrary manual row ordering. The tree remains sorted by the existing
  directory/Markdown/assets/external order and localized name comparison.
- No multi-select moves.
- No cross-workspace or OS file imports by dropping external files into the
  tree.
- No agent proposal move/rename file type.
- No drag/drop for pending virtual create files or pending virtual folders.
- No moves for real files/folders that currently carry pending proposal state.
- No full destination picker in this pass. The only keyboard/menu move command
  required here is `Move to workspace root`; a richer `Move to...` folder picker
  should be specified separately.

## Current Architecture Fit

Relevant files today:

- `src/components/FileTree.tsx` owns row rendering, expansion state, row refs,
  pending display nodes, context-file drag payloads, search UI state, and tree
  interactions.
- `src/files/fileActions.ts` owns create, open, rename, duplicate, trash, copy
  path, reveal, and image insert workflows. Create-target derivation currently
  uses selected tree node, then active file parent, then workspace root.
- `src/files/fileTree.ts` exposes real-node lookup by absolute path or relative
  path.
- `src/files/pathUtils.ts` has parent/inside/relocate helpers that can be reused
  when moving active or selected paths.
- `src/app/useDocumentPersistence.ts` owns save status and `flushSave`; move
  behavior must not race in-flight writes to the old path.
- `src/app/useDocumentHistory.ts` stores absolute navigation paths that should
  be relocated when files/folders move.
- `src/assistant/contextAttachments.ts` owns the existing Markdown context drag
  payload and provides the pattern for a safe payload reader.
- `src/assistant/useAssistantRun.ts` stores manual context attachments by
  relative path; moves need explicit relocate/prune behavior for existing chips.
- `electron/fs/fileOps.ts`, `electron/ipc/files.ts`, `electron/preload.ts`, and
  `src/types/iliad.ts` expose filesystem IPC.
- `src/styles/sidebar.css` owns tree row, selected row, rename, pending, and
  search styling.

The existing `selectedTreePath: string | null` can represent root selection by
using `workspace.path`. The important fix is that create-target derivation must
treat `selectedTreePath === workspace.path` as an explicit workspace-root target
before trying to find a selected tree node.

## UX

### Root Selection

- The scrollable tree owns a root target surface:
  - the blank area below visible rows selects the workspace root;
  - a full-width root target strip with at least 32px height remains available
    after the rendered rows, so root selection does not collapse to an 8px
    gutter when the tree is full;
  - the strip should be visually quiet by default and stronger only when root
    is selected, focused, or an item is dragged over it.
- Clicking a row keeps current behavior:
  - real folder row: select folder and toggle expanded/collapsed;
  - real Markdown/external file row: select file and open or route as today;
  - pending proposal row: open review target and do not become a filesystem
    create target.
- Root selection should not close the active document or clear editor content.
  It only changes where the next create action lands.
- Root selection should be visually distinct from row selection. Recommended
  treatment:
  - add a subtle inset focus/selection wash to the root target surface;
  - keep row highlights off, because no row is selected;
  - keep the active document row highlight stronger than root target styling.
- If a context menu is open, clicking the tree background closes it and selects
  root.
- If an inline rename input is active, background clicks should let the existing
  blur/commit path finish first. After commit/cancel, the click may select root
  if the event target is still the tree background.
- Keyboard behavior:
  - if focus is inside the file tree and search, context menu, and rename are
    all inactive, `Escape` selects the workspace root;
  - if search, context menu, or rename is active, those existing Escape
    behaviors take priority and root selection does not run;
  - the root target strip itself can receive focus and activate with
    `Enter`/`Space`.
- Accessibility/status behavior:
  - add localized `aria-label` copy for the root target, for example
    `Workspace root`;
  - announce root selection through the existing notice/live-status pattern, for
    example `New files will be created at the workspace root`;
  - update New document/New folder tooltips and `aria-label`s with destination
    context, for example `New document at workspace root` or
    `New folder in Drafts`, without adding persistent visible explanatory text.

### Create Actions

The create target order becomes:

1. explicit root selection (`selectedTreePath === workspace.path`);
2. selected real directory;
3. parent of selected real file;
4. parent of active Markdown file;
5. workspace root.

This preserves the current active-file fallback while allowing an explicit root
selection to override it.

Extract this decision into an exported pure helper so it can be tested without
mounting `useFileActions`:

```ts
interface ResolveCreationDirectoryPathInput {
  workspacePath: string;
  selectedTreePath: string | null;
  selectedTreeNode: FileTreeNode | null;
  activeFile: FileTreeNode | null;
}
```

After creating at root:

- refresh the tree;
- select the created file/folder row;
- reveal it in the tree;
- enter inline rename mode as today.

### Drag Sources

- Real directories, Markdown files, and external files are draggable only when
  they are not decorated by pending proposal state.
- A real row is not draggable in this pass if it has `pendingTarget` or
  `hasPendingDescendant`. This prevents moving files/folders whose proposal
  relative paths would become stale.
- Pending virtual rows are not draggable.
- Rename inputs and context-menu buttons must not start drags.
- Markdown file rows keep the existing assistant-context drag payload. When a
  Markdown row is dragged, set both:
  - existing context attachment MIME payload for assistant drops;
  - new file-tree move MIME payload for tree drops.
- Directory and external file rows set only the file-tree move payload.
- Use `effectAllowed = "copyMove"` for Markdown rows so assistant drops can
  remain copy-like while tree drops request `move`. Use `move` for folders and
  external files.

Proposed move payload:

```ts
const fileTreeMoveDragMimeType = "application/x-iliad-file-tree-move";
const fileTreeMoveDragPayloadType = "iliad/file-tree-move";

interface FileTreeMoveDragPayload {
  type: typeof fileTreeMoveDragPayloadType;
  workspaceSessionId: string;
  relativePath: string;
}
```

Add `createFileTreeMoveDragPayload` and `readFileTreeMoveDragPayload` helpers
parallel to the context attachment drag helpers. `readFileTreeMoveDragPayload`
must:

- parse JSON defensively;
- require matching `workspaceSessionId`;
- normalize and validate visible relative paths;
- return only a relative path payload;
- never trust absolute paths or kind values from `DataTransfer`.

On drop, `FileTree` must look up the source in the current real tree by
normalized relative path before calculating validity or calling `onMoveNode`.

### Drop Targets

Valid drop targets:

- a real folder row, meaning "move the dragged item inside this folder";
- the root tree surface, meaning "move the dragged item to workspace root".

Invalid drop targets:

- the dragged item itself;
- any descendant of a dragged directory;
- pending virtual rows;
- file rows;
- folders that would produce the same source and destination parent;
- any drop from another workspace session;
- any drop whose payload does not pass path containment and visibility checks;
- any drop whose destination relative path collides with a pending-create
  proposal path. Pending create paths are reserved while the proposal is
  reviewable, even though the file is not on disk yet.

Do not implement between-row insertion zones. Since the tree is sorted, a
between-row affordance would imply manual ordering that does not exist.

### Drag Feedback

- While dragging over a valid folder, show a calm full-row target state:
  slightly stronger background, a thin accent border, and the folder icon in its
  open state.
- While dragging over the root surface, show the same subtle root target wash
  used by root selection, with a stronger inset border during drag-over.
- Invalid targets should not highlight. Set `dropEffect = "none"` when practical.
- The source row may be slightly muted while dragging, but must remain legible.
- Do not use large overlays, cards, instructional copy, or modal confirmation
  for normal moves.
- When hovering a collapsed folder with a valid drag for roughly 500 ms, expand
  it so users can continue navigating into nested folders.
- On successful move, refresh the tree, reveal the moved item, and select it.
- On failed move, show the existing app error surface with localized fallback
  copy. Do not leave stale drag styling behind.
- Announce drag state through a localized live-status channel:
  - drag start, for example `Moving "Week 2"`;
  - valid target, for example `Move to Drafts` or `Move to workspace root`;
  - successful move;
  - cancelled/no-op move;
  - failed move.

### Menu/Keyboard Move To Root

Add a tree context-menu command for `Move to workspace root`:

- show it for real files/folders that are valid move sources and are not already
  at root;
- hide or disable it for pending virtual rows, pending-decorated real rows, and
  root-level items;
- route through the same `moveNode` workflow as drag/drop;
- preserve existing duplicate/rename/copy/reveal/trash behavior.

This is not a full destination picker. It gives keyboard and context-menu users
the same critical escape hatch as root drag/drop: moving something out of a
nested folder and back to root.

## Filesystem Behavior

Add a dedicated move API instead of overloading rename:

```ts
movePath(workspaceRoot: string, sourcePath: string, targetDirectoryPath: string): Promise<FileTreeNode>
```

Main-process behavior:

- `file:move` must verify authority before touching the filesystem:
  - canonicalize `workspaceRoot`;
  - verify it matches the current workspace associated with `event.sender.id`,
    or refactor file IPC to receive a `getWindowWorkspace(webContentsId)` helper
    from the window manager;
  - do not trust a renderer-supplied workspace root alone.
- Validate `sourcePath` and `targetDirectoryPath` with visible-workspace rules.
- Use `lstat`/`realpath` defensively:
  - reject symlink source or destination directory entries for this pass, or
    prove their real paths stay inside the canonical workspace before moving;
  - prefer rejection if behavior is ambiguous.
- Ensure `sourcePath` exists.
- Ensure `targetDirectoryPath` exists and is a directory.
- Reject moving the workspace root itself.
- Reject moving a directory into itself or a descendant.
- Compute destination as `path.join(targetDirectoryPath, path.basename(sourcePath))`.
- If destination resolves to the source path, return the current node or no-op
  cleanly.
- If destination already exists, reject with the same collision tone as rename:
  `A file with that name already exists.`
- Use `fs.rename` for the move.
- Return shallow destination metadata like existing `renamePath` does. The
  renderer must refresh the tree and use the refreshed real node for active
  file, selection, reveal, and expansion state.

Renderer behavior:

- Do not allow move to race document saves:
  - cancel pending save timers;
  - wait for any in-flight save promise before moving, or block/reject moves
    while `saveStatus === "saving"`;
  - then flush the current document before moving.
- Close the tree context menu before a move starts.
- Refresh the tree after the move.
- If the active Markdown file is moved directly or inside a moved folder, update
  `activeFile` to the relocated hydrated node and keep the editor content open.
- If the selected path or rename path is inside the moved source, relocate it to
  the new path.
- Relocate document history entries under the moved source using the same
  `relocatePath(oldRoot, newRoot, candidatePath)` rule. Do not leave stale moved
  paths to be silently skipped.
- Existing assistant context chips:
  - if a moved Markdown file was manually attached, update its relative path and
    label to the new location;
  - if a folder containing attached Markdown files moves, relocate those
    attachment paths;
  - if an attachment no longer resolves after refresh, prune it and announce the
    removal.
- If the active review target refers to the moved file, normal navigation should
  close or reselect review state using the existing review-navigation rules. Do
  not add review-specific move behavior in this pass.
- If the moved item is a folder, `FileTree` preserves expansion intent after
  `onMoveNode` resolves:
  - remove expansion for the old folder path;
  - add expansion for the new folder path;
  - add expansion for the destination parent folder;
  - reveal the moved folder row.

## Data And State

Add renderer-only drag state in `FileTree`:

```ts
type FileTreeDropTarget =
  | { kind: "root" }
  | { kind: "folder"; path: string };

interface FileTreeDraggingState {
  sourcePath: string;
  sourceRelativePath: string;
  sourceKind: FileTreeNode["kind"];
  target: FileTreeDropTarget | null;
}
```

Add props:

```ts
onSelectWorkspaceRoot: () => void;
onMoveNode: (node: FileTreeNode, targetDirectoryPath: string) => Promise<FileTreeNode | null>;
```

`FileTree` should resolve row-level drop targets and call `onMoveNode` only for
real source nodes and real/root target directories. `fileActions` owns the
actual filesystem move workflow, while `FileTree` owns drag state, drop target
visuals, auto-expand timers, and durable expansion updates after `onMoveNode`
resolves.

Add pure helpers for testability:

```ts
resolveCreationDirectoryPath(input): string;
createFileTreeMoveDragPayload(workspaceSessionId: string, relativePath: string): FileTreeMoveDragPayload;
readFileTreeMoveDragPayload(rawPayload: string, expectedWorkspaceSessionId: string): FileTreeMoveDragPayload | null;
resolveFileTreeDropTarget(input): FileTreeDropTarget | null;
```

`resolveFileTreeDropTarget` should accept the current real tree, pending create
relative paths, source relative path, candidate folder/root target, and
workspace session id validation result. It should return `null` for self,
descendant, no-op, wrong-workspace, file-row, pending-row, pending-decorated
source, and reserved pending-create destination cases.

Keep drag state separate from search state. Search can still be open, but this
pass should not alter match/filter behavior.

## Implementation Plan

1. Extract pure helpers:
   - `resolveCreationDirectoryPath`;
   - file-tree move drag payload create/read helpers;
   - drop target/source validation helper.
2. Add `movePath` in `electron/fs/fileOps.ts`, register `file:move` in
   `electron/ipc/files.ts`, expose it in `electron/preload.ts`, and add it to
   `IliadApi`. Update `registerFileIpc` as needed so move requests can verify
   the sender's current canonical workspace.
3. Add save gating for moves. Either track the active save promise so move can
   await it, or reject/block moves while `saveStatus === "saving"`.
4. Add `moveNode` to `useFileActions`:
   - flush save;
   - call `window.iliad.movePath`;
   - refresh tree;
   - relocate active/selected/renaming paths;
   - relocate document history paths;
   - relocate or prune assistant context attachment paths;
   - reveal and select the moved node;
   - surface localized fallback errors.
5. Update create-target derivation so `selectedTreePath === workspace.path`
   means workspace root.
6. Add `onSelectWorkspaceRoot`, `onMoveNode`, and `Move to workspace root`
   context-menu wiring through `App`.
7. Add `onSelectWorkspaceRoot` and `onMoveNode` wiring into
   `FileTree`.
8. Update `FileTree`:
   - root target surface and `Escape` behavior select root;
   - root-selected class is applied when `selectedPath === workspace.path`;
   - real rows become draggable without removing assistant-context drag support;
   - pending virtual and pending-decorated real rows are not draggable;
   - valid drop target calculation rejects self/descendant/no-op drops;
   - valid folder hover auto-expands;
   - valid root/folder drops call `onMoveNode`;
   - expansion state updates after successful moves and drag state clears in
     `finally`.
9. Add sidebar CSS for:
   - root selected surface;
   - root target focus state;
   - root drag-over surface;
   - folder row drag-over;
   - source row dragging state.
10. Add localized strings for move failure, root target labels, destination-aware
    create button labels, live drag/drop announcements, and the context-menu
    `Move to workspace root` command.

## Edge Cases

- Selecting root when the active file is nested must create at root, not next to
  the active file.
- Selecting root with no active file still creates at root.
- Pressing `Escape` in the tree selects root only when search, context menu, and
  rename are inactive.
- Clicking a pending virtual row must not set root or a filesystem create target.
- Real rows with pending edit or pending descendant state cannot be dragged or
  moved through the root context-menu command in this pass.
- A destination that would collide with a pending-create proposal path is
  blocked even if no real file exists there yet.
- Dragging a Markdown file to the assistant panel/drop zone must still attach it as
  context and must not move it.
- Dragging a Markdown file to a folder in the file tree must move it and must
  not attach it as context.
- Tree drops must ignore context-only drops and assistant drops must ignore the
  move MIME payload.
- Dragging a folder onto one of its descendants is rejected before IPC and again
  in the main process.
- Dragging a file/folder onto its current parent is a no-op with no error.
- Moving while a save is in progress waits for the save or is blocked with a
  clear localized message; it must not recreate the moved file at the old path.
- Moving an active Markdown file keeps the editor open and updates future saves
  to the new path.
- Moving a folder containing the active Markdown file keeps the editor open and
  updates future saves to the relocated path.
- Moving a folder containing the selected path preserves selection at the new
  path.
- Moving a path that appears in back/forward history relocates those history
  entries.
- Moving an attached Markdown context file or containing folder relocates the
  existing context chip; unresolved chips are pruned and announced.
- Moving an item while search is open should not change search semantics; after
  refresh, the search result recalculates from the new tree as it already does.
- If the destination path collides, no files are overwritten.
- If the destination directory is a symlink, reject it unless the implementation
  proves the real target is inside the canonical workspace.
- If the renderer sends a stale or forged move payload, drop validation fails
  before IPC and IPC still validates source/target authority.
- If the filesystem move fails midway, refresh the tree once and surface the
  error.

## Tests

- Pure/path tests:
  - root selection create-target helper returns `workspace.path` before active
    file fallback;
  - selected file still creates beside that file;
  - selected folder creates inside that folder;
  - stale selected path falls back to active file parent;
  - no selected target still creates beside active file;
  - move payload reader rejects malformed JSON, wrong type, wrong workspace, and
    hidden/invalid relative paths;
  - drop validation rejects self, descendant directory target, no-op same
    parent, file-row target, pending virtual target, pending-decorated source,
    wrong workspace session, stale source, and reserved pending-create
    destination;
  - drop validation accepts file/folder to root and file/folder to another real
    folder.
- Main-process/file ops tests are required:
  - move file into folder;
  - move folder to root;
  - reject source missing;
  - reject target that is a file;
  - reject workspace root as source;
  - reject folder into descendant;
  - reject hidden source/target;
  - reject outside-workspace source/target;
  - reject or safely handle symlink source/target directories;
  - no-op same parent returns cleanly;
  - reject collision without overwriting.
- Renderer behavior tests should prefer pure helpers unless DOM drag/drop
  tooling is added:
  - background click calls `onSelectWorkspaceRoot`;
  - `Escape` selects root only when search/context menu/rename are inactive;
  - folder row drop calls `onMoveNode` with the folder path;
  - root target drop calls `onMoveNode` with `workspace.path`;
  - pending virtual row does not accept drops;
  - pending-decorated real rows do not start move drags;
  - Markdown drag still includes context attachment payload and move payload;
  - assistant panel/drop-zone handling still accepts the context payload when a
    move payload is also present;
  - `Move to workspace root` appears only for valid non-root sources.
- Persistence/history/context tests:
  - move waits for or blocks an in-flight deferred save before filesystem
    rename;
  - moving the active file updates future saves to the new path;
  - moving a folder containing the active file updates future saves to the new
    path;
  - document history paths under the moved source are relocated;
  - manual assistant context chips under the moved source are relocated or
    pruned according to the refreshed tree.
- Manual Electron smoke:
  - select folder, then click blank tree surface, then create document at root;
  - select folder, then click blank tree surface, then create folder at root;
  - select root with `Escape` from the file tree and confirm destination-aware
    create button labels;
  - background click with context menu open closes it and selects root;
  - rename input blur/commit followed by root selection behaves predictably;
  - root target remains reachable when the tree is full;
  - drag a nested Markdown file to root and confirm active file updates if open;
  - drag a folder containing the active Markdown file to root and save after the
    move;
  - drag a file into another folder;
  - drag a folder over a collapsed folder and confirm auto-expand;
  - move a non-root file/folder to root through the context menu;
  - drag a Markdown file into the assistant panel/drop zone and confirm it still
    attaches as context;
  - move a file already attached to assistant context and confirm the specified
    context chip behavior;
  - verify drag start/target/success/failure announcements with a screen reader
    or accessibility inspector where practical;
  - confirm failed move clears all drag styling;
  - confirm moving while save is in progress waits or blocks as specified;
  - confirm pending proposal decorated rows cannot be moved;
  - confirm pending-create destination collision is blocked;
  - attempt folder-into-descendant and collision drops and confirm no move.

## Rollout

Ship as one focused file-tree organization pass after the current file-tree
search work is stable. The implementation should be small enough for one branch:

1. implement filesystem move IPC and renderer action;
2. implement root selection;
3. implement drag/drop UI;
4. run typecheck, focused tests, full tests when feasible, CSS lint, and manual
   Electron smoke.

## Open Questions

- Should a later pass add a keyboard-accessible `Move to...` folder picker in
  the tree context menu?
- Should moving assets update Markdown image links? Defer; this pass should move
  files honestly and avoid rewriting document contents implicitly.
