# Iliad Architecture Notes

This document records product and implementation decisions that future contributors should read before changing the app. Specs in `specs/` capture individual change plans; this file captures stable decisions that should survive across changes.

Before evaluating any new feature, read [`source-as-contract.md`](./source-as-contract.md). It is the lens through which feature decisions should pass: the on-disk Markdown file is the contract, and features that break that contract are risky regardless of how well they fit any other section below.

Before changing what Iliad is for, read
[`product-vision.md`](./product-vision.md) and ADR-0021 in
[`decisions.md`](./decisions.md). Iliad has no internal agent: built-in AI is
small and works on one document; larger work is done by outside agents whose
changes Iliad reviews.

## Product Shape

Iliad is a local-first Markdown writing app with two jobs:

1. A calm, minimal writing surface backed by real local files, with small
   review-first writing AI (inline completion, the ✦ AI selection menu, and the
   local corrector).
2. The review surface for outside agents (Claude Code, Codex, any tool) that
   write Markdown in the folder: every outside change is shown in the document
   and the writer keeps or restores it chunk by chunk.

Outside agents reach Iliad only through the `iliad` CLI (status, open, skill)
and the per-document comments file (`name.comments.md`).

Avoid broad navigation, command palettes, tabs, chat panels, direct AI writes,
or dashboards until each addition is backed by a real writing workflow.

## Module Map

The code routes behavior to owner modules instead of concentrating it in the
app shell.

```text
bin/
  iliad            packaged wrapper (runs iliad.mjs with ELECTRON_RUN_AS_NODE=1)
  iliad.mjs        CLI entry (checkouts and npm link)
  lib/             cli routing, launcher, socket protocol, paths, skill install,
                   command install (install.mjs, also used by the app menu)
resources/
  skill/iliad/SKILL.md   bundled skill for outside agents
electron/
  main.ts
  preload.ts
  cli/             local socket server, CLI commands, open-request queue,
                   "Install 'iliad' Command…" (loads bin/lib/install.mjs)
  comments/        legacy comments migration into companion files
  diagnostics/     logger
  fs/              pathSafety, fileOps, companionFiles, contentSearch,
                   workspaceRegistry, workspaceMutationMarkers
  ipc/             assets, autocomplete, diagnostics, files, review, search,
                   shell, tighten, trust, updates, workspace,
                   writingCorrectorMemory, writingSettings
  launch/          argv parsing and launch workspace
  review/          workspace baseline, outside-change projection, diffs,
                   git advisory, review record types
  shared/          code shared with the renderer (companion paths, comments file)
  updates/         auto-update service
  window/          window creation and window manager
  writing/         writingAiService, autocomplete + tighten cleaners, errors;
                   groq/ (prompts/ shared with the Worker, SSE reader, own-key
                   and proxy clients, key store, install token, endpoint,
                   migration)
  writingCorrector/ corrector memory store

src/
  App.tsx
  main.tsx
  app/             useWorkspace, useDocumentPersistence (+ autosaveFence),
                   useDocumentHistory, useDocumentNaming, pathRelocation,
                   useOutsideReview, useSelectionComments, useCliBridge
  comments/        comments file format, session and three-way merge
  components/      EditorPane, FileTree, menus (Typography, Language,
                   Workspace, WritingAssists), DetachedCommentsBar, …
  editor/          CodeMirrorHost, documentSync, aiReview/ (inline review),
                   ideaAutocomplete/, selectionComments/, writingCorrector/,
                   visualMarkdown/, imageDropPaste, paths
  files/           fileActions, fileTree, pathUtils, companionFiles,
                   documentNaming, search
  i18n/            appLanguage, strings
  markdown/        math delimiters
  preferences/     editor, sidebar, autocomplete, writing assist preferences
  review/          review queue, reviewable files, pending tree markers
  styles/          tokens.css plus responsibility-specific CSS
  types/iliad.ts   IliadApi (the full IPC contract)
```

`src/App.tsx` is the composition layer: it connects hooks, file actions, and components, but should not regain persistence, path helper, preference parsing, context menu, or typography popover implementation details.

## Workspace Model

- A workspace is a local folder selected by the user.
- Hidden files and hidden folders are not shown in the file tree.
- `node_modules`, `dist`, and `dist-electron` are also ignored.
- Markdown files open inside Iliad.
- Non-Markdown files are listed but opened by the operating system.
- The root workspace folder name is read-only in the primary UI.
- Switching workspaces should not live in the primary sidebar header for now.
- `iliad <folder>` is a desktop launch path, not renderer filesystem access. Main parses and canonicalizes the folder, opens or focuses one window per canonical workspace, and exposes the launch workspace through preload.
- Renderer workspace bootstrap must ask `getLaunchWorkspace()` before falling back to the persisted workspace, and stale directory refreshes must not overwrite the file tree or main-process window association.

Relevant files:

- `bin/iliad.mjs`
- `electron/launch/argv.ts`
- `electron/launch/workspace.ts`
- `electron/window/windowManager.ts`
- `electron/fs/workspaceRegistry.ts`
- `electron/ipc/workspace.ts`
- `electron/preload.ts`
- `src/app/useWorkspace.ts`
- `src/types/iliad.ts`
- `src/components/FileTree.tsx`

## File And Folder Creation

The app manages Markdown documents and folders in the sidebar.

- The sidebar header has one create action (new document) next to search. New folder lives in the workspace menu ("New folder", after "Open folder…", following the creation target rules) and in the tree context menu on folders, which passes that folder as an explicit target instead of relying on the selection update.
- New document creates `untitled.md`, `untitled-2.md`, etc. using backend uniqueness logic.
- New folder creates `untitled folder`, `untitled folder-2`, etc. using backend uniqueness logic.
- Creation target is derived from tree selection: selected folder, parent of selected file, parent of active file, then workspace root.
- Selected folder/file state is a creation target cue and should be weaker than the active document highlight.
- After creation, the new file opens and enters inline rename mode.
- Users edit the visible document stem only. The UI does not show or require `.md`.
- The app appends/preserves `.md` internally.
- Rename is available from the file tree right-click context menu (not a hover button), by double-clicking a document's name text in the tree (not the whole row; never for companions or review rows), and by double-clicking the breadcrumb's document name while the sidebar is hidden (a small inline field; Enter saves, Esc cancels). All three commit through `renameNode`.
- Duplicate and Move to Trash are also context-menu actions.
- Markdown and external files can be duplicated, renamed, and moved to Trash.
- Folders can be renamed and moved to Trash; folder duplication is intentionally out of scope.
- Rename must stay inside the current directory.
- Rename rejects hidden names, path separators, `..`, and explicit non-Markdown extensions.
- Creating or renaming a document to a companion-shaped name
  (`*.comments.md`) is rejected: that name belongs to the comments file.
  (`*.notes.md` was reserved until 2026-09-25; it is an ordinary name now.)
- Move to Trash uses the operating system Trash and requires confirmation.
- A document's companion files follow it inside the same `runIliadMutation`
  (see "Companion Files"): rename and move check the document target and
  the companion name at the destination first (an unrelated
  `name.comments.md` there is never attached), then move the
  document and each companion with a hard link and remove the source (never
  overwriting), and put back whatever moved if a step fails; duplicate picks a `name copy[-N]` stem free for the whole group and
  copies the companions; Move to Trash trashes the document, then its
  companions, and reports any that stayed (no rollback). A companion whose
  document exists cannot be renamed, moved, or duplicated on its own.
- The Electron main process enforces file safety rules, not only the renderer.

Relevant files:

- `src/files/fileActions.ts`
- `src/files/fileTree.ts`
- `src/files/pathUtils.ts`
- `src/components/FileTree.tsx`
- `src/components/TreeContextMenu.tsx`
- `electron/fs/fileOps.ts`
- `electron/fs/pathSafety.ts`
- `electron/ipc/files.ts`

## Naming Untitled Documents

Spec: `specs/2026-09-27-name-untitled-documents.md`; ADR-0024. A document
Iliad created and the writer has not named gets a name once, at the first
pause, with no confirm step: the name types itself in the tree row (and the
breadcrumb) with a small ✦ that fades. Renaming it yourself is the undo.

- **Candidates** (`src/preferences/namingCandidates.ts`): localStorage
  `iliad:naming-candidates`, a map workspace root → workspace-relative paths.
  `createMarkdownFile` records the exact path creation returned (⌘N, the
  header button and the empty-state link all go through it). Never matched by
  name: a file called `untitled.md` that Iliad did not create is not a
  candidate. Dropped when its path vanishes from the tree (once seen there),
  gets an outside review, enters conflict (changed outside Iliad), or when
  the guarded rename answers `changed` / `under_review`.
- **One relocation path**: `renameNode`, `moveNode` and the auto-rename all
  report `onPathRelocated({ …paths, reason })`; `src/app/pathRelocation.ts`
  relocates recents, Back/Forward history and candidates from it. A manual
  rename drops the candidate (typing a real name in the create-time name
  field counts), a move relocates it, an auto-rename consumes it; documents
  inside a renamed or moved folder follow.
- **Controller** (`src/app/useDocumentNaming.ts`): for the active candidate,
  ~2 s after the last change, only when saved (no dirty text, timer or save in
  flight), not under outside review, no rename field open (tree or
  breadcrumb), the window focused, and with enough text (a finished
  first-line heading, or ≥ ~200 characters of prose). A first-line ATX heading
  names it directly (no AI); otherwise one `suggestDocumentName` call with the
  opening ~1,500 characters and the app language. The title is formatted in
  the folder's style (`src/files/documentNaming.ts`: kebab unless strictly
  more sibling documents have spaced names; ≤ 60 characters at a boundary).
  Any typing, candidate change, review, rename field, workspace switch or
  unmount invalidates the attempt (a late AI answer is dropped and
  cancelled). At most two dispatched attempts per candidate per session, in
  memory. Failures are silent.
- **Guarded rename**: inside the autosave fence the controller re-checks the
  text, hashes it (`hashDocumentText`, the same identity saves assert) and
  calls `autoRenameDocument` (main verifies the hash, refuses a path under
  review, resolves collisions over the document group and moves the comments
  file). On success `fileActions.autoRenameDocument` refreshes the tree,
  relocates (reason `auto-rename`) and updates the active file; the renderer
  talks to main only through `src/app/documentNamingApi.ts`, which tolerates a
  preload without the naming methods.
- **UI**: `src/components/TypedName.tsx` (≈0.5 s typing, thin caret, ✦ fading
  after ≈1 s; the accessible text is the final name at once; reduced motion
  shows the name without typing or ✦), used by `FileTree` rows and
  `BreadcrumbName`.

## Companion Files (Comments)

Each document `dir/name.md` (any Markdown extension) can have one companion
file next to it: `dir/name.comments.md` (comments anchored to quoted
passages). It is plain Markdown that the writer and outside agents read and
edit directly. Comments are how the writer talks to the AI and to outside
agents.

Writing notes (`name.notes.md`) were a second companion until 2026-09-25 and
were removed (ADR-0022, `specs/2026-09-25-writing-assists-one-row.md`):
existing `name.notes.md` files are not deleted, renamed or migrated; they are
ordinary Markdown documents (tree rows, outside review) and autocomplete no
longer reads them.

- A path is a companion by name shape alone (`isCompanionPath`, in
  `electron/shared/companionFiles.ts`, re-exported for main and the renderer).
  There are no companions of companions: comments are disabled when the open
  file is itself a companion.
- Companions never enter outside-change review: the baseline scan, `classify`,
  every baseline record, and `noteDiskChange` skip them. They are still
  written only through the compare-and-swap `writeMarkdownIfUnchanged`, which
  for companions holds the current file at a hidden path, verifies its hash,
  and publishes the new text with a no-clobber hard link (a mismatch puts the
  file back and answers `disk_changed`); the last comment deleted removes the
  file through `file:remove-companion`, which verifies the held file the same
  way and moves it to the Trash. An agent deleting a handled
  comment is metadata, not document text; the document text it changed is
  still reviewed per chunk.
- Main annotates `FileTreeNode.companion = {kind, documentPath}` when the
  sibling document exists; `buildFileTreeDisplayNodes` makes those rows
  children of the document. They show only under the active document (or when
  a name search reveals them) as "Comments · N", with a context
  menu of Open, Reveal in Finder, Move to Trash. Orphans are ordinary rows.
- Comments file format (`electron/shared/commentsFile.ts`, re-exported as
  `src/comments/commentsFile.ts`): entries separated by a blank line, `---`,
  and a blank line; each entry is `<!-- iliad:comment id=… -->` (plus
  `occurrence=N prefix="…"` only when the quote is not unique in the
  document), the quoted passage as a blockquote, then the comment text.
  Comment lines that would read as a separator, quote, or metadata are
  escaped with `\`; text the parser does not recognise is kept as comment text.
- `useSelectionComments` reads the file when the document opens and when the
  watcher reports a change to it; positions live in memory and the file is
  written only when the serialized entries differ from the file's. A
  `disk_changed` write is merged three ways by id (last read, memory, fresh
  file; an outside deletion wins unless the comment text was edited here) and
  retried once. A duplicate quote re-anchors only when its stored prefix still
  matches its occurrence; otherwise the comment is detached and listed in the
  "N detached comments" toolbar (Delete only). An outside change to a
  comment's quote, occurrence, or prefix re-anchors it from the file. Comments
  an outside tool removed come back if the writer restores that document's
  outside edit and the quote is found again (applied the next time the
  document is opened if it was not open).
- Migrations: comments from the old `userData/assistant/selection-comments.json`
  move into companion files per workspace when a window attaches (merged by id;
  entries whose document is gone stay in the store, which is deleted when
  empty). The old per-document notes keys in `localStorage` are left alone
  (unused).

Relevant files:

- `electron/shared/companionFiles.ts`, `electron/shared/commentsFile.ts`
- `electron/fs/fileOps.ts`, `electron/ipc/files.ts`
- `electron/comments/legacyCommentsMigration.ts`
- `src/app/useSelectionComments.ts`, `src/comments/`
- `src/review/pendingFileTree.ts`, `src/components/FileTree.tsx`
- `src/components/DetachedCommentsBar.tsx`

## Window Chrome and Layout

The UI target is one useful top bar, not a separate macOS traffic-light bar plus a second document bar.

- `.app-topbar` is the only top row.
- The left side reserves the macOS traffic-light area.
- The active document appears once in the topbar as a simple tab/dent.
- The sidebar begins below the topbar.
- The sidebar header shows workspace name plus `+` only.
- The top row's right side holds only the save state and the review slot; display settings live in Settings.

### Settings

One panel (`src/components/settings/SettingsPanel.tsx`, state in
`src/app/useSettingsPanel.ts`) replaces the old Typography, Language and
Writing assists menus (spec `specs/2026-09-27-premium-pass.md`, stage 4). It
opens from the sidebar's footer "Settings" row and from the app menu
"Settings…" (no accelerator; `window:menu-command` `open-settings` to the
window the menu was used in). It is a non-modal dialog anchored above the
footer row: outside click and Escape close it, Escape returns focus to the
opener, and it holds the sidebar peek open. Tabs sit at the bottom
(`role=tablist`, arrow keys/Home/End), the content scrolls above them so the
Writing tab fits at the 640px minimum height, and the last tab is remembered in
`localStorage` (`iliad:settings-tab`). Only the active tab body is mounted, so
closing Settings or leaving Writing ends shortcut recording and releases the
menu-shortcut pause.

- General (`GeneralSettings.tsx`): App language, Version (the package version
  injected by Vite as `__ILIAD_VERSION__`), Updates (Check now; Checking… / Up
  to date / failed / "Iliad MD x is ready" with Download and What's new). The
  app menu's "Check for Updates…" opens Settings on General and runs the check.
  An available update puts an amber dot on the footer row and the General tab.
- Typography (`TypographySettings.tsx`): Font, Size (A− N px A+, 14–24), Reset.
- Writing (`WritingAssistsSettings.tsx`): the Writing assists rows below.
  AI notices' "Use my key" opens this tab with the key field focused.

### Empty state and recent documents

With no document open, `EditorPane` renders `EditorEmptyState` (spec
`specs/2026-09-27-premium-pass.md`, stage 6): a serif line, up to five recent
documents as quiet row buttons (name without `.md`, its folder faint, the day
on the right: Today / Yesterday / weekday / short date via `Intl` in the app
language), then "New document ⌘N" as a plain link. Without recents the line
reads "Pick a document to start" and only the link shows. The ClipMark stays on
the launch screen and the error boundary only. A row opens its document the way
a tree click does (leave a normal review, `openNode`, which flushes the pending
save first and stops if it fails).

Recents are a display preference in `src/preferences/recentDocuments.ts`:
`localStorage` `iliad:recent-documents`, a map of workspace root → up to 10
normalized workspace-relative paths with the last-opened ISO date, never
written into the workspace. `useFileActions` reports `onDocumentOpened` only
after `readMarkdown` succeeded (so virtual create/delete review files never
record), comments companions (`*.comments.md`) are excluded, and
`onPathRelocated` moves entries on in-app renames and moves (folders carry
their documents). Entries that no longer exist in the tree are skipped at
render, not deleted.

Relevant files:

- `src/App.tsx`
- `src/components/EditorEmptyState.tsx`
- `src/preferences/recentDocuments.ts`
- `src/components/settings/GeneralSettings.tsx`
- `src/styles/app.css`
- `src/styles/chrome.css`
- `src/styles/sidebar.css`
- `src/styles/responsive.css`

## App Language

The app chrome supports English and Spanish UI strings. This is an application display preference only; it must never translate Markdown document content, workspace names, file names, document tab labels derived from file names, image relative paths, or operating system/filesystem error details.

- The selected language is stored in `localStorage` under `iliad:app-language`.
- First-run default language comes from `navigator.language`: locales starting with `es` use Spanish, all others use English.
- `src/i18n/appLanguage.ts` owns language normalization, persistence helpers, and the root hook.
- `src/i18n/strings.ts` owns renderer string dictionaries and small interpolation helpers.
- `src/App.tsx` chooses the active dictionary and passes narrow labels/message objects to components and hooks.
- Presentational components and feature hooks should not import a global translator singleton.
- Internal state remains semantic. Save status values are `saved`, `saving`, `unsaved`, and `error`; display strings are selected only at render time.
- Hooks preserve `Error.message` exactly when a caught value is an `Error`. Localized fallbacks are used only for unknown thrown values and renderer-authored notices/prompts.
- The native open-folder dialog receives the renderer language through IPC. The Electron handler validates it and falls back to English for missing or unsupported values.

Relevant files:

- `src/i18n/appLanguage.ts`
- `src/i18n/strings.ts`
- `src/App.tsx`
- `src/components/settings/GeneralSettings.tsx`
- `electron/ipc/workspace.ts`
- `electron/preload.ts`
- `src/types/iliad.ts`

## Document Navigation History

The app keeps one active document, not tabs. Back/Forward history is an in-memory renderer concern for moving through recently opened Markdown documents.

- Normal file-tree Markdown opens, created Markdown files, duplicated Markdown files, and rendered internal Markdown links record the previous active document after the target opens successfully.
- Back and Forward open valid Markdown targets through the same save-before-open path as normal document navigation.
- The Back/Forward arrows sit after the sidebar toggle in the top row and appear only when there is a target in that direction (no disabled placeholders), so the toggle never moves. Their tooltips name the target and show the key chip.
- ⌘[ is Back and ⌘] is Forward, handled by the window keydown with the other app shortcuts (ignored when repeated, composing or already handled, and never while a Writing assists shortcut is recording). The editor leaves these keys to the app: `CodeMirrorHost` installs CodeMirror's default keymap without Mod-[ / Mod-] (indentLess/indentMore; Tab / Shift-Tab still indent), and both keys are in the Writing assists taken-shortcut list.
- Failed saves or failed reads must not mutate history.
- Opening a new document normally clears Forward history.
- Stale history paths are skipped only after a successful Back/Forward navigation to the next valid target.
- External files, external web/mail links, folder expansion, and same-document links do not record document history.
- History is cleared when the workspace changes or the active document is cleared.
- Renames (manual or automatic) and moves relocate history entries through the one relocation callback (`src/app/pathRelocation.ts`), so Back/Forward keep working after a rename.
- Do not add tabs until there is evidence the file tree plus Back/Forward history is insufficient.

Relevant files:

- `src/App.tsx`
- `src/app/useDocumentHistory.ts`
- `src/files/fileActions.ts`
- `src/styles/chrome.css`

## Writing AI and Outside Review

Iliad has no chat panel and no agent of its own (ADR-0021). AI reaches the
writer's Markdown in two ways, and both keep every change visible and
reversible.

**Built-in writing AI** works on the current document and the current selection
only (the whole current document is context; nothing else is sent), runs on Groq (`openai/gpt-oss-120b`, `reasoning_effort: "low"`,
streaming; `electron/writing/`), and is review-first: nothing lands in the
buffer without Tab or Accept. Spec: `specs/2026-09-25-groq-ai-free-tier.md`
(ADR-0023, proposed).

- Inline completion (`src/editor/ideaAutocomplete/`) shows ghost text, only
  on request: typing never sends a request (no automatic suggestions since
  2026-09-25, `specs/2026-09-25-writing-assists-one-row.md`). A shown,
  finished suggestion is always read by the `autocomplete-announcement` live
  region (no setting).
- The ✦ AI selection menu runs a selection-scoped rewrite (Tighten or a canned
  Edit instruction) in one request and lands it in the inline review
  (`src/editor/aiReview/`) with exact-match-or-discard apply: if the range
  changed, the result is dropped.
- The corrector (`src/editor/writingCorrector/`) is local and needs no key.
- **Two routes, chosen in main per request** from a three-state key store
  (`groq/keyStore.ts`): no key → **free** (the Iliad AI proxy, a Cloudflare
  Worker in `relay/ai-proxy/`, holds Iliad's Groq key and enforces per-install,
  per-network and global daily limits); a saved key → **own key** (Mac → Groq
  directly); a saved key that cannot be decrypted → **blocked** ("Re-enter
  your Groq key"). There is no fallback between routes: an unreadable key is
  never treated as "no key", own-key failures are never retried free, and a
  free "out" never uses a key the writer did not give.
- Prompts, limits and budgets live in the pure, versioned
  `electron/writing/groq/prompts/` (frozen `vN.ts`, imported by the Worker
  too). Both routes read the same OpenAI-compatible SSE through
  `groq/sse.ts`, which reads only `choices[0].delta.content` (reasoning never
  reaches the cleaners) and caps output at the task's `maxOutputChars`.
  Streaming partials (`groq/partials.ts`) show stable words at most every
  100 ms. The own-key route builds the messages itself; the free route sends
  only the **structured task** (`/v1/generate`) and the Worker builds the same
  messages. Text carrying harmony/think markers is discarded.
- Free route client (`groq/proxyClient.ts`): an anonymous install token
  (`userData/ai/install.json`) is issued lazily by the first free request
  (never at launch); a 401 `invalid_token` re-issues once and `token_expired`
  refreshes once (same identity), then the request is retried once. Refusals
  map per the spec's error contract: `quota_exhausted` / `global_cap` /
  `install_limited` → `free_exhausted` with `resetAt` (00:00 UTC), kill switch
  → `free_unavailable`, `client_outdated`, `upstream_busy` / `rate_limited` →
  `rate_limited`, others → `provider` / `timeout`. The app sends
  `X-Iliad-Client: iliad-md/<version>`.
- Proxy URL (`groq/config.ts`): the built-in workers.dev URL, optionally
  relocated by `https://iliad.md/ai.json` (`{ v: 1, proxyUrl }`, HTTPS and
  host on the single `ILIAD_AI_PROXY_HOST_ALLOWLIST` constant; fetched in the
  background of a free request at most once a day and cached in
  `userData/ai/endpoint.json`). A URL still carrying the `REPLACE` placeholder
  is refused (nothing is sent).
- **Dev overrides** are read only when `!app.isPackaged`: `GROQ_API_KEY`
  (own-key route when no key is saved) and `ILIAD_AI_PROXY_URL` (free route
  base URL, e.g. `npm run dev:fake-ai-proxy -- --install-limit 2` →
  `http://127.0.0.1:8788`, an in-process fake of the Worker contract from
  `tests/fixtures/fakeAiProxy.ts`, or `wrangler dev`). Packaged builds ignore
  both, so no environment variable can reroute a packaged app's text.
- The own key lives in `userData/ai/settings.json`, encrypted with Electron
  `safeStorage` (`groqApiKeyEnc`; plaintext only if encryption is unavailable,
  `storage: "plain"`), and is validated against Groq `GET /models` before it
  is saved ("rejected" vs "unreachable"). Every AI file is written atomically
  (temp + rename) and chmod 0600. An awaited startup migration, before the
  writing IPC is registered, removes `geminiApiKey` from the historical
  `userData/assistant/settings.json` (other fields kept; file deleted if
  empty). Gemini env vars are not read.
- Status (`writing-assist:status`) reports `{ corrector, ai: { route, model },
  groqKey: { state, last4, rejected } }`, never counts or quota. "Out" is
  learned from request results: autocomplete and ✦ AI failures carry
  `resetAt`, and the renderer shows one calm notice (`src/editor/aiNotice.ts`,
  `src/components/AiNoticeBar.tsx`) with the reset time in local time, plus
  "Use my key" (free-route notices) or "Update key" (own key rejected or
  unreadable). Free "out" and key/connection notices set no cooldown: every
  request is explicit. ✦ AI is enabled with no key.
- **Whole-document context and writing preferences** (prompt v2,
  `specs/2026-09-27-ai-context-and-preferences.md`). The renderer sends, with
  each completion and ✦ AI edit, a snapshot of the full current document
  captured at request time (`document: { text, cursor }` for completions — the
  document without a visible draft, the draft stays the tail of `prefix`;
  `document: { text, selectionFrom, selectionTo }` for edits, omitted when the
  safe passage no longer matches) and the writer's preferences (Settings →
  Writing, app data, ≤ 1,000 characters). Main decides the rest
  (`electron/writing/aiTasks.ts`): preferences are trimmed and rejected over
  the limit (`too_long`, never sliced); the v2 task carries the document
  trimmed to one shared byte budget — the UTF-8 length of
  `JSON.stringify(task)` is at most `WRITING_AI_MAX_TASK_BYTES` (56 KiB,
  below the Worker's 64 KiB body limit) and the document at most 40,000
  characters — by the pure, deterministic `trimDocumentForContext`
  (`prompts/context.ts`): the local window (completions) first, then the
  document start (≤ 6 KiB), then the nearest text outward, `[…]` at gaps,
  never splitting a surrogate pair, an oversized window → a cursor-centred
  slice. Completions mark the cursor (`<<<CURSOR>>>`, with any draft being
  extended re-inserted before it) and get the outline (`buildDocumentOutline`:
  ATX headings outside front matter and fenced code, ≤ 80 headings and 4 KiB,
  the cursor's section marked); edits get the rest of the document as a
  read-only reference with the passage's place marked (`<<<PASSAGE>>>`) and
  the editable passage in its own section. `<<<NAME>>>` delimiters inside
  content are neutralized. Iliad's rules stay in the system message (they say
  preferences cannot override the rules, output boundaries, the edit
  instruction or the Steer direction); preferences, outline and document are
  delimited user sections. Output rules, budgets and caps are v1's. Main adds
  an edit scope guard (`looksLikeReferenceEcho` in `electron/writing/tighten.ts`):
  an answer copying ≥ 60 contiguous characters (or copied windows over half of
  it) from outside the selection is rejected; the existing echo guards and the
  exact-text-before-accept check stay. Comments companions are never sent.
- **Prompt versions per route** (temporary, `promptVersionFor(route, task)` in
  `prompts/index.ts`, resolved in `WritingAiService.run` after the route):
  own key → v2 for every task (built locally); free → v1 for autocomplete and
  selection (built exactly as before, no document or preferences) and v2 for
  `name`, until the Worker serving v2 is deployed; then the free route moves
  to v2 and the split is removed (`docs/release.md`). The Worker parses every
  version with the shared strict parser and reserves `UTF-8 prompt bytes +
  PROMPT_OVERHEAD_TOKENS` input tokens, so the largest v2 body (~57 KB) reserves
  about $0.011 at list prices before settling at actual usage.
- Diagnostics (`autocomplete.ai.*`, `selection_ai.ai.*`) record route, model,
  prompt version,
  timings, finish reason, output length and error codes, never text, keys,
  tokens or proxy bodies. Writing AI IPC is accepted only from trusted app
  windows (`electron/ipc/trust.ts`).

**Length keys suggest; ⌘↵ opens the ✦ AI menu**
(`specs/2026-09-24-one-ai-key.md`, revised by
`specs/2026-09-25-writing-assists-one-row.md`). Suggestion keys never rewrite.
Three length keys (defaults ⌘, ⌘. ⌘/, neighbours on an English keyboard) ask
for a Sentence, Paragraph, or full Idea (until the current idea/section is
complete; no headings) in one request; if a shorter suggestion is visible they
extend it, generating only the missing part. They are the only keys that ask
for a suggestion (plus Longer, Another and Steer… on the suggestion toolbar);
the old `inline` kind and the automatic trigger are gone, so escalation starts
at Sentence. The ✦ AI menu key (default ⌘↵, stored as `shortcuts.continue`)
opens the ✦ AI menu over a selection (typed instruction, or Rewrite / Expand /
Shorten / Summarize / Turn into a list; Shorten is Tighten mode, the rest are
canned Edit instructions) and does nothing with no selection. All four keys
are configurable and kept distinct; the length keys run at highest precedence
(they outrank the corrector's ⌘. and CodeMirror's ⌘/ comment toggle) and do
nothing over a selection. Tab accepts (pending selection review → ghost →
indentation), Esc dismisses or rejects, ⌥↑/↓ cycles alternatives. Only the
selection keymap binds the ✦ AI menu key and it always consumes it, so the key
never falls through to CodeMirror's `insertBlankLine`.

The Writing assists settings (`src/components/settings/WritingAssistsSettings.tsx`, Figma
"Writing assists: one row style", frame 15) holds settings only, in one row
style: name, optional grey note, control on the right, a hairline under each
row. Rows: Corrector, Autocomplete, then (while Autocomplete is on) ✦ AI menu,
Sentence, Paragraph, Full idea (key chips you click to record keys), Accept /
Another / Dismiss (fixed keys), Reset shortcuts; then the AI key row ("AI
included — Free, with a daily limit — Use my key"; with a key "Groq key —
••••1234 — Change · Remove"; "Re-enter your key" or "Groq rejected this key"
in the note when relevant; the link opens the key form in place of the row)
and Privacy (opens `https://iliad.md/privacy/` or `https://iliad.md/es/privacidad/`
by app language). In-the-moment controls (Longer, Another, Steer…) live on the
suggestion toolbar. Stored preferences keep only `shortcuts`; older stored
`manualOnly`/`announce` keys are ignored.

Shortcut keys are recorded, not picked from a list (spec
`specs/2026-09-27-record-your-own-shortcuts.md`, Figma frame 16): clicking a
chip records the next key combination as a CodeMirror key name, spelled the
way CodeMirror's keymap will match it (`shortcutFromKeyEvent` in
`src/editor/ideaAutocomplete/options.ts`; the character the layout produces,
so a Spanish keyboard can use ⌘ñ). A key needs ⌘ or ⌃ (or is ⌥↵); keys Iliad
already uses (app menu, ⌘W/⌘O, comment/shorten keys, editor essentials) are
refused as "taken"; a key another row uses offers a swap (↵). Esc or blur
cancels. The recording logic is the pure `recordShortcutKeyDown`
(`shortcutRecording.ts`); while a chip records, the window's menu shortcuts
are paused through `writing:set-recording-shortcut` (`setIgnoreMenuShortcuts`).

**Outside agents** write Markdown directly in the folder. Iliad derives their
changes from the workspace baseline (next section) and shows them in the same
document-native review UI, per chunk. Outside tools learn how to work with
Iliad from the bundled skill and the CLI:

- `iliad status [--json]` prints each window's folder and open document
  (`Iliad is not open.`, exit 3, when the app is not running).
- `iliad open <file> [--line N]` shows a Markdown file in the window whose
  workspace contains it (longest root), or a new window for the file's folder;
  it replies only after the renderer opened the document and revealed the line.
- `iliad skill install` copies `resources/skill/iliad/SKILL.md` to
  `~/.claude/skills/iliad/SKILL.md`; `iliad skill print` prints it.
- `iliad install [--dir D] [--json]` / `iliad uninstall [--json]` put the
  command on `PATH` from a terminal, so an agent can install Iliad without
  GUI clicks (spec `specs/2026-09-25-agent-installable-iliad.md`).
- `iliad [folder]` keeps the old launch behavior.

The CLI talks to main over a user-only socket (`userData/iliad.sock`, chmod
0600) and never writes documents. The packaged `Contents/Resources/bin/iliad`
wrapper runs `iliad.mjs` with the app's own executable in Node mode.

Command install has one implementation, `bin/lib/install.mjs`. `iliad install`
(run from the bundle: `…/Iliad MD.app/Contents/Resources/bin/iliad install`)
and the app menu item "Install ‘iliad’ Command…" both use it; main cannot
import `bin/` statically (`electron/` compiles with `rootDir: "."`), so
`electron/cli/installCommand.ts` dynamically imports it from
`process.resourcesPath/bin/lib/install.mjs` (packaged only; `bin/` is an
extraResource). Rules: link the bundle's wrapper into the first writable of
`/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin` whose `iliad` slot is
empty or already an Iliad link (a bundle named `*Iliad*.app`); never replace
real files or other programs' links (empty slots get a plain `symlink`, old
Iliad links are re-read and swapped by temp link + rename); `unchanged` when
the link is already right; warn when the folder is not on `PATH` or another
`iliad` comes first. Refused (after `realpath`): checkouts (use `npm link`),
App Translocation, and bundles on a read-only volume (`EROFS`: a mounted DMG
at any mount point), since those links would dangle. macOS only. `--json`
prints one object for every outcome with a stable `code` on failure. `uninstall` removes only Iliad links and
leaves Homebrew's (`<prefix>/Caskroom/iliad-md` exists) to `brew`. Links point
at a bundle path, not a version, so replacing the app in place keeps them
valid. The Homebrew cask (`packaging/homebrew/iliad-md.rb`) links the same
wrapper with its `binary` stanza.

The in-app update check (`electron/updates/updateService.ts`) is notify-only:
it reads the latest GitHub release and opens its DMG URL. Every release also
carries an unversioned `Iliad-MD-arm64.dmg` (the stable
`releases/latest/download/` URL); `selectMacDmgAsset` prefers the versioned
DMG so asset order never matters, and `latest-mac.yml` never lists the stable
copy.

Relevant files:

- `electron/writing/`, `electron/ipc/autocomplete.ts`, `electron/ipc/tighten.ts`,
  `electron/ipc/writingSettings.ts`, `electron/ipc/trust.ts`
- `src/editor/ideaAutocomplete/`, `src/editor/aiReview/`,
  `src/components/settings/WritingAssistsSettings.tsx`
- `bin/iliad`, `bin/iliad.mjs`, `bin/lib/`, `resources/skill/iliad/SKILL.md`
- `electron/cli/`, `src/app/useCliBridge.ts`

## Workspace Baseline and Outside Changes

Iliad keeps one accepted Markdown state per open workspace, the baseline, in
the main-process `WorkspaceBaselineService` (`electron/review/`). Disk is
compared against it whenever the watcher reports Markdown activity, and the
difference is the outside-change review ("changed outside Iliad") that the
renderer shows in the document-native review UI. Review records still use the
historical `AgentChangeProposal` type names and `agent:*` IPC channel names;
the handlers live in `electron/ipc/review.ts` and resolve the workspace root
from the window's session, never from a renderer-sent root.

Rules that must hold:

- The baseline is session-scoped: captured from disk when a window attaches to
  the workspace, dropped shortly after the last window detaches.
- Every Iliad-owned Markdown write updates the baseline inside the same
  serialized operation that performs the write. Editor saves go through
  `writeMarkdownIfUnchanged`, a compare-and-swap that checks path identity and
  expected content immediately before writing. Structural file actions run
  inside `runIliadMutation`, which defers reconciliation while in flight and
  records the result.
- Watcher hints are never dropped. Mutation markers and in-flight
  mutations defer reconciliation; they do not cancel it. `change` events on
  known files refresh only those paths; renames, unknown filenames, and
  watcher restarts trigger a full scan. Create and delete items need a second
  observation before they are published.
- Outside content stays on disk while the review is pending. Outside edits of
  existing files are reviewed per chunk: Keep folds that chunk into the
  baseline (no disk write; the item disappears once baseline equals disk);
  Restore writes disk minus that chunk and leaves the baseline alone. Chunk
  ids are positional (`${fileId}-hunk-${n}`), so every chunk action carries
  the baseline and disk hashes the renderer saw and main answers `stale`
  (`agent:keep-chunk` / `agent:restore-chunk`) when they no longer match.
  Keep all / Restore all act on the whole file. Creates and deletes stay
  file-level: Keep file / Move to Trash, Confirm deletion / Restore file.
  File ids survive review revisions, so every file-level action
  (`agent:apply-proposal-file` / `agent:reject-proposal-file`, from the top
  row, the conflict banner or the tree's bulk Keep all) carries the revision
  the writer saw (`baselineHash` / `diskHash`, `null` for an absent side) and
  main answers `stale` when the item no longer matches; nothing is written.
  The tree's bulk Restore all (`agent:reject-proposal`) sends every file it
  showed with its hashes and is stale unless main's pending set is exactly
  that set. A stale answer refreshes the review and shows the "That file
  changed again outside Iliad" notice; the refreshed item replaces the old
  one in place.
- The open document's file-level review controls sit on the right of the
  window's top row ("{n} changes · ↑ ↓ · Keep all · Restore all"; a stale
  review shows only Restore all). EditorPane owns them and portals
  `ReviewControls` into the top-row slot App passes as `topbarSlot`. ↑ ↓ only
  scroll to the previous/next unresolved chunk and mark it active (a local
  index keyed to the file and its reviewed disk content, so a new outside
  revision resets it; wrapping at the ends); they never act on it.
  The conflict and detached-comments bars stay light bands above the text.
- Every Restore uses a guarded replacement, never a truncating write: the
  current file is renamed to a hidden holding path and its bytes verified
  against the reviewed hash, the new text is written to a temp file in the
  same folder and published with a hard link (fails if anything appeared at
  the path), then the held original goes to the Trash (never deleted; if
  trashing fails it stays at its hidden holding path). Any mismatch or
  collision leaves the newer file untouched, keeps the held bytes beside it,
  and reports `stale`. Restoring a deleted file creates it exclusively
  (`O_EXCL`).
- Keep never loads disk over a conflicted or dirty editor buffer (only the
  conflict banner's confirmed Keep discards it), Esc and Tab never act on
  outside chunks, and a conflicted buffer resumes autosave only when disk
  equals its saved text again.
- Companion files (`*.comments.md`) are excluded everywhere in the baseline
  service: scan, classify, records, and disk-change hints. `*.notes.md` files
  are ordinary documents and are reviewed like any other (since 2026-09-25).
- The renderer subscribes (`agent:external-review-changed`) and pulls once
  (`agent:get-external-review`); both carry a revision and older snapshots are
  ignored. The renderer never drives the review lifecycle.

Relevant files:

- `electron/review/`
- `electron/ipc/review.ts`, `electron/ipc/files.ts`, `electron/ipc/workspace.ts`
- `electron/fs/workspaceMutationMarkers.ts`
- `src/app/useOutsideReview.ts`, `src/review/`
- `src/editor/aiReview/`
- `src/app/useDocumentPersistence.ts`

## Styles

CSS is imported through `src/styles/app.css` only. Keep imports in this order because later files intentionally layer on narrower responsibilities:

1. `tokens.css`
2. `base.css`
3. `chrome.css`
4. `sidebar.css`
5. `editor.css`
6. `mark.css`
7. `visual-markdown.css`
8. `popovers.css`
9. `responsive.css`

Style ownership:

- Every colour lives only in `tokens.css`, named by role; raw colours elsewhere fail `npm run lint:css`.
- Reset, root fonts, launch screen, and generic primary button styles live in `base.css`.
- App shell, topbar, document tab, shared icon buttons, and content grid styles live in `chrome.css`.
- Sidebar, file tree, tree selection, and inline rename styles live in `sidebar.css`.
- Editor container, empty editor state, and scroll geometry live in `editor.css`.
- CodeMirror visual Markdown classes and widgets live in `visual-markdown.css`.
- Inline review (outside chunks, ✦ AI results, conflict/detached bands) lives in `editor.css`; the top-row review controls live in `chrome.css`; pending-review tree markers live in `sidebar.css`.
- The paperclip signature mark lives in `mark.css`.
- Typography popover, tree context menu, toasts, and transient error text live in `popovers.css`.
- Media queries live in `responsive.css` and stay last.

## Editor Host

`src/editor/CodeMirrorHost.tsx` mounts the CodeMirror `EditorView` for
`EditorPane`. Iliad owns this host instead of using `@uiw/react-codemirror`.

- The document is synced from React state synchronously, in a layout effect,
  through `syncEditorDocument` (`src/editor/documentSync.ts`). The buffer must
  match app state before paint and before any keystroke can land on an old
  document; a deferred sync lets a keystroke autosave stale text over another
  file or over a kept outside version.
- Sync transactions carry the `externalDocumentChange` annotation and never
  reach `onChange`; `onChange` fires only for edits made in the editor.
- App extensions are reconfigured through one `Compartment`; the basic setup
  (from `@uiw/codemirror-extensions-basic-setup`), `indentWithTab`, and the
  host theme are fixed at mount.

Why: the wrapper's 4.25.x "typing latch" (a 200-tick counter on a 1 ms
`setInterval`) held external value updates for seconds under timer clamping or
an occluded window, and every keystroke re-armed it. Live QA reproduced a
permanently stale editor by typing one character and opening another file
within the same second.

## Editor Scroll

Trackpad and wheel scrolling must use a normal native scroll container so macOS can show its overlay scrollbar.

Current decision:

- `.editor-surface` is the document scroll container.
- CodeMirror is allowed to grow inside that surface.
- `.cm-scroller` is not the scroll owner in this app layout.

This decision replaced several failed attempts to make CodeMirror's internal scroller handle Electron/macOS trackpad events. If scroll breaks again, inspect actual DOM geometry first:

- `editor-surface.clientHeight`
- `editor-surface.scrollHeight`
- `editor-surface.scrollTop`
- computed `overflow-y`

Do not add another wheel handler until the scroll geometry proves the native container cannot work.

Relevant files:

- `src/components/EditorPane.tsx`
- `src/styles/editor.css`

## Visual Markdown

The visual Markdown layer is intentionally lightweight and should not become a full Markdown renderer.

- It hides syntax on inactive lines for common Markdown constructs.
- It renders simple pipe tables as restrained visual rows on inactive lines.
- Table rows reveal raw Markdown when the cursor is on that row.
- Tables should read as quiet ruled document tables, not rounded row cards or spreadsheet UI.
- Header and body cells share one computed column template across the table block.
- Table rows should stay compact; tune table-specific CSS rather than global editor line height.
- Blockquote markers are hidden only on inactive lines; active lines show the raw `>` marker for editing.
- Links render as clickable inline widgets unless the caret or current text selection intersects the link source range.
- A selected/active line must not reveal every link on that line by itself.
- Web/mail links open externally; resolved workspace Markdown links open inside Iliad; other local links open through the OS when possible.
- Image syntax with a recognized YouTube URL renders as a responsive `youtube-nocookie.com` iframe on inactive lines. Normal `[title](youtube-url)` links remain link widgets, and non-YouTube image syntax keeps the existing local/remote image behavior.
- YouTube parsing lives in `src/editor/visualMarkdown/media.ts`, accepts only absolute `http:`/`https:` URLs from the documented YouTube host/path forms, and rejects host spoofing through `URL.hostname` checks.
- It uses CodeMirror decorations only.
- It must never crash the editor. Decoration building is defensive and falls back to no visual decorations on failure.
- Do not use block decorations from a `ViewPlugin`; CodeMirror throws `RangeError: Block decorations may not be specified via plugins`.
- Image widgets are inline widgets for that reason.
- Table widgets are also inline widgets for that reason.

Relevant files:

- `src/editor/visualMarkdown.ts`
- `src/editor/visualMarkdown/index.ts`
- `src/editor/visualMarkdown/activeRanges.ts`
- `src/editor/visualMarkdown/blocks.ts`
- `src/editor/visualMarkdown/inline.ts`
- `src/editor/visualMarkdown/media.ts`
- `src/editor/visualMarkdown/tables.ts`
- `src/editor/visualMarkdown/widgets.ts`
- `src/editor/imageDropPaste.ts`
- `src/editor/paths.ts`
- `src/styles/visual-markdown.css`

## Editor Typography

Typography is an editor display preference, not document content.

- The main topbar should stay minimal.
- Font size and font family controls live behind one compact typography popover.
- Do not add always-visible `A-` / `A+` buttons to the topbar.
- Supported presets are intentionally curated: Serif, Sans, and Mono.
- Document headings are part of the editor typography and must follow the selected preset.
- `editorFontSize` and `editorFontPreset` are stored in `localStorage`.
- These settings must not modify Markdown files.

Relevant files:

- `src/preferences/editorPreferences.ts`
- `src/components/settings/TypographySettings.tsx`
- `src/components/EditorPane.tsx`
- `src/styles/popovers.css`
- `src/styles/visual-markdown.css`

## Images

- Dropped or pasted images are saved into `assets/<document-name>/`.
- The editor inserts a Markdown image reference to the saved asset.
- Asset URLs are served through the `iliad-file://` protocol.
- The protocol only serves files inside remembered workspaces.

Relevant files:

- `src/editor/imageDropPaste.ts`
- `src/files/fileActions.ts`
- `electron/ipc/assets.ts`
- `electron/fs/fileOps.ts`
- `electron/fs/workspaceRegistry.ts`
- `electron/main.ts`

## Save and Navigation Safety

Autosave is part of the writing model. Before opening another file, switching workspaces, creating a file or folder, renaming, duplicating, or moving an item to Trash, the app flushes pending saves.

If a save fails, navigation/create/rename must stop. Do not swallow save errors and then move the user away from dirty content.

The `flushSave` the app passes around also writes pending comment changes
(the document's `name.comments.md`), so file operations wait for both and stop
if either fails.

Saves carry the hash of the text the editor last loaded or saved. When the file
on disk no longer matches (an outside tool wrote it while the writer was
typing), main refuses the write and the document enters conflict mode: the
buffer stays editable, autosave is disarmed, and a banner offers Restore
previous version (the writer's edits win and save normally) or Keep outside
changes (confirmed, discards the buffer and reloads from disk). Last-writer-wins
is never acceptable.

The autosave fence (`src/app/autosaveFence.ts`, owned by
`useDocumentPersistence` as `runWithAutosavePaused`) serializes operations
that move the active document with its saves: entering it disarms the timer
and awaits any tracked save in flight; while it is held, typing only marks the
buffer dirty and `flushSave` waits for it; leaving it re-arms autosave, which
saves to the document's new path (the persistence ref follows the relocated
active file immediately). Only the auto-rename uses it today.

Relevant files:

- `src/app/useDocumentPersistence.ts`
- `src/files/fileActions.ts`
- `electron/review/workspaceBaseline.ts`

## Where New Features Go

- App shell state and cross-feature coordination: `src/App.tsx`.
- Workspace loading and persisted workspace state: `src/app/useWorkspace.ts`.
- Autosave, dirty state, save flushing, and load/clear document state: `src/app/useDocumentPersistence.ts`.
- Outside-change review state and actions: `src/app/useOutsideReview.ts` and `src/review/`; inline review rendering: `src/editor/aiReview/`.
- Comments (companion files): `src/app/useSelectionComments.ts`, `src/comments/`; companion path rules: `electron/shared/`.
- CLI bridge: `bin/` (CLI), `electron/cli/` (socket and open requests), `src/app/useCliBridge.ts` (renderer side), `resources/skill/iliad/SKILL.md` (agent instructions).
- File tree traversal and path relocation helpers: `src/files/fileTree.ts` and `src/files/pathUtils.ts`.
- User-facing file operations and save-before-action orchestration: `src/files/fileActions.ts`.
- Reusable UI surfaces and popovers: `src/components/`.
- CodeMirror setup and editor callbacks: `src/components/EditorPane.tsx`; the `EditorView` host and document sync: `src/editor/CodeMirrorHost.tsx`, `src/editor/documentSync.ts`.
- Editor-only helpers, image drop/paste, link path resolution, and visual Markdown behavior: `src/editor/`.
- Visual Markdown feature rules and shared decoration helpers: `src/editor/visualMarkdown/`.
- Electron file safety and workspace boundary rules: `electron/fs/pathSafety.ts`.
- Electron filesystem operations: `electron/fs/fileOps.ts`.
- Built-in writing AI (Groq routes, prompts, tighten, key storage): `electron/writing/` and `electron/writing/groq/`; notices: `src/editor/aiNotice.ts`; diagnostics: `electron/diagnostics/`.
- Workspace baseline, outside-change review, and the guarded Markdown write primitive: `electron/review/`.
- IPC handler groups: `electron/ipc/`.
- Window creation and app loading: `electron/window/createWindow.ts`.
- Local display preferences: `src/preferences/`.
- Shared renderer/Electron API types: `src/types/iliad.ts`.
- Styles: add rules to the responsibility-specific file under `src/styles/`; keep `app.css` as imports only and keep responsive rules last.

Likely future homes:

- Outline/table of contents: `src/editor/outline/` plus a small component in `src/components/`.
- Search/find-replace: `src/search/` for feature state and CodeMirror integration in `src/editor/`.
- Export: `electron/ipc/export.ts` plus renderer code under `src/export/`.
- Math, diagrams, code fences, and other visual Markdown features: additional `src/editor/visualMarkdown/` feature modules.
- Preferences panel: `src/preferences/` plus a settings component.
- Keyboard shortcuts and commands: `src/commands/`.

## Verification

Use these checks after meaningful changes:

```bash
npm run typecheck
npm test
npm run lint:css
npm run build
```

Manual Electron checks still matter:

- Create a new file with `+`.
- Rename it without typing `.md`.
- Open several Markdown files repeatedly.
- Open a document with local or remote image syntax.
- Trackpad/wheel scroll a long document and confirm a native overlay scrollbar appears.
- With no key (free route; in dev point `ILIAD_AI_PROXY_URL` at
  `npm run dev:fake-ai-proxy -- --install-limit 2`): type and pause (no
  suggestion appears), request a completion (⌘, ⌘. ⌘/) and accept it with
  Tab; ⌘↵ with nothing selected does nothing; select text, press ⌘↵ or click
  ✦ AI, run an action, Accept and Reject it. Past the limit, each request
  shows "Today's free AI has run out. It's back at {time}." with "Use my key".
  Save an own Groq key (an invalid one is refused, not saved) and repeat;
  remove it to return to free. Check the Writing assists menu against Figma
  frame 15 in English and Spanish.
- Edit an open document from another tool: each chunk shows Keep / Restore;
  Keep all and Restore all work from the top row (↑ ↓ step through the
  chunks) and the sidebar's
  all-documents row ("{n} changed", shown only when a document other than
  the open one is pending); an
  outside-created file offers Keep file / Move to Trash and a deletion offers
  Confirm deletion / Restore file.
- Add a comment on a selection and confirm `name.comments.md` appears beside
  the document; rename the document and confirm the comments file follows it
  (a same-stem `name.notes.md` stays where it is, as an ordinary document).
- `iliad status` lists the window and document; `iliad open <file> --line N`
  shows the file at that line (also with the app closed).

## How to Start Future Work

Future contributors should not inspect the entire codebase every time. Start here:

1. Read this file.
2. Read the latest relevant spec in `specs/`.
3. Inspect only the files listed in the relevant section above.
4. Run the verification checks.

If a change alters one of these decisions, update this document in the same change.
