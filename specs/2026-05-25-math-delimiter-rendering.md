# Render math in all common delimiter formats (LaTeX `\(\)` / `\[\]`)

Date: 2026-05-25
Status: implemented (Codex-reviewed) — typecheck + 188 tests + build green

## Goal

Render math regardless of delimiter style, without rewriting the user's files.
Today the editor renders dollar math only (`$…$` inline, `$$…$$` display); agents
routinely emit LaTeX delimiters (`\(…\)`, `\[…\]`) which show as raw red source
(see `math.md`: bullets and the whole special-angles table). Make the editor
render the LaTeX delimiters too, matching what the AI-review preview already does.

`\(…\)` is valid, portable LaTeX; the on-disk source is the contract, so we
**render** it — we do not normalize files on disk.

## Scope

In: recognize `\(…\)` (inline) and `\[…\]` (display, block-only) in the editor and
the review preview, sharing one recognizer. Keep reveal-source-on-active-line and
the existing KaTeX error fallback (`renderKatexElement` try/catches already).

Also in (it surfaced during review): **fenced-code awareness**. `collectDisplayMathBlocks`
and the inline pass in `index.ts` currently do *not* skip fenced code, so `$$` (and
soon `\[…\]`) inside a ```` ``` ```` block is mis-rendered. Add a fence-line
collector and exclude fenced/inline-code from all math detection.

Out: rewriting files; non-math notations; sharing general Markdown parsing between
CodeMirror and react-markdown (share **only** math-delimiter recognition).

## Design (revised per Codex)

### 1. Shared recognizer — `src/markdown/mathDelimiters.ts` (pure, no editor/React deps)

A scanner, not regex `.replace`. Returns source ranges:

```ts
interface MathDelimiterRange {
  kind: "inline" | "display";
  delimiter: "latex-paren" | "latex-bracket";
  from: number; to: number;          // includes delimiters
  contentFrom: number; contentTo: number;
  tex: string;                       // trimmed inner
}
// Scans a single string for \(...\) (inline) given protected ranges to skip.
export function findLatexInlineMath(text: string, protectedRanges: Range[]): MathDelimiterRange[];
// Whole-line display detection for \[...\] (see §4).
```

Rules for `\(…\)`:
- **same line only**; opener `\(` and closer `\)` must be **unescaped** (count
  preceding backslashes — even ⇒ unescaped); inner text **non-empty**;
- never inside a protected range (inline code spans; fenced-code lines);
- **explicit tradeoff:** when a paired, unescaped `\(…\)` exists we intentionally
  treat it as math, overriding CommonMark's "escaped paren" meaning. Documented and
  accepted (matches author intent in practice).

### 2. Editor inline — `inline.ts`

Feed `collectInlineMarkdownRanges` the LaTeX inline ranges from the shared scanner
(using the code ranges it already computes as `protectedRanges`), alongside the
existing `$…$` ranges. `addInlineMathDecorations` renders both via `InlineMathWidget`
with the existing reveal-on-selection behavior. (Keep `$…$` detection as-is; do not
fold it into the shared util — Codex point 7.)

### 3. Editor display — `math.ts` + `index.ts`

Extend `collectDisplayMathBlocks` to also recognize `\[…\]`, **block-only**:
- full-line `^\s*\\\[(.+?)\\\]\s*$`, or
- standalone opener/closer lines `\[` … `\]` (mirror the `$$` fenced logic).
- Do **not** turn `before \[ x \] after` into display math.
Exclude fenced-code lines (see §5). Reuse `DisplayMathWidget` (legal block widget
via the `decorations.compute` source we already moved to).

### 4. Preview — `normalizeMathDelimiters` rewrite

Replace the unsafe global regex (rewrites across lines/inside code, can match the
2nd slash of `\\(`). Instead: compute protected code ranges (inline + fenced) in
the string, get LaTeX math ranges from the shared scanner, and rewrite **from the
end** (`\(→$`, block `\[→$$`). Preview keeps remark-math for `$`/`$$`.

### 5. Fenced code

Add `collectFencedCodeLineRanges(doc)` (track ``` ``` ```/`~~~` fences). `index.ts`
skips those lines before inline decorators; `collectDisplayMathBlocks` ignores
fences for `$$` and `\[…\]`. (Fixes the latent `$$`-in-fence bug too.)

### 6. Table cells — narrow

Tables replace the row before inline decorators run, but the table renderer already
supports `$…$` (`tables.ts` `appendInlineMarkdown`, ~:129). Least invasive: reuse the
shared inline scanner there to add `\(…\)` in cells. **Defer** display `\[…\]` in
tables and any broader table-parser change.

## Tests (vitest)

Recognizer/unit: `\(x\)` → inline range; `\\(x\\)` literal (no match); `\(` inside
inline code (simple and variable-length backticks) and inside a fenced block → no
match; prose escaped parens with no closer → no match; `\[ x \]` full-line and
standalone-line multiline → display; inline `a \[x\] b` → **not** display.
Editor: display `\[…\]` yields a block decoration when inactive, source when the
cursor is inside (mirror `visualMarkdownDisplayMath.test.ts`); `$$` inside a fence
is **not** a block. Preview: `normalizeMathDelimiters` agrees with the scanner on
the same fixtures and never rewrites inside code. Table: inline `\(…\)` in a cell
renders.

## Manual checks (`npm run typecheck`, `npm test`, `npm run build`)

Open `math.md`: every `\(…\)` bullet and `\[…\]` block renders KaTeX; the special-
angles table renders cell math; cursor entering a span reveals raw source; `$`/`$$`
docs and code blocks containing `$$`/`\(` are unchanged; no crash.
