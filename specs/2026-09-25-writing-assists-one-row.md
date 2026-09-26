# Writing Assists: One Row Style, Manual Suggestions, No Notes

Date: 2026-09-25
Status: approved direction (owner, 2026-09-25); implementation spec
Design: Figma "Iliad — AI writing interactions" (`i2BTwgceho8SqRYGZKjLhB`),
page "Writing assists: one row style (2026-09-25)", frame 15 (node `57:133`).
Scope: the Writing assists menu, automatic suggestions, writing notes.

## Reviewer brief

The design and the three removals are owner decisions. Review the
implementation: nothing left behind that still triggers an automatic request,
no orphaned notes code paths, preference parsing that tolerates old stored
values, and existing `.notes.md` files left intact on disk. Do not propose
keeping automatic suggestions, notes, or a collapsible section.

## Problem

The menu mixes four visual styles (switch rows, icon rows, a collapsible
"Shortcuts & accessibility" heading, a grey pill button that truncates), has
settings that only exist to tame automatic suggestions ("Suggest while I
type", "Pause for 10 min"), an accessibility checkbox nobody opens, and an
"Open notes" row for a feature the owner never asked for. Comments are how the
writer talks to the AI; notes duplicate that.

## Decisions

1. **One row style.** Every item: name on the left (13px Medium), an optional
   grey note under it, the control on the right, a hairline under each row.
   Single-line rows share one height. No collapsible sections, no headings or
   subtitles in another style, no pill buttons, no helper text that restates
   the obvious ("Click a key to change it").
2. **Suggestions only on request.** Automatic suggestions are removed.
   Suggestions come from the AI key and the length keys. This resolves the
   owner gate in `specs/2026-09-25-groq-ai-free-tier.md` section 8b in favour
   of removal.
3. **Screen-reader announcement always on.** The live region that reads a
   shown suggestion stays; the "Announce suggestions" checkbox goes.
4. **Writing notes removed.** No "Open notes", no `name.notes.md` companion,
   no notes in the autocomplete prompt. Comments stay as they are.

## Menu, top to bottom

| Row (EN / ES) | Note | Control |
| --- | --- | --- |
| Corrector | English only for now / Solo inglés por ahora (while unavailable) | switch |
| Autocomplete / Autocompletar | none | switch |
| ✦ AI menu / Menú ✦ IA (pending, see open question) | none | key select (`continue`, default ⌘↵) |
| Sentence / Oración | none | key select |
| Paragraph / Párrafo | none | key select |
| Full idea / Idea completa | none | key select |
| Accept / Aceptar | none | fixed key text `Tab` |
| Another / Otra | none | fixed key text `⌥ ↑↓` |
| Dismiss / Descartar | none | fixed key text `Esc` |
| Reset shortcuts / Restablecer atajos | none | whole row is the button |
| AI key row (see below) | per state | text link |
| Privacy / Privacidad | none | whole row opens the privacy page |

Key rows are shown only while Autocomplete is on, as today. Key selects keep
the existing duplicate-key blocking. Hairline under every row except the last.

AI key row on `master` today (Gemini): "Gemini key" with note "••••1234" and a
"Change" link; without a key, the row's link is "Add key" and opens the key
form in place of the row. When the Groq work lands it swaps copy only: "AI
included / IA incluida", note "Free, with a daily limit / Gratis, con un
límite diario", link "Use my key / Usar mi clave" (not "Use your own Groq
key…"). The expanded key form, own-key and error states keep the Groq spec's
copy but use the same row and link styles.

## Behavior changes

### Automatic suggestions

- `src/editor/ideaAutocomplete/extension.ts`: remove the automatic trigger
  (`schedule("automatic")`, `pendingAutomaticTrigger`, `automaticPausedUntil`
  and its 5-minute back-off, the `snoozedUntil` and `automaticEnabled`
  options). Manual requests (continue key, length keys, ⌥↑/↓, Steer) are
  unchanged.
- The `inline` suggestion kind exists only for automatic requests. Remove it
  from the renderer and from `electron/writing/autocomplete.ts` if nothing
  else uses it after the trigger goes; escalation then starts at `sentence`.
- `src/preferences/autocompletePreferences.ts`: remove the snooze state and
  `toggleSnooze`. `App.tsx` and `EditorPane.tsx` stop passing them.
- `src/editor/ideaAutocomplete/options.ts`: drop `manualOnly` and `announce`
  from `AutocompletePreferences`. The parser ignores those keys in stored
  values (no migration step needed); shortcuts parse as today.
- Strings removed, EN and ES: `suggestWhileTyping`, `suggestWhileTypingOff`,
  `snooze`, `resume`, `announce`, `shortcuts`, `continueKeyHint`,
  `openNotes`, `openNotesHint`, `openNotesFailed`, `companionNotes`. Rename
  `continueKey` copy to "Ask for a suggestion" / "Pedir sugerencia".

### Announcement

`EditorPane.tsx`: the `autocomplete-announcement` live region renders a shown,
finished suggestion regardless of preferences.

### Notes removal

- `electron/shared/companionFiles.ts`: `CompanionKind` becomes `"comments"`
  only. `*.notes.md` is no longer reserved; the reserved-name message mentions
  only `.comments.md`.
- Existing `name.notes.md` files are not deleted, renamed or migrated. They
  become ordinary Markdown documents: listed in the tree as documents (not as
  child rows), reviewable by the workspace baseline like any document.
- Remove `src/app/useWritingNotes.ts`, `src/notes/legacyWritingNotes.ts`
  (the localStorage migration into `.notes.md`) and their wiring in
  `App.tsx`, the menu props (`onOpenNotes`, `notesAvailable`, `hasNotes`) and
  the file-tree companion handling for notes (`FileTree.tsx`,
  `TreeContextMenu.tsx`, `src/review/pendingFileTree.ts`,
  `src/styles/sidebar.css`).
- `electron/writing/autocomplete.ts`: drop the "Author's writing notes" prompt
  line and the `guidance` request field; `src/types/iliad.ts` loses the
  `notes` kind and field.
- Leave the old localStorage guidance keys alone (unused, harmless).
- The owner's machine has no `.notes.md` files (checked 2026-09-25), so no
  local cleanup is needed.
- `resources/skill/iliad/SKILL.md`: the companion section describes only
  `name.comments.md`. `docs/product-vision.md`, `docs/architecture.md` and
  `docs/decisions.md` say notes were removed on 2026-09-25 and why.

### Tooltips

Unchanged: `TooltipLayer` (`cbf4ad4`) renders all `data-tooltip` labels.

## Non-goals

- The Groq provider, proxy, quota and notices (Groq spec).
- A key recorder, key-hint chip, or ES-layout default for Full idea (Figma
  page `47:2`). Key selects stay as they are.
- Any change to comments, the ✦ AI selection menu, or review.

## Sequencing

Implement on `master` now; it does not depend on Groq. The Groq branch then
rebases: its menu copy uses the row table above, and its section 8b gate is
closed as "removed".

## Privacy row (decided 2026-09-25)

Under the AI key row: an ordinary row "Privacy / Privacidad" with no control.
Clicking it opens `https://iliad.md/privacy/` (EN) or
`https://iliad.md/es/privacidad/` (ES) in the browser, following the app
language. The page lives in the `iliad-site` repo; it describes today's
Gemini route. The Groq release must update it (free route through Iliad's
server, own key, processors) before the free route ships.

## Open question for the owner: ⌘↵

Today ⌘↵ does two things. With nothing selected it asks for a sentence and
each further press makes it longer, which repeats ⌘, ⌘. ⌘/. With text
selected it opens the ✦ AI list, the same list as clicking "✦ AI" in the
selection bubble (a keyboard shortcut for that click).

Agreed so far: ⌘↵ no longer asks for suggestions; suggestions come only from
⌘, ⌘. ⌘/. Pending: keep ⌘↵ only to open the ✦ AI list (row "✦ AI menu" /
"Menú ✦ IA", recommended) or remove it and its row.

## Status (2026-09-25)

- Tooltips cut off at the window edge: fixed on `master` (`cbf4ad4`).
- Privacy page EN/ES written in `iliad-site` (`b7aae57`), with footer links
  and sitemap; not deployed. The owner reads it first; upload steps are in
  `iliad-site/DEPLOY.md`.
- Implementation of this spec: not started.

## Acceptance

- The menu matches frame 15 in both languages: one row style, equal
  single-line row heights, no chevron section, no checkbox, no pill, no helper
  text.
- Typing never sends a request; only the continue and length keys do. A test
  asserts no request after edits and idle time.
- With VoiceOver on, a shown suggestion is announced without any setting.
- A folder with `a.md` and `a.notes.md` shows both as documents; nothing is
  deleted; autocomplete requests carry no notes text; `a.notes.md` is no longer
  a reserved name.
- Old stored preferences containing `manualOnly`/`announce` load without error.
- `npm run typecheck`, `npm test`, `npm run build`, `npm run lint:css` pass;
  the menu is checked in the Electron app in EN and ES.
