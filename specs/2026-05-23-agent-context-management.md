# Agent Context Management And Minimal UI Spec

Date: 2026-05-23
Status: reviewed spec

## Product Intent

Iliad's agent should feel like a small, quiet workspace collaborator, not a per-document helper bolted onto the right side of the editor. The current UI shows a single active Markdown file in the agent header, which signals the wrong architecture: it makes the agent look scoped to one document, while the desired product is a conversation-scoped agent that can reason over explicit workspace context, create reviewable Markdown document proposals, and eventually delegate bounded work to subagents.

This spec defines the target architecture for context management, the minimal UI changes needed to express it, the runtime contract for future tool and subagent work, and the error-handling requirement exposed by the current `api.openai.com` DNS failure.

## Source Material

Internal implementation and prior specs:

- [`docs/agent-vision.md`](../docs/agent-vision.md)
- [`src/components/AssistantPanel.tsx`](../src/components/AssistantPanel.tsx)
- [`electron/agent/openaiResponses.ts`](../electron/agent/openaiResponses.ts)
- [`electron/agent/agentService.ts`](../electron/agent/agentService.ts)
- [`src/types/iliad.ts`](../src/types/iliad.ts)
- [`specs/2026-05-22-agent-panel-v1.md`](./2026-05-22-agent-panel-v1.md)
- [`specs/2026-05-23-assistant-experience-review.md`](./2026-05-23-assistant-experience-review.md)
- [`docs/research/agentic-architecture-survey.md`](../docs/research/agentic-architecture-survey.md)
- [`docs/research/agent-chat-ux-patterns.md`](../docs/research/agent-chat-ux-patterns.md)

External references:

- Anthropic, "Building effective agents": simple composable patterns, augmented LLMs, orchestrator-workers, tool design, and transparency. https://www.anthropic.com/research/building-effective-agents
- Anthropic Claude Cookbook, "Basic workflows": prompt chaining, parallelization, and routing as simple multi-LLM patterns. https://platform.claude.com/cookbook/patterns-agents-basic-workflows
- OpenAI Agents SDK context management: separates local application context from LLM-visible context; LLMs only see what is inserted into instructions, input, tools, retrieval, or conversation history. https://openai.github.io/openai-agents-python/context/
- OpenAI building agents: product code owns orchestration with the Responses API, and multi-agent work is useful when tasks have distinct tool sets, instructions, or reasoning needs. https://developers.openai.com/tracks/building-agents/
- Claude Code subagents: specialized workers run in separate context windows with scoped prompts, tools, permissions, and result summaries back to the main conversation. https://code.claude.com/docs/en/sub-agents
- Google Antigravity docs: projects bound accessible folders, artifacts communicate plans/work asynchronously, and review policies control whether plans or changes require approval. https://antigravity.google/docs/get-started, https://antigravity.google/docs/artifacts, https://antigravity.google/docs/artifact-review

Do not rely on leaked proprietary prompts or hidden chain-of-thought dumps for implementation. They are not stable documentation, may be incomplete or misleading, and can create legal or product risk. Use official docs, observed public UX, and Iliad's own product goals.

## Current Implementation Findings

The current v1 runtime is active-file scoped:

- `AgentRunRequest` contains `activeFile`, prior chat messages, prompt, mode, language, and workspace root. It has no context manifest, selected text, attached docs, workspace search results, retrieval records, or run ledger.
- `AssistantPanel` renders the header as `Agent` plus `activeFile.relativePath` or `No file`.
- `openaiResponses.instructions()` tells the model to "Use only the visible active document context supplied in this request" and not claim workspace search or file access.
- `openaiResponses.userInput()` sends one `Active file` block or `No active Markdown file is open`.
- `AgentService.startRun()` rethrows provider and network errors. When DNS fails, Electron logs a raw `TypeError: fetch failed` with `ENOTFOUND api.openai.com`.

This was an acceptable v1 safety boundary, but it now conflicts with the intended product model.

## Problem

The agent currently exposes the wrong mental model in three ways:

1. Header context is misleading. Showing `curso-odisea-2026-basico/s2/s2.md` in the header tells the user the agent is attached to one document rather than to the workspace conversation.
2. Context is not inspectable. The user cannot tell what the model saw for a given run, what it did not see, or whether the active document changed after the run started.
3. Work is not evented. If the user asks the agent to make a new file or delegate research, the UI has no runtime evidence of reads, tools, workers, document proposals, waiting states, or failures.

The OpenAI DNS error adds a fourth problem:

4. Provider failures leak low-level implementation details. `fetch failed` and `ENOTFOUND` are useful diagnostics for developers, but not enough for a user trying to understand whether the key, network, DNS, provider, or model failed.

## Goals

- Make the agent conversation-scoped and workspace-aware by contract, while keeping every included context item explicit.
- Remove the single-document path from the agent header.
- Introduce a compact context UI that is minimal by default and inspectable on demand.
- Define a per-run context manifest that records exactly what was included and why.
- Preserve review-first writing: the agent proposes edits or new documents, and the user approves before disk writes.
- Define how active document changes, new document creation, and conversation history interact.
- Define a bounded subagent architecture that can run scoped read/research/critique tasks without flooding the main conversation.
- Add clear provider/network error handling, including DNS failures to `api.openai.com`.
- Keep the first implementation small enough to ship without building a full agent manager.

## Non-Goals

- No always-visible agent dashboard in the editor pane.
- No whole-workspace upload by default.
- No hidden memory that users cannot inspect or clear.
- No automatic direct writes from the model.
- No terminal, browser, MCP, or web-search execution in the immediate UI cleanup phase.
- No claim that the model is aware of files it did not receive through input, tools, retrieval, or summaries.
- No implementation in this spec pass unless explicitly requested after review.
- No artifact-specific durable object tools such as `create_rubric`,
  `create_handout`, or `create_slide_deck`. In Iliad, those outputs are
  Markdown documents created through generic document proposal tools.

## Product Principles

1. The header is identity, not context. It can say `Agent` and expose controls, but it should not name one document as the agent's scope.
2. Context belongs to the run. A run should have an immutable manifest created at start time. Navigating later does not rewrite what the model saw.
3. Context is explicit and inspectable. The default view can be tiny, but the user must be able to open a ledger and see every included file, selection, summary, retrieval, and tool result.
4. Tools create evidence. If the agent reads, searches, delegates, drafts, or waits, the runtime should emit events that the UI can show compactly.
5. Subagents are scoped workers, not magic. Each worker receives a small context pack, limited tools, and returns a summary plus document outputs to the supervisor.
6. Minimal UI wins. The user should not see persistent explanatory prose like "Ask about the active Markdown document or request a reviewable rewrite." The UI should use quiet labels, short chips, and progressive disclosure.

## Target Mental Model

The agent is attached to a workspace conversation.

The active editor file is only one possible context source. Other context sources can include selected text, pinned files, mentioned files, generated proposals, prior run summaries, and future workspace search results. The user can move between documents while a conversation continues. Each run freezes the context it used.

Example:

```text
Conversation: "Session 2 revision"
Workspace: curso-odisea-2026-basico

Run A context:
- Current file at start: s2/s2.md, full, hash abc

Run B context:
- Mentioned file: s2/pauta-evaluacion.md, excerpt, hash def
- Prior summary: run A summary

Run C context:
- Generated proposal: annex-research.md
- No current file included
```

The transcript can refer to the conversation. The context ledger records the exact evidence.

## Minimal UI Direction

### Header

Replace the current header subtitle with no document path.

Target:

```text
Agent                                               [new] [settings] [close]
```

Acceptable optional subtitle only when useful:

```text
Agent
Idle
```

Do not show:

- `Ask about s2.md`
- `Ask about the active Markdown document...`
- `No Markdown file`
- A full relative path in the header

The active file may appear only in context chips or a context ledger, not as the panel identity.

### Empty State

The empty state should be small, quiet, and action-oriented. It should not explain the feature in paragraph form.

Recommended empty state:

```text
[ Ask anything...                            send ]
[ Auto ] [ s2.md ]
```

If the workspace name adds confidence, it may appear as a single subdued label above the composer. If it adds noise, omit it. The panel can simply show the composer lower in the pane similar to Antigravity and Claude Code references.

### Composer

The composer is the primary command surface.

Requirements:

- One rounded container around textarea, context controls, and send/stop button.
- Context chips live inside this same composer container. On narrow panels, the textarea and send button use the first row and context chips use a second row.
- Font family, size, line-height, and color must match the left file panel and Iliad chrome, not the document renderer.
- Use sidebar-style control typography for Phase 1: inherited chrome font, `0.88rem` control/body size, compact line height near `1.1` for chips and file labels, restrained weights, and no document-renderer rhythm.
- Default height should be compact, roughly 44-52px.
- The send button stays bottom-right or center-right within the composer container and does not float halfway up as text grows.
- `Enter` sends by default.
- `Shift+Enter` inserts a newline.
- `Cmd/Ctrl+Enter` also sends for power users.
- The textarea grows up to a cap, then scrolls internally.
- No manual resize handle.
- Placeholder: `Ask anything...`

This matches the user's feedback that the current textarea grows oddly and the send button sits in the middle instead of staying visually anchored.

### Context Chips

Show context as a compact chip row inside the composer, not as a persistent explanatory block.

Default compact row:

```text
[ Auto ] [ s2.md ]
```

Chip meanings:

- `Auto`: default context policy is active.
- `s2.md`: in Phase 1, the current Markdown file will be sent in full with the next message, captured at send time.

No `+` chip ships in Phase 1 unless it opens a real non-destructive control. Manual attachments, file pickers, `@file`, and folder scopes belong to Phase 3.

No-file state:

```text
[ Auto ]
```

No-file state may use `[ Auto: no file ]` only if testing shows users need the extra clarity. Do not move `No file` back to the header.

Future popover, once Phase 2 context manifests exist:

```text
Context for next message

Mode        Auto
Current     s2/s2.md        full if small, excerpt if large
Pinned      none
Search      off

[Manual] [Clear]
```

The row should collapse when width is tight:

```text
[ Auto: 1 file ]
```

### Run Ledger

Each assistant response should expose a small "Context" disclosure only after a run exists.

Closed state:

```text
Context: 1 file, 2.1k tokens
```

Open state:

```text
Included
- s2/s2.md, full, hash abc, active at send time

Not included
- Other workspace files
- Files opened after this message
```

This should be visually quiet and not always expanded.

### Runtime Work Rows

Runtime work rows are evidence, not assistant prose:

```text
Read s2.md
Drafted new document proposal
Waiting for review
```

For future subagents:

```text
Researcher running...
Reviewer complete
Waiting for Researcher
```

Do not show subagent labels until the runtime actually spawns workers.

## Context Contract

### Data Types

```ts
type ContextMode = "full" | "excerpt" | "summary" | "reference";

type ContextSource =
  | "current_file"
  | "selection"
  | "pinned_file"
  | "mention"
  | "workspace_search"
  | "generated_proposal"
  | "prior_summary"
  | "tool_result";

interface ContextItem {
  id: string;
  source: ContextSource;
  mode: ContextMode;
  label: string;
  path?: string;
  relativePath?: string;
  hash?: string;
  tokenEstimate?: number;
  includedText?: string;
  summary?: string;
  reason: string;
}

interface RuntimeContextItem extends ContextItem {
  includedText?: string;
}

interface PersistedContextItem extends Omit<ContextItem, "includedText" | "path"> {
  contentStored: false;
}

interface RunContextManifest {
  runId: string;
  conversationId: string;
  provider: "openai";
  model: string;
  responseId?: string;
  hashAlgorithm: "sha256";
  hashVersion: 1;
  contextPolicyVersion: 1;
  workspaceRootPersisted: false;
  workspaceLabel: string;
  activeFileAtStart?: {
    path?: string;
    relativePath: string;
    hash: string;
  };
  selectedTextAtStart?: {
    path?: string;
    relativePath: string;
    hash: string;
    start?: number;
    end?: number;
  };
  policy: "auto" | "manual" | "off";
  includedItems: PersistedContextItem[];
  excludedItems: Array<{
    label: string;
    relativePath?: string;
    reason: string;
    category: "not_selected" | "too_large" | "outside_workspace" | "future_context";
  }>;
  budget: {
    maxInputTokens: number;
    estimatedInputTokens: number;
  };
  createdAt: string;
  completedAt?: string;
  failedAt?: string;
}

interface AgentConversation {
  id: string;
  workspaceRoot: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  pinnedContext: ContextItem[];
  rollingSummary?: string;
  lastRunIds: string[];
}
```

`RuntimeContextItem` is allowed to carry full text only while assembling and sending the provider request. Persisted manifests must use `PersistedContextItem` and must not store `includedText`. Long-term persistence stores relative path, hash, token estimate, summary, and reason. Absolute `workspaceRoot` is used at runtime for path safety but is not persisted in the manifest; persist a display label instead.

### Context Policies

`Auto` default:

- Include selected text in full.
- Include the current Markdown file at send time if open.
- If the current file is small, include full text.
- If the current file is large, include an excerpt plus generated or cached summary.
- Include pinned files as summary or excerpt depending on budget.
- Include recent conversation as a rolling summary plus the last few turns.
- Do not silently read unrelated workspace files.
- If more context is needed, ask the user or use an explicit read/search tool once that tool exists.
- Phase 1 special case: `Auto` means current Markdown file only, sent in full, captured at send time. There is no manual `+`, search, selected-text chip, or attachment behavior until those features exist.

`Manual`:

- Include only chips the user adds, plus recent conversation summary.
- The current file is not included unless chipped.

`Off`:

- Include no document content.
- The agent can answer general questions or ask for files to be attached.

### Token Priority

When budget is tight:

1. User's current prompt.
2. Selected text.
3. Explicitly mentioned or pinned files.
4. Current file.
5. Recent user/assistant turns.
6. Rolling conversation summary.
7. Tool/retrieval snippets.
8. Older unpinned context.

If truncation changes behavior, the run ledger must say what was summarized, excerpted, or excluded.

## Navigation And Document Changes

### When The User Changes Active File

- The next-message context chips may update to the new current file.
- Existing run manifests do not change.
- The transcript does not pretend previous responses saw the new file.
- If a pending proposal targets a different file, the proposal card should keep its target path visible.

### When The Agent Creates A New Document Proposal

- The proposal is a reviewable Markdown output in the conversation.
- Applying it writes a new file only after review.
- After apply, Iliad may open the new file in the editor.
- Opening that new file updates next-message context, not prior run context.

### When The User Asks About "This"

Resolve "this" using UI state at send time:

1. Selected text if present.
2. Open review surface or pending proposal if the prompt clearly refers to a draft, proposal, diff, or review.
3. Current file if present and context policy allows it.
4. Most recent proposal if the prompt clearly refers to it.
5. Otherwise ask a brief clarifying question.

## Tool Architecture

Note: the proposal-tool names in this section have been superseded by
[`2026-05-24-markdown-change-contract.md`](./2026-05-24-markdown-change-contract.md).
The current direction is one `propose_markdown_changes` contract with explicit
`edit_file` and `create_file` operations inside it, not separate top-level tools
for one-file edit, new document, and multi-file change. The read tools below
remain the intended direction for gathering context.

The next runtime should expose narrow read and write proposal tools rather than relying only on labelled Markdown in model text.

Read tools:

```ts
list_documents(directory?, depth?): { files }
read_document(path): { path, hash, content }
search_documents(query, limit): { matches }
summarize_document(path): { path, hash, summary }
```

Proposal tools:

```ts
propose_markdown_changes(changes)
ask_user(question, reason)
```

Tool permission envelope:

```ts
interface AgentToolPermissions {
  allowedRoots: string[];
  allowedTools: Array<
    | "list_documents"
    | "read_document"
    | "search_documents"
    | "summarize_document"
    | "propose_markdown_changes"
    | "ask_user"
  >;
  canReadFiles: boolean;
  canCreateReviewableWrites: boolean;
  canWriteDirectly: false;
  networkAccess: false;
  webSearch: false;
  shellAccess: false;
  arbitrarySystemAccess: false;
  maxFilesPerRun: number;
  maxSearchResults: number;
  maxToolOutputTokens: number;
  requireApprovalBeforeRead: boolean;
  requireApprovalBeforeProposal: false;
}
```

Rules:

- All paths must be validated with workspace path safety helpers.
- Read tools are read-only and logged in the run manifest.
- Proposal tools never write to disk.
- Apply remains a separate user action.
- Tool permissions are created per run and passed to workers. Subagents may receive a narrower envelope than the supervisor.
- Tool descriptions must be clear and hard to misuse. Anthropic's agent guidance emphasizes that tool interface design matters as much as human UI design.
- Tools operate on Markdown documents. A rubric, handout, lesson plan, deck
  outline, or annex is created through `propose_markdown_changes`, using
  `create_file` or `edit_file` operations as needed, not through a separate
  object-specific tool.

## Subagent Architecture

Do not build multi-agent orchestration until the single-run context manifest and event model exist. Then add subagents as scoped workers.

Recommended first worker types:

- `Reader`: reads mentioned files or approved search results and returns cited
  Markdown evidence.
- `Researcher`: gathers source-backed evidence when research is explicitly
  enabled.
- `Reviewer`: reviews a draft/proposal against explicit criteria and the source
  contract.
- `Style editor`: checks alignment with Iliad's document tone and structure.
- `Writer`: drafts Markdown proposals under the supervisor's plan after
  read-only workers are reliable.

Supervisor responsibilities:

- Decide whether the task is simple enough for one call.
- If delegation helps, create a child task with a bounded context pack.
- Give the child only the tools it needs.
- Track child status in run events.
- Merge child summaries into the final answer.
- Store child manifest separately from parent manifest.

Child context rules:

- Child agents start with isolated context by default.
- They receive the supervisor's task brief, scoped context items, tool permissions, and output format.
- They do not inherit the full parent conversation unless explicitly forked in a future advanced mode.
- They return concise findings, draft Markdown proposals, and references to the parent.

This follows Claude Code's documented separation: subagents preserve main context by doing exploration in their own context window and returning summaries. It also follows OpenAI's guidance to separate agents when tasks have distinct instructions, tools, or reasoning needs rather than using one large prompt.

## Event Model

Move from one opaque `startRun` response to an evented run API.

```ts
interface AgentRunEventBase {
  runId: string;
  sequence: number;
  createdAt: string;
}

type AgentRunEvent =
  | (AgentRunEventBase & { type: "run_started" })
  | (AgentRunEventBase & { type: "context_manifest_created"; manifest: RunContextManifest })
  | (AgentRunEventBase & { type: "tool_started"; toolCallId: string; label: string })
  | (AgentRunEventBase & { type: "tool_completed"; toolCallId: string; label: string; contextItemId?: string })
  | (AgentRunEventBase & { type: "tool_failed"; toolCallId: string; label: string; error: AgentError })
  | (AgentRunEventBase & { type: "worker_started"; workerId: string; role: string; label: string })
  | (AgentRunEventBase & { type: "worker_progress"; workerId: string; label: string })
  | (AgentRunEventBase & { type: "worker_completed"; workerId: string; summary: string })
  | (AgentRunEventBase & { type: "worker_failed"; workerId: string; error: AgentError })
  | (AgentRunEventBase & { type: "assistant_text_delta"; text: string })
  | (AgentRunEventBase & { type: "proposal_created"; proposalId: string })
  | (AgentRunEventBase & { type: "run_waiting_for_review"; proposalId: string })
  | (AgentRunEventBase & { type: "run_failed"; error: AgentError })
  | (AgentRunEventBase & { type: "run_canceled"; reason: "user" | "navigation" | "shutdown" })
  | (AgentRunEventBase & { type: "run_completed" });
```

The v1 implementation can simulate this with an in-memory list, but the contract should be event-shaped so UI, persistence, and future subagents do not need another rewrite.

Ordering rules:

- `sequence` is monotonic per `runId`, starting at `1`.
- `run_started` is first.
- `context_manifest_created` is the first durable event after `run_started` and must be emitted even if the provider call fails.
- Exactly one terminal event is emitted: `run_completed`, `run_failed`, or `run_canceled`.
- No events are emitted after a terminal event.
- Renderer replay must sort by `sequence`, not wall-clock time.

## Error Handling

### Provider Error Shape

Create a normalized app error:

```ts
type AgentErrorCode =
  | "missing_api_key"
  | "invalid_api_key"
  | "rate_limited"
  | "provider_unavailable"
  | "network_unreachable"
  | "dns_failure"
  | "request_timeout"
  | "request_canceled"
  | "model_not_found"
  | "malformed_provider_response"
  | "unknown";

interface AgentError {
  code: AgentErrorCode;
  userMessage: string;
  detail?: string;
  providerStatus?: number;
  retryable: boolean;
}
```

Electron main must normalize errors before they cross IPC. The renderer should receive a serializable `AgentError` or an `AgentRunResponse` containing one; it must not depend on raw `Error.message`, `TypeError`, or nested `cause` objects.

### DNS Failure Requirement

The reported error:

```text
TypeError: fetch failed
cause: getaddrinfo ENOTFOUND api.openai.com
```

should map to:

```text
Could not reach OpenAI. Check your internet or DNS connection and try again.
```

Developer diagnostics can log a sanitized code:

```text
agent:start-run failed OPENAI_DNS_FAILURE api.openai.com
```

Do not log:

- API keys,
- request body,
- full document text,
- model input payload.

### Other Required Mappings

- Missing key: `Add an OpenAI API key before asking the agent.`
- 401/403: `The OpenAI API key was rejected. Check the saved key.`
- 404 model: `The selected model was not found. Check the model name in settings.`
- 429: `OpenAI rate-limited this request. Try again shortly.`
- 5xx: `OpenAI is unavailable right now. Try again shortly.`
- timeout: `The request took too long. Try again.`
- canceled: `Canceled.`
- `ECONNREFUSED`, `ECONNRESET`, `EAI_AGAIN`, offline `TypeError: fetch failed`: `Could not reach OpenAI. Check your connection and try again.`
- `AbortError`: `Canceled.` if user initiated, otherwise `The request stopped before it completed. Try again.`
- malformed JSON or a non-OpenAI response body: `OpenAI returned an unexpected response. Try again.`

The renderer should show a compact error row with optional `Retry` when `retryable` is true.

## Storage

Local storage should live under Electron `app.getPath("userData")`, not in user Markdown folders.

Phase 1 reality: `AgentSettingsStore` currently writes `assistant/settings.json` under `userData`, and the OpenAI key is stored in local plaintext JSON unless it comes from `OPENAI_API_KEY`. The user has accepted this temporary local storage model. Later secure storage can move the key to the OS keychain without changing the context architecture.

Store:

- agent settings,
- conversations,
- run summaries,
- run manifests without large full-text payloads,
- proposal metadata,
- proposal content only while the proposal is pending or retained in conversation history.

Do not store:

- hidden chain-of-thought,
- provider request bodies containing full document text,
- API keys in conversation logs,
- child worker transcripts by default in v1.

Retention rules:

- `New Chat` clears the visible transcript for the current local conversation; once conversation history exists, it creates a new conversation and leaves old conversations available until manually cleared.
- Add a future `Clear agent history` control before long-term conversation persistence ships.
- Retain at most the latest 100 run manifests per workspace by default, or fewer if storage exceeds a later configurable cap.
- Persist manifests with relative paths and workspace labels, not absolute paths.
- Pending proposal content can be stored locally for review; discarded proposals should delete stored proposal content.

## Security And Privacy

- The user explicitly accepted local API-key storage for now. Keep it isolated in Electron main and do not expose it to renderer state.
- Workspace access is bounded by the open workspace root.
- No automatic whole-workspace upload.
- All file reads must be path validated.
- All writes remain user-approved.
- Context ledger must make it clear when content leaves the local machine for a model call.

## Implementation Plan

### Phase 1: Correct The UI Signal And Error Handling

Scope:

- Remove active file path from the agent header.
- Delete instructional subtitle copy from the top of the panel.
- Align typography with the left file panel and Iliad chrome.
- Replace current-file row with compact context chips inside the composer.
- Phase 1 chip semantics are deliberately limited:
  - current Markdown file chip means "this file's full text will be sent on the next message";
  - no active Markdown file means show only `Auto` or `Auto: no file`;
  - no `+`, manual attachments, file picker, `@file`, or context mode switching ships unless the control works.
- Fix composer layout and keyboard behavior:
  - `Enter` sends,
  - `Shift+Enter` newline,
  - `Cmd/Ctrl+Enter` sends,
  - send button remains anchored as text grows.
- Normalize provider/network errors, including DNS failures.

This phase can still send only the current file under the hood, but the UI must say this through a truthful context chip, not through the header.

### Phase 2: Add Run Context Manifest

Scope:

- Add `conversationId`.
- Build `RunContextManifest` before each request.
- Include current file, selected text if available, recent summary, and explicit exclusions.
- Render a compact per-run `Context` disclosure.
- Persist manifests without full input payloads.
- Add the first lightweight "content sent to model" disclosure even before tools or subagents.

### Phase 3: Attachments And Mentions

Scope:

- Add manual context chips.
- Support `@file` or file picker attachment.
- Add manual/auto/off context modes.
- Add file-size based excerpt/summary behavior.

### Phase 4: Workspace Read/Search Tools

Scope:

- Add read-only tools in Electron main.
- Emit tool events and manifest entries.
- Keep search off unless user explicitly asks or context policy allows it.

### Phase 5: Read-Only Subagents

Scope:

- Add supervisor-worker runtime for read-only research/critique/style tasks.
- Show child worker rows in the transcript work log.
- Keep child context isolated by default.
- Return summaries, proposal drafts, and references to parent.

## Acceptance Criteria

Phase 1:

- Agent header never shows the active document name or path.
- No persistent prose says "Ask about the active Markdown document or request a reviewable rewrite."
- Composer visually matches Iliad chrome typography and spacing.
- Empty state is compact and contains no explanatory paragraph.
- Context chips are inside the composer and match the actual Phase 1 provider payload.
- No decorative or nonfunctional `+` context control is visible.
- Send button remains aligned when the prompt wraps to multiple lines.
- `Enter` sends; `Shift+Enter` inserts a newline; `Cmd/Ctrl+Enter` sends.
- `ENOTFOUND api.openai.com` shows a user-friendly network/DNS message.
- No API key or document content is printed to logs.

Phase 2:

- Every run has a context manifest created before the provider call.
- The user can inspect what context was included for a completed run.
- Navigating to another file does not mutate old run context.
- Applying a new-document proposal can open the new file without rewriting prior context.
- Context truncation, summarization, and exclusions are visible.

Future phases:

- Tools only read workspace-safe paths.
- Proposal tools never write to disk directly.
- Subagents receive scoped context and limited tools.
- Parent conversation shows compact worker states such as `Waiting for Researcher`.

## Required Tests

Phase 1:

- Test harness decision: add a Node-compatible unit test runner before main-process unit tests ship. Vitest is the smallest fit for Vite/Electron TypeScript in this repo; until it exists, Phase 1 must document manual QA plus typecheck/build.
- React behavior test or manual QA for Enter/Shift+Enter/Cmd+Enter/Ctrl+Enter composer behavior.
- Manual QA for long prompt wrapping and send-button alignment.
- Unit test for error normalization:
  - DNS `ENOTFOUND`,
  - `ECONNREFUSED`,
  - `ECONNRESET`,
  - `ETIMEDOUT`,
  - missing key,
  - 401,
  - 429,
  - 5xx,
  - malformed provider response,
  - abort.
- Typecheck and build.

Phase 2:

- Vitest unit tests under `electron/agent/*.test.ts` or `src/**/*.test.ts`, with npm scripts added if the repo still has no test script.
- Unit tests for manifest assembly in auto/manual/off modes.
- Unit tests for file size/excerpt decisions.
- Unit tests for immutable manifest behavior after active file changes.
- Unit tests for event ordering and exactly-one-terminal-event behavior.
- Unit tests for IPC serialization of `AgentError`.
- UI QA for context disclosure at narrow panel width.

Future phases:

- Path-safety tests for read/search tools.
- Supervisor-worker tests proving child context is scoped.
- Event ordering tests for worker/tool lifecycle.

## Panel Selection For This Spec

This spec should be reviewed by:

- UI/UX reviewer: focus on minimalism, typography alignment, context chips, empty state, composer ergonomics, and avoiding explanatory clutter.
- Agent-runtime reviewer: focus on context manifests, tool boundaries, subagent scoping, event model, storage, and provider error handling.

The orchestrator should accept feedback that improves clarity, trust, safety, or minimal UI. Reject feedback that tries to build a full Antigravity-style manager in the first implementation pass.

## Expert Review Reconciliation

Review panel:

- UI/UX reviewer: reviewed minimal UI, typography, empty state, composer behavior, and context chip ergonomics.
- Agent-runtime reviewer: reviewed context manifests, provider errors, event ordering, tool permissions, subagent boundaries, storage, and tests.

Accepted feedback:

- Remove conversation history from the Phase 1 header target.
- Place context chips inside the composer and define Phase 1 chip semantics as current Markdown file only.
- Remove nonfunctional `+` controls from Phase 1.
- Define no-file chip behavior without returning `No file` to the header.
- Add empty-state acceptance criteria.
- Add concrete typography guidance from the file tree/sidebar.
- Require `Cmd/Ctrl+Enter` in acceptance criteria and tests.
- Strengthen run manifest metadata: model, provider response id, hash/version fields, policy version, timestamps, and redacted workspace root persistence.
- Require event sequencing, timestamps, terminal-state rules, and `run_canceled`.
- Require structured IPC-safe error normalization and expanded network/provider mappings.
- Add tool permission envelope, retention rules, and test harness decision.

Rejected or deferred feedback:

- Conversation history UI in Phase 1.
- Manual attachments, `@file`, folder scopes, or a functional context picker in Phase 1.
- Run ledger disclosures before the manifest exists.
- Read/search tools, subagents, or Antigravity-style manager UI in Phase 1.
- Auto summarization/excerpting in Phase 1 unless token limits force it.

## Open Questions

- Should `Auto` include the current file by default, or should a visible current-file chip always be required?
- Should conversations be scoped to one workspace root or to an Iliad project that may contain multiple folders later?
- Should selected text be included automatically even when context policy is `Manual`?
- How much run history should be persisted locally before compaction?

## Recommendation

Implement Phase 1 next. It addresses the user's visible pain immediately and corrects the product signal before deeper runtime work:

- header becomes context-neutral,
- composer becomes clean and native,
- context appears as compact chips,
- Enter sends correctly,
- network/DNS errors become understandable.

Then implement Phase 2 before adding workspace search or subagents. Without a run manifest, subagents will amplify the current ambiguity instead of solving it.
