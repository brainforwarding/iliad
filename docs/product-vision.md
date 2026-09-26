# Iliad Product Vision

Date: 2026-09-24 (replaces `agent-vision.md`; see ADR-0021 in
[`decisions.md`](./decisions.md))

This is the product guardrail. It stays short and stricter than individual
specs: specs decide how to build things; this decides what Iliad is.

## Core idea

Iliad is a calm, local Markdown writing app with two jobs:

1. **The best place to write one document**, line by line, with small AI help
   that never takes over: inline completion on request (sentence, paragraph,
   full idea; never while typing), the ✦ AI menu on a selection, and the
   corrector.
2. **The place to review what an AI agent did to your writing.** Claude Code,
   Codex or any other tool writes Markdown in the folder; Iliad shows every
   change in the document and the writer keeps or restores it, chunk by chunk.

Iliad has no chat panel and no agent of its own. Large or multi-document AI
work belongs to outside agents, which are stronger and improve on their own.

## Rules

- **The file is the contract** ([`source-as-contract.md`](./source-as-contract.md)).
  Everything durable is plain Markdown on disk, readable and editable elsewhere.
  Display preferences never go into the writer's Markdown.
- **Nothing changes silently.** Built-in AI suggests; the writer accepts. Outside
  changes are visible and reversible; restores never overwrite newer work.
- **Context is files, not app data.** Comments (`name.comments.md`) live next
  to the document, so any agent can read them and they travel with the folder.
  Comments are how the writer talks to the AI. Writing notes (`name.notes.md`)
  were removed on 2026-09-25 because they duplicated comments (ADR-0022);
  existing notes files stay on disk as ordinary documents.
- **AI speaks when asked.** Suggestions come only from an explicit key or
  button; typing never sends a request (automatic suggestions removed
  2026-09-25, ADR-0022).
- **Agents get a small bridge, not powers.** The `iliad` CLI tells an agent what
  the writer is looking at (`status`), shows a result (`open`), and installs the
  skill that explains how to work with Iliad. The CLI reads and navigates; it
  never writes documents.
- **Built-in AI is small and fast.** One Gemini key powers it. It works on the
  current document and the current selection only.
- **Calm UI.** No tabs of chat, no dashboards, no settings sprawl. Controls
  appear where the writing is, when they are needed.

## Decision test

1. Does it help someone write, revise, or review Markdown?
2. Is its durable output plain Markdown the writer can inspect?
3. Is every change visible and reversible before it matters?
4. Does it belong in the editor (one document, now), or in an outside agent
   (many documents, long tasks)? Build only the first kind into Iliad.
5. Does it reduce real writing friction rather than add surface?
