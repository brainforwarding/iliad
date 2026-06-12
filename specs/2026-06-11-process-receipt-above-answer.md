# Turn receipt becomes "Proceso", above the answer

Date: 2026-06-11
Status: implementation-ready (v2 — revised after a three-lens panel: UX/design-system, frontend/tests, product fidelity; review log at end)

## Reviewer brief

Read first: `specs/2026-06-11-conversation-history-budget-and-turn-receipts.md` (the receipt this spec repositions), `src/components/assistant/AssistantTranscript.tsx` (`AssistantTurnReceipt`), `src/assistant/assistantUtils.ts` (`turnReceiptSummary`, `turnReceiptDetailRows`, `receiptActivityTitle`), `src/styles/assistant.css` (`.assistant-turn-receipt`, `.assistant-entry` typography), `src/i18n/strings.ts` (`assistant.receipt`), `tests/assistant/AssistantTranscript.test.tsx`, `tests/assistant/assistantUtils.test.ts`. Design doctrine: light, minimal, Scandinavian; equivalent elements match; one accent; **best practices over invention** — the converged industry pattern for agent process disclosure is a collapsed header ABOVE the reply (ChatGPT "Thought for Ns", Claude tool rows precede the message, Cursor steps render before the text).

## Problem

The per-turn receipt shipped earlier today renders **below** the assistant's answer, at `--text-xs`, with the native `<details>` marker, and its no-tool fallback reads "Contexto: …". Three user-reported issues (owner feedback, 2026-06-11):

1. **Wrong position.** The receipt shows the process that *produced* the answer — reads, searches, what was in context. Chronologically it precedes the answer; below the prose it reads as a footnote, and in a long transcript it visually attaches to the *next* message as much as to its own. Industry has converged on process-above-reply.
2. **Wrong register.** At `--text-xs` it reads as fine print. The owner wants the summary line at the same type size as the response, with a clear expand affordance (chevron), like the process headers in ChatGPT/Claude.
3. **Wrong name.** "Contexto" describes only part of what the disclosure shows; the line summarizes the turn's *process*. It should be named "Proceso" (ES) / "Process" (EN).

## Product intent

Each assistant turn reads top-down in the order things happened: first a quiet one-line "Proceso" header (what the agent did to produce this), then the answer. The header is collapsed by default, expands with a chevron, and never competes visually with the answer text. During a run, the live trail already occupies this position; on completion it resolves into the receipt in place — one position, one mental model.

## Goals

- Receipt renders as the **first child** of the assistant/error entry, above the prose, with a small gap below it.
- Summary line at `--text-md` (the response's size), `var(--muted-2)`, weight 400 — same size as the answer, but receding (the answer keeps the eye; chrome supports).
- Custom chevron replacing the native `<details>` marker: rotates 90° when open, muted color, no new tokens.
- Naming: the summary always begins with the label **Proceso/Process**. With document-tool activity: `Proceso · Leyó 2 documentos · 1 búsqueda`. Without: just `Proceso` (the context rows live in the expanded body — the old "Contexto: 1 archivo + acceso…" line moves there as rows, where it already exists).
- Expanded body unchanged in content and order (past-tense activity rows → deduplicated manifest rows → provider line), still detail-register (`--text-xs`), plus one addition: when the manifest has **zero file-like items**, an explicit "No file included"/"Sin archivo incluido" row renders first — the old collapsed line carried that negative ("sin archivo"), and `current-architecture.md` leans on it to explain Codex workspace access; the negative must move into the body, not vanish.
- **Error entries keep the receipt below the error text** (panel decision): `.is-error` is a red-tinted bubble whose first line must be the error message; a same-size gray "Proceso" header leading it would invert hierarchy exactly where stakes are highest. Position flip applies to assistant entries only.
- Delete the now-dead code honestly: `contextManifestSummary` loses its last production caller and is removed along with its orphaned labels (`context.run`, `context.noFile`, `context.workspaceAccessLower`, and `context.files` if grep confirms no other caller) in both locales, plus their direct unit tests. `turnReceiptSummary` narrows to `(activities, labels)` (manifest param had no remaining use) and its JSDoc is rewritten — this consciously amends the morning spec's "byte-identical fallback" decision.
- EN/ES; no stored-schema or IPC changes; live trail during the run unchanged.

## Non-goals

- No change to what the receipt contains (that shipped this morning and is panel-reviewed).
- No streaming/auto-expanded state, no animation beyond the chevron rotation (respect `prefers-reduced-motion` by it being a trivial transform; no keyframes).
- No timestamps/duration in the header (ChatGPT's "for N seconds" is tied to thinking time we don't meter; do not fake it).
- No renaming of composer-side "Contexto" labels (chips, picker) — those genuinely are context-for-next-message; only the per-turn receipt is process.
- No restyling of `.assistant-comments-disclosure` (user-bubble selection-comments `<details>`): it is sent-message metadata at `--text-xs` inside the user bubble, a different register from the turn-process header — the native marker stays there by decision, not omission. If the divergence grates in practice, restyle it in a follow-up.

## Design

### Position & structure (`AssistantTranscript.tsx`)

```tsx
// assistant entry — receipt leads
<>
  {showTurnReceipt ? <AssistantTurnReceipt … /> : null}
  <AssistantMarkdown text={entry.text} />
</>
// error entry — error message leads, receipt stays below (panel decision)
<>
  <span className="assistant-error-text">{entry.text}</span>
  {showTurnReceipt ? <AssistantTurnReceipt … /> : null}
</>
```

The receipt keeps its `<details className="assistant-turn-receipt">` structure. The summary gains an explicit chevron element (lucide `ChevronRight`, **size 14** — matching the app's one existing chevron-beside-text precedent, `WorkspaceMenu`'s `ChevronDown size={14}`; class `assistant-receipt-chevron` per the file's `assistant-` prefix convention, `aria-hidden`). The native marker disappears by virtue of `display: inline-flex` (Chromium-only app; no `::-webkit-details-marker` needed — that selector is dead in modern Chromium).

### Summary line (`turnReceiptSummary`)

Signature narrows to `(activities, labels: Pick<…, "receipt">)`; output:

- With counted activity: `${labels.receipt.process} · ${parts.join(" · ")}` → "Process · Read 2 documents · 1 search" / "Proceso · Leyó 2 documentos · 1 búsqueda".
- Without counted activity (including activities that exist but are uncounted — started-only reads, lists): `labels.receipt.process` alone → "Process" / "Proceso".
- The `contextManifestSummary` fallback is gone, and so is the function: this was its last production caller. The positive information (current file, workspace access) already renders as expanded rows; the **negative** ("no file") gets the explicit body row described in Goals. The JSDoc is rewritten accordingly.

### Styles (`assistant.css`, tokens only — these are DELTAS to existing rules, not replacements)

- `.assistant-turn-receipt` root: **retained as-is** except `margin-top: 7px` → `margin-bottom: 7px` (assistant entries only; on error entries margin stays toward the top via a scoped override or the existing margin works because the receipt is last — verify in implementation). The root's `color: var(--muted-2)`, `font-size: var(--text-xs)`, `white-space: normal` are **load-bearing**: the body's activity-row titles inherit `--text-xs` from the root, and self-containment protects against `.assistant-entry` pre-wrap and `.is-error` coloring.
- `.assistant-turn-receipt summary`: full rule becomes `display: inline-flex; align-items: flex-start; gap: 5px; width: fit-content; cursor: pointer; color: var(--muted-2); font-size: var(--text-md); line-height: 1.42; font-weight: 400;` — summary alone reads at answer size; body stays detail size (two-register pattern).
- `.assistant-receipt-chevron`: `margin-top: 3px;` (centers the 14px glyph on the first text line when a long summary wraps — flex-start, not center, so wrapping keeps the chevron on line one), `color: var(--muted-3); transition: transform 120ms ease;` and `[open]` rotates 90°. Unguarded 120ms transform transitions are the established house pattern (tooltips); only keyframes get reduced-motion guards.
- **Delete** the now-dead `.assistant-turn-receipt summary::marker { color: var(--muted-3); }` rule.

### i18n (`strings.ts`)

`assistant.receipt.process`: "Process" / "Proceso". `assistant.context.noFileIncluded`: "No file included" / "Sin archivo incluido". Delete orphaned `context.run`, `context.noFile`, `context.workspaceAccessLower` (and `context.files` if grep confirms no remaining caller) in both locales. Existing count builders unchanged.

## Docs to update (same change — repo rule)

1. `docs/context-management/change-log.md` — bullet under `## 2026-06-11`: receipt moved above the answer, collapsed summary renamed to Process/Proceso at answer-size type with chevron, "Context: N files" collapsed fallback dropped (context rows remain in the expanded body; explicit no-file row added); link this spec.
2. `docs/context-management/current-architecture.md:229-231` — the sentence quoting `Contexto: sin archivo + acceso al espacio de trabajo` (a string that will no longer render anywhere) becomes: a `Sin archivo incluido` + `Acceso al espacio de trabajo · Disponible` pair of rows inside a turn's expanded `Proceso` receipt means the workspace runtime was available without a specific file read.
3. `decisions.md` needs **no** edits: ADR-0004/ADR-0014 govern manifest data, which is unchanged. Stated explicitly so nobody hunts for a missing ADR.

## Implementation plan

1. `turnReceiptSummary` narrowing + `contextManifestSummary`/labels deletion + no-file row in `turnReceiptDetailRows` + strings + unit tests.
2. `AssistantTranscript.tsx` reorder + chevron; `assistant.css` deltas.
3. Docs (section above). Update affected tests; `npm test`, `npm run typecheck`, `npm run lint:css`, `npm run build`; manual check of a long no-tool thread and an error turn in the app.

## Tests

House constraints (vitest node, `renderToStaticMarkup`, string/indexOf assertions). Complete inventory of breaking assertions (panel-verified):

- `assistantUtils.test.ts`:
  - "counts distinct completed reads…" (≈:447): expectations gain the `Process · ` / `Proceso · ` prefix.
  - "does not count reads or searches stuck in started…" (≈:451): expected value becomes bare "Process" (uncounted-activities case — distinct from zero activities, keep both).
  - "falls back byte-identically to the context summary…" (≈:463): rewritten — bare label, and `contextManifestSummary` is gone (its direct tests at ≈:142-308 are deleted with it).
  - New: `turnReceiptDetailRows` renders the no-file row when zero file-like items, and not otherwise.
- `AssistantTranscript.test.tsx`:
  - **New** ordering assertions (these replace nothing — no receipt-after-prose indexOf assertions exist): receipt index < `assistant-markdown` index on assistant entries; error-text index < receipt index on error entries. The existing **internal** body-ordering indexOf assertions (≈:295-300, activities < manifest rows < provider) stay untouched.
  - "renders assistant context disclosure separately from prose" (≈:67): summary assertion becomes "Process"; context rows asserted in the body.
  - "renders a collapsed permanent receipt…" (≈:229): the `Context: 1 file + workspace access` ×2 count becomes "Process" ×2; `not.toContain("<details open")` stays here.
  - "renders receipts on error entries…" (≈:338): the ×1 fallback-string count becomes a "Process" count; the stale comment at ≈:378 is rewritten.
  - Chevron present (`assistant-receipt-chevron`); marker suppression is CSS-only (not assertable; noted).
  - Live-trail test stays green unmodified (prop-vs-entry separation untouched).

## Risks & mitigations

- **Summary loses information when collapsed (no-tool turns show just "Proceso").** Accepted with eyes open: the cited precedents (ChatGPT/Claude) are *conditional* headers, ours is unconditional — uniform position + one-click body is the trade. Verify a long no-tool conversation in the app; if the repetition grates, the dial is `--muted-3`, never a size reduction.
- **`--text-md` summary competing with the answer.** Mitigated by `--muted-2` + weight 400; the answer is `--ink-3`.
- **Error-bubble hierarchy.** Resolved by keeping receipt-below on error entries (decision above).
- **Test churn:** fully enumerated above; confined to two test files.

## Review log (v1 → v2)

Three-lens panel. **Product (needs_revision)**: BLOCKER — docs section was missing (repo rule); added with the exact `current-architecture.md` line that would have gone stale. "Information moved, not removed" was false for the no-file negative → explicit "Sin archivo incluido" body row added. **UX (approve_with_changes)**: error entries keep receipt below (gray header must not lead the red bubble); chevron 14px per the WorkspaceMenu precedent; comments-disclosure divergence recorded as a decision in non-goals; CSS restated as deltas with cursor/weight/fit-content retained, flex-start chevron alignment for wrapped summaries, dead `::marker` rule deleted; bare-"Proceso" precedent caveat acknowledged (conditional vs unconditional). **Frontend (approve_with_changes)**: complete breaking-test inventory (two transcript tests + the started-only assistantUtils case the spec missed); "replaces indexOf assertions" claim corrected (they are new; internal body-ordering assertions stay); root CSS rule load-bearing facts documented (`--text-xs` inheritance for body rows, self-containment); `::-webkit-details-marker` dropped as dead in Chromium; `assistant-receipt-chevron` naming per file convention; `contextManifestSummary` + orphaned labels deletion decided; 120ms transform transition confirmed as house pattern.
