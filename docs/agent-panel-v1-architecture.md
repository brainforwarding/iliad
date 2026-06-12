# Iliad Agent Panel V1 Architecture

Research date: 2026-05-22

This document synthesizes the agent research in [`docs/research/agentic-architecture-survey.md`](./research/agentic-architecture-survey.md), [`docs/research/agent-chat-ux-patterns.md`](./research/agent-chat-ux-patterns.md), [`docs/research/model-provider-comparison.md`](./research/model-provider-comparison.md), and [`docs/research/community-sentiment-reddit.md`](./research/community-sentiment-reddit.md).

For current product direction, read [`agent-vision.md`](./agent-vision.md) and
[`agent-runtime-roadmap.md`](./agent-runtime-roadmap.md). This file remains a
research-backed architecture note, but those two docs are the stricter source
of truth for future agent decisions.

The goal is a Cursor-like chat panel inside Iliad that can answer questions about a Markdown workspace, propose source-level edits, and eventually coordinate multiple bounded worker agents while preserving Iliad's local-first source contract.

## Executive Recommendation

Build a narrow, local, review-first agent harness in Electron main, surfaced through a right-side agent panel in the renderer. The first useful version should support one visible supervisor agent, explicit context chips, visible runtime/status rows, and reviewable Markdown diffs before any write. Worker agents come later, after context manifests and evented runs exist.

Do not start with a general IDE agent. Iliad's advantage is that every useful edit can be a Markdown source patch against a local file. That means v1 can be much safer and simpler than Cursor, Claude Code, Codex, or Antigravity:

- The renderer never calls model APIs or writes files directly.
- Electron main owns model calls, context assembly, tools, approvals, traces, and patch application.
- The model can read and propose. Iliad validates and applies only after user review.
- Subagents are bounded jobs with explicit scope, tools, model, budget, and output schema.
- The UI shows "Reader is searching", "Reviewer is waiting", or "Supervisor is waiting for Style editor" from runtime events, not from vague chat prose.

Use a provider-neutral adapter, but keep the product split clear: Codex is the
preferred runtime for the main workspace agent, OpenAI Platform API keys remain
for dictation/media and fallback text runs, and other providers can be evaluated
behind the same document-tool and proposal contracts.

## How These Agents Work

Cursor, Claude Code, Codex, and Antigravity are not "a chat box plus a model." They are agent harnesses:

```text
user goal
  -> assemble instructions, context, tools, budget, and permissions
  -> call model
  -> stream assistant text/status
  -> receive tool calls or structured decisions
  -> validate and execute allowed tools
  -> append observations
  -> repeat until done, blocked, canceled, or over budget
```

The model is the planner and language engine. The harness is the product: context selection, tool execution, approvals, file safety, tracing, cancellation, retries, and UI state.

Multi-agent systems add a scheduler around that same loop. The "main agent" is a supervisor that can spawn child runs with narrower context and tool permissions. Those children do not need magical shared memory. They communicate through structured task records, tool outputs, patches, summaries, and status events.

```text
Supervisor run
  -> creates task contracts
  -> starts Worker A and Worker B
  -> continues local work or waits on dependencies
  -> receives worker outputs
  -> asks Reviewer to inspect evidence/patch
  -> emits final answer or reviewable patch
```

The Antigravity-style "waiting for agent X" UX is a direct projection of this scheduler: each worker has a state, heartbeat, current phase, output artifact, and dependency list. The main transcript can say it is waiting because the runtime actually knows which worker promise is unresolved.

## Iliad Product Fit

Iliad is currently a local-first Markdown writing app. The existing app shape matters:

- [`src/App.tsx`](../src/App.tsx) composes workspace state, file actions, editor preferences, chrome, sidebar, and editor.
- [`src/components/EditorPane.tsx`](../src/components/EditorPane.tsx) owns the CodeMirror Markdown surface.
- [`electron/preload.ts`](../electron/preload.ts), [`electron/ipc/files.ts`](../electron/ipc/files.ts), and [`electron/fs/pathSafety.ts`](../electron/fs/pathSafety.ts) form the filesystem safety boundary.
- [`docs/source-as-contract.md`](./source-as-contract.md) says the on-disk Markdown file is the contract.

The assistant must preserve that contract. It should edit Markdown source, not rendered DOM. It should never store hidden document meaning in chat state. If the assistant proposes a change, the user should be able to inspect the Markdown diff and understand exactly what will land on disk.

All durable writing artifacts remain Markdown documents. A course map, rubric,
handout, facilitator guide, script, slide outline, or research annex should be
created with the same generic document tools and review UI, not with separate
artifact-specific product primitives.

## V1 Goals

The roadmap should deliver these workflows in order, without treating all of
them as first-slice work:

1. Ask about the active document.
2. Ask about a selected passage.
3. Attach other Markdown files with `@` references.
4. Search the workspace with explicit user scope.
5. Propose a Markdown patch.
6. Review, apply, partially apply, or discard proposed changes.
7. Run a bounded multi-agent flow where read-only workers gather evidence and a supervisor synthesizes a patch.
8. Show live status for real active workers in compact transcript rows.
9. Persist local chat/run history outside Markdown documents.
10. Cancel safely without leaving partial writes.

## V1 Non-Goals

Do not ship these in the first implementation:

- Terminal execution.
- Browser/computer-use automation.
- Remote cloud workers.
- Unattended background writes.
- Automatic persistent memory.
- Free-form MCP connector access.
- Full multi-chat grid or global agent manager.
- Hidden whole-workspace upload.
- A "full access" mode.
- Separate durable artifact types for rubrics, handouts, or slide decks.

These can come later once read/search/diff/apply is trustworthy.

## Proposed Architecture

```text
Renderer
  src/components/AssistantPanel.tsx
  src/components/AssistantHeader.tsx
  src/components/AssistantTranscript.tsx
  src/components/AssistantContextChips.tsx
  src/components/AssistantReviewDrawer.tsx

Preload bridge
  window.iliad.agent.startRun(...)
  window.iliad.agent.sendInput(...)
  window.iliad.agent.cancelRun(...)
  window.iliad.agent.approveAction(...)
  window.iliad.agent.onEvent(...)

Electron main
  electron/agent/agentService.ts
  electron/agent/settingsStore.ts
  electron/agent/proposalStore.ts
  electron/agent/runtime/provider.ts
  electron/agent/runtime/codexAppServerProvider.ts
  electron/agent/runtime/openaiResponsesProvider.ts
  electron/agent/tools/listDocuments.ts
  electron/agent/tools/readDocument.ts
  electron/agent/tools/searchDocuments.ts
  electron/agent/tools/proposeDocumentChange.ts
  electron/agent/approvals.ts
  electron/agent/traces.ts

Existing filesystem boundary
  electron/fs/fileOps.ts
  electron/fs/pathSafety.ts
  electron/ipc/files.ts
```

The provider adapters normalize model streams into one internal event protocol:

```ts
type AgentEvent =
  | { type: "run_started"; run: AgentRunSnapshot }
  | { type: "phase_changed"; runId: string; phase: AgentPhase; detail?: string }
  | { type: "assistant_delta"; runId: string; text: string }
  | { type: "tool_call_started"; call: ToolCallSnapshot }
  | { type: "tool_call_finished"; callId: string; resultSummary: string }
  | { type: "worker_started"; parentRunId: string; worker: AgentRunSnapshot }
  | { type: "worker_waiting"; parentRunId: string; workerRunId: string; reason: string }
  | { type: "patch_proposed"; runId: string; patch: PatchProposal }
  | { type: "approval_requested"; request: ApprovalRequest }
  | { type: "run_finished"; runId: string; output: AgentFinalOutput }
  | { type: "run_failed"; runId: string; error: AgentError }
  | { type: "run_canceled"; runId: string };
```

The renderer should render these events. It should not know whether they came from OpenAI, Gemini, Claude, or a local model.

## Context Management

The context system should separate "what Iliad knows" from "what this model call sees."

### Context Ledger

Each thread/run should maintain a local context ledger:

```ts
interface ContextItem {
  id: string;
  type: "active_file" | "selection" | "attached_file" | "search_result" | "summary" | "instruction" | "tool_result";
  path?: string;
  heading?: string;
  range?: { startLine: number; endLine: number };
  contentHash?: string;
  inclusion: "full" | "excerpt" | "summary" | "reference_only";
  source: "user" | "system" | "tool" | "agent";
}
```

The UI should expose user-relevant ledger items as context chips:

- `Current file`
- `Selection`
- attached files/headings
- folder scope
- summaries marked as `summary`

If the assistant uses a summary instead of raw source, label that in the tool row. Users should be able to expand and see what source file the summary came from.

### Model Input Policy

Assemble model input in this order:

1. Stable system/developer contract: source-as-contract, safety, tool policy.
2. Provider/tool instructions.
3. Workspace metadata: workspace name, active file path, language.
4. User-selected context: active file, selection, attached files.
5. Retrieved snippets with paths/ranges/hashes.
6. Short task state summary.
7. Recent turns and relevant tool results.
8. Current user request.

Keep stable content first for provider prompt caching. Keep dynamic user context near the end.

### Compaction

Do not rely on provider-managed conversation state as the only source of truth. OpenAI supports `previous_response_id` and conversation state, Claude and Gemini expose different state/session mechanisms, and local providers may be stateless. Iliad should persist its own normalized thread and run history.

Use a three-tier context strategy:

- Short-term window: last user/assistant turns and important tool outputs.
- Task summary: compact, structured summary of decisions, constraints, open questions, pending patches, and worker outputs.
- Source retrieval: re-read exact Markdown snippets by path/range when needed instead of trusting old summaries.

When context gets large, summarize chat/tool history but preserve:

- current user goal,
- accepted constraints,
- rejected approaches,
- pending approval state,
- affected files,
- file content hashes used for patches,
- exact source snippets needed for edits.

### Retrieval

Start with deterministic Markdown search:

- filename and heading search,
- text search over Markdown files,
- current document outline,
- backlinks/internal links if available later.

Embeddings can come later. For v1, deterministic search is easier to explain and debug.

## Tool Surface

V1 tool set:

| Tool | Allowed by default | Notes |
| --- | --- | --- |
| `listDocuments` | yes | Lists visible Markdown documents in the open workspace. |
| `readDocument` | yes for active/attached docs | Reads a Markdown document or current editor buffer snapshot through path safety. |
| `searchDocuments` | ask first unless user chose folder/workspace scope | Return snippets, not whole files. |
| `proposeDocumentChange` | yes | Creates an in-memory Markdown proposal only. |
| `requestReview` | yes | Opens review drawer. |
| `askUser` | yes | Used for missing scope, ambiguity, or risky changes. |

All tool arguments are untrusted. Validate schemas and path safety before execution. The model never directly persists files. Accept/apply is an Iliad UI action, not a model tool.

## Patch Model

Patch proposals should be anchored to a file content hash and source ranges.

```ts
interface PatchProposal {
  id: string;
  runId: string;
  summary: string;
  files: Array<{
    path: string;
    baseHash: string;
    unifiedDiff: string;
    hunks: PatchHunk[];
  }>;
}
```

Before applying:

1. Flush pending editor autosave.
2. Re-read the target file.
3. Compare current hash with `baseHash`.
4. If unchanged, apply.
5. If changed, try a conservative rebase only for non-overlapping hunks.
6. If overlap exists, stop and ask the agent to regenerate against the current file.

This prevents stale agents from overwriting the user's recent writing.

## Multi-Agent V1

The first multi-agent system should be real, but constrained.

### Roles

| Role | Model tier | Tools | Writes? | Purpose |
| --- | --- | --- | --- | --- |
| Supervisor | balanced/deep | spawn worker, read summaries, prepare patch, ask user | no direct writes | Owns user goal, decomposes tasks, synthesizes final answer. |
| Reader | fast | read/search only | no | Finds relevant passages and returns cited evidence. |
| Style editor | fast | read attached style docs/current doc | no | Extracts style constraints or recurring voice. |
| Reviewer | fast/balanced | read proposed patch and source snippets | no | Checks patch for instruction drift, unsupported claims, source-contract violations. |
| Writer | balanced | read selected source, prepare proposal | proposal only | Drafts Markdown changes from evidence. |

Only one role can create a document proposal per task in v1. Multiple writers
create merge complexity too early.

### Task Contract

Every spawned worker gets a contract:

```ts
interface AgentTaskContract {
  id: string;
  parentRunId: string;
  title: string;
  objective: string;
  scope: {
    allowedPaths: string[];
    deniedPaths: string[];
    maxFiles: number;
  };
  tools: string[];
  modelMode: "fast" | "balanced" | "deep" | "local";
  budget: {
    maxToolCalls: number;
    maxInputTokens?: number;
    maxOutputTokens?: number;
    timeoutMs: number;
  };
  outputSchema: "evidence_summary" | "style_notes" | "patch_review" | "draft_patch";
}
```

### Spawn Rules

V1 limits:

- maximum 3 concurrent workers,
- maximum depth 1 below the supervisor,
- workers are read-only except the single patch drafter's in-memory proposal,
- no recursive spawning by workers,
- no worker can expand its own file scope,
- worker output must include source references or say it found none.

The supervisor can continue non-overlapping work while workers run. If it needs a worker result, the runtime emits `worker_waiting`, and the UI can render "Waiting for Style editor" or "Waiting for Workspace Search."

### Orchestration Loop

```text
start supervisor
  -> classify task
  -> if more evidence needed, spawn readers with task contracts
  -> stream status events to UI
  -> gather worker outputs
  -> draft answer or patch
  -> if patch, run critic
  -> if critic fails, revise once or ask user
  -> show answer or review drawer
```

The supervisor should not be allowed to spawn agents merely because it can. Spawn only when the task can be split into independent evidence-gathering or review work.

## UI/UX Design

Add a right-side assistant panel to the existing app layout. Keep the file tree and editor stable. Hide or collapse the assistant in focus mode.

### Panel Layout

```text
Assistant Header
  title | New Chat | Mode/Model | close

Context Strip
  Current file chip | Selection chip | @attached file chips

Transcript
  user message
  assistant text
  tool rows
  worker status rows
  patch proposal cards
  errors

Composer
  @ mention input | attach selection | submit/stop
```

### Required Features

| Feature | V1 behavior |
| --- | --- |
| Chat history | Store local threads per workspace outside Markdown. V1 can expose current thread plus New Chat; history popover can follow. |
| New chat | Starts a new thread and clears model context. Keep old thread resumable in local app data. |
| Thread title | Generate from first prompt and active file. Allow rename later. |
| Model picker | Show simple hosted modes: `Fast`, `Balanced`, `Deep`. Advanced provider/model IDs and local/offline mode can wait. |
| Context attachments | `@` search Markdown files/headings. Chips show what will be read. |
| Tool disclosure | Collapsed rows: `Read Draft.md`, `Search workspace`, `Prepare proposal`, `Reviewer checked proposal`. |
| Subagent status | Show neutral worker rows: `Reader`, `Style editor`, `Reviewer`. Avoid marketing language like "agent swarm." |
| Review/apply | Persistent `Review changes` button when pending patches exist. Unified diff drawer before apply. |
| Approvals | Reads of active/attached docs are allowed; broader workspace search and every write need review/approval. |
| Errors | Sticky error row with retry/details. Save/apply errors block state changes. |
| Cancellation | Stop button cancels new model/tool work. No file changes occur unless a reviewed patch was already applied. |

### Status Language

Use runtime-derived status messages:

- `Reading Draft.md`
- `Searching 12 Markdown files`
- `Style editor is summarizing Style Guide.md`
- `Supervisor is waiting for Workspace Reader`
- `Reviewer is checking the proposed patch`
- `Waiting for your review`

Do not bury this in assistant paragraphs. Status rows are easier to scan and less likely to sound like fake progress.

## Provider Strategy

Use modes rather than hard-coded provider names in the main UI, but avoid
hiding important capability differences.

Current direction:

1. **Main agent:** Codex app-server / Codex SDK style runtime for connected
   account users, because it is designed around workspace agent turns,
   approvals, streamed events, and file-change capture.
2. **Media/API features:** OpenAI Platform API key for dictation,
   transcription, realtime, images, embeddings, and other non-agent features.
3. **Fallback text agent:** OpenAI API-key provider remains available when
   Codex is disconnected or unavailable.
4. **Future providers:** Gemini, Claude, and local providers can be considered
   only if they conform to the same context manifest, document tool, event, and
   proposal contracts.

The UI can expose simple effort modes such as `Fast`, `Balanced`, and `Deep`,
but those modes should select from runtime-supported models. A model that cannot
produce useful thinking/progress or document-change events must degrade
gracefully rather than breaking the agent UI.

## Data Storage

Store assistant state outside the workspace Markdown files, preferably under Electron's app data directory:

```text
Iliad app data/
  assistant/
    workspaces/
      <workspace-hash>/
        threads.jsonl
        runs.jsonl
        traces/
          <run-id>.jsonl
        patches/
          <patch-id>.diff
```

Do not create hidden sidecar files in the user's workspace for v1. If later users want project-shared assistant instructions, use an explicit, visible file such as `AGENTS.md` or `ILIAD.md`, and document it.

## Security and Privacy

Key policies:

- Provider API keys live in Electron main, never renderer.
- V1 can read keys from environment variables for development; production needs OS keychain storage.
- Every provider request is scoped by visible context chips and tool policy.
- Markdown documents are untrusted data. Prompt-injection text inside a document cannot grant tool permissions.
- No hidden upload of the entire workspace.
- Trace capture must be configurable because traces may contain private document text.
- Tool budgets stop runaway cost: max turns, max tool calls, max worker count, max wall time, max search scope.

## Implementation Plan

1. Add assistant UI shell.
   - Right panel, header, context strip, transcript, composer, status row.
   - No model calls yet; mock events from local fixtures.

2. Add local session/run store.
   - JSONL thread/run/event storage in app data.
   - `New Chat`, generated thread title, cancellation state.

3. Add Electron agent IPC.
   - Start/cancel run.
   - Subscribe to run events.
   - Approve/reject actions.

4. Add provider adapter and read-only document tools.
   - Codex first for the main agent, OpenAI API fallback where appropriate.
   - `listDocuments`, `readDocument`, `searchDocuments`.
   - Stream normalized events to renderer.

5. Add patch proposal and review drawer.
   - Generate in-memory unified diffs.
   - Review and apply through existing file save/path safety layer.
   - Hash/rebase conflict checks.

6. Add constrained multi-agent runtime.
   - Supervisor can spawn read-only Reader/Style editor/Reviewer workers.
   - Status rail shows live worker state.
   - Max 3 workers, depth 1, no worker writes.

7. Add model registry and provider conformance tests.
   - Tool call, invalid args, structured output, streaming, cancellation, cost/usage parsing.
   - Benchmark Fast/Balanced/Deep modes on real Iliad tasks.

8. Add history and polish.
   - Thread picker, rename/delete/export.
   - Error details, retry, trace viewer.

## Evaluation Tasks

Use a small repeatable eval suite before expanding autonomy:

- "Summarize active document without editing."
- "Tighten selected paragraph and preserve Markdown links."
- "Apply this style guide to the introduction only."
- "Search workspace for notes about X and cite files."
- "Propose a multi-file Markdown cleanup but do not apply."
- "Handle stale patch when user edits the file before approval."
- "Cancel while searching and verify no write occurred."
- "Spawn two readers and one critic; verify status events and final patch references."

Success criteria:

- no hidden writes,
- every patch is reviewable,
- every source claim points to file evidence,
- cancellation is clean,
- stale patches are blocked,
- worker status is accurate,
- provider swaps do not change UI event semantics.

## Open Decisions

- Whether v1 should include a visible history picker or only current-thread New Chat.
- Whether to use OpenAI Agents SDK directly or a custom runner inspired by it. Current recommendation: custom runner with OpenAI Responses adapter first, because Iliad needs provider neutrality and tight Electron/file integration.
- Whether workspace search requires approval each time or can be granted per thread.
- Whether accepted assistant patches should create app-level restore snapshots in addition to normal autosave.
- Whether `AGENTS.md`/`ILIAD.md` should be supported in v1 as explicit project instructions.

## Bottom Line

The best v1 is not a clone of Cursor or Antigravity. It is a Markdown-native agent workbench:

- a supervisor that understands the user's writing task,
- bounded workers that gather evidence or review output,
- a transparent context ledger,
- visible status and waiting states,
- reviewable source diffs,
- local persistence and audit logs,
- provider flexibility behind a simple mode menu.

That gets Iliad the useful part of modern agent products without importing their riskiest behavior.
