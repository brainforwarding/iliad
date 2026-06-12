# Agent Context Ledger Phase 1

Date: 2026-05-24
Status: reviewed spec

## Problem

The agent can now use either the Codex app-server runtime or the OpenAI API
fallback, but each run still has no durable record of what Iliad sent or
allowed the runtime to use. The transcript may say that a proposal was prepared,
and proposals are persisted separately, but there is no run-scoped context
manifest that answers basic questions:

- Which file was active when the user sent the request?
- Which provider and model handled the run?
- Was the current file included, and was anything else intentionally excluded?
- Which proposals were generated from that run?
- For Codex, was the workspace available through the runtime/tool surface even
  if every file was not uploaded into the prompt?
- Did the run complete or fail?

Without this foundation, the UI cannot honestly show inspectable context chips
or future worker/subagent status. It also becomes harder to debug provider
behavior without relying on raw logs.

## Product Intent

Phase 1 creates the runtime-side source of truth for context disclosure. Every
agent run gets a small metadata-only manifest before the provider call starts.
The manifest is stored locally in app data, updated as the run completes, and
returned with the run response. It must not persist full document text,
provider credentials, Codex tokens, prompt/messages, proposal bodies, raw error
stacks, or absolute workspace paths.

This is the first half of the next roadmap item. Phase 2 will make the manifest
visible in the assistant UI.

## Goals

- Add a typed `AgentRunContextManifest` shared by Electron and the renderer.
- Build a manifest at the start of `AgentService.startRun`.
- Persist manifests in local app data with bounded history.
- Record provider id, provider label, billing type, model, mode, language,
  workspace label, non-display workspace id, active file metadata, token
  estimates, included/available/excluded context items, generated proposal ids,
  lifecycle status, timestamps, and safe error/proposal metadata.
- Return the manifest in `AgentRunResponse` as
  `contextManifest?: AgentRunContextManifest`, including failed runs when a
  manifest could be created. Missing-key and other pre-provider-selection
  failures may return no manifest.
- Keep the manifest metadata-only: no `activeFile.content`, no prompt/messages,
  no proposal `baseContent`, `replacement`, generated file `content`, or
  `unifiedDiff`, no full assistant response text, no API keys or account tokens,
  and no absolute workspace root in persisted records.
- Update the roadmap so the context work is explicitly split into Phase 1
  foundation and Phase 2 UI disclosure.
- Cover manifest building and persistence with focused tests.

## Non-Goals

- No new visible context UI in this phase beyond type plumbing.
- No manual context picker, `@file`, workspace search, selected-text capture,
  or attachments.
- No conversation history persistence.
- No subagent or worker orchestration.
- No changes to provider prompts or the model input policy.
- No direct file writes by the agent; proposals remain review-first.
- No storage of large model inputs or full document content in the manifest
  ledger.

## System Flow

1. Renderer sends the existing `AgentRunRequest`.
2. `AgentService.startRun` validates the active Markdown file if present.
3. Settings are loaded and the runtime provider is selected.
4. A context manifest is created before `provider.startRun`.
5. The manifest is persisted with status `running`.
6. Provider runs normally.
7. Draft file changes are saved as existing `AgentChangeProposal` records.
8. The manifest is updated to `completed` with proposal ids and response id.
9. The run response returns the manifest with the text and proposals.
10. If provider execution fails after manifest creation,
    the manifest is updated to `failed` with the normalized error code and safe
    user-facing error message.

If provider selection fails before a concrete provider exists, the run may
return an error without a manifest. Phase 1 should not add a fake provider
contract just to cover that path.

## Manifest Shape

The shared type should be explicit and conservative:

```ts
export type AgentRunContextManifestStatus = "running" | "completed" | "failed" | "canceled";
export type AgentRunContextItemKind = "current_file" | "proposal" | "workspace_scope" | "runtime_workspace";
export type AgentRunContextInclusion = "full" | "reference" | "available" | "excluded";

export interface AgentRunContextItem {
  id: string;
  kind: AgentRunContextItemKind;
  label: string;
  relativePath?: string;
  inclusion: AgentRunContextInclusion;
  reason: string;
  baseHash?: string;
  estimatedTokens?: number;
}

export interface AgentRunContextManifest {
  id: string;
  runId: string;
  createdAt: string;
  updatedAt: string;
  status: AgentRunContextManifestStatus;
  workspaceLabel: string;
  workspaceId: string;
  workspaceRootPersisted: false;
  provider: AgentRuntimeProviderMetadata;
  model: AgentModelId | string;
  mode: AgentMode;
  language: "en" | "es";
  policy: "auto";
  items: AgentRunContextItem[];
  estimatedInputTokens: number;
  responseId?: string;
  proposalIds: string[];
  error?: {
    code: AgentErrorCode;
    userMessage: string;
    retryable: boolean;
    providerStatus?: number;
  };
}
```

The Electron and renderer type surfaces must both be updated:

- `electron/agent/types.ts`
- `src/types/iliad.ts`

Implementation should avoid unreviewed extra fields. The persisted serializer
must use an explicit allowlist of manifest fields so future in-memory data
cannot accidentally write Markdown text, prompts, raw provider bodies, proposal
bodies, or stack traces into the ledger.

## Context Policy In Phase 1

Only the current runtime behavior is represented:

- If an active Markdown file is present, record it as an included `current_file`
  item with `id: "current-file"`, `inclusion: "full"`, `relativePath`,
  `baseHash`, and an approximate token estimate from character length.
- If no active Markdown file is present, no current file is included.
- For the OpenAI API fallback, record an excluded `workspace_scope` item for
  "Other workspace files" because that path only sends the current request
  payload and does not have workspace file tools.
- For the Codex app-server runtime, record a `runtime_workspace` item with
  `inclusion: "available"` and a fixed reason such as
  `codex_workspace_runtime`. This means the workspace was available to Codex's
  runtime/tool surface. It does not mean every file was uploaded into the
  prompt.
- If proposals are generated, record proposal ids on the manifest. Do not record
  proposal body text.
- If a run is canceled, map normalized `AgentErrorCode: "request_canceled"` to
  manifest status `canceled`; other normalized errors become `failed`.

The manifest describes what Iliad assembled or allowed, not what the provider
internally cached.

## Persistence

Add an `AgentContextManifestStore` under `electron/agent/`.

Requirements:

- Store JSON in app data, separate from pending proposal storage.
- Keep records bounded, for example the newest 200 manifests.
- Use atomic temp-file writes like `AgentProposalStore`.
- Queue writes to avoid concurrent update loss.
- Ignore and replace malformed store files instead of crashing startup.
- Write files with private user permissions where practical.
- Scope records with `workspaceId`, a salted hash of the resolved workspace
  root. Persist the random salt locally in app data; never persist the raw
  workspace root in the manifest.
- Provide methods:
  - `saveManifest(manifest)`
  - `updateManifest(runId, patch)`
  - `getManifest(runId)`

Phase 1 only needs save/update and return-in-response, but the store should be
usable by Phase 2 without another persistence rewrite.

## Security And Privacy

- Never persist API keys, Codex tokens, auth device codes, cookies, or raw
  provider request bodies.
- Never persist full Markdown content or proposal replacement content in the
  context manifest file.
- Do not persist absolute workspace paths. Use `workspaceLabel` for display and
  `workspaceId` for non-display scoping.
- Error data must use normalized `AgentError` fields, not raw stack traces.
- Diagnostics can log manifest id/run id and counts, but not document content.
- `baseHash` is a persistent document fingerprint. Use only the existing
  `AgentRunRequest.activeFile.baseHash`, do not add additional content hashes,
  and display it only as a short optional diagnostic detail.
- Free-text manifest fields must be constrained:
  - `reason` values are fixed enum-like strings, not model/user/provider prose.
  - `label` is derived from a relative path basename or fixed label.
  - `workspaceLabel` is `path.basename(workspaceRoot)` only.
  - `error.userMessage` comes from normalized `AgentError`, not raw thrown
    errors.

## Tests

Add or update tests for:

- Building a manifest with an active file records path/hash/token estimate but
  does not include document content.
- Building a no-file manifest records no current file and still records the
  provider-appropriate workspace item.
- Manifest store persists, updates, prunes old records, and survives malformed
  JSON.
- The actual persisted JSON does not contain sentinel active document content,
  prompt/messages, assistant response text, proposal `baseContent`,
  `replacement`, generated file `content`, `unifiedDiff`, raw `workspaceRoot`,
  `activeFile.path`, API-key-like strings, raw stack traces, or nested causes.
- Failed provider-execution runs return and persist a manifest with status
  `failed` or `canceled` and normalized error fields only.
- Pre-provider failures remain valid without a manifest.

Run:

- `npm run typecheck`
- `npm test`
- `npm run smoke:review`
- `npm run build`

## Rollout

Ship with no visible UI change except any harmless internal type additions.
Because the manifest is additive and stored in app data, existing users should
not need migration. If the store file is missing, it starts empty.

## Open Question

- Whether to expose a `getManifest` IPC method immediately. Recommendation:
  return the manifest on the run response now; add IPC only if Phase 2 needs
  lazy lookup for history.
