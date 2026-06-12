# Architecture for Clean Chat and Document Edit Artifacts

Date: 2026-05-23

## Scope

This note proposes an Iliad agent architecture that separates conversational chat from document edit artifacts. The goal is to keep assistant messages readable while edits move through typed proposal objects that can be reviewed, applied, rejected, persisted, and eventually produced by subagents.

The design is based on the current agent implementation in:

- `electron/agent/openaiResponses.ts`
- `electron/agent/types.ts`
- `src/components/AssistantPanel.tsx`
- `src/App.tsx`

It also uses current OpenAI guidance on [Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs), [function calling / tool calling](https://platform.openai.com/docs/guides/function-calling?api-mode=responses), the [Responses API](https://platform.openai.com/docs/api-reference/responses/create?api-mode=responses), the [apply_patch tool](https://platform.openai.com/docs/guides/tools-apply-patch), [tools](https://platform.openai.com/docs/guides/tools?api-mode=responses), and Agents SDK [handoffs](https://openai.github.io/openai-agents-js/guides/handoffs/).

## Current State

Iliad currently asks the model to embed machine-readable edit data inside the human chat answer. `openaiResponses.ts` instructs the model to include a fenced `diff` block plus `FULL_REPLACEMENT:` for active-file replacements, or `NEW_DOCUMENT:` for new Markdown documents. The app then regex-parses those labels out of `response.output_text` and turns them into proposals.

Relevant details:

- `responseText()` collapses `output_text` / `output` into a single string, so the provider layer only preserves chat text, not distinct model output items (`electron/agent/openaiResponses.ts:24`).
- `extractFullReplacement()` and `extractNewDocument()` parse transport markers out of that string (`electron/agent/openaiResponses.ts:62` and `electron/agent/openaiResponses.ts:67`).
- `patchFromResponse()` produces one `AgentPatchProposal` for the active file only. It stores the full replacement and a generated `unifiedDiff` (`electron/agent/openaiResponses.ts:89`).
- `newDocumentFromResponse()` produces one `AgentCreateDocumentProposal` (`electron/agent/openaiResponses.ts:109`).
- `AgentRunResponse` returns `text`, `patch`, and `newDocument`, but `text` still contains the original transport labels and full replacement payload (`electron/agent/types.ts:73`).
- `AssistantPanel` stores proposals in transient React state as transcript entries. It renders `result.text` directly as the assistant message, then adds separate patch/new-document cards if proposal objects exist (`src/components/AssistantPanel.tsx:15` and `src/components/AssistantPanel.tsx:192`).
- Review is single-target. The review pane shows either one generated diff or one new document body, and apply/discard acts on the whole proposal (`src/components/AssistantPanel.tsx:385`).
- `App.applyAssistantPatch()` requires the active file path to match the patch path before applying. `AgentService.applyPatch()` validates the base hash, then writes the full replacement (`src/App.tsx:175` and `electron/agent/agentService.ts:78`).
- `AgentService.applyNewDocument()` already has useful path-safety checks for new files, including relative-path validation, Markdown-only enforcement, hidden segment rejection, and existing-file conflict detection (`electron/agent/agentService.ts:94`).

This works for v1, but it couples UX to prompt syntax. It also makes partial acceptance, multi-file edits, and future subagent output harder because the durable artifact is still reconstructed from prose.

## Problems to Solve

1. Clean chat: users should see explanations, questions, and summaries, not transport syntax like `FULL_REPLACEMENT`, raw full-document payloads, or model-facing diff blocks.
2. Typed proposals: edit artifacts should be returned as structured data with explicit operations, file paths, base hashes, hunks, statuses, and provenance.
3. Pending proposal storage: proposals should survive panel rerenders, active-document changes, assistant-panel close/reopen, and ideally app restart.
4. Per-hunk review: users should be able to accept or reject individual hunks inside a file, not only apply a full replacement.
5. Multi-file support: one assistant run should be able to propose edits to multiple existing files and create multiple new Markdown documents.
6. New-doc review: new documents need the same proposal lifecycle as patches: preview, rename/path validation, accept/reject, and conflict handling.
7. Future subagents: the proposal format should not care whether a run came from one model call, a planner/editor pair, an OpenAI tool call, or a future local subagent.

## Recommended Direction

Use a two-channel contract:

1. `assistantMessage`: user-facing chat only.
2. `artifacts`: typed machine objects for proposed workspace changes.

The renderer should never parse edits from `assistantMessage`. The model provider should produce structured output or tool-call items that are normalized into Iliad proposal objects before reaching React.

The key architectural rule is:

> Chat explains proposals. Proposal objects are the proposals.

## Model Output Contract

For the near term, request a structured JSON response from the Responses API with a schema similar to:

```ts
interface AgentModelEnvelope {
  assistantMessage: string;
  proposals: AgentProposalDraft[];
}
```

`assistantMessage` should be concise prose. It must not contain complete replacements, transport labels, or review diffs. It can say, for example, "I drafted edits to tighten the introduction and add a checklist."

`AgentProposalDraft` should be a discriminated union:

```ts
type AgentProposalDraft =
  | { kind: "edit_file"; relativePath: string; baseHash: string; hunks: ProposedHunk[]; summary: string }
  | { kind: "create_file"; relativePath: string; content: string; summary: string }
  | { kind: "delete_file"; relativePath: string; baseHash: string; summary: string };
```

For Markdown-document editing, prefer `edit_file.hunks` over whole-file replacements. A hunk should carry enough context to validate against the current file:

```ts
interface ProposedHunk {
  id: string;
  summary: string;
  before: string;
  after: string;
  anchor?: {
    precedingText?: string;
    followingText?: string;
    startLine?: number;
    endLine?: number;
  };
}
```

The app should convert drafts into durable `AgentProposal` objects by adding `proposalId`, `runId`, `responseId`, timestamps, normalized absolute paths, validation status, and source metadata.

OpenAI Structured Outputs are a good fit for this stage because they enforce schema adherence for model responses and reduce prompt-only parsing. The official guidance distinguishes structured response data from function calling: use structured outputs when shaping the model's response, and use function calling when connecting the model to application behavior.

## Tool-Call Alternative

For edit artifacts, OpenAI's `apply_patch` guidance is directionally useful even if Iliad should not apply patches immediately. The tool returns structured `apply_patch_call` items with file operations such as create, update, and delete, and the host application is responsible for interpreting, applying, and reporting success or failure.

For Iliad, the safer adaptation is a custom proposal tool rather than direct apply:

```ts
tools: [{
  type: "function",
  name: "propose_document_changes",
  strict: true,
  parameters: {
    type: "object",
    properties: {
      proposals: { type: "array", items: { /* proposal schema */ } }
    },
    required: ["proposals"],
    additionalProperties: false
  }
}]
```

The model calls `propose_document_changes`; Iliad validates and stores the proposals; the assistant then sends a clean message. This matches tool-calling guidance: tool calls are model requests for app-side behavior, and the app owns execution and returned outputs.

Recommendation:

- Short term: use Structured Outputs for `assistantMessage + proposals`.
- Medium term: move to a custom proposal function/tool if the model needs to emit multiple proposal batches, revise proposals after validation failures, or coordinate with subagents.
- Do not expose raw `apply_patch` diffs in chat. If Iliad uses OpenAI `apply_patch` later, treat it as an import format that is normalized into Iliad proposals before display.

## Proposal Object Model

Replace `AgentPatchProposal` and `AgentCreateDocumentProposal` with a single proposal aggregate:

```ts
interface AgentChangeProposal {
  id: string;
  runId: string;
  responseId?: string;
  createdAt: string;
  title: string;
  summary: string;
  source: ProposalSource;
  status: "pending" | "partially_applied" | "applied" | "rejected" | "stale" | "failed";
  files: ProposedFileChange[];
}
```

`ProposedFileChange` should represent one file operation:

```ts
type ProposedFileChange =
  | ExistingFileEdit
  | NewFileCreation
  | FileDeletion;
```

For existing files:

```ts
interface ExistingFileEdit {
  kind: "edit_file";
  id: string;
  path: string;
  relativePath: string;
  baseHash: string;
  currentHashAtValidation?: string;
  status: "pending" | "partially_applied" | "applied" | "rejected" | "stale" | "failed";
  hunks: ReviewHunk[];
}
```

For new documents:

```ts
interface NewFileCreation {
  kind: "create_file";
  id: string;
  relativePath: string;
  content: string;
  status: "pending" | "created" | "rejected" | "conflict" | "failed";
}
```

For each hunk:

```ts
interface ReviewHunk {
  id: string;
  summary: string;
  before: string;
  after: string;
  status: "pending" | "accepted" | "rejected" | "applied" | "stale" | "failed";
  location: {
    startLine?: number;
    endLine?: number;
    confidence: "exact" | "anchored" | "fuzzy" | "unknown";
  };
  previewDiff: string;
}
```

This aggregate gives the UI one stable card per proposal, one file section per target, and one review row per hunk. It also allows partial application while preserving provenance.

## Pending Proposal Storage

Current proposal state lives in `AssistantPanel.entries` and disappears with chat reset, app reload, or component lifecycle changes. Proposal state should move behind the agent service boundary:

- `AgentProposalStore` in Electron main process.
- Backing store under app user data, for example `agent-proposals.json` or a small SQLite table if the app already adopts SQLite later.
- IPC methods: `listProposals(workspaceRoot)`, `getProposal(id)`, `updateProposalStatus(id, status)`, `applyProposalHunks(request)`, `rejectProposalHunks(request)`, `deleteProposal(id)`.
- Proposal records scoped by workspace root and relative path, not only by active file.
- Optional transcript references: chat entries can store `proposalIds` instead of embedding proposal payloads.

Storage should include:

- `workspaceRoot`
- `runId`
- `responseId`
- `model`
- `createdAt`
- `updatedAt`
- `source.agentId` or `source.subagentId`
- proposal status
- file operations
- per-hunk statuses
- original base hashes
- validation errors

Pending proposal storage should not store API keys, hidden reasoning, or unbounded raw provider payloads. If raw provider output is useful for debugging, gate it behind a diagnostic flag and redact user secrets.

## Applying and Rejecting Per Hunk

Whole-file replacement is simple but too coarse. Per-hunk apply needs a deterministic patch pipeline:

1. Read current file.
2. Check `baseHash`. If unchanged, apply accepted hunks against the base content.
3. If changed, try to locate each hunk using exact `before` text plus anchors.
4. If a hunk cannot be located cleanly, mark it `stale` and leave it unapplied.
5. Apply only `accepted` hunks in file order.
6. Write the resulting file once.
7. Recompute file hash.
8. Mark applied hunks `applied`; keep rejected hunks `rejected`; mark unresolved hunks `stale` or `failed`.

Rejecting a hunk should only update proposal state. Rejecting all pending hunks in a file can mark the file change rejected. Rejecting all files can mark the proposal rejected.

Important UI behavior:

- "Apply selected" applies checked pending hunks.
- "Reject selected" records rejection without changing files.
- "Apply file" applies all pending hunks in that file.
- "Reject proposal" rejects remaining pending hunks and file creations.
- If a file changed since proposal creation, show a stale state and offer "revalidate" or "regenerate".

For new documents, acceptance should create the file after path validation and conflict checking. Rejection should not write anything. If the proposed path conflicts, let the user rename the target path before applying.

## Clean Chat Rendering

`AssistantPanel` should render only `assistantMessage` for assistant entries. Proposal cards should be separate UI objects loaded by proposal ID.

Provider responses should be sanitized at the boundary:

- If using Structured Outputs, `assistantMessage` is already clean.
- If retaining old marker parsing temporarily, strip `FULL_REPLACEMENT`, `NEW_DOCUMENT`, fenced replacement bodies, and transport diffs before storing `text`.
- Never feed raw replacement payloads back into future chat history. `chatMessages` should contain only user-facing assistant prose, plus optional compact proposal summaries.

This matters because `AssistantPanel.chatMessages` currently derives future model context from rendered user/assistant entries. If transport payloads remain in assistant text, future turns inherit long full-document replacements and implementation markers.

Recommended transcript entry shape:

```ts
type AssistantEntry =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "assistant"; text: string; proposalIds?: string[] }
  | { id: string; kind: "status" | "error"; text: string };
```

Proposal cards should be resolved separately:

```ts
type ProposalCard = {
  proposalId: string;
  title: string;
  fileCount: number;
  hunkCount: number;
  status: AgentChangeProposal["status"];
};
```

## Multi-File Edits and New Docs

The current `AgentRunRequest.activeFile` contract only provides one active document. Multi-file edits require an explicit context model:

```ts
interface AgentRunRequest {
  activeFile: AgentFileContext | null;
  contextFiles: AgentFileContext[];
  selectedFiles?: string[];
  workspaceSummary?: WorkspaceSummary;
}
```

Do not let the model invent edits for files it has not seen unless Iliad first adds workspace-search or file-read tools. For v1.5, a conservative rule is:

- The model may edit `activeFile`.
- The model may create new Markdown files anywhere under the visible workspace if the path passes safety validation.
- The model may edit additional files only if they were explicitly included as `contextFiles`.

The proposal object should support many file changes even before the UI exposes broad context selection. This prevents another type migration later.

New documents should be first-class `create_file` operations inside the same proposal aggregate. A run can then say, "I drafted edits to `guide.md` and created `appendix.md`," with both changes reviewed in one proposal.

## Future Subagent Compatibility

Future subagents should emit the same normalized proposal contract, not special UI formats. The contract should include source metadata:

```ts
interface ProposalSource {
  kind: "openai_response" | "tool_call" | "subagent" | "imported_patch";
  agentId?: string;
  agentName?: string;
  parentRunId?: string;
  toolCallId?: string;
}
```

This allows a planner/editor/reviewer pipeline without changing AssistantPanel:

1. Planner subagent decides affected files.
2. Editor subagent drafts hunks.
3. Reviewer subagent annotates risk or confidence.
4. Iliad stores one proposal with per-hunk metadata from those stages.
5. The UI renders the proposal the same way it renders a single-model proposal.

OpenAI Agents SDK handoffs are represented to the model as tools, and handoffs can pass filtered conversation state. That reinforces the same boundary: subagent orchestration should happen behind the service layer, while the UI receives normalized messages and proposals.

## Boundary Responsibilities

Electron agent/provider layer:

- Calls model/provider APIs.
- Requests structured response or proposal tool calls.
- Validates schema.
- Normalizes provider-specific output into Iliad proposal drafts.
- Strips transport content from chat.
- Stores pending proposals.

Proposal service:

- Validates paths and Markdown constraints.
- Calculates hashes.
- Builds preview diffs.
- Tracks per-hunk status.
- Applies accepted hunks.
- Handles stale/conflict states.

Renderer:

- Renders clean transcript text.
- Lists proposal cards by ID.
- Shows file/hunk review UI.
- Sends apply/reject commands.
- Does not parse model output.
- Does not own durable proposal state.

App shell:

- Refreshes file tree after create/delete.
- Opens affected files after apply when appropriate.
- Shows notices/errors.

## Migration Plan

1. Add new proposal types alongside existing `AgentPatchProposal` and `AgentCreateDocumentProposal`.
2. Add a sanitizer so `result.text` no longer displays `FULL_REPLACEMENT`, `NEW_DOCUMENT`, or complete replacement bodies.
3. Introduce a proposal store in Electron and return `proposalIds` from `startRun`.
4. Convert current full replacement/new document parser into a legacy adapter that produces `AgentChangeProposal`.
5. Change `AssistantPanel` to render clean assistant entries plus proposal cards loaded by ID.
6. Add multi-file proposal aggregate support, even if the first adapter only emits one file.
7. Replace full-replacement apply with hunk apply for `edit_file`.
8. Move provider output to Structured Outputs or a custom proposal tool.
9. Add optional subagent source metadata once there is more than one producer.

This order avoids a large provider/UI rewrite in one step. It also fixes the most visible UX issue, transport syntax in chat, before deeper patch mechanics land.

## Open Questions

- Should rejected proposals remain in history for auditability, or disappear from the default transcript?
- Should proposal storage be app-global per workspace or embedded in a hidden workspace metadata file? App-global avoids modifying user folders; workspace-local makes proposals portable.
- How much file context should Iliad include before adding explicit file-read/search tools?
- Should Markdown hunks be plain text ranges, syntax-aware block edits, or both? Syntax-aware blocks would improve review UX for headings, lists, and tables, but plain text hunks are simpler and provider-agnostic.
- Should create-file proposals allow non-Markdown assets later, or should the first contract remain Markdown-only?

## Recommendation

Adopt a provider-neutral `AgentChangeProposal` aggregate now, backed by a proposal store and clean transcript entries. Use Structured Outputs first because they are the smallest change away from marker parsing. Design the proposal schema so it can also accept custom tool calls, OpenAI `apply_patch` operations normalized into Iliad hunks, or future subagent outputs.

The important line is architectural, not provider-specific: the model may explain changes in chat, but all editable artifacts must travel as typed proposals with lifecycle state.
