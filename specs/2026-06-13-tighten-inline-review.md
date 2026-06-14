# Tighten: safe-unit inline review diff

Date: 2026-06-13
Status: implementation spec
Scope: Tighten selection rewrite only.

## Problem

The current Tighten result is shown in a floating card and accept replaces the
exact selected character range. That is mechanically stale-safe, but not
semantically safe: users can select a substring inside a word, sentence, or
paragraph. The model then rewrites that substring as if it were a standalone
passage, and accept splices it into the surrounding document. This can produce
broken joins such as `docuLista`.

The UI also hides the true resulting document until after accept. A card can
look plausible while the in-document splice is wrong.

## Goals

- Keep Tighten single-shot, selection-scoped, review-first, and local to the
  open editor.
- Replace the floating rewrite card with the existing in-document review UI:
  removed text in place, inserted rewrite below, accept/reject buttons in the
  document.
- Treat the user's selection as intent, not necessarily as the replacement
  boundary.
- Expand the replacement boundary to a safe text unit before sending the model:
  prefer the containing paragraph/list item/table row/code block line group.
- Send enough local context for the model to produce a complete replacement of
  that safe unit.
- Accept only if the same file is still open and the safe-unit text at the
  target offsets is unchanged.
- Do not create agent proposals, chat messages, persisted review records, or
  transcript entries.

## Non-Goals

- Do not route Tighten through chat history or the proposal store.
- Do not change the Codex-first/OpenAI-fallback runtime behavior from
  `2026-06-13-tighten-runtime-handoff.md`.
- Do not add multi-hunk Tighten in this pass.
- Do not solve arbitrary Markdown AST rewriting. The safe-unit detection should
  be conservative and predictable.

## UX

1. User selects text.
2. Existing segmented selection pill appears with `Comment` and `Tighten`.
3. User clicks `Tighten` or presses `Mod-Shift-J`.
4. The app expands the selection to a safe unit and highlights that whole unit
   while working.
5. On success, the editor shows an ephemeral inline diff using the same visual
   language as normal agent review:
   - original safe unit marked as removed
   - replacement rendered as inserted content
   - accept/reject buttons inside the inserted block
6. Accept replaces the whole safe unit in one undoable transaction.
7. Reject/Escape/typing/file switch dismisses the ephemeral diff.

Status chips remain acceptable for transient states: `working`, `already tight`,
and provider errors. The rewrite card is removed.

## Safe Unit Selection

Input: current document text and user selection offsets.

Rules:

- Clamp and normalize the selection to `{ from, to }`.
- If selection is empty, whitespace-only, or over the input cap after expansion,
  do not run.
- Expand to the smallest coherent unit that contains the selection:
  - If inside a fenced code block, use the full fenced block.
  - Else if inside a table, use the full contiguous table.
  - Else if inside a numbered or bulleted list item, use that list item,
    including wrapped continuation lines and nested child items.
  - Else use the paragraph block bounded by blank lines.
  - Preserve leading/trailing newlines outside the block; they are not part of
    the replacement range.
- The resulting range is the only range previewed and accepted.
- The resulting range must align to CodeMirror/source line boundaries because
  `aiReviewExtension` is line-oriented. If a future implementation needs
  character-range diffs, that belongs in a separate extension change.

This deliberately favors paragraph-level replacement over character-level
splicing. It may rewrite slightly more than the user selected, but the preview
shows the exact change before accept.

## Model Request

Renderer sends `tighten:run` the safe unit text, not the raw selection slice,
plus the selected span relative to that safe unit:

```ts
{
  requestId: string;
  text: string; // safe unit
  language: "en" | "es";
  selection?: { from: number; to: number }; // relative to text
}
```

Main validates the relative selection bounds. If invalid or omitted, the whole
safe unit is treated as the focus. Main then constructs the actual model input
by wrapping the focused span in fixed sentinel markers and instructing the model
to return only the rewritten marked text without markers or surrounding context.
Main merges that selected rewrite back into the safe unit as
`unchanged prefix + rewritten selection + unchanged suffix`, so text outside the
user's selection cannot be changed by the model.

Main process remains authoritative for:

- trust gate
- language validation
- length cap
- runtime selection
- timeout/cancellation
- output cleaning and selected-span merge

The renderer may compute the safe unit for UX and preview, but main should still
validate and cap the final text it receives. No API keys or account state cross
to the renderer.

Line endings: Tighten must preserve the dominant line ending of the original
safe unit on accept. Multi-line CRLF content must not silently become LF.

## Data Flow

Renderer-local state:

```ts
type TightenEphemeralReview =
  | { phase: "idle" }
  | { phase: "working"; requestId: string; range: SafeRange }
  | { phase: "review"; requestId: string; range: SafeRange; rewrite: string }
  | { phase: "alreadyTight"; anchorPos: number }
  | { phase: "error"; reason: TightenFailureReason; anchorPos: number };
```

`SafeRange` contains:

```ts
{
  from: number;
  to: number;
  originalText: string;
  selectedFrom: number; // relative to originalText
  selectedTo: number;   // relative to originalText
  filePath: string;
}
```

EditorPane converts `review` state into one synthetic `DisplayReviewHunk` and
passes it directly to `aiReviewExtension`. Do not route through
`reviewHunksForDisplay`, which assumes full-document proposal reconstruction.
Accept/reject callbacks are local closures, not agent proposal callbacks.
`rewrite` is still a complete safe-unit replacement, but it is assembled by main
from a selected-span model output; unselected text must match `originalText`
exactly.

The synthetic hunk mapping is line based:

- `oldStartLine` is the 1-based source line containing `SafeRange.from`.
- `oldLines` are the safe-unit source lines.
- `newLines` are the rewritten source lines.
- `displayOldStartLine`, `displayOldEndLine`, and `displayAnchorLine` are derived
  from that same safe-unit line span.

`visualMarkdown` must be blocked on these changed lines just like persistent
agent review lines, or hidden syntax/widgets can fight the review decorations.

## Acceptance Safety

Accept must synchronously verify:

- same active file path
- current request id still matches
- current document slice at `{ from, to }` equals `originalText`

Then dispatch:

```ts
view.dispatch({
  changes: { from, to, insert: rewrite },
  selection: { anchor: from + rewrite.length }
});
```

No `await` may occur between verification and dispatch.

## Lifecycle

- Persistent agent review takes precedence. If it appears while Tighten is
  working or reviewing, abort any in-flight Tighten request and clear the
  ephemeral state.
- Typing while Tighten is working aborts the request. Typing while an ephemeral
  Tighten review is visible rejects/dismisses that review.
- File switch, overlay unmount, and document replacement abort/clear Tighten and
  ignore any late result.
- Click-away should dismiss transient status/floating action, but must not
  swallow clicks on `aiReviewExtension` accept/reject buttons. The inserted
  review widget lives outside the overlay root.
- Escape rejects/dismisses an ephemeral Tighten review. Enter/Tab keyboard
  parity with the old card should be preserved where focus is inside the review
  buttons.

## Implementation Plan

1. Add a pure safe-range helper with tests.
2. Refactor Tighten overlay state so success produces an ephemeral review
   request instead of a card.
3. Let `EditorPane` render either persistent agent review or ephemeral Tighten
   review through `aiReviewExtension`; persistent review takes precedence.
4. Extend the renderer/main Tighten request with a relative selected span and
   construct marker-wrapped model input in main.
5. Remove Tighten card DOM/CSS and keep only action/status styles.
6. Update copy/comments from "card" to "inline review" where relevant.
7. Add regression tests for mid-word selection expansion, CRLF preservation,
   widget accept/reject, and stale-safe accept.

## Verification

- Unit tests for safe range expansion.
- Unit tests for marker-wrapped model input and output cleanup.
- Unit tests or component-level tests that ensure raw mid-word selection expands
  to the paragraph and never splices the rewrite into the middle of a word.
- Existing checks:
  - `npm run typecheck`
  - `npm run build`
  - `npm run lint:css`
  - `npm test`
