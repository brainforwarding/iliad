# External Best Practices

Status: research note, started 2026-05-26; long-history survey added 2026-06-11.

This is a simple reading of current vendor guidance, focused on what matters for
Iliad. It is not a complete survey of every model provider.

## What OpenAI Says

OpenAI describes conversation state as something the application must manage
deliberately. With the Responses API, developers can use stateful options like
Conversations or `previous_response_id`; with manual state, the app passes prior
messages and context again. OpenAI also warns that all prior input tokens still
count when state is chained, and that every request must fit within the model's
context window. Source: [OpenAI conversation state](https://developers.openai.com/api/docs/guides/conversation-state).

Plain meaning for Iliad:

- A chatbot does not automatically remember everything in a useful way.
- We must choose what prior chat and document context to send.
- Long conversations need pruning, summaries, or compaction.
- Sending more text is not always better, because context windows and cost still
  matter.

OpenAI's Responses API also supports built-in tools and file search, but those
are not a replacement for product-level context rules. Iliad still needs to show
the user what was used and why. Source: [OpenAI Responses API reference](https://developers.openai.com/api/docs/api-reference/responses).

## What Anthropic Says

Anthropic describes the Messages API as stateless for normal multi-turn use:
the app sends the conversation history it wants Claude to see on each request.
Source: [Anthropic Messages guide](https://platform.claude.com/docs/en/build-with-claude/working-with-messages).

Anthropic's context-window guide explains the context window as the model's
working memory for a request, not the model's training data. It also says more
context is not automatically better; selecting the right context matters.
Source: [Anthropic context windows](https://platform.claude.com/docs/en/build-with-claude/context-windows).

For long documents, Anthropic recommends putting long documents near the top of
the prompt, keeping the user's query near the end, and structuring multi-document
inputs with clear document tags and metadata. Source: [Anthropic long-context prompting](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices#long-context-prompting).

Plain meaning for Iliad:

- The app owns the memory policy.
- A good context packet is organized, labeled, and bounded.
- Document content should be separated from instructions.
- For multi-document work, source labels and clear boundaries matter.

## What Agent Products Converge On

Our existing research on Cursor, Claude Code, Codex, and Antigravity shows a
shared pattern:

```text
explicit context selection
+ visible tool/status rows
+ review before write
+ inspectable traces or receipts
+ bounded workspace access
```

See the local research index in [Research index](./research-index.md), especially
[`agent-chat-ux-patterns.md`](../research/agent-chat-ux-patterns.md) and
[`agentic-architecture-survey.md`](../research/agentic-architecture-survey.md).

## What Agent Products Do About Long Histories (2026-06-11)

Live web survey of how leading agent chats manage conversation history. The
short answer: no leading product uses a fixed small sliding window; all use
full-history-until-budget plus compaction.

- Claude Code sends the full session history each turn; near the limit it first
  clears older tool outputs, then summarizes the conversation. The compaction
  summary preserves decisions, unresolved work, and the files involved, and the
  agent continues with the compressed context plus the most recently accessed
  files. Sources: [How Claude Code works](https://code.claude.com/docs/en/how-claude-code-works),
  [context window docs](https://code.claude.com/docs/en/context-window),
  [Anthropic: Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents).
- Codex CLI compacts at roughly 90% of the window into one summary message plus
  the most recent user messages kept verbatim (~20k tokens). Source:
  [Codex compaction architecture analysis](https://codex.danielvaughan.com/2026/03/31/codex-cli-context-compaction-architecture/).
- Cursor sends full thread history until the limit, then summarizes — and writes
  the full history to files the agent can search when the summary lost detail.
  Source: [Cursor: Dynamic context discovery](https://cursor.com/blog/dynamic-context-discovery).
- OpenAI's Agents SDK cookbook documents fixed last-N trimming only for
  conversations with independent, non-overlapping turns, with the explicit
  failure mode that earlier constraints and decisions vanish; for iterative work
  it recommends keep-last-N verbatim plus a structured summary. Source:
  [session memory cookbook](https://developers.openai.com/cookbook/examples/agents_sdk/session_memory).
- Anthropic's context-engineering guidance recommends just-in-time retrieval:
  keep lightweight identifiers (file paths, queries) in context and load content
  at runtime through tools, rather than pre-loading everything. Source:
  [Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents).
- Attachment persistence: in Claude Code and Cursor an attached/mentioned file
  is a snapshot in that message; freshness on later turns comes from the agent
  re-reading through tools, not from the snapshot. Cursor's official guidance is
  to skip attaching when unsure and let the agent find files itself.

Plain meaning for Iliad: the one-turn attachment model and tool-based
re-reading match the converged industry pattern; the fixed 8-message history
window did not. ADR-0014 replaced it with budget-bounded full history plus an
identifier-only reference index; ADR-0015 (accepted, shipped) added cached
compaction summaries for threads that exceed the budget.

## How Iliad Compares

Iliad is aligned with the main best practices:

- It builds an explicit context packet per turn.
- It labels active-file context separately from attached file context.
- It treats attached Markdown as user/workspace content, not higher-priority
  instructions.
- It keeps whole-workspace context out unless a tool or explicit feature reads
  it.
- It records a context manifest so the user has a receipt.
- It proposes document changes for review instead of silently applying them.

The main gaps are also clear:

- Pinned context is a deliberate non-feature, not a gap: one-turn attachments,
  workspace rules (`AGENTS.md`, fresh-read per turn), and tool re-reads cover
  its intents with guaranteed freshness; a pinned snapshot would go stale while
  the user edits the same documents in the app.
- Conversation history is budget-bounded (ADR-0014) with cached compaction
  summaries past the budget (ADR-0015, shipped): a receipted summary of the
  omitted prefix plus a gap-only omission note.
- We do not yet have a retrieval layer for finding relevant passages without
  sending whole documents.
- We do not yet have scoped worker agents with their own visible context budgets.

## Recommended Direction

Keep the current per-turn explicit-context model as the default. Add new context
features only when the UI can show them plainly:

- "Attached for this message" for one-turn file chips.
- "Pinned for this chat" for persistent files, if we add that later.
- "Found by search" for retrieval results.
- "Read by worker" for future subagent reads.
- "Summary used" for compaction or long-history summaries.

The rule should stay simple: if the model saw it, the user can inspect a receipt
for it.
