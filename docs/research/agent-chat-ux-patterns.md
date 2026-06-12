# Agent Chat UX Patterns

Research date: 2026-05-22

Status: research snapshot. For current product direction, use
[`../agent-vision.md`](../agent-vision.md) and
[`../agent-runtime-roadmap.md`](../agent-runtime-roadmap.md). Treat this as a
pattern library, not a commitment to a dashboard, status rail, or broad agent
manager.

Scope: agent chat panels and adjacent review surfaces in Cursor, Claude Code / Claude desktop and web where relevant, OpenAI Codex, and Google Antigravity-style multi-agent UI. The goal is to translate mature coding-agent patterns into a first Iliad assistant that respects Iliad's local-first Markdown contract.

## Executive Takeaways

Agent chat UX has converged on a few durable patterns:

- Keep chat threads task-scoped, resumable, renameable, and easy to reset. Cursor gives each chat tab separate context/history/model selection and auto-generates tab titles; Claude Code has `/clear`, `/resume`, `/branch`, `/rename`, and `/compact`; Codex exposes fresh-chat and diff/status commands; Antigravity has conversation creation and a picker.
- Make context explicit at the composer. The common pattern is `@` references for files/folders, selected text, docs, web, past chats, and tool resources, plus visible chips showing what will be sent.
- Treat tool calls as progress, not chat prose. Cursor, Codex, Claude Code, and Antigravity all surface reads, edits, terminal/browser work, task lists, or artifacts as structured rows/panels.
- Separate "agent worked" from "user accepted." Mature tools provide diffs, review panes, artifact approval, checkpoints, or permission modes. The best UX makes review state visible and reversible.
- For longer tasks, a status rail matters more than the transcript. Antigravity's artifacts/task lists and Claude Code's background tasks/subagent rows show that users need a quick "what is running, blocked, waiting, or done" view without reading every message.

For Iliad v1, the right adaptation is a narrow writing assistant side panel: one active thread, explicit Markdown file/context chips, visible tool/status rows, and reviewable Markdown patches. Avoid multi-agent dashboards and background cloud delegation until local editing, saves, and review semantics are proven.

## Pattern Matrix

| Pattern | Cursor | Claude Code / Claude | Codex | Antigravity | Iliad v1 recommendation |
| --- | --- | --- | --- | --- | --- |
| Chat history | Chat history and export are first-class in Agent overview; chat tabs keep separate context/history/model selection. [Cursor overview](https://docs.cursor.com/chat/overview), [Cursor tabs](https://docs.cursor.com/agent/chats) | `/resume` reopens previous sessions; `/clear` starts a new empty context while preserving old conversation in the resume picker. [Claude commands](https://code.claude.com/docs/en/commands) | Codex cloud tasks persist in the cloud; CLI/IDE sessions expose reset, diff, and status-style commands in docs and product updates. [Codex cloud](https://developers.openai.com/codex/cloud), [Codex update](https://openai.com/index/introducing-upgrades-to-codex/) | Conversation picker and new conversation shortcuts are documented in Antigravity getting started. [Antigravity getting started](https://antigravity.google/docs/task-groups) | Store local thread metadata per workspace in app state, not Markdown files. Show a simple "Recent assistant chats" popover later; v1 can keep one current thread plus explicit New Chat. |
| New chat / reset | `Ctrl+T` creates a fresh chat tab; each tab has its own context. [Cursor tabs](https://docs.cursor.com/agent/chats) | `/clear [name]` starts a new conversation; previous conversation remains resumable. [Claude commands](https://code.claude.com/docs/en/commands) | Codex docs and changelog describe resetting UI/conversation with slash commands; cloud tasks are separate delegations. [Codex CLI](https://developers.openai.com/codex/cli) | `Cmd/Ctrl+N` creates a new conversation. [Antigravity getting started](https://antigravity.google/docs/task-groups) | Put a `New Chat` icon button in the assistant header. Warn only if there are unapplied reviewed changes. |
| Thread titles | Cursor auto-generates tab titles and supports rename. [Cursor tabs](https://docs.cursor.com/agent/chats) | Claude Code supports `/rename`; `/clear [name]` labels previous conversation. [Claude commands](https://code.claude.com/docs/en/commands) | Codex product docs include app/web/IDE task surfaces; OpenAI's update emphasizes moving work across local/cloud with context. [Codex update](https://openai.com/index/introducing-upgrades-to-codex/) | Antigravity conversations are project-scoped. [Antigravity overview](https://antigravity.google/docs/overview) | Auto-title after first user prompt; allow inline rename in a history popover. Use document title plus intent, e.g. `Revise intro - Essay.md`. |
| Model picker | Cursor keeps model selection per tab. [Cursor tabs](https://docs.cursor.com/agent/chats) | Claude Code has `/model`, an interactive picker, and mode selectors in VS Code/Desktop/web. [Claude commands](https://code.claude.com/docs/en/commands), [permission modes](https://code.claude.com/docs/en/permission-modes) | OpenAI's Codex update says GPT-5-Codex is default for cloud/code review and selectable locally via CLI/IDE. [Codex update](https://openai.com/index/introducing-upgrades-to-codex/) | Antigravity supports orchestrated agents and modes; setup modal chooses local/worktree mode. [Antigravity getting started](https://antigravity.google/docs/task-groups) | Hide model choice behind a compact menu in v1. Default to "Balanced"; expose "Fast" and "Careful" only if the backend actually differs. |
| Context attachments | Cursor supports `@Files`, `@Folders`, `@Docs`, `@Git`, `@Past Chats`, `@Web`, `# Files`, and drag/drop file context. [Cursor @ overview](https://docs.cursor.com/en/context/%40-symbols/overview), [Cursor files/folders](https://docs.cursor.com/context/%40-symbols/%40-files-and-folders) | Claude Code IDE uses `@` file/folder mentions, selected-code awareness, and line-specific references such as `@app.ts#5-10`. [Claude IDE integration](https://code.claude.com/docs/en/ide-integrations) | Codex update highlights screenshots/wireframes/diagrams as attachable context in CLI and cloud. [Codex update](https://openai.com/index/introducing-upgrades-to-codex/) | Antigravity projects define folder/repo access boundaries; artifacts communicate plans, diffs, screenshots, browser recordings. [Antigravity artifacts](https://antigravity.google/docs/artifacts) | Use context chips above the input: `Current file`, `Selection`, `Linked files`, `Folder summary`. Support `@` search for Markdown files and headings, not arbitrary hidden files. |
| File references in replies | Cursor previews file paths and uses file/folder condensation for large context. [Cursor files/folders](https://docs.cursor.com/context/%40-symbols/%40-files-and-folders) | Claude Code can include file paths and selected line ranges in mentions. [Claude IDE integration](https://code.claude.com/docs/en/ide-integrations) | Codex provides citations, terminal logs, and test results per task according to OpenAI's update. [Codex update](https://openai.com/index/introducing-upgrades-to-codex/) | Antigravity code diffs and review panes are commentable artifacts. [Antigravity review changes](https://www.antigravity.google/docs/review-changes-editor) | Render file references as clickable local chips: `Draft.md`, `Draft.md#Heading`, `assets/draft/image.png`. Never inject hidden metadata into Markdown. |
| Tool-call disclosure | Cursor lists tools for search/read/edit/run/MCP and lets custom modes enable/disable them. [Cursor tools](https://docs.cursor.com/agent/tools) | Claude Code commands, `/tasks`, background sessions, subagent rows, and status line customization make tool/task state visible. [Claude commands](https://code.claude.com/docs/en/commands), [Claude status line](https://code.claude.com/docs/en/statusline) | OpenAI says Codex CLI upgraded tool calls and diffs to be "better formatted and easier to follow." [Codex update](https://openai.com/index/introducing-upgrades-to-codex/) | Antigravity artifacts exist so users do not have to monitor every synchronous agent step. [Antigravity artifacts](https://antigravity.google/docs/artifacts) | Show collapsed tool rows inside the assistant transcript: `Read Draft.md`, `Search workspace`, `Prepare patch`, `Apply patch`. Default collapsed; expand for details/errors. |
| Background task status | Cursor background agents are asynchronous, searchable in a sidebar, status-viewable, follow-up-able, and take-over-able. [Cursor background agents](https://docs.cursor.com/en/background-agents) | Claude Code supports `/background`, `/tasks`, background subagents, and `/stop`. [Claude commands](https://code.claude.com/docs/en/commands), [Claude subagents](https://code.claude.com/docs/en/sub-agents) | Codex cloud works in the background and in parallel, with IDE tracking of in-progress and completed work. [Codex cloud](https://developers.openai.com/codex/cloud), [Codex update](https://openai.com/index/introducing-upgrades-to-codex/) | Antigravity 2.0 is a central command center to launch, monitor, and orchestrate agents synchronously/asynchronously. [Antigravity overview](https://antigravity.google/docs/overview) | V1 should not run unattended background writes. Allow cancellable foreground tasks only. If a long read/search runs, show a sticky status row at the bottom of the panel. |
| Sub-agent status rows | Cursor increasingly supports background/async agents, but the main public docs frame this as background agents rather than inline subagent rows. [Cursor background agents](https://docs.cursor.com/en/background-agents) | Claude Code explicitly supports foreground/background subagents and customizable subagent status rows below the prompt. [Claude subagents](https://code.claude.com/docs/en/sub-agents), [Claude status line](https://code.claude.com/docs/en/statusline) | Codex product docs navigation includes subagents and workflows; public update emphasizes to-do progress for complex work. [Codex update](https://openai.com/index/introducing-upgrades-to-codex/) | Antigravity's Agent Manager/2.0 is explicitly multi-agent and artifact-oriented. [Antigravity overview](https://antigravity.google/docs/overview) | Do not expose "sub-agents" in v1. Use neutral task rows: `Reading`, `Planning`, `Drafting`, `Reviewing`. This keeps the UI understandable for writers. |
| Review/apply changes | Cursor has Apply Changes, Review Diffs, and Checkpoints for agent changes. [Cursor overview](https://docs.cursor.com/chat/overview), [Cursor checkpoints](https://docs.cursor.com/en/agent/chat/checkpoints) | Claude Code has `/diff`, per-turn diffs, plan approval options, and rewind/checkpoint commands. [Claude commands](https://code.claude.com/docs/en/commands), [Claude permission modes](https://code.claude.com/docs/en/permission-modes) | Codex CLI/product emphasizes formatted diffs, review before commit, and code review. [Codex update](https://openai.com/index/introducing-upgrades-to-codex/) | Antigravity has `Review Changes` in the agent panel bottom toolbar, with commentable file diffs. [Antigravity review changes](https://www.antigravity.google/docs/review-changes-editor) | Add a review drawer before any file write: unified Markdown diff, affected files, `Apply`, `Apply selected`, `Discard`. For prose, support sentence/paragraph-level accept/reject. |
| Approvals | Cursor foreground Agent can require confirmation for terminal commands; background agents auto-run terminal commands and document the security tradeoff. [Cursor overview](https://docs.cursor.com/chat/overview), [Cursor background agents](https://docs.cursor.com/en/background-agents) | Claude permission modes control when edits/commands/network requests pause for approval; plan mode researches and proposes without editing. [Claude permission modes](https://code.claude.com/docs/en/permission-modes) | Codex approval modes are simplified to read-only, auto with workspace access, and full access; Codex asks permission before dangerous actions. [Codex update](https://openai.com/index/introducing-upgrades-to-codex/) | Antigravity Planning Mode can require explicit artifact review before changes; Fast Mode executes directly. [Antigravity artifact review](https://antigravity.google/docs/artifact-review) | Default mode: "Suggest only." A visible per-thread toggle can enable "Apply after review." No silent writes in v1. |
| Errors | Cursor docs call out terminal output issues and use `Skip` to interrupt commands. [Cursor terminal](https://docs.cursor.com/agent/terminal) | Claude commands include `/doctor`, `/debug`, `/feedback`, and permission denial/error flows. [Claude commands](https://code.claude.com/docs/en/commands) | OpenAI's Codex changelog notes improved error messages for task starts, setup scripts, PR pushing, and GitHub disconnects. [Codex changelog](https://help.openai.com/en/articles/11428266-codex-changelog/) | Antigravity artifacts/review policy create checkpoints where failures can be corrected with feedback. [Antigravity artifacts](https://antigravity.google/docs/artifacts) | Error rows should be actionable: title, affected file/tool, retry button if safe, "show details", and no auto-dismiss. Save failures must block applying changes. |
| Cancellation | Cursor terminal has `Skip` to send `Ctrl+C` and interrupt commands. [Cursor terminal](https://docs.cursor.com/agent/terminal) | Claude has `/stop` for background sessions and `Ctrl+C` cancellation in help/cheatsheet material; background tasks can be managed with `/tasks`. [Claude commands](https://code.claude.com/docs/en/commands) | Codex CLI docs expose slash commands and OpenAI's product docs mention background/cloud work tracking; cancellation should be mirrored in any client surface. [Codex CLI](https://developers.openai.com/codex/cli) | Antigravity's manager model implies run monitoring/control; planning review can halt before execution. [Antigravity artifact review](https://antigravity.google/docs/artifact-review) | Put a stop button in the composer while running. Cancellation should stop new tool calls, leave current document unchanged unless the user already applied a reviewed patch, and keep a transcript row `Canceled by user`. |

## Product Notes by System

### Cursor

Cursor is the clearest IDE-side reference for a compact agent panel. Its Agent sidepane combines modes, tools, apply/review, checkpoints, terminal integration, chat history, and export in one workflow. The important design lesson is that separate task containers matter: chat tabs maintain their own context, history, and model selection, and conflicts are prevented when multiple tabs would edit the same files. Cursor's `@` context system is also mature: files, folders, code, docs, git, past chats, web, recent changes, lint errors, and file chips are all discoverable through one mention grammar.

For Iliad, copy the composer's explicit context model and review-before-apply flow, not the multi-tab/code-editing breadth. Writers need to know which Markdown file and selection are in context more than they need free-form project-wide code search.

### Claude Code / Claude Desktop and Web

Claude Code is strongest on commandable session control and permission ergonomics. Commands cover model, effort, plan mode, context visualization, compaction, resume, branch/fork, rename, diff, review, rewind, background, tasks, status, and diagnostics. Permission modes are particularly relevant: default approval, accept-edits, plan, auto, deny-by-default, and bypass create a vocabulary for how much autonomy the user is granting. Claude's IDE integration also shows a good file-reference interaction: `@` mentions with fuzzy matching and selected line ranges.

Claude desktop/web artifacts matter less for Iliad's v1 chat panel, but they validate the split-pane pattern: generated content lives beside the conversation, has versions, and can be edited or reused. Iliad should use this idea for reviewable Markdown changes, with the on-disk Markdown file remaining the source of truth.

### OpenAI Codex

Codex is useful as a reference for cross-surface continuity and task evidence. OpenAI describes Codex cloud as a coding agent that can work in background and parallel in cloud environments, while the IDE extension can create cloud tasks, track in-progress work, review completed work, and open tasks locally with context preserved. OpenAI also highlights better formatted tool calls/diffs, progress to-do lists for complex work, attachable screenshots/wireframes/diagrams, citations, terminal logs, and test results.

For Iliad, the durable pattern is "evidence travels with the task": when the assistant proposes a rewrite, show what it read, what it changed, and why the user should trust it. Do not import cloud delegation or heavy code-review language into a local writing app yet.

### Google Antigravity

Antigravity pushes the agent UI furthest away from linear chat. Artifacts are the central trust object: task lists, implementation plans, diffs, diagrams, screenshots, recordings, and test reports communicate asynchronous work without making users monitor every step. Planning Mode and Artifact Review Policy establish a clear gate: request review and halt, or always proceed. `Review Changes` is a persistent bottom-toolbar affordance once code changes exist, and diffs are commentable.

For Iliad, this suggests a lightweight artifact lane: task list/status rows and a review drawer for proposed document changes. A full agent manager would be premature, but a stable "Assistant is planning / drafting / waiting for review" surface is valuable.

## Iliad V1 Screen Recommendation

Add a right assistant panel that can be hidden. Keep the existing file tree and editor unchanged.

Panel structure:

- Header: thread title, `New Chat`, compact model/mode menu, close button.
- Context strip: chips for `Current file`, `Selection`, and user-added Markdown files/headings. Chips have remove buttons and tooltips with full relative path.
- Transcript: user messages, assistant messages, collapsed tool rows, error rows, and patch proposal cards.
- Running status row: sticky above composer while active, showing current phase and a stop button.
- Composer: multiline input, `@` mention trigger, attach-current-selection button, submit/stop button.
- Review drawer: opens from a proposal card or persistent `Review changes` button when pending patches exist.

Recommended visual hierarchy:

- Use subdued rows for tools: icon, verb, target, status, disclosure chevron.
- Use stronger treatment only for user decisions: approval prompts, pending patch cards, errors.
- Keep technical labels plain: `Read`, `Search`, `Draft`, `Review`, `Apply`. Avoid "agent team", "subagent", "sandbox", or "worktree" in v1 UI.

## Iliad V1 Components

### `AssistantPanel`

Owns the panel layout, active thread state, and hidden/visible state. It should not write files directly; it requests review/apply actions through existing save/file IPC boundaries.

### `AssistantHeader`

Shows:

- Editable generated title.
- `New Chat`.
- Mode menu: `Suggest`, `Review before apply`.
- Optional model menu if the backend supports real options.

### `ContextChips`

Initial chips:

- `Current file`: active Markdown file.
- `Selection`: only when editor selection is non-empty.
- `Linked file`: files manually added through `@`.

Rules:

- Show relative paths.
- Resolve and validate paths through existing workspace/path safety.
- Never include ignored/hidden paths.
- For large Markdown files, show `summarized` or `partial` state if the backend condenses context.

### `AssistantTranscript`

Message types:

- `user_message`
- `assistant_message`
- `tool_row`
- `patch_proposal`
- `approval_prompt`
- `error_row`
- `canceled_row`

Tool rows should be collapsible. Expanded details can show read paths, search query, elapsed time, and compact output.

### `PatchProposalCard`

Shows:

- Summary sentence.
- Affected files.
- Counts: added/removed paragraphs or lines.
- Buttons: `Review`, `Discard`.

Do not apply directly from the card in v1; force the review drawer.

### `ReviewChangesDrawer`

Shows:

- Unified diff for Markdown text.
- File-by-file navigation if multiple files are changed.
- Paragraph-level accept/reject where practical.
- Buttons: `Apply selected`, `Apply all`, `Discard`.

Behavior:

- Flush pending autosave before applying.
- If save/apply fails, block navigation and keep the error visible.
- After apply, add transcript row with what changed and keep the diff accessible until new chat.

### `ApprovalPrompt`

V1 approval prompts:

- `Read additional file?`
- `Search workspace?`
- `Prepare patch?`
- `Apply reviewed changes?`

Do not ask for approval to read the current active document; the user made that context visible. Do ask before reading additional files if not explicitly attached.

### `AssistantStatusRow`

States:

- `idle`
- `reading`
- `planning`
- `drafting`
- `waiting_for_review`
- `applying`
- `error`
- `canceled`

This borrows Claude's subagent/status-line clarity without exposing subagent terminology.

## Interaction Flows

### Ask About Current Document

1. User opens assistant with `Draft.md` active.
2. Context strip shows `Current file: Draft.md`.
3. User asks a question.
4. Assistant may show `Read Draft.md` row, then answers.
5. No patch card appears unless changes are proposed.

### Revise Selection

1. User selects text in the editor.
2. Context strip shows `Selection: 3 paragraphs`.
3. User asks "tighten this".
4. Assistant produces a `PatchProposalCard`.
5. User reviews diff and applies selected paragraphs.
6. Existing autosave pipeline persists the Markdown file.

### Workspace-Aware Rewrite

1. User types `@Style Guide.md` and asks for consistency.
2. Context strip shows both current file and style guide.
3. Assistant shows `Read Style Guide.md` and `Read Draft.md`.
4. If it needs another file, it asks before reading.
5. Changes are proposed in review drawer.

### Error and Cancellation

1. User starts a long rewrite.
2. Status row shows `Drafting...` and a stop button.
3. User clicks stop.
4. Tool execution stops; transcript gets `Canceled by user`.
5. Any unapplied proposal remains reviewable; no hidden file write occurs.

## Decisions for Iliad

- Build local, foreground, review-first assistant UX before background tasks.
- Keep the assistant's memory outside Markdown documents.
- Make every file read and proposed write visible.
- Preserve Iliad's existing save model: no navigation or file action should proceed after a failed save.
- Use "review changes" as the central trust surface, not raw chat prose.
- Delay chat history browser, multi-thread tabs, subagents, and cloud background tasks until v2+.

## Source Index

- Cursor Agent overview: https://docs.cursor.com/chat/overview
- Cursor chat tabs: https://docs.cursor.com/agent/chats
- Cursor context `@` symbols: https://docs.cursor.com/en/context/%40-symbols/overview
- Cursor files/folders context: https://docs.cursor.com/context/%40-symbols/%40-files-and-folders
- Cursor tools: https://docs.cursor.com/agent/tools
- Cursor terminal: https://docs.cursor.com/agent/terminal
- Cursor background agents: https://docs.cursor.com/en/background-agents
- Cursor checkpoints: https://docs.cursor.com/en/agent/chat/checkpoints
- Claude Code commands: https://code.claude.com/docs/en/commands
- Claude Code permission modes: https://code.claude.com/docs/en/permission-modes
- Claude Code IDE integration: https://code.claude.com/docs/en/ide-integrations
- Claude Code subagents: https://code.claude.com/docs/en/sub-agents
- Claude Code status line: https://code.claude.com/docs/en/statusline
- Claude artifacts help: https://support.claude.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them
- Codex cloud docs: https://developers.openai.com/codex/cloud
- Codex CLI docs: https://developers.openai.com/codex/cli
- OpenAI Codex product update: https://openai.com/index/introducing-upgrades-to-codex/
- Codex changelog: https://help.openai.com/en/articles/11428266-codex-changelog/
- Google Antigravity overview: https://antigravity.google/docs/overview
- Google Antigravity artifacts: https://antigravity.google/docs/artifacts
- Google Antigravity artifact review: https://antigravity.google/docs/artifact-review
- Google Antigravity review changes: https://www.antigravity.google/docs/review-changes-editor
- Google Antigravity task list: https://antigravity.google/docs/task-list
- Google Antigravity getting started / conversations: https://antigravity.google/docs/task-groups
