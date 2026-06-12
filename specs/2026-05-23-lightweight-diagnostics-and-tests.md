# Lightweight Diagnostics And Tests Spec

## Status

Implemented.

## Product Intent

Iliad is still a solo-developed local desktop app. It does not need a
team-scale observability platform, remote telemetry, dashboards, or complex CI
infrastructure yet. It does need two small foundations before the agent grows
further:

- local diagnostics that make production bugs explainable without exposing
  secrets or document contents;
- a real test script for pure logic and provider edge cases, so future specs
  can require targeted automated checks instead of only manual smoke tests.

The goal is to make debugging boring: when the assistant fails, the app should
leave behind enough redacted local evidence to answer "what kind of failure was
this?" and the repo should have a quick test suite that catches known regressions.

## Context

Current state:

- `package.json` has `typecheck`, `build`, and `smoke:review`.
- `scripts/reviewDiffSmoke.mjs` covers review diff helpers, proposal store
  behavior, and some provider response parsing.
- There is no general `npm test` command or test runner.
- Electron logs currently use direct `console.warn`/`console.error` in a few
  places.
- Recent agent debugging depended on screenshots and terminal output. The app
  did not expose a compact diagnostic trace for the failed run.
- Existing agent specs already warn not to store raw provider JSON or secrets.

Relevant files today:

- `electron/agent/agentService.ts`
- `electron/agent/openaiResponses.ts`
- `electron/agent/proposalStore.ts`
- `electron/ipc/agent.ts`
- `electron/main.ts`
- `src/components/AssistantPanel.tsx`
- `scripts/reviewDiffSmoke.mjs`
- `package.json`

## Decision

This is worth defining now, but it should be intentionally small.

Do:

- add a tiny local diagnostic logger for app/agent failures;
- add a first-class `npm test` command with a lightweight test runner;
- keep existing smoke tests during transition;
- require future specs to name the relevant test layer.

Do not:

- add Sentry, Datadog, OpenTelemetry, cloud log upload, traces UI, or analytics;
- build a user-facing log viewer;
- store raw OpenAI payloads, API keys, full prompts, or document contents;
- add full Electron end-to-end automation as a prerequisite for every change.

## Goals

- Give the developer a local log file with run ids, error codes, provider
  status, retry/fallback decisions, model, mode, app version when available, and
  timing.
- Keep logs safe to share manually by default: no API keys, no raw document
  text, no full prompts, no raw provider responses.
- Add `npm test` for fast automated tests.
- Move provider parsing, diff/review logic, path safety, and markdown/media
  parsing toward normal unit tests.
- Keep manual Electron smoke checks for UI behavior until the app needs heavier
  automation.
- Make every future spec state one of:
  - no automated test needed and why;
  - unit test required;
  - smoke test required;
  - manual Electron smoke required;
  - later E2E coverage required.

## Non-Goals

- No remote telemetry.
- No crash reporting service.
- No team dashboards.
- No persistent raw provider event capture.
- No automatic upload of diagnostics.
- No test suite that requires real OpenAI API calls.
- No broad refactor of app architecture.
- No mandatory Playwright/Electron test framework in the first pass.

## Proposed Phases

### Phase 1: Local Diagnostics And Test Runner

Add the smallest useful foundation.

Diagnostics:

- Add `electron/diagnostics/logger.ts`.
- Write JSON-lines logs under Electron `userData`, for example:
  - `userData/logs/iliad-YYYY-MM-DD.jsonl`
- Keep only a small retention window, initially 7 days or 10 MB total.
- Log records use a small fixed schema:

```ts
interface DiagnosticLogRecord {
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  area: "app" | "workspace" | "agent" | "provider" | "review";
  event: string;
  runId?: string;
  requestId?: string;
  model?: string;
  mode?: string;
  durationMs?: number;
  errorCode?: string;
  providerStatus?: number;
  retryable?: boolean;
  details?: Record<string, string | number | boolean | null>;
}
```

Allowed diagnostic details:

- provider event type names;
- response id;
- proposal id;
- file extension or relative path hash;
- counts such as prompt length, document length, hunk count, proposal count;
- retry reason categories such as `unsupported_reasoning_summary`;
- normalized error code.

Forbidden diagnostic details:

- API keys or key prefixes;
- raw prompts;
- raw Markdown document contents;
- raw provider request/response bodies;
- full filesystem paths outside app/workspace labels;
- personally sensitive content copied from documents.

Testing:

- Add a lightweight runner, recommended `vitest`, because the app is TypeScript
  and Vite-based.
- Add `npm test` for fast non-watch tests.
- Keep `npm run smoke:review` during the transition.
- Start with tests migrated or copied from `scripts/reviewDiffSmoke.mjs`:
  - review hunk construction/reconstruction;
  - proposal store accept/reject/stale behavior;
  - provider response sanitizer;
  - OpenAI SSE parser/fallback behavior with mocked `fetch`;
  - path and URL safety helpers where feasible.

Verification after phase 1:

- `npm test`
- `npm run typecheck`
- `npm run build`
- `npm run smoke:review` until the smoke script is retired or fully replaced.

### Phase 2: Agent Run Diagnostics

Instrument only high-value agent lifecycle points.

Log these events:

- `agent.run.started`
- `agent.context.read`
- `provider.request.started`
- `provider.stream.event` with event type only when debug logging is enabled;
- `provider.retry` with sanitized retry category;
- `provider.request.completed`
- `agent.proposal.created`
- `agent.run.failed`
- `agent.run.completed`
- `agent.run.cancelled`

Default level:

- `info` for run start/completion and proposal creation.
- `warn` for fallback/retry.
- `error` for failed runs.
- `debug` only when a local environment flag or settings toggle enables it.

Recommended local controls:

- Environment variable: `ILIAD_LOG_LEVEL=debug`.
- Optional later setting: `Diagnostics: debug logging`.

No UI should be added in this phase except possibly a small "Open logs folder"
button in settings if debugging repeatedly becomes painful.

### Phase 3: Test Policy For Future Specs

Add a short section to new specs:

```md
## Required Tests

- Unit:
- Smoke:
- Manual:
- Not covered and why:
```

Suggested rules:

- Pure helper changes require unit tests.
- Provider parsing/fallback changes require mocked provider tests.
- Review/diff changes require unit tests plus `smoke:review` until migrated.
- Visual UI changes require typecheck/build plus a manual screenshot or browser
  smoke when practical.
- Electron IPC changes require at least contract-level tests or a focused manual
  smoke step until IPC test harness exists.
- Real provider calls are never required in automated tests.

### Phase 4: Optional Electron UI Smoke

Only add this when local manual checks become too slow or regressions repeat.

Candidates:

- Playwright against Vite for renderer-only UI states.
- Later, Playwright Electron or Spectron-like alternatives if app startup and
  IPC behavior need automation.

This is explicitly not required for v1 diagnostics.

## UX

Keep the UI minimal.

Default users should not see logs, traces, or technical labels during normal
writing. Error messages remain human:

- `OpenAI is unavailable right now. Try again shortly.`
- `Could not reach OpenAI. Check your connection and try again.`
- `The selected model was not found. Check the model name in settings.`

Diagnostics are for debugging, not for the main writing surface.

Possible future settings row:

- Label: `Diagnostics`
- Action: `Open logs folder`
- Secondary action only when needed: `Enable debug logs`

Do not add a large in-app diagnostics console.

## Security And Privacy

The logger must be redaction-first.

Rules:

- Logger API should accept structured metadata, not arbitrary large strings.
- Never pass provider request/response bodies directly to the logger.
- Add a small sanitizer helper for unknown errors:
  - keeps `name`, known error `code`, provider `status`, and safe short message;
  - removes keys matching `/key|token|secret|authorization|password/i`;
  - truncates strings to a short limit;
  - refuses nested arbitrary objects unless explicitly allowed.
- Logs stay local.
- Users manually choose whether to share log files.

## Data Model

No app database changes.

Local files:

- `userData/logs/iliad-YYYY-MM-DD.jsonl`

Optional later:

- `userData/logs/README.txt` explaining that logs are local and redacted.

## API And IPC

Phase 1 does not require renderer IPC.

Optional later IPC:

- `diagnostics:open-logs-folder`
- `diagnostics:get-settings`
- `diagnostics:update-settings`

Do not expose raw logs through renderer IPC in v1.

## Rollout

Recommended order:

1. Add logger module and tests for redaction/rotation.
2. Add Vitest and `npm test`.
3. Move provider parser and review diff smoke coverage into tests.
4. Add agent lifecycle logging.
5. Update future spec template or conventions to include required tests.

This can be implemented incrementally. The first useful PR can be small:

- logger module;
- `npm test`;
- a few provider/review tests;
- no UI.

## Required Tests For This Spec

When implemented:

- Unit tests for log redaction:
  - strips API-key-like fields;
  - truncates long strings;
  - does not serialize raw prompt/document fields.
- Unit tests for log rotation path/date behavior.
- Provider tests with mocked `fetch`:
  - HTTP 400 unsupported reasoning summary fallback;
  - streamed `error` fallback;
  - malformed SSE produces normalized provider error;
  - no real network.
- Review diff tests:
  - hunk accept/reject/stale behavior;
  - create-file proposal stays pending until accepted.
- Package scripts:
  - `npm test`
  - `npm run typecheck`
  - `npm run build`
  - `npm run smoke:review` until retired.

## Open Questions

- Should logs include a hashed relative file path, or only the extension and
  document length? Recommendation: start with extension and length only.
- Should debug logging be controlled only by env var, or also a settings toggle?
  Recommendation: env var first.
- Should `smoke:review` be retired once tests exist? Recommendation: keep it
  until all coverage is migrated and then remove it in a separate cleanup.

## Implementation Size Guardrail

This should not become a platform project.

First implementation target:

- 1 small logger module;
- 1 small sanitizer;
- 1 test runner;
- 5-10 focused tests;
- agent/provider logging at the highest-value boundaries only.

Avoid anything that requires accounts, servers, dashboards, background upload,
or a new visible diagnostics product surface.
