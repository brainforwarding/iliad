# Agent Thinking Summaries Spec

Date: 2026-05-23
Status: implemented

## Product Intent

The agent panel should not sit on a static `Preparing context` message while
a run is working. It should show lightweight, live progress that feels like a
real coding/writing agent: reading context, deciding whether to edit, preparing
a proposal, and waiting for model output. When the active OpenAI model provides
reasoning-summary streaming events, Iliad should surface those summaries in a
compact "thinking" row. When summaries are unavailable, Iliad should fall back
to truthful app-authored progress states.

The UI must stay minimal. Thinking summaries are status, not chat content. They
should disappear or collapse when the final assistant response arrives.

## Source Material

Current implementation:

- [electron/agent/openaiResponses.ts](../electron/agent/openaiResponses.ts)
- [electron/agent/agentService.ts](../electron/agent/agentService.ts)
- [electron/ipc/agent.ts](../electron/ipc/agent.ts)
- [electron/preload.ts](../electron/preload.ts)
- [src/components/AssistantPanel.tsx](../src/components/AssistantPanel.tsx)
- [src/types/iliad.ts](../src/types/iliad.ts)

Official OpenAI references:

- Responses API `reasoning.summary`: <https://developers.openai.com/api/reference/resources/responses/methods/create>
- Responses streaming events for `response.reasoning_summary_text.delta` and
  `.done`: <https://platform.openai.com/docs/api-reference/responses-streaming?api-mode=responses>
- Current model guidance says to use the Responses API for reasoning,
  tool-calling, and multi-turn use cases, and to tune `reasoning.effort`:
  <https://developers.openai.com/api/docs/guides/latest-model>
- Agents SDK streaming docs separate assistant text streams from full event
  streams that include runtime events:
  <https://openai.github.io/openai-agents-js/guides/streaming/>

## Current State

The renderer calls `window.iliad.agent.startRun(...)` and waits for one
completed response. Electron calls `fetch("https://api.openai.com/v1/responses")`
without `stream: true`, then returns:

- final visible assistant text;
- parsed proposal drafts;
- response id;
- normalized error if the request fails.

The panel shows a user message plus a static status entry while waiting. It
cannot update with model events because the IPC contract is a single
promise-returning handler.

## Goals

- Stream run events from Electron to the renderer during `agent:start-run`.
- Show compact live thinking/status updates in the assistant transcript while
  the run is active.
- Use OpenAI Responses streaming and request `reasoning.summary: "concise"`
  when supported.
- Handle `response.reasoning_summary_text.delta` and
  `response.reasoning_summary_text.done`.
- Continue collecting final output text and proposal transport markers exactly
  enough to preserve current edit/create proposal behavior.
- Keep final chat clean: no raw diff blocks, no `FULL_REPLACEMENT`, no full
  generated document body.
- Keep cancellation working through the existing run id and abort controller.
- Fall back to app-authored progress states if the model/provider does not
  emit reasoning summaries.
- Avoid raw chain-of-thought. Only display summaries explicitly returned by
  the API or local deterministic statuses.

## Non-Goals

- No subagent orchestration UI.
- No full trace viewer.
- No tool execution or MCP support.
- No migration to the OpenAI Agents SDK in this release.
- No Gemini provider work.
- No persistent storage of detailed thinking summaries beyond the current
  in-memory transcript.
- No display of raw `reasoning_text` events.

## UX

### Active Run

When the user sends a prompt:

1. The user bubble appears immediately.
2. The assistant creates one compact status/thinking row.
3. Before provider events arrive, show app-authored states:
   - `Reading context`
   - `Asking model`
4. If reasoning-summary events arrive, replace the generic status with the
   latest concise summary.
5. If multiple summaries arrive, show only the latest completed or current
   summary, not a long log.
6. When final assistant text arrives, remove the transient status row and show
   the final assistant message.
7. If proposals were created, keep using the pending-card and document-native
   review UI.

### Copy

The row should be short and factual:

- English examples: `Reading context`, `Thinking`, `Preparing proposal`,
  `Reviewing changes`
- Spanish examples: `Leyendo contexto`, `Pensando`, `Preparando propuesta`,
  `Revisando cambios`

Do not label the row as raw "chain of thought." The user-facing label should
be `Thinking` / `Pensando`.

### Visual Treatment

- Use the existing status-entry style, lighter than normal assistant text.
- Do not use a large card or spinner-heavy block.
- If a summary is longer than 2 lines, clamp it and keep the latest text visible.
- Keep animation subtle: optional small pulse/dot, no large loader.

## IPC Design

Keep the existing `agent:start-run` response for compatibility, but add event
streaming over IPC:

```ts
type AgentRunEvent =
  | { type: "status"; runId: string; message: string }
  | {
      type: "thinking_delta";
      runId: string;
      itemId: string;
      summaryIndex: number;
      delta: string;
    }
  | {
      type: "thinking_done";
      runId: string;
      itemId: string;
      summaryIndex: number;
      text: string;
    };
```

Electron implementation:

- `ipcMain.handle("agent:start-run", ...)` may continue returning the final
  `AgentRunResponse`.
- During the handler, use `event.sender.send("agent:run-event", runEvent)` to
  push run events.
- Preload exposes `window.iliad.agent.onRunEvent(listener)` and returns an
  unsubscribe function.
- Preload must remove the exact `ipcRenderer.on` listener when unsubscribe is called.
- `AssistantPanel` registers `onRunEvent` in a `useEffect` and calls
  unsubscribe on unmount.
- Renderer ignores events whose `runId` does not match `latestRunId.current`.
- `agent:cancel-run` keeps aborting the same controller.
- The awaited `agent:start-run` promise remains the only owner of final
  assistant text, proposals, final errors, and pending-review selection.
- Streaming events are progress-only. They must not add final assistant
  messages or merge proposals.

This avoids trying to stream through the return value of an IPC handler.

## Provider Design

Add `createOpenAiResponseStream(...)` next to the current non-streaming
implementation, or convert `createOpenAiResponse(...)` to accept an optional
event callback.

Request body:

```ts
{
  model,
  instructions,
  input,
  max_output_tokens: 4096,
  stream: true,
  reasoning: {
    effort: modeToReasoningEffort(mode),
    summary: "concise"
  },
  text: {
    verbosity: "low"
  }
}
```

Reasoning effort mapping:

- `fast` -> `low`
- `balanced` -> `medium`
- `deep` -> `high`

Fallback:

- If OpenAI returns a request error indicating unsupported reasoning parameters,
  retry once without the entire `reasoning` object.
- If OpenAI returns a request error indicating unsupported `text.verbosity`,
  retry once without `text.verbosity`.
- If both fail, fall back to the current non-streaming request shape before
  surfacing an error, unless the original error is auth, quota, rate limit,
  timeout, cancellation, or network/DNS.
- If a user-selected model does not support reasoning controls, do not block
  the run.
- When running without reasoning-summary support, emit app-authored status
  events only.
- Preserve the current normalized error behavior for network, DNS, auth,
  timeout, and rate-limit failures.

Streaming parser:

- Parse SSE `data:` frames from the fetch body.
- Accumulate assistant output text from output-text deltas and/or completed
  response payloads inside Electron.
- Accumulate reasoning summary deltas by `(item_id, summary_index)`.
- Emit `thinking_delta` sparingly to the renderer; debounce if events arrive
  too quickly.
- Prefer displaying `thinking_done.text` over a stream of partial deltas when
  both are available.
- Ignore raw `response.reasoning_text.delta` and `.done` events.
- On `response.completed`, parse the final text through existing
  `parseLegacyProposalDrafts(...)` and `sanitizeLegacyAssistantText(...)`.
- Resolve the original `agent:start-run` promise with the final
  `AgentRunResponse`; do not send a separate completed event to the renderer.

Thinking summary sanitizer:

- Collapse whitespace and strip Markdown headings, bullets, code fences, and
  emphasis markers.
- Cap display text to 180 characters.
- Drop summaries that contain fenced code, transport labels, or long
  quoted/document excerpts.
- Drop summaries that mention hidden chain-of-thought, internal policy, or raw
  reasoning.
- If the sanitized summary is empty, keep the current app-authored status text.

## Prompt And Visible Text

Update the provider instructions so visible assistant text no longer says:

- "below is the diff"
- "then the full replacement"
- "here is the complete document"

The model may still output transport markers for parsing, but visible text
should say:

- `I prepared a proposal. Review it in the document.`
- `Preparé una propuesta. Revísala en el documento.`

The sanitizer should additionally strip common transport-oriented sentences if
they leak into visible chat.

## Renderer State

`AssistantPanel` should maintain transient per-run state:

```ts
interface ActiveRunDisplay {
  runId: string;
  phase: "reading_context" | "asking_model" | "thinking" | "finalizing";
  thinkingText: string;
  finalTextDraft: string;
}
```

Rules:

- Status/thinking rows are not added to `chatMessages` history.
- Final assistant messages are added to history after completion.
- Final assistant text is not streamed in this release; the priority is
  thinking/status summaries.
- The awaited `startRun` result removes the transient thinking row and adds
  the final sanitized assistant message.

## Failure And Cancellation

- Cancellation removes the transient thinking row and shows the existing
  canceled status.
- Network/provider errors are handled from the awaited `startRun` result and
  replace the thinking row with the normalized error.
- If streaming starts but fails mid-run, show the normalized error and do not
  create proposals from partial output.
- If proposal parsing fails, preserve current malformed-provider-response handling.

## Privacy And Safety

- Do not display raw chain-of-thought.
- Display only API-provided reasoning summaries or app-authored local statuses.
- Do not persist thinking summaries in `assistant/proposals.json`.
- Do not include thinking summaries in future chat context by default.
- Do not log API event payloads in production logs, except compact error diagnostics.

## Tests

Local checks:

- `npm run typecheck`
- `npm run build`
- `npm run smoke:review`
- `git diff --check`

Focused tests/smokes:

- SSE parser handles `response.reasoning_summary_text.delta`.
- SSE parser handles `response.reasoning_summary_text.done`.
- SSE parser ignores `response.reasoning_text.delta`.
- Final text still creates edit-file proposal from `FULL_REPLACEMENT`.
- Sanitized final text does not show diff/full-replacement transport language.
- Renderer ignores stale run events after a new chat or cancellation.
- Cancellation aborts fetch and removes transient thinking state.
- Unsupported reasoning-summary retry still returns final text and proposals.

Manual checks:

- Spanish run shows `Pensando`/summary text rather than static `Preparando contexto`.
- When no reasoning summaries arrive, app-authored phases update honestly.
- Final response replaces transient thinking row.
- Pending proposal still opens document-native review.
- Chat transcript remains clean after proposals are generated.

## Rollout

This is a local Electron app on a single `master` production branch. Ship behind
the existing agent settings surface; no new user-facing setting is required for
v1. If streaming causes provider-specific regressions, disable the streaming
path by falling back to the existing non-streaming `createOpenAiResponse(...)`
implementation.

## Open Questions

- Should we show final assistant text streaming in v1, or only
  thinking/status summaries?
- Should thinking summaries be collapsible after completion for debugging, or
  removed entirely?
- Should mode `fast` request `reasoning.summary: "concise"` with
  `effort: "low"`, or omit summaries for fastest latency?
