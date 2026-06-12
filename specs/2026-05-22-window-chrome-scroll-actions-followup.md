# Window Chrome Separation, Sidebar Actions, And Mouse Scroll Follow-Up

## Problem

The previous patch improved some source-level issues but did not fix the product experience:

1. macOS traffic-light controls still sit on the same horizontal line as sidebar content. The folder/workspace name can appear under or beside the native controls.
2. Sidebar action buttons are confusing and unreliable:
   - The `+` action appears clickable but the user reports no observable result.
   - The edit/rename action appears disabled or clipped, and its purpose is unclear.
3. Markdown documents now move with keyboard/cursor navigation, but mouse/trackpad scrolling still does not work reliably.
4. The file tree still shows folder disclosure chevrons (`>`), which the user does not want. Indentation is enough to communicate hierarchy.
5. The document topbar repeats the document title and filename, and shows word count. The user wants a single subtle filename and no word count.

## Goals

- Separate native macOS window controls from app content with a dedicated top chrome strip.
- Ensure sidebar content begins below the macOS controls, not beside them.
- Make sidebar actions reliable and understandable:
  - `+` creates a new Markdown file and opens it.
  - rename is available only when a Markdown file is active; otherwise it should not present as a dead button.
  - open-folder action remains visible and clickable.
- Remove visible disclosure chevrons from the file tree while preserving click-to-expand/collapse for folders.
- Make mouse/trackpad wheel scrolling work inside the Markdown editor.
- Simplify document topbar to show only one filename label and no word count.

## Non-Goals

- No Obsidian-style tab system.
- No full Antigravity-style project/chat landing page.
- No large sidebar redesign or navigation rail.
- No context menus.
- No visual Markdown parser rewrite.
- No AI assistant work.

## UX Requirements

- The first row of the app is a dedicated draggable window chrome strip with no sidebar file content inside it.
- In windowed macOS mode, the traffic-light controls appear only over this strip.
- The sidebar starts below the strip, with normal left padding.
- The file tree uses indentation and folder icons for hierarchy; no `>` / disclosure glyphs are rendered.
- Sidebar action controls are outside draggable regions.
- `+` should produce an observable result: after entering a filename, the new Markdown file appears and opens.
- Rename should not look broken when no Markdown document is selected. Prefer hiding it until there is an active Markdown file, or otherwise make it clearly unavailable.
- Editor wheel/trackpad scrolling must scroll the CodeMirror scroll container, not the whole app.
- The document topbar shows one filename-style label. Do not show both bold title and extension subtitle. Do not show word count.

## Implementation Plan

- App layout:
  - Add a `window-chrome` element as the first row of `.app-shell`.
  - Change `.app-shell` to a two-row grid: chrome row + content row.
  - Put sidebar/editor in the content row.
  - Remove traffic-light padding hacks from `.sidebar-header` and `.document-topbar`.
- Sidebar:
  - Remove visible chevron markup/column from `TreeRow`.
  - Preserve folder expand/collapse when clicking the folder row.
  - Keep depth indentation based on `--tree-depth`, but reduce the base left offset now that the chevron column is gone.
  - Render rename only when `canRename` is true, or make it visually and semantically unavailable without occupying broken-looking space.
  - Ensure sidebar actions use `-webkit-app-region: no-drag`.
- Editor:
  - Simplify `EditorPane` title rendering to one filename label.
  - Remove word count from the topbar.
  - Add a CodeMirror wheel handler that manually scrolls `view.scrollDOM` for ordinary wheel/trackpad events, ignoring modified wheel gestures like pinch/zoom.
  - Keep `.cm-scroller` as the only scrollable editor element.

## Required Checks

- `npm run typecheck`
- `npm run build`
- `npm audit --audit-level=high`
- `npm run dev` startup smoke test after restarting Electron
- Manual checks in the Electron app:
  - macOS controls are isolated in the top strip
  - sidebar content begins below the controls
  - `+` opens the create-file prompt and opens the new file after creation
  - rename appears/works only for an active Markdown file
  - folder rows expand/collapse without visible chevrons
  - wheel/trackpad scroll works over the document
  - document topbar shows one filename label and no word count

## Assumptions

- This work happens in-place because the user explicitly requested no worktree and this directory is not a Git repository.
- We are optimizing for a clean windowed macOS layout first. Fullscreen polish can come later.
