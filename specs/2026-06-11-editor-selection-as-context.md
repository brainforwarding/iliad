# Editor selection as context (point instead of describe)

Date: 2026-06-11
Status: implementation-ready (v2 — revised after a three-lens panel; review log at end)

## Reviewer brief

Read first: `docs/research/agent-chat-ux-patterns.md` (the `Selection` chip was specced there in May and never built), `src/components/EditorPane.tsx` (extension wiring, updateListener precedents in `src/editor/selectionComments/extension.ts`), `src/components/assistant/AssistantComposer.tsx` (chips row), `src/assistant/useAssistantRun.ts` (`ask()` packet assembly), `electron/agent/documentContext.ts` (`preparedRunRequest` — the two whitelist copies that silently drop unknown fields), `electron/agent/openai/prompts.ts` + `codexAppServerProvider.ts` (`userInput` builders), `electron/agent/contextManifest.ts` (item reasons), `sanitizeRunRequest` in `agentService.ts`. Industry: Cursor and Claude Code (IDE) both treat the live editor selection as first-class context; the gesture is *pointing*, the cheapest instruction there is.

## Problem

Today the only ways to tell the agent "this passage" are prose descriptions or selection comments. Comments are batched margin-notes (many observations → one send); there is no path for the immediate gesture: select a paragraph, say "hazlo más cálido", send. The agent receives the whole active file but not *where the user is looking*, so it guesses or asks.

## Product intent

Select text in the editor → a quiet `Selección · líneas 12–18` chip joins the composer's context row → the next message carries that exact range as context, with a receipt row. Clearing the selection (or dismissing the chip) removes it. One-turn semantics, like every other attachment (ADR-0003).

## Goals

- Live selection (mouse or keyboard) surfaces as a dismissable composer chip when the assistant panel is open and a Markdown file is active.
- On send, the selection travels as **offsets only** (`from`/`to`); the main process slices the text from the *same active-file snapshot the request already carries* — one source of truth, nothing re-sent, nothing trusted from a second copy.
- Prompt section quoting the selection (range-capped) lands in both providers; manifest gains a `editor_selection` receipt row ("Selección · líneas 12–18"); the existing turn receipt renders it with no new UI.
- One-turn semantics made mechanical (the selection itself does not change on send): at send the skip-flag is set to the sent range (chip disappears though the editor selection persists); any range change re-arms; a failed run un-consumes so the chip returns (attachment-family parity).
- EN/ES; no stored-schema changes.

## Non-goals

- No multi-selection / multiple ranges (main selection only).
- No selection-anchored *editing* contract (that is spec F's anchored edits; this is context, not targeting).
- No change to selection comments (different intent: batched margin notes vs immediate pointing; both coexist — the chip and the comments chip already share the row vocabulary).
- No selection persistence across sends or documents.

## Design

### Renderer — tracking

- `EditorPane` gains optional `onActiveSelectionChange(range | null)`: an `EditorView.updateListener` reports the main selection **synchronously** whenever it differs from the last reported value (not just `selectionSet` — edits remap silently), null for empty/whitespace selections, forced null on `file.path` change.
- `App.tsx` keeps the live range in a **ref** (always current) and a ~150 ms debounced **state** copy for the chip display only. **Send reads the ref, never the debounced state** — the v1 "drift impossible" claim was false for debounced offsets; with the ref, offsets and `documentText` genuinely come from the same instant, and main re-validates bounds.

### Renderer — composer chip & send

- `AssistantComposer` renders, in the existing `.assistant-context-chips` row, a `Selección · líneas 12–18` chip (line numbers computed from `documentText` with a pure helper `lineRangeOf(text, from, to)`), with an `×` that sets a "skip" flag; the flag resets when the selection range changes. Chip styling mirrors the manual-attachment chip family (equivalent elements match); tooltip shows a short excerpt.
- `ask()` includes `editorSelection: { from, to }` in `startRun` when a non-dismissed selection exists and the active file is Markdown. Snapshot semantics: offsets are read at send time against the same `documentText` that becomes `activeFile.content` — they cannot drift, both come from the same render.

### Main process — validation, prompt, receipt

- `AgentRunRequest.editorSelection?: { from: number; to: number }` (both type files). **Pipeline survival**: explicitly added to `sanitizeRunRequest` *and* `preparedRunRequest` (the two field-by-field copies — the panel blocker from the history spec; an integration test pins it again).
- Sanitization: drop unless `request.activeFile` exists, integers, `0 ≤ from < to ≤ activeFile.content.length`. The *slice* happens in the prompt builder from `activeFile.content` — the model never receives a second copy of text the renderer claims was selected.
- Prompt section (shared helper `editorSelectionSection(request)` in `documentContext.ts`, both `userInput` builders, after the active-file block): header with the line range + fenced excerpt + `The current request refers to this selection unless it says otherwise.` Cap 6,000 chars (head-kept, explicit `[selection truncated]` note). **Surrogate repair after slicing** (a cap can split an emoji; drop the unpaired surrogate) and the **fence length is computed from the final truncated excerpt** (a backtick run straddling the cut is the case that matters).
- Manifest item: id `editor-selection`, kind `current_file`, relativePath = active file, inclusion `full`, new reason `editor_selection`, `estimatedTokens` of the slice, **and new optional `lineStart`/`lineEnd` numeric fields on `AgentRunContextItem` (both type files), whitelisted in `serializeContextItem`** — the v1 label-based design was unimplementable: the live manifest is serialized (labels recomputed from basename) and the renderer's display function returns `relativePath` before consulting labels. The display branch for `reason === "editor_selection"` is inserted **before** the relativePath early-return and renders `labels.context.selection(lineStart, lineEnd)`, falling back to the path when fields are absent. Round-trip test asserts the line fields and rendered label survive `serializeAgentRunContextManifest`.

## Docs to update (same change — repo rule)

1. `docs/context-management/decisions.md` — **ADR-0017 (accepted)** "Editor selection is one-turn context": when a non-empty editor selection exists at send, its offsets travel with the request; the main process slices the text from the active-file snapshot; one-turn like attachments (ADR-0003); always receipted.
2. `docs/context-management/README.md` — packet list gains "+ current editor selection (offsets into the active file), when one exists".
3. `docs/context-management/current-architecture.md` — packet section + a line in the example; bump status date.
4. `docs/context-management/change-log.md` — entry citing this spec and the May research recommendation finally landing.

## Implementation plan

1. Types + sanitize + prepared passthrough + prompt section + manifest item. Verify: unit + integration tests.
2. EditorPane listener + App state + composer chip + `ask()` wiring + i18n + chip CSS (tokens only, chip family). Verify: component/unit tests.
3. Docs. Full pass: `npm test`, typecheck, `lint:css`, build; manual smoke (select → chip → send → receipt row; dismiss; document switch clears).

## Tests

- Pure: `lineRangeOf` (CRLF, selection at EOF, single line); selection-section builder (cap + truncation note, fence escaping when the selection contains backticks — use a longer fence or indent, decide in implementation and pin it).
- Main: sanitize bounds (negative, reversed, beyond length, no active file → dropped); `preparedRunRequest` passthrough; both prompt builders include the section only when present; manifest item + reason round-trip (`contextManifest.test.ts`).
- Renderer: composer renders the chip with line labels EN/ES; dismissed chip → no `editorSelection` in the request (pure send-payload helper if `ask()` wiring is otherwise untestable); transcript receipt renders the selection row (existing detail-row machinery).

## Risks & mitigations

- **Offset drift between selection and snapshot**: impossible by construction (offsets and `documentText` read in the same `ask()` closure); validated again in main against the actual content length.
- **Chip noise while writing**: the chip appears only with a non-empty, non-whitespace selection and the panel open; deselecting (click anywhere) removes it — the canvas stays quiet.
- **Double cost (selection quoted on top of full file)**: capped excerpt; typical selections are small; the pointing value dominates a few hundred tokens.
- **Backtick-containing selections breaking the fence**: explicit test; longer-fence strategy.

## Review log (v1 → v2)

Three-lens panel. **Backend (needs_revision)**: BLOCKER — the line-range-in-label receipt design was unimplementable (live manifests are serialized; `serializeContextItem` recomputes labels from basename; the renderer display returns `relativePath` before labels) → added `lineStart`/`lineEnd` fields with serializer whitelist and a reason-keyed display branch above the relativePath return. "Drift impossible" was false under debounce → live ref read at send, debounce for chip display only. Surrogate repair at the cap; fence from the truncated excerpt. **UX (needs_revision)**: consumed-on-send mechanism specified (skip-flag = sent range; failed runs un-consume; new selection re-arms); settle-delay precedent corrected (180 ms, overlay-scoped). **Tests/docs**: ADR is **0017** (0016 taken by UI navigation); added CRLF/whole-doc/mid-emoji-cap/edit-then-send tests; existing tests unaffected (verified none pin the packet fields involved).
