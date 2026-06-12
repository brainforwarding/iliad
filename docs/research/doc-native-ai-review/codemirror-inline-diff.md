# CodeMirror Inline Diff Review for Pending AI Edits

## Question

How should Iliad show pending AI edits directly in the Markdown document, using CodeMirror 6 and `@uiw/react-codemirror`, without breaking the source-as-contract model?

This note focuses on editor-native review UI for a single Markdown file: pending insertions, deletions, replacements, hunk-level accept/reject, whole-file proposals, and the "new document" state where every proposed line is an insertion.

## Current Iliad Editor Shape

Iliad's editor is already a CodeMirror 6 surface wrapped by `@uiw/react-codemirror`:

- `src/components/EditorPane.tsx` renders `<CodeMirror value={value} onChange={onChange}>`.
- The extension list is created with React `useMemo` and currently includes `markdown()`, `EditorView.lineWrapping`, the local theme, `visualMarkdown(...)`, and `imageDropPasteExtension(...)`.
- The theme hides `.cm-gutters` entirely and disables line numbers/fold gutters in `basicSetup`.
- `src/editor/visualMarkdown/index.ts` builds a `DecorationSet` from a `ViewPlugin`.
- The visual Markdown layer uses `Decoration.line`, `Decoration.mark`, and inline `Decoration.replace` widgets for inactive Markdown syntax, links, checkboxes, images, YouTube embeds, tables, and horizontal rules.
- `docs/architecture.md` records an important constraint: do not use block decorations from a `ViewPlugin`; visual Markdown uses inline widgets for images and tables because block decorations from plugin-provided decorations can throw.
- `docs/source-as-contract.md` says the assistant should propose Markdown diffs, and accepted edits should apply to the same source text the user sees.

That means AI review should be modeled as CodeMirror state and decorations over canonical Markdown text, not as React DOM laid over `.cm-content` and not as hidden metadata injected into Markdown.

## Relevant CodeMirror Capabilities

CodeMirror 6 decorations are the primary fit. The official decoration example says CodeMirror manages its own editor DOM, so styling, replacing, or inserting elements inside content should happen through decorations rather than direct DOM mutation. It identifies four relevant types: mark decorations, widget decorations, replacing decorations, and line decorations. Source: [CodeMirror decoration example](https://codemirror.net/examples/decoration/).

The same example distinguishes decoration sources:

- Direct decoration sources can affect vertical layout because they are known before viewport computation.
- Indirect decorations, such as those returned by a `ViewPlugin`, are appropriate for highlighting visible ranges but not for decorations that significantly change vertical layout.

That distinction matters for Iliad. The existing visual Markdown plugin is safe because its replacement widgets are inline and line-height-conscious. An inline diff layer that inserts multi-line deleted text as block widgets should probably be a `StateField` provided via `EditorView.decorations.from(field)`, not a `ViewPlugin` decorations provider.

Other useful APIs:

- `Decoration.mark(...)` for changed text that remains in the document. Source: [CodeMirror reference manual](https://codemirror.net/docs/ref/).
- `Decoration.replace(...)` for hiding a source range or showing a widget in its place. Source: [CodeMirror reference manual](https://codemirror.net/docs/ref/).
- `WidgetType` for accept/reject buttons, deleted-text previews, and hunk headers.
- `GutterMarker` and `gutter(...)` for changed-line markers. Source: [CodeMirror reference manual](https://codemirror.net/docs/ref/).
- `StateField`, `StateEffect`, `RangeSet`, and transaction mapping for persistent pending-review state that survives local edits.
- `@codemirror/merge` for built-in side-by-side and unified merge review. Current `npm view` reports `@codemirror/merge` as `6.12.1`, "A diff/merge view for CodeMirror", from [codemirror/merge](https://github.com/codemirror/merge). The CodeMirror reference says `unifiedMergeView` displays changes between editor content and an original document, highlighting chunks and showing uneditable widgets with original text above new text. Source: [CodeMirror merge reference](https://codemirror.net/docs/ref/#merge).
- `@uiw/react-codemirror` is just the React wrapper around CodeMirror. Current `npm view` reports `4.25.10`. It can receive extensions, but the diff/review logic should stay in CodeMirror extensions rather than React child DOM. Source: [uiwjs/react-codemirror](https://github.com/uiwjs/react-codemirror).

## Approach A: Custom Pending-Edit StateField With Inline Decorations

This is the best fit for Iliad v1.

The assistant returns a candidate full document or a structured set of proposed hunks. Iliad computes a diff against the current editor buffer and stores pending hunks in a CodeMirror `StateField`. The field exposes decorations:

- Inserted text that already exists in the proposed view can be shown as green `Decoration.mark` ranges.
- Deleted text that is not in the current document can be shown as a widget at the deletion anchor, often before the next retained line.
- Replaced ranges can combine red deleted widgets with green marks on inserted/replacement ranges.
- Lines touched by a hunk get `Decoration.line` classes for background and left-border treatment.
- Hunk controls can be inline widgets at hunk boundaries: accept, reject, previous, next.

The key product decision is which text is the editable document while review is pending.

### Recommended State Model

Prefer "proposal overlay over current document" for v1:

- The CodeMirror document remains the user's current Markdown.
- Insertions are preview widgets or ghost text, not real document text, until accepted.
- Deletions are marked or previewed without changing the source.
- Accepting a hunk dispatches real `changes`.
- Rejecting a hunk removes that hunk from the pending-review state.

This preserves source-as-contract and makes reject trivial. It also avoids having the editor `value` contain unaccepted AI text that might autosave or feed downstream app state by accident.

The alternative is "proposed document as editor document":

- Replace the editor buffer with the AI result while marking inserted/deleted regions.
- Accept means clear diff state; reject means reverse selected hunks.

That feels closer to some IDE diff editors, but it is risky in Iliad because `onChange` is already the app's document mutation path. Unless save/autosave is fully gated, unaccepted AI text could become the file's source too early.

### Decoration Details

Use `Decoration.mark` when the underlying document text should stay selectable and editable. This is better for modifications and accepted-looking inserted text that has already been applied to a preview buffer.

Use `Decoration.replace` when Markdown syntax or deleted text should be hidden/replaced by an inert widget. Iliad already uses inline replacements for hidden syntax, links, checkboxes, images, and table rows. For AI review, replacement widgets are useful for:

- Deleted text previews.
- Collapsed unchanged regions inside large proposals.
- Hunk action controls.
- "Pending insertion" ghost spans when the inserted text is not yet part of the document.

Avoid block widgets from the existing `ViewPlugin` path. If hunk headers or deletion previews need vertical layout, put the review decorations in a dedicated `StateField` direct decoration source. Keep the existing visual Markdown plugin separate so the failure mode of one layer does not disable the other.

### Mapping Through Local Edits

Pending hunks should be represented as document positions plus enough original/proposed text to validate the hunk. On every local transaction:

- Map hunk ranges through `tr.changes`.
- Mark a hunk stale if the mapped source text no longer matches the expected old text.
- Show stale hunks as conflict states and require regenerate/rebase rather than trying to apply blindly.

For prose, this is more important than for code. Users may keep typing while an AI proposal is pending.

### Accept/Reject Commands

Accept/reject should be CodeMirror commands or helper functions that dispatch a transaction:

- `acceptHunk(hunkId)`: apply that hunk's `changes`, remove the hunk from the state field, and optionally select/scroll to the next hunk.
- `rejectHunk(hunkId)`: remove the hunk with no document change.
- `acceptAll()`: apply all non-stale hunks in document order as one transaction.
- `rejectAll()`: clear pending state.

Commands can be invoked from:

- hunk widgets,
- keyboard shortcuts,
- assistant panel buttons,
- a compact review toolbar.

The widget should not hold authoritative state. It should dispatch a state effect or call a command that reads the current state field.

## Approach B: Use `@codemirror/merge` Unified Merge View

`@codemirror/merge` is worth prototyping, but probably not as the main in-document AI review layer.

Pros:

- It already computes and displays changed chunks.
- `unifiedMergeView` is close to "show diff in one editor".
- It supports changed-line highlighting, deleted-original widgets, gutter markers, diff configuration, and collapsed unchanged regions.
- It may save a lot of rendering and diffing edge-case work.

Cons for Iliad:

- The documented model compares current editor content against an `original` document. For pending AI edits, Iliad needs the inverse: compare current user source against proposed future source, then accept parts into the current source.
- The built-in controls are merge/revert oriented, not necessarily "AI proposal accept/reject each prose hunk".
- Styling and layout may fight Iliad's visual Markdown layer.
- It likely wants to own chunk widgets and gutters more than Iliad wants for a calm writing interface.
- It adds another CodeMirror package and another mental model for state.

Best use:

- Use `@codemirror/merge` for a separate review drawer or optional "full diff" mode.
- Consider it for the existing `Review changes` drawer described in `docs/agent-panel-v1-architecture.md`.
- Do not start by embedding it into the primary writing surface unless a prototype proves it can coexist with visual Markdown and controlled save semantics.

## Approach C: Line Widgets and Hunk Headers

Line widgets are useful for prose review because hunks are line/paragraph-oriented, not only character-oriented.

Recommended uses:

- A small hunk header above a changed paragraph: "AI edit" plus accept/reject controls.
- A deleted paragraph rendered in red above the replacement paragraph.
- A collapsed multi-line deletion preview.
- A conflict banner when the hunk no longer applies.

Tradeoffs:

- Vertical layout changes require direct decorations, not indirect plugin decorations.
- Too many widgets inside long documents can make scrolling and selection feel heavy.
- Widgets need careful event handling so clicks do not steal editor focus unexpectedly.
- Widgets should use accessible buttons and should not depend on React component lifecycle.

Implementation implication: make AI review its own editor extension backed by a `StateField`, not another branch inside `visualMarkdown`.

## Approach D: Gutter Markers

Iliad currently hides all gutters. For AI review, a very narrow review gutter could be useful:

- green marker for insertion-only hunks,
- red marker for deletion-only hunks,
- mixed marker for replacements,
- click marker to jump/select/open hunk controls.

Pros:

- Gives document-scale scanability without cluttering prose.
- Keeps accept/reject buttons out of every paragraph until a hunk is selected.
- Matches familiar diff affordances.

Cons:

- `EditorPane` currently sets `.cm-gutters { display: none }` and disables gutters in `basicSetup`.
- Restoring gutters changes editor geometry and may affect the calm centered writing surface.
- On narrow screens, gutters compete with content width.

Recommendation: add gutter markers only when review mode is active, with a custom narrow gutter. Do not turn line numbers back on. If visual noise is a concern, start with line backgrounds plus a floating/current-hunk toolbar and defer gutters.

## Diffing Whole-File Proposals

For AI review, the cleanest backend contract is:

1. Assistant returns a complete proposed Markdown document, plus a short summary.
2. Renderer diffs `currentBuffer` vs `proposedBuffer`.
3. Renderer stores pending hunks with stable IDs and exact old/new text.
4. Review UI renders from those hunks.
5. Accept dispatches CodeMirror changes.

Why whole-file proposed documents are preferable:

- They avoid fragile model-generated patch formats.
- They make "new document" and "rewrite this section" the same operation.
- They let the renderer choose the diff granularity appropriate for prose.
- They can be validated with current-buffer hashes before review begins.

Diff granularity should be paragraph/line first, with optional word-level highlighting inside changed lines. Markdown prose review should not fragment every punctuation change into separate accept buttons.

Potential diff libraries:

- Use `@codemirror/merge`'s internal diff only if its exported API is sufficient for hunk extraction. Verify before committing to it.
- Otherwise use a small text diff package in the renderer or main process, then convert chunks to CodeMirror ranges.
- Keep unified-diff text as an audit artifact for the assistant panel, but render review from structured hunks.

## New Document: All-Green State

When the current document is empty or the assistant creates a new file, the diff is conceptually one insertion from position `0`.

UI should avoid showing a useless deletion side:

- Render every proposed paragraph as green pending insertion.
- Show a single top-level hunk header: accept document / reject document.
- Allow accept-by-section if the proposed document has Markdown headings or paragraph blocks.
- If the file does not yet exist on disk, accept should create the file through the same file-write path used by normal editor saves.

This state is also useful for "draft a new note" from chat. The user should see the generated Markdown in the editor before it becomes canonical file content.

## Interaction With Visual Markdown

The AI review layer and visual Markdown layer will overlap on the same document. Specific risks:

- Visual Markdown hides syntax on inactive lines. A pending AI deletion/replacement should not be hidden so aggressively that the user cannot see what is changing.
- Link/image/table replacement widgets may cover text that the AI review layer wants to mark.
- Both systems use line decorations and replacement widgets.
- Existing visual Markdown rebuilds on doc changes, viewport changes, and selection changes; review decorations should not trigger expensive full-document scans on every cursor move.

Recommended layering:

- Keep `visualMarkdown(...)` unchanged for normal editing.
- Add `aiReviewDecorations(...)` as a separate extension after visual Markdown so review classes can win in CSS.
- In review mode, either suppress visual replacements for changed ranges or let the AI review field expose "blocked ranges" that visual Markdown can respect.
- Simpler v1: when any pending AI review exists, disable visual Markdown replacement widgets only for lines touched by review hunks. Still allow ordinary Markdown syntax highlighting/line styling elsewhere.
- Use CSS class names that do not look like Markdown rendering classes, e.g. `cm-ai-review-insert`, `cm-ai-review-delete`, `cm-ai-review-hunk`.

## Recommended V1

Build a custom CodeMirror extension:

- `StateField<PendingReviewState>` stores hunks and exposes direct decorations.
- `StateEffect`s set review state, clear review state, accept/reject hunk, and mark stale hunks.
- A pure diff step turns `{ currentMarkdown, proposedMarkdown }` into structured hunks.
- The editor document remains current user Markdown until accept.
- Green pending insertions are inline widgets or marks depending on whether they are part of the editable buffer.
- Deleted text is shown as a red inline/block widget at the deletion anchor.
- Replacements show deleted old text plus inserted new text in the same hunk.
- Hunk controls dispatch CodeMirror commands.
- Optional custom gutter is enabled only in review mode.
- A full unified diff remains available in the assistant review drawer.

Do not put this inside `src/editor/visualMarkdown`. Create a sibling editor feature, for example `src/editor/aiReview/`, because it has different state lifetime, command semantics, and failure modes.

## Open Questions For Prototype

- Should pending insertion text be selectable/copyable before accept? If yes, real document preview mode or widgets with custom copy behavior may be needed.
- Should users be allowed to edit pending inserted text before accepting? If yes, the proposed document-as-buffer model becomes more attractive, but save gating must be solved first.
- How should autosave behave while review is pending?
- What is the smallest conflict rule that feels fair when users type during review?
- Should hunk boundaries be line-based, paragraph-based, or Markdown AST block-based?
- Does `@codemirror/merge` expose enough diff/chunk data to reuse without taking over the UI?

## Decision

Use a custom CodeMirror review extension for the primary document-native AI review surface. Treat `@codemirror/merge` as a candidate for a separate full-diff drawer or as a reference implementation, not the first primary in-document UI.

The custom extension matches Iliad's existing CodeMirror architecture, keeps Markdown source canonical until acceptance, supports prose-specific hunk controls, and lets review mode deliberately coordinate with visual Markdown instead of inheriting merge-view assumptions.
