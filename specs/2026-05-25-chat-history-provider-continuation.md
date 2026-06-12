# Chat History Provider Continuation

Date: 2026-05-25
Status: agent-reviewed draft

## Problem

Iliad now has local assistant transcript state, context manifests, reviewable
proposals, an OpenAI API runtime, and a Codex app-server runtime. Both runtimes
currently receive chat history the same way: the renderer extracts visible
`user` and `assistant` transcript entries, the backend keeps the last 8 turns,
and the provider prompt includes them as a plain `Recent thread` section.

This is a good early implementation because it is simple, inspectable, and
provider-neutral. It is not the full target architecture for long-running agent
work.

The next question is whether Iliad should also use provider-native conversation
state:

- OpenAI API path: `previous_response_id` or Conversations with Responses API.
- Codex account path: app-server thread reuse, rather than starting a fresh
  ephemeral thread for every run.

Provider-native state can improve continuity, but it can also create hidden
state, retention concerns, duplicated context, and provider lock-in. This spec
defines how to add it without making it the source of truth.

## Source Material

Current implementation:

- [`src/assistant/useAssistantRun.ts`](../src/assistant/useAssistantRun.ts)
  builds local `chatMessages` from visible transcript entries and sends them
  with each run.
- [`electron/agent/openai/prompts.ts`](../electron/agent/openai/prompts.ts)
  injects the last 8 messages as `Recent thread` for the API runtime.
- [`electron/agent/runtime/codexAppServerProvider.ts`](../electron/agent/runtime/codexAppServerProvider.ts)
  starts a new `ephemeral: true` Codex thread per run and also injects the last
  8 messages as `Recent thread`.
- [`electron/agent/openai/request.ts`](../electron/agent/openai/request.ts)
  calls `/v1/responses` without `previous_response_id` or `conversation`.
- [`specs/2026-05-23-agent-context-management.md`](./2026-05-23-agent-context-management.md)
- [`specs/2026-05-24-agent-context-ledger-phase-1.md`](./2026-05-24-agent-context-ledger-phase-1.md)
- [`specs/2026-05-24-agent-context-ledger-phase-2.md`](./2026-05-24-agent-context-ledger-phase-2.md)
- [`specs/2026-05-24-evented-agent-runs.md`](./2026-05-24-evented-agent-runs.md)

External references:

- OpenAI conversation state docs: Responses can manage state with Conversations
  or `previous_response_id`, while manual history remains valid. The docs also
  note that previous input tokens in a response chain are still billed as input
  tokens. https://platform.openai.com/docs/guides/conversation-state
- OpenAI Responses API reference: `previous_response_id` creates multi-turn
  conversations, cannot be used with `conversation`, and previous instructions
  are not automatically carried over. https://platform.openai.com/docs/api-reference/responses/create
- OpenAI prompt caching docs: prompt caching is automatic for eligible repeated
  prefixes, but it does not remove the need to manage context size.
  https://developers.openai.com/api/docs/guides/prompt-caching
- OpenAI Codex app-server docs: app-server exposes Codex account, thread, turn,
  item, and history primitives for rich clients.
  https://developers.openai.com/codex/app-server

## Decision

Iliad-owned chat history remains canonical.

Provider-native continuation may be added later as an adapter-owned optimization
layer. It must never replace local transcript, proposal, manifest, and run
records as the user's durable history.

The product behavior should be:

```text
Iliad chat
  owns: user-visible transcript, proposals, run manifests, reset/delete UX
  stores: optional provider continuation handles per chat and provider

OpenAI API adapter
  may use: conversation id or previous response id
  must respect: local chat reset, provider/model changes, context invalidation

Codex adapter
  may use: one Codex thread id per Iliad chat
  must respect: local chat reset, provider/model changes, context invalidation
```

## Goals

- Preserve a provider-neutral local chat history model.
- Add a clean extension point for provider continuation state.
- Keep provider continuation state owned by the Electron main process and
  agent service, not by renderer-managed transcript state.
- Avoid duplicating visible chat history into prompts when provider-native
  continuation is active.
- Improve follow-up quality for references such as "do the same thing again",
  "revise your last proposal", and "continue from that outline".
- Preserve context manifest accuracy for every run.
- Ensure "New chat" severs provider continuation state.
- Make provider-side retention and reset behavior explicit.
- Keep provider state invalidation conservative when workspace files change.
- Treat provider handles as sensitive capability-like identifiers.
- Advance provider continuation only when local chat/run persistence succeeds.
- Avoid building a cross-provider abstraction that hides important API
  differences.

## Non-Goals

- No implementation in this spec pass.
- No replacement of Iliad local history with OpenAI Conversations or Codex
  threads.
- No hidden long-term memory.
- No cross-chat memory.
- No automatic upload of the full workspace.
- No assumption that provider-native continuation reduces billing.
- No visible provider diagnostics panel.
- No support for switching an active provider-native thread from OpenAI API to
  Codex or the reverse.
- No use of provider state for dictation; dictation remains API-key-only unless
  separately specified.
- No guarantee that "New chat" deletes remote provider-side state. It only
  guarantees Iliad will not reuse that state. Provider deletion must be handled
  by an explicit clear/delete flow where the provider supports it.

## Current Behavior

### Renderer

The renderer builds `chatMessages` from visible transcript entries:

```ts
entries
  .filter((entry) => entry.kind === "user" || entry.kind === "assistant")
  .map((entry) => ({ role: entry.kind, content: entry.text }))
```

Only user-visible assistant text is preserved. Status rows, error rows,
thinking summaries, proposal metadata, file-change protocol events, and context
manifest data are not part of `chatMessages`.

### OpenAI API Runtime

The OpenAI API runtime sends one stateless Responses request per run:

- `instructions`
- `input` containing active file context, explicit documents, last 8 visible
  transcript messages, and current prompt
- `max_output_tokens`
- streaming/reasoning/text options when supported

It does not pass `previous_response_id`, `conversation`, provider item
references, or encrypted reasoning continuity.

### Codex Runtime

The Codex runtime starts a fresh app-server thread for each run:

- `thread/start` with `ephemeral: true`
- `turn/start` with active file context, explicit documents, last 8 visible
  transcript messages, and current prompt

The provider emits richer file-change and reasoning summary events, but those
events are normalized into Iliad proposals/status and are not retained as a
provider thread for the next run.

## Why Add Provider Continuation Later

Provider-native continuation solves product and engineering problems that local
plain-text replay does not fully solve.

### More Complete Continuity

Visible assistant text is a lossy representation of a run. It can omit:

- structured response items;
- tool calls and tool results;
- Codex file-change items;
- reasoning continuity handles;
- proposal lifecycle metadata;
- model-side references to prior outputs.

Provider continuation can preserve some of this state without forcing Iliad to
serialize it all into natural language.

### Better Follow-Ups

Follow-up prompts often refer to previous work indirectly:

- `make the same change in the second section`
- `revise that proposal to be shorter`
- `continue from your last outline`
- `undo the last direction and try the alternative`

Local replay helps only if the relevant detail was in visible chat text.
Provider-native state can carry the prior response structure more faithfully.

### Less Prompt Plumbing

Once provider continuation is active, Iliad should not need to paste the same
recent transcript into the prompt for that provider path. The adapter can send
only the new user turn plus fresh workspace context and let the provider thread
provide prior conversational state.

### Durability Across App Restarts

If provider handles are persisted per Iliad chat, a conversation can resume
more naturally after an app restart while still rendering from local Iliad
history.

## What It Does Not Solve

Provider-native continuation is not a token-cost cure.

- Previous context can still count toward input tokens.
- Context windows still need compaction and pruning.
- Repeated active Markdown snapshots can still dominate token use.
- Provider state does not remove the need for local context manifests.
- Prompt caching remains automatic and prefix-sensitive; provider continuation
  is a different mechanism from prompt caching.

The larger token optimization remains context selection:

- include less unchanged document text;
- summarize old chat turns;
- include narrow file excerpts when sufficient;
- avoid resending duplicate transcript;
- record what was included in manifests.

## Risks And Downsides

### State Divergence

The local transcript can disagree with provider state if:

- a provider turn succeeds but local persistence fails;
- local chat rows are deleted or edited later;
- provider state is compacted differently from local history;
- the user switches provider, model, workspace, or account.

Mitigation: local history is canonical. Provider continuation is a cache-like
handle that can be dropped and rebuilt from local state.

Continuation advancement must be atomic from Iliad's perspective. The app may
store a new continuation handle only after the local transcript entry, response
text, run manifest, proposal ids, and provider result for that turn are durably
saved. Failed local persistence must leave the next run on manual replay or on
the previous valid continuation handle, never on unexplained provider state.

Renderer code must not create, edit, or persist provider continuation handles.
The renderer may request a run and render local chat state; `AgentService` owns
continuation reads, writes, invalidation, and redaction.

### Hidden Context

Provider-native state can make the exact model context less visible in one
request body.

Mitigation: manifests must record the provider continuation handle and whether
local recent history was replayed or provider-native continuation was used.
They must record only hashed or opaque local handle identifiers, never raw
provider handles.

### Retention And Privacy

Provider-side Conversations or Codex threads may store workspace/chat data
remotely according to provider policy.

Mitigation: expose clear reset/delete behavior, keep provider continuation
optional until the privacy UX is explicit, and do not use provider-native state
for private/offline modes.

`New chat` means "do not use prior provider state for future runs." It is not a
remote deletion guarantee. A separate `Clear provider history` action may
attempt provider-side deletion where supported. If deletion is unsupported or
fails, the UI must say that local linkage was removed and provider-side
retention follows the provider's policy.

Provider continuation cannot be enabled by default until settings disclose:

- provider-side retention;
- local sensitive handle storage;
- reset versus delete semantics;
- private/offline-mode behavior;
- what happens when provider deletion is unavailable.

### Sensitive Provider Handles

Provider handles such as response ids, conversation ids, and Codex thread ids
are not user secrets like API keys, but they are sensitive capability-like
identifiers. They can bind a local chat to remote provider state.

Mitigation:

- Store raw provider handles only in a main-process continuation store.
- Do not store raw handles in general chat records, manifests, renderer state,
  logs, crash reports, diagnostics exports, or chat export/import payloads.
- Use salted hashes or short opaque local ids in manifests and diagnostics.
- Bind stored handles to provider id, account fingerprint, workspace, chat id,
  model, and context policy version.
- Record `createdAt`, `lastUsedAt`, and `expiresAt` when known.
- If local chat records are plain JSON files, ship provider continuation behind
  a default-off flag until the handle store has encryption-at-rest or an
  equivalent platform-protected storage plan.

### Stale Workspace State

The provider may remember an older active file snapshot after the user edits
the file.

Mitigation: every run still sends current file/context evidence when needed,
and continuation invalidates or annotates stale file memory when base hashes
change.

Initial implementation should hard-invalidate provider continuation when the
active file base hash changes relative to the last continuation-backed run, or
when a proposal from the chat is applied/rejected. Soft stale-context handling
can be revisited only after tests show that provider memory cannot override
fresh workspace evidence.

When stale context is detected but the adapter deliberately continues, the
adapter must send an explicit instruction that prior workspace/file context may
be stale and current supplied evidence supersedes it. The manifest must record
the stale condition and old/new base hashes when available.

### Prompt Duplication

If Iliad uses provider continuation and still injects `Recent thread`, the
model can receive duplicate or conflicting prior turns.

Mitigation: each provider adapter must choose one history source per run:
manual replay or provider continuation, not both.

### Provider Lock-In

OpenAI API Conversations, OpenAI `previous_response_id`, and Codex app-server
threads are not interchangeable.

Mitigation: store provider continuation state as provider-specific metadata
behind a common local chat record. Do not invent a lowest-common-denominator
thread abstraction that hides semantics.

### Local Edits And Deletions

If a future UI allows editing or deleting local transcript entries, provider
continuation must be hard-invalidated for that chat. Manual replay after an
invalid handle must use only current local, non-deleted transcript entries and
must not resurrect deleted or redacted content from provider state.

## Data Model

Add a durable local chat record in a later implementation phase. Shape is
illustrative:

```ts
export interface AgentChatRecord {
  id: string;
  workspaceRoot: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  entries: AgentChatEntry[];
  providerContinuationRefs: AgentProviderContinuationRef[];
}

export interface AgentProviderContinuationRef {
  id: string;
  providerId: "openai-api" | "codex-app-server";
  mode: "none" | "previous_response_id" | "conversation" | "thread";
  model: string;
  handleHash?: string;
}

export type AgentContinuationInvalidationReason =
  | "new_chat"
  | "provider_changed"
  | "model_changed"
  | "account_changed"
  | "workspace_changed"
  | "context_policy_changed"
  | "file_base_hash_changed"
  | "proposal_status_changed"
  | "transcript_changed"
  | "git_branch_changed"
  | "provider_error"
  | "privacy_reset";
```

Raw handles live only in a separate main-process-owned continuation store.
Shape is illustrative:

```ts
export type ProviderContinuationHandleKind =
  | "response_id"
  | "conversation_id"
  | "thread_id";

export interface AgentProviderContinuationHandleRecord {
  id: string;
  chatId: string;
  providerId: "openai-api" | "codex-app-server";
  accountFingerprint: string;
  workspaceRootHash: string;
  model: string;
  contextPolicyVersion: string;
  kind: ProviderContinuationHandleKind;
  encryptedHandle: string;
  handleHash: string;
  createdAt: string;
  lastUsedAt?: string;
  expiresAt?: string;
  invalidatedAt?: string;
  invalidationReason?: AgentContinuationInvalidationReason;
}
```

Provider continuation metadata must not store prompts, raw provider payloads,
API keys, access tokens, hidden reasoning text, or raw provider handles in
general chat storage.

## Context Manifest Changes

Extend run manifests with continuation metadata only. Do not store provider
secrets or raw state.

Illustrative shape:

```ts
export interface AgentRunContextManifest {
  providerState?: {
    strategy: "manual_replay" | "openai_previous_response" | "openai_conversation" | "codex_thread";
    replayedLocalMessageCount: number;
    localEntryRange?: { firstEntryId: string; lastEntryId: string };
    localRunRange?: { firstRunId: string; lastRunId: string };
    contextPolicyVersion: string;
    providerHandleKind?: "response_id" | "conversation_id" | "thread_id";
    previousProviderHandleHash?: string;
    nextProviderHandleHash?: string;
    invalidatedPreviousHandle?: boolean;
    invalidationReason?: AgentContinuationInvalidationReason;
    sentFreshWorkspaceContext: boolean;
    staleWorkspaceContext?: {
      reason: "file_base_hash_changed" | "proposal_status_changed" | "git_branch_changed";
      relativePath?: string;
      previousBaseHash?: string;
      currentBaseHash?: string;
    };
  };
}
```

Display policy:

- collapsed context disclosure may say `History: local replay` or
  `History: provider continuation` only if needed for debugging clarity;
- expanded detail may show provider strategy and model;
- never show raw provider IDs in primary UI. If useful for diagnostics, show a
  short hash.

## Runtime Policy

### Provider Selection

Provider continuation is scoped to:

- workspace;
- local chat id;
- provider id;
- account fingerprint;
- model;
- context policy version.

If any of those change, invalidate the continuation handle and fall back to
manual replay.

Account fingerprint must be stable enough to prevent cross-account reuse and
safe enough to store. For Codex ChatGPT accounts, hash the account email or
provider account id when available. For API-key accounts, use a non-secret
fingerprint if the platform can provide one; otherwise disable provider
continuation for API-key mode until a safe fingerprint exists.

### Main-Process Ownership And Atomicity

Continuation state is owned by `AgentService` and the Electron main process.
The renderer must never send raw provider handles, mutate continuation records,
or overwrite continuation metadata through chat persistence.

Rules:

- Read continuation state immediately before provider request assembly.
- Persist a new continuation handle only after the assistant entry, context
  manifest update, proposal ids, and provider response metadata are durably
  written.
- Never store handles from `response.created`, partial streams, canceled runs,
  incomplete runs, failed runs, or ambiguous network failures.
- If local persistence fails after a provider turn completed, invalidate the
  new provider handle and use manual replay on the next run.
- Retry with manual replay only for classified invalid-handle failures before
  the provider has accepted a new turn. Do not blindly replay after a failure
  that may have advanced provider state.

### Manual Replay Fallback

Manual replay remains mandatory.

Use it when:

- no continuation handle exists;
- provider continuation is disabled;
- the provider returns an invalid-handle error;
- the user switches providers;
- privacy/reset invalidates provider state;
- app-server thread resume fails;
- continuation state cannot be loaded from protected storage;
- account fingerprint is unavailable;
- tests need deterministic full prompt assembly.

### OpenAI API Adapter

The first OpenAI continuation implementation should prefer
`previous_response_id` over Conversations unless product needs durable
provider-side conversations across devices. It is simpler and fits the existing
response-id lifecycle.

Rules:

- Store the last successful `response.id` in the local chat provider
  continuation.
- On the next run, pass `previous_response_id` and only the new user turn plus
  fresh workspace context.
- Continue sending current `instructions`, because prior instructions are not
  carried over by `previous_response_id`.
- Do not also include `Recent thread` when `previous_response_id` is used.
- If the provider rejects the handle, retry once with manual replay and mark the
  handle invalidated.
- Capture response usage and `cached_tokens` when available for diagnostics,
  but do not depend on it for correctness.
- Enforce TTL, max-turn, and max-estimated-chain limits before broad
  enablement. If limits are exceeded, hard-invalidate continuation and replay a
  compacted local summary or bounded local history.

Open question: if the active Markdown snapshot is sent each turn as fresh
workspace context, should it be sent as user input text, an item reference, or
future file/search tool output? The first implementation should keep the
current text input path unless a separate tool-contract spec changes it.

### Codex App-Server Adapter

The first Codex continuation implementation should support a long-lived Codex
thread per Iliad chat only if the app-server API can resume and manage that
thread reliably in our target Codex version. If not, keep the current fresh
ephemeral thread behavior.

Rules:

- Create a Codex thread when the Iliad chat starts its first Codex-backed run.
- Store the thread handle in local chat continuation metadata.
- On later runs in the same chat, resume/reuse that thread and send only the
  new user turn plus fresh workspace context.
- Do not inject `Recent thread` when reusing a Codex thread.
- If resume fails, create a new thread and fall back to manual replay.
- If the user starts a new chat, disconnect the local chat from the previous
  thread.
- If the workspace path changes, do not reuse the thread.
- Do not ship broad Codex thread reuse until app-server resume, delete/expiry,
  and retention semantics are verified against the target Codex CLI/app-server
  version.

Open question: whether the thread should remain `ephemeral: true` and only be
valid in-process, or use durable Codex history. This must be decided from the
current app-server behavior before implementation.

## Invalidation Policy

Invalidate provider continuation conservatively.

Hard invalidation:

- New chat.
- Provider changes between API and Codex.
- OpenAI/Codex account changes.
- Workspace root changes.
- Model changes.
- User clears history.
- Provider reports invalid or inaccessible continuation handle.
- Active file base hash changes since the last continuation-backed run.
- A proposal from the chat is applied or rejected.
- Local transcript entries are edited or deleted.
- Git branch changes, when the app can detect them.
- Context policy version changes.

Soft invalidation:

- Workspace changes outside the active file that the app can detect but cannot
  attribute to a concrete context item.
- Provider compaction or TTL nearing expiry, if the provider reports it.

For soft invalidation, the adapter may keep the provider handle but must send
fresh workspace evidence and record the condition in the manifest. If stale
behavior appears in testing, upgrade soft invalidation to hard invalidation.

## UX Requirements

- `New chat` clears local transcript and stops using the old provider
  continuation handle.
- `New chat` does not promise remote provider deletion.
- Settings must expose a clear "Clear provider history" action before
  provider-native state ships broadly.
- `Clear provider history` removes local continuation linkage and attempts
  provider-side deletion where supported. If provider deletion is unsupported
  or fails, the UI must state that local linkage was cleared and provider-side
  retention follows provider policy.
- The context disclosure for a response should remain minimal and collapsed.
- The app should never claim that provider continuation reduces cost.
- Error messages should not expose raw provider IDs, thread IDs, or response
  IDs.
- If provider continuation fails and manual replay succeeds, the user should
  not see a scary error. Log diagnostics and continue.
- If provider continuation fails and manual replay also fails, show the existing
  provider-neutral agent error.

## Implementation Phases

### Phase 0: No Behavior Change

- Add this spec.
- Confirm local chat history is canonical.
- Keep manual replay in both providers.

### Phase 1: Local Chat/Run Storage Ownership

- Persist or harden Iliad chat records independently of provider state.
- Persist transcript entries, run ids, proposal ids, and context manifest ids.
- Add local chat id to each run request.
- Move continuation metadata ownership into `AgentService` and main-process
  storage boundaries before any provider-native continuation is enabled.
- Define atomic update behavior for transcript, manifest, proposal, and
  continuation advancement.
- Add redaction and export/import boundaries for provider continuation handles.
- Ensure new chat, delete chat, provider switch, and app restart semantics are
  explicit.

No provider-native continuation ships in this phase.

### Phase 2: OpenAI API `previous_response_id`

- Store last successful response id per local chat and OpenAI API provider.
- Use `previous_response_id` on follow-up runs when valid.
- Remove `Recent thread` manual replay for those runs.
- Add fallback-to-manual-replay on invalid handle.
- Add manifest provider-state metadata.
- Keep behind a provider-specific feature flag with a local kill switch that
  forces manual replay without losing local chat history.
- Add tests for no-duplication, fallback, and reset behavior.

### Phase 3: Codex Thread Reuse Spike

- Verify app-server thread persistence/resume behavior against the target Codex
  CLI/app-server version.
- If reliable, store one Codex thread handle per Iliad chat.
- Reuse/resume it for follow-up Codex runs.
- Remove `Recent thread` manual replay for reused-thread runs.
- Add fallback to fresh thread plus manual replay.
- Add tests using the Codex app-server harness.
- Keep behind a separate provider-specific feature flag.

### Phase 4: Context Compaction

- Add local chat summarization or run summaries for old turns.
- Decide when a provider continuation handle should be compacted, discarded, or
  replaced with a local summary.
- Record compaction events in the manifest.
- Define TTL, max-turn, and max-estimated-chain-size limits before broad
  provider-continuation enablement.

## Rollout And Observability

- Provider continuation ships default-off until Phase 1 storage ownership,
  privacy copy, redaction tests, and reset/delete behavior are complete.
- Enable per provider through separate feature flags:
  - `openai_previous_response_continuation`;
  - `codex_thread_continuation`.
- Include a local kill switch that forces manual replay without deleting local
  chat history.
- Log only redacted diagnostics:
  - continuation strategy used;
  - fallback reason;
  - invalidation reason;
  - provider deletion attempted/succeeded/failed;
  - estimated replayed message count;
  - hashed handle prefix where needed.
- Do not log raw provider handles, prompts, active file contents, or hidden
  reasoning state.

## Tests

Add tests before enabling provider-native continuation:

- Renderer local chat history:
  - entries persist and reload;
  - status/error rows do not become provider history;
  - new chat severs continuation metadata.
  - local transcript edit/delete hard-invalidates provider continuation.
- OpenAI request body:
  - first run uses manual replay;
  - second run with valid `previous_response_id` does not include
    `Recent thread`;
  - invalid handle retries once with manual replay;
  - current instructions are still sent when using `previous_response_id`.
  - handles from partial, canceled, failed, incomplete, or ambiguous network
    runs are not stored.
- Codex adapter:
  - first run starts a thread;
  - follow-up run reuses/resumes the stored thread when enabled;
  - reused-thread runs do not include `Recent thread`;
  - resume failure falls back to fresh thread plus manual replay.
- Context manifest:
  - records history strategy;
  - records replayed local message count;
  - stores only hashed provider handles;
  - records previous and next handle hashes;
  - records local entry/run bounds;
  - records context policy version;
  - records whether fresh workspace context was sent;
  - records invalidation reason.
- Provider switching:
  - OpenAI continuation is not used for Codex runs;
  - Codex continuation is not used for OpenAI runs.
- Stale workspace handling:
  - active file hash changes hard-invalidate continuation;
  - proposal apply/reject hard-invalidates continuation;
  - git branch changes hard-invalidate when detected.
- Privacy/reset:
  - clearing chat/provider history removes continuation metadata.
  - provider deletion failure leaves local linkage cleared and reports
    limitations.
  - raw handles are redacted from logs, errors, diagnostics, and exports.
  - private/offline mode disables provider continuation.
- Rollout:
  - feature flags default off;
  - kill switch forces manual replay;
  - chats without continuation metadata migrate cleanly.

Run:

- `npm run typecheck`
- `npm test`
- `npm run smoke:review`
- `npm run build`

## Acceptance Criteria

- Local Iliad chat history remains usable without any provider continuation.
- Provider-native continuation can be disabled without changing visible chat
  behavior.
- Provider-native continuation cannot be enabled by default until privacy copy,
  reset/delete semantics, redaction tests, and feature-flag rollback are
  implemented.
- A successful provider-continuation run does not duplicate local transcript
  history in the provider prompt.
- "New chat" guarantees the next run starts without previous provider state.
- Context disclosures and manifests identify whether a run used manual replay
  or provider continuation.
- Invalid provider continuation handles degrade to manual replay without data
  loss.
- Raw provider handles are persisted only in a protected main-process
  continuation store, never in renderer state, manifests, logs, diagnostics, or
  general chat exports.
- Continuation handles advance only after local transcript, run manifest,
  proposals, and provider response metadata are durably saved.
- Failed, canceled, incomplete, partial, or ambiguous runs never advance
  continuation state.
- Active file hash changes and proposal apply/reject hard-invalidate
  continuation in the initial implementation.

## Open Questions For Review

- Should Phase 2 use `previous_response_id` first, or should we go directly to
  OpenAI Conversations once durable local chats exist?
- Should Codex thread reuse be enabled only for ChatGPT subscription accounts,
  or also for Codex app-server API-key accounts if they appear connected?
- What is the right hard/soft invalidation boundary for active file hash
  changes?
- Should provider continuation be opt-in initially, or silently enabled with
  conservative fallback?
- Should context disclosure expose `History: provider continuation`, or keep
  that detail diagnostics-only?
- What provider-retention wording belongs in settings before this ships?
- What protected local storage mechanism should hold continuation handles on
  macOS, Windows, and Linux?
