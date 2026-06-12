# Codex Agent Runtime Provider Spec

Date: 2026-05-23
Status: reviewed spec, foundational slice implemented

Current direction lives in [`docs/agent-vision.md`](../docs/agent-vision.md)
and [`docs/agent-runtime-roadmap.md`](../docs/agent-runtime-roadmap.md). Later
specs supersede some phase details here, especially user-facing Codex account
connection, model options, workspace tool bridge, and file-change capture.

## Product Intent

Iliad's main agent should move toward a Codex/OpenClaw-style runtime: a
workspace-aware agent that can edit files, coordinate future subagents, stream
runtime work events, and surface all writes through Iliad's document-native
review UI.

This is not a plan to remove OpenAI API usage. The product split is:

- **Agent runtime:** Codex app-server / Codex SDK style runtime becomes the
  preferred future path for the main agent.
- **Media/API features:** OpenAI Platform API key remains the clean path for
  transcription, images, realtime, embeddings, and any feature outside Codex.
- **Fallback agent:** the current OpenAI API-key assistant remains available
  while Codex runtime support is experimental.

## Source Material

Internal docs:

- [Iliad Agent Vision](../docs/agent-vision.md)
- [Iliad Agent Runtime Roadmap](../docs/agent-runtime-roadmap.md)
- [OpenClaw Auth Deep Dive](../docs/research/chatgpt-login/openclaw-auth-deep-dive.md)
- [ChatGPT Login Research Summary](../docs/research/chatgpt-login/summary-and-recommendation.md)
- [Agent Context Management](./2026-05-23-agent-context-management.md)
- [Assistant Experience Review](./2026-05-23-assistant-experience-review.md)
- [Core Agent Proposal Architecture](./2026-05-23-core-agent-proposal-architecture.md)

Current implementation:

- [AgentService](../electron/agent/agentService.ts)
- [OpenAI provider client](../electron/agent/openai/client.ts)
- [OpenAI request construction](../electron/agent/openai/request.ts)
- [Agent settings store](../electron/agent/settingsStore.ts)
- [Transcription provider](../electron/agent/transcription.ts)
- [Proposal store](../electron/agent/proposalStore.ts)
- [Agent types](../electron/agent/types.ts)
- [Assistant settings UI](../src/components/assistant/AssistantSettings.tsx)

Official OpenAI/Codex references checked on 2026-05-23:

- Codex authentication supports ChatGPT sign-in for subscription access and API
  key sign-in for usage-based access in supported Codex clients:
  https://developers.openai.com/codex/auth
- Codex app-server is the interface for deep product integrations and includes
  authentication, conversation history, approvals, and streamed agent events:
  https://developers.openai.com/codex/app-server
- Codex app-server auth/account methods include `account/read`,
  `account/login/start`, `account/logout`, `account/rateLimits/read`, managed
  `chatgpt`, managed `chatgptDeviceCode`, and experimental external
  `chatgptAuthTokens`: https://developers.openai.com/codex/app-server
- Codex CLI can be installed as `@openai/codex`:
  https://developers.openai.com/codex/cli

## Current State

The live assistant is an OpenAI Platform API-key provider:

- `AgentService.startRun()` reads settings, fetches the API key, calls
  `createOpenAiResponse()`, parses provider text into draft proposal records,
  and saves proposals.
- `createOpenAiResponse()` talks to `https://api.openai.com/v1/responses`.
- Dictation talks to `https://api.openai.com/v1/audio/transcriptions`.
- `AgentSettingsStore` persists `openAiApiKey`, `model`, and `mode` in local
  Electron `userData` JSON, with `OPENAI_API_KEY` as environment fallback.
- The renderer receives only key presence, model, and mode.
- Iliad already has a proposal store and document-native review UI. This is the
  right write boundary for Codex file changes.

## Problem

The current provider is useful, but it is not the architecture for the desired
agent:

1. It is a single request/response path, not a full agent runtime.
2. It is active-file scoped today, while the target is workspace-scoped.
3. It cannot use Codex-managed ChatGPT auth.
4. It has no provider abstraction for multiple agent runtimes.
5. It does not model provider capabilities, so the UI cannot distinguish
   assistant, dictation, rate-limit, or future subagent support.
6. It would be risky to add ChatGPT/Codex credentials to the current JSON
   settings store.

## Goals

- Add a provider/runtime boundary without breaking the current OpenAI API-key
  assistant.
- Make OpenAI API-key assistant behavior an explicit provider implementation.
- Add provider capability metadata for agent, proposal, thinking, auth,
  rate-limit, and media boundaries.
- Add an experimental Codex app-server probe that can be used by developers to
  inspect Codex availability and account state without storing tokens in Iliad.
- Preserve review-first writes through `AgentChangeProposal`.
- Keep public settings minimal and honest.
- Document hard gates before Codex account login becomes a user-facing feature.

## Non-Goals For This Slice

- No production `Sign in with ChatGPT` button.
- No provider picker in the UI.
- No ChatGPT/Codex token storage in Iliad.
- No copying OpenClaw OAuth/device-code implementation or client IDs.
- No direct calls to `chatgpt.com/backend-api/codex`.
- No switching the live assistant to Codex yet.
- No dictation through Codex account auth.
- No real subagent orchestration.
- No terminal/browser/MCP execution from Iliad.
- No direct Codex writes to user Markdown files.
- No non-Markdown durable artifact builders. The main agent creates and edits
  Markdown documents.

## Architecture Decision

Introduce an internal `AgentRuntimeProvider` seam.

The initial live provider remains `openai-api`. A future `codex-app-server`
provider is introduced as an experimental runtime probe and later promoted only
after it can:

- authenticate through official managed Codex login paths;
- run against an isolated workspace;
- expose streamed agent events;
- expose file-change events or diffs;
- convert those changes into Iliad proposals;
- avoid direct writes to user files;
- provide clear account/rate-limit state;
- handle logout and credential lifecycle safely.

## Provider Model

```ts
type AgentRuntimeProviderId = "openai-api" | "codex-app-server";

interface AgentRuntimeCapabilities {
  text: boolean;
  thinkingSummaries: boolean;
  reviewableProposals: boolean;
  workspaceEvents: boolean;
  managedAccountAuth: boolean;
  rateLimits: boolean;
  media: {
    transcription: boolean;
    images: boolean;
    realtime: boolean;
  };
}

interface AgentRuntimeProvider {
  id: AgentRuntimeProviderId;
  label: string;
  capabilities: AgentRuntimeCapabilities;
  startRun(request, context): Promise<AgentProviderResponse>;
}
```

Capability intent:

- `openai-api` supports text, thinking summaries, reviewable proposals through
  the current marker adapter, and transcription through the separate media
  provider.
- `codex-app-server` initially supports only probe/status. It does not support
  live user assistant turns until a later implementation phase.

## Experimental Codex Probe

Add a developer-facing main-process probe, not a visible product feature.

Probe requirements:

- Locate the `codex` CLI on `PATH`.
- Return installed version when available.
- Generate or inspect app-server schema support when possible.
- Optionally start `codex app-server` in a temporary process and send
  `initialize` plus `account/read`.
- Never start login unless explicitly requested by a future developer-only IPC.
- Never store ChatGPT/Codex tokens in Iliad.
- Never read, copy, or persist `~/.codex/auth.json`.
- Never write to the user workspace.
- Log probe results with redacted diagnostics only.

The first implementation may stop at CLI/version/schema availability and a
typed probe response. A later spike can add temporary-process JSON-RPC
communication and account reads.

## Authentication And Storage

Hard gates before user-facing Codex account auth:

- OS keychain storage for any Iliad-owned credential material.
- Main-process-owned login flow; renderer receives only metadata.
- Trusted-sender validation for all credential-affecting IPC.
- Logout flow.
- Refresh failure recovery.
- Account switching behavior.
- Identity checks so one account cannot silently overwrite another.
- Redacted diagnostics.
- Clear rate-limit and billing copy.

Allowed now:

- Continue storing OpenAI API keys as the accepted local v1 risk.
- Keep `OPENAI_API_KEY` environment fallback.
- Use Codex CLI managed state only in a non-production probe where Codex owns its
  own state and Iliad does not copy tokens.

## UX Requirements

Historical slice note: this section described the first provider-seam slice
before user-facing Codex connection shipped. Current settings copy and model
choices are governed by the account-connection and model-options specs.

For this slice, do not add visible Codex UI.

Settings remains an OpenAI API-key setup surface:

```text
Connection
OpenAI API key
[ password input ]
Saved locally on this computer.
Requires an OpenAI API key. ChatGPT plans do not include API usage.
[ Get an API key ]

OpenAI model
[ API model id ]
```

Avoid:

- `Login with ChatGPT`
- `Use my ChatGPT subscription`
- `Sign in with OpenAI`
- disabled `Codex` options
- generic provider language that makes current OpenAI failures less actionable

Future Codex UI, after it works:

```text
Use OpenAI API key
Use Codex agent

Uses Codex authentication and capabilities. Not used for general OpenAI API
calls.
```

## Runtime Events

The current event model may remain for OpenAI:

- `status`
- `thinking_delta`
- `thinking_done`

Future Codex events should normalize into Iliad runtime facts:

- runtime started
- account state updated
- rate limits updated
- thread started
- turn started
- thinking/progress summary
- file-change diff observed
- proposal created
- waiting for review
- failed
- canceled

Do not expose provider-specific raw event shapes to React.

## Proposal Mapping

All provider file changes must become `AgentChangeProposal` records before user
approval.

Mapping requirements for later Codex phases:

- Add/update/delete diffs become file-level proposals.
- New docs show as all-green pending documents.
- Existing docs show document-native red/green review.
- Accept/reject remains owned by Iliad.
- If Codex mutates a temporary workspace, Iliad compares base and result and
  creates proposals for the real workspace.
- If Codex requests direct writes to the real workspace, Iliad declines or
  redirects the change into a proposal unless the user has explicitly accepted
  the change through Iliad.

## Implementation Phases

### Phase 0 - This Spec

- Add the roadmap doc.
- Add this spec.
- Add internal provider types and OpenAI provider adapter.
- Keep `AgentService.startRun()` behavior unchanged through the adapter.
- Add provider capability metadata to settings snapshots.
- Add an experimental Codex probe module and IPC method for developer inspection.
- Improve OpenAI API-key settings copy without adding a provider picker.
- Add focused tests for provider selection/capabilities/probe behavior.

### Phase 1 - Codex App-Server Spike

- Spawn `codex app-server` in an isolated temp `CODEX_HOME`.
- Send `initialize`.
- Send `account/read`.
- Read rate limits if authenticated.
- Start a disposable thread in a temp workspace.
- Capture event names and diff/file-change event shapes.
- Save findings to research docs.

### Phase 2 - Codex Proposal Bridge

- Run Codex against an isolated copy of the active workspace or temp workspace.
- Convert diffs into `AgentChangeProposal`.
- Do not write to user files directly.
- Render proposals through the existing document review UI.

### Phase 3 - User-Facing Codex Agent

- Add OS keychain credential storage.
- Add managed Codex login/logout/account status.
- Add provider choice only after the runtime can complete useful edits.
- Make Codex the default agent provider for users who connect it.
- Keep OpenAI API-key provider as fallback and for media features.

### Phase 4 - Context Ledger And Subagents

- Implement the revised context-management spec.
- Add evented runs and visible worker status.
- Add read-only subagents first.
- Add write-capable subagents only through the proposal review layer.

## Tests

Required for Phase 0:

- OpenAI provider adapter still calls the existing Responses provider.
- Missing API key behavior remains unchanged.
- Settings snapshot includes provider/capability metadata without exposing
  secrets.
- Codex probe returns `missing_cli` when the CLI is not available.
- Codex probe returns CLI version when a fake CLI is supplied.
- Settings copy renders without a provider picker.
- Typecheck and existing agent tests pass.

Required for future phases:

- App-server JSON-RPC initialize/account-read contract tests with a fake server.
- Auth state redaction tests.
- Proposal mapping tests from Codex diffs.
- Stale-file protection tests.
- End-to-end smoke test: ask Codex to edit a temp Markdown file, see pending
  red/green proposal, accept/reject without direct writes.

## Review Feedback Incorporated

Runtime review:

- Accepted: first slice should be provider boundary plus hidden probe, not a
  user-facing login.
- Accepted: Codex changes must map into `AgentChangeProposal`.
- Accepted: defer subagents, terminal, browser, and broad workspace access.

Security review:

- Accepted: no ChatGPT/Codex token storage in JSON settings.
- Accepted: credential-affecting IPC must be tightened before account auth.
- Accepted: keep Codex auth separate from OpenAI API-key features.

UX review:

- Accepted: do not show disabled Codex options yet.
- Accepted: keep settings as a clean OpenAI API-key surface.
- Accepted: make billing/storage copy explicit but minimal.

## Open Questions

- Should the future Codex provider use app-server stdio, Unix socket, or SDK
  first?
- Can Codex app-server reliably run against a temp copy of a Markdown workspace
  without code-oriented assumptions hurting document editing?
- Which Codex event should be treated as the canonical source for file diffs:
  turn-level diff, file-change patch events, or final workspace comparison?
- Should Iliad eventually support importing existing Codex CLI auth as a
  developer-only path, or avoid it entirely?
