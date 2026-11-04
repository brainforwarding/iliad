# Bold, Italics, and Click Placement

Date: 2026-11-04
Status: implemented

## Behavior

⌘B toggles bold (`**text**`), and ⌘I toggles italics (`*text*`). Use Ctrl
on Windows/Linux. These commands edit ordinary Markdown and use normal undo,
autosave, and comment-position mapping.

- With selected text, add the requested markers. If the selection is already
  wrapped in that style (content or markers selected), remove those markers.
  A selection contained within an existing span removes that enclosing style
  and keeps the same selected text. Preserve selection direction.
- With the caret inside an existing span of the requested style, remove that
  span's markers while keeping the caret in the same text.
- With an unformatted caret, insert paired markers and put the caret between
  them. Repeating the command removes the empty pair.
- Leave leading/trailing whitespace outside markers. For a selection spanning
  lines, format each nonblank line separately, preserving paragraph breaks and
  existing list, heading, quote, and task prefixes. Mixed selections add the
  requested style. A selection intersecting code is left unchanged.
  Partially overlapping existing cross-line emphasis is also left unchanged;
  splitting such spans is outside this small change.
- Bold and italics can be combined and toggled independently. Reuse the existing
  Markdown parser for identifying formatting instead of inventing a parser.
- Read-only documents and code spans/blocks are not formatting targets.
- Reserve both shortcuts so configurable AI shortcuts cannot claim them; old
  conflicting preferences fall back through the existing normalization.

When markers are hidden, a plain click at a formatted span's boundary follows
the agreed rule (`|` represents the caret):

| Click | Result |
| --- | --- |
| Left edge, no preceding space | `|**word**` |
| Left edge, immediately preceded by a space | `Some **|word**` |
| Before that preceding space | `Some| **word**` |
| Immediately after the final letter | `**word|**` |
| After the following space | `**word** |` |

The same rule applies to italics. Use actual whitespace, without sentence
detection. A leading indentation space also counts as preceding whitespace.
Clicking inside letters keeps normal character placement. Revealing Markdown
on the active line remains unchanged. Once markers are visible, clicks and
arrow keys address the literal source normally.

Combined styles have one visible boundary: `|***word***` or `Some ***|word***`
at the left, and `***word|***` at the right. Capture the rendered geometry
before focus/selection reveals markers.

Apply the boundary rule only to hidden formatting, using its existing rendered
decorations. Keep normal double/triple click, modifier click, drag selection,
links, code, and review surfaces working. A drag that starts at a boundary uses
the corrected anchor and otherwise follows normal character selection.

## Scope and Verification

Add a small formatting-command extension and a boundary selection handler beside
visual Markdown. Extend its inline style detection only as needed for combined
bold/italics. No formatting toolbar, sticky rich-text mode, tabs, or new storage.

Test marker insertion/removal, empty pairs, combined styles, selection/caret
mapping, whitespace/multiple lines, undo, read-only/code guards, and shortcut
reservation. Test the click table against real rendered editor coordinates,
including a line start, interior text, italics, combined formatting, existing
visible markers, and drag/double-click behavior. Run typecheck and the existing
editor tests.

## Review

Independent review requested before implementation. Incorporated its findings:
preserve structural prefixes, define containing-span and code-overlap toggles,
and group adjacent hidden markers for combined styles. Keep the change local
to commands, inline style detection, and mouse selection.

Implementation review also caught multiline toggle handling and optional closing
heading hashes. Both have regression coverage. Rendered QA exposed a second
hit-test after marker revelation; plain clicks on a line with hidden formatting
now retain their original source position throughout that initial gesture.

## Verification

- 215 editor tests pass, including command, click-placement, combined-style,
  shortcut-migration, and existing editor coverage.
- The full suite passes: 1,219 tests across 119 files.
- 25 native Electron input checks pass for the click table across bold,
  italics, and combined styles, plus visible source, review-blocked source,
  double click, drag selection, ⌘B, ⌘I, and ⌘Z.
- Typecheck and production build pass.
- Interactive fixture: `tests/manual/inline-formatting.html` through Vite.

## Release

Shipped in signed/notarized Iliad MD 0.8.0 on 2026-11-04 alongside document
tabs. The final combined release passed 1,241 tests, typecheck, CSS lint,
build, and the production audit gate. Cmd+B/Cmd+I, ordinary Markdown saves,
and independent undo passed in the downloaded public app. See
[the release record](../docs/release-0.8.0-verification.md).
