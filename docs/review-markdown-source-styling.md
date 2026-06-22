# Review Markdown Source Styling

## Problem

Review mode currently renders changed Markdown inconsistently:

- edit-file insertions use source-visible widgets;
- create-file and delete-file reviews only color normal editor lines;
- visual Markdown still transforms create/delete review lines, so headings can hide `#`
  until focus/selection changes;
- newly-created files can render as large green Markdown blocks while edited files
  render tighter source lines;
- red and green changed headings can have different typographic treatment in the
  same review.

This makes review mode unstable and weakens the core promise: the user should be
able to approve the exact Markdown change they are about to keep.

## Decision

All changed text in review mode uses **source-visible Markdown styling**.

Changed text means:

- red deleted text;
- green inserted text;
- all text in a pending created file;
- all text in a pending deleted file;
- inline tighten/edit-selection review text.

Source-visible Markdown styling has two requirements:

1. Show the exact Markdown source characters. Do not hide `#`, `**`, `_`, list
   markers, blockquote markers, backticks, links, table pipes, or math delimiters
   in changed regions.
2. Apply lightweight Markdown-aware typography to the line. A heading line still
   looks like a heading, a list line keeps list spacing, a blockquote line keeps
   quote spacing, but no source characters are replaced by widgets or hidden.

## Rendering Contract

- Edit-file hunks, create-file reviews, and delete-file reviews share one
  changed-line classifier and class contract. They do not need to use the exact
  same CodeMirror decoration type: edit insertions are block widgets, while
  create/delete reviews can style real document lines.
- The renderer outputs source text, not full rendered Markdown.
- Green and red lines use the same spacing model and only differ by color and
  deletion strike-through.
- A line beginning with `# ` through `###### ` receives heading typography while
  keeping the marker visible.
- Review source typography uses review-specific classes, not normal
  `cm-md-*` visual Markdown classes. The normal classes include syntax-hiding
  and spacing rules that are correct for ordinary editing but unsafe for review
  highlights.
- Setext heading syntax remains literal source. It may receive heading
  typography only when both the content line and marker line are changed, but
  this is not required for the first implementation.
- List and blockquote lines may receive the same indentation as normal editor
  source lines, but their marker text remains visible.
- Tables, images, links, embeds, task checkboxes, and math are not rendered into
  widgets inside changed regions.
- Clicking, selecting, double-clicking, or focusing a changed region must not
  change source visibility, typography, or highlight shape.
- Unchanged text outside review regions can continue using normal visual
  Markdown behavior.

## Implementation Plan

1. Add a small shared classifier for review source lines:
   - heading level;
   - list source line;
   - blockquote source line.
2. Make `aiReviewExtension` render create/delete files through source-visible
   source-line decorations instead of relying on normal line decorations alone.
3. Pass create/delete changed line ranges into `visualMarkdown` as blocked ranges
   so visual Markdown does not hide source or install widgets on review lines.
   For create/delete reviews, this range is the full document:
   `{ from: 1, to: max(1, lineCount) }`.
4. Render inserted source widgets per Markdown line, not as one joined block.
   Each source row gets its own classification and tight highlight. This avoids
   a mixed heading/list/paragraph block inheriting one style.
5. Apply the same review source typography classes to:
   - inserted block widgets;
   - collapsed one-line source widgets;
   - create/delete source lines.
6. Remove the full `ReviewMarkdown` rendering path for changed text.
   The `renderInsertedAsSource` option should be removed so `aiReviewExtension`
   cannot accidentally return to rendered Markdown for changed text. This avoids
   the current inconsistency where new-file review renders Markdown while
   edit-file review shows source.
7. Move visual Markdown review blocking before normal Markdown line decoration
   so blocked lines do not receive `cm-md-*` classes.
8. Normalize CSS so green and red changed lines use tight line-based background
   fills, with heading/list/blockquote typography layered on top.

## Tests

Add or update tests in `tests/editor/aiReviewExtension.test.ts`:

- Create-file review for `# Title\n\nBody` exposes literal `# Title` while
  applying an inserted review source heading class.
- Delete-file review for `# Title\n\nBody` exposes literal `# Title` while
  applying a removed review source heading class.
- Create-file review emits source widgets/decorations rather than relying only
  on normal line classes.
- Edit-file inserted heading hunk exposes literal `# New title` with the same
  review source heading class as create-file review.
- Removed heading line receives removed highlight and the same heading
  typography class as inserted heading lines.
- Visual Markdown receives full-document blocked ranges for create/delete
  reviews through `EditorPane`.
- `aiReviewExtension` exposes a single source-visible line/widget path for
  create, delete, and edit hunk additions/removals.
- Multi-line inserted hunks render separate source rows per line, each with its
  own source text and typography class.
- Changed lines preserve literal source for blockquotes, lists, task checkboxes,
  links, inline code, table pipes, and math delimiters.
- CSS tests or assertions cover review-specific classes so normal visual
  Markdown classes are not the review source styling dependency.

Manual visual checks:

- New file: the title line shows `# Title`, uses heading scale/weight, and has a
  tight green line highlight.
- Deleted file: the title line shows `# Title`, uses heading scale/weight, and
  has a tight red line highlight.
- Existing edit: red and green headings look typographically equivalent except
  for color/strike-through.
- Double-clicking or selecting a heading does not change source visibility or
  highlight geometry.

## Non-Goals

- Do not build a full Markdown renderer for changed source text.
- Do not alter normal visual Markdown behavior outside changed review regions.
- Do not change proposal accept/reject semantics.
- Do not change file-tree review status behavior.
