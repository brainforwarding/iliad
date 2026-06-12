# Agentic Architecture Survey

Research date: 2026-05-22

Status: research snapshot. For current product direction and the Markdown-first
agent boundary, use [`../agent-vision.md`](../agent-vision.md) and
[`../agent-runtime-roadmap.md`](../agent-runtime-roadmap.md). This survey
records useful patterns from agent systems, not Iliad's full tool roadmap.

This survey looks at current coding/chat agents through the lens of Iliad: a local-first Markdown editor whose on-disk `.md` file is the product contract. The goal is not to copy an IDE coding agent, but to extract reusable architecture patterns for a future document-aware assistant that can read, reason over, and safely edit Markdown workspaces.

## Executive Summary

Modern coding agents are converging on the same harness shape:

1. A model-driven loop alternates between reasoning, tool calls, observation, and continuation.
2. Tools are narrow capabilities, not ambient access: read file, search, edit, terminal, browser, MCP/app calls, ask user, update plan.
3. Permissions are policy layers around tool execution: read-only modes, workspace-write modes, command/network allowlists, approval prompts, and high-risk bypass modes.
4. Persistent context is split between conversation state, project instructions, memories/rules, and machine/workspace state.
5. Long-running work is usually a resumable job: local session, cloud VM, GitHub Actions environment, sandbox workspace, or background agent with status/events.
6. Serious products expose traces or logs of model calls, tool calls, approvals, outputs, and errors so agent behavior is inspectable.

For Iliad v1, the useful center is a conservative local agent that reads Markdown, proposes Markdown diffs, applies only approved edits, and logs every action. Terminal execution, remote background agents, browser/computer-use, and autonomous memory can wait.

## Common Architecture

### Agent loop

The canonical loop is:

```text
user turn
  -> assemble context and instructions
  -> call model
  -> inspect output
  -> execute approved tool calls
  -> append observations
  -> repeat until final answer, approval pause, error, or budget stop
```

OpenAI's Agents SDK describes one run as an application-level turn where the runner calls the model, executes tool calls, follows handoffs, and returns once there is a final answer with no more tool work. It also separates continuation strategies: local replay history, SDK sessions, OpenAI conversation IDs, or previous response IDs. Source: [OpenAI Agents SDK, Running agents](https://developers.openai.com/api/docs/guides/agents/running-agents).

Claude Code describes the same operational shape as context gathering, action, verification, and repetition. Its built-in tools include file operations, search, shell execution, web access, code intelligence, subagents, and user questions. Source: [Claude Code, How Claude Code works](https://code.claude.com/docs/en/how-claude-code-works).

Cursor's Agent mode similarly allows autonomous exploration, multi-file edits, commands, and error fixing; Ask mode is read-only; Manual mode is targeted editing. Source: [Cursor, Modes](https://docs.cursor.com/agent).

Implementation pattern for Iliad: treat every assistant interaction as a turn with a bounded tool loop, not as a single completion. The renderer should never give the model direct filesystem access; the main process should expose typed document/workspace tools.

### Planning

Planning exists in three forms:

- In-model implicit planning: the model decides next tool calls from observations.
- Visible todo/plan state: Claude Code and Windsurf show task lists or plans during longer work.
- Dedicated planning mode/agent: Cursor has mode-level tool differences; Windsurf says a specialized planning agent continuously refines a long-term plan while the selected model handles short-term actions. Source: [Windsurf Cascade overview](https://docs.windsurf.com/windsurf/cascade/cascade).

For Iliad, planning should be visible but lightweight: `draft -> proposed edits -> review -> apply`. A visible checklist is useful only for multi-document operations such as "standardize headings across this folder" or "turn these notes into an outline."

### Tool calls

Common tool families:

- Read/search: file reads, directory listing, grep/semantic codebase search, web search.
- Edit: apply patch, structured file edits, create/delete/rename files.
- Execute: terminal commands, tests, package installs, app previews.
- External integration: MCP servers, GitHub/Linear/Slack/database connectors.
- Human interaction: ask a question, request approval, continue after interruption.
- State: update todo list, write memory, emit trace/span.

Cursor documents explicit tool categories for search, edit, run, and MCP, with no hard limit on Agent tool calls during a task. Source: [Cursor, Tools](https://docs.cursor.com/agent/tools).

The OpenAI Agents SDK has first-class tool calls, handoffs, guardrails, and resumable interruptions. Source: [OpenAI Agents SDK overview](https://developers.openai.com/api/docs/guides/agents).

Aider shows a simpler, useful contrasting model: it builds context using a repository map, asks the model for edits in constrained formats such as whole-file, search/replace, or unified diff, then applies them to files. Sources: [Aider repository map](https://aider.chat/docs/repomap.html), [Aider edit formats](https://aider.chat/docs/more/edit-formats.html).

For Iliad, the first tool surface should be small:

- `listWorkspaceMarkdown`
- `readMarkdown`
- `searchMarkdown`
- `proposeMarkdownPatch`
- `applyApprovedPatch`
- `insertAtSelection`
- `askUser`

Avoid terminal and generic filesystem tools in v1. Markdown edit tools should operate on source text, not DOM mutations, so the assistant remains aligned with `source-as-contract.md`.

### Filesystem and app integration

Coding agents usually run against a workspace root and add guardrails around file access:

- Claude Code can access the current directory and subdirectories, plus other files with permission, and stores session data under `~/.claude/projects/`. Source: [Claude Code, How Claude Code works](https://code.claude.com/docs/en/how-claude-code-works).
- Codex uses sandboxing for commands across app, IDE, and CLI. The sandbox defines where commands can read/write and whether network is available; approvals handle attempts to cross those boundaries. Source: [Codex sandboxing](https://developers.openai.com/codex/concepts/sandboxing).
- Cursor background agents clone GitHub repositories into isolated Ubuntu-based remote machines, use `.cursor/environment.json` for install/start/terminal setup, and push changes on separate branches. Source: [Cursor background agents](https://docs.cursor.com/background-agents).
- GitHub Copilot cloud agent works in a GitHub Actions-powered ephemeral development environment where it can explore code, change files, run tests/linters, and prepare branches or pull requests. Source: [GitHub Copilot cloud agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent).

For Iliad, the app integration boundary is already clear: Electron main owns filesystem operations and path safety; renderer owns the editor. An assistant should call through the same IPC-backed file safety layer used by the UI, and it should never mutate hidden app state to make a Markdown change.

### Approvals and permissions

Approval systems are now a core architectural component, not a UI afterthought.

Codex separates sandbox boundaries from approval policy. Permission profiles include `:read-only`, `:workspace`, and `:danger-full-access`, with configurable filesystem and network rules. Source: [Codex permissions](https://developers.openai.com/codex/permissions). Its app-server protocol also exposes client-side approval requests for command execution and file changes, with decisions such as accept, accept for session, decline, or cancel. Source: [Codex App Server](https://developers.openai.com/codex/app-server).

Claude Agent SDK evaluates permissions in order: hooks, deny rules, permission mode, allow rules, and then a runtime `canUseTool` callback. Modes include read-only plan mode, edit-accepting mode, don't-ask mode, and bypass mode. Source: [Claude Agent SDK permissions](https://code.claude.com/docs/en/agent-sdk/permissions).

OpenAI Agents SDK human review pauses a run before sensitive tool calls; the result contains interruptions and resumable state, and the same run continues after approval/rejection. Source: [OpenAI Agents SDK guardrails and human review](https://developers.openai.com/api/docs/guides/agents/guardrails-approvals).

For Iliad, approvals should be document-native:

- Auto-allow reads inside the selected workspace.
- Auto-allow draft/proposal creation in memory.
- Require review for any file write.
- Require explicit confirmation for multi-file edits, file create/delete/rename, or edits outside the active document.
- Present source diffs before applying.
- Never have a "full access" mode in v1.

### State and memory

Agent state has distinct layers:

- Conversation/session state: messages, tool calls, observations, pending approvals.
- Project instructions: checked-in files such as `AGENTS.md`, `.cursor/rules`, `.windsurf/rules`, or `.github/copilot-instructions.md`.
- Memory: model- or sidecar-generated facts reused across sessions.
- Workspace/machine state: files, git branch, open terminals, running servers, snapshots.

Codex discovers `AGENTS.md` by layering global and project files from root toward the current directory, with closer files overriding earlier guidance. Source: [Codex AGENTS.md](https://developers.openai.com/codex/guides/agents-md).

Cursor uses project rules in `.cursor/rules`, user rules, root `AGENTS.md`, and generated memories. Memories are project-scoped and can be generated by a sidecar model, but require user approval before saving. Sources: [Cursor rules](https://docs.cursor.com/en/context), [Cursor memories](https://docs.cursor.com/en/context/memories).

Windsurf stores autogenerated memories locally under `~/.codeium/windsurf/memories/`, and recommends durable team knowledge live in rules or `AGENTS.md` instead. Source: [Windsurf memories and rules](https://docs.windsurf.com/windsurf/cascade/memories).

OpenAI Agents SDK result objects expose `finalOutput`, replay-ready `history`, `lastAgent`, `lastResponseId`, pending `interruptions`, and resumable `state`. Source: [OpenAI Agents SDK results and state](https://developers.openai.com/api/docs/guides/agents/results).

For Iliad, persistent memory should not be automatic in v1. Use:

- conversation state for the current chat,
- workspace-local assistant settings only when explicitly created,
- no hidden interpretation state for documents,
- optional future `AGENTS.md` or `ILIAD.md` support only as instructions, not document metadata.

### Traces and observability

Production-grade agents expose traces because tool-using systems are otherwise hard to debug.

OpenAI Agents SDK tracing is enabled by default in normal server-side SDK usage and records model calls, tool calls, handoffs, guardrails, and custom spans. Source: [OpenAI Agents SDK integrations and observability](https://developers.openai.com/api/docs/guides/agents/integrations-observability).

Claude Code stores conversation messages, tool uses, and results in plaintext JSONL files under `~/.claude/projects/`, enabling resume/fork workflows and auditability. Source: [Claude Code, sessions](https://code.claude.com/docs/en/how-claude-code-works).

Codex supports lifecycle hooks that can log prompts, block leaked secrets, summarize conversations, or validate stop conditions. Hooks run at events such as `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `UserPromptSubmit`, and `Stop`. Source: [Codex hooks](https://developers.openai.com/codex/hooks).

For Iliad, trace data can be simple:

- user prompt,
- model-visible document IDs and byte ranges,
- tool call name/args,
- approval decision,
- before/after patch,
- failure reason,
- token/cost metadata if available.

Store traces outside Markdown documents. Traces are app/session diagnostics, not source content.

### Background tasks

Background agents usually introduce separate execution environments and stronger audit needs.

Cursor background agents are remote asynchronous agents with status, follow-ups, takeover, remote machines, GitHub branches, install/start commands, terminal processes, and auto-run terminal behavior. Cursor notes that foreground agents require approval for every command, while background agents auto-run terminal commands, which increases prompt-injection and exfiltration risk. Source: [Cursor background agents](https://docs.cursor.com/background-agents).

GitHub Copilot cloud agent is a background worker backed by GitHub Actions that researches, plans, changes files, runs tests, pushes commits, and optionally opens PRs; GitHub emphasizes branch/commit/PR transparency. Source: [GitHub Copilot cloud agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent).

OpenAI sandbox agents provide container-like environments with filesystem, shell, packages, mounted data, ports, snapshots, and resumable state. Use cases include artifact generation, previews, commands, and paused human review. Source: [OpenAI Sandbox Agents](https://developers.openai.com/api/docs/guides/agents/sandboxes).

Codex non-interactive mode uses `codex exec` for scripts and CI, with explicit sandbox and approval settings and resumable sessions. Source: [Codex non-interactive mode](https://developers.openai.com/codex/noninteractive).

For Iliad, background work should start much smaller: a cancellable local job that reads a folder of Markdown and returns a proposed report or diff. Do not auto-apply background edits.

## Product Comparisons

| Product | Loop shape | Tool surface | State model | Approval/security model | Background model | Useful lesson for Iliad |
| --- | --- | --- | --- | --- | --- | --- |
| Cursor Agent | IDE sidepane agent loops over search/edit/run/MCP tools. | Codebase search, grep, read/list files, edit/reapply, delete, terminal, web, MCP. | Chat tabs, checkpoints, rules, memories. | Foreground command approvals; custom modes change tool access. | Remote background agents in isolated Ubuntu machines; auto-run commands. | Mode-specific tool sets and checkpoints are worth copying; terminal auto-run is not. |
| Claude Code | Terminal/IDE/web harness around Claude; gather/action/verify loop. | File ops, search, shell, web, code intelligence, subagents, MCP, hooks. | JSONL sessions, checkpoints, `CLAUDE.md`, auto memory. | Ordered permission evaluation with hooks, deny rules, modes, allow rules, callbacks. | Local, cloud, remote-control, Slack, CI. | Treat the harness as the product: tools, permissions, context, checkpoints. |
| OpenAI Codex | Local/IDE/app agent with sandboxed tools and app-server protocol. | File edits, shell, web search, MCP, hooks, skills, subagents, app-server dynamic tools. | `AGENTS.md`, config layers, sessions, app-server threads/turns. | Sandbox plus approvals; read-only/workspace/full profiles; app-server approval RPC. | Cloud tasks, non-interactive `codex exec`, GitHub action, app server. | A local app can embed an agent through a strict event protocol rather than exposing internals. |
| OpenAI Agents SDK | Code-owned runtime loop with tools, handoffs, guardrails, tracing. | Function tools, hosted tools, MCP, sandbox capabilities. | Result history, sessions, conversation IDs, previous response IDs, resumable state. | Guardrails and human review interruptions. | Sandbox agents with files, commands, ports, snapshots. | Good conceptual base if Iliad owns orchestration and wants typed tools/traces. |
| GitHub Copilot cloud agent | GitHub task agent researches, plans, edits branch, optionally opens PR. | Repo exploration, edits, tests/linters, MCP, hooks, skills. | GitHub branch/commits/PR logs, custom instructions, Copilot Memory. | GitHub repo permissions, Actions isolation, branch protection constraints. | GitHub Actions-powered ephemeral environment. | Transparent branches/commits are the background-agent audit model; Iliad can mimic with patch histories. |
| Windsurf Cascade | IDE agent with Code/Chat modes, planning, todos, tool calls. | Search, analyze, web, MCP, terminal, package install, linter integration. | Local memories, global/workspace/system rules, checkpoints. | User accepts terminal/package actions; checkpoints/reverts. | Simultaneous Cascades and queued messages, not primarily cloud PR automation. | Queueing follow-up messages and visible todos can make long document tasks manageable. |
| Aider | Terminal chat-edit-commit loop. | Repo map, explicit file context, constrained edit formats, git commits. | Git repo plus chat context and repo map. | Human runs tool locally; edits are constrained and usually committed. | Primarily synchronous local CLI. | Constrained patch formats are a strong fit for Markdown editing. |

## Iliad-Oriented Architecture Sketch

```text
Renderer
  AssistantPanel
  DiffReview
  ApprovalPrompt
  StreamingStatus

Main process
  agent/sessionStore.ts
  agent/runner.ts
  agent/tools/readMarkdown.ts
  agent/tools/searchMarkdown.ts
  agent/tools/proposePatch.ts
  agent/tools/applyPatch.ts
  agent/approvals.ts
  agent/traces.ts

Existing filesystem boundary
  electron/fs/fileOps.ts
  electron/fs/pathSafety.ts
  electron/ipc/files.ts
  electron/ipc/workspace.ts
```

Suggested v1 flow:

1. User asks a question or selects a command from an assistant panel.
2. Renderer sends the active workspace, active file path, selection range, and prompt to main.
3. Main creates an agent turn with read-only tools by default.
4. Agent reads/searches Markdown through existing safe file APIs.
5. For edits, agent produces a source-level Markdown patch.
6. Renderer shows a diff against the current saved/unsaved buffer.
7. User approves, rejects, or asks for revision.
8. Main applies the approved patch through the same persistence path as normal editing.
9. Trace records prompt, tools, patch, and approval.

Key constraints:

- The assistant edits Markdown source, not rendered DOM.
- The active editor buffer must be reconciled before applying a patch. If the file changed since the agent read it, regenerate or rebase the patch.
- No hidden sidecar document state.
- No autonomous file writes.
- No terminal or network tool in the first implementation unless the user explicitly enables a research-only web source mode.

## Implications for Iliad v1

1. Build a narrow local assistant, not a general coding agent.
2. Start with read/search/propose/apply-approved-patch tools for Markdown only.
3. Put the agent behind Electron main process IPC and reuse existing path safety rules.
4. Add a first-class diff review UI before any write.
5. Store session traces outside documents for audit/debugging.
6. Keep persistent memory out of v1; use explicit user/project instructions later.
7. Do not add terminal execution, background auto-run, remote VMs, MCP, or app automation until the local Markdown loop is trustworthy.
8. Treat multi-file operations as background-draft jobs that return reviewable patches, never as auto-applied tasks.
9. Preserve the source-as-contract rule: every accepted assistant edit must be understandable as a direct Markdown source change.

## Source Links

- Cursor Modes: https://docs.cursor.com/agent
- Cursor Tools: https://docs.cursor.com/agent/tools
- Cursor Rules: https://docs.cursor.com/en/context
- Cursor Memories: https://docs.cursor.com/en/context/memories
- Cursor Background Agents: https://docs.cursor.com/background-agents
- Claude Code How It Works: https://code.claude.com/docs/en/how-claude-code-works
- Claude Code Hooks: https://code.claude.com/docs/en/hooks
- Claude Agent SDK Permissions: https://code.claude.com/docs/en/agent-sdk/permissions
- OpenAI Agents SDK Overview: https://developers.openai.com/api/docs/guides/agents
- OpenAI Agents SDK Running Agents: https://developers.openai.com/api/docs/guides/agents/running-agents
- OpenAI Agents SDK Results and State: https://developers.openai.com/api/docs/guides/agents/results
- OpenAI Agents SDK Guardrails and Human Review: https://developers.openai.com/api/docs/guides/agents/guardrails-approvals
- OpenAI Agents SDK Observability: https://developers.openai.com/api/docs/guides/agents/integrations-observability
- OpenAI Sandbox Agents: https://developers.openai.com/api/docs/guides/agents/sandboxes
- Codex CLI: https://developers.openai.com/codex/cli
- Codex Sandboxing: https://developers.openai.com/codex/concepts/sandboxing
- Codex Permissions: https://developers.openai.com/codex/permissions
- Codex AGENTS.md: https://developers.openai.com/codex/guides/agents-md
- Codex Hooks: https://developers.openai.com/codex/hooks
- Codex Non-interactive Mode: https://developers.openai.com/codex/noninteractive
- Codex App Server: https://developers.openai.com/codex/app-server
- GitHub Copilot Cloud Agent: https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent
- Windsurf Cascade: https://docs.windsurf.com/windsurf/cascade/cascade
- Windsurf Memories and Rules: https://docs.windsurf.com/windsurf/cascade/memories
- Aider Repository Map: https://aider.chat/docs/repomap.html
- Aider Edit Formats: https://aider.chat/docs/more/edit-formats.html
