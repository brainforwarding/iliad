# Context Management

Status: living documentation. Started 2026-05-26.

This folder explains how Iliad decides what the assistant sees on each chat turn.
It is intentionally plain-language first, because context behavior is a product
trust issue, not only an implementation detail.

## Start Here

- [Current architecture](./current-architecture.md): what the app sends today,
  in what order, with simple examples.
- [Model-directed context tools](./model-directed-context-tools.md): why the
  next step is safe local document tools the model can choose to call.
- [OpenClaw Codex runtime research](./openclaw-codex-runtime-research.md): how
  OpenClaw separates Codex auth, runtime, tools, context projection, transcript
  mirrors, and native compaction.
- [External best practices](./external-best-practices.md): what current OpenAI
  and Anthropic guidance implies for our design.
- [Research index](./research-index.md): existing Iliad research and source
  documents to reuse before adding new context or agent features.
- [Architecture decisions](./decisions.md): accepted and proposed context
  decisions.
- [Change log](./change-log.md): notable context-management changes over time.

## Short Version

On every send, Iliad builds a fresh packet for the model:

```text
assistant rules
+ current active Markdown file, if one is open
+ files explicitly attached or @mentioned for this send
+ the current editor selection (offsets into the active file), when one exists
+ workspace rules (`AGENTS.md` at the workspace root), if present
+ safe Markdown document tool schemas, when the provider supports them
+ recent visible chat (budget-bounded; omission note and a path-only index of
  documents referenced earlier in the conversation when applicable)
+ a cached summary of older turns when the thread exceeds the history budget
  (ADR-0015), receipted, with the omission note shrunk to the uncovered gap
+ current user message
```

Old file attachments are not silently carried forever. If the user wants a file
used again, they should attach it again, mention it again, or have it open as the
active Markdown file.

When the user names a workspace item that was not attached, such as "the Odisea
course" or "session 1", the model cannot see the visual file tree. It should use
local Markdown document tools to search/list/read before giving specific
content-dependent advice, then the context manifest records what happened.
Search checks safe Markdown folder/file paths first — exhaustively over the
workspace tree, including deep course folders and common session/course aliases
such as `sesión 1`, `session 1`, `s1`, and `curso-1` — then does a bounded
content search that prefers files whose path matches the query. Searches can be
scoped to a directory, and the model is told to narrow a capped zero-result
search instead of repeating it.

Provider detail: both the OpenAI API path and the Codex app-server path expose
Iliad-owned Markdown document tools. Codex also has workspace runtime access,
but "workspace available" is not the same as "the model read the right file."
The exact searchable/readable Markdown trail comes from Iliad document-tool
activity and context receipts.

## Related Product Direction

- [Agent vision](../agent-vision.md)
- [Agent runtime roadmap](../agent-runtime-roadmap.md)
- [Agent panel v1 architecture](../agent-panel-v1-architecture.md)
- [Source as contract](../source-as-contract.md)

## Related Specs

- [2026-05-23 agent context management](../../specs/2026-05-23-agent-context-management.md)
- [2026-05-24 context ledger phase 1](../../specs/2026-05-24-agent-context-ledger-phase-1.md)
- [2026-05-24 context ledger phase 2](../../specs/2026-05-24-agent-context-ledger-phase-2.md)
- [2026-05-24 document tool contract](../../specs/2026-05-24-document-tool-contract.md)
- [2026-05-25 chat history](../../specs/2026-05-25-chat-history.md)
- [2026-05-26 context attachment picker](../../specs/2026-05-26-agent-context-attachment-picker.md)
- [2026-05-26 model-directed document tools](../../specs/2026-05-26-model-directed-document-tools.md)
- [2026-05-26 context discovery prompt policy](../../specs/2026-05-26-context-discovery-prompt-policy.md)
- [2026-05-26 Codex context discovery and live activity](../../specs/2026-05-26-codex-context-discovery-and-live-activity.md)
- [2026-05-26 Codex discovery receipts and working indicator](../../specs/2026-05-26-codex-discovery-receipts-and-working-indicator.md)
- [2026-05-27 pending document review navigation](../../specs/2026-05-27-pending-document-review-navigation.md)
