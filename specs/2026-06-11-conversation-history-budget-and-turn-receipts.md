# Conversation history budget + per-turn context receipts

Date: 2026-06-11
Status: implementation-ready (v2 — revised after a four-lens review panel: backend, UX/design-system, testing, product fidelity; review log at end)

## Reviewer brief

Read first: `docs/context-management/decisions.md` (ADR-0001..0005, 0009, 0010), `docs/context-management/current-architecture.md`, `docs/agent-vision.md` (Context Principles), `docs/research/agent-chat-ux-patterns.md` (tool rows recommendation), `electron/agent/documentContext.ts` (`preparedRunRequest`, `safeDisplayPath`), `electron/agent/openai/prompts.ts`, `electron/agent/runtime/codexAppServerProvider.ts` (`codexUserInput`), `electron/agent/contextManifest.ts`, `src/assistant/useAssistantRun.ts` (`ask()`, run-event listener), `src/components/assistant/AssistantTranscript.tsx`, `src/assistant/assistantUtils.ts`, `tests/assistant/AssistantTranscript.test.tsx`. Industry research (2026-06-11, live web survey — durably recorded in `docs/context-management/external-best-practices.md`, see Docs section): no leading agent product uses a fixed small history window; all use full-history-until-budget + compaction (Claude Code: clear old tool outputs → summarize, summary keeps files involved; Codex CLI: summary + last ~20k tokens of user messages verbatim; Cursor: summarize + searchable history files; OpenAI Agents SDK cookbook: trimming only for independent-turn conversations; Anthropic context engineering: just-in-time retrieval over lightweight identifiers).

## Problem

Two distinct problems, one change, because the second is the receipt for the first.

**1. History.** Both runtime providers truncate conversation history to the last 8 messages (`electron/agent/openai/prompts.ts:56` and `electron/agent/runtime/codexAppServerProvider.ts:833-834`, duplicated code). Chat history stores visible transcript text only (ADR-0005) — attachment content and tool results never persist across turns by design (fresh packet per turn, ADR-0001). The combination means: a document attached or read 10 turns ago has left the model's reachable world entirely — neither its content nor its *mention* survives. The model cannot "know to re-read it" because it no longer knows it existed. A fixed window of 8 is not industry practice for iterative agent chats and has the documented failure mode that earlier constraints and decisions silently vanish.

**2. Receipts.** The transcript spreads "what did the agent see/do" across three disconnected surfaces with three different lifetimes: composer chips (future, cleared on send), a live activity trail that is **discarded when the run ends** (`useAssistantRun.ts` clears `runActivities` in `ask()`'s `finally`; `AssistantTranscript.tsx:133` renders it only for the active status row), and a per-message `<details>` context disclosure that appears **only when the manifest signature changed** vs. the previous assistant message (`AssistantTranscript.tsx:100-118`, `contextManifestSignature`). Evidence evaporates; the disclosure's presence is unpredictable and its absence ambiguous. This contradicts our own documented principles: "evidence travels with the task", "Make every file read and proposed write visible" (`docs/research/agent-chat-ux-patterns.md`), and the context-manifest-as-receipt rule (ADR-0004).

## Product intent

The conversation the user sees is the conversation the model gets (up to an honest, generous budget), and every assistant turn carries its own permanent, collapsed receipt of what was read, searched, and included. Composer chips keep meaning "what the *next* message will include"; the turn receipt means "what *this* turn actually used"; nothing about a past turn ever disappears or depends on what the previous turn looked like.

## Goals

- Replace the fixed 8-message window with budget-based history selection (full visible history until a token budget), applied **once in the main process** so both providers and the manifest see the same selection.
- When messages are omitted: say so in the prompt deterministically, surface the omission in the manifest (the receipt must mirror the prompt), and give the model a lightweight identifier-only index of documents referenced earlier in the conversation so it can re-read them with its tools.
- Make the per-turn receipt permanent and uniform: every assistant entry that has a manifest or activities renders one collapsed disclosure combining activity rows and context inclusion rows, deduplicated. Remove the signature-gating heuristic. **Decided (panel-affirmed): always-on collapsed receipts; predictability is itself restraint — no suppression heuristics return.**
- Persist run activities into the turn's entry at run end (in-session), instead of discarding them. Attach receipts to error entries too — failed runs are when evidence matters most.
- Show what a sent user message carried: quiet attachment markers on the user entry for manually attached files.
- Update the context-management decision docs in the same change (repo rule).
- Full EN/ES support; no stored-schema changes.

## Non-goals

- **LLM compaction summary** (recorded as proposed ADR-0015, not built). With a 40k-token budget over text-only history, threads that exceed it are rare; the deterministic omission note + reference index keeps discoverability until compaction earns its complexity.
- Pinned/persistent attachments (ADR-0007 remains future); searchable history files; structured note-taking/memory.
- Changing one-turn attachment semantics (ADR-0003 stays).
- Persisting receipts/activities into the stored chat thread schema (`AgentChatHistoryEntry` untouched; restored threads degrade gracefully, the selection-comments precedent).
- Any change to proposal/review flow or composer chips. Telegram remote inherits the history budget via the shared path, nothing else.

## Design — history budget (main process)

### Selection happens once, in `preparedRunRequest`

New module `electron/agent/conversationHistory.ts` owning:

```ts
export const conversationHistoryTokenBudget = 40_000;

export function estimateTokensFromText(text: string): number; // moved here from contextManifest.ts (re-exported there for existing callers) to avoid an import cycle

export interface ConversationHistorySelection {
  included: Array<{ role: "user" | "assistant"; content: string }>;
  omittedCount: number;
}

export function selectConversationHistory(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  budgetTokens?: number // parameterized so the remote path can pass a smaller budget later without API change
): ConversationHistorySelection;

export function conversationHistorySection(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  omittedCount: number
): string; // the full "Recent thread..." prompt block, shared verbatim by both providers

export function sanitizePreviouslyReferencedDocuments(value: unknown): string[] | undefined;
```

- Selection: walk newest → oldest, include whole messages while the running total of `estimateTokensFromText` stays ≤ budget (a message landing exactly on the budget is included). The newest message is always included even if it alone exceeds the budget. Deterministic; no randomness or dates.
- **Where it runs**: inside `preparedRunRequest` (`electron/agent/documentContext.ts:258`) — NOT in the provider prompt builders. The prepared request carries `messages` already selected plus a new field `omittedHistoryMessageCount: number` on `AgentPreparedRunRequest` (and via the existing `Partial` pick on `AgentProviderRunRequest`). This is load-bearing three ways: (a) both providers see the same selection; (b) `buildAgentRunContextManifest`/`estimateInputTokens` receive the already-trimmed `messages`, so the receipt's token estimate is computed over what was actually sent — the v1 draft's honesty claim was false because `estimateInputTokens` summed *all* messages; (c) one filtering point exists for the reference index (below).
- `conversationHistorySection` renders: header `Recent thread:` or `Recent thread (N earlier messages omitted):` when `omittedCount > 0`, then the `ROLE: content` lines exactly as both providers format them today. Both `userInput()` (`openai/prompts.ts`) and `codexUserInput()` (`codexAppServerProvider.ts`) replace their `.slice(-8)` blocks with a call to it. English in both (prompt scaffolding is English; the respond-in-language directive is separate). `codexUserInput` is exported for tests (precedent: `codexFinalAssistantText`).
- **Omission receipt item** (the receipt mirrors the prompt): when `omittedCount > 0`, `buildContextItems` adds one item — new kind `conversation_history`, `id: "conversation-history-omitted"`, `inclusion: "excluded"`, `reason: "conversation_history_budget_omitted"`, `resultCount: omittedCount` (carried for display; the generic search-metadata path does not render it because that path is keyed to `model_directed_*` reasons). `contextManifestItemDisplayText` gains a reason-keyed branch returning `labels.context.historyOmitted(count)`; secondary is the existing `labels.context.excluded`. Both type unions (`src/types/iliad.ts`, `electron/agent/types.ts`), `contextItemKind`, `contextItemReason`, and `safeContextItemLabel` are extended.
- **Telegram remote**: inherits the budget through the same path. Known interaction: remote runs carry a hard deadline (`scheduleDeadlineCancellation`), and longer history grows time-to-first-token; the budget parameter exists so the remote path can pass a smaller budget later. No change now.

### Previously-referenced-documents index

New optional request field, renderer → main: `previouslyReferencedDocuments?: string[]` on `AgentRunRequest` (`electron/agent/types.ts` **and** `src/types/iliad.ts`, kept in sync per CLAUDE.md).

- **Renderer derivation** (pure helper in `src/assistant/`, wired in `ask()`): collect `relativePath` from prior **assistant AND error** entries' `contextManifest.items` where the item was actually included or read (`kind` ∈ {`current_file`, `document_read`} with `inclusion: "full"`) — error-entry manifests count because documents read during a failed run were still referenced (the panel confirmed failed runs can carry completed `document_read` items). Normalize via `normalizeRelativePath`, filter by `isVisibleMarkdownContextPath`, dedupe case-insensitively, exclude paths in this turn's packet known to the renderer (active file, current manual attachments), most-recently-referenced first, cap 20.
- Restored threads have no in-session manifests, so the index starts empty and rebuilds as the conversation continues. Accepted v1 limitation, stated here.
- **Pipeline survival (panel blocker)**: the field must be copied through BOTH whitelist copies — `sanitizeRunRequest` (`agentService.ts:878`) and `preparedRunRequest` (`documentContext.ts:258`); both rebuild requests field-by-field and would silently drop it. An integration test drives `preparedRunRequest(sanitizeRunRequest(...))` and asserts the field reaches the provider-facing request and the manifest items.
- **Sanitization**: `sanitizePreviouslyReferencedDocuments` applies the `safeDisplayPath` discipline (`documentContext.ts:530-561`: rejects control characters, backslashes, drive letters, non-normalized paths, hidden segments, ignored names; requires a Markdown extension) — NOT `safeRelativePath` from `contextManifest.ts`, which rejects none of the injection-relevant shapes (a filename containing a newline must never reach the index line). Export `safeDisplayPath` (or extract it) and have the sanitizer use it; cap 20; empty → `undefined`. Called from `sanitizeRunRequest`.
- **Authoritative same-turn exclusion (main process)**: the renderer cannot predict `@`-mention resolution (fuzzy/extensionless, resolved in `prepareExplicitDocumentContext`). After explicit context is resolved, `preparedRunRequest` drops index entries matching `activeFile.relativePath` or any `contextDocuments[].relativePath` (case-insensitive). Otherwise a doc could appear as full explicit context AND as "not included; re-read if needed" — a contradiction in both prompt and manifest.
- **Prompt line** (both providers, via the prepared request), only when non-empty: `` Documents referenced earlier in this conversation (not included; re-read with document tools if needed): `a.md`, `b.md` `` — each path backtick-wrapped (paths may contain commas/spaces; the backticks also mark the untrusted-data boundary). Identifiers only — never content (ADR-0009/0010 already instruct tool-based discovery).
- **Manifest items**: one per indexed path — `kind: "document_reference"` (existing kind), `inclusion: "reference"`, `reason: "conversation_reference_index"` (new allowed reason), `id: conversation-reference-${i}` (distinct from the existing `document-reference-${correlationId}` scheme; collisions would break `mergeContextManifestItems` dedupe and React keys). These items are excluded from the "N files" fallback summary by design (`isFileLikeContextItem` already excludes references) — stated so the implementer doesn't re-derive it.

## Design — per-turn receipts (renderer)

### Persist activities into the turn

- `useAssistantRun` keeps a ref mirror of merged activities, updated in the same `onRunEvent` handler that calls `mergeRunActivityEvent`. A single `resetRunActivities()` helper clears state + ref together and replaces **all seven** `setRunActivities([])` call sites (`useAssistantRun.ts:376, 1234, 1387, 1423, 1439, 1469, 1497` — workspace switch, ask start, ask finally, cancel, newChat, loadChatThread, clearChatHistory), so co-location is structural.
- A pure helper `buildRunOutcomeEntry` (new `src/assistant/runEntries.ts`) produces the outcome entry from the run result + activities snapshot — the logic-bearing decisions (attach `activities` when non-empty, attach `result.contextManifest` to error entries when present, omit empty fields) live in a node-testable function; `ask()` only calls it. Fields on `AssistantEntry`: `activities?: AgentActivityRunEvent[]` — **ephemeral, in-session only**, exactly like `selectionComments` (`visibleHistoryEntries` already strips non-schema fields by construction).
- Attach to the **assistant entry** on success and to the **error entry** on failure (both the error-result path, which can carry a failed-status manifest — `failedRunResponse` at `agentService.ts:269` — and the thrown-exception path, which has activities only). Cancel keeps current behavior (no entry; the `Canceled` status row is the record).

### One receipt component

Replace `AssistantContextDisclosure` and its signature gating with `AssistantTurnReceipt` in `AssistantTranscript.tsx`:

- Rendered on **every** assistant or error entry that has `contextManifest` or `activities` — no comparison with previous entries; two consecutive identical manifests render two receipts. `contextManifestSignature` is deleted (function and call site only — **no tests reference it**; the gating was never test-guarded).
- Collapsed `<details>` (no `open` attribute). Summary via `turnReceiptSummary(manifest, activities, labels)` in `assistantUtils.ts`:
  - With activities, action-first counts joined with " · ": reads = **distinct `relativePath` among `kind: "document_read"`, `status: "completed"`**; searches = count of `kind: "document_search"`, `status: "completed"`; failed reads = count of `kind: "document_read_failed"` (that kind is the failure signal; a `document_read` row stuck in `status: "started"` at run end renders in the body but is **not** counted). E.g. "Read 2 documents · 1 search · 1 read failed" / "Leyó 2 documentos · 1 búsqueda · 1 lectura fallida".
  - Without activities: fall back to `contextManifestSummary` — **byte-identical** to today's text ("Context: 1 file + workspace access"), which keeps the existing transcript test green.
- Expanded body, in order: activity rows → manifest detail rows → provider/model line. Three dedup/grouping rules:
  1. **No double listing**: when activity rows render, manifest detail rows whose `reason` starts with `model_directed_` are filtered out — the same read/search would otherwise appear twice (activity row + manifest row). The unfiltered manifest rows remain the fallback when there are no activities.
  2. **Reference index grouped into ONE row** (decided now, not v1.1): items with `reason: "conversation_reference_index"` collapse to a single row — primary `labels.context.referencedEarlier(count)`, secondary `labels.context.reference`. The manifest keeps the individual items (ADR-0004 honesty; tests assert them); only the UI groups.
  3. **Provider/model line is conditional on manifest presence** (catch-path error entries have activities but no manifest). **Decided: it stays as the last muted row of the expanded receipt; header placement rejected** — provider/model is per-run, not per-thread; the header stays quiet.
- Activity rows inside the receipt reuse the `.assistant-activity-row` markup/styles with **past-tense titles** from a new `assistant.receipt` i18n group ("Read draft.md" / "Leyó draft.md", "Searched documents for \"q\"" / "Buscó documentos para \"q\"", "Listed documents" / "Listó documentos"; read-failed copy unchanged) — the live trail keeps the progressive set; the moment changes the tense. All rows render (sorted by sequence, no 5-row cap; the cap stays live-trail-only).
- The live trail during a run is unchanged. The existing test "renders a compact live activity trail only while a run is active" stays green **unmodified** — it pins that the `runActivities` prop alone never renders rows after the run; permanent rows come only from `entry.activities`.

### Attachment markers on sent user messages

- `ask()` attaches the existing `contextAttachmentsSnapshot` to the user entry as ephemeral `attachments?: Array<{ relativePath: string; label: string }>`.
- **Treatment (decided)**: NOT pills. A quiet text row in the established sent-metadata register (the `.assistant-comments-disclosure` family): `var(--text-xs)`, `var(--muted-2)`, no border/background/radius, basename labels joined with " · ", full relative path via native `title=` (no `data-tooltip` clone; native titles don't clip against the transcript's `overflow: auto`). Class `.assistant-user-attachment`.
- Renders in **both** user-entry branches: plain (text → markers) and selection-comments (typed text → comments disclosure → markers).
- `@`-mentions are not marked: they are visible in the typed text itself. Restored threads show no markers (ephemeral field). 

### Styles & i18n

- `src/styles/assistant.css` only; tokens only. `.assistant-turn-receipt` replicates `.assistant-context-disclosure`'s self-contained typography (sets its own `color` and `white-space: normal` — required because `.assistant-entry` is `pre-wrap` and `.is-error` is `var(--error)`-colored; the receipt must not render red or pre-wrapped inside an error entry). Inside the receipt, the activity-rows container zeroes the trail indent (`.assistant-turn-receipt .assistant-activity-trail { padding-left: 0; }` or a dedicated container class). The error branch's bare text node gets wrapped in a span (`.assistant-user-typed-text` precedent) so the receipt can be a clean sibling.
- New strings: `assistant.context.historyOmitted(count)`, `assistant.context.referencedEarlier(count)`, and the `assistant.receipt` group (summary builders for reads/searches/failed counts with 0/1/n forms; past-tense activity titles; `attachments` aria-label). EN + ES. The omission note and index prompt line are model-facing English prompt scaffolding, not UI strings.

## Architecture notes

- IPC contract: one optional field. **Mandatory sync list**: `electron/agent/types.ts`, `src/types/iliad.ts`, `sanitizeRunRequest` (`agentService.ts`), **and `preparedRunRequest` (`documentContext.ts`)** — the panel's blocker: both are field-by-field whitelist copies; missing either silently drops the field with no type error. Preload passes the request object through unchanged.
- `estimateTokensFromText` moves to `conversationHistory.ts`; `contextManifest.ts` re-exports it (import direction: contextManifest → conversationHistory, never the reverse).
- No changes to `electron/fs/`, document tools, proposal flow, or the chat-history store.
- **Steps land as a single change.** Shipping the index before receipt permanence would let the signature gating suppress the receipt rows for paths the model was just told about — a hidden-context state `docs/agent-vision.md` forbids.

## Docs to update (same change — repo rule)

1. `docs/context-management/decisions.md`:
   - **ADR-0014 (accepted)** "Conversation history is budget-bounded; earlier document references persist as identifiers": providers receive full visible history newest-first within an estimated token budget (40k in v1, defined in `electron/agent/conversationHistory.ts`); newest message always included; omissions deterministic, announced in the prompt, and mirrored in the manifest; an identifier-only index (sanitized relative Markdown paths, max 20, derived in-session from prior run manifests) of previously included/read documents may be re-presented for tool-based re-reading; document content is never re-sent; every indexed path appears in the run's context manifest.
   - **ADR-0001 amendment line**: "Amended by ADR-0014: prior documents' workspace paths may reappear as an identifier-only reference index; their content is still never reused automatically."
   - **ADR-0015 (proposed)** "Long-thread compaction summaries": when a thread repeatedly exceeds the budget, a cached LLM summary of the omitted prefix may replace the deterministic omission note; must preserve decisions, constraints, and the file index; must surface as a "Summary used" receipt row; requires a cache keyed by covered-entry range and poisoned-summary mitigation; not built until budget-only selection proves insufficient.
2. `docs/context-management/current-architecture.md`: replace the line-233 "last 8 visible messages" claim with the budget description; update the "What Happens On The Next Message" example to include the index line while keeping the "content is not re-sent" sentence; bump the status date.
3. `docs/context-management/README.md`: extend the Short Version packet line — "recent visible chat (budget-bounded; omission note and referenced-document path index when applicable)".
4. `docs/context-management/change-log.md`: dated entry linking this spec (8-message window removed; reference index; permanent per-turn receipts; persisted run activities).
5. `docs/context-management/external-best-practices.md`: add a dated section "What agent products do about long histories (2026-06-11)" with the survey findings + sources; note budget-based selection now exists while compaction remains a gap.

## Implementation plan

1. **Main process**: `conversationHistory.ts` (selection, section formatter, sanitizer, moved estimator), `preparedRunRequest` integration (selection + field passthrough + same-turn exclusion + `omittedHistoryMessageCount`), `sanitizeRunRequest` passthrough, both providers consume the shared section, manifest items (omission + index; new kind/reason; id schemes), `safeDisplayPath` export. Verify: unit + integration tests, `npm run typecheck`.
2. **Renderer**: derivation helper (mines assistant + error manifests), `buildRunOutcomeEntry` + `resetRunActivities()` wiring in `useAssistantRun`, user-entry attachments. Verify: node tests.
3. **Receipt UI**: `AssistantTurnReceipt` (dedup rules, grouped index row, conditional provider line, past-tense titles), transcript integration (both user branches, error-entry receipt), delete `contextManifestSignature`, summary builder, styles, i18n EN/ES. Verify: component tests + `lint:css`.
4. **Docs**: all five updates above.
5. **Full pass**: `npm test`, `npm run typecheck`, `npm run build`, manual smoke in Electron (long thread crossing the budget, attachment send, tool-using run, failed run, restored thread, ES locale).

## Tests

House constraints: vitest node environment, no RTL/jsdom; components via `renderToStaticMarkup` + string assertions (note: `<details>` children render regardless of expansion — assert collapsed-by-default via absence of `open` attribute and row order via `indexOf` comparisons, the `selectionCommentsChip.test.tsx` pattern).

- `tests/agent/conversationHistory.test.ts` — selection: all-under-budget passthrough; oldest-first omission; newest-always-included when oversized; boundary-exact message included (≤); many tiny messages exercising the min-1-token floor; emoji/accented-Spanish text near the boundary (UTF-16 code-unit estimator); zero/one message. Section formatter: header with/without omission note; `ROLE: content` formatting. Sanitizer: control-character path, absolute, `..`, backslash, hidden segment, non-markdown, >20 capped, empty → `undefined`.
- `tests/agent/documentContext.test.ts` (extend) — integration: drive `preparedRunRequest(sanitizeRunRequest(...))` and assert `previouslyReferencedDocuments` survives, same-turn exclusion drops active-file and resolved-mention paths, `omittedHistoryMessageCount` set, `messages` trimmed.
- `tests/agent/contextManifest.test.ts` (extend) — round-trip items with kind `conversation_history` / reason `conversation_history_budget_omitted` and kind `document_reference` / reason `conversation_reference_index` through `serializeAgentRunContextManifest` (the reason allowlist coerces unknown reasons — this is the regression the round-trip pins); `estimateInputTokens` over trimmed messages only; index item ids distinct from `document-reference-${correlationId}`.
- Prompt builders — `userInput` (exported) and `codexUserInput` (newly exported): full history under budget (>8 messages present), omission note when over, index line present only when field non-empty, backtick-wrapped paths.
- `tests/assistant/runEntries.test.ts` — `buildRunOutcomeEntry`: success with activities; error-result with activities + failed manifest; thrown-exception error with activities only; empty activities → field omitted.
- `tests/assistant/` derivation — mining rules (file-like + full only), **error-entry manifest mined**, dedupe, exclusion of current packet paths, cap, recency order.
- `tests/assistant/assistantUtils.test.ts` — `turnReceiptSummary`: 0/1/n reads, searches, failed reads in **both `appStrings.en` and `appStrings.es`**; started-only activities not counted; no-activities fallback byte-identical to `contextManifestSummary`.
- `tests/assistant/chatHistory.test.ts` (extend) — the "keeps only visible transcript fields" fixture gains `activities` and `attachments`; assert both absent from persisted entries.
- `tests/assistant/AssistantTranscript.test.tsx` — existing tests "renders assistant context disclosure separately from prose" (the fallback summary keeps it green) and "renders a compact live activity trail only while a run is active" (pins prop-vs-entry separation) must pass **unmodified**. New cases: receipt on every manifest-bearing entry (two consecutive identical manifests ⇒ two receipts); no `<details open`; expanded ordering activities < manifest rows < provider line via `indexOf`; tool-using entry shows each path exactly once (dedup rule); reference-index items grouped into one row; error entry with activities + manifest renders receipt (summary present inside `is-error` entry); error entry with manifest but no activities renders fallback summary; error entry with activities but no manifest renders without provider line; user entry markers (basename + `title`), and a user entry with **both** `selectionComments` and `attachments`; restored entry (no ephemeral fields) renders plain.

## Risks & mitigations

- **Prompt regressions in two providers**: one shared section formatter, tested directly; providers only splice the block.
- **Silent field drop**: the two whitelist copies are named in the sync list and pinned by an integration test.
- **Cost growth**: bounded by the 40k budget; the receipt's `estimatedInputTokens` is now computed over the trimmed messages, so it stays honest exactly when the budget bites.
- **Receipt noise**: collapsed by default, one quiet line per turn; double-listing prevented by the `model_directed_` filter; index rows grouped to one.
- **Ref/state drift for activities**: `resetRunActivities()` makes co-location structural across all seven reset sites.
- **Stored schema creep**: none; ephemeral fields follow the selection-comments precedent, pinned by the extended chatHistory test.

## Review log (v1 → v2)

Four-lens panel (agent-architecture/backend, UX/design-system, testing/QA, product fidelity). Incorporated in full:

- **Backend (needs_revision)**: BLOCKER — `previouslyReferencedDocuments` would be silently dropped by `preparedRunRequest`'s field-by-field copy; added to the mandatory sync list + integration test. Sanitizer corrected from `safeRelativePath` to the `safeDisplayPath` discipline (control-character filename → prompt-injection surface). Same-turn @-mention contradiction resolved by filtering in `preparedRunRequest` after explicit-context resolution. Token-estimate honesty fixed by running selection once in the prepared request (and moving `estimateTokensFromText` to avoid an import cycle). Index manifest ids given a distinct scheme; prompt paths backtick-wrapped; `resetRunActivities()` for all 7 reset sites (spec had 4); Telegram deadline interaction acknowledged + budget parameterized; error-entry manifests mined for the index.
- **UX (approve_with_changes)**: receipt body deduped (`model_directed_` manifest rows filtered when activity rows render); reference index grouped into ONE row now, not v1.1; attachment markers are quiet text (comments-disclosure register), not pills, with native `title` tooltips; provider/model placement decided — stays in expanded receipt, header rejected (per-run scope, header restraint), conditional on manifest presence; past-tense receipt titles (new `assistant.receipt` group) while the live trail keeps progressive; receipt sets own color/white-space (error entries are red + pre-wrap) and zeroes the trail indent; error text wrapped in a span. Affirmed as decided: always-on collapsed receipts, action-first summary altitude, `document_reference` excluded from file counts.
- **Testing (needs_revision)**: `codexUserInput` exported + shared section formatter carries the testable text; `buildRunOutcomeEntry` extracted so ask()-wiring decisions are node-testable; sanitization given an exported seam; both-fields user entry (selectionComments + attachments) specified and tested; non-existent test files/assertions corrected (no signature tests exist — delete function only; the two load-bearing existing transcript tests named and kept green); details-expansion assertions rewritten as `open`-attribute + `indexOf` checks; ES-locale and multibyte-estimator cases added; manifest reason round-trip and chatHistory stripping tests added; receipt edge cases pinned (manifest-no-activities, started-only rows, failed-read counting keyed to kind `document_read_failed`).
- **Product (needs_revision)**: BLOCKER — doc updates are part of the change (current-architecture.md "last 8" line + example, README short version, change-log entry); ADR-0014 accepted + ADR-0001 amendment line; ADR-0015 proposed (compaction); omission surfaced in the manifest as an excluded item so the receipt mirrors the prompt; reference-row provenance solved via the grouped row with its own label; industry survey recorded durably in external-best-practices.md; steps land as a single change to avoid a hidden-context window.
