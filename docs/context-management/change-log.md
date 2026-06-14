# Context Management Change Log

Status: living change log. Started 2026-05-26.

## 2026-06-13

- Specified, reviewed (a UI/UX + architecture + Codex expert-dev panel), and
  implemented Tighten — an on-demand, selection-scoped concise rewrite
  (ADR-0020 → accepted):
  [2026-06-13 tighten selection](../../specs/2026-06-13-tighten-selection.md).
  A dedicated single-shot OpenAI call (its own non-streaming request body, not
  the agent run pipeline) returns a tighter rewrite shown in an inline
  accept/reject card next to the selection. Accept is stale-safe — it verifies
  the active file, the exact original slice at `{from,to}`, and the current
  requestId before a single synchronous transaction — reusing the anchored-edit
  discipline (ADR-0019). Cancellation is requestId-keyed with a timeout; the key
  never leaves main, which is the authority for the length cap and language
  validation.

## 2026-06-11

- Specified and implemented conversation compaction summaries (ADR-0015 →
  accepted, gate explicitly amended):
  [2026-06-11 conversation compaction summaries](../../specs/2026-06-11-conversation-compaction-summaries.md).
  Past ~2k omitted tokens, a cached LLM summary of the omitted prefix rides
  above the recent thread on both providers: generated post-run fire-and-forget
  (fast mode, least-privilege profile, 60s timeout, failure cooldown, marker
  and size sanitation), content-addressed by an injective prefix hash with
  oldest-first rolling coverage so receipts never overstate, embedded as
  untrusted delimiter-neutralized data, purged by clear-chat-history, and
  receipted as "Summary of N earlier messages" with the omission row reduced
  to the uncovered gap. Any failure degrades to the plain omission note.
- Specified and implemented budget-bounded conversation history and permanent
  per-turn receipts:
  [2026-06-11 conversation history budget and turn receipts](../../specs/2026-06-11-conversation-history-budget-and-turn-receipts.md).
- Removed the fixed last-8-messages history window from both providers; history
  is now the full visible transcript within an estimated 40k-token budget,
  selected once in `preparedRunRequest` with a deterministic omission note and a
  matching excluded manifest row (ADR-0014).
- Added the identifier-only index of documents referenced earlier in the
  conversation (paths only, never content), sanitized in the main process and
  recorded as reference rows in the manifest.
- Made the per-turn context receipt permanent and uniform in the transcript:
  every assistant/error turn with a manifest or document-tool activity renders
  one collapsed receipt; the signature-gated disclosure heuristic was removed,
  and run activities now persist into the turn's entry (in-session) instead of
  being discarded at run end.
- Added quiet attachment markers on sent user messages for manually attached
  files.
- Recorded ADR-0014 (accepted), an ADR-0001 amendment, and ADR-0015 (proposed
  long-thread compaction summaries).
- Specified and implemented workspace rules (AGENTS.md):
  [2026-06-11 workspace rules AGENTS.md](../../specs/2026-06-11-workspace-rules-agents-md.md).
  A root AGENTS.md is read fresh per run on both providers and profiles,
  injected as framed untrusted preferences with neutralized delimiters, capped
  at 2k tokens with honest exclusion above the cap, receipted every turn with
  its hash (ADR-0018), kept out of the reference index and out of Telegram
  answer sources.
- Specified and implemented editor selection as context:
  [2026-06-11 editor selection as context](../../specs/2026-06-11-editor-selection-as-context.md).
  A live selection surfaces as a dismissable composer chip and travels as
  offsets only; main re-validates bounds and slices the quoted excerpt from the
  active-file snapshot; the receipt gains a "Selección (líneas X-Y)" row with
  line-range fields that survive serialization (ADR-0017). Consumed on send,
  re-armed by new selections, un-consumed on failed runs.
- Specified and implemented open_document + answer streaming:
  [2026-06-11 open document and answer streaming](../../specs/2026-06-11-open-document-and-answer-streaming.md).
  The agent gained a desktop-only, validated, receipted `open_document` tool
  (ADR-0016) — motivated by a reproduced capability hallucination ("Listo,
  abrí…") — executed by the renderer through the save-flushing open flow
  without marking user navigation. Answer text now streams into the transcript
  (generation-aware deltas coalesced in main; proposal markers cut with
  prefix-holdback; math skipped while streaming; scroll follows only while
  pinned to the bottom); the final run text remains the stored record.
- Specified and implemented exhaustive document discovery:
  [2026-06-11 exhaustive document discovery](../../specs/2026-06-11-exhaustive-document-discovery.md).
  Traversal budgets became backstops instead of working limits (maxDirectories
  200 → 10,000; maxFilesystemEntries 2,000 → 100,000; maxPathSearchDepth 6 → 16;
  maxContentSearchDepth 2 → 8; maxDepth 2 → 8; maxPathSearchFiles 2,000 →
  20,000); output caps unchanged (50 matches, 500 list rows). The walk is
  dirent-based (no per-entry lstat) and abortable. Content-search candidates are
  ranked by path relevance instead of alphabetical order. `search_documents`
  gained an optional `directory` scope with scope-relative content depth (both
  providers via the shared schema, surfaced in receipts), oversized list/search
  outputs degrade by dropping rows instead of failing, extensionless `@`-mention
  resolution now goes through the exhaustive search path pass, and the prompt
  policy tells the model to narrow a capped zero-result search instead of
  repeating it. Evaluated and rejected a shell/Python search tool per the
  agent-vision tool boundary and ADR-0009.
- Moved the per-turn receipt above the answer and renamed its collapsed summary
  to Process/Proceso (answer-size type, chevron affordance):
  [2026-06-11 process receipt above answer](../../specs/2026-06-11-process-receipt-above-answer.md).
  The collapsed "Context: N files" fallback line was dropped; context rows
  remain in the expanded body, with an explicit "Sin archivo incluido" row for
  the no-file negative. Error turns keep the receipt below the error message.
  ADR-0004/ADR-0014 unchanged (manifest data untouched).
- Specified and implemented anchored edits (SEARCH/REPLACE):
  [2026-06-11 anchored edits search replace](../../specs/2026-06-11-anchored-edits-search-replace.md).
  Targeted edits on the OpenAI path now travel as Aider-style exact-match
  SEARCH/REPLACE blocks applied sequentially to the active-file snapshot,
  failing closed on zero/ambiguous matches (including setext `=======`
  collisions, resolved by requiring exactly one viable split) with a localized
  retry sentence replacing the answer; untouched regions are byte-identical by
  construction (ADR-0019). `FULL_REPLACEMENT` remains the rewrite path and wins
  on conflict; the streaming cutoff and the Telegram fail-closed marker guard
  both gained the anchored opener; Codex and remote paths untouched.

## 2026-05-27

- Specified and implemented pending document review navigation:
  [2026-05-27 pending document review navigation](../../specs/2026-05-27-pending-document-review-navigation.md).
  Agent-created documents still appear as green-dot pending file-tree rows; a
  single new-document proposal opens the pending review and reveals it in the
  tree, while current-document edits keep the current review in place.
- Recorded the context decision that pending create reviews are UI state, not
  active Markdown context, until the user presses `Crear` and the file exists on
  disk.

## 2026-05-26

- Added this `docs/context-management/` folder as the durable home for context
  architecture notes, external guidance, research links, decisions, and change
  history.
- Implemented the context attachment picker spec:
  [2026-05-26 context attachment picker](../../specs/2026-05-26-agent-context-attachment-picker.md).
- Added `@` autocomplete for Markdown files.
- Added drag/drop file-to-chat context chips.
- Added main-process validation and safe Markdown document listing for context
  attachments.
- Kept exact `@file.md` behavior while adding safer extensionless Markdown
  lookup for unambiguous matches.
- Fixed selected `@` mentions so the typed mention remains visible in the sent
  chat message while also creating the context chip.
- Fixed picker closing behavior after selection by completing the mention with a
  separator.
- Implemented OpenAI model-directed local Markdown tools:
  [2026-05-26 model-directed document tools](../../specs/2026-05-26-model-directed-document-tools.md).
- Strengthened the context discovery prompt policy so named workspace items such
  as courses, folders, and sessions should be discovered through document tools
  before content-dependent advice:
  [2026-05-26 context discovery prompt policy](../../specs/2026-05-26-context-discovery-prompt-policy.md).
- Added [OpenClaw Codex runtime research](./openclaw-codex-runtime-research.md)
  and updated the current architecture notes to distinguish OpenAI API document
  tools from Codex workspace runtime access.
- Implemented Codex context discovery and live activity:
  [2026-05-26 Codex context discovery and live activity](../../specs/2026-05-26-codex-context-discovery-and-live-activity.md).
  Codex now gets Iliad-owned document-tool activity events, path-first deep
  Markdown discovery, safer session/course matching, and clearer final receipts.
- Refined Codex discovery receipts and the active-run indicator:
  [2026-05-26 Codex discovery receipts and working indicator](../../specs/2026-05-26-codex-discovery-receipts-and-working-indicator.md).
  Final receipts now preserve path-search counts, suppress superseded
  zero-result capped discovery rows after successful Codex document reads, and
  keep the three-dot working indicator visible while a run is active.

Related commits on `master`:

- `6413e9a` - context management architecture docs.
- `4affdeb` - model-directed document tools.
- `0703487` - context picker and drag/drop feature.
- `b8167c1` - preserve selected mention text in the chat message.
- `cfc3a9d` - close picker after selecting a suggestion.
- `b29184c` - context discovery prompt policy.
- `fd22698` - OpenClaw Codex runtime research.
- `f74b481` - Codex context discovery and live activity.
- `fecd55f` - Codex discovery receipts and working indicator.

## 2026-05-25

- Specified local chat history:
  [2026-05-25 chat history](../../specs/2026-05-25-chat-history.md).
- Decision: persist visible transcript text only, not raw context payloads or
  provider diagnostics in the chat history thread.

## 2026-05-24

- Specified and implemented the context ledger foundation:
  [phase 1](../../specs/2026-05-24-agent-context-ledger-phase-1.md) and
  [phase 2](../../specs/2026-05-24-agent-context-ledger-phase-2.md).
- Added manifest-style context disclosure to assistant transcript entries.
- Specified the safe Markdown document tool boundary:
  [document tool contract](../../specs/2026-05-24-document-tool-contract.md).
- Specified explicit `@file.md` reading and tool usage ledger ideas in
  [agent tool usage ledger](../../specs/2026-05-24-agent-tool-usage-ledger.md).

## 2026-05-23

- Wrote the first major context management spec:
  [2026-05-23 agent context management](../../specs/2026-05-23-agent-context-management.md).
- Established the main principles:
  - every run needs a context manifest;
  - the active file is context, not the chat identity;
  - whole-workspace context should not be hidden or automatic;
  - explicit references should be inspectable;
  - exact Markdown should be re-read before proposing edits.
