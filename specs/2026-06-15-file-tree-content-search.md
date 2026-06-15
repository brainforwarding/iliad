# File Tree Document Content Search

Status: Revised after agent review
Date: 2026-06-15

## Context

Iliad currently has a file-tree find control that searches document and folder names. That control should remain explicit: it helps users find files by name, not by body text. Users also need a separate document-content search that answers "where does this text appear inside my Markdown workspace?" without leaving the file tree/sidebar context.

This spec expands the existing sidebar search UI into two clear search scopes:

- `Names`: existing file and folder name search/filter behavior.
- `Text`: new workspace Markdown content search with file-grouped match previews.

Implementation note: call the top-level switch `searchScope` or `FileTreeSearchScope`, not `searchMode`. Existing code already uses `FileTreeSearchMode` for `continuous` vs `fuzzy` name matching. Keep that existing name-match behavior as `nameSearchMode` or equivalent.

The implementation must be delegated to worker agents. The orchestrator should not make production code edits directly.

## Research Notes

Primary VS Code behaviors worth adopting:

- VS Code's full workspace search searches the opened folder, groups results into files, shows hit counts per file, expands a file to previews, and opens a hit in the editor with one click: https://code.visualstudio.com/docs/editing/codebasics#_search-across-files
- VS Code distinguishes Explorer tree filtering from full content search. Explorer filtering is tree-local, supports highlight/filter modes, and can show folder badges for descendants: https://code.visualstudio.com/docs/editing/userinterface#_advanced-tree-navigation
- VS Code added tree-shaped search results so search results can preserve folder/file hierarchy when desired: https://code.visualstudio.com/updates/v1_72#_results-displayed-as-a-tree-view
- VS Code supports regular expression search, plus advanced include/exclude fields, but those are not required for Iliad's first content-search pass: https://code.visualstudio.com/docs/editing/codebasics#_advanced-search-options
- VS Code glob semantics are useful future context, but this pass should avoid implementing include/exclude glob UI until the core experience is reliable: https://code.visualstudio.com/docs/editor/glob-patterns

## Goals

1. Make it obvious whether search is looking at file names or document text.
2. Search saved Markdown document contents across the visible workspace.
3. Display content matches in the sidebar as a compact, tree-shaped visual result list, similar to VS Code Search view results.
4. Let users click a file result or line preview and land in the editor at the matching text.
5. Preserve the existing name-search behavior, keyboard support, path peek, sidebar resize behavior, and pending-file indicators.
6. Keep implementation orderly: search execution lives in Electron/main-process filesystem code; renderer code owns display, state, navigation, and stale-result handling.

## Non-Goals

- No replace-across-files.
- No persistent search index.
- No semantic/vector search.
- No PDF/DOCX/image/OCR search.
- No include/exclude glob inputs in this pass.
- No searching generated/ignored directories, hidden files, external files, symlinked paths, or binary files.
- No searching pending agent-created documents that do not exist on disk yet.
- No reusing agent document-tool search/ranking code as the UI search backend.

## Product Behavior

### Opening Search

- The existing search icon still opens the same sidebar search surface.
- The search surface gets a compact segmented search-scope control:
  - `Names`
  - `Text`
- Default scope is `Names` when the control first opens, preserving existing behavior.
- Switching scopes keeps the raw query text but resets active match navigation.
- Closing search returns to the normal tree and restores focus as today.

### 220 px Control Layout

At the minimum sidebar width, the search control must not rely on arbitrary flex wrapping. Use a stable three-row layout:

1. Input row:
   - search icon
   - query input
   - clear-query button inside the input wrapper
2. Scope/status row:
   - `Names` / `Text` segmented control on the left
   - compact visible status on the right
3. Options/navigation row:
   - in `Names`: `Loose`, `Filter`, previous, next, `Done`
   - in `Text`: `Aa`, `ab`, `.*`, previous, next, `Done`

The visible status slot must use short copy:

- Names: existing `1/3`, `No results`, or empty.
- Text: `3 matches`, `3 in 2 files`, `Searching...`, `Invalid regex`, `No matches`, or equivalent short localized copy.

Longer announcements, full paths, and truncation details belong in a separate `sr-only` live region linked with `aria-describedby`.

### Names Scope

Names scope keeps the behavior introduced by `2026-06-15-file-tree-search-ux-polish.md`:

- Search names only.
- Keep `Loose` and `Filter` controls.
- Keep descendant badges for name matches.
- Keep current keyboard navigation and active-match styling.
- Do not search document text in this scope.

### Text Scope

Text scope searches Markdown body text.

Controls:

- Placeholder: `Search document text`
- Hide name-only controls: `Loose` and `Filter`.
- Show content controls:
  - Match case (`Aa`)
  - Match whole word (`ab`)
  - Use regular expression (`.*`)
- The controls must be icon-like or very short text, have tooltips, and use `aria-pressed`.
- If regex is enabled and the query is invalid:
  - the renderer must prevalidate and avoid IPC,
  - the visible status must say `Invalid regex` or localized equivalent,
  - the previous successful results may remain visible until the query clears or becomes valid,
  - the main-process API must still defensively return a typed invalid-regex result or throw a known invalid-regex error without scanning.

Result states:

- Empty query: show the normal file tree, no content results, status text empty.
- Searching: after a short delay, show `Searching...` in the visible status row and live region.
- No matches: show `No document matches`.
- Matches: use match/file copy, not generic "results"; for example `12 matches in 4 files`.
- Truncated matches: append truncation detail in the live region and use short visible copy such as `First 500 matches`.
- Oversized skipped files: announce in the live region when applicable; do not call it result truncation.
- Errors: show a short recoverable status, for example `Search failed`, and keep the UI usable.
- Failed active-document flush: preserve the existing save-error behavior, continue searching last saved disk text unless the request is stale, and show `Search uses last saved text`.

Result layout:

- Text scope with a non-empty valid query switches the tree scroll area into a tree-shaped visual result list. Do not promise full ARIA tree semantics unless they are fully implemented.
- Results are grouped by folder and file path, not as a flat list.
- Hide empty ancestor folders.
- Folder rows are context/disclosure rows only. They must not expose normal Explorer operations such as rename, create, drag/drop, or context-menu file actions.
- Folders show descendant match-count badges.
- File rows show:
  - Markdown file icon
  - Document display name
  - fixed-width match count badge
  - full relative path through the existing path peek behavior
- File rows expand to line-preview rows.
- Line-preview rows show:
  - fixed-width 1-based line number column
  - single-line snippet with ellipsis at 220 px
  - highlighted matching range(s)
- Matching files should be expanded by default for a new query, with previews visible.
- A file with many hits should show the first bounded number of preview rows, then a small non-focusable `N more` row. This pass does not need an expand-all-results command.
- Active content-match styling must be visually distinct from the active file row while still fitting existing sidebar tokens.

Navigation:

- Clicking a file row opens that Markdown file at its first content match.
- Clicking a line-preview row opens that Markdown file at that exact match.
- Opening a content match must reveal and select the match in CodeMirror when possible.
- If the file changed and the returned range is stale, open the file and fall back to line-level reveal without throwing.
- Match navigation targets preview rows only. Folder and file rows may be focusable/clickable for disclosure/opening, but previous/next match navigation should move across preview rows in stable order.
- `Enter` in the search input advances the active preview match and scrolls it into view; it does not open the file.
- `Shift+Enter` in the search input moves to the previous preview match.
- `Enter` or click on a focused preview row opens that exact match.
- Up/down from the input focuses preview rows when text matches exist, matching current name-search behavior.
- Up/down within preview rows navigates between preview rows in text scope.
- Escape from result rows returns focus to the search input; Escape from the input closes search.

Save behavior:

- Before starting a content search, drain Iliad's existing active-document persistence with `flushSave()` if the active Markdown document has pending changes. This should not save unrelated documents, create pending files, or feel like a separate explicit Save command.
- If `flushSave()` throws, keep the existing save-error behavior from `useDocumentPersistence`, do not crash the sidebar, and search last saved disk content unless the search request became stale.
- Stale request checks must happen after debounce, after `flushSave()`, and after IPC resolution.

Performance and Limits:

- Debounce content search requests by 200 ms.
- Ignore stale responses by request id.
- Search Markdown files only: `.md`, `.markdown`, `.mdown`, `.mkd`.
- Reuse existing workspace visibility rules and traversal conventions:
  - no hidden paths,
  - no `ignoredNames` segments,
  - no symlinked files or directories,
  - no external/non-Markdown files.
- The main process must clamp all renderer-provided limits. Do not trust optional `max*` values from the renderer.
- Default caps:
  - Max returned files: 100
  - Max returned matches: 500
  - Max matches per file rendered initially: 8
  - Max file size scanned: 1 MB
  - Max scanned Markdown files: 5000
  - Max filesystem entries visited: 20000
  - Max directory depth: 25
  - Max query length: 200
- Return counters and truncation metadata so the UI can explain what happened.
- Do not add a production dependency for ripgrep or an indexer in this pass.

## Architecture

### Main Process Search API

Add a dedicated filesystem search module, not ad hoc search code inside React:

- `electron/fs/contentSearch.ts`

Suggested exported types:

```ts
export interface MarkdownContentSearchRequest {
  workspaceRoot: string;
  query: string;
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
  maxReturnedFiles?: number;
  maxReturnedMatches?: number;
  maxMatchesPerFile?: number;
  maxFileBytes?: number;
  maxScannedMarkdownFiles?: number;
  maxVisitedEntries?: number;
  maxDirectoryDepth?: number;
  maxQueryLength?: number;
}

export type MarkdownContentSearchTruncationReason =
  | "files"
  | "matches"
  | "scanned_files"
  | "visited_entries"
  | "directory_depth"
  | "query_length";

export interface MarkdownContentSearchRange {
  /** UTF-16 column offsets within lineText. */
  startColumn: number;
  endColumn: number;
}

export interface MarkdownContentSearchMatch {
  id: string;
  lineNumber: number;
  lineText: string;
  matchedText: string;
  /** UTF-16 CodeMirror-compatible offsets against the raw loaded document. */
  startOffset: number;
  endOffset: number;
  startColumn: number;
  endColumn: number;
  ranges: MarkdownContentSearchRange[];
}

export interface MarkdownContentSearchFileResult {
  filePath: string;
  relativePath: string;
  name: string;
  returnedMatchCount: number;
  matches: MarkdownContentSearchMatch[];
}

export interface MarkdownContentSearchResponse {
  status: "ok" | "invalid_regex";
  query: string;
  files: MarkdownContentSearchFileResult[];
  returnedFiles: number;
  returnedMatches: number;
  scannedMarkdownFiles: number;
  visitedEntries: number;
  skippedOversizedFiles: number;
  skippedUnreadableFiles: number;
  truncated: boolean;
  truncatedReasons: MarkdownContentSearchTruncationReason[];
  invalidRegexMessage?: string;
}
```

Implementation requirements:

- Validate `workspaceRoot` and every traversed path with existing workspace safety helpers.
- Traverse with `readdir(..., { withFileTypes: true })`, deterministic sorting, and the same directory/file rank as `readDirectory` where practical.
- Use `lstat` or `Dirent.isSymbolicLink()` to skip symlinked files and directories. Do not follow symlinks.
- Skip hidden entries and `ignoredNames` during traversal, not only at final file validation.
- Scan only Markdown files according to `markdownExtensions`.
- Keep offsets against the raw file text read from disk, using JavaScript/CodeMirror UTF-16 offsets. Line and column math must work with CRLF, CR, LF, and non-ASCII text. Add tests for CRLF and non-ASCII.
- Compile regex safely:
  - Escape plain text queries when regex mode is off.
  - Apply `i` unless match-case is on.
  - Apply `g` always.
  - Whole-word mode uses JavaScript word boundaries around the final search pattern; document this limitation in code comments if needed.
  - Guard zero-length regex matches to avoid infinite loops.
- Invalid regex must produce `{ status: "invalid_regex", ... }` with no scanning, or a known typed error that the IPC layer maps to that response. Renderer prevalidation is not sufficient on its own.
- Generate stable match ids from `relativePath`, line number, start offset, and match index.
- `returnedFiles` and `returnedMatches` are counts actually returned under caps. The API should not claim exact global totals after scan caps stop traversal.
- `skippedOversizedFiles` is separate from `truncatedReasons`.

### IPC and Preload

Add a typed IPC boundary:

- Add `electron/ipc/search.ts` and register it from `electron/main.ts`.
- Channel: `file:search-markdown-content`
- Preload API:

```ts
searchMarkdownContent: (request: MarkdownContentSearchRequest) => Promise<MarkdownContentSearchResponse>
```

Update:

- `electron/preload.ts`
- `src/types/iliad.ts`
- any IPC registration tests if a local pattern exists

The renderer should pass request ids locally and ignore stale promises; the IPC request itself does not need cancellation in this pass.

### Renderer State

Keep content-search state out of the pure name-search helper.

Expected renderer additions:

- `src/assistant/fileTreeContentSearch.ts` or `src/assistant/contentSearchDisplay.ts` for pure helpers and types:
  - query validation,
  - result-tree building,
  - descendant counts,
  - active preview-row flattening,
  - active index clamp/move,
  - snippet highlight helpers,
  - optional stale-response helper if useful.
- Do not expand `src/assistant/fileTreeSearch.ts` into content search.
- Do not make content results pretend to be `FileTreeDisplayNode`; content search needs its own result-row model.
- `src/components/FileTree.tsx` owns the search UI state.
- Add `src/components/FileTreeContentResults.tsx` if rendering content results would materially bloat `FileTree.tsx`.
- `src/App.tsx` owns the content search provider because it can call `flushSave()` before `window.iliad.searchMarkdownContent(...)`.

Recommended prop shape:

```ts
interface FileTreeContentSearchProvider {
  search: (
    requestId: number,
    request: Omit<MarkdownContentSearchRequest, "workspaceRoot">
  ) => Promise<{ response: MarkdownContentSearchResponse; usedSavedTextFallback: boolean }>;
  onOpenMatch: (match: {
    filePath: string;
    relativePath: string;
    startOffset: number;
    endOffset: number;
    startColumn: number;
    endColumn: number;
    lineNumber: number;
    matchedText: string;
  }) => Promise<void> | void;
}
```

### Editor Reveal

Add a small reveal target in `App` and `EditorPane`:

- `App` resolves the current `FileTreeNode` by path or relative path, refreshing the tree if missing.
- `App` opens the node, waits for `openNode` to finish, records `{ filePath, startOffset, endOffset, lineNumber, matchedText, requestId }`, and passes it to `EditorPane`.
- If the active file is already the target file, set the reveal target without unnecessary reload.
- `EditorPane` watches `file?.path` and the reveal target.
- When the target file is active:
  - Clamp offsets to the current document length.
  - If `state.sliceDoc(startOffset, endOffset) === matchedText`, select `[startOffset, endOffset]`.
  - Otherwise reveal the target line and place the cursor at the line start.
  - Scroll into view using CodeMirror effects, then focus the editor.
- Clear or acknowledge the reveal target after one attempt to prevent repeat jumps.

Do not overload selection-comments scroll helpers unless the existing helper already cleanly supports raw CodeMirror offsets. Prefer a small editor-specific helper if needed.

## Accessibility and Localization

- All new visible strings must be added in English and Spanish.
- The scope control must expose `aria-label` or a visible label that names the group, for example `Search scope`.
- Each toggle must use `aria-pressed` and a tooltip/label:
  - Match case
  - Match whole word
  - Use regular expression
- Result count/status must remain visible text and also be represented in a polite live region.
- Preview rows must be keyboard-focusable buttons with labels that include relative path, line number, and match position.
- Folder/file rows in text scope need accessible disclosure/opening labels, but previous/next match navigation should target preview rows only.
- Highlight marks must not be the only signal for active selection; active match styling also needs row background/border treatment.
- Text in controls must fit at the minimum sidebar width of 220 px.

Suggested strings:

English:

- `searchScope`: `Search scope`
- `searchNames`: `Names`
- `searchText`: `Text`
- `fileTreeContentSearchPlaceholder`: `Search document text`
- `matchCase`: `Match case`
- `matchWholeWord`: `Match whole word`
- `useRegularExpression`: `Use regular expression`
- `contentSearchSearching`: `Searching...`
- `contentSearchNoMatches`: `No document matches`
- `contentSearchCount`: `(matches, files) => "1 match in 1 file" / "3 matches in 2 files"`
- `contentSearchInvalidRegex`: `Invalid regex`
- `contentSearchFailed`: `Search failed`
- `contentSearchUsesSavedText`: `Search uses last saved text`
- `contentSearchTruncated`: `(shown) => "Showing first 500 matches"`
- `contentSearchMoreInFile`: `(count) => "3 more"`
- `contentSearchMatchAria`: `(path, line, current, total) => "${path}, line ${line}, match ${current} of ${total}"`

Spanish:

- `searchScope`: `Alcance de búsqueda`
- `searchNames`: `Nombres`
- `searchText`: `Texto`
- `fileTreeContentSearchPlaceholder`: `Buscar texto en documentos`
- `matchCase`: `Distinguir mayúsculas`
- `matchWholeWord`: `Palabra completa`
- `useRegularExpression`: `Usar expresión regular`
- `contentSearchSearching`: `Buscando...`
- `contentSearchNoMatches`: `Sin coincidencias en documentos`
- `contentSearchCount`: `(matches, files) => "1 coincidencia en 1 archivo" / "3 coincidencias en 2 archivos"`
- `contentSearchInvalidRegex`: `Regex no válida`
- `contentSearchFailed`: `No se pudo buscar`
- `contentSearchUsesSavedText`: `La búsqueda usa el último texto guardado`
- `contentSearchTruncated`: `(shown) => "Mostrando las primeras 500 coincidencias"`
- `contentSearchMoreInFile`: `(count) => "3 más"`
- `contentSearchMatchAria`: `(path, line, current, total) => "${path}, línea ${line}, coincidencia ${current} de ${total}"`

Use existing Spanish accent conventions in `strings.ts`.

## Styling

- Extend `src/styles/sidebar.css`; avoid new global palettes.
- Keep the sidebar sober and dense. No cards inside cards, no hero/marketing styling.
- Reuse existing tokens: `--paper`, `--editor`, `--hairline`, `--accent-tint`, `--selection-wash`, muted text tokens.
- Result preview rows should use stable dimensions:
  - line number column fixed width,
  - snippet column min-width 0 with ellipsis,
  - file row count badge fixed width,
  - no layout shift when match count badges appear.
- Cap indentation impact in content results so nested folders do not make snippets unusable at 220 px.
- `mark` elements for content snippets should use the same visual family as name-search marks, with enough contrast.

## Tests

Add or update focused tests first, then run full verification.

Required unit tests:

- `tests/electron/contentSearch.test.ts`
  - finds text in Markdown files,
  - ignores external files,
  - ignores hidden paths,
  - ignores `ignoredNames` segments,
  - skips symlinked Markdown files/directories,
  - respects match case,
  - respects whole word,
  - supports valid regex,
  - reports invalid regex without scanning,
  - guards zero-length regex matches,
  - returns raw-document UTF-16 offsets, line numbers, columns, matched text, ranges, and snippets,
  - covers CRLF and non-ASCII offset correctness,
  - caps returned matches/files and sets truncation metadata,
  - caps visited entries/scanned Markdown files/directory depth,
  - skips files above max size and increments `skippedOversizedFiles`.
- `tests/assistant/fileTreeContentSearch.test.ts` or equivalent
  - builds folder/file/match result tree,
  - hides empty ancestors,
  - computes descendant counts,
  - flattens navigable preview rows in stable order,
  - clamps and moves active preview index,
  - limits rendered previews per file and creates non-focusable `more` rows,
  - validates regex before IPC,
  - ignores stale request ids if stale logic is factored into a helper.
- Add an app/provider test if practical for failed flush behavior:
  - failed save status is preserved,
  - content search still runs against saved disk text,
  - stale requests do not launch after slow flush.
- Add an editor reveal helper test if reveal logic is factored out of `EditorPane`:
  - exact range selects matched text,
  - stale range falls back to line reveal.
- Extend `tests/app/sidebarPreferences.test.ts` only if sidebar width behavior changes. It should not need to.
- Add `FileTree` component tests only if a practical local pattern exists; otherwise cover pure helpers and rely on typecheck/build for component integration.

Required final commands:

```bash
npm run typecheck
npm run lint:css
npm test
npm run build
```

Browser/in-app visual smoke is desirable after UI work if the browser automation tool is available. If unavailable, the worker must state that and rely on build/tests. A 220 px manual or automated visual check is required before final handoff if any local browser path is available.

## Acceptance Criteria

- The committed UI clearly shows whether search is in `Names` or `Text` scope.
- `Names` scope behaves as it did after the sidebar-search polish commit.
- `Text` scope searches inside Markdown documents and never silently searches content while labeled as name search.
- Text matches are grouped by file/folder, include line previews, match highlighting, match counts, and keyboard navigation.
- Content count copy uses "matches" and "files" in English and Spanish.
- Clicking a content hit opens the document and reveals/selects the hit in the editor, with a sane stale-range fallback.
- Hidden, ignored, symlinked, non-Markdown, oversized, and external paths are not searched.
- Large workspaces are bounded and explain truncation/skips.
- English and Spanish strings are complete and fit the 220 px layout.
- All required tests and final commands pass.

## Implementation Delegation Plan

Preferred implementation path:

1. One worker implements the whole spec to avoid cross-worker conflicts in `FileTree.tsx`, `App.tsx`, strings, and shared types.
2. A separate reviewer/verification agent may inspect the worker patch after it is uploaded, focusing on regressions and missed tests.
3. The orchestrator reviews the diff, runs the final commands, sends fixes back to the worker if needed, and commits only after tests pass.

