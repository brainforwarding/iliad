# Iliad Architecture Notes

This document records product and implementation decisions that future contributors should read before changing the app. Specs in `specs/` capture individual change plans; this file captures stable decisions that should survive across changes.

Before evaluating any new feature, read [`source-as-contract.md`](./source-as-contract.md). It is the lens through which feature decisions should pass: the on-disk Markdown file is the contract, and features that break that contract are risky regardless of how well they fit any other section below.

Before changing the agent, context, proposal, or runtime architecture, read
[`agent-vision.md`](./agent-vision.md). It defines the Markdown-first product
boundary for agent work.

## Product Shape

Iliad is a local-first Markdown writing app. The current milestone is a calm,
minimal writing surface backed by real local files, plus a review-first agent
that can propose Markdown edits and new Markdown documents without persisting
model-authored changes until the user approves them.

The agent should grow as a Markdown workspace collaborator, not as a general
computer or coding agent. Rubrics, handouts, lesson plans, deck outlines,
scripts, templates, and research annexes are all Markdown documents in Iliad;
they should use the same document proposal contract rather than separate
artifact-specific tools.

Avoid broad navigation, command palettes, tabs, direct AI writes, whole
workspace uploads, or subagent dashboards until each addition is backed by a
real writing workflow, explicit context, runtime events, and the document-native
review path.

## Module Map

The refactor keeps public contracts small and routes behavior to owner modules instead of concentrating it in the app shell.

```text
electron/
  main.ts
  preload.ts
  agent/
    agentModels.ts
    agentService.ts
    errors.ts
    documentTools.ts
    openaiResponses.ts
    proposalDrafts.ts
    proposalStore.ts
    settingsStore.ts
    openai/
      client.ts
      providerErrors.ts
      prompts.ts
      request.ts
      stream.ts
      summaries.ts
    runtime/
      codexAppServerClient.ts
      codexAppServerProvider.ts
      codexFileChangeCapture.ts
      codexPatchConversion.ts
      codexRunJournal.ts
      openaiResponsesProvider.ts
      provider.ts
    transcription.ts
  review/
    externalReviewProjection.ts
    workspaceBaseline.ts
  diagnostics/
    logger.ts
  fs/
    fileOps.ts
    pathSafety.ts
    workspaceRegistry.ts
  ipc/
    assets.ts
    files.ts
    shell.ts
    workspace.ts
  launch/
    argv.ts
    workspace.ts
  window/
    createWindow.ts
    windowManager.ts

src/
  App.tsx
  main.tsx
  app/
    useAgentProposals.ts
    useDocumentHistory.ts
    useDocumentPersistence.ts
    useWorkspace.ts
  assistant/
    assistantUtils.ts
    useAssistantRun.ts
  components/
    assistant/
      AssistantComposer.tsx
      AssistantHeader.tsx
      AssistantPendingProposals.tsx
      AssistantSettings.tsx
      AssistantTranscript.tsx
    AssistantPanel.tsx
    EditorErrorBoundary.tsx
    EditorPane.tsx
    FileTree.tsx
    LanguageMenu.tsx
    TreeContextMenu.tsx
    TypographyMenu.tsx
  i18n/
    appLanguage.ts
    strings.ts
  editor/
    imageDropPaste.ts
    paths.ts
    aiReview/
      diff.ts
      extension.ts
      types.ts
    visualMarkdown.ts
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
    assistant.css
    base.css
    chrome.css
    sidebar.css
    editor.css
    visual-markdown.css
    popovers.css
    responsive.css
  types/
    iliad.ts
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

- The sidebar header has two create actions: new document and new folder.
- New document creates `untitled.md`, `untitled-2.md`, etc. using backend uniqueness logic.
- New folder creates `untitled folder`, `untitled folder-2`, etc. using backend uniqueness logic.
- Creation target is derived from tree selection: selected folder, parent of selected file, parent of active file, then workspace root.
- Selected folder/file state is a creation target cue and should be weaker than the active document highlight.
- After creation, the new file opens and enters inline rename mode.
- Users edit the visible document stem only. The UI does not show or require `.md`.
- The app appends/preserves `.md` internally.
- Rename is available from the file tree right-click context menu, not a hover button.
- Duplicate and Move to Trash are also context-menu actions.
- Markdown and external files can be duplicated, renamed, and moved to Trash.
- Folders can be renamed and moved to Trash; folder duplication is intentionally out of scope.
- Rename must stay inside the current directory.
- Rename rejects hidden names, path separators, `..`, and explicit non-Markdown extensions.
- Creating or renaming a document to a companion-shaped name (`*.notes.md`,
  `*.comments.md`) is rejected: those names belong to companion files.
- Move to Trash uses the operating system Trash and requires confirmation.
- A document's companion files follow it inside the same `runIliadMutation`
  (see "Companion Files"): rename and move check the document target and
  both companion names at the destination first (an unrelated
  `name.notes.md`/`name.comments.md` there is never attached), then move the
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

## Companion Files (Notes and Comments)

Each document `dir/name.md` (any Markdown extension) can have two companion
files next to it: `dir/name.notes.md` (writing notes) and
`dir/name.comments.md` (comments anchored to quoted passages). They are plain
Markdown that the writer and outside agents read and edit directly.

- A path is a companion by name shape alone (`isCompanionPath`, in
  `electron/shared/companionFiles.ts`, re-exported for main and the renderer).
  There are no companions of companions: comments and "Open notes" are
  disabled when the open file is itself a companion.
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
  a name search reveals them) as "Notes" and "Comments · N", with a context
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
- Notes: the whole `name.notes.md` is autocomplete guidance
  (`selectWritingGuidance` ranks its lines when it is long). Writing assists
  has one "Open notes" action that creates an empty file (exclusive create) if
  needed and opens it.
- Migrations: comments from the old `userData/assistant/selection-comments.json`
  move into companion files per workspace when a window attaches (merged by id;
  entries whose document is gone stay in the store, which is deleted when
  empty). Old per-document notes in `localStorage` are written to the notes
  file the first time the document opens, only if that file does not exist.

Relevant files:

- `electron/shared/companionFiles.ts`, `electron/shared/commentsFile.ts`
- `electron/fs/fileOps.ts`, `electron/ipc/files.ts`
- `electron/comments/legacyCommentsMigration.ts`
- `src/app/useSelectionComments.ts`, `src/comments/`
- `src/app/useWritingNotes.ts`, `src/notes/legacyWritingNotes.ts`
- `src/review/pendingFileTree.ts`, `src/components/FileTree.tsx`
- `src/components/DetachedCommentsBar.tsx`

## Window Chrome and Layout

The UI target is one useful top bar, not a separate macOS traffic-light bar plus a second document bar.

- `.app-topbar` is the only top row.
- The left side reserves the macOS traffic-light area.
- The active document appears once in the topbar as a simple tab/dent.
- The sidebar begins below the topbar.
- The sidebar header shows workspace name plus `+` only.
- The topbar owns compact typography, language, and focus controls.

Relevant files:

- `src/App.tsx`
- `src/components/LanguageMenu.tsx`
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
- `src/components/LanguageMenu.tsx`
- `electron/ipc/workspace.ts`
- `electron/preload.ts`
- `src/types/iliad.ts`

## Document Navigation History

The app keeps one active document, not tabs. Back/Forward history is an in-memory renderer concern for moving through recently opened Markdown documents.

- Normal file-tree Markdown opens, created Markdown files, duplicated Markdown files, and rendered internal Markdown links record the previous active document after the target opens successfully.
- Back and Forward open valid Markdown targets through the same save-before-open path as normal document navigation.
- Failed saves or failed reads must not mutate history.
- Opening a new document normally clears Forward history.
- Stale history paths are skipped only after a successful Back/Forward navigation to the next valid target.
- External files, external web/mail links, folder expansion, and same-document links do not record document history.
- History is cleared when the workspace changes or the active document is cleared.
- Do not add tabs until there is evidence the file tree plus Back/Forward history is insufficient.

Relevant files:

- `src/App.tsx`
- `src/app/useDocumentHistory.ts`
- `src/files/fileActions.ts`
- `src/styles/chrome.css`

## Review-First Agent

The agent is workspace-aware only through context that Iliad explicitly
supplies or tools that Iliad explicitly runs. The active Markdown document is
one context source, not the agent's identity. The UI may show context chips, but
it should not imply that the agent has searched the whole workspace unless the
runtime actually did so and recorded that work.

Agent edits use a two-channel contract:

- the transcript shows clean user-facing prose and transient status/thinking
  summaries;
- edit artifacts are stored as typed `AgentChangeProposal` records and rendered
  in the document-native review UI.

The renderer must not parse edits from chat text. Provider-specific transport
markers may exist inside Electron as a legacy adapter, but they must be
normalized into proposals before React renders the result.

Agent writes are always review-first:

- existing-file changes render as red/green document review blocks;
- new documents render as all-green review previews;
- users can accept/reject individual hunks where available, or accept/reject the
  whole proposal/file;
- applying an edit revalidates the base hash before writing;
- applying a new file revalidates the generated relative path and refuses
  unsafe or colliding paths;
- pending proposal state is local app data, not Markdown document content.

Distinct from the conversational agent (multi-turn, document-wide) are
**on-demand selection tools**: stateless, selection-scoped rewrites that make a
single provider call and apply review-first to exactly one range, with no
transcript turn and no proposal store. Tighten is the first (ADR-0020); its
apply uses the same exact-match-or-discard safety as anchored edits (ADR-0019).

**One AI key, and the selection decides** (`specs/2026-09-24-one-ai-key.md`).
Continuation keys never rewrite. Three direct length keys (defaults ⌘, ⌘. ⌘/,
neighbours on an English keyboard) ask for a Sentence, Paragraph, or full Idea
(until the current idea/section is complete; no headings) in one request; if a
shorter suggestion is visible they extend it, generating only the missing part.
The AI key (default ⌘↵) suggests a Sentence and each repeat extends it one
length. All four keys are configurable and kept distinct; the length keys run at
highest precedence (they outrank the corrector's ⌘. and CodeMirror's ⌘/ comment
toggle) and do nothing over a selection. Automatic suggestions stay short. With text selected the same key opens the selection AI
menu (typed instruction, or Rewrite / Expand / Shorten / Summarize / Turn into a
list); every menu action is selection-scoped (Shorten = Tighten mode, the rest
are canned Edit instructions) and lands in the inline review. Keys are shared
across both: Tab accepts (pending selection review → ghost → indentation), Esc
dismisses or rejects, ⌥↑/↓ cycles alternatives. The selection keymap is
registered before autocomplete and always consumes the key over a selection, so
the AI key can never fall through to CodeMirror's `insertBlankLine` there. The
Writing assists menu holds settings only; in-the-moment controls (Longer,
Another, Steer…) live on the suggestion toolbar.

Codex is the preferred runtime for the main workspace agent when connected.
OpenAI API-key paths remain for dictation/media, fallback text runs, and other
non-agent API features. Keep provider transport, app-server protocol handling,
retry/error mapping, request construction, prompt text, thinking-summary
sanitizing, and file-change capture separate from proposal persistence and file
mutation.

The agent tool boundary is document-native:

- allowed direction: list/read/search Markdown documents, open one visible
  workspace Markdown document in the editor through a validated, receipted,
  desktop-only navigation tool (ADR-0016), inspect explicit context, propose
  Markdown changes through one review-first contract with anchored targeted
  edits and explicit `edit_file` and `create_file` operations, ask the user,
  and run bounded document-focused workers;
- avoided direction: shell commands, package installation, arbitrary scripts,
  git operations, browser automation, system inspection, hidden workspace-wide
  upload, or non-Markdown artifact builders as core product primitives.

Assistant panel UI should stay minimal. Component extraction should preserve
existing class names and layout unless a spec explicitly changes the UX.

Codex runs write into the real workspace under a `workspace-write` sandbox.
The provider snapshots visible Markdown before the turn, writes that snapshot
to a recovery journal in `userData`, and restores every changed path after the
turn on every exit: success, failure, cancel, timeout, or app-server loss.
Cancel and timeout interrupt the turn and wait for its terminal notification
(resetting the app-server if it stays silent) before restoring. Stale journals
are recovered on the next workspace attach and become Codex proposals. See
`specs/2026-09-01-workspace-baseline-review.md`.

## Workspace Baseline and Outside Changes

Iliad keeps one accepted Markdown state per open workspace, the baseline, in
the main-process `WorkspaceBaselineService` (`electron/review/`). Disk is
compared against it whenever the watcher reports Markdown activity, and the
difference is the outside-change review ("changed outside Iliad") that the
renderer shows through the same proposal UI as assistant edits.

Rules that must hold:

- The baseline is session-scoped: captured from disk when a window attaches to
  the workspace, dropped shortly after the last window detaches.
- Every Iliad-owned Markdown write updates the baseline inside the same
  serialized operation that performs the write. Editor saves go through
  `writeMarkdownIfUnchanged`, a compare-and-swap that checks path identity and
  expected content immediately before writing. Structural file actions run
  inside `runIliadMutation`, which defers reconciliation while in flight and
  records the result.
- Watcher hints are never dropped. Markers, the Codex lease, and in-flight
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
- Every Restore uses a guarded replacement, never a truncating write: the
  current file is renamed to a hidden holding path and its bytes verified
  against the reviewed hash, the new text is written to a temp file in the
  same folder and published with a hard link (fails if anything appeared at
  the path), then the held file is removed. Any mismatch or collision leaves
  the newer file untouched, keeps the held bytes beside it, and reports
  `stale`. Restoring a deleted file creates it exclusively (`O_EXCL`).
- Keep never loads disk over a conflicted or dirty editor buffer (only the
  conflict banner's confirmed Keep discards it), Esc and Tab never act on
  outside chunks, and a conflicted buffer resumes autosave only when disk
  equals its saved text again.
- Companion files (`*.notes.md`, `*.comments.md`) are excluded everywhere in
  the baseline service: scan, classify, records, and disk-change hints.
- The renderer subscribes (`agent:external-review-changed`) and pulls once
  (`agent:get-external-review`); both carry a revision and older snapshots are
  ignored. The renderer never drives the review lifecycle.

Relevant files:

- `electron/review/workspaceBaseline.ts`
- `electron/review/externalReviewProjection.ts`
- `electron/ipc/workspace.ts`
- `electron/ipc/files.ts`
- `electron/agent/agentService.ts`
- `src/app/useAgentProposals.ts`
- `src/app/useDocumentPersistence.ts`

Relevant files:

- `electron/agent/agentService.ts`
- `electron/agent/openaiResponses.ts`
- `electron/agent/openai/`
- `electron/agent/runtime/`
- `electron/agent/proposalDrafts.ts`
- `electron/agent/proposalStore.ts`
- `electron/ipc/agent.ts`
- `electron/preload.ts`
- `src/app/useAgentProposals.ts`
- `src/assistant/useAssistantRun.ts`
- `src/components/AssistantPanel.tsx`
- `src/components/assistant/`
- `src/editor/aiReview/`
- `src/styles/assistant.css`
- `src/types/iliad.ts`

## Styles

CSS is imported through `src/styles/app.css` only. Keep imports in this order because later files intentionally layer on narrower responsibilities:

1. `base.css`
2. `chrome.css`
3. `sidebar.css`
4. `assistant.css`
5. `editor.css`
6. `visual-markdown.css`
7. `popovers.css`
8. `responsive.css`

Style ownership:

- Reset, root fonts, launch screen, and generic primary button styles live in `base.css`.
- App shell, topbar, document tab, shared icon buttons, and content grid styles live in `chrome.css`.
- Sidebar, file tree, tree selection, and inline rename styles live in `sidebar.css`.
- Editor container, empty editor state, and scroll geometry live in `editor.css`.
- CodeMirror visual Markdown classes and widgets live in `visual-markdown.css`.
- Right-side assistant panel, transcript, proposal cards, and composer styles live in `assistant.css`.
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
- `src/components/TypographyMenu.tsx`
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

Relevant files:

- `src/app/useDocumentPersistence.ts`
- `src/files/fileActions.ts`
- `electron/review/workspaceBaseline.ts`

## Where New Features Go

- App shell state and cross-feature coordination: `src/App.tsx`.
- Workspace loading and persisted workspace state: `src/app/useWorkspace.ts`.
- Autosave, dirty state, save flushing, and load/clear document state: `src/app/useDocumentPersistence.ts`.
- Agent proposal/review orchestration: `src/app/useAgentProposals.ts`.
- Assistant run state, transcript, settings, status events, and composer coordination: `src/assistant/useAssistantRun.ts` plus `src/components/assistant/`.
- File tree traversal and path relocation helpers: `src/files/fileTree.ts` and `src/files/pathUtils.ts`.
- User-facing file operations and save-before-action orchestration: `src/files/fileActions.ts`.
- Reusable UI surfaces and popovers: `src/components/`.
- CodeMirror setup and editor callbacks: `src/components/EditorPane.tsx`; the `EditorView` host and document sync: `src/editor/CodeMirrorHost.tsx`, `src/editor/documentSync.ts`.
- Editor-only helpers, image drop/paste, link path resolution, and visual Markdown behavior: `src/editor/`.
- Visual Markdown feature rules and shared decoration helpers: `src/editor/visualMarkdown/`.
- Electron file safety and workspace boundary rules: `electron/fs/pathSafety.ts`.
- Electron filesystem operations: `electron/fs/fileOps.ts`.
- Electron assistant provider, proposal storage, settings, and diagnostics: `electron/agent/` and `electron/diagnostics/`.
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
npm run build
```

Manual Electron checks still matter:

- Create a new file with `+`.
- Rename it without typing `.md`.
- Open several Markdown files repeatedly.
- Open a document with local or remote image syntax.
- Trackpad/wheel scroll a long document and confirm a native overlay scrollbar appears.

## How to Start Future Work

Future contributors should not inspect the entire codebase every time. Start here:

1. Read this file.
2. Read the latest relevant spec in `specs/`.
3. Inspect only the files listed in the relevant section above.
4. Run the verification checks.

If a change alters one of these decisions, update this document in the same change.
