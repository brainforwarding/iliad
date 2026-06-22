# Review Render Diagnostics And Delete Notes

## Problem

Recent internal-agent review testing exposed three separate behaviors that can look
like one failure:

- review rendering can crash with `Invalid range for replacement decoration`;
- Codex protocol events can say file deletion is unsupported even when disk
  reconciliation successfully turns the deletion into a reviewable pending
  delete;
- renderer crashes currently appear in the UI but not in the JSONL diagnostics
  log, making live testing harder to diagnose.

## Diagnosis

The render crash is most likely caused by the collapsed one-line replacement path
in `aiReviewExtension`. That path replaces a source line with a widget and also
adds a CodeMirror line decoration to the same line. The widget already applies the
review source classes, so the line decoration is redundant and risks violating
CodeMirror replacement-decoration constraints.

The delete note is a message mismatch. The Codex protocol converter cannot
represent delete operations directly, but disk reconciliation can and does create
a `delete_file` proposal from the before/after workspace snapshot. Once disk
reconciliation recovers the same path, the unsupported protocol note should not
be shown to the user.

The empty deleted-file preview is expected when the deleted file's captured
`baseContent` is empty.

## Decision

- Collapsed one-line replacement widgets own their source Markdown typography.
  Do not add a second line decoration to the replaced line.
- Keep disk-reconciled delete proposals as the supported review path for agent
  deletes.
- Suppress unsupported-delete notes for paths recovered by disk reconciliation.
- Log renderer editor crashes through the existing diagnostics JSONL pipeline.

## Tests

- `aiReviewExtension` should not attach line decorations to collapsed replacement
  hunks; the replacement widget must still carry source-visible Markdown classes.
- Codex capture should produce a delete draft and no unsupported note when a
  protocol delete is recovered by disk reconciliation.
- Existing create/delete/edit source Markdown styling tests continue to pass.

## Manual Check

Ask the internal agent to:

1. edit an existing Markdown document;
2. create a new Markdown document;
3. delete an explicitly named Markdown document;
4. empty a Markdown document.

Expected result: each pending item can be opened without render crashes, accepted
or rejected, and no misleading unsupported-delete note appears when the delete is
reviewable.
