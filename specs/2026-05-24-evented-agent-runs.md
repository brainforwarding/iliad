# Evented Agent Runs

Date: 2026-05-24
Status: reviewed spec

## Problem

Iliad now has context manifests, explicit Markdown document reads, Codex account
runtime support, thinking summaries, and reviewable Markdown changes. The run
state that connects those pieces is still mostly string-based. Electron emits
`status` events such as `reading_context` and `asking_model`, while providers
emit separate diagnostics. The renderer then maps those strings back into UI
copy.

That is fragile for the next phase of the writing agent. We need a typed,
run-scoped event contract that can represent "the agent is reading context",
"the model is working", "changes are being converted", and "a proposal is
ready" without depending on arbitrary status text. We also need this before
later features such as multi-file proposal progress and run history.

## Product Intent

Add a small structured event layer for agent runs. It should make the runtime
state clearer to the codebase while keeping the visible UI almost exactly as
minimal as it is now: a subtle activity indicator, thinking summaries when the
model provides them, and normal assistant prose when the run completes.

This is a foundation spec. It is not a new visible timeline, not a tool log, and
not a subagent UI.

## Goals

- Replace stringly runtime status emissions with typed `run_phase` events.
- Keep the existing thinking summary events working unchanged.
- Preserve backward compatibility for the old `status` event type in the
  renderer, but stop using it for new Electron emissions.
- Add a stable, service-owned `AgentRunPhase` union shared by Electron and
  renderer types:
  - `reading_context`
  - `asking_model`
  - `reviewing_changes`
  - `waiting_for_review`
  - `completed`
  - `failed`
  - `canceled`
- Include only bounded structured metadata:
  - `proposalFileCount`, after proposals are saved;
  - `errorCode`, for failed/canceled terminal events.
- Map phases to localized assistant status labels in one renderer helper.
- Make the renderer ignore unknown future event types safely.
- Emit terminal phases for completed, failed, and canceled runs.
- Keep provider diagnostics out of the renderer-facing run phase stream in this
  slice. Provider adapters may emit thinking summary events only.
- Add tests for phase-to-copy mapping and service/provider phase emission.

## Non-Goals

- No new chat timeline UI.
- No visible provider diagnostics panel.
- No subagent orchestration or subagent status rows.
- No run history browser.
- No changes to the document review UI.
- No changes to the context manifest schema.
- No storage of event streams.
- No retry queue or resumable runs.
- No provider tool-calling bridge.

## User Experience

The user should not see a busier UI after this change.

During a run:

- Generic phases continue to appear as the existing subtle animated activity
  affordance.
- If the model streams thinking summaries, those summaries still replace the
  generic phase text. Later generic run phases must not overwrite an already
  visible thinking summary.
- When a proposal is created, the pending changes card and document review UI
  continue to appear as they do today.
- If a run fails, the existing user-facing error entry appears.

The important change is architectural: the UI receives a phase like
`waiting_for_review`, not an arbitrary string like `"reviewing_changes"`.

## Event Contract

Add:

```ts
export type AgentRunPhase =
  | "reading_context"
  | "asking_model"
  | "reviewing_changes"
  | "waiting_for_review"
  | "completed"
  | "failed"
  | "canceled";

export interface AgentRunPhaseEvent {
  type: "run_phase";
  runId: string;
  phase: AgentRunPhase;
  source: "agent_service";
  proposalFileCount?: number;
  errorCode?: AgentErrorCode;
}
```

`AgentRunEvent` becomes a union of:

- `run_phase`;
- legacy `status`;
- `thinking_delta`;
- `thinking_done`.

Legacy `status` remains accepted by renderer code so older preload/electron
combinations fail gracefully during development. New backend code should emit
`run_phase`.

Provider runtime interfaces must not receive the full `AgentRunEventListener`.
They should receive a narrower thinking-summary listener that can emit only
`thinking_delta` and `thinking_done`. This keeps provider diagnostics and
renderer-facing workflow phases separate.

## Phase Semantics

- `reading_context`: the service is validating the active file and preparing
  explicit context documents.
- `asking_model`: the provider request is being started.
- `reviewing_changes`: the service is converting provider changes into Iliad's
  proposal format.
- `waiting_for_review`: at least one reviewable proposal has been saved. Include
  `proposalFileCount` when available.
- `completed`: the run completed without an error. This can be emitted with or
  without proposals.
- `failed`: the run failed.
- `canceled`: the run was canceled by the user.

## Visual Policy

- `reading_context`, `asking_model`, and `reviewing_changes` are generic
  loader-only phases.
- Thinking summary text is visible and takes precedence over generic phases.
- `waiting_for_review` is proposal-card-owned; it should not add another noisy
  text row beyond the existing pending changes card.
- `completed` is final-assistant-entry-owned and should not render as a visible
  status.
- `failed` is error-entry-owned and should not render as a visible status.
- `canceled` may be used as a terminal service signal, but the renderer can keep
  its immediate local canceled row because it clears the active run before the
  service response returns.
- `proposalFileCount` is metadata for tests/future use. The active chat status
  should not show counts because proposal cards and the document review UI own
  change counts.

## Implementation

Touch:

- `electron/agent/types.ts`
  - Add `AgentRunPhase`, `AgentRunPhaseEvent`, a thinking-only run event union,
    and widen `AgentRunEvent`.

- `src/types/iliad.ts`
  - Mirror the event types exposed through preload.

- `electron/agent/agentService.ts`
  - Replace `emitStatus` usage with `emitRunPhase`.
  - Emit `reading_context` at run start.
  - Emit `asking_model` before provider invocation.
  - Emit `reviewing_changes` before proposal conversion when draft changes
    exist.
  - Emit `waiting_for_review` after proposals are saved, including
    `proposalFileCount`.
  - Emit `completed`, `failed`, or `canceled` before returning.

- `src/assistant/assistantUtils.ts`
  - Add `localizedRunPhase(phase, labels)`.
  - Keep `localizedStatusMessage` for legacy status events.
  - Keep terminal statuses out of visible status churn. Generic phases should be
    hidden beside the wave loader.

- `src/assistant/useAssistantRun.ts`
  - Switch on event type explicitly:
    - `run_phase` maps through `localizedRunPhase`;
    - `status` maps through `localizedStatusMessage`;
    - thinking events keep current behavior;
    - unknown event types are ignored.
  - Remove ad hoc assumptions that every non-status event is a thinking event.
  - Backend phases own run status after the local status row is created.
  - The local thinking fallback remains only as a renderer fallback when no
    thinking summaries arrive.

- `src/i18n/strings.ts`
  - Reuse existing minimal status strings where possible. Add only
    `waitingForReview` if needed by tests/future UI.

## Tests

Add/update tests for:

- `localizedRunPhase`:
  - all phase values map to localized copy;
  - unknown legacy status strings still fall back safely through
    `localizedStatusMessage`.
- `isGenericRunningStatus`:
  - generic phase labels are hidden next to the activity wave;
  - thinking summary text is not hidden.
- `AgentService.startRun` with a stub provider:
  - successful no-proposal runs emit the expected phase sequence;
  - proposal runs emit `reviewing_changes`, `waiting_for_review`, and
    `completed`;
  - failures emit `failed` or `canceled`.

Run:

- `npm run typecheck`
- `npm test`
- `npm run smoke:review`
- `npm run build`

## Rollout

This is an internal contract change with minimal UI impact. If a renderer
receives only old `status` events, it still works. If it receives new
`run_phase` events, it gets typed phases and cleaner future extension points.

The next specs can build on this for:

- multi-file proposal progress;
- run history;
- subagent activity;
- manual context selection.
