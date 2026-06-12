# Window Chrome, Sidebar Controls, And Editor Scroll Fix

## Problem

In the desktop prototype, three UI bugs are blocking basic use:

1. On macOS windowed mode, native traffic-light controls overlap the workspace/folder name.
2. Sidebar header actions are unreliable: the `+` button is unclear or appears to do nothing, and the adjacent rename/action button can be clipped and unresponsive.
3. Open Markdown documents do not scroll reliably with the wheel or arrow keys.

These are product-quality bugs, not broad redesign work.

## Goals

- Reserve correct space for macOS window controls in the sidebar/header area when using custom titlebar styling.
- Make sidebar actions visible, clickable, and semantically correct:
  - `+` creates a new Markdown file.
  - rename/edit is only enabled when a Markdown file is selected.
  - open-folder action remains accessible and not clipped.
- Ensure the Markdown editor owns its own scroll container and supports normal wheel/trackpad scrolling.
- Ensure keyboard navigation can move through the document without the page layout swallowing scroll.
- Keep the existing minimal visual direction; do not redesign the whole app.

## Non-Goals

- No tab system.
- No Obsidian-style navigation rail.
- No file-extension display redesign beyond what is needed for the bugfix.
- No syntax-tree rewrite for visual Markdown.
- No AI, search, Git, publishing, or export work.

## UX Requirements

- In windowed macOS mode, the left header starts after the traffic-light control area.
- The clickable action area must not be inside a draggable titlebar region.
- Buttons must have stable 30-32px hit targets.
- Disabled actions must look disabled and not prompt unexpectedly.
- The top-level app should not scroll; only the file tree and editor scroller should scroll.
- The rename action must be disabled with a real `disabled` attribute unless the active file is a Markdown document.
- Header action controls must remain clickable and must not be part of the draggable titlebar region.

## Implementation Plan

- Electron main:
  - Keep `titleBarStyle: hiddenInset` for now.
  - Keep `trafficLightPosition` aligned with the CSS-reserved traffic-light area.
- Sidebar:
  - Pass selected Markdown state into `FileTree` as `canRename`.
  - Add explicit disabled state for rename when no Markdown file is active.
  - Guard `renameActiveFile` with `activeFile?.kind === "markdown"`.
  - Use a header grid that reserves macOS traffic-light width, lets the workspace label shrink, and keeps the action group fixed-width.
  - Ensure header action row is `-webkit-app-region: no-drag`.
  - Ensure sidebar header reserves macOS traffic-light width.
- Editor:
  - Constrain `.editor-surface`, UIW wrapper, `.cm-editor`, and `.cm-scroller` to viewport height.
  - Set `.cm-scroller` to `overflow: auto`.
  - Only `.cm-scroller` should be scrollable; parent containers should not grow beyond the viewport.
  - Remove only accidental editor border artifacts; preserve keyboard-accessible focus behavior.

## Required Checks

- `npm run typecheck`
- `npm run build`
- `npm audit --audit-level=high`
- Dev startup smoke test with `npm run dev`
- Manual check:
  - native controls do not overlap the folder name
  - `+` creates a Markdown file
  - rename button is visible and disabled unless a Markdown document is selected
  - rename works when a Markdown document is selected
  - editor scrolls with mouse/trackpad and keyboard navigation
  - bottom of a long document is reachable

## Assumptions

- We are not creating a Git worktree because this repo is not currently a Git repo and the user explicitly requested no worktree.
- This spec intentionally avoids matching Obsidian feature-for-feature; it only addresses the three reported defects.
