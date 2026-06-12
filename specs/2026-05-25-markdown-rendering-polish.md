# Markdown Rendering Polish

## Problem

Iliad's visual Markdown layer has three visible gaps:

- Inline Markdown combinations are fragile. In particular, `**[label](url)**` hides the bold markers but leaves raw link syntax visible because strong decoration blocks the later link replacement.
- Assistant answers render as plain text, so headings, lists, emphasis, links, code, blockquotes, tables, and math syntax remain visible in chat.
- Math has no rendered form. The Typora reference in this repo calls math a core writing-surface feature and notes Typora uses MathJax with inline math, display math, chemistry support, and optional numbering.
- Pending newly-created documents are shown in the editor review surface with raw Markdown because `create_file` review mode blocks visual Markdown across the whole document.

## Goals

1. Render common nested inline combinations correctly in the editor reading view:
   - `**[example.com](https://example.com)**`
   - `*[Android](https://play.google.com/...)*`
   - `[**Android**](https://play.google.com/...)`
   - `[*iPhone*](https://apps.apple.com/...)`
   - combinations with inline code or math labels should not create unsafe links inside code/math source.
   - table-cell inline Markdown should use the same visible behavior where practical, so tables do not regress into a separate dialect.
2. Render assistant prose as Markdown while keeping existing context disclosure rows separate from answer text.
3. Add attractive math rendering:
   - inline `$...$`
   - display `$$...$$`
   - fenced multi-line display blocks delimited by standalone `$$`
   - assistant messages using Markdown math through the same visual style.
4. Render pending created documents with normal visual Markdown while keeping the inserted-line review tint and toolbar actions.
5. Keep raw Markdown source available whenever the caret or selection intersects the rendered source range.

## Non-Goals

- No full Markdown AST renderer inside CodeMirror.
- No `\(...\)`, `\[...\]`, fenced ```math blocks, math authoring popover, equation numbering, cross-references, custom macro settings, chemistry extension UI, physics package parity, or force-refresh command in this pass.
- No Mermaid, diagram, footnote, reference-link, TOC, or export work.
- No database, API, permissions, or deployment-provider changes.

## UX

- Editor inactive/readable lines should look like clean prose. Syntax markers for strong, emphasis, links, inline code, and math are hidden.
- Links remain directly clickable when rendered. Hover and click behavior should match existing rendered links.
- If the caret enters a link, inline math span, or display math block, that source becomes editable raw Markdown.
- Assistant messages should use compact chat typography, not the document editor's large prose scale. Lists, tables, blockquotes, code, and math should fit inside the panel without horizontal page overflow; wide code, tables, and display math can scroll inside their own block.
- Assistant links must not execute unsafe schemes. Web, mail, local, and relative links may render as anchors; `javascript:` and other unsafe schemes should render inertly.
- Raw HTML in assistant messages should render as text, not execute.
- Pending create-file review should still show the green inserted-line background and the create/discard toolbar, but the document body should render headings, tables, links, and math.

## Implementation

### Editor Inline Links And Formatting

- Replace link rendering in `src/editor/visualMarkdown/inline.ts` from a whole-link replacement widget to source-preserving decorations:
  - hide `[` plus `](` plus `href)` syntax with zero-width replacement widgets;
  - mark the visible label range with `cm-md-link` and `data-cm-md-link-href`;
  - install a delegated click/mousedown handler in the `visualMarkdown` extension to open marked link labels.
- Keep image rendering as a replacement widget.
- Treat strong/emphasis as style decorations, not hard blockers for link rendering.
- Keep inline code and math as hard blockers for parsing new link syntax, except when the blocker is wholly inside a link label.
- Update the table-cell inline renderer so its link/strong/emphasis/code/math behavior matches the normal inline renderer for the supported combinations.

### Editor Math

- Add KaTeX for math rendering. This is a deliberate first-pass tradeoff: Typora uses MathJax and has broader extension support, but KaTeX gives synchronous, high-quality TeX-font rendering inside CodeMirror widgets and compact React-rendered chat output. MathJax parity remains out of scope.
- Add inline math replacement widgets for inactive `$...$` spans.
- Add display math block collection in the visual Markdown pass:
  - one-line `$$...$$`
  - multi-line standalone `$$` delimiter blocks
  - render as a block widget when no line in that block is active or review-blocked.
- Render errors as a small inline/block fallback that shows the original TeX escaped as text, not as HTML.

### Assistant Markdown

- Add a small `AssistantMarkdown` component using `react-markdown`, `remark-gfm`, `remark-math`, and `rehype-katex`.
- Do not enable raw HTML.
- Render links as anchors with `target="_blank"` and `rel="noreferrer"` only for safe URL schemes; unsafe schemes render as plain text or inert anchors without `href`.
- Keep `AssistantContextDisclosure` outside the rendered Markdown tree.

### Pending Create Documents

- Stop passing an all-line `blockedLineRanges` value to `visualMarkdown` for `create_file` review mode.
- Continue using `aiReviewExtension` line decorations for inserted-line tint.
- Keep edit-file changed-line blocking unchanged for now, because inserted replacement widgets in edit hunks are not yet visual-Markdown-aware.

## Tests

- Add assistant transcript rendering tests for Markdown headings/lists/strong links and math output.
- Add assistant transcript security tests for raw HTML and unsafe link schemes.
- Add pure inline rendering tests for link/style source ranges:
  - bold-wrapped link renders one link label range and strong markers do not block it;
  - link labels containing strong markers produce both link and strong ranges;
  - code spans containing link-like text do not produce links.
- Add table-cell tests for the same supported inline combinations.
- Add math range tests for inline and display math block detection.
- Run `npm test`, `npm run typecheck`, and `npm run build`.
- Start the app locally and inspect editor/assistant rendering with a Markdown sample that includes bold links, assistant Markdown, math, and a pending created document if practical.

## Rollout

This repo has a single trunk branch, `master`, and no `.github` workflow directory in the current checkout. Ship from:

```text
codex/markdown-rendering-polish -> master
```

There are no database migrations or separate deploy surfaces for this renderer-only change.

## Risks

- CodeMirror decoration overlap can be subtle. Link labels should use mark decorations and delegated events to avoid widget overlap conflicts with strong/emphasis.
- KaTeX supports a large TeX subset but is not MathJax. Typora's physics/mhchem parity is out of scope for this pass.
- Assistant Markdown rendering changes typography and spacing in a narrow panel; CSS needs explicit compact rules for tables, code, and math overflow.
