# Doc-Native AI Review Synthesis And Proposal

Research date: 2026-05-23

This note synthesizes the specialist research docs for Iliad's next agent-review direction:

- [Diff UX patterns](./diff-ux-patterns.md)
- [CodeMirror inline diff review](./codemirror-inline-diff.md)
- [Tabs and document lifecycle](./tabs-and-document-lifecycle.md)
- [Model thinking streams](./model-thinking-streams.md)
- [Clean chat and edit artifact architecture](./artifact-architecture.md)

## Product Diagnosis

The current chat UI is not just visually rough. It exposes the wrong architecture. The model response is carrying transport data such as full replacements and unified diffs, and the chat renders that data as if it were part of the conversation. This makes the agent feel like a text generator that explains a patch, not like an editor-native assistant that changes documents under review.

The target behavior should be:

- Chat explains what the agent is doing and asks for clarification.
- Proposed edits appear in the document, not in the chat transcript.
- Additions are green pending insertions.
- Deletions are red pending removals.
- Replacements are paired red old text and green new text.
- New documents open as all-green pending documents or appear in a review surface as create-file diffs.
- The user can accept or reject one change, one file, or all pending changes.

## What The Research Found

### Diff Review Belongs In The Document Surface

Cursor, VS Code Copilot Edits, Claude Code Desktop, GitHub Desktop, and GitHub web PR review all separate "conversation/control" from "diff/review." Chat can initiate edits and summarize them, but the actual review happens in a diff surface with green/red semantics, navigation, and accept/reject controls.

VS Code is the closest pattern for Iliad: Chat lists changed files, but opening a changed file shows an inline diff in the editor with per-edit Keep/Undo and navigation. GitHub Desktop is the best reference for the changed-file list and line-level inclusion/discard. Cursor validates the pattern that the agent response ends with a review entry point rather than embedding diffs in prose.

Implication: Iliad should remove raw diffs and full-document replacements from chat. The editor owns review.

### Tabs Are Not The First Prerequisite

The research does not support adding full document tabs as the first dependency. Tabs are a working-set feature. The actual prerequisite is a workspace-level proposal lifecycle that survives navigation and is independent of the assistant panel.

Iliad can ship doc-native review with one active editor by adding:

- a persistent `Review changes` affordance when any proposal exists;
- file-tree badges for files with pending review;
- a file-by-file review drawer for multi-file proposals;
- proposal state keyed by workspace, path, and base hash;
- navigation rules that keep review traversal separate from document Back/Forward history.

Tabs become useful later if users need a larger manual working set, want several generated/applied documents open at once, or need persistent per-document scroll/cursor state. They should not be used to store proposal state.

### CodeMirror Can Support This, But It Should Be A Separate Review Extension

Iliad already uses CodeMirror 6 through `@uiw/react-codemirror`. The best v1 approach is a custom sibling extension, not a change inside `visualMarkdown`.

Recommended shape:

- `src/editor/aiReview/` owns pending-review decorations and commands.
- A `StateField<PendingReviewState>` stores pending hunks and exposes direct decorations.
- `StateEffect`s set/clear review state and accept/reject hunks.
- The editor document remains the current canonical Markdown until the user accepts changes.
- Green insertions can be preview widgets or applied preview marks depending on the final save model.
- Red deletions should be rendered as review widgets at deletion anchors.
- Hunk controls dispatch CodeMirror commands instead of owning state in React.

`@codemirror/merge` is worth prototyping for a full-diff drawer, but it should not be the primary in-document review layer until we prove it coexists cleanly with Iliad's visual Markdown behavior.

### Model Output Must Become Typed Artifacts

The agent provider should stop asking the model to put `FULL_REPLACEMENT`, `NEW_DOCUMENT`, or fenced diffs inside assistant text. Instead, the model should return two channels:

- `assistantMessage`: clean user-facing prose.
- `artifacts`: typed proposal objects.

For v1, OpenAI Structured Outputs are the smallest clean replacement for regex parsing. A later custom tool such as `propose_document_changes` can support more complex multi-step or subagent flows. In both cases, the renderer should receive normalized Iliad proposal objects, not parse model text.

Core proposal shape:

- proposal id, run id, model, timestamps, status;
- one or more file changes;
- each file change is `edit_file`, `create_file`, or later `delete_file`;
- existing-file edits include base hash and review hunks;
- new-file creations include proposed relative path, content, and conflict state;
- each hunk has `before`, `after`, status, location confidence, and preview diff data.

### Thinking Streams Should Be Optional And Secondary

OpenAI and Gemini both expose provider-approved summaries, not raw chain-of-thought.

OpenAI reasoning summaries are opt-in with `reasoning.summary` on supported reasoning models. Gemini thought summaries are opt-in with `thinkingConfig.includeThoughts: true` and stream as parts where `part.thought` is true.

Iliad should normalize these into an optional `reasoning_summary_delta` event, but the default clean chat should favor Iliad-owned progress rows such as:

- Reading selected files
- Planning edits
- Preparing review
- Waiting for approval

Provider reasoning summaries should be collapsed or hidden by default until there is an advanced/debug affordance. They should never be treated as raw thoughts.

## Proposed Implementation Order

### Phase 1: Stop Rendering Transport In Chat

Goal: fix the most visible trust problem before changing the editor.

- Sanitize legacy model responses so `FULL_REPLACEMENT`, `NEW_DOCUMENT`, and full diff bodies never render in chat.
- Introduce clean assistant entries with optional `proposalIds`.
- Move proposal state above `AssistantPanel` so proposals survive panel close/reopen.
- Keep current whole-file apply behavior temporarily.

### Phase 2: Workspace-Level Proposal Store

Goal: make review state durable and independent of the active document.

- Add an Electron-side proposal store scoped to workspace root.
- Store proposal aggregates with file changes, hashes, statuses, and created time.
- Add IPC methods for listing proposals, reading a proposal, accepting/rejecting file changes, and clearing proposals.
- Add a persistent `Review changes` affordance outside chat.
- Add file-tree pending-review badges.

### Phase 3: Single-File Document-Native Review

Goal: show AI edits in the document itself.

- Add `src/editor/aiReview/` CodeMirror extension.
- Diff current Markdown against proposed Markdown into paragraph or Markdown-block hunks.
- Render additions in soft green and deletions in soft red.
- Add current-change controls: previous, next, accept, reject.
- Add document-level accept all and reject all.
- Keep the chat clean: no diffs, no replacement dumps.

### Phase 4: New Documents And Multi-File Review

Goal: support the workflow the user expects when the agent creates or edits several docs.

- Represent new documents as `create_file` proposals.
- Show new documents as all-green pending docs in review.
- Let users approve/reject generated docs before writing them to disk.
- Add a compact file-by-file review drawer for proposals that touch multiple files.
- Track per-file states: pending, viewed, applied, rejected, stale, failed.

### Phase 5: Hunk-Level And Prose-Specific Refinement

Goal: make review feel natural for Markdown writing, not code.

- Support paragraph/list-item/table/code-fence hunks.
- Add per-hunk mini controls above or beside the changed block.
- Handle stale hunks if the user edits while a proposal is pending.
- Add optional word-level highlights inside changed paragraphs.
- Consider an optional full-diff mode using `@codemirror/merge`.

### Phase 6: Provider Streams And Subagents

Goal: prepare for a real orchestrator without cluttering the UI.

- Normalize OpenAI and Gemini streaming into provider-neutral events.
- Show compact Iliad-owned progress rows.
- Keep provider reasoning summaries collapsed or hidden by default.
- Let future subagents emit the same typed proposal contract as the main agent.
- Display subagent work as task/status rows, not as extra chat transcripts.

## Design Direction

The UI should be minimal and editor-first:

- Keep the assistant panel quiet.
- Use a single compact `Review changes` control when changes exist.
- Do not show the active document name as if it were the full context boundary.
- Treat context as workspace plus selected/open/mentioned files, not one active file.
- Put review controls in the document surface or a focused review drawer.
- Use subdued GitHub-like red/green diff colors suitable for prose.
- Avoid redundant accept-all controls in multiple places until there is evidence users need them.

## Open Product Questions

- Should pending insertions be editable before acceptance, or only previewable?
- Should generated new files appear as virtual file-tree entries before acceptance, or only in the review surface?
- Should pending proposals survive app restart in v1, or is a quit warning acceptable?
- What is the right default granularity: line, paragraph, or Markdown AST block?
- Should the first implementation apply accepted hunks immediately, or stage them until `Accept all`?

## Recommended Next Step

Write a focused implementation spec for Phases 1-3 before coding. This should define the proposal schema, IPC lifecycle, CodeMirror review state, exact UI controls, and acceptance semantics. Phases 4-6 should remain in the architecture document but not block the first doc-native review release.
