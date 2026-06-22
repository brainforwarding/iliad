# Review Target Auto-Selection Guard

## Problem

When a pending external review contains a mix of edited, created, and deleted files, Iliad can jump back from a manually selected created or deleted review item to the previously active edited file.

Observed sequence:

1. The user opens an edited file, such as `writing-assists/tighten-this.md`.
2. The user clicks a pending created or deleted file in the file tree, such as `workspace/random-jottings.md`.
3. Iliad sets the review target correctly for the clicked item.
4. The editor's active file is still the previous edited file because created/deleted pending review items may not become the active editor file.
5. The external-capture auto-selection loop sees that the active editor file has a pending review and reselects it.

The visible result is that two file-tree rows can appear selected: the clicked pending item and the previously active edited file.

## Decision

External-capture active-file auto-selection has three outcomes:

- `allow`: no valid review target is active, so Iliad may auto-select the changed active editor file.
- `noop_same_target`: the active editor file is already the active review target, so no selection is needed.
- `block_different_target`: a different valid review target is active, so auto-selection must not override it.

That auto-selection exists to make newly captured outside edits convenient when the user is not already reviewing anything. It must not override an explicit user review selection.

## Requirements

- Keep automatic active-file targeting when a new external capture arrives and no review target is active.
- Do not reselect the active editor file when a different review target is already active.
- Base the decision on the latest active review target at the moment auto-selection would occur, not a stale async callback closure.
- Treat only valid/current review targets as active. Stale, applied, rejected, or unresolved targets must not block auto-selection.
- Log the suppressed auto-selection so future diagnostics show that the guard fired.
- Do not change accept/reject semantics.
- Do not change how pending created or deleted files are rendered.

## Tests

- Unit-test the auto-selection policy:
  - no active review target: `allow`
  - same active review target: `noop_same_target`
  - different active review target: `block_different_target`
  - different active review target where the selected target is a created/deleted file and the active editor file has an edit target: `block_different_target`
- Existing review action tests should continue passing.
