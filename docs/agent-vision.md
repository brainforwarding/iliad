# Iliad Agent Vision

Date: 2026-05-24

This document is the product guardrail for future agent work. It should stay
short, stable, and stricter than individual specs. Specs can choose how to
implement pieces of the system; this document defines what Iliad is trying to
be and what it is not trying to become.

## Core Idea

Iliad is a Markdown writing workspace with a review-first agent.

The agent should understand a local writing project, help plan and produce
Markdown documents, coordinate bounded specialist AI work when useful, and show
all document changes as reviewable Markdown diffs before anything persists.

The agent is not a general computer agent, an IDE agent, an office suite, or a
hidden automation layer.

## Markdown-First Rule

Every durable writing artifact in Iliad is a Markdown document.

Examples:

- a session guide;
- a rubric;
- a handout;
- a course map;
- a facilitator script;
- deck contents or slide notes;
- a research annex;
- a checklist;
- a template.

These are not separate app-native object types. The agent should not need tools
such as `create_rubric`, `create_handout`, or `create_slide_deck`. Those are
workflows expressed through the Markdown workspace contract:

- list, read, and search Markdown documents for context;
- propose Markdown changes through one review-first contract,
  `propose_markdown_changes`;
- include both existing-file edits and new-file creation as explicit file
  operations inside that proposal;
- ask the user for missing scope.

If a future feature requires a durable artifact that cannot be represented as
plain Markdown, it needs a separate spec and an explicit source-as-contract
review.

## Product Promise

Users should be able to say things like:

- "Help me improve this session."
- "Create a course from this outline."
- "Make the activities more practical."
- "Create the missing rubrics and facilitator guides."
- "Review all session intros for tone and consistency."
- "Coordinate a few reviewers and then propose changes."

Iliad should respond as a writing collaborator:

1. Understand the project and the user's goal.
2. Select explicit context from the workspace.
3. Plan work when the task is large.
4. Use bounded specialist workers only when they add real value.
5. Produce or revise Markdown documents.
6. Show every edit as an Iliad review proposal.
7. Wait for the user to accept or reject changes.

## Context Principles

The agent is conversation-scoped and workspace-aware, but only through context
Iliad explicitly provides or tools explicitly read.

Required direction:

- Every run should have a context manifest.
- The active file is one context source, not the agent's identity.
- The user should be able to inspect what files, selections, summaries, search
  results, and proposals were included in a run.
- Explicit references such as `@file.md` should be treated as user-requested
  context: read through the document tool contract, shown in the manifest, and
  skipped visibly when unsafe or unavailable.
- Whole-workspace context should never be hidden or automatic. Workspace rules
  (`AGENTS.md`) are the one standing, always-receipted, user-authored inclusion
  (ADR-0018).
- Summaries are useful, but exact Markdown should be re-read before proposing
  edits.
- Context should be scoped to the writing task, not maximized by default.

The user should never have to infer from chat prose what the model saw.

## Tool Boundary

Iliad's agent tools should be document tools, not development tools.

Allowed direction:

- list project documents;
- read Markdown documents;
- search Markdown documents by file name, heading, and text;
- open one visible workspace Markdown document in the editor through a
  validated, receipted, desktop-only navigation tool (ADR-0016);
- inspect explicit context and prior proposals;
- propose Markdown changes through one `propose_markdown_changes` contract that
  supports existing and new Markdown files;
- ask the user for clarification;
- spawn bounded read, review, research, or writing workers that operate on the
  same Markdown proposal contract.

Avoid:

- shell or terminal execution;
- installing packages;
- running Python or arbitrary scripts;
- git operations;
- inspecting the user's system outside the open workspace;
- browser/computer-use automation;
- arbitrary MCP connector access;
- hidden background writes;
- non-Markdown artifact builders as core product primitives.

If a future export feature turns Markdown into PDF, slides, or another format,
that should be an explicit export workflow. It should not change the agent's
core editing model.

## Subagent Direction

Subagents are useful only when they are real runtime jobs with scoped context,
limited tools, visible status, and concrete outputs.

Recommended first roles:

- **Reader:** finds relevant passages in explicit Markdown context.
- **Researcher:** gathers source-backed evidence when research is enabled.
- **Reviewer:** checks a proposal against the user request and source contract.
- **Style editor:** extracts or applies tone and structure conventions.
- **Writer:** drafts Markdown changes under the supervisor's plan.

Subagents should start isolated by default. They should receive a clear task,
allowed files, allowed tools, budget, and output format. They should return
summaries, citations, notes, or draft proposals to the supervisor.

Do not ship subagent UI that is only prompt theater. If the UI says "waiting for
Reviewer," there must be an actual child job named Reviewer.

## Review-First Editing

All model-authored document changes flow through one Iliad Markdown proposal
contract.

Rules:

- Chat stays clean and conversational.
- Diffs live in the document review UI, not in transcript messages.
- Existing-file changes render as red/green Markdown review blocks.
- New documents render as all-green Markdown proposals.
- Multi-file work is one proposal containing multiple explicit file changes.
- Accept/reject is owned by Iliad.
- Direct provider writes are intercepted, restored, and converted into pending
  proposals.
- Stale or conflicting proposals must block rather than overwrite user work.

This rule is the practical extension of
[`source-as-contract.md`](./source-as-contract.md): the Markdown file is the
artifact, and the Markdown diff is the review surface.

## What To Build Next

The next architecture steps should stay sequential. The core foundations are now
in place: Codex runtime, reviewable Markdown proposals, context manifests,
explicit `@file.md` reads, safe Markdown document tools, thinking summaries, and
service-owned run events.

1. **Conversation history.** Persist local run summaries, event metadata,
   context manifests, and pending proposal links outside workspace Markdown
   files.
2. **Context selection expansion.** Add selected text, explicit attachments,
   searched files, and recent summaries in an inspectable way.
3. **Provider-facing document tool integration.** Wire safe Markdown document
   tools into future scoped worker runtimes only when tool boundaries can be
   enforced.
4. **Read-only subagents.** Add Reader/Reviewer/Style worker jobs before
   allowing worker-authored proposals.
5. **Writer orchestration.** Let the supervisor coordinate writers for
   multi-document course work, still through reviewable Markdown proposals.

Do not jump directly to a broad autonomous agent. Each step should make the
agent more useful while preserving context visibility, path safety, and
review-first writing.

## Decision Test

When evaluating a future agent feature, ask:

1. Does it help users write, revise, organize, or review Markdown documents?
2. Can its durable output be represented as normal Markdown?
3. Is the context explicit and inspectable?
4. Are writes proposed before they persist?
5. Does the feature avoid general computer-agent powers?
6. Does it reduce real writing complexity rather than adding a dashboard for
   its own sake?

If the answer is no, the feature is probably outside Iliad's core direction.
