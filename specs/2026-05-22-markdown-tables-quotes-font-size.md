# Markdown Tables, Blockquotes, And Reading Size Controls

## Problem

The editor is meant to feel like a calm visual Markdown writing surface, but several common Markdown constructs still show raw syntax in inactive text:

1. Markdown tables render as plain pipe-delimited text, which is hard to scan and does not match the rest of the visual editing direction.
2. Blockquotes keep the leading `>` marker visible even when the line is inactive.
3. There is no quiet way to change displayed typography, so users cannot quickly make the document more readable or switch between a long-form, clean sans, or technical monospace feel.

These issues are editor-polish work. They should improve writing comfort without broadening the app into a full preview renderer.

## Goals

- Render simple pipe tables visually when the cursor is outside the table row.
- Keep raw Markdown visible on the active table row so editing remains direct and predictable.
- Keep table rows compact enough for scanning while preserving a quiet document-table rhythm.
- Hide the leading blockquote marker on inactive blockquote lines while preserving the quote styling.
- Make inactive Markdown links directly clickable while active lines remain raw/editable.
- Add one compact typography popover for editor display controls.
- Let users adjust editor font size from that popover.
- Let users choose one of a few curated font presets: Serif, Sans, Mono.
- Make document headings follow the selected editor font preset.
- Keep the main topbar minimal; do not add persistent `A-` / `A+` toolbar buttons.
- Persist selected editor font size and font preset locally for the app window.
- Preserve native document scrolling and existing file/edit/save behavior.
- Keep the visual Markdown layer defensive so decoration failures do not blank the app.

## Non-Goals

- No full Markdown preview pane.
- No table authoring toolbar, row/column insertion, CSV import, or spreadsheet behavior.
- No advanced GitHub Flavored Markdown table alignment UI beyond basic left/center/right text alignment from the separator row.
- No arbitrary font picker, theme settings, color settings, or full preferences panel.
- No changes to file format, autosave, image storage, or workspace model.
- No AI, search, outline, export, or diff review work.

## UX Requirements

### Tables

- A valid table block is a header row followed immediately by a separator row.
- Rows use pipe syntax, for example:

  ```markdown
  | Criterio | Descripcion |
  | --- | --- |
  | Claridad | El material se entiende sin explicacion adicional. |
  ```

- Inactive table rows render as quiet ruled document tables with restrained horizontal rules and readable spacing.
- The separator row should not appear as literal `|---|---|` text when inactive.
- If the cursor is inside a table row, that row remains raw Markdown.
- If the table syntax is incomplete or malformed, leave it as plain text rather than guessing.
- Tables should fit within the existing document column and scroll horizontally only when they genuinely overflow.
- Header and body cells should align by sharing one computed column template across the table block.
- Tables should not look like stacked rounded cards or a spreadsheet UI.
- Table row spacing should stay compact; do not increase the global editor line height to solve table spacing.

### Blockquotes

- Inactive blockquote lines hide the leading `>` and optional following space.
- Active blockquote lines show the raw marker for editing.
- Existing quote styling stays minimal: left rule, slightly muted text, no decorative card.

### Links

- Inactive Markdown links render as the visible link label only.
- Hovering the visible link shows a pointer cursor and a subtle color shift.
- Clicking directly on the visible link opens it.
- Clicking elsewhere on the line reveals/edits the raw Markdown.
- Web and mail links open externally.
- Resolved Markdown links inside the workspace open inside Iliad.
- Other local relative links open through the operating system when possible.

### Typography Controls

- The topbar gains one compact typography/view button, using an `Aa` / `Type`-style icon from the existing icon library.
- Activating it opens a small popover near the button.
- The popover contains editor display controls only:
  - font size decrement
  - current font size value
  - font size increment
  - font preset selector: Serif, Sans, Mono
  - reset to default
- Controls affect editor display only, not the Markdown file.
- Size and preset changes apply immediately.
- Font size is clamped to a readable range so the layout does not break.
- Settings are persisted in `localStorage`.
- Do not add always-visible `A-` / `A+` buttons, search, bookmarks, more tabs, settings panels, or unrelated topbar actions.

## Implementation Plan

### Visual Markdown

- Extend `src/editor/visualMarkdown.ts` with a small table parser:
  - scan document lines for table blocks
  - require a separator row after a header row
  - parse cells by trimming optional outer pipes
  - parse separator alignment markers
  - include subsequent table-looking rows until the block ends
- For inactive table rows:
  - replace the full row text with an inline table-row widget
  - mark separator lines with a collapsible line class so the raw separator does not consume visible reading space
  - use consistent per-column widths across the table block
- Leave active table rows undecorated so Markdown syntax is visible while editing.
- Keep blocked-range safety so inline emphasis/link/image decorations do not overlap table replacement ranges.
- Continue wrapping decoration building in the existing safe fallback.
- Render inactive links with inline widgets, not global editor click handlers.

### Editor Typography

- Add `editorFontSize` state in `src/App.tsx`.
- Add `editorFontPreset` state in `src/App.tsx`.
- Read/write both values from `localStorage`.
- Clamp values, initially `17px`, with a practical range such as `14px` to `24px`.
- Pass `editorFontSize` and `editorFontPreset` into `EditorPane`.
- Build the CodeMirror theme from those values so the editor updates immediately.
- Use editor typography variables so headings and body text both respond to the selected preset.
- Add one topbar typography button that opens a compact popover.
- Use curated font stacks:
  - Serif: long-form writing, default
  - Sans: clean product/document writing
  - Mono: technical or code-heavy notes

### Styling

- Add CSS classes for:
  - visual table row/cell widgets
  - collapsed table separator lines
  - typography popover
  - font preset segmented control
- Keep borders subtle and avoid a heavy spreadsheet or rounded-card look.
- Avoid large layout jumps when entering or leaving a visual table row.
- Preserve the current app palette and document column.

## Data, API, And Security

- No Electron IPC changes.
- No filesystem write changes except normal Markdown autosave when the user edits content.
- `localStorage` stores only a numeric editor font size and a small font preset key.
- No external network or remote data changes.

## Verification

- `npm run typecheck`
- `npm run build`
- Manual Electron checks:
  - A simple Markdown table renders visually when inactive.
  - Clicking into a table row reveals the raw Markdown row for editing.
  - The separator row does not show as `|---|---|` while inactive.
  - Blockquote `>` markers hide on inactive lines and reappear on the active line.
  - Typography popover opens and closes predictably.
  - Font size decrease/increase controls work immediately inside the popover.
  - Serif, Sans, and Mono presets apply immediately inside the editor.
  - Font size and preset survive app reload.
  - Long documents still scroll with trackpad/wheel and show the native overlay scrollbar.
  - Opening several Markdown files repeatedly does not blank the app.

## Assumptions

- This directory is not a Git repository, so the requested workflow's worktree/branch step cannot be performed here.
- The current visual Markdown architecture remains the right short-term choice.
- Row-level table rendering is sufficient for this milestone; full block-level Markdown rendering would be a separate architectural decision.
