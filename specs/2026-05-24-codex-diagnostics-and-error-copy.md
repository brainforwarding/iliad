# Codex Diagnostics And Error Copy Spec

Date: 2026-05-24
Status: implemented

## Problem

After moving the main assistant to Codex account runtime when connected, a failed
Codex run still surfaces as a generic OpenAI failure:

- terminal output prints `OPENAI_PROVIDER_UNAVAILABLE`;
- the chat UI says OpenAI is unavailable;
- local diagnostics show only `provider.request.started`,
  `provider.request.completed`, and `agent.run.failed`;
- the logs do not say whether Codex failed during `thread/start`, `turn/start`,
  or after a completed failed turn.

This makes the current failure impossible to debug without guessing.

## Product Intent

Keep the UI clean and the logs safe, but make the next failed Codex run
actionable. A developer should be able to inspect the local JSONL log and know
which provider ran, which Codex phase failed, and any safe failure code/category
that the runtime exposed.

## Goals

- Add provider identity to agent/provider diagnostics.
- Add redacted Codex phase breadcrumbs:
  - `thread_start`
  - `thread_started`
  - `turn_start`
  - `turn_started`
  - `turn_completed`
  - `request_approval`
  - `notification`
- Capture safe Codex turn status/failure codes when a turn completes failed.
- Make terminal diagnostics provider-aware instead of hardcoded to OpenAI.
- Make `provider_unavailable` UI copy provider-neutral, while keeping
  API-key-specific errors OpenAI-specific.
- Prefer actionable provider-specific `userMessage` over generic label text.
  If Codex exposes a safe code/category, or a message that can be classified
  into usage, billing, auth, or model-access failure, show a local user-facing
  explanation for that category.
- Add tests for Codex phase diagnostics and provider-neutral error copy.

## Non-Goals

- No raw Codex payload logging.
- No raw prompts, document contents, file paths, workspace roots, auth tokens,
  or API keys in logs.
- No in-app diagnostics console.
- No automatic log upload.
- No attempt to fix the underlying Codex failure in this change.

## UX

Normal users should not see technical diagnostics, but they should see
actionable provider reasons. The chat error for provider runtime failures should
say that the agent runtime is unavailable only when no safe actionable reason is
available.

English:

- `The agent runtime is unavailable right now. Try again shortly.`

Spanish:

- `El motor del agente no está disponible ahora. Intenta de nuevo en un momento.`

Examples:

- usage/funds/rate-limit: tell the user Codex reported a usage or billing limit;
- auth/session: tell the user to reconnect Codex;
- model/access: tell the user Codex could not use the selected model;
- short safe provider message: classify it into a local actionable category,
  but do not show the raw message;
- unknown/raw/unsafe message: show the generic localized runtime message.

Raw runtime/backend messages must not be surfaced directly. They must pass the
same safety checks as logs: no paths, secrets, prompt/document fragments, or
multi-line payloads.

## Diagnostics Behavior

JSONL logs remain under Electron `userData/logs`.

Add safe details only:

- `providerId`
- `providerLabel`
- `phase`
- `method`
- `status`
- `turnId`
- `threadId`
- `itemType`
- `changeCount`
- `failureCode`
- existing safe counts and durations

Do not log:

- prompt text;
- active Markdown text;
- raw Codex request/notification payloads;
- file paths or workspace roots;
- secrets or auth fields.

`AgentRuntimeError.detail` must contain only safe codes/categories/statuses,
not raw runtime messages.

## Implementation Plan

1. Extend `AgentRuntimeDiagnosticEvent` with a concrete `provider.phase` event
   containing only phase/method/status/id/count/code fields.
2. Add provider id/label to `AgentService` lifecycle logs.
3. Update `agentErrorDiagnostic()` to accept an optional provider id and return
   `CODEX_...`, `OPENAI_...`, or `AGENT_...`.
4. Emit Codex phase events before and after `thread/start` and `turn/start`,
   including failed phase events when either call throws.
5. Emit phase events for approval requests, key notifications, timeouts, and
   `turn/completed`.
6. Extract short safe failure codes/categories from failed Codex turns using a
   conservative recursive search over code-like fields only.
7. Throw Codex runtime errors with safe code/category `detail` when available.
8. Update frontend error copy so `provider_unavailable` is provider-neutral and
   `agentErrorMessage()` prefers safe local Codex `userMessage` for this code.
9. Add tests.

## Required Tests

- Codex provider test proves diagnostic events include phase breadcrumbs and a
  failed turn code/detail without payload text.
- Codex provider tests cover `thread/start` and `turn/start` failures.
- Agent utility/i18n test proves provider-unavailable copy is no longer
  OpenAI-specific and specific backend user messages are preferred.
- Terminal diagnostic tests prove Codex failures prefix `CODEX_`, OpenAI
  failures prefix `OPENAI_`, and local setup failures prefix `AGENT_`.
- Existing diagnostics logger tests continue proving unsafe keys are redacted.
- Full `npm test`, `npm run typecheck`, `npm run build`, and
  `npm run smoke:review`.

## Rollout

Ship to `master`. No migration or production data change.
