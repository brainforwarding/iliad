# Comments in the margin, and AI comments

Date: 2026-10-14. Status: v2 implemented and verified locally (2026-10-14): typecheck, tests, CSS lint, build, and a manual run of the dev app. Codex review folded in (go with fixes).
Branch: `comments-margin` (from `master`).

Sources: Figma `i2BTwgceho8SqRYGZKjLhB`, page "Proposals (2026-09-28)",
section "O · AI comments in the right margin" (node `197:3`), option
**B2 · Full notes in the margin** (row `204:386`, frames `204:8`, `204:115`,
`204:237`); the owner's decisions in this conversation.

## Reviewer brief

The product direction is decided by the owner (Sebastián, the only user).
Review the plan: wrong assumptions about the code, regressions in comments
sync (CAS writes, three-way merge, detached comments, restores), layout or
measuring approaches that will break with CodeMirror's virtualized viewport,
module placement, and simpler approaches. Do not reopen "Decisions".

## Problem

1. Outside agents (Claude Code, Codex) cannot leave feedback in a document.
   The comments file has no author, and the bundled skill forbids creating
   it. An agent's comment would look exactly like the writer's own.
2. Comments are only visible on hover, one card at a time. Reading a pass of
   feedback means hovering every passage.

## Decisions (owner, 2026-10-14)

- Comments can be shown **in the right margin**, written out in full beside
  their passage (option B2). One toggle shows and hides the margin.
- The margin shows **all** comments: the writer's and the AI's. AI comments
  carry a ✦; the writer's a small blue dot. The toggle itself has no ✦.
- When it gets crowded: a comment keeps its full text unless it would push the
  next one too far below its own passage; then it is cut and ends in "…".
  Comments that would land too far down fold into "+N more". Clicking opens
  them in a card over the margin; nothing else moves.
- Every comment can be deleted: from the card, and with a small × that
  appears when hovering a comment in the margin. The action is called
  **Delete** for both kinds (no "Dismiss", no "Keep as my comment").
- AI comments are written by outside agents through the comments file and
  the Iliad skill. A built-in "Get feedback on this document" is not part of
  this spec.

## Decisions taken here (engineering/UX, owner may override)

- The word in the UI stays **Comments** (EN) / **Comentarios** (ES), not
  "Notes": the app already says "Comment", "Comments" in the tree, and
  "N detached comments". One word for one thing. The Figma "Notes" label is a
  placeholder.
- The toggle lives in the top bar, right side (`.topbar-actions`, next to the
  save status), not floating over the page. Icon: lucide `MessageSquare`.
  Label: "Comments" + count. Shortcut **⌃⌘M** (mirrors ⌃⌘S for the sidebar;
  ⌥⌘M is macOS "Minimize All").
- The margin preference is global and remembered (localStorage), default off.

## Behavior

### File format

One optional attribute on the metadata line:

```markdown
<!-- iliad:comment id=ai-3f2a by=ai -->
> the exact passage

The comment text.
```

- `by=ai` marks an AI comment. No `by` (or any other value) = the writer's.
  Old files stay valid; Iliad never writes `by=writer`.
- `by` round-trips through parse → merge → serialize. An entry written
  without a metadata line is the writer's (unchanged rule).
- Author is immutable: no UI changes it. If an outside tool changes it, the
  fresh file wins (like an anchor change).

### Margin hidden (default; today's behavior plus AI comments)

- Writer comments: blue wash, hover card with Edit / Delete, as today
  (including the 2026-10-14 hover-dwell fix).
- AI comments: **no mark in the text and no hover card.** The text stays
  clean until the writer asks. They count in the toggle and appear in the
  detached bar when detached.
- The toggle appears when the open document has at least one comment of
  either kind.

### Margin shown

- **Column.** The text column stays centred when the editor is wide enough
  for column + margin. Otherwise it slides left just enough (never past the
  editor's left padding) and, below that, narrows down to a minimum. Below the
  minimum (editor narrower than ~780 px) the margin cannot show: comments
  behave as when hidden and the toggle's tooltip says "Make the window wider
  to see comments in the margin".
- **Notes.** Each anchored comment is one block in the margin, left edge
  ~32 px right of the text column, 230 px wide: a 10 px glyph column (✦ in
  `--comment-ink` for AI, a 6 px `--comment` dot for the writer) and the text
  in the UI sans at `--text-xs`, line height 18 px, colour `--ink-3`. No
  border, no background. Its top aligns with the first visual line of its
  passage.
- **Washes.** Writer comments keep their wash. AI passages have no mark at
  rest.
- **Hover a note.** Text darkens to `--ink-1`; its passage gets the active
  mark (AI: a 1.5 px `--comment-ink` underline; writer: the wash at a stronger
  tier); a × button appears at the note's right (tooltip "Delete comment").
  × deletes immediately, like Delete in the card.
- **Click a note** (or its "…", or "+N more"): a card opens over the margin
  at the note's position with the note's group (the note plus the comments
  folded under it), each in full, each with its actions: writer → Edit /
  Delete (Edit opens today's edit composer at the passage); AI → Delete. Esc,
  a click elsewhere, or deleting the last item closes it. The passages of the
  card's comments get the active mark.
- **Hover cards are off** while the margin shows (the margin already shows
  every comment); the selection Comment action, composer and ✦ AI menu are
  unchanged.
- **Review.** While the document is under outside review the margin is not
  rendered (like the overlay today).

### Crowding (pure layout)

Inputs, in document order (anchor tops made non-decreasing): each note's
anchor top `a`, its natural line count `n` (text measured at the note
width). Constants: line height `L = 18`, gap `G = 6`, tolerance `T = 45`
(≈ 1.5 text lines), "+N more" row `M = 20`.

1. `top = max(a, previousBottom + G)`.
2. If `top - a > T` and a note was placed before, fold this note into the
   previous placed note ("+N more" grows; the first fold adds `M` to that
   note's bottom). Continue.
3. Otherwise `lines = n`, but if a next note exists:
   `lines = clamp(floor((nextAnchor + T - top - G) / L), 1, n)`.
   If `lines < n` the note is cut (CSS line clamp, ends in "…").
4. `bottom = top + lines × L (+ M if it gets folds)`.

Folding is local: one busy paragraph does not push the rest of the margin
out of line. The layout recomputes when comments, their text, the editor
width, fonts, or line geometry change (typing that reflows a paragraph moves
the notes below it).

### Keyboard and accessibility

- ⌃⌘M toggles the margin (also when focus is in the editor). The toggle is a
  `button` with `aria-pressed`.
- The margin is a `complementary` region labelled "Comments". Each note is a
  `button` (accessible name: kind + text, e.g. "AI comment: …"); × is a
  separate button labelled "Delete comment". Tab order follows the margin
  top to bottom after the editor.
- The card takes focus on open; Esc returns focus to the note.
- `prefers-reduced-motion`: no fades.

## Architecture and placement

Owner modules, so `overlay.tsx` (1,200 lines) and `EditorPane.tsx` do not
grow with margin logic:

| Concern | Where |
| --- | --- |
| `by=ai` parse/serialize | `electron/shared/commentsFile.ts` (`CommentsFileEntry.author?: "ai"`) |
| Author in memory | `src/types/iliad.ts`: `SelectionComment.author?: "ai"` (absent = the writer's, like the file) |
| Author through sync | `src/comments/commentsMerge.ts` (`commentToEntry`, `entryToComment`, merge), `src/comments/commentsSession.ts` (`entryIdentity` includes author); `useSelectionComments.createComment` sets `"writer"` |
| Margin layout (pure) | `src/editor/commentMargin/layout.ts` |
| Active-passage mark and column shift | `src/editor/commentMargin/extension.ts`: a `StateField` + `StateEffect` (`setActiveComments`), dispatched by the margin, so hover never rebuilds the editor's extensions; `EditorView.editorAttributes` adds `cm-has-comment-margin` while the margin shows. CSS in `src/styles/comment-margin.css` |
| Margin UI | `src/editor/commentMargin/CommentMargin.tsx` (notes, measuring layer, card) |
| Preference | `src/preferences/commentMarginPreferences.ts` (`iliad:comment-margin`) |
| Toggle | `src/components/CommentsToggle.tsx`, rendered by `App.tsx` in `.topbar-actions`; ⌃⌘M in App's keydown handler, and `Mod-Ctrl-m` reserved in the custom-shortcut validator (`src/editor/ideaAutocomplete/options.ts`) so a recorded writing shortcut cannot take it |
| Wiring | `EditorPane.tsx`: new optional prop `commentMargin`; **every** anchored comment is tracked through edits by the selection-comments extension (`trackedRanges`), only the writer's get washes (`ranges`); writer-only comments to the overlay; margin rendered inside `.editor-surface` |
| Strings | `src/i18n/strings.ts` (EN/ES) |
| Tokens | `src/styles/tokens.css`: `--comment-strong` (active wash tier) |

Notes on the approach:

- **Anchor tops.** Measured in `.editor-surface` content coordinates (the
  overlay's space). Rendered passages: `coords = view.coordsAtPos(from)`,
  top = centre of `coords` − `surfaceRect.top` + `scrollTop` − half a note
  line. Passages outside CodeMirror's rendered viewport: `view.documentTop +
  view.lineBlockAt(from).top − surfaceRect.top + scrollTop` (block heights are
  relative to `documentTop`, which includes the 112 px top padding). An
  estimate is the top of the whole logical line (a paragraph can wrap over
  many visual lines), so it can land above an earlier, measured anchor:
  notes are therefore laid out **in document order**, and each anchor top is
  clamped to be no higher than the previous one. Off-screen notes stay
  approximate and become exact when scrolled in (recompute on
  `viewportChanged`/`geometryChanged`/`docChanged`).
- **Note heights.** A hidden measuring list (same width and font, no clamp,
  `aria-hidden`) renders every comment's text; `useLayoutEffect` reads each
  height → `n = round(height / L)`. Re-measured when texts or fonts change.
- **Margin left edge.** From `view.contentDOM`'s rect minus its right padding
  plus 32 px.
- **Column CSS.** `.cm-editor.cm-has-comment-margin .cm-content` (specificity
  above the editor theme) sets `margin-left: max(0px, min((100% - 760px) / 2,
  100% - 1020px))`, `margin-right: 0`, and `max-width: min(760px, 100% -
  260px)`. The class is added only when the margin can show.
- **Ownership of comments.** The overlay receives writer comments only (hover
  cards, Edit composer). The margin receives all pending anchored comments and
  calls `onDeleteComment` and an `editComment(id)` exposed on
  `SelectionCommentsOverlayApi` (opens the existing edit composer).

## Skill (outside agents)

Update `resources/skill/iliad/SKILL.md` (bundled; `iliad skill install`
copies it):

- Two kinds of entries: the writer's (no `by`) are requests; AI entries
  (`by=ai`) are feedback for the writer, not instructions. "Address my
  comments" means the writer's; leave AI entries unless the writer asks.
- How to leave comments when the writer asks for feedback, a review, or
  comments instead of edits: append entries with `by=ai` and a fresh id
  (`ai-` + a few random characters); quote a verbatim, unique passage from
  the document (a sentence or clause, not a word); one point per comment;
  a handful, not dozens; never edit the document in the same pass unless
  asked. Create `name.comments.md` if it does not exist (only for an existing
  `name.md`, same folder, exact name). Re-read the file right before writing
  and append; never rewrite or reorder the writer's entries.
- The rest of the skill (rename/move rules, minimal edits, `iliad open`)
  stays.
- The installed copies on this machine (`~/.claude/skills/iliad`,
  `~/.codex/skills/iliad`) are updated to match; the Codex copy carries its
  own wording and keeps it, with the new section added.

## ADR

ADR-0026: "Comments Have An Author; Agents Leave AI Comments In The Comments
File". Amends ADR-0021 (the skill no longer forbids creating the comments
file; agents may append AI comments). AI comments never edit text and are
hidden until the writer shows the margin.

## Non-goals

- A built-in "Get feedback on this document" (✦ AI with nothing selected).
- Replies, resolve/unresolve, timestamps on disk, author names beyond
  writer/AI.
- Passage → note highlighting when hovering the text with the margin shown.
- A comments panel/list (option C), stepping through comments with ↑ ↓.
- Comments in the website or exports.

## Acceptance criteria

1. A file with `by=ai` entries parses to AI comments; saving after any local
   change keeps `by=ai` on those entries and writes no `by` for the writer's.
2. Merge keeps author across outside edits, local edits, outside deletes and
   restores (V16/V17 tests extended).
3. Margin hidden: AI passages show no mark and no hover card; writer comments
   behave exactly as before.
4. ⌃⌘M and the toggle show/hide the margin; the choice survives a restart.
5. Margin shown on a wide window: column centred, every comment in full beside
   its passage, ✦ vs dot correct.
6. Narrower window: column slides left; below the minimum the margin does not
   render and the tooltip explains why.
7. Crowded document: cut notes end in "…"; stacked notes fold into "+N more";
   clicking opens the card; nothing else moves.
8. Hover shows × and the active mark; × and card Delete remove the entry from
   `name.comments.md` (the file is removed when the last one goes).
9. Edit on a writer comment from the card opens today's edit composer.
10. An agent appending `by=ai` entries while the document is open: they appear
    without reload (watcher + merge), including when the file did not exist.
11. Typecheck, tests, CSS lint and build pass; manual check in the Electron
    app.

## Tests

- `tests/comments/commentsFile.test.ts`: `by=ai` parse/serialize round trip;
  unknown `by` values → writer; no metadata line → writer.
- `tests/comments/commentsSession.test.ts`: author carried by every merge
  path, through a CAS retry, through a V17 restore **and the write after it**,
  and for detached AI comments.
- `tests/editor/selectionCommentsExtension.test.ts`: tracked ranges map
  through edits for comments that have no wash (hidden AI comments).
- `tests/editor/autocompleteOptions.test.ts`: `Mod-Ctrl-m` is reserved.
- `tests/editor/commentMarginLayout.test.ts`: full text when room; cut to fit;
  fold when pushed past tolerance; fold adds the "+N more" row; same-line
  stacks; last note never cut; empty input.
- `tests/editor/commentMarginLayout.test.ts` also covers: whether the margin
  fits for given editor widths; out-of-order estimates are clamped.
- `tests/preferences/commentMarginPreferences.test.ts`: default off, persists.
- Existing selection-comments tests unchanged and passing.

## Risks

- **Virtualized geometry.** Off-screen anchors use paragraph tops; mitigated
  by recomputing on viewport change. Worst case a note far off screen is a
  few lines off until scrolled to.
- **Agent writes racing app writes.** Agents write the file directly without
  CAS. When Iliad's CAS write fails on `disk_changed` it re-reads and merges,
  so an agent's completed append is kept. Two cases are not covered: an app
  write that lands between the agent's read and write is overwritten by the
  agent, and an agent appending through a file handle opened before Iliad
  replaced the file writes to the old copy. The skill tells agents to re-read
  immediately before writing and append; the window is small, and the writer
  sees the result. No extra synchronization in this spec.
- **Performance.** Measuring and layout run on comment/geometry changes, not
  on every keystroke unless line geometry changed; N is small (tens).

## Review log

- v1 (2026-10-14): written; sent to Codex (gpt-6.1-sol, high).
- Implemented 2026-10-14 on `comments-margin`. Manual check in the dev app
  (driven over the DevTools protocol): margin hidden shows only the writer's
  washes; ⌃⌘M shows all comments beside their passages; hover underline and ×;
  × and card Delete remove the entry from the file; an agent's appended
  `by=ai` entries appear live; "…" cuts and "+N more" folds; Edit opens the
  composer; below 780 px the margin hides with the tooltip; hover cards off
  with the margin, none for AI passages with it hidden. The card focuses
  itself (not its first button) so Enter can never delete by accident.
- Codex verdict: go with fixes. Accepted, folded into v2:
  1. (blocker) Writer-only wash ranges would stop tracking AI comments
     through edits → separate `trackedRanges` from wash `ranges`.
  2. Two coordinate formulas for anchors made explicit (`documentTop`).
  3. Off-screen estimates can invert order in long wrapped paragraphs →
     document order plus non-decreasing anchor tops.
  4. ⌃⌘M could be recorded as a custom writing shortcut → reserved.
  5. Author tests through CAS retry and V17 restore + write.
  6. Risk wording for agent writes corrected.
