# Anchored edits: SEARCH/REPLACE blocks (editing a word must not rewrite the document)

Date: 2026-06-11
Status: implementation-ready (v2 — revised after a three-lens panel; review log at end)

## Reviewer brief

Read first: `electron/agent/proposalDrafts.ts` (the FULL_REPLACEMENT/NEW_DOCUMENT transport parser and visible-text stripping), `electron/agent/openai/prompts.ts` (instructions #-proposal contract lines), `electron/agent/markdownChangeContract.ts` + `electron/agent/diff.ts` + `electron/agent/reviewDiff.ts` (how drafts become proposals/hunks), `src/assistant/streaming.ts` (marker cutoff list), `electron/agent/openai/client.ts` (`providerResponseFromOpenAiPayload` → `parseLegacyProposalDrafts`). Industry: Aider's SEARCH/REPLACE blocks are the battle-tested cross-model targeted-edit format; Claude Code's `Edit(old_string, new_string)` is the same contract as a tool. Codex's native patches already give us anchored edits on that runtime — this spec closes the gap on the OpenAI path only.

## Problem

On the OpenAI path, every edit — even a one-word fix — requires the model to emit the **entire replacement document** (`FULL_REPLACEMENT:` + full fenced Markdown). For long documents this is slow, expensive (regenerating thousands of unchanged tokens), and risky: regenerating 5 pages to change one word invites unrequested "improvements" and dropped details. The review-first pipeline downstream (diff, hunks, per-hunk accept) is already shaped for targeted changes; only the generation contract is whole-file.

## Product intent

"Corrige el typo del título" produces a proposal in seconds whose diff touches exactly the typo — the rest of the document is byte-identical **by construction**, not by hope. Source-as-contract, enforced at the transport level.

## Goals

- A new anchored-edit transport on the OpenAI path: one or more Aider-style blocks, no label, no fences (robust to Markdown content that itself contains fences):

  ```
  <<<<<<< SEARCH
  exact existing text, copied verbatim
  =======
  replacement text
  >>>>>>> REPLACE
  ```

- Blocks apply sequentially to the active-file snapshot the request carried (`activeFile.content` — the same base the proposal pipeline already trusts); each SEARCH must match **exactly once** in the current working text (zero or multiple matches → the whole edit fails closed).
- The result feeds the existing pipeline unchanged: an `edit_file` draft with `baseContent` + computed `replacement` → same diff, same hunks, same review UI.
- `FULL_REPLACEMENT` stays for genuine rewrites; `NEW_DOCUMENT` unchanged; prompt instructions steer the model to anchored blocks for targeted edits with an exact-copy admonition.
- Streamed answers never show the block machinery (marker cutoff gains `<<<<<<< SEARCH`).
- Codex and remote paths untouched.

## Non-goals

- No multi-file anchored edits (the active document only, like FULL_REPLACEMENT today).
- No fuzzy matching or retry loops (exact-match or fail closed; the model self-corrects on the next turn from the deterministic failure sentence).
- No tool-call variant (the marker transport is the established Iliad contract; converting proposals to tool calls is a separate decision).

## Design

### Parsing & application (`proposalDrafts.ts`)

- `parseAnchoredEditBlocks(text)`: scans for line-anchored `<<<<<<< SEARCH` / `=======` / `>>>>>>> REPLACE` triplets — **case-insensitive marker keywords** (the `/gi` convention shared with FULL_REPLACEMENT and the streaming-cutoff invariant), tolerant of trailing whitespace; the model text is normalized `\r\n`→`\n` once before parsing (CRLF-on-disk documents fail matching closed — documented limitation). **Setext collision (the panel blocker): a Markdown setext underline is itself a line-anchored `=======`**, so a block may contain several divider candidates. Blocks therefore carry ALL candidate splits, and `applyAnchoredEdits` resolves them against the working text: a block applies iff **exactly one** candidate split has a SEARCH that matches exactly once; zero or multiple viable splits → fail closed. Empty SEARCH → malformed → fail closed (no Aider-style insert semantics in v1). Malformed/unterminated structure → nothing parses.
- Precedence: if a `FULL_REPLACEMENT` block exists, it wins and anchored blocks are ignored (a model emitting both meant the rewrite). `NEW_DOCUMENT` may coexist with anchored edits (edit active doc + create annex), same as it coexists with FULL_REPLACEMENT today.
- `applyAnchoredEdits(baseContent, blocks)`: sequential application — each block's SEARCH is matched against the **post-previous-application** text; `indexOf` + second-occurrence check for uniqueness; zero matches → `{ ok: false, reason: "not_found", blockIndex }`; multiple → `{ ok: false, reason: "ambiguous", blockIndex }`. Success → final replacement string.
- **Failure plumbing (specified)**: `parseLegacyProposalDrafts` is superseded by `parseProposalDrafts(request, text)` returning `{ drafts, anchoredEditFailed: boolean }` (the legacy export remains as a thin wrapper). `providerResponseFromOpenAiPayload` threads the failure flag into `sanitizeLegacyAssistantText` as a third state: failure with no drafts → the visible text **is** the localized failure sentence ("No pude aplicar la edición propuesta — pídeme que lo intente de nuevo." / "I could not apply the proposed edit — ask me to try again."), replacing the model's mandated one-liner (appending would self-contradict); failure alongside a successful NEW_DOCUMENT draft → proposal sentence **plus** the failure sentence (the cross product the v1 test plan missed). Anchored blocks with no `activeFile` → plain strip, no failure sentence (nothing was promised). Applied result identical to `baseContent` → no draft, silent (the FULL_REPLACEMENT no-op convention).
- Visible-text sanitation: anchored block ranges strip like FULL_REPLACEMENT transport; `hasLegacyProposalTransport` includes them (its real effect: stray ```diff blocks strip even on the no-draft path — the one-sentence rule stays gated on drafts); `extractSummary` runs on text with anchored ranges stripped so marker lines can never become the proposal summary. **Transport interleave**: `nextTransportLabelIndex` treats `<<<<<<< SEARCH` as a section boundary so a NEW_DOCUMENT fence scan can never swallow a trailing anchored block whose body contains ``` fences. Precedence trigger defined precisely as `extractFullReplacement(text) !== null` (a malformed FULL_REPLACEMENT label without a fence falls through to the anchored branch).

### Prompt contract (OpenAI local instructions)

Per-path rewrite of the edit instruction: targeted edits → one-sentence visible explanation + anchored blocks (**no ```diff block** — the review diff is computed locally; emitting one would waste exactly the tokens this spec saves), SEARCH copied exactly and unique (include surrounding lines to disambiguate), multiple blocks applied top to bottom; rewrites → the existing ```diff + `FULL_REPLACEMENT:` path, keeping the label and the "complete replacement for the active document" completeness rule (both pinned by existing tests). NEW_DOCUMENT unchanged. **Remote**: the v1 claim that proposals are "stripped on remote anyway" was false — remote drops drafts but passes text raw, and Telegram fails closed only on `FULL_REPLACEMENT|NEW_DOCUMENT` markers; `containsProposalMarker` in `telegramRemoteService.ts` gains the anchored marker so leaked blocks fail the request closed instead of reaching Telegram as raw conflict machinery.

### Streaming

`streamCutMarkers` (in `src/assistant/streaming.ts`) gains `"<<<<<<< search"` (the existing case-insensitive + longest-prefix-holdback machinery covers splits; a bare trailing `<` run is held back).

## Docs to update (same change — repo rule)

1. `docs/context-management/decisions.md` — **ADR-0019 (accepted)** "Targeted edits are anchored": the OpenAI-path edit transport is exact-match SEARCH/REPLACE applied to the request's active-file snapshot, failing closed on zero/ambiguous matches; FULL_REPLACEMENT remains the rewrite path; untouched regions are byte-identical by construction (source-as-contract at the transport level).
2. `docs/architecture.md` agent boundary paragraph — "one review-first contract" sentence gains "with anchored targeted edits".
3. `docs/context-management/change-log.md` — entry.

## Implementation plan

1. Parser + applier + precedence + draft branch + sanitation (pure functions in `proposalDrafts.ts`). Verify: unit tests.
2. Prompt lines; streaming marker. Verify: prompt + streaming tests.
3. Docs. Full pass: `npm test`, typecheck, build; manual smoke (typo fix on a long doc → 1-hunk diff; rewrite request → FULL_REPLACEMENT still works; deliberately ambiguous SEARCH → failure sentence).

## Tests

- Parser: single block; multiple blocks in order; CRLF; content containing ``` fences and `=======`-like prose inside SEARCH/REPLACE bodies (only line-anchored marker lines delimit); unterminated block → nothing parsed; markers inside fenced code in prose (still parsed — markers are line-anchored and the prompt reserves them; pin this).
- Application: unique match replaces; second block matching text created by the first (sequential semantics pinned); zero matches → not_found; two matches → ambiguous; whole-file SEARCH works (degenerate but legal); empty REPLACE deletes.
- Draft integration: anchored success → `edit_file` draft with byte-identical untouched regions (assert prefix/suffix equality), unifiedDiff non-empty; FULL_REPLACEMENT present → anchored ignored; anchored + NEW_DOCUMENT → both drafts; failure → no draft + localized sentence EN/ES + blocks stripped from visible text; no activeFile → no anchored draft.
- Streaming: `visibleStreamingText` cuts at `<<<<<<< SEARCH` and holds back split prefixes (`<<<<`).
- Prompts: instruction text present (local), absent (remote).

## Risks & mitigations

- **Model copies SEARCH inexactly** (the classic failure): exact-copy admonition + unique-match requirement + fail-closed + deterministic retry sentence; Aider's experience says frontier models handle this contract well.
- **Marker collision with document content**: markers are line-anchored, 7-char git-conflict style; a Markdown doc legitimately containing a git conflict block could collide — the parse-from-model-output side only ever sees model text, and SEARCH bodies containing marker-like lines fail parse closed rather than misapply. Pinned by test.
- **Sequential drift**: each block matches post-application text — deliberate (lets block 2 reference block 1's output) and pinned by test.

## Review log (v1 → v2)

Three-lens panel. **Parser (needs_revision)**: BLOCKER — setext underlines are line-anchored `=======` lines, so the fail-closed claim was false (a setext-section SEARCH would misparse and misapply); adopted the resolve-by-match rule (every divider candidate is tried; exactly one viable split or fail closed). Empty SEARCH → malformed. Markers made case-insensitive (restores the streaming invariant). CRLF: model text normalized once; CRLF-on-disk fails closed, documented. No-op guard replicated; extractSummary runs on stripped text; precedence defined as `extractFullReplacement !== null`; adjacency test added. **Pipeline (needs_revision)**: failure-sentence plumbing specified (`parseProposalDrafts` returns the failure flag; the sentence REPLACES the mandated one-liner; the failure+NEW_DOCUMENT cross product appends both); `hasLegacyProposalTransport` role corrected (diff-block stripping, not the one-sentence gate); prompt rewrite drops ```diff for anchored edits and keeps the pinned FULL_REPLACEMENT strings; trailing-`<` holdback verified transient with a prose test added. **Tests/docs (approve_with_changes)**: remote reality corrected (reject-not-strip; `containsProposalMarker` extended + fail-closed test); NEW_DOCUMENT fence-scan swallowing fixed via the section-boundary rule; ADR-0019 confirmed free; architecture.md:307 bullet named; new `tests/agent/proposalDrafts.test.ts` (no barrel re-exports — module imports per house precedent); inventory of must-stay-green transport pins recorded.
