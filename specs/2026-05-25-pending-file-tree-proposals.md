# Pending File Tree Proposals

## Problem

Iliad can already store one agent proposal with multiple file changes, including edits to existing Markdown files and proposed new Markdown files. The review UI, however, is still entered mostly through the assistant panel. Proposed new files do not appear in the file tree until they are accepted, and multi-file proposals are hard to understand because the user cannot see the changed file set where files normally live.

The desired behavior is closer to Cursor/GitHub-style review: the chat stays clean, while pending document changes appear in the workspace surface. Existing files with pending edits should be visibly marked. New files proposed by the agent should appear as pending/virtual files before they exist on disk.

## Goals

- Show pending agent file changes in the file tree.
- Mark existing Markdown files that have pending edits.
- Show proposed new Markdown files as virtual "pending create" tree nodes at their intended relative path.
- Support one proposal containing several edited and created files.
- Clicking a pending existing file opens its document-native review.
- Clicking a pending new file opens the all-green virtual review document.
- Accepting a pending new file creates it on disk, refreshes the tree, opens the real file, and removes the virtual node.
- Rejecting a pending new file removes the virtual node without writing anything.
- Keep the assistant panel minimal. It can still show a compact pending-changes card, but it should not be the only way to discover affected files.
- Keep the implementation proportional: derive the file-tree state from existing persisted proposal records instead of introducing a second proposal store.

## Non-Goals

- No real multi-tab document system in this change.
- No real file write for proposed new documents before user acceptance.
- No delete, rename, move, or binary asset proposal types.
- No changes to the agent prompt/provider contract.
- No new agent context behavior for virtual pending documents. The proposal review surface is visible UI, but the active context chip still follows the last real Markdown file until a new file is accepted.
- No conflict-resolution UI beyond the existing stale/failed proposal states.
- No expanded assistant-side file list unless the file-tree UX proves insufficient.

## User Flow

### Existing File Edit

1. The agent proposes a change to `s2.md`.
2. The file tree shows `s2` with a subtle pending-edit indicator.
3. The assistant may show a compact `Cambios pendientes` card, but not the diff.
4. The user clicks `s2` in the file tree.
5. Iliad opens `s2.md` in review mode with inline red/green changes.
6. The user accepts or rejects individual hunks or the whole file.
7. When the file has no mutable review left, the pending indicator disappears.

### New File Proposal

1. The agent proposes `session-4/rubrica.md`.
2. If `session-4` exists, the file tree shows a pending virtual child `rubrica`.
3. If `session-4` does not exist, the file tree shows virtual pending folders needed to reveal `rubrica`.
4. The virtual file is visually distinct from a real file but still feels like part of the tree.
5. The user clicks the virtual file.
6. The editor opens the all-green pending document review.
7. Accepting creates the real Markdown file and refreshes the tree.
8. Rejecting discards the proposal file and removes the virtual tree node.

### Multi-File Proposal

1. The agent proposes changes to `s2.md`, `s3.md`, and `annexes/new-annex.md`.
2. The file tree marks `s2` and `s3` as pending edits.
3. The file tree also shows a virtual pending `new-annex`.
4. The user reviews files in any order by clicking them in the tree.
5. The proposal card remains as a compact summary and global discard entry point.
6. File-level accept/reject actions update only that file; proposal visibility is recalculated from remaining mutable files.

## UX Details

- Existing file pending edit: keep the normal file icon/name, add a small amber dot at the right edge of the row.
- Proposed new file: use a green `FilePlus`-style icon or dot and slightly muted italic-free text. Avoid making it look disabled; it is clickable.
- Proposed new folders: use normal folder affordances with a subtle green dot. They can be expanded/collapsed but should not show the context menu.
- Existing folders that contain pending descendants should also show the subtle pending dot. Otherwise pending changes inside collapsed folders are too easy to miss.
- When a proposal arrives or the assistant pending card is used to review a file, expand ancestor folders for that file and scroll/reveal the pending row when practical.
- Active review state:
  - For an edit review, the real file row is active.
  - For a create review, the virtual pending file row is active.
- Virtual create review must not become `activeFile`; it is only the editor review target and file-tree active row. The real active Markdown file remains the last accepted/opened file until the new document is accepted.
- Hover/click areas should remain the same size as normal tree rows.
- Tooltips and ARIA labels should explain:
  - "Pending edit: path"
  - "Proposed new document: path"
- The existing assistant pending card should keep the same minimalist button style. It should continue to open the next remaining mutable file when clicked.
- The assistant pending card may show compact counts such as `3 files · 1 new`; it should not become a second file browser.

## Data Model

Reuse `AgentChangeProposal` and `AgentProposalFileChange`.

Add a renderer-facing derived type:

```ts
interface PendingFileTreeChange {
  proposalId: string;
  fileId: string;
  kind: "edit_file" | "create_file";
  relativePath: string;
  normalizedRelativePath: string;
  status: AgentProposalFileStatus;
}
```

This is not persisted. It is recomputed from visible proposal files where `fileHasMutableReview(file)` is true.

Virtual tree nodes are also renderer-only. They should use synthetic paths:

- file: `iliad-review://<relativePath>`
- missing parent directory: `iliad-review-dir://<relativeDirectoryPath>`

The real proposal file id remains the source of truth for accepting or rejecting.

`FileTree` should not pass virtual nodes through normal filesystem callbacks. Internally it should use a discriminated display node:

```ts
type FileTreeDisplayNode =
  | { source: "real"; node: FileTreeNode; pendingTarget?: PendingFileTreeChange; hasPendingDescendant?: boolean }
  | { source: "pending-create"; pendingTarget: PendingFileTreeChange; name: string; path: string; relativePath: string }
  | { source: "pending-dir"; name: string; path: string; relativePath: string; children: FileTreeDisplayNode[] };
```

Only `source: "real"` nodes may call `onOpenNode`, context-menu actions, rename, duplicate, trash, or create-location logic. Pending file rows call only `onOpenPendingChange`.

All proposal and tree paths should be matched with a POSIX-style normalized relative path key. This avoids Windows-style separator or duplicate-slash mismatches.

If multiple pending proposals target the same normalized path, the file tree should show one row/decorator for the newest proposal file by proposal `updatedAt` order. Older same-path proposals remain reachable through the compact assistant card. This avoids stacked badges and keeps the tree readable. If a pending create path collides with an existing real file path, suppress the ghost node and leave review access through the assistant card.

## Implementation Plan

1. Add a pure helper module for pending tree data:
   - build `PendingFileTreeChange[]` from proposals;
   - merge pending create files into a display tree;
   - decorate existing tree nodes that have pending edits;
   - create virtual parent folders for proposed files in folders not present on disk.
   - mark parent folders containing pending descendants.
2. Update `FileTree` to accept:
   - `pendingChanges`;
   - `onOpenPendingChange(target)`;
   - pending labels.
3. Update `TreeRow`:
   - render pending edit/create classes and badges;
   - disable context menus and rename for virtual nodes;
   - route pending file clicks through `onOpenPendingChange`;
   - use the same expansion behavior for virtual directories.
4. Update `useAgentProposals` to expose `pendingTreeChanges`.
5. Update `App`:
   - pass `pendingTreeChanges` to `FileTree`;
   - set tree `activePath` to `editorFile?.path` so virtual pending files can show active state;
   - never assign a virtual pending file to `activeFile`;
   - route pending-tree clicks to `selectAgentReviewTarget`;
   - keep normal navigation behavior unchanged for non-pending nodes.
6. Add minimal CSS in the existing sidebar stylesheet.
7. Add tests for the pure pending-tree helper and any small rendering behavior that is practical with the current test setup.

## Edge Cases

- If a pending create file path already exists on disk, do not create a duplicate virtual node. Keep the proposal visible in the assistant card and allow the existing apply failure path to mark it failed.
- If a pending edit targets a file that no longer exists in the tree, do not create a virtual edit node. The existing review action should surface the current `fileChanged` error.
- If a proposal file becomes applied/rejected, it should disappear from pending tree decorations after proposal state refresh.
- If a virtual pending folder has no remaining pending descendants, it should disappear.
- If the user opens a normal file while reviewing a virtual create file, the virtual review should close, preserving current behavior.
- If the user rejects the virtual file currently being reviewed, open the next remaining pending file when available; otherwise return to the last real file/normal editor state.
- If a pending file cannot be shown in the tree because of collision or missing real edit target, assistant-card review remains the fallback entry point and existing proposal error copy should explain the problem.

## Tests

- Pure helper tests:
  - derives pending tree changes from mixed proposal files;
  - filters applied/rejected files;
  - decorates existing edit files;
  - inserts a virtual create file under an existing folder;
  - inserts missing virtual parent folders for nested proposed files;
  - does not duplicate a create file when the real path already exists.
- File tree render tests:
  - pending edit click calls `onOpenPendingChange`, not `onOpenNode`;
  - virtual create/folder rows do not expose the normal context menu;
  - pending parent folders show a minimal pending indicator.
- Typecheck.
- Full unit test suite.
- Build.

## Rollout

This repo currently has one production branch, `master`, and no separate deploy provider config. Ship through:

1. feature branch/worktree: `codex/pending-file-tree-proposals`;
2. local tests and build;
3. merge into `master`;
4. push `master` to `origin`.

## Open Questions

- Should the assistant pending card eventually list every file in the proposal? Defer. The file tree should become the primary navigation surface first.
- Should pending create files participate in future agent context before acceptance? Defer. It is safer to keep generated drafts as review UI until they become real files.
