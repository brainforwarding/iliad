# Internal Agent Review Workflow

Date: 2026-06-21
Status: active working note

This file is the durable handoff for the current Iliad workstream. If context
compacts, read this file first, then read the active spec:

- `specs/2026-06-21-internal-agent-review-integrity.md`

## Goal

Make Iliad's internal assistant review flow reliable again without regressing
the live external filesystem review flow.

The finished state must satisfy both models:

- Internal assistant proposals are persisted review artifacts. They may support
  hunk-level accept/reject, survive panel close/reopen, and are tied to the
  assistant run that produced them.
- External filesystem changes are session-scoped live disk drift. They are
  file-level, always on while Iliad is open, and disappear when disk returns to
  the session baseline.

The shared file tree and editor review surfaces may be reused, but the two
sources must not erase each other, duplicate confusing UI, or borrow each
other's destructive semantics.

## Observed Bugs To Investigate

1. A single internal agent request can show duplicate-looking pending-change
   cards in the assistant panel for the same file.
2. Acting on what appears to be one small internal edit, such as a trailing
   blank-line deletion, can make unrelated green suggestions disappear.
3. Pending review counts can diverge from what the file tree visibly exposes
   when multiple review artifacts target the same path.
4. Source-specific UI can become ambiguous after the external review work:
   `Restore all...` is right for external disk drift, but internal assistant
   proposals still need proposal/review language.
5. Click actions must be idempotent enough that the first click on an action
   either completes or visibly enters a busy/error state.

## Working Loop

For each improvement:

1. Reproduce or inspect the issue with the current app and code.
2. Write or update a spec in `specs/`.
3. Send the spec to review agents with distinct lenses:
   product/UX, state-machine/data model, implementation risk, and QA.
4. Incorporate useful feedback into the spec before implementation.
5. Implement the smallest change that satisfies the spec.
6. Run focused unit tests for the changed layer.
7. Run full safety checks:
   - `npm test`
   - `npx tsc -p tsconfig.app.json --noEmit`
   - `npx tsc -p electron/tsconfig.json --noEmit`
   - `git diff --check`
8. Run live visual QA in the Electron app using a disposable workspace or a
   verified reset contract.
9. Take screenshots with `screencapture` for visual inspection when UI state is
   relevant.
10. Restore all test workspaces or fixture files to their starting state.
11. Re-run the external filesystem review regression matrix before considering
   the internal-agent work complete.

## Verified Reset Contract

Prefer a fresh temp workspace and fresh Electron `userData` for destructive
visual cases. When reusing a workspace, confirm all of this before and after the
case:

- no persisted internal proposals remain for that workspace unless the case is
  explicitly testing persistence;
- no active assistant run artifacts remain;
- no active external capture session remains;
- no selected stale review target remains;
- no pending file-tree markers remain;
- watcher debounce is idle;
- Iliad-owned mutation markers have cleared;
- active editor text equals disk for the selected file;
- files on disk match the expected baseline.

## Required Pass Criteria

Internal assistant:

- One assistant request that edits one file produces one clear pending item in
  the assistant panel, editor, and file tree.
- One assistant request that edits multiple files produces one clear proposal
  group with reviewable file rows, not duplicate generic cards.
- Per-hunk accept/reject affects only the visually associated hunk.
- File-level accept applies all remaining mutable hunks for that file.
- File-level reject rejects remaining mutable hunks and does not roll back
  already accepted hunks.
- If pending hunks remain after a hunk decision, the editor stays in review mode
  for that proposal file.
- Internal proposal rejection does not touch workspace files except for already
  accepted hunks that were intentionally written.
- Assistant-panel pending cards are not duplicated for the same run/file.
- Pending review count matches the number of visible reviewable items.

External filesystem review regression:

- Opening Iliad starts from a clean session baseline, regardless of Git dirt.
- Live external edit shows green/red diff and file tree marker.
- Repeated external edits stack against the session baseline.
- Reverting disk to baseline clears the pending review item.
- New files show all-green content.
- Deleted files stay visible as struck review rows.
- Cleared files are edits, not deleted files.
- `Keep changes`, `Restore previous version`, `Keep file`, `Move to Trash`,
  `Confirm deletion`, `Restore file`, and `Restore all...` still work.
- Internal assistant-owned writes do not become external review items.

## Live QA Matrix

Use a disposable workspace for destructive cases. Keep the real
`/Users/sebastian/dev/iliad-site/my-docs` content available for final visual
screenshots, not for repeated destructive testing unless explicitly reset.

Internal agent cases:

- Edit one paragraph in the active file.
- Add several separated sections to the active file.
- Remove a trailing blank line while also adding text elsewhere.
- Accept one hunk, reject another hunk, then accept remaining hunks.
- Reject one hunk while other hunks remain pending.
- Ask a second internal agent request against the same file while the first
  proposal is still pending.
- Ask an internal agent request that creates a new Markdown file.
- Ask an internal agent request that edits two Markdown files.
- Close and reopen the assistant panel with pending proposals.
- Switch documents while an internal review is open.
- Create an internal proposal and external review for the same file and verify
  external disk drift blocks internal accept until resolved.

External regression cases:

- Edit active file externally.
- Edit non-active file externally.
- Edit two files externally.
- Create a file externally.
- Delete a file externally.
- Empty a file externally without deleting it.
- Change a file externally, then change it back to the session baseline.
- Apply or reject external review while the assistant panel is open.

## Screenshot Capture Contract

For visual checks, bring Iliad to the front and save a screenshot:

```sh
osascript -e 'tell application "System Events" to set frontmost of process "Iliad MD" to true'
screencapture -x /private/tmp/iliad-review-check.png
```

Then inspect the saved PNG with the local image viewer. If full-screen capture
contains too much surrounding UI, crop after capture or capture by window id
with `screencapture -l` when a reliable window id is available.

## Completion Definition

This workstream is complete only when:

- the active spec is implemented;
- tests and typechecks pass;
- live visual QA passes for internal assistant review;
- external filesystem review still passes its regression cases;
- test files are restored;
- the final implementation and specs are committed.
