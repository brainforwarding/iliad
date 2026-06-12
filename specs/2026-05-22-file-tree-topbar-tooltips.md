# File Tree, Topbar Alignment, and Tooltips

## Problem

The app currently auto-expands the first directories in the file tree when a workspace opens. This makes the initial state feel unpredictable and exposes arbitrary folders before the user asks for them. The titlebar icon buttons also sit low relative to the active document tab and native window controls. Icon-only buttons rely on native browser `title` behavior, which is inconsistent and not visually aligned with the app.

## Goals

- Open every workspace with all folders collapsed.
- Keep intentional reveal behavior: when the app needs to reveal a newly created or navigated item, its containing folder may open.
- Vertically center titlebar icon buttons within the tab/titlebar rhythm.
- Add subtle localized tooltips for icon-only app controls:
  - sidebar toggle
  - back
  - forward
  - typography
  - language
  - focus mode
  - new document
  - new folder

## Non-Goals

- Do not persist expanded/collapsed tree state in this pass.
- Do not add a full settings panel.
- Do not change document tabs, file navigation, or Markdown rendering.
- Do not add tooltips to every tree row or document element.

## UX

- On app launch or workspace switch, the file tree starts collapsed.
- Clicking a folder toggles that folder only.
- Creating or revealing a document may expand the required folder.
- Hovering an icon-only control shows a compact tooltip after a short delay.
- Tooltip text follows the current app language.
- Tooltip styling is quiet and should not compete with the titlebar.

## Implementation

- Remove the default `visibleDirectoryPaths(...).slice(0, 8)` expansion behavior from `FileTree`.
- Keep the existing `revealPath` expansion effect.
- Replace native `title` tooltips on the targeted icon-only buttons with `data-tooltip` plus `aria-label`.
- Add shared CSS for `.icon-button[data-tooltip]`.
- Center `.topbar-navigation` and `.topbar-actions` inside the topbar editor zone.

## Verification

- `npm run typecheck`
- `npm run build`
- `git diff --check`
- Manual source review that all tooltip strings are already localized through existing English/Spanish dictionaries.
