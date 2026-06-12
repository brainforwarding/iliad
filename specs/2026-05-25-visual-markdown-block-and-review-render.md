# Visual Markdown block decorations + review render fixes

Date: 2026-05-25
Status: implemented (Codex-reviewed) — typecheck + 175 tests + build green

Two related editor bugs, both surfacing on a document with display math an agent
proposes:

1. **Crash on render** — a `$$…$$` display-math block throws `Block decorations
   may not be specified via plugins`, caught by `EditorErrorBoundary`.
2. **"Naked markdown" in review** — the green proposed block shows raw source
   instead of rendered Markdown.

> Codex review folded in (see "Review notes" per section). Net changes from the
> first draft: use a single **state-derived** decoration source (not a
> plugin+field split), **no `atomicRanges`**, active-line over **all** selection
> ranges, stricter React-widget lifecycle, the review widget gets its **own**
> styles/link handling (not `AssistantMarkdown`'s), and corrected math/test
> expectations.

## Bug 1 — block decoration from a ViewPlugin

### Root cause

`src/editor/visualMarkdown/index.ts:81-86` emits a **block** decoration
(`Decoration.replace({ widget: DisplayMathWidget, block: true })`) for display
math, but the `DecorationSet` is supplied through a **`ViewPlugin`**
(`index.ts:140-158`). CM6 forbids **function/plugin-provided** decorations from
introducing block widgets (`@codemirror/view` `index.d.ts:1311`: function-provided
decorations "must not introduce block widgets"), so it throws during the update
cycle. `safeBuildDecorations` (`index.ts:131-138`) can't catch it: building
succeeds; CM throws later while validating the plugin's `decorations` facet.

Trigger: only when the block is **inactive** (cursor outside) and not
review-blocked (`index.ts:73-89`) — i.e. on open / after clicking away.

### Fix (proper way) — single state-derived source

CM6 allows block widgets from decoration sources provided **directly from state**
(`StateField` or `EditorView.decorations.compute`), just not from a view
function/plugin. Per Codex, prefer collapsing the whole visual-markdown builder
to **one** state-derived source rather than a plugin + extra field (one
precedence domain, no duplicate display-math parsing, no future block-widget
regressions):

- Replace the `ViewPlugin` with
  `EditorView.decorations.compute(["doc", "selection"], (state) =>
  safeBuildDecorations(state, options))`.
- Refactor `buildDecorations` and the helpers it calls to take `EditorState`
  instead of `EditorView`. Confirmed the only `view` usage is selection:
  `isActiveLine` / `selectionIntersectsRange` (`activeRanges.ts:9,18`) read
  `view.state.selection`; `addLinkDecorations` / `addInlineMathDecorations`
  (`inline.ts:347,371`) use `view` only for `selectionIntersectsRange`. Change
  these signatures to `state`.
- Active-line must consider **all** selection ranges (keep `activeRanges.ts:9`
  semantics) — not just `selection.main`.
- The display-math `block: true` replace is now legal (state-derived). Keep the
  `cm-md-display-math-line` line decoration in the same builder.
- The builder must still **skip inner display-math lines** (and the opening /
  one-line `$$…$$` line) for inline decorations so `\circ`, `**`, etc. inside the
  block are never inline-decorated. Tighten the current `else if
  (insideDisplayMathBlock)` (`index.ts:90`) so the one-line `$$x$$` start is also
  excluded from inline passes.
- Keep the `linkHandler` (`EditorView.domEventHandlers`) as a separate extension.
- **No `atomicRanges`**: the model is "collapsed when inactive, reveal source on
  cursor enter"; atoms would make the cursor skip the block and fight that.
- Keep the `safeBuild` try/catch → `Decoration.none` fallback.

### Review notes addressed
- (1) Not "StateField only" — `decorations.compute` is the chosen, simpler form.
- (2) Single source instead of plugin+field.
- (3) No atomic ranges; all-range active-line check.

## Bug 2 — review preview shows raw source

### Root cause

`src/editor/aiReview/extension.ts:40-54` (`InsertedTextWidget.toDOM`) renders
proposed lines as a raw `<pre>`. It's a DOM widget outside the document, so
visual markdown never applies; for `edit_file` the changed real lines are also
`blockedLineRanges` (`EditorPane.tsx:135`) and intentionally skipped.

### Fix (proper way) — render Markdown in the widget, carefully

Render proposed Markdown with the app's `react-markdown` pipeline
(`remark-gfm` + `remark-math` + `rehype-katex`), but reuse only the **config**,
not `AssistantMarkdown`'s chat presentation.

- Extract a shared, presentation-agnostic renderer:
  `src/components/markdown/MarkdownContent.tsx` (remark/rehype plugins + a
  `components` map with safe links via `safeMarkdownHref`, a `className` prop, and
  an optional `onOpenLink`). Refactor `AssistantMarkdown` to use it while keeping
  its own `.assistant-markdown` class. The review widget uses a **new**
  `.cm-ai-review-rendered` class/CSS (not the chat styles).
- `InsertedTextWidget`:
  - mount a React root (`createRoot`) in `toDOM`; **`destroy(dom)`** unmounts it;
    precompute the joined text and include **labels** in `eq` to avoid needless
    remounts (consider `updateDOM` for content-only changes).
  - Wrap the rendered Markdown in a small **error boundary** with a **non-React
    `<pre>` fallback** (a bare `try/catch` around `root.render` is not reliable).
  - **CM-aware links**: the review link component must `preventDefault` +
    `stopPropagation` on `mousedown`/`click` and route through `onOpenLink`
    (thread `onOpenLink` from `EditorPane` → `aiReviewExtension` →
    `InsertedTextWidget`). The assistant link component does not do this.
- Math syntax: `remark-math` renders `$…$` (inline) and fenced `$$\n…\n$$`
  (display), and treats one-line `$$x$$` as **inline**. It does **not** parse
  LaTeX `\(…\)` / `\[…\]`. Add a tiny preprocessing step in `MarkdownContent`
  (or a remark plugin) converting `\(…\)`→`$…$` and `\[…\]`→`$$…$$` so
  agent-authored content renders. (Editor inline math is `$…$` only;
  `\(…\)` support in the editor itself is out of scope here.)
- KaTeX CSS: assistant already imports it; confirm it's in scope on the editor
  surface (import where the review widget styles live if needed).

### Review notes addressed
- (4) React-in-widget lifecycle: `destroy`/unmount, stable `eq` w/ labels +
  precomputed text, error-boundary fallback.
- (5) Reuse config not chat styles; CM-aware link handling.
- (6) Corrected math expectations; add `\(…\)`/`\[…\]` preprocessing.

## Ordering

Fix Bug 1 first — accepting math content lands `$$…$$` in the real doc and would
re-trigger the crash otherwise.

## Tests (vitest exists: `npm test`, `tests/editor/`)

Add focused tests (Codex point 7 — the crash is easy to reintroduce):

- `tests/editor/visualMarkdownDisplayMath.test.ts`: build decorations from a
  state with (a) one-line `$$x$$` and (b) fenced `$$ … $$`; assert a block
  replace decoration exists when **inactive**, and that source is shown (no block
  replace) when the selection is inside; assert inner lines get no inline decos.
- Blocked review ranges: lines within `blockedLineRanges` produce no
  display-math block decoration.
- `tests/...` for the review renderer: proposed Markdown with a heading, bold,
  `$x$`, and a `$$…$$` block renders to rendered DOM (not literal `#`/`**`), and
  an unsafe link (`javascript:`) is neutralized by `safeMarkdownHref`.
- Guard test: building visual-markdown decorations never returns a block widget
  from a plugin path (i.e. exercised through the `decorations.compute` source).

## Manual checks (after `npm run typecheck`, `npm test`, `npm run build`)

1. Doc with one-line and fenced display math → KaTeX when inactive, source when
   cursor enters; **no crash**; cursor in/out repeatedly stays stable.
2. Agent proposes headings/bold/`$…$`/`$$…$$` → green proposed block renders
   Markdown; Accept/Reject buttons still present and working.
3. Accept proposal → document renders math, no crash. Reject / partial-accept
   still work.
4. Links inside the rendered proposal open via `onOpenLink`, don't move the
   editor selection.
5. Existing visual-markdown behaviors (links, images, tables, setext headings)
   and `prefers-reduced-motion` unchanged; no perf regression on large docs.
