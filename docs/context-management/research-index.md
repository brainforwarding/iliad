# Research Index

Status: living index. Started 2026-05-26.

Use this page before adding new context or agent features. It points to existing
Iliad research so we do not rediscover the same lessons each time.

## Current Product Direction

- [Agent vision](../agent-vision.md): context principles, tool boundary,
  subagent direction, and review-first editing.
- [Agent runtime roadmap](../agent-runtime-roadmap.md): sequencing for runtime,
  context manifests, document tools, and future workers.
- [Agent panel v1 architecture](../agent-panel-v1-architecture.md): panel shape,
  context chips, run manifests, and review boundaries.
- [Source as contract](../source-as-contract.md): the Markdown source is the
  product contract.

## Context And History Specs

- [Agent context management](../../specs/2026-05-23-agent-context-management.md):
  first major context model, including manifest goals and non-goals.
- [Context ledger phase 1](../../specs/2026-05-24-agent-context-ledger-phase-1.md):
  manifest foundation.
- [Context ledger phase 2](../../specs/2026-05-24-agent-context-ledger-phase-2.md):
  transcript disclosure for what was sent.
- [Document tool contract](../../specs/2026-05-24-document-tool-contract.md):
  safe Markdown reads and writes.
- [Chat history](../../specs/2026-05-25-chat-history.md): transcript persistence
  without raw context payload persistence.
- [Context attachment picker](../../specs/2026-05-26-agent-context-attachment-picker.md):
  `@` picker, chips, and drag/drop file context.
- [Context discovery prompt policy](../../specs/2026-05-26-context-discovery-prompt-policy.md):
  prompt policy for named workspace items that the model must discover through
  document tools because it cannot visually see the file tree.

## External Product Research Already In Repo

- [OpenClaw Codex runtime research](./openclaw-codex-runtime-research.md):
  current source snapshot of OpenClaw's Codex app-server runtime, context
  projection, native tool boundary, transcript mirror, and implications for
  Iliad.
- [Agent chat UX patterns](../research/agent-chat-ux-patterns.md): Cursor,
  Claude Code, Codex, and Antigravity patterns for chat history, `@` context,
  chips, status rows, approvals, and review.
- [Agentic architecture survey](../research/agentic-architecture-survey.md):
  common agent loop, tool boundaries, state, memory, approvals, traces,
  background tasks, and future subagents.
- [Model/provider comparison](../research/model-provider-comparison.md):
  provider notes for OpenAI, Anthropic, Gemini, and local fallbacks.
- [OpenClaw auth deep dive](../research/chatgpt-login/openclaw-auth-deep-dive.md):
  useful mainly for auth/runtime lessons, not direct context UX.
- [OpenClaw and third-party patterns](../research/chatgpt-login/openclaw-and-third-party-patterns.md):
  supporting notes from third-party Codex-like tooling.
- [Official OpenAI Codex auth](../research/chatgpt-login/official-openai-codex-auth.md):
  Codex account/runtime integration research.
- [Doc-native AI review synthesis](../research/doc-native-ai-review/synthesis-and-proposal.md):
  review UI lessons for proposed document changes.

## Open Questions For Future Research

- How should pinned context work without making hidden stale memory?
- When should old chat be summarized, compacted, or dropped?
- Should exact old file snapshots ever be replayed, or should files always be
  read fresh from disk?
- What is the smallest useful retrieval layer for Markdown workspaces?
- How should model-directed local document tools be exposed without making
  context feel hidden or unreviewable?
- How should Iliad measure when the model should search for implied workspace
  references versus answer directly from active or explicit context?
- How should future Reader, Reviewer, Style, and Writer workers receive scoped
  context?
- What should the user see when a worker reads a file or uses a summary?
- Should project instructions live in a Markdown file such as `ILIAD.md`,
  `AGENTS.md`, or a settings panel?

## Research Intake Template

When adding a new research note, include:

```text
Title
Date
Status: snapshot / active recommendation / superseded
Sources
What the source says
What applies to Iliad
What we should not copy
Open questions
```
