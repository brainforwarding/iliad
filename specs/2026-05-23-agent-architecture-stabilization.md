# Agent Architecture Stabilization Refactor

Date: 2026-05-23
Status: reviewed spec

## Product Intent

Iliad's assistant is now part of the core editing experience: it reads local
Markdown, proposes reviewable document changes, and never writes without user
approval. The next assistant features will add more provider capabilities
such as dictation, account/auth alternatives, richer context, and eventually
subagent-style work.

Before adding more behavior, the current AI code needs a small stabilization
refactor. The goal is not to redesign the assistant or change what users see.
The goal is to keep responsibilities small enough that future assistant work
can be added safely.

## Current Findings

The architecture principle in `README.md` is still right: `src/App.tsx` should
stay a composition layer and feature behavior should live in owner modules.
The source-as-contract rule is also being honored: AI proposals are Markdown
changes that the user reviews before applying.

The main issue is concentration of responsibility:

- `electron/agent/openaiResponses.ts` is about 1,200 lines and owns prompt
  construction, OpenAI request bodies, streaming transport, SSE parsing,
  reasoning summary handling, retry/fallback behavior, diagnostic events,
  legacy transport parsing, visible-message sanitizing, and proposal draft
  creation.
- `src/components/AssistantPanel.tsx` is about 600 lines and owns settings,
  transcript rendering, run lifecycle, streaming status events, proposal cards,
  composer behavior, and direct agent API calls.
- `src/App.tsx` still works as the app shell, but it has accumulated agent
  proposal/review orchestration: listing proposals, applying files, rejecting
  proposals, resolving hunks, selecting review targets, and deriving editor
  review state.
- `docs/architecture.md` is stale. It still describes AI/review flows as
  something to avoid, while the README now defines a review-first assistant as
  part of the current milestone.

This is normal prototype growth, but it is the right time to stabilize before
new assistant features add more branches to the same files.

## Goals

- Preserve current user-visible behavior.
- Preserve the current Electron preload and renderer `window.iliad.agent`
  public API unless a purely internal type move is needed.
- Keep OpenAI Responses streaming, thinking summaries, diagnostics, retries,
  proposal parsing, and visible text sanitizing working exactly as before.
- Split `electron/agent/openaiResponses.ts` into cohesive provider modules.
- Move assistant run/transcript/settings/composer orchestration out of the
  presentational assistant panel into focused renderer modules/components.
- Move agent proposal/review orchestration out of `src/App.tsx` into a focused
  hook, keeping `App.tsx` closer to composition.
- Update `docs/architecture.md` so the module map reflects the current
  assistant, diagnostics, testing, and review UI architecture.
- Keep tests passing and add focused tests only where module extraction creates
  new exported pure helpers.

## Non-Goals

- No new assistant features.
- No UI redesign.
- No changes to prompt behavior beyond moving existing prompt text into a
  dedicated module.
- No migration to OpenAI Structured Outputs or function/tool calls.
- No provider abstraction for Gemini or other models.
- No ChatGPT account login.
- No dictation implementation.
- No subagent runtime.
- No durable chat-history redesign.
- No global state library.
- No large folder reorganization outside the touched assistant/editor seams.

## Target Module Changes

### Electron Agent Provider

Split `electron/agent/openaiResponses.ts` into smaller owner modules:

```text
electron/agent/
  openaiResponses.ts          # thin public orchestrator/export surface
  openai/
    client.ts                 # streaming/non-streaming fetch and retry loop
    errors.ts                 # OpenAI request/stream errors and retry classifiers
    prompts.ts                # instructions, modeInstruction, userInput
    request.ts                # request body construction and model effort mapping
    stream.ts                 # SSE frame parsing and stream event normalization
    summaries.ts              # thinking-summary sanitizing/emission helpers
  proposalDrafts.ts           # legacy FULL_REPLACEMENT/NEW_DOCUMENT parsing
```

The exact filenames may vary if implementation discovers a cleaner local
boundary, but the responsibilities should be separated.

`createOpenAiResponse(...)` remains the public function imported by
`AgentService`. Existing tests should continue to import stable public helpers:

- `createOpenAiResponse(...)`
- `parseLegacyProposalDrafts(...)`
- `sanitizeLegacyAssistantText(...)`
- `sanitizeThinkingSummary(...)`

If these helpers move, `openaiResponses.ts` may re-export them to avoid churn.

### Renderer Assistant Panel

Split `AssistantPanel` into a small container and focused pieces:

```text
src/assistant/
  useAssistantRun.ts          # run id, transcript entries, streaming events, cancel/new chat
  assistantUtils.ts           # file basename, status text normalization, proposal filters

src/components/assistant/
  AssistantHeader.tsx
  AssistantSettings.tsx
  AssistantPendingProposals.tsx
  AssistantTranscript.tsx
  AssistantComposer.tsx

src/components/AssistantPanel.tsx
```

`AssistantPanel.tsx` should remain the compatibility entry point imported by
`App.tsx`, but it should mostly compose smaller pieces.

### App Proposal Orchestration

Extract proposal/review orchestration from `src/App.tsx` into a hook:

```text
src/app/useAgentProposals.ts
```

The hook should own:

- proposal list state;
- refresh/merge behavior scoped by workspace;
- apply file;
- reject proposal;
- reject file;
- resolve hunk;
- select review target;
- active review derivation;
- virtual review file derivation;
- editor review state derivation.

`App.tsx` should pass the hook the dependencies it needs, such as workspace,
active file, tree, document text, file open/load helpers, flush save, refresh
tree, notices/errors, history recording, and strings.

The hook must preserve current behavior:

- flush saves before apply/reject/resolve/select actions;
- clear stale review targets when workspace/proposal changes;
- open the edited document when the user reviews a pending edit for a different
  file;
- refresh the tree and open a newly created Markdown file after applying a
  create-file proposal;
- update current document text when applying or resolving changes for the active
  file;
- handle stale/failed proposal states as before.
- clear review mode when normal document navigation makes the current review
  target irrelevant, including file-tree navigation away from an edited file and
  leaving a create-file preview.

Shared proposal helpers such as `fileHasMutableReview`, `reviewableFile`, and
`ReviewTarget` should live in an app/agent helper or hook export, not in a
presentational assistant component.

### Assistant Run Invariants

The assistant split must preserve the current run/event behavior:

- missing API key opens settings and adds the existing missing-key error entry;
- settings still auto-open when no key is stored;
- `chatMessages` are derived only from user and assistant transcript entries,
  not status/error entries;
- sending a prompt clears the composer, adds a user entry, and creates one
  status row;
- status events are ignored unless `event.runId === latestRunId.current`;
- thinking summaries are keyed by `runId:itemId:summaryIndex`;
- thinking deltas update only the active run's status row;
- generic running statuses are represented by the subtle wave UI without
  duplicate status text;
- the 1600ms fallback from asking-model to thinking is preserved when no
  summary event arrives;
- final response removes the transient status row, appends the assistant text,
  merges proposals, and selects the first reviewable proposal/file;
- cancel removes the active status row and appends the canceled status;
- new chat cancels any active run, clears transcript entries, and clears review
  target, but does not discard pending proposals;
- textarea autoresize and Enter-to-send behavior remain unchanged.

Extracted assistant components must preserve the existing CSS class names and
DOM structure unless a visual/browser check explicitly verifies an intentional
change. This is a refactor, not a UI polish pass.

## UX States

There should be no intentional user-visible change.

- Loading/thinking summaries remain as implemented.
- Pending proposal card copy and behavior remain as implemented.
- Document-native review UI remains as implemented.
- Failure states continue to show normalized assistant errors or existing app
  error messages.
- Existing accept/reject hunk and accept/reject file flows remain unchanged.

## Backend / IPC / Data

- No new IPC channels.
- No IPC channel rename.
- Preserve the public `window.iliad.agent` contract across
  `electron/ipc/agent.ts`, `electron/preload.ts`, and `src/types/iliad.ts`.
- Preserve `agent:start-run`, `agent:run-event`, `agent:cancel-run`, proposal
  apply/reject/list channels, and the `onRunEvent` unsubscribe behavior.
- No change to proposal persistence format.
- No migration of existing user proposal data.
- No new filesystem permission.
- No change to local OpenAI API key storage.
- No change to diagnostics file location or schema.

## AI / Provider Behavior

- Preserve the current prompt text exactly unless a move requires whitespace
  normalization that does not change instructions.
- Preserve current retry behavior for unsupported reasoning, text verbosity, and
  streaming parameters.
- Preserve current behavior for non-streaming fallback.
- Preserve thinking summary sanitation and display semantics.
- Preserve visible assistant text sanitation so raw `FULL_REPLACEMENT`,
  `NEW_DOCUMENT`, fenced diffs, and full Markdown payloads do not appear in
  chat.
- Preserve request shapes:
  - first streaming request includes `stream: true`, `reasoning`, and
    `text.verbosity`;
  - option retries remove only the rejected streaming option when possible;
  - unsupported streaming fallback uses the non-streaming request body and must
    omit `stream`, `reasoning`, and `text`;
  - provider diagnostics still emit request started/completed and retry events
    with equivalent fields.

## Tests

Required local checks:

- `npm test`
- `npm run typecheck`
- `npm run build`

Focused test expectations:

- Existing `tests/agent/openaiResponses.test.ts` continues to cover public
  provider behavior after module extraction.
- Existing proposal store, review diff, and diagnostics tests remain passing.
- Add or preserve regression coverage for:
  - reasoning-summary retry;
  - text-verbosity retry;
  - unsupported-streaming fallback to non-streaming;
  - streaming request body vs non-streaming fallback body shape;
  - stream error events becoming normalized provider errors;
  - chunked or multi-frame SSE parsing;
  - thinking delta and done emission, including dedupe/final flush behavior;
  - legacy proposal parsing and visible assistant text sanitizing.
- If stream parsing remains private, cover it through `createOpenAiResponse(...)`
  tests rather than exporting internals just for tests.

Renderer behavior checks should be covered by focused tests if practical, or by
a documented manual smoke checklist if adding React hook tests would create too
much framework surface for this refactor. The required behaviors are:

- pending proposals remain visible after New Chat;
- the first reviewable proposal opens document review after a run;
- create-file preview stays read-only until accepted;
- normal file-tree navigation clears stale review mode;
- cancel displays the canceled status and stops the active run;
- missing API key expands settings and shows the existing missing-key message;
- apply/reject/resolve actions flush saves before mutating proposal state;
- applying a create-file proposal refreshes the tree and opens the created file;
- applying/resolving an active-file edit updates the visible document text.

## Rollout / Deployment

Repository topology:

- Production/trunk branch: `master`
- Development branch: none
- Deployment trigger: no GitHub Actions workflows found in recent checks; push
  to `origin/master` is the production publish step for this local app repo.

Rollout:

1. Implement in dedicated worktree and feature branch.
2. Run local tests, typecheck, and build.
3. Commit the refactor.
4. Merge/fast-forward into local `master`.
5. Push `master` to `origin/master`.
6. Inspect remote state / GitHub checks if any exist.
7. Remove the temporary worktree after confirming the pushed commit is on
   production.

## Panel Selection

This change touches Electron provider code, React assistant UI composition,
app-shell proposal orchestration, tests, and architecture docs. The panel is:

- Spec reviewer: architecture/backend focused, checking module boundaries,
  provider behavior preservation, and test gaps.
- Spec reviewer: UI/frontend focused, checking that the assistant panel split
  improves maintainability without accidental UX change.
- Implementation worker: Electron provider split and provider tests.
- Implementation worker: renderer assistant/proposal hook extraction and UI
  tests/type safety.
- Verification worker: independent review of final patch plus local
  verification commands.

The orchestrator owns the first spec, reconciles reviewer feedback, integrates
worker output, runs final checks, commits, pushes, and cleans worktrees.

## Spec Review Reconciliation

Accepted from provider/architecture review:

- Strengthened provider regression tests around retry matrix, request shape,
  stream errors, SSE parsing, and thinking summary events.
- Made request-shape preservation explicit.
- Added explicit IPC/preload/type contract preservation.
- Kept `proposalDrafts.ts` outside `openai/` because legacy markers are an
  Iliad proposal adapter, not OpenAI transport.
- Avoided naming a provider module `openai/errors.ts` to reduce confusion with
  `electron/agent/errors.ts`.

Accepted from frontend/UI review:

- Added review-clearing ownership to `useAgentProposals`.
- Added assistant run invariants for settings, composer, transcript, event
  filtering, fallback timing, cancel, and new chat.
- Added renderer behavior verification requirements.
- Added shared proposal helper/type guidance.
- Added CSS/DOM preservation guidance for extracted assistant components.

Rejected/deferred:

- Splitting this into multiple separate specs would reduce risk, but the user
  asked for one stabilization pass. The scope remains acceptable because it is
  behavior-preserving, test-covered, and can be implemented in staged worker
  slices with disjoint ownership.

## Open Questions / Assumptions

- Assumption: this pass should be behavior-preserving even if it leaves some
  files still moderately large.
- Assumption: it is acceptable for `openaiResponses.ts` and
  `AssistantPanel.tsx` to remain compatibility entry points after extraction.
- Assumption: no browser/Electron UI smoke run is required unless the refactor
  changes markup or CSS behavior in a way that build/typecheck cannot cover.
