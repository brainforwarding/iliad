# Assistant Experience Review Spec

Date: 2026-05-23
Status: research-and-review spec

## Why This Spec Exists

The current assistant v1 shipped the right safety boundary, but the first real use exposed two product gaps:

- The assistant UI does not feel clean, minimalistic, or native to Iliad. In the screenshot, the right pane is visually heavy, the header actions are not aligned with the title block, the current-file row duplicates the subtitle, the empty state floats as transcript text, the composer dominates the panel, and the send button is detached at the bottom.
- The assistant behavior is not yet aligned with the user's mental model. When asked to create a new document and "deploy an agent," v1 could only answer with text and a reviewable proposal. It did not have a real agent scheduler or file-creation tool at first, so the response looked like work had happened while no new file appeared.

The next iteration should make Iliad's assistant a **review-first Markdown collaborator**: quiet UI, explicit context, visible runtime work, honest capability boundaries, reviewable source edits, reviewable new documents, and a clear path toward bounded subagents.

All durable writing outputs remain Markdown documents. A rubric, handout,
facilitator guide, deck outline, checklist, or research annex should be created
and reviewed through the same Markdown proposal system as any other document.

This spec is informed by:

- Internal architecture: [`docs/agent-vision.md`](../docs/agent-vision.md), [`docs/agent-panel-v1-architecture.md`](../docs/agent-panel-v1-architecture.md), [`docs/source-as-contract.md`](../docs/source-as-contract.md)
- Current implementation: [`src/components/AssistantPanel.tsx`](../src/components/AssistantPanel.tsx), [`src/styles/assistant.css`](../src/styles/assistant.css), [`electron/agent/openaiResponses.ts`](../electron/agent/openaiResponses.ts)
- UI agent audit by Volta: visual/layout defects and CSS causes.
- Interaction agent audit by Socrates: review-first Markdown collaboration, context ledger, honest capability, and subagent constraints.
- External product references:
  - Cursor chat emphasizes current-file context, chat tabs/history, review diffs, and checkpoints: https://docs.cursor.com/chat/overview and https://docs.cursor.com/en/agent/chat/checkpoints
  - Claude Code subagents use fresh isolated context, foreground/background execution, summaries back to the main conversation, and are recommended for high-volume or parallel research tasks: https://code.claude.com/docs/en/sub-agents
  - Claude Code parallel-work docs distinguish subagents, agent view, agent teams, and worktrees; agent teams have shared task lists and inter-agent messaging, while subagents report back to the spawning conversation: https://code.claude.com/docs/en/agents and https://code.claude.com/docs/en/agent-teams
  - OpenAI Agents SDK positions agents as code-owned applications where the product owns orchestration, tool execution, approvals, state, tracing, and human review: https://developers.openai.com/api/docs/guides/agents
  - Google Antigravity uses artifacts/review policy so users approve plans or changes before execution: https://antigravity.google/docs/artifact-review and https://antigravity.google/docs/changes-sidebar
  - Empty-state guidance says empty states should explain the state, point to a clear next action, stay concise, and avoid taking over limited space: https://composedesign.ila.cegid.com/development/patterns/empty-state/

## Current Problems

### Visual/UI Problems

1. The assistant column is too dominant for a document-first writing app. `340px` makes it feel like a peer to the editor rather than a supporting utility.
2. The panel has too many persistent bands: header, current-file strip, settings, transcript, review drawer, and composer.
3. Header title/subtitle and icon actions are vertically mismatched.
4. `Current file` duplicates the subtitle and is visually heavier than its information value.
5. Empty state is just a transcript row, leaving a large blank panel with no useful structure.
6. The composer textarea is too tall by default and manually resizable.
7. The send button is visually detached because it sits in a separate grid column and aligns to the bottom of the textarea.
8. The palette stacks too many beige surfaces, borders, and cards for a minimal writing surface.

### Behavior Problems

1. The assistant can be asked to "deploy agents," but no real subagent runtime exists. The prompt should stay honest and the UI should never imply work happened unless runtime events exist.
2. The assistant can answer with a replacement proposal, but the user may expect a new file. New documents must be first-class Markdown proposals, not buried in prose.
3. No active-file state is visually confusing. The panel says `No Markdown file` but still offers a large document-focused composer.
4. Status rows are assistant transcript text, not runtime-derived work events.
5. There is no context ledger. Users cannot see exactly what was sent: full active doc, selection, attached files, summaries, or no context.
6. Chat history exists only in component state. `New Chat` clears local state without future history, titles, or warnings for unapplied proposals.

## Product Principle

Iliad's assistant should never make users infer what happened from prose. The runtime should produce structured facts:

- what context was sent,
- what tool or worker ran,
- what document proposals or outputs were produced,
- what needs review,
- what was applied,
- what failed,
- what is unsupported.

The transcript is for conversation. The work state is for evidence.

## UX Direction

### Layout

Replace the current heavy right pane with a quieter utility pane.

Target dimensions:

- Assistant width: `clamp(280px, 24vw, 320px)`.
- Header height: 40-44px.
- Composer default height: 40-48px, growing only as the user types, capped around 112px.
- Review drawer: only appears when a proposal exists; max 45vh.

Target structure:

```text
Assistant panel
  Header
    Assistant title
    Compact current context subtitle or chip
    New chat / settings / close icon buttons

  Transcript + Work Log
    Empty state or conversation turns
    Runtime work rows
    Proposal cards

  Pending review bar (only when proposals exist)

  Composer
    Context chips row when relevant
    Compact auto-growing input
    Inline send/stop button
```

Remove the standalone current-file strip unless it becomes an interactive context chip row. The header should show the active file path or `No file open` in a single subdued line.

### Empty State

The empty state should be compact and intentional.

No active file:

```text
No document open
Open a Markdown file, or ask for a new draft.
```

Active file:

```text
Ask about Draft.md or request a reviewed edit.
```

Do not use a large card. Do not let the empty text sit as a normal transcript message. Keep it near the upper transcript area or centered in the transcript column with a max width.

### Composer

The composer should feel like a command line for writing work, not a form field.

Requirements:

- One visual container around the input and send/stop button.
- Send/stop button inside the container, vertically centered.
- `textarea` starts at one or two lines.
- No manual resize handle.
- `Cmd/Ctrl+Enter` sends.
- Enter inserts newline unless the app later adds a user preference.
- Disabled state must explain why: no API key, request running, or no prompt.

### Context Ledger

Context must be visible as chips above or inside the composer:

- `Current file: Session 3.md`
- `Selection: 423 words`
- `Attached: rubric.md`
- `Workspace search: off`

Each chip must have an inclusion mode:

- full,
- excerpt,
- summary,
- reference-only.

If no active file is present, the composer placeholder should not say "Ask about this document." It should say "Ask or draft a new Markdown document..."

### Runtime Work Rows

Work rows are not assistant prose. They come from runtime events.

Examples:

- `Read Session 3.md`
- `Preparing new document draft`
- `Waiting for your review`
- `Canceled`
- `Could not create annex.md: file already exists`

Rows should be compact, subdued, and expandable only when there are details. They should use neutral verbs before the app has real subagents. Do not show "worker" or "subagent" labels in v1 unless the runtime actually creates a child job.

### Review Surface

Keep `Apply` out of the transcript card. Proposal cards expose:

- title,
- target file/path,
- kind: replacement or new document,
- `Review`,
- `Discard`.

The review surface exposes:

- unified Markdown diff for replacements,
- full Markdown preview/source for new documents,
- target path,
- stale-file or duplicate-file warnings,
- `Apply`,
- `Discard`.

Future review surface should support:

- hunk/paragraph-level accept and reject,
- comments,
- regenerate from review feedback,
- persistent `Review changes` bar when proposals are pending.

## Agent Runtime Direction

### Current V1 Runtime

V1 should remain honest:

- It can read only the visible active document sent by renderer.
- It can return assistant text.
- It can propose full-document replacements through `FULL_REPLACEMENT:`.
- It can propose new documents through `NEW_DOCUMENT:`.
- It cannot run browser, terminal, workspace search, MCP, or real subagents.

If asked to deploy agents now, the assistant should say it cannot actually deploy agents in Iliad yet, then offer a manual research-agent prompt or create a reviewable new document that explains the workflow.

### Required V2 Runtime

Move from one opaque request/response to an evented run model.

Internal event types:

```ts
type AssistantRunEvent =
  | { type: "run_started"; runId: string; prompt: string }
  | { type: "context_added"; label: string; path?: string; mode: "full" | "excerpt" | "summary" | "reference" }
  | { type: "task_started"; taskId: string; label: string; role?: string }
  | { type: "task_progress"; taskId: string; label: string }
  | { type: "task_completed"; taskId: string; summary?: string }
  | { type: "assistant_text"; text: string }
  | { type: "proposal_created"; proposalId: string; kind: "patch" | "new_document" }
  | { type: "waiting_for_review"; proposalIds: string[] }
  | { type: "run_failed"; message: string }
  | { type: "run_canceled"; runId: string };
```

The UI renders from events. The model's prose should not be the source of truth for status.

### Subagent Model

Do not implement "agents" as prompt theater. A subagent is a runtime child job with:

- `agentId`,
- role name,
- task contract,
- allowed context,
- allowed tools,
- model,
- budget,
- status,
- result output,
- error state,
- trace/log path.

Recommended first subagents:

- Reader: summarize explicitly attached or selected Markdown files.
- Researcher: gather source-backed evidence when research is explicitly enabled.
- Reviewer: review a proposed edit for alignment with user request and source contract.
- Style editor: infer style from active/attached Markdown documents and suggest constraints.

Initial permissions:

- read-only,
- active/attached Markdown only,
- no writes,
- no terminal,
- no browser,
- no non-Markdown artifact builders,
- no nested subagents.

The main assistant can synthesize subagent outputs into a Markdown proposal, but
every write remains review-first.

### Claude-Style Agent Management Lessons

There are public reports that Anthropic accidentally shipped Claude Code internal source through an npm/source-map packaging error in March 2026. Axios reports Anthropic said no customer data or credentials were exposed and described the issue as a release packaging mistake. Varonis and an arXiv architecture paper discuss high-level architecture patterns visible from public analysis: permission modes, context compaction, append-oriented session storage, plugin/tool extensibility, subagent delegation, and worktree isolation.

Iliad should not copy leaked source, leaked prompts, or proprietary implementation details. The useful, safe lessons are already visible in official docs and public architecture analysis:

- **Choose the parallelism mode intentionally.** Claude's public docs distinguish subagents, agent view, agent teams, and worktrees. For Iliad, start with subagents because they are simpler: child jobs work in isolated context and report summaries back to the main run.
- **Use teams only when workers must coordinate.** Claude agent teams use a lead plus teammates, shared task list, and inter-agent messaging. That is overkill for Iliad until simple read-only helpers are reliable.
- **Use draft isolation when edits can conflict.** For Iliad writing tasks, child agents should be read-only at first. If future agents draft independently, they need isolated draft proposals that the supervisor reconciles.
- **Keep permission modes product-specific.** Iliad does not need terminal permission modes. It needs document-native modes: read active doc, read attached docs, search visible workspace, propose patch, create new Markdown doc, and apply reviewed change through Iliad.
- **Make every child job observable.** A child agent needs status, tool traces, token/time budget, result output, cancellation, and error state. A UI row must correspond to a real runtime job.
- **Keep context isolated and summarized.** Subagents should not inherit the whole main transcript by default. They should receive a task contract, explicit context chips, and return concise evidence.
- **Prevent nested delegation in v1.** Claude docs note subagents are not a fit for every task and can add token/coordination overhead. Iliad should let only the supervisor spawn first-level read-only workers until the scheduler is proven.
- **Prefer append-only traces over hidden memory.** If run history is added, store safe trace metadata and proposal references in Electron app data. Do not silently write assistant memory into user Markdown.

Recommended Iliad agent management model:

```text
Supervisor run
  owns user-facing transcript
  owns context ledger
  starts read-only child jobs when useful
  waits for child summaries
  creates proposal
  pauses for user review before write

Child job
  fresh scoped context
  one task contract
  read-only document tools
  no nested subagents
  no writes
  returns evidence summary + citations/file refs
```

The main UI should expose this as neutral work rows, not as a managerial dashboard:

```text
Reading current document
Research helper checking attached sources
Reviewer checking proposed annex
Waiting for your review
```

### Subagent UI

Use task rows first, not a dashboard.

Example:

```text
Reading Session 3.md
Style editor checking tone
Reviewer checking proposed annex
Waiting for your review
```

Only when background/multiple concurrent runs are real should Iliad add a small "Runs" popover or rail. Avoid a large agent manager in this writing app until local review workflows are solid.

## Implementation Plan

### Phase 1: UI Fixes

- Reduce assistant width to `clamp(280px, 24vw, 320px)`.
- Remove standalone current-file strip.
- Fold active file into header subtitle and context chips.
- Replace transcript-seeded empty state with a real empty-state component.
- Rebuild composer as compact single container with inline send/stop.
- Remove manual textarea resize.
- Flatten surfaces and reduce separators.
- Add screenshot verification for desktop and narrow widths.

### Phase 2: Behavior Clarity

- Update placeholders for active-file and no-active-file states.
- Make unsupported capability responses explicit and short.
- Show no-active-file guidance and keep new-document drafting available.
- Add pending-proposal warning before `New Chat`.
- Add persistent pending review indicator.

### Phase 3: Evented Runs

- Replace implicit transcript status rows with runtime events.
- Stream or poll events from Electron main to renderer.
- Persist only safe run metadata locally if history is enabled.
- Add run cancellation and stale-response handling at event level.

### Phase 4: Context Attachments

- Add selection capture.
- Add `@` attach for visible Markdown files/headings.
- Add context chips with inclusion mode.
- Add user-visible token/content scope estimates.

### Phase 5: Real Subagents

- Add Electron-main scheduler.
- Add read-only child runs with isolated context.
- Add roles: Reader, Researcher, Reviewer, and Style editor.
- Emit child run status events.
- Summarize child outputs back to the main run.
- Keep writes only in proposal/apply path.

## Acceptance Criteria

### Visual

- Header icons align visually with the title/subtitle block.
- No-active-file state does not look like a broken chat.
- Composer is compact and send button is attached to the input.
- Assistant panel feels secondary to the editor.
- Empty state uses no large card and no heavy decoration.
- The panel has no incoherent overlapping, detached buttons, or excessive blank gaps at desktop and mobile widths.

### Behavioral

- Asking for a new doc produces a reviewable `New document ready` proposal when the model returns `NEW_DOCUMENT:`.
- Asking to deploy agents before the runtime exists gets an honest limitation response.
- No write occurs without an `Apply` click in the review surface.
- If a target file exists, new-document apply is blocked with a clear error.
- If active document content changes after a patch proposal, apply is blocked or requires regeneration.

### Research/Runtime

- Runtime status shown in UI must come from app events, not assistant prose.
- Every subagent-like UI row must correspond to a real child job when subagents ship.
- Child agents receive scoped context and cannot write files directly.
- The system has a trace/debug path for agent runs before enabling background work.

## Open Questions

- Should new documents created by the assistant land in the active file's folder by default, or the workspace root?
- Should context/history be stored per workspace in Electron app data, or should Iliad offer an optional visible `.iliad/assistant/` folder?
- Should the assistant support provider switching before or after evented runs?
- Should the first real subagents use OpenAI Agents SDK handoffs, or should Iliad implement a small local scheduler over Responses API first?

## Recommendation

Fix the panel UI before adding more autonomy. A messy agent UI makes every future capability feel less trustworthy. After the visual cleanup, build the evented runtime. Only then add real subagents, because the UI needs structured status and review proposals before parallel work is understandable.
