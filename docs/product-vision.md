# Iliad Product Vision

Date: 2026-09-28 (first written 2026-09-24, replacing `agent-vision.md`; see
ADR-0021 in [`decisions.md`](./decisions.md))

This is the product guardrail. It stays short and stricter than individual
specs: specs decide how to build things; this decides what Iliad is.

## Why Iliad exists

Good writing means reading every sentence and staying in control of the
process. Writing handed off to AI comes back fluent and empty: slop, or at best
competent prose that doesn't sound like the person whose name is on it. AI
should help writers say what they mean in their own voice, not write for them.

Iliad is for serious writers who want AI help without losing their voice:
novelists, journalists, playwrights, academics, essayists, anyone who signs what
they write. The writer does the writing and brings AI in only where they choose,
and every word the AI proposes is read before it lands.

## Core idea

Iliad is a calm, local Markdown writing app built on three things:

1. **An editor that is a joy to write in.** Clean and quiet, with good
   typography and no distractions. The file is plain Markdown, with the few
   extras writers need, such as dropped or pasted images and math.
2. **Fast help that follows your voice.** Inline completion on a keystroke
   (a sentence, a paragraph or the next idea, never while typing), running on a
   very fast Groq model so it keeps pace with thought. The ✦ AI menu tightens or
   edits a selection, and the corrector catches mistakes. The writer picks what
   stays.
3. **Collaboration with a strong outside agent, fully reviewed.** Claude Code,
   Codex or any other agent creates and edits Markdown in the folder. It reads
   the writer's comments, which sit next to the document. Iliad shows exactly
   what the agent changed, and the writer keeps or restores each change, chunk
   by chunk.

In short, Iliad is the best place to write one document and the place to review
what an AI did to your writing. It has no chat panel and no agent of its own.
Large or multi-document AI work belongs to outside agents, which are stronger
and improve on their own.

## Rules

- **The writer's voice comes first.** AI proposes and the writer decides. No
  feature may put model text into a document without the writer seeing it and
  choosing it, and no feature should nudge the writer toward handing off the
  writing itself.
- **The file is the contract** ([`source-as-contract.md`](./source-as-contract.md)).
  Everything durable is plain Markdown on disk, readable and editable elsewhere.
  Display preferences never go into the writer's Markdown.
- **Nothing changes silently.** Built-in AI suggests; the writer accepts. Outside
  changes are visible and reversible; restores never overwrite newer work. The
  one exception is naming an untitled document (ADR-0024), which touches a file
  name, never the writing.
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
- **Built-in AI is small and fast.** It is free by default through Iliad's
  proxy on Groq, or direct to Groq with the writer's own key (ADR-0023). It
  works on the current document and the current selection only, and only an
  explicit request sends text. Speed is part of the product: help that arrives
  slower than thought breaks the writing.
- **Calm UI.** No tabs of chat, no dashboards, no settings sprawl. Controls
  appear where the writing is, when they are needed.

## Decision test

1. Does it help someone write, revise, or review Markdown?
2. Does the writer stay the author? The writer reads and chooses every AI word,
   and nothing pushes them to hand off the writing.
3. Is its durable output plain Markdown the writer can inspect?
4. Is every change visible and reversible before it matters?
5. Does it belong in the editor (one document, now), or in an outside agent
   (many documents, long tasks)? Build only the first kind into Iliad.
6. Does it reduce real writing friction rather than add surface?
