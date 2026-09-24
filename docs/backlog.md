# Backlog

Date: 2026-09-16

Known gaps and follow-ups that are not bugs in shipped behaviour but were
found or deferred during a change. Each item names where it came from so the
context can be recovered. Remove an item when it is done or decided against;
record the decision in `docs/architecture.md` or the relevant spec.

Related: `docs/agent-runtime-roadmap.md` (agent sequencing),
`specs/2026-09-01-workspace-baseline-review.md` (outside-change review),
`docs/outside-changes-qa-matrix.md` (the live QA record these items come from).

## Outside-change review and conflict mode

### Pending QA cases that need a connected provider

From the QA matrix run of 2026-09-02. Fifteen cases are recorded as
`blocked`, not `pass`. Run them and fill in their Status once Codex is
connected in the app:

- E12 (Tighten / selection tool accept produces no outside item).
- F5, F6, F7, F8, F9 (Codex run that edits two files; cancel mid-write; kill
  the `codex` process; force-quit mid-run and reopen; outside edit during a
  Codex run).
- Fx1, Fx2, Fx3, Fx4, Fx5, Fx6 (Codex-run edge cases from the Codex review
  of the matrix). Fx4 and Fx5 are covered by unit tests
  (`tests/agent/codexAppServerProvider.test.ts`,
  `tests/agent/codexRunJournal.test.ts`); the live run is still owed.

Three more cannot be forced from outside the app and stay `blocked` unless
a test hook is added: Ax3 (`fs.watch` change event with a null filename),
Hx1 (watcher retries exhausted, then an outside edit), Ax1 live (symlink
swapped between the safety check and the write; the unit test covers the
refusal). Decide whether a main-process test hook is worth it or accept the
unit coverage as final.

### Losing window in a two-window conflict can only discard its text

QA cases Dx1 and Dx2. When two windows edit the same file and one saves, the
other refuses its save and shows the orphan banner ("This file on disk no
longer matches what Iliad last read") whose only action is "Reload from
disk". The typed text in that window has no in-app way to survive: the
writer must copy it out by hand. Safety holds (nothing is overwritten), but
the product should offer a way to keep the buffer, for example "Save my
version" (re-read the disk hash and save over it, since no outside item is
pending) or "Save as copy".

### Deleted and recreated workspace root never reattaches

QA case H2. Deleting the workspace root switches the app to the "workspace
no longer available" screen without crashing, but recreating the folder at
the same path never reattaches, later outside edits are not detected, and no
watcher restart or degraded notice fires. That screen offers only "Open
folder", with no recents list, so recovery needs the native dialog. Decide
whether the watcher should retry the root with the existing backoff and
whether the unavailable screen should list recents.

### Whitespace-only chunks are reviewed on their own

From the per-chunk review (spec `specs/2026-09-24-iliad-writing-surface.md`,
V8). A change that swaps blank lines for text is split into an insertion and
a whitespace-only removal, each with its own Keep / Restore. Merge a
whitespace-only chunk into its neighbour when that proves noisy in use.
(The former "residual race on restoring an outside edit" item is closed:
every restore now uses the guarded replacement; the restored file gets a new
inode but keeps its permission bits.)

### Winning single Reject sometimes shows no notice

Cosmetic, from the Bx3 re-verification. A winning Accept always shows
"Applied reviewed changes"; a winning single Reject showed no notice in 2 of
4 trials. The loser's notice is correct. Make the winner's notice
deterministic.

### Internal proposal hidden while an outside item holds the same path

`buildReviewQueueItems` marks an internal proposal item
`external_drift_same_path` and hides it from the tree and the Pending
changes card while an outside item is pending on that path, so the store's
"outside changes waiting for review" refusal is only reachable through IPC.
The behaviour is intended (resolve the outside change first), but the card
gives no hint that an internal proposal is waiting behind it. Consider a
muted row or a count on the outside item.

### Agent panel opens on settings when no provider is connected

With no provider connected the panel lands on Agent settings and the
Pending changes card sits behind the back arrow. Reviewers of outside
changes who never use a provider still need that card first. Consider
opening on the review view when outside items are pending.

### No product path to a second window on the same workspace

A second CLI launch on the same path focuses the existing window and the
macOS menu has no "New Window". QA reached two windows through the recents
list. Decide whether a second window per workspace is a supported flow (the
baseline service already supports it) and, if so, add the menu item.

### Documented Fx7 limitation did not reproduce

The matrix records "apply a create proposal, navigate and type before it
completes: the created file is activated" as a known limitation. The live
run respected navigation and typing. Re-check the note against the code and
drop it if the limitation is gone.

## Writing assists

### Another / Steer for selection rewrites

From `specs/2026-09-24-one-ai-key.md`: the continue suggestion has ⌥↑/↓ and
Steer…, but a selection rewrite review only offers Accept (Tab) and Reject
(Esc). Add "another version" and a steer field to the inline review so both
flows share the full set of review controls.

### Gemini for selection edits

Selection AI actions still need Codex or an OpenAI API key; a Gemini key only
powers autocomplete. Route selection edits through Gemini when that is the only
configured provider.

### Selection bar position after triple-click

The selection bar anchors above the selection head. A triple-click puts the
head at the start of the next line, so the bar can cover the selection's last
line. Anchor above the selection start (or its first line) instead.

## Agent direction

### Codex as an attributed external-review source

See the "Follow-up" section of
`specs/2026-09-01-workspace-baseline-review.md`: letting Codex or any
harness write to the workspace with the baseline review carrying
attribution (which run, which tool) and hunk-level keep/restore. Needs an
ADR that updates `docs/agent-vision.md` first.
