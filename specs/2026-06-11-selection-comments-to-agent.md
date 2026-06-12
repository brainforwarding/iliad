# Selection comments batched to the agent

Date: 2026-06-11
Status: implementation-ready (v2 — revised after design review and codebase review; review log at end)

## Reviewer brief

Read first: `docs/architecture.md` (editor scroll owner, save model, style ownership), `specs/2026-05-22-agent-panel-v1.md` (composer, context attachments, review-first flow), `src/editor/visualMarkdown/index.ts` and `src/editor/aiReview*` (decoration patterns), `src/assistant/useAssistantRun.ts`, `src/components/assistant/AssistantComposer.tsx`, `tests/agent/proposalStore.test.ts` and `tests/editor/aiReviewExtension.test.ts` (test patterns). Prior art: the LXD VS Code extension shipped the same serialization contract (file + line + quote + context) and proved the payload with an AI consumer.

## Problem

While reading or editing a document, the user constantly forms small, located judgments: "this paragraph is too long", "wrong term here", "move this up". Today the only way to hand those to the agent is one prose message describing locations by hand, which is slow, lossy, and discourages giving the agent more than one instruction at a time. The judgment exists at a *place* in the document; the channel to the agent strips the place away.

## Product intent

The user highlights text, attaches a short comment, repeats as they read — then sends all pending comments to the agent as one batched message, each comment carrying its exact location. Marking up a document feels like margin notes; sending feels like handing the marked-up draft to an assistant. The canvas stays quiet: no standing chrome; affordances appear only in response to user action.

## Goals

- Comment on any text selection in the editor; multiple comments per document; overlaps allowed.
- Pending comments are visible but quiet: a soft wash on the text, notes shown on hover.
- All pending comments for the open document batch into one agent message with exact source locations, optionally framed by text the user types in the composer.
- After a successful send, the surface returns to clean: washes fade out (~200ms), comments move to the transcript. On send failure, everything reverts to pending.
- Comments survive app restart and document switching (never written into the user's markdown files).
- Full EN/ES interface support.

## Non-goals (and what we deliberately do not copy)

- Multi-document batches; threads, replies, reactions, mentions, avatars, timestamps-in-UI, resolve workflows, margin gutters, comment counts in chrome — the entire collaboration mass of Docs/Notion/Medium/Linear stays out. One action on selection, one wash, one hover popover, one chip. If a second action ever wants into the selection affordance, the answer is no — that is how this stays quiet.
- Sharing comments with people (this is a user→agent channel).
- Any change to the agent's review-first proposal/approval flow.

## UX design

### Why the send affordance lives in the composer

An on-document floating "send" button is state-contingent (appears only with pending comments) and spatially honest — but it loses for two reasons: sending is a *speech act* (the point of batching is to frame the batch — "apply 1 and 3, answer 2" — and a document button has nowhere to type), and any floating button over a centered 760px serif column sits on top of prose somewhere. The composer chip reuses the existing attachment-chip vocabulary in the one place where talking to the agent already happens. The panel-closed gap is bridged by a transient signal (below), not a badge.

### Flow

1. **Select** (mouse): on mouseup — never mid-drag — after a ~150–200ms settle delay, a single floating action fades in near the selection head: "Comentar" (`--text-xs` sans). It travels with the selection (tooltip-style positioning, recomputed on layout) and dismisses on selection change, document edit, Escape, or click elsewhere — NOT on scroll. It never appears for keyboard selections (shift+arrows), programmatic selections (select-all, search), or empty/whitespace-only selections. It is one action and will never become a toolbar.
2. **Keyboard path**: `Cmd+Shift+M` with a non-empty selection opens the comment composer directly (no floating UI); with the cursor inside a commented range, it opens that comment for editing; with neither, it no-ops. NOTE: `@uiw` basic-setup includes `lintKeymap`, which binds `Mod-Shift-m` → `openLintPanel`. Disable it (`basicSetup: { lintKeymap: false }`) or register our keymap with `Prec.high` — pick one and verify.
3. **Compose**: an inline popover (existing popover family: `--overlay`, `--shadow-popover`, `--radius-surface`) anchored below the selection head, flipping above near the viewport bottom. The moment it opens, the range gets a provisional `--comment-wash` mark (promoted on save, removed on cancel) so the user never types about unmarked text. The input is a textarea growing to max ~3 lines: Enter saves, Shift+Enter newline, Escape cancels. Nothing else: no author row, no timestamp.
4. **Pending state**: the saved range keeps the wash. Click inside it places the cursor like anywhere else — click NEVER opens the comment (commented text is exactly the text the user re-edits most). Hovering ~300ms shows a read-only popover with the comment; moving the pointer into it makes it interactive: text, `editar`, `eliminar` (quiet text-buttons, `--teal-deep`). If multiple comments intersect the hover point, the popover lists all of them. Cursor stays `default` over washes.
5. **Composer chip**: the assistant composer shows one chip in the `.assistant-context-chips` row: `3 comentarios · course-map.md`. Clicking expands a plain list (excerpt in `--muted-2`, comment in `--ink-2`, one `×` per row); clicking a row scrolls the editor to that highlight. The chip's `×` opens the list first — no blind bulk discard. Orphaned comments ("sin ancla", see anchoring) appear in this list as muted text — no warning icons, no error color.
6. **Panel closed**: comments accumulate normally. The first save while the panel is closed pulses the assistant toggle icon once (≤700ms, no animation under `prefers-reduced-motion`). No persistent badge anywhere.
7. **Send**: the user sends with or without typed text. On success: washes fade ~200ms, comments transition `pending → sent`, chip empties. The transcript shows the typed text plus a compact `N comentarios` disclosure (expand to see the block). On run error: comments revert to pending and washes return (mirror the existing contextAttachments snapshot/restore in `ask()`).
8. **Sent trace**: none. Cleared entirely — the transcript is the record, and the agent is about to edit those exact ranges; residue would mis-anchor or lie.
9. **Focus mode**: washes remain (document state, not chrome); the floating action and shortcut still work; the panel — and therefore the chip and sending — is unavailable until focus mode exits, with state intact. This is intended: mark up while deep reading, send on surfacing. Stated here so it is not read as a bug.
10. **Document switch**: the chip always reflects the open document; the expanded list closes on switch; comments on non-open documents are dormant (washes restore when the doc reopens). Never show a chip for a non-open document. Commenting during an active agent run is allowed; sending follows the composer's existing mid-run policy.
11. **Long selections**: allowed (select-all + "rewrite all of this" is legitimate). Composer anchors to the selection head. The 80-char quote truncation means `prefix`/`occurrence` carry the anchor; state this in code comments.
12. **Multi-block selections** (heading + paragraph): allowed; the wash spans blocks naturally via `Decoration.mark`. In the serialized quote, newlines are replaced with `⏎` before truncation; the line number is the first line of the range.

## Data model

```ts
interface SelectionComment {
  id: string;
  workspacePath: string;            // matches proposals precedent (workspaceRoot is persisted there too)
  documentRelativePath: string;     // compare with normalizeRelativePath/sameRelativePath helpers, as everywhere
  from: number;                     // live CM positions while doc is open, mapped through edits
  to: number;
  quote: string;                    // exact selected text at creation
  occurrence: number;               // nth occurrence of quote in doc at creation
  prefix: string;                   // ~30 chars before selection, tiebreaker
  comment: string;
  createdAt: string;
  status: "pending" | "sent" | "discarded";
}
```

### Anchoring rules

- While the document is open: positions are authoritative and mapped through every edit (see Architecture). A range that collapses (`from === to`, text deleted) moves to "sin ancla" immediately.
- Re-anchoring (on document open, after restart, after any full-content replacement): exact quote search, occurrence-aware, prefix as tiebreaker; failures become "sin ancla" in the chip list — never silently dropped, never mis-anchored.
- Applied agent proposals replace document content outside normal typing: treat as full-content replacement → run re-anchoring, do not attempt position mapping across it. Same for file rename/move: v1 behavior is rename ⇒ orphan ("sin ancla"); rekey-on-rename is a v2 candidate, noted not built.

## Serialization contract (payload sent to the agent)

```
Comments on `course-map.md`:

1. Line 42 · "the three big ideas every teacher should leave with"
   Comment: too long — cut to one idea per session.

2. Line 117 · "video" (2nd occurrence)
   > Context: "Short video on effective feedback (4 min)…"
   Comment: verify this video actually exists.

Each comment references the quoted text at the indicated line.
```

Rules: 1-based line numbers computed at send time from live CM positions; quotes truncated ~80 chars (newlines → `⏎` first); `> Context:` line only when the quote is <30 chars or repeated in the document; occurrence ordinal only when repeated; deterministic order by position; orphans listed last under a "sin ancla" note with no line numbers. EN/ES follows the app language. The closing line is the neutral descriptor above when the user sent without text; when the user typed text, their framing governs and NO closing instruction is added — the system must not put words in the user's mouth.

## Architecture

### Editor surface — `src/editor/selectionComments/`

- **React state is authoritative; the extension is stateless** (the `aiReviewExtension` pattern). Decorations are rebuilt from props through the `extensions` `useMemo` in `EditorPane.tsx`. Do NOT hold comment state in a `StateField` — every CRUD rebuilds the extensions array and would recreate the field, losing state.
- Position mapping: an `EditorView.updateListener` maps each pending comment's `from/to` through `update.changes` and reports back to the state owner (guard against update loops: only report when positions actually changed). Mapping is DISABLED across `file.path` changes — document switching reuses the same CM instance with a controlled `value` swap that arrives as a full-document replacement transaction and would garble mapping; the re-anchoring path runs instead.
- Decorations: `Decoration.mark` for washes. (Precision on the known constraint: block decorations are illegal from *ViewPlugin-provided* sources — `visualMarkdown` legally emits block widgets from state-derived sources; marks from props-derived sources are safe. Stay with marks; that's all this feature needs.) Defensive build with fallback-to-none, mirroring visualMarkdown. Overlapping washes must not compound visually: one merged decoration layer / identical color regardless of stacking.
- Floating action + popovers: positioned from `view.coordsAtPos()` converted against `.editor-surface`'s `getBoundingClientRect()`/`scrollTop`. `.editor-surface` is the scroll owner and currently has NO `position: relative` — add it. Scroll listeners go on `.editor-surface` (`.cm-scroller` is `overflow: visible !important` and never scrolls). Never cache screen coordinates across layout changes — visualMarkdown's syntax reveal on cursor entry reflows lines (a comment wash may suddenly include revealed `**`/link syntax inside its range — acceptable, by design). There is no existing selection-anchored-popover precedent in the app; this is new ground, budget accordingly.

### State owner — `src/app/useSelectionComments.ts`

Pending comments for the open document: CRUD, position-update intake, re-anchoring on document open (triggered by `activeFile` change, persisting switched-away state before `loadDocument`), serialization, sent/revert transitions. Lives in `App.tsx` composition. **Invariant: no selection-comment state may live in `useAssistantRun` or `AssistantPanel`** — the panel is unmounted when closed and in focus mode; the chip is purely derived from props and re-derived on every panel mount.

### Composer integration

- The chip is **NOT** an `AssistantContextAttachmentChip`. It must not enter the `contextAttachments` array: that path rejects the active file's path, enforces the 4-attachment limit, dedupes by relativePath, removes chips on Backspace, and maps every chip into `AgentRunRequest.contextAttachments` as a file attachment — all wrong for comments. It is a separate prop (`pendingSelectionComments` + callbacks) rendered alongside in the `.assistant-context-chips` row.
- Send path: pass the pending comments (or a pre-serialized block) and an `onCommentsSent` callback into `useAssistantRun`'s options; compose `trimmedPrompt + "\n\n" + block` inside `ask()` when building `startRun({ prompt })`. No `AgentRunRequest` changes. There is no fallback variant — this IS the minimal path.
- Empty-prompt send: `ask()` currently bails on `!trimmedPrompt` and `AssistantPanel` sets `sendDisabled` on empty prompt — both gates change to allow send when pending comments exist. The transcript/user entry `text` is ALWAYS the full composed message (typed text + block, or block alone) — `visibleHistoryEntries` drops empty-text entries and `chatMessages` for follow-up turns is rebuilt from `entries[].text`, so the composed text is what keeps history and multi-turn context correct.
- Transcript rendering: add an optional, ephemeral `selectionComments` summary field on `AssistantEntry` used only for in-session rendering — typed text + a compact `N comentarios` `<details>` disclosure (direct precedent: `AssistantContextDisclosure`). Persisted history (`chatHistoryStore.ts` `sanitizeStoredEntry`, closed `AgentChatHistoryEntry` shape, shared with the Telegram remote path) is NOT extended in v1: restored threads degrade gracefully to showing the composed text. Do not touch the stored schema.

### Persistence — main process

- `${userData}/assistant/selection-comments.json` (pattern: `proposalStore.ts` → `assistant/proposals.json`), keyed by workspace + relative path, pending only (sent/discarded pruned on write). Persisting `workspacePath` matches the proposals precedent; note the context-manifest store deliberately sets `workspaceRootPersisted: false` — we follow proposals, and this choice is explicit.
- IPC: new module `electron/ipc/selectionComments.ts` (a deliberate deviation from proposals, which ride `electron/ipc/agent.ts`), exposed in `electron/preload.ts`, typed in `IliadApi` (`src/types/iliad.ts`), and **registered in `electron/main.ts`** — registration is part of the procedure, not optional.
- Security: use the validated pattern — handlers take `workspaceSessionId`, resolve via `resolveWorkspaceRootForSession` (per-window check) + `isInsideAllowedWorkspace`; renderer obtains it via `workspaceContextApiSessionId(workspace)` (note `WorkspaceInfo.sessionId` is optional with a path fallback). `documentRelativePath` is normalized and validated (reject `..`; reuse `pathSafety` helpers).
- Multi-window scope (v1, explicit): per-window in-memory state; persistence is last-write-wins. Two windows on the same workspace can diverge until reload. Accepted and documented; not solved.

### Styles

Per the style-ownership rule: editor-anchored styles (wash, floating action, popovers) go in `editor.css`; chip + transcript disclosure styles in `assistant.css`. No new CSS file. New token in `tokens.css`: `--comment-wash` — derived from `--pending` (#c98912, the existing semantic neighbor: annotation amber) at low alpha (~0.10–0.14). It must NOT be teal: teal means interactive/active everywhere in Iliad, and selection-over-comment would stack two teals into mud. Selection renders above the wash and visibly dominates. While in `EditorPane.tsx`: the editor selection background is a hardcoded `rgba(25, 111, 100, 0.2)` — tokenize it (`--selection-wash`) as a drive-by that `lint:css` will demand anyway.

### i18n

Strings split by surface, matching how labels are threaded: `editor.selectionComments` (floating action, composer, hover popover) added to the narrow labels interface in `EditorPaneProps` and threaded from `App.tsx`; `assistant.selectionComments` (chip, list, transcript disclosure) reachable via the existing `strings.assistant` flow. Both `en` and `es` in `src/i18n/strings.ts`.

## Implementation plan

1. **Model + persistence**: types, main-process store, IPC (module + preload + IliadApi + main.ts registration), `useSelectionComments` with re-anchoring. Verify: typecheck + tests.
2. **Editor surface**: wash decorations from props, updateListener position mapping, floating action + inline composer + hover popover, keymap (resolve the lintKeymap collision here). Verify: typecheck + tests + manual smoke.
3. **Composer + send**: chip row item + expandable list (row click scrolls to highlight), `useAssistantRun` options + `ask()` composition, empty-prompt gates, sent/revert transitions, transcript disclosure, toggle pulse. Verify: typecheck + tests.
4. **Polish**: focus mode pass, i18n completeness, `lint:css`, `npm run build`, manual smoke per CLAUDE.md checklist.

## Tests

House constraints (verified): vitest in node environment, NO React Testing Library, NO jsdom/happy-dom; component tests use `renderToStaticMarkup` + string assertions; interaction logic is extracted into pure functions and tested in node; main-process stores are tested against `mkdtemp` temp userData dirs (precedent: `tests/agent/proposalStore.test.ts`); IPC registration tests mock electron via `vi.mock("electron")` (precedent: `tests/agent/agentIpc.test.ts`); decoration logic is tested on headless `EditorState` (precedent: `tests/editor/aiReviewExtension.test.ts`). Test files follow the by-area layout:

- `tests/agent/selectionCommentsStore.test.ts` — store round-trip against temp userData dir; pending-only pruning; keying by workspace + path; IPC registration with electron mocked; path validation (rejects `..`).
- `tests/editor/selectionCommentsExtension.test.ts` — wash decorations from props on headless EditorState; position mapping through simulated edits (insert before/inside/after range); collapse → sin ancla; mapping disabled across document swap; overlap produces a single non-compounding layer; comment spanning a bold span stays coherent when syntax is revealed.
- `tests/app/selectionCommentsAnchor.test.ts` — re-anchoring: exact, occurrence-aware, prefix tiebreak, orphan flagging; rename ⇒ orphan.
- `tests/app/selectionCommentsSerialize.test.ts` — full payload snapshot; line numbers; newline→`⏎` in quotes; short-quote context rule; repeated-quote ordinal; truncation; deterministic order; orphans last; no closing instruction when user typed text; EN and ES variants.
- `tests/assistant/selectionCommentsChip.test.tsx` — `renderToStaticMarkup` assertions: chip summary text, expanded list rows, sin-ancla rows muted, disclosure rendering in transcript; pure-function tests for list/discard/send-transition logic.

## Risks & mitigations

- **CM decoration sharp edges**: marks only, defensive build, fallback-to-none (visualMarkdown precedent).
- **Anchor drift**: position mapping while open; re-anchor on open/replacement; orphans surfaced, never dropped or guessed.
- **Quietness regression**: the chrome inventory is closed — floating action, inline composer, hover popover, wash, chip + list, transcript disclosure, one transient pulse. Any additional standing surface is out of spec.
- **Send-path regressions**: empty-prompt gate changes are narrow (only when pending comments exist); composed-text invariant keeps history/multi-turn behavior unchanged; revert-on-error mirrors the existing snapshot/restore.

## Review log (v1 → v2)

Two reviews were incorporated in full. Design review (minimalist-design critic): click-to-view replaced by hover (click always places the cursor — blocker); floating-action restraint rules (mouseup-only, settle delay, no keyboard/programmatic selections, never a toolbar); travel-with-selection instead of scroll-dismissal; provisional wash while composing; amber `--comment-wash` from `--pending`, never teal; definitive answers — sent trace: clear entirely; no badge, one transient toggle pulse; inline composer always; ship the shortcut; focus mode = mark up but not send, stated as intended; edge cases (empty/multi-block/long/overlapping selections, mid-run, proposal-apply re-anchor); serializer must not add instructions when the user typed text; chrome inventory closed. Codebase review (Iliad expert): test plan rewritten to house style (no RTL — blocker); empty-prompt send gates named (`ask()` + `sendDisabled` — blocker); chip explicitly NOT a context attachment (limit/dedupe/startRun-mapping hazards — blocker); fallback deleted, minimal send path specified via `useAssistantRun` options; transcript answer closed (composed `entry.text` + ephemeral disclosure field, stored schema untouched); IPC procedure completed (main.ts registration, validated `workspaceSessionId` pattern, path safety); CM state ownership corrected (React-authoritative, stateless extension, mapping disabled across doc swaps); `.editor-surface` positioning facts; lintKeymap collision; i18n split per surface; styles into `editor.css`/`assistant.css` + tokenize the hardcoded selection rgba; lifecycle (rename, multi-window scope, switch-away persistence) made explicit.
