# Backlog

Date: 2026-09-16

Known gaps and follow-ups that are not bugs in shipped behaviour but were
found or deferred during a change. Each item names where it came from so the
context can be recovered. Remove an item when it is done or decided against;
record the decision in `docs/architecture.md` or the relevant spec.

Related: `docs/product-vision.md` (what Iliad is),
`specs/2026-09-24-iliad-writing-surface.md` (no internal agent, per-chunk
review, companion files, CLI),
`specs/2026-09-01-workspace-baseline-review.md` (outside-change review),
`docs/outside-changes-qa-matrix.md` (the live QA record these items come from).

## Outside-change review, conflict mode, and companions

### Pending QA cases

E12 (a ✦ AI or autocomplete accept produces no outside item) was blocked
without a provider; run it with a Gemini key. Blocks I (per-chunk review) and
J (companion files) of the QA matrix are new and not yet run live.

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

### Winning single Restore sometimes shows no notice

Cosmetic, from the Bx3 re-verification (then labelled Accept/Reject). A
winning Keep always shows a notice; a winning single Restore showed no notice
in 2 of 4 trials. The loser's notice is correct. Make the winner's notice
deterministic.

### No product path to a second window on the same workspace

A second CLI launch on the same path focuses the existing window and the
macOS menu has no "New Window". QA reached two windows through the recents
list. Decide whether a second window per workspace is a supported flow (the
baseline service already supports it) and, if so, add the menu item.

### Whitespace-only chunks are reviewed on their own

From the per-chunk review (spec `specs/2026-09-24-iliad-writing-surface.md`,
V8). A change that swaps blank lines for text is split into an insertion and
a whitespace-only removal, each with its own Keep / Restore. Merge a
whitespace-only chunk into its neighbour when that proves noisy in use.
(The former "residual race on restoring an outside edit" item is closed:
every restore now uses the guarded replacement; the restored file gets a new
inode but keeps its permission bits.)

### Per-chunk review of outside creates and deletes

Same spec, deferred. Outside-created and outside-deleted files are decided
as a whole (Keep file / Move to Trash, Confirm deletion / Restore file). A
large new document an agent wrote cannot be partly kept. Consider chunked
review for creates (keep some sections) if agents create long files often.

### Baseline persistence across restarts

Same spec, deferred. The baseline is session-scoped: outside changes made
while Iliad is closed (or before a window attaches) become the baseline and
are never reviewed. An agent that works while the app is closed leaves no
review trail. Persisting the baseline per workspace in app data (hashes plus
text, never in the folder) would close that gap; decide how to expire it and
how to handle a folder changed by Git in the meantime.

### Attribution of outside changes

Same spec, deferred (formerly "Codex as an attributed external-review
source"). Review items say "changed outside Iliad" with no source. Showing
which tool or run made a change ("changed by Claude Code") would need a
signal from the tool, for example the CLI announcing a run or a marker file,
and must stay advisory: the baseline, not the attribution, decides what is
reviewed. See the "Follow-up" section of
`specs/2026-09-01-workspace-baseline-review.md`.

## Writing assists

### Another / Steer for selection rewrites

From `specs/2026-09-24-one-ai-key.md`: the continue suggestion has ⌥↑/↓ and
Steer…, but a selection rewrite review only offers Accept (Tab) and Reject
(Esc). Add "another version" and a steer field to the inline review so both
flows share the full set of review controls.

### ✦ AI bar position after triple-click

The selection bar (✦ AI, comment) anchors above the selection head. A triple-click puts the
head at the start of the next line, so the bar can cover the selection's last
line. Anchor above the selection start (or its first line) instead.

### CLI socket path length

From the 0.3.0 install check: macOS limits Unix socket paths to ~104 bytes. The
default `~/Library/Application Support/Iliad MD/iliad.sock` fits, but a long
`ILIAD_USER_DATA` makes `listen`/`connect` fail with EINVAL and the CLI prints
a raw error. Detect the length and say so (or fall back to a short path under
`$TMPDIR` keyed by the profile).

## Install and distribution

From `specs/2026-09-25-agent-installable-iliad.md`.

### Brew-aware update notice

Brew-installed users still get the in-app "Iliad MD X.Y.Z is available."
notice with Download (the DMG). Following it is harmless but leaves brew's
recorded version behind until the next `brew upgrade`. When the tap has users,
detect a brew install (`<prefix>/Caskroom/iliad-md`) in main and show "Run
`brew upgrade --cask iliad-md`" instead (update-status IPC type, UI, i18n).

### Skill refresh after updates

`iliad skill install` copies `SKILL.md`; an app update does not refresh the
copy in `~/.claude/skills/iliad/`. Consider a version marker in the skill and
an `iliad status` hint when the installed copy is older than the bundle's.

### homebrew/cask submission

The cask ships from the own tap `brainforwarding/homebrew-tap`. Submit to
`homebrew/cask` once the project meets Homebrew's notability bar.
