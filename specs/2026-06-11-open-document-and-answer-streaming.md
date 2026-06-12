# open_document + answer streaming (close the gap between doing and seeing)

Date: 2026-06-11
Status: implementation-ready (v2 — revised after a three-lens panel: backend/security, renderer/UX, tests/docs; review log at end)

## Reviewer brief

Read first: `electron/agent/documentTools.ts`, `electron/agent/openai/documentTools.ts` (budgets :272-298, executor), `electron/agent/openai/client.ts` (tool-round loop :223-246, retry restarts :372-431), `electron/agent/openai/stream.ts:41`, `electron/agent/openai/summaries.ts:66` (the 120 ms main-side delta gate precedent), `electron/agent/runtime/codexAppServerProvider.ts` (`item/agentMessage/delta` :580, `emitDocumentToolActivity` :544-571, `documentToolActivityKind` :1200, `safeDocumentToolArguments` :1230, dynamicTools :106), `electron/agent/openai/request.ts:44` (schema construction site), `src/assistant/useAssistantRun.ts` (listener :567, scroll effect :426, `resetRunActivities`), `src/components/assistant/AssistantTranscript.tsx`, `src/files/fileActions.ts` (`openNode` flushes saves :181), `src/App.tsx:108-124` (`markEditorNavigationDuringRun`), `src/assistant/reviewNavigation.ts`.

## Problem

1. **Capability hallucination (reproduced 2026-06-11).** Asked "abre ese archivo", the model answered "Listo, abrí `courses/.../s2.md`" — no open capability exists. Trust failure of the worst kind.
2. **No answer streaming.** Both runtimes deliver the answer token-by-token to main (`response.output_text.delta`; `item/agentMessage/delta`) which discards the signal; the renderer sees only the final text. Long runs feel dead.

## Goals

- Real `open_document` tool (desktop profile only): validated in main, executed via the save-flushing `openNode` flow, receipted, advertised in the prompt.
- Answer text streams into the transcript; proposal markers never render raw; multi-round/retry runs never show stale or duplicated text.
- Scroll stays humane: the view follows the stream only while the user is at the bottom.
- No stored-schema changes; final `result.text` stays authoritative.

## Non-goals

- No generic UI automation; no reveal-in-tree/scroll-to-heading yet; no streaming of proposal/diff content; no streaming on the non-streaming fallback path (it has no deltas — the answer simply lands complete).

## Design — `open_document`

### Tool, gating, budget

- Schema: `open_document`, strict, `{ path: string }`, required `["path"]`, in `openAiDocumentToolSchemas({ includeOpenDocument })`. **Gating sites (the real owners)**: `openAiRequestBody` (`openai/request.ts:44`) derives the flag from `request.runProfile !== "remote_read_only"`; `codexDocumentDynamicTools(includeOpenDocument)` called at `codexAppServerProvider.ts:106` with the same derivation. Defense in depth: `executeAgentDocumentToolCall` gains `allowOpenDocument: boolean`, threaded from both executors (`client.ts:265`, `codexDocumentTools.ts:55` ← provider :507); disallowed calls → `unknown_tool`.
- **Budget rule (decided)**: `open_document` behaves exactly like other non-read tools — increments `totalToolCalls` and is subject to the read-reserved guard. No exemption (the v1 claim was internally contradictory against the guard structure). Test asserts: at `totalToolCalls = max-1` with no successful read, an open is rejected with `tool_budget_exceeded`/read-reserved.
- `AgentDocumentTools.openDocument(input, signal?)`: `validateWorkspaceRelativePath` + `isMarkdownPath` + `resolveFile` (exists, regular, visible; no content read) → invokes injected `onOpenDocument(relativePath)` → returns `{ relativePath }`. Interface addition updates the two hand-built test fakes (`openaiDocumentToolLoop.test.ts`, `codexAppServerProvider.test.ts`).
- `createAgentDocumentTools` option `onOpenDocument?`. `agentService` injects it, emitting through the existing generic run-event channel (verified passthrough end-to-end):
  1. `AgentOpenDocumentRunEvent { type: "open_document", runId, relativePath }`.
  2. `AgentActivityRunEvent` kind `"document_open"`, status `"completed"` — **single emission point for both providers**; sequence uses a high base (`10_000 + n`) so it sorts after Codex's small per-run sequences (ordering pinned by test).
- **Codex skip**: `emitDocumentToolActivity` early-returns for `open_document` on **all three statuses** (otherwise `documentToolActivityKind`'s unknown-name default would render a false "Document read failed" row); `safeDocumentToolArguments` gains an open branch (sanitized `relativePath`) for codex receipt args.
- **Failed opens**: executor catch path emits a manifest item (reason `model_directed_document_open_failed`, kind `document_reference`, inclusion `excluded` — the `maybeEmitFailedReadContext` pattern); the tool error loops back to the model, which self-corrects (same contract as failed reads). No failed activity row (parity with OpenAI-path read failures); stated as accepted.
- Success manifest item: kind `document_reference`, `relativePath`, inclusion `"available"`, reason `"model_directed_document_open"` (allowlist + serializer + display branch).
- **Opens per run**: bounded by the shared tool budget; injection-driven navigation noted in Risks (a hostile workspace doc can request opens; each is validated, visible, receipted, and enters navigation history — the user can go back; remote profiles have no UI to hijack).

### Renderer execution

- `useAssistantRun`: handles `type === "open_document"` (filtered by `latestRunId`); the App callback is held in a **ref** (subscription effect deps unchanged — re-subscribing mid-stream drops IPC events).
- `App.tsx`: `findNodeByRelativePath` helper (`src/files/fileTree.ts`, case-insensitive normalized compare); miss → refresh tree once → retry; then `openNode(node)` — flushes saves by construction; **must NOT call `markEditorNavigationDuringRun`** (agent-directed navigation is not a user override; review auto-targeting keeps working off `runActiveRelativePath`). `recordHistory` stays default-true: the open enters back/forward history, so the user can undo the navigation — intended. Node still missing after refresh → console.warn, no-op.
- **Receipt label decided: "Abrió …" stays.** Emitted post-validation in main; the residual lie window is a tree-refresh race (rare, warn-logged) or a save-flush failure (which blocks navigation — the user sees their own document untouched). "Pidió abrir" was considered and rejected as clunkier than the residual risk warrants.

### Prompt policy

- Local blocks (both providers): tool enumerations gain `open_document`, plus: *"When the user asks to open or show a document, call `open_document` with its workspace-relative path (search first if unsure). Never claim a document was opened unless the tool succeeded."*
- **Both remote blocks** gain: *"You cannot open or display documents in the Iliad app."* (the v1 claim that existing lines covered this was wrong for Codex and overstated for OpenAI).

## Design — answer streaming

### Events (generation-aware, coalesced in main)

- `AgentTextRunEvent { type: "text_delta", runId, generation, delta }` joins `AgentProviderRunEvent` (both type files).
- **Generation counter (the multi-round fix)**: the OpenAI client increments `generation` at the start of every streamed payload — each tool round (`client.ts` loop) and each retry/fallback restart. The renderer **replaces** its buffer when `generation` changes and appends otherwise: intermediate-round prose and retried prefixes can never concatenate or duplicate. Codex is single-turn: `generation: 1` always.
- **Main-side coalescing** (the `emitSummaryDelta` precedent): deltas buffer in main and flush on a 120 ms gate with a force-flush at payload end — bounded IPC volume regardless of token rate. Codex `agentMessage` deltas flow through the same gate helper.
- The non-streaming fallback path emits nothing (no deltas exist); the run behaves as today.

### Renderer display

- `useAssistantRun`: `streamingText` state via a pure exported reducer `applyTextDelta({ generation, text }, event)` (replace-on-generation-change, append-otherwise) — no renderer timers at all (main coalesces), so there is no late-flush hazard; reset lives inside the extended `resetRunActivities()` (structural co-location) and the completion `setEntries` + reset happen in the same synchronous continuation (one React commit — no flash; pinned in the spec because moving the reset to an effect would reintroduce it).
- **Marker cutoff** `visibleStreamingText(text)`: case-insensitive (mirroring `proposalDrafts.ts`'s `/gi` parsing) cut at the first occurrence of ```` ```diff ````, `FULL_REPLACEMENT:`, `NEW_DOCUMENT:` — **plus longest-prefix holdback**: a trailing partial prefix of any marker is withheld so split deltas never flash "FULL_REPLA" before vanishing.
- `AssistantTranscript`: streaming block renders inside the active-status entry below the live trail, in a child container with `aria-live="off"` (the status entry is `aria-live="polite"`; re-announcing every flush would spam screen readers). Markdown renders **without math** during streaming (a `streaming` prop on `MarkdownContent` omits remarkMath/rehypeKatex — partially streamed `$…` is the expensive, flicker-prone case); unclosed-fence tail swallowing (ordinary code examples mid-stream) is known and accepted — it self-resolves when the closing fence arrives.
- **Scroll anchoring (the UX blocker)**: the transcript gains an `onScroll`-maintained `isPinnedToBottom` ref (`scrollHeight - scrollTop - clientHeight ≤ 32`); `scheduleTranscriptScrollToBottom` is gated on it; `streamingText` joins the scroll-effect deps. While pinned, the view follows the stream; scrolled up, nothing yanks — including the completion swap. Re-pinning happens by scrolling back to the bottom. Unit-tested with injected elements (the existing `useAssistantRunScroll.test.ts` pattern).
- Completion geometry: the expanded live trail (≤5 rows) collapses into the one-line receipt at swap — the height jump is accepted (content above the answer shrinks; the answer itself does not move down).
- `turnReceiptSummary` gains an opens part ("Abrió 1 documento" / "Opened 1 document") so open-only turns don't show a bare "Proceso".

## Docs to update (same change — repo rule)

1. `docs/context-management/model-directed-context-tools.md` — tool surface gains `open_document(path)` (every section that enumerates the tools).
2. `docs/context-management/current-architecture.md` — all three tool enumerations (≈:27-30, ≈:212-215, ≈:252) + receipts mention + a line on streaming (final text remains the stored record); status date.
3. `docs/context-management/decisions.md` — **ADR-0016 (accepted)** "UI navigation is a receipted tool": navigation (opening a visible workspace Markdown document) is allowed only through a validated, profile-gated, receipted tool; navigation is not a write; remote profiles get no UI tools; injection-driven opens are bounded by the tool budget and reversible via navigation history.
4. `docs/agent-vision.md` "Tool Boundary" + `docs/architecture.md` agent boundary paragraph — the allowed-direction lists gain the navigation verb (CLAUDE.md requires architecture.md updated in the same change).
5. `docs/context-management/change-log.md` — entry citing this spec and the hallucination repro.

## Implementation plan

1. Types (event union both files, activity kind both files) + tool + gating (both schema sites + executor flag) + service wiring + codex skip + manifest reasons. Verify: unit tests.
2. Stream: generation counter + main gate helper + emission (both providers). Verify: harness tests (including the existing exact-equality test listed below).
3. Renderer: `applyTextDelta`, `visibleStreamingText`, transcript streaming block (aria-off, no-math markdown), scroll anchoring, App wiring (ref-held callback, `findNodeByRelativePath`, no nav-marking). Verify: unit/component tests.
4. Prompts (4 local/remote blocks) + i18n (activity/receipt `documentOpen` labels + summary part, EN/ES — including the explicit kind branches in `activityTitle`/`receiptActivityTitle`, which otherwise mislabel opens as "Listing documents") + docs. Full pass + manual smoke.

## Tests

New:
- `documentTools.test.ts`: `openDocument` validation matrix (`not_found`/`not_file`/`not_markdown`/`invalid_path`), callback invoked once with normalized path, aborted signal.
- `openaiDocumentToolLoop.test.ts`: open call → `{ ok: true, relativePath }` + manifest reason; remote profile → schema list excludes it and forced call → `unknown_tool`; budget: open at `max-1` without prior read → read-reserved rejection; failed open → excluded manifest item.
- `openaiResponses` stream tests: deltas emit coalesced `text_delta` with force-flush at payload end; generation increments across tool rounds/retries (multi-payload fixture).
- `codexAppServerProvider.test.ts`: `agentMessage/delta` → `text_delta` (generation 1); open dynamic call routes to `tools.openDocument` and `emitDocumentToolActivity` emits **no** row for it (all statuses); remote run's `threadParams.dynamicTools` excludes `open_document`.
- `agentService`-level test (stub provider invoking `documentTools.openDocument`): open run-event + single `document_open` activity with high-base sequence (harness precedent: `agentServiceProposalPersistence.test.ts`).
- Renderer: `applyTextDelta` (append, replace-on-generation, reset); `visibleStreamingText` (no marker; each marker; case variants; marker at 0; split across deltas; bare trailing ``` ``` `` holdback); transcript streaming block render + absence after completion; scroll anchoring conditions; `turnReceiptSummary` opens part EN/ES; `prompts.test.ts` policy lines (local presence, remote denial line).
- `contextManifest.test.ts`: reason round-trips (`model_directed_document_open`, `_failed`).

Existing tests to update (panel-verified):
- `tests/agent/openaiResponses.test.ts:489-537` — exact `toEqual` on runEvents now also receives `text_delta`s.
- Both `documentTools()` fakes gain an `openDocument` `vi.fn` (typecheck).

## Risks & mitigations

- **Streamed machinery**: case-insensitive cutoff + prefix holdback, heavily tested.
- **Duplicate/stale streamed text**: generation counter; renderer replaces on change; final entry authoritative.
- **Scroll yanking**: pin-to-bottom gate, tested.
- **False "Abrió"**: residual window documented (tree race → warn; flush failure → navigation blocked visibly).
- **Injection-driven opens**: budget-bounded, validated, receipted, history-reversible; remote unaffected (no tool).
- **IPC volume**: main-side 120 ms gate, force-flush at payload end.

## Review log (v1 → v2)

**Backend/security (needs_revision)**: budget claim was internally contradictory → decided rule (a): open respects the read-reserved guard. Multi-round tool loop + retry restarts would duplicate/stale the streamed draft → generation counter with renderer replace semantics; non-streaming fallback explicitly emits nothing. Gating owner corrected (schema construction lives in `openai/request.ts:44` and `codexDocumentDynamicTools`, not agentService) + executor `allowOpenDocument` threading named. Main-side coalescing adopted (the `emitSummaryDelta` 120 ms precedent) over renderer-only throttling. Codex activity-skip specified for all three statuses (the unknown-kind default would fabricate "read failed" rows); failed-open manifest item added; sequence collision solved with a high base. Telegram gating path verified (`runProfile: "remote_read_only"`). **Renderer/UX (needs_revision)**: scroll anchoring was undefined — pin-to-bottom gate specced (blocker); completion-swap batching pinned to the synchronous continuation; subscription stability via ref-held callback (re-subscription drops IPC events); open-during-run decided (open immediately; never mark user navigation; history-recorded so reversible); "Abrió" label decided with the residual-window rationale; aria-live spam fixed (child container off); math skipped during streaming; case-insensitive markers. **Tests/docs (needs_revision)**: budget test rewritten to the decided rule; the two real gating sites named with executor threading; `openaiResponses.test.ts:489` exact-equality breakage listed; codex open-event test split (provider asserts routing + no activity; service-level test asserts events — the provider harness never sees agentService callbacks); renderer accumulator redesigned to a pure reducer (no timers → testable under house constraints); split-marker holdback added; docs list extended to `agent-vision.md` + `architecture.md` tool boundaries and all tool enumerations; remote denial line added to both remote blocks; codex remote dynamicTools gating test added.
