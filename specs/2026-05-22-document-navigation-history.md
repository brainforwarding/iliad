# Document Navigation History

## Problem

Internal Markdown links currently replace the active document. That keeps the UI calm, but it also makes link-following feel lossy: after reading a referenced document, the user has to find the previous document again in the file tree.

Tabs could solve this, but they add persistent chrome and working-set state before the core writing surface needs it. A lighter first step is browser-style document history.

## Product Intent

Keep one active document and one file tree. Add Back and Forward controls for document navigation so users can follow links and browse files without losing their place in the recent document flow.

This is navigation history, not document version history and not multi-document tabs.

## Goals

- Add Back and Forward actions for Markdown document navigation.
- Record normal Markdown document opens from the file tree, creation/duplication flows, and internal Markdown links.
- Do not record external file opens, external web/mail links, folder expand/collapse, or failed opens.
- Preserve the save-before-navigation invariant: if flushing the current document fails, history must not change and navigation must not proceed.
- Keep one active document. Do not add tabs, a secondary navigation panel, global search, or a command palette.
- Keep history in renderer memory only for this pass.
- Reuse the existing `openNode` and `openDocumentLink` flow so all document opening still goes through the same file-safety and autosave path.

## Non-Goals

- Persistent history across app restarts.
- Tabs or split panes.
- Per-document scroll/cursor restoration.
- Heading-anchor jumps inside the same document.
- New Electron IPC.
- File version history or undo for file operations.

## UX Decisions

- Back and Forward live in the unified topbar near the sidebar toggle.
- Buttons are disabled when their direction has no valid Markdown target.
- Keyboard shortcuts are intentionally deferred because common candidates conflict with text-editor movement or indentation shortcuts while CodeMirror is focused.
- A normal file-tree click opens that Markdown file in the current document slot and records the previous document in Back history.
- A rendered local Markdown link opens its target in the current document slot and records the previous document in Back history.
- Same-document links, including fragment-only links, do not record document history in this pass.
- Back opens the previous valid Markdown document and moves the current document to Forward history.
- Forward opens the next valid Markdown document and moves the current document to Back history.
- Opening a new document normally clears Forward history, matching browser behavior.
- If a new or duplicated Markdown document becomes active after a successful save/open, record the previous active Markdown path in Back and clear Forward; if there was no previous active document, record nothing.
- If a history target no longer exists, is no longer Markdown, or has been moved outside the visible tree, the app skips that entry and looks for the next valid entry in that direction.
- If no valid entry remains, the relevant control stays disabled.

## Data And State

- History entries are absolute file paths inside the current workspace.
- Keep two stacks in `App` or a small app-level hook:
  - `backStack: string[]`
  - `forwardStack: string[]`
- The active document path is not duplicated into the current stack. It remains `activeFile.path`.
- Limit each stack to a small cap, such as 50 entries, to prevent unbounded state growth.
- Clear both stacks when the workspace changes or the active document is cleared because there is no cross-workspace navigation model yet.

## Edge Cases

- Clicking the already-active Markdown file does not record history.
- Clicking a non-Markdown file still opens externally and does not record history.
- Clicking a folder only expands/collapses it.
- If the active file is moved to Trash and the editor clears, history clears too.
- If a prior history target was renamed, the old path may become stale. This pass skips stale entries rather than trying to rewrite history through every file operation.
- If Back/Forward navigation fails because save flushing or reading the target fails, history should remain as it was before the attempt.
- Invalid skipped entries are pruned only as part of a successful Back/Forward navigation to a valid target. A failed attempt preserves both stacks.
- Internal links with fragments still open the target document but do not jump to the heading in this pass.

## Implementation Notes

- Change `useFileActions.openNode` to return a structured result, for example `{ kind: "markdown"; path: string }`, `{ kind: "external" }`, `{ kind: "none" }`, or `{ kind: "error" }`.
- Keep save flushing and file reading inside `openNode`.
- Add a navigation mode around open calls:
  - normal opens record history after `openNode` succeeds
  - Back/Forward opens call `openNode` without recording new normal history
- Keep link widgets unchanged; they should continue emitting only an `href`.
- Keep link routing in `useFileActions.openDocumentLink`.
- `App` owns history state because it already owns `activeFile`, topbar layout, and file-action wiring.
- Use `findNode(tree, path)` to resolve history entries before enabling buttons or attempting navigation.
- Add topbar icons from `lucide-react` (`ChevronLeft`, `ChevronRight`) and use existing `.icon-button` styling.

## Verification

- `npm run typecheck`
- `npm run build`
- Manual Electron checks:
  - Open document A from the file tree, then document B; Back returns to A and Forward returns to B.
  - Follow an internal Markdown link from A to B; Back returns to A.
  - Open C after going back to A; Forward is cleared.
  - External links and non-Markdown local files do not affect Back/Forward state.
  - A failed save blocks navigation and leaves history unchanged.
  - Disabled Back/Forward buttons cannot be clicked.
  - Repeated clicks on the active file do not create duplicate history entries.
  - Same-document fragment links do not create history entries.
  - Renamed or deleted history targets are skipped after a successful Back/Forward navigation to the next valid target.

## Panel Selection

- Spec reviewer: one focused frontend/product reviewer for UX edge cases and state-model risks.
- Implementation: one frontend implementation worker for the app/file-action/history changes.
- Verification: local typecheck and build from the orchestrator, plus manual smoke steps when the Electron app is run.
