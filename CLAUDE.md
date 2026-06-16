# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev         # Vite + electron main watch + electron launch (all in one)
npm run build       # tsc -b && vite build && tsc -p electron/tsconfig.json
npm run typecheck   # tsc -b && tsc -p electron/tsconfig.json --noEmit
npm test            # vitest run — the full suite lives in tests/
npm run lint:css    # stylelint src/styles/**/*.css (design-token enforcement)
npm run release:refresh-update-metadata # refresh latest-mac.yml hashes after final artifact stapling/copying
npm run release:verify-update-metadata # verify latest-mac.yml and app-update.yml before GitHub release upload
npm run preview     # vite preview on 127.0.0.1 (renderer only, no Electron)
```

Run a single test file or pattern with vitest directly:

```bash
npx vitest run tests/agent/tighten.test.ts   # one file
npx vitest run -t "applies anchored edit"     # tests matching a name
npx vitest                                     # watch mode
```

Local CLI workspace launches are exercised with `npm run build`, `npm link`, then `iliad .` from a target folder.

The Telegram relay is a separate Cloudflare Worker package under `relay/telegram/`; check it with `npm run relay:typecheck` and `npm run relay:test`. `npm run smoke:review` exercises the agent review-diff path headlessly.

After meaningful changes, run `npm run typecheck`, `npm test`, and `npm run build`, then verify in the Electron app (see "Manual checks" in `docs/architecture.md`).

For release/build work, read `docs/release.md` before packaging. Update-aware
releases are not valid unless `npm run release:verify-update-metadata` passes in
the release worktree after final artifacts are rebuilt from the notarized app.
After stapling the DMG and copying artifacts to the filenames referenced by
`latest-mac.yml`, run `npm run release:refresh-update-metadata`, then run
`npm run release:verify-update-metadata`. The verifier checks that
`release/latest-mac.yml` matches the package version, the actual updater
filenames, sizes, hashes, and the packaged `app-update.yml`. Upload the exact
files referenced by `latest-mac.yml` to the GitHub release alongside the DMG
installer; URL-safe duplicate filenames are allowed only as extra assets.

## Architecture

Iliad is a local-first Markdown writing workspace built as an Electron desktop app. It is a two-process app with a strict IPC contract:

- **Main process** (`electron/`) — owns the file system, workspace dialog, custom protocol, and all file/folder mutation. `electron/main.ts` should stay thin: app lifecycle, protocol setup, IPC registration, and window creation only. Enforcement lives under `electron/fs/`: hidden paths, path traversal, Markdown-only read/write/rename, and URL restrictions are rechecked here, not just in the renderer. Workspaces are registered in `electron/fs/workspaceRegistry.ts`; `iliad-file://` will only serve files inside those roots.
- **Preload** (`electron/preload.ts`) — exposes the IPC surface as `window.iliad` via `contextBridge`. This is the only bridge; `nodeIntegration` is off and `contextIsolation` is on.
- **Renderer** (`src/`) — React 18 + Vite + CodeMirror 6. `src/App.tsx` is a composition layer. Workspace state belongs in `src/app/useWorkspace.ts`, document persistence in `src/app/useDocumentPersistence.ts`, file orchestration in `src/files/fileActions.ts`, tree/path helpers in `src/files/`, and local display preferences in `src/preferences/`.
- **IPC contract** — the full renderer-facing API is typed in `src/types/iliad.ts`. When changing IPC, update the handler under `electron/ipc/`, the preload exposure in `electron/preload.ts`, and `src/types/iliad.ts` (`IliadApi`) together.
- **Review-first agent** — a right-side assistant proposes Markdown edits and new documents without persisting model-authored changes until the user approves. The provider/runtime layer lives in `electron/agent/` (Codex is the preferred main runtime; OpenAI API keys cover dictation/media/fallback), proposals and selection-scoped tools (e.g. Tighten) are stored as typed records, and the renderer renders them through the document-native review UI (`src/assistant/`, `src/components/assistant/`, `src/editor/aiReview/`). The renderer must never parse edits from chat text. **Read `docs/agent-vision.md` and the "Review-First Agent" section of `docs/architecture.md` before touching agent, context, proposal, or runtime code.**
- **App language** — the chrome is bilingual (English/Spanish) via `src/i18n/`. This is a display preference only; it must never translate Markdown content, file names, workspace names, or filesystem error details.

The codebase grew well past a basic editor: it now includes the agent subsystem, document content/file-tree search, a writing corrector, voice dictation, selection comments, document navigation history, and a Telegram remote relay. `docs/architecture.md` is the authoritative, current map — prefer it over inferring structure from these summaries.

### Feature placement

Do not put new feature logic back into the old hotspot files. Use the owner modules:

- App shell state and cross-feature wiring: `src/App.tsx`.
- Workspace loading and persistence: `src/app/useWorkspace.ts`.
- CLI launch workspace bootstrap: `bin/iliad.mjs`, `electron/launch/`, workspace IPC/window management, `electron/preload.ts`, `src/types/iliad.ts`, and `src/app/useWorkspace.ts` must stay in sync. The renderer must ask `getLaunchWorkspace()` before falling back to the persisted workspace, and directory reads are request-tagged so stale reads cannot reassign a window to an old workspace.
- Autosave, dirty state, save flushing, and load/clear document state: `src/app/useDocumentPersistence.ts`.
- User-facing file operations and save-before-action orchestration: `src/files/fileActions.ts`.
- File tree traversal/path relocation helpers: `src/files/fileTree.ts` and `src/files/pathUtils.ts`.
- Agent proposal/review orchestration: `src/app/useAgentProposals.ts`; assistant run state, transcript, and composer: `src/assistant/useAssistantRun.ts` plus `src/components/assistant/`.
- Agent provider/runtime, proposal storage, and on-demand selection tools: `electron/agent/`; agent/search/remote IPC: `electron/ipc/`.
- Document navigation (Back/Forward) history: `src/app/useDocumentHistory.ts`.
- App-language strings and persistence: `src/i18n/`.
- Reusable UI surfaces and popovers: `src/components/`.
- CodeMirror setup and editor callbacks: `src/components/EditorPane.tsx`.
- Editor-only helpers, image drop/paste, path resolution, and visual Markdown behavior: `src/editor/`.
- Visual Markdown rules and shared decoration helpers: `src/editor/visualMarkdown/`.
- Electron filesystem safety and operations: `electron/fs/`.
- IPC handler groups: `electron/ipc/`.
- Styles: add rules to the responsibility-specific file under `src/styles/`; keep `src/styles/app.css` as imports only and keep responsive rules last.
- Design tokens: every colour/rgba lives only in `src/styles/tokens.css` (the single source of truth, named by role); raw hex/rgba/hsl anywhere else is a lint error (`npm run lint:css`). `font-family` must be `var(--font-*)`; `font-size` must be a `var(--text-*)`/`var(--serif-*)` token (or `em`/`clamp` for relative/prose); `font-weight` is limited to 400/500/600/700. To add a value, add a *semantic* token first — never a one-off. `owl-lab/design-system.html` links `tokens.css`, so it stays in sync automatically.

### Editor surface

- `src/components/EditorPane.tsx` mounts CodeMirror inside `.editor-surface`. **`.editor-surface` is the scroll owner**, not `.cm-scroller` — this is deliberate (see `docs/architecture.md` "Editor Scroll"). Do not add wheel handlers or move scrolling back into CodeMirror without first inspecting actual DOM geometry.
- `src/editor/visualMarkdown.ts` re-exports the visual Markdown extension for compatibility. The implementation lives in `src/editor/visualMarkdown/`. It hides syntax on inactive lines and renders restrained widgets (links, images, tables) on inactive lines only. **Inline decorations only** — block decorations from a `ViewPlugin` throw `RangeError` in CodeMirror, so images and tables are inline widgets. Decoration building is defensive and must fall back to no decorations rather than crash the editor (`EditorErrorBoundary` is the last line of defense).
- `src/editor/imageDropPaste.ts` handles drag/paste of images. Assets are routed through the main process and saved to `assets/<document-slug>/`. The renderer never writes files directly.

### Save model

Autosave is part of the writing contract. Before opening another file, switching workspaces, creating a file/folder, renaming, duplicating, or moving an item to Trash, the renderer flushes pending saves through `src/app/useDocumentPersistence.ts` and `src/files/fileActions.ts`. **If a save fails, do not let navigation or file actions proceed** — silently swallowing save errors loses user content.

### Workspace persistence

The renderer persists the last workspace and editor typography (`editorFontSize`, `editorFontPreset`) in `localStorage`. These are display preferences and must never be written into the user's Markdown files.

## Where decisions live

- `docs/source-as-contract.md` — product lens for feature decisions: the on-disk Markdown file is the contract.
- `docs/agent-vision.md` — the Markdown-first product boundary for agent work. Read before changing agent, context, proposal, or runtime architecture.
- `docs/architecture.md` — stable product and code decisions. **Read this before making non-trivial changes.** If a change intentionally alters one of those decisions, update the doc in the same change.
- `specs/` — dated, per-change plans (one file per change). Look here for the rationale behind recent UI/UX moves.

## Product constraints to respect

The editing surface is intentionally minimal and the agent is intentionally Markdown-first. Per `docs/architecture.md` and `docs/agent-vision.md`:

- Keep the writing surface calm: typography lives in one compact popover (not the topbar), and there are no tabs — the file tree plus Back/Forward history is the navigation model. Don't add tabs, command palettes, or broad secondary navigation without evidence the current model is insufficient.
- The agent is a Markdown workspace collaborator, not a general computer/coding agent. Allowed: list/read/search Markdown, open one visible document, propose review-first edits and new Markdown documents. Avoided as core primitives: direct AI writes (no approval), shell/git/package/browser automation, whole-workspace upload, and non-Markdown artifact builders.
- Every UI feature should keep the on-disk Markdown file easy to inspect, edit elsewhere, and recover (`docs/source-as-contract.md`). Display preferences (language, typography, pending proposals) are local app data and must never be written into the user's Markdown.
