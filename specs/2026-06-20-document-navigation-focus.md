# Document Navigation Focus

Date: 2026-06-20
Status: implemented

## Problem

Opening a Markdown document from the file tree can make the editor behave as if
the writer clicked into the document body. The active line reveals Markdown
source syntax immediately, so a heading like `# Launch Note Draft` appears with
the leading `#` as soon as the file opens.

That makes navigation feel like editing and breaks Iliad's clean reading
surface.

## Product Decision

Document navigation opens a document for reading. Editing begins when the writer
clicks or tabs into the editor body.

## Required Behavior

- Clicking a Markdown document in the file tree opens it without focusing the
  editor.
- The newly opened document shows visual Markdown, so heading markers such as
  `#` remain hidden.
- The editor must not show a caret after file-tree navigation.
- Clicking inside the editor body focuses CodeMirror and reveals Markdown source
  only for the active line.
- Review/diff surfaces remain governed by their own read-only/editable state.
- Content-search reveal may still focus the editor because the user explicitly
  asked to jump to text inside the document.

## Implementation Notes

- Reuse the existing CodeMirror instance; do not remount the editor on every
  document switch.
- On `file.path` change, reset visual Markdown's focus/interacted state to
  unfocused and uninteracted.
- Blur CodeMirror when switching documents so browser focus matches the visual
  state.
- Keep normal CodeMirror focus events as the way to reveal source after the user
  actually enters the editor.

## Tests

- Unit: visual Markdown can reset from focused/interacted back to inactive,
  hiding a heading marker again.
- Typecheck: app TypeScript still passes.
- Visual: opening a document by file-tree navigation shows the heading without
  the leading `#`; clicking/focusing the editor can reveal source afterward.
