# Review Action Language

## Problem

The review UI had drifted into multiple vocabularies for the same decision:

- the sidebar used `Accept all` / `Reject all`;
- edit reviews used `Accept changes` / `Reject changes`;
- external edit reviews used `Keep changes` / `Restore previous version`;
- external created files used `Keep file` / `Move to Trash`;
- external deleted files used `Confirm deletion` / `Restore file`.

Those labels are technically accurate, but they make the user re-interpret the same review decision depending on file kind. They also make the editor toolbar feel different from the file tree controls even though both are operating on pending review state.

## Decision

Use review-language for buttons and context-language for headers.

- The sidebar bulk controls remain `Accept all` and `Reject all`.
- The editor toolbar controls are always file-scoped:
  - `Accept changes`
  - `Reject changes`
- The toolbar header keeps the filesystem context:
  - `path.md · 3 changes`
  - `Pending document: path.md`
  - `Pending delete: path.md`

This keeps the decision model stable:

- accepting a proposed new file means keep the new file;
- rejecting a proposed new file means remove it;
- accepting a proposed deletion means keep the deletion;
- rejecting a proposed deletion means restore the file;
- accepting an edit means keep the edit;
- rejecting an edit means restore the previous text.

## Non-goals

- Do not remove the existing debug logs for review navigation.
- Do not reintroduce a `Review` button that changes the active file.
- Do not auto-advance to the next review item after accepting or rejecting one file.

## Required Tests

- Unit test the editor review action label helper for edit, create, and delete review modes.
- Keep the file tree pending strip tests asserting `Accept all` and `Reject all`.
- Keep assistant pending proposal card tests asserting proposal-level `Accept all` and `Reject all` behavior.
- Run the focused review/navigation tests and the full test suite before shipping.
