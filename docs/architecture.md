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
      openaiResponsesProvider.ts
      provider.ts
    transcription.ts
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
- Move to Trash uses the operating system Trash and requires confirmation.
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

Relevant files:

- `src/app/useDocumentPersistence.ts`
- `src/files/fileActions.ts`

## Where New Features Go

- App shell state and cross-feature coordination: `src/App.tsx`.
- Workspace loading and persisted workspace state: `src/app/useWorkspace.ts`.
- Autosave, dirty state, save flushing, and load/clear document state: `src/app/useDocumentPersistence.ts`.
- Agent proposal/review orchestration: `src/app/useAgentProposals.ts`.
- Assistant run state, transcript, settings, status events, and composer coordination: `src/assistant/useAssistantRun.ts` plus `src/components/assistant/`.
- File tree traversal and path relocation helpers: `src/files/fileTree.ts` and `src/files/pathUtils.ts`.
- User-facing file operations and save-before-action orchestration: `src/files/fileActions.ts`.
- Reusable UI surfaces and popovers: `src/components/`.
- CodeMirror setup and editor callbacks: `src/components/EditorPane.tsx`.
- Editor-only helpers, image drop/paste, link path resolution, and visual Markdown behavior: `src/editor/`.
- Visual Markdown feature rules and shared decoration helpers: `src/editor/visualMarkdown/`.
- Electron file safety and workspace boundary rules: `electron/fs/pathSafety.ts`.
- Electron filesystem operations: `electron/fs/fileOps.ts`.
- Electron assistant provider, proposal storage, settings, and diagnostics: `electron/agent/` and `electron/diagnostics/`.
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
