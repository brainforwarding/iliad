# App Translation

## Problem

Iliad's app UI is currently hard-coded in English. Users should be able to switch the app chrome between English and Spanish without changing Markdown document content.

## Product Intent

Translate the application interface, not the user's documents. The setting should feel like a normal app preference: persistent, local to the machine, and immediately reflected in visible controls.

## Goals

- Support English and Spanish UI strings.
- Persist the selected language in `localStorage`.
- Default to Spanish when the system/browser locale starts with `es`; otherwise default to English.
- Add a compact topbar language control with English and Spanish choices.
- Translate current app chrome and feedback:
  - launch screen and open-folder button
  - topbar button titles, history tooltips, save status, focus mode
  - sidebar create buttons and empty state
  - file tree rename aria label
  - file context menu actions
  - typography menu labels and font preset labels
  - editor empty and editor crash states
  - toasts, notices, confirmation prompts, and renderer fallback errors
  - visual widget fallback labels where they are app-authored
  - native open-folder dialog title
- Keep internal state semantic; translated display text must not become application state.
- Keep the implementation small and dependency-free.
- Document the i18n ownership and string coverage.

## Non-Goals

- No AI/document translation.
- No translation of Markdown file contents, workspace names, file names, paths, document titles, or user-authored text.
- No large settings screen in this change.
- No pluralization, ICU messages, date/time localization beyond the browser's existing time formatting.
- No full Electron/main-process error-code refactor. Stable renderer messages should be translated; raw OS or filesystem errors may remain in their source language for now.

## UX Flow

- The topbar actions include a language button near typography/focus controls.
- Activating the language button opens a small popover with `English` and `Español`.
- The active language is visibly selected and uses `aria-pressed`.
- Selecting a language updates UI text immediately and stores the preference.
- The control uses the same compact popover style as the typography menu.
- Workspace names, file names, document tab labels, document text, image paths, and OS/file-system error details are never translated.

## Architecture

- Add `src/i18n/` with:
  - language type and preference helpers
  - translation dictionaries
  - a hook returning `{ language, setLanguage, t }`
- App owns the language preference and passes small label/message objects into presentational components and hooks. Components should not import a global singleton translator.
- Hooks should receive concrete message helpers for renderer-authored fallback messages, not a broad translator where avoidable.
- Convert `SaveStatus` from English display strings to semantic values: `saved`, `saving`, `unsaved`, and `error`. App translates those values only at render time.
- Fallback error rule:
  - If an error is an `Error`, preserve and display `error.message` as-is because it may contain OS/file-system context.
  - If an unknown thrown value has no message, use the localized renderer fallback for that operation.
  - Renderer-authored notices and confirmations use localized message helpers with interpolation.
- Native dialog title receives the current language as a small IPC argument.
- The Electron IPC handler validates the requested language. Missing or unsupported values fall back to English.
- Main-process filesystem safety messages remain as source messages for this pass unless they are renderer-authored fallbacks.

## Data, API, And Permissions

- New localStorage key: `iliad:app-language`.
- Update `window.iliad.openWorkspaceDialog(language)` so the renderer can request a localized dialog title.
- The language argument is validated in main; unsupported values use the English dialog title.
- No filesystem schema changes.
- No network changes.

## Implementation Plan

- Create `src/i18n/appLanguage.ts` and `src/i18n/strings.ts`.
- Create `src/components/LanguageMenu.tsx`.
- Add popover styles in `src/styles/popovers.css`.
- Thread labels into `App`, `FileTree`, `TreeContextMenu`, `TypographyMenu`, `EditorPane`, and `EditorErrorBoundary`.
- Translate renderer-owned messages in `useWorkspace`, `useDocumentPersistence`, and `useFileActions` by passing narrow message helpers from App.
- Update `src/editor/visualMarkdown/widgets.ts` for translated fallback aria/title labels where needed.
- Convert save status comparisons to semantic values before translating visible labels.
- Update `electron/preload.ts`, `electron/ipc/workspace.ts`, and `src/types/iliad.ts` for the localized open-folder dialog title.
- Update README and architecture docs.

## Required Tests

- `npm run typecheck`
- `npm run build`
- `npm audit --audit-level=high`
- Manual/source review:
  - first run defaults to Spanish for `navigator.language` starting with `es`, otherwise English
  - language choice persists in localStorage
  - switching language updates visible labels without reloading
  - Markdown document text is unchanged
  - workspace names, file names, document titles, image relative paths, and OS error details remain literal
  - save status logic uses semantic status values, not translated strings
  - aria labels and titles are covered for topbar, sidebar, typography, language, tree rename, and task checkbox controls
  - native folder picker title accepts the current language argument

## Open Questions

- None for this first pass. A full settings surface can absorb the language control later.
