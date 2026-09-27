# Record your own shortcuts

Status: implemented and verified locally (2026-09-27). Not released (owner request).

Date: 2026-09-27. Figma: `i2BTwgceho8SqRYGZKjLhB`, page "Shortcuts: press your
own keys (2026-09-26)", frame `68:3` (agreed with the owner).

## Problem

The four remappable Writing assists keys (✦ AI menu, Sentence, Paragraph, Full
idea) are picked from a fixed list of 15 keys. The defaults (⌘↵ ⌘, ⌘. ⌘/) are
neighbours on an English keyboard, but on other layouts `/` sits elsewhere
(Spanish: ⇧7), and the list has nothing that fits. Writers should press the
keys they want, as in VS Code.

## Behavior

Same rows, labels and order as today. Only how a key is chosen changes.

1. The key chip is a button (no ⌄, no native select). Click, Enter or Space
   starts recording that row. Only one row records at a time.
2. Recording: the chip reads "Press keys…" ("Pulsa las teclas…"). While held,
   modifiers show in the chip ("⌘ …"). The shortcut is taken on the first
   non-modifier keydown.
3. Esc, clicking outside (blur) or closing the popover cancels and keeps the
   old key. Tab is not recorded: it moves focus, which cancels.
4. A key another row uses: both chips are marked, and the recording row's note
   reads "Paragraph uses ⌘. · ↵ swap · Esc cancel". Enter swaps the two keys;
   Esc/blur cancels; any other combination is a new attempt.
5. A key Iliad already uses: the chip shows it marked and the note reads
   "⌘- is taken" ("⌘- ya está en uso"). Recording continues.
6. A key without ⌘ or ⌃ (see rules): note "Add ⌘ or ⌃" ("Añade ⌘ o ⌃").
   Recording continues.
7. Otherwise the key is saved immediately (same localStorage preference as
   today) and the chip shows it.
8. Reset shortcuts still restores ⌘↵ ⌘, ⌘. ⌘/.

No "add another" key, no global (outside-the-app) shortcuts, Accept (Tab),
Another (⌥↑↓) and Dismiss (Esc) stay fixed.

## What gets recorded

A CodeMirror key name, so the stored value keeps working with the existing
keymaps (`ideaAutocomplete/extension.ts`, `selectionComments/extension.ts`,
the length-key guard in `EditorPane.tsx`), which already accept any key string.

The recorder mirrors how CodeMirror (`@codemirror/view` `runHandlers` +
`w3c-keyname`) matches a keydown, so whatever is recorded is what fires later:

- Modifiers: `Mod` = ⌘ on macOS / Ctrl elsewhere; `Ctrl` = ⌃ on macOS;
  `Alt`; `Shift`. Canonical order `Mod-Ctrl-Alt-Shift-<key>`.
- Key: `keyName(event)` from `w3c-keyname` (added as a direct dependency;
  it is already installed through `@codemirror/view`). This is the character
  the layout produces, so ⌘ñ records `Mod-ñ`.
- For a single-character key: Shift is not added (CodeMirror matches the
  shifted character), and ASCII letters are lower-cased when Shift is not held
  (Caps Lock). When ⌥ is held, or ⇧ with a modifier, the produced character is
  unreliable on macOS (⌥1 → ¡); then record the unshifted base key from
  `w3c-keyname`'s `base[keyCode]` plus `Shift` if held, which is CodeMirror's
  fallback match (e.g. `Mod-Alt-1`, `Mod-Shift-7`).
- Named keys (Enter, Space, arrows, F-keys, Backspace…) keep their name and
  include Shift.
- `event.isComposing` / key "Dead" / "Unidentified" / pure modifier keydowns
  are not recorded.

## Rules

- Needs ⌘ or ⌃ (`Mod` or `Ctrl`). Exception kept from the old list: `Alt-Enter`.
  ⌥+letter alone would swallow accent dead keys (⌥e → é); a bare key would stop
  typing.
- Keys Iliad already uses are refused ("is taken"). One list in
  `options.ts`, covering:
  - app menu (`electron/main.ts` roles, macOS): ⌘Q ⌘H ⌥⌘H ⌘Z ⇧⌘Z ⌘X ⌘C ⌘V
    ⌘A ⌘0 ⌘= ⌘+ ⌘- ⌃⌘F ⌘M;
  - app shortcuts: ⌘W (close), ⌘O (open), ⌥⌘F (tree search), ⇧⌘M (comment),
    ⇧⌘J (shorten), ⌥↑ ⌥↓ (Another);
  - editor essentials: ⌘F ⌘G ⇧⌘G (search), ⌘Y, ⌘/⌥ + arrows, ⌘/⌥ Backspace,
    ⌘ Delete.
  CodeMirror defaults that the length keys already override today (⌘/ toggle
  comment, ⌘↵ blank line, ⌘[ ⌘] indent, …) are not "taken", same as today.
  macOS system keys (⌘Space, ⌘Tab) never reach the app, so the chip just
  keeps waiting.
- Stored preferences: `normalizeAutocompletePreferences` accepts any key that
  passes the same rules (instead of membership in the old 15-key list).
  Invalid or duplicate keys fall back as today (own default, else the first
  free key of the old list, kept as the fallback pool). Old stored values
  stay valid.

## Labels

One parser (`/-(?!$)/`, same as CodeMirror, so `Mod--` works) feeds both
labels. Chips: macOS symbols in macOS order ⌃⌥⇧⌘ + key (letters upper-case,
Enter ↵, arrows ↑↓←→, Backspace ⌫, Delete ⌦, Space "Space"); elsewhere
`Ctrl+Alt+Shift+Key`. Hints use the same label (`shortcutLabel` was folded into `compactShortcutLabel`).
`compactShortcutLabel("Mod-Alt-1")` becomes "⌥⌘1" (was "⌘⌥1").

## Implementation

- `src/editor/ideaAutocomplete/options.ts`: parser, labels, `shortcutFromKeyEvent`
  (pure: takes the KeyboardEvent-like fields + platform), `checkShortcut`
  (ok | taken | needs-modifier), taken list, normalization.
- `src/components/WritingAssistsMenu.tsx`: `ShortcutRow` with a chip `<button>`
  and local recording state (`idle | recording | conflict | taken | modifier`),
  keydown handled on the focused button (preventDefault + stopPropagation so
  the App Escape/⌘W/⌘O listeners and the menu never act), blur cancels.
  The popover owns which row is recording so only one does. Recording state
  is local UI; nothing new is persisted.
- `src/i18n/strings.ts`: EN/ES strings for "Press keys…", "{row} uses {key} ·
  ↵ swap · Esc cancel", "{key} is taken", "Add ⌘ or ⌃", and the recording
  aria-label "Recording shortcut for {row}".
- `src/styles/popovers.css`: chip button, recording and warning states; tokens
  only (warning colour from the existing review/error tokens).
- Accessibility: the chip button's aria-label is "{row}: {key}" when idle and
  "Recording shortcut for {row}" while recording; the note is `aria-live=polite`.

## Done when

- Unit tests: recorder mapping (Spanish ⌘ñ, ⌘-, ⌥⌘1, ⇧⌘7, Caps Lock, Enter,
  dead key), rules (taken, needs modifier, Alt-Enter), normalization of any
  valid key and of old values, labels (`Mod--`, order ⌃⌥⇧⌘).
- Component tests for the menu: four chip buttons, no selects; recording,
  conflict + swap, taken, cancel on Esc and blur.
- `npm run typecheck`, `npm test`, `npm run build`, `npm run lint:css` pass.
- Live check in the Electron app: record ⌘ñ for Full idea and ask for a full
  idea with it; ⌘- refused; swap works; Esc/click outside cancel; ⌘W/⌘Q while
  recording do not close/quit; reset restores defaults.
- No release or deploy (owner request, 2026-09-27).

## Review (Codex, xhigh, 2026-09-27)

Confirmed sound: the key mapping matches CodeMirror's `runHandlers` +
`w3c-keyname` for ⌘ñ, ⌘-, ⌥⌘1, ⇧⌘7, Caps Lock and named keys; stored values
keep working with the existing keymaps; the `Mod--` parser and label order.

Accepted:
- High: renderer `preventDefault` is not a reliable way to stop native menu
  roles (Quit, Hide, Copy…). While a chip records, the renderer asks main to
  call `webContents.setIgnoreMenuShortcuts(true)` for its window
  (`writing:set-recording-shortcut`, trusted sender, boolean only), and resets
  it when recording ends or the menu unmounts.
- "Unidentified" keys and key names no keydown produces are ignored when
  recording and rejected when loading stored preferences (e.g. `Mod-nope-k`).
- ⇧Tab moves focus like Tab (cancels); Esc cancels with any modifiers held.
- The UI delegates to the tested pure `recordShortcutKeyDown` (it already did
  by the time the review finished).

Not done: DOM interaction tests for the menu. The repo has no DOM test
environment (menu tests render static markup); the recorder is a pure,
unit-tested function and the interaction was checked live over CDP instead.
Adding jsdom for this one component is not worth it now.

## Implementation notes

- The live check caught a bug the unit tests missed: spreading a DOM
  `KeyboardEvent` drops its (prototype getter) modifier fields, so ⌘- recorded
  as `-`. Fields are now copied one by one; a test uses a getter-based event.
- Labels: letters show upper-case (⌘Ñ, ⌘K), macOS style; the Figma drew ⌘ñ.
- The Figma's first row label "Ask for a suggestion" is the current "✦ AI menu".

## Validation

- `npm run typecheck`, `npm test` (84 files), `npm run build`, `npm run lint:css` pass.
- Live (built app, isolated `--user-data-dir`, CDP key events): chip shows
  "Press keys…", "⌘…" while ⌘ is held; ⌘- → "⌘- is taken"; bare A → "Add ⌘ or
  ⌃"; ⌘. → both chips marked + "Paragraph uses ⌘. · ↵ swap · Esc cancel", ↵
  swaps and saves; Esc and blur cancel without closing the popover; ⌘W while
  recording is refused and does not close the document; Reset restores
  defaults; ⌘ñ recorded for Full idea, and ⌘ñ in the editor asked for a full
  idea (ghost suggestion shown). `setRecordingShortcut` IPC succeeds from the
  window.
- Owner checked by hand (2026-09-27): a physical ⌘Q/⌘H while a chip records
  neither quits nor hides and shows "… is taken"; Esc/click outside cancel;
  after recording, ⌘H hides and ⌘Q quits as usual.
