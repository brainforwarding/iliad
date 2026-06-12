# Tabs And Document Lifecycle For Doc-Native AI Review

Research date: 2026-05-23

## Executive Recommendation

Iliad does **not** need full document tabs before document-native AI review. Tabs are a working-set feature. The prerequisite for AI review is a durable **proposal lifecycle**: pending proposals must survive navigation, remain tied to their target file and base hash, and be reachable from a persistent review affordance even when the active editor is showing another document.

Ship doc-native review first with:

- one active editor document, preserving the current Iliad shape;
- a persistent `Review changes` entry point when any proposal is pending;
- a review drawer or modal with file-by-file navigation for changed and generated documents;
- file-tree badges for files with dirty editor state or pending review proposals;
- explicit close/navigation rules that protect unsaved edits and unapplied proposals.

Add tabs only after this if users need a larger manual working set. If tabs are added later, they should be document tabs only. Proposal state should remain independent of tab lifetime so closing a tab cannot accidentally discard review work.

## Current Iliad Baseline

Iliad is currently built around a single active Markdown document:

- [`src/App.tsx`](../../../src/App.tsx) owns `activeFile`, renders one [`EditorPane`](../../../src/components/EditorPane.tsx), one file tree, one topbar "document tab" label, and one assistant panel.
- [`src/app/useDocumentHistory.ts`](../../../src/app/useDocumentHistory.ts) stores in-memory Back and Forward stacks of Markdown paths. It deliberately skips stale paths and clears history on workspace change or when the active document is cleared.
- [`src/files/fileActions.ts`](../../../src/files/fileActions.ts) routes all Markdown opens through `flushSave()`, then reads the target file, sets `activeFile`, and records history only after successful navigation.
- [`src/app/useDocumentPersistence.ts`](../../../src/app/useDocumentPersistence.ts) treats dirty state as active-document state: `saved`, `saving`, `unsaved`, or `error`, with a 900 ms autosave timer and blocking `flushSave()` before file actions.
- [`src/components/FileTree.tsx`](../../../src/components/FileTree.tsx) distinguishes `activePath` from `selectedPath`; selection is already a creation target cue rather than an opened-document model.
- Assistant proposals are currently local assistant entries. [`src/types/iliad.ts`](../../../src/types/iliad.ts) has single-file `AgentPatchProposal` and single new-document `AgentCreateDocumentProposal` types. [`src/components/AssistantPanel.tsx`](../../../src/components/AssistantPanel.tsx) owns `reviewTarget` in component state.
- Applying an edit in [`electron/agent/agentService.ts`](../../../electron/agent/agentService.ts) checks the proposal `baseHash` against the current file before writing. Applying a new document rejects hidden, absolute, parent-relative, duplicate, or non-Markdown paths.

The architecture and specs are also explicit:

- [`docs/architecture.md`](../../architecture.md) says Iliad keeps one active document and should not add tabs until the file tree plus Back/Forward history are insufficient.
- [`specs/2026-05-22-document-navigation-history.md`](../../../specs/2026-05-22-document-navigation-history.md) rejected tabs for the initial navigation problem and chose browser-style history.
- [`docs/source-as-contract.md`](../../source-as-contract.md) says reviewable Markdown diffs are the trust boundary.
- [`docs/agent-panel-v1-architecture.md`](../../agent-panel-v1-architecture.md) recommends in-memory proposals anchored by path, hash, and diff, with review before writes.
- [`docs/research/agent-chat-ux-patterns.md`](../agent-chat-ux-patterns.md) recommends a review drawer with file-by-file navigation if multiple files are changed.

This means the next review milestone should extend the current model instead of replacing it with tabs.

## External Product Patterns

VS Code uses tabs for open items, but its own docs distinguish permanent tabs from preview tabs. Single-clicking in the Explorer opens a preview tab that is reused, while editing or double-clicking makes it dedicated. VS Code also supports working without tabs and using editor history instead. This supports Iliad's current direction: tabs are useful for manual working sets, but preview-style navigation can remain single-slot. Source: [VS Code User Interface docs](https://code.visualstudio.com/docs/getstarted/userinterface).

Cursor's agent docs separate chat tabs, review diffs, and checkpoints. Each chat tab has its own context, history, and model selection, while diff review is the control point for accepting generated changes. Checkpoints track only agent changes, not manual edits, and are local rather than Git history. For Iliad, the transferable pattern is not "add document tabs"; it is "keep agent change state distinct from manual document state." Sources: [Cursor overview](https://docs.cursor.com/chat/overview), [Cursor checkpoints](https://docs.cursor.com/en/agent/chat/checkpoints).

Antigravity exposes a persistent `Review Changes` affordance once an agent has begun writing, and the review pane lets users scroll through file diffs for work in a conversation. Its artifact review policy can require the agent to halt for explicit approval before changes proceed. Its Changes Sidebar marks resources with new changes since last review. For Iliad, this argues for a pending-review queue and per-file reviewed/unreviewed state, not necessarily tabs. Sources: [Antigravity Review Changes](https://www.antigravity.google/docs/review-changes-editor), [Artifact Review](https://antigravity.google/docs/artifact-review), [Changes Sidebar](https://www.antigravity.google/docs/changes-sidebar).

GitHub pull request review uses a changed-file list and viewed/unviewed state. GitHub's docs describe using a file tree to navigate changed files and filtering out viewed files; GitHub's product note says viewed status is removed when a file changes again. This is a strong match for multi-file proposal review: the unit of progress is the changed file, not an open tab. Sources: [GitHub filtering files in a pull request](https://docs.github.com/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/filtering-files-in-a-pull-request), [GitHub mark files as viewed](https://github.blog/news-insights/product-news/mark-files-as-viewed/).

Google Docs Suggested Edits keeps proposed edits in the document review layer until accepted or rejected. This is useful for prose review because suggested text is not canonical until accepted. Iliad should borrow the accept/reject lifecycle, while keeping the proposal metadata outside the Markdown body so `source-as-contract` stays intact. Source: [Google Docs suggested edits help](https://support.google.com/docs/answer/6033474).

## Decision: Review Queue Before Tabs

Tabs solve "I want these documents open." Document-native AI review needs to solve a different problem: "The assistant has proposed changes across one or more files; I need to inspect, accept, reject, or defer them without losing my place."

The second problem is better served by a proposal queue because:

- generated changes can target files that are not open;
- a generated new document may not exist on disk yet;
- closing a tab should not imply discarding a proposal;
- a proposal can become stale if the underlying file changes, regardless of whether its tab is open;
- file-by-file review progress matters more than keeping every changed file in the editor working set.

Tabs would also create premature complexity:

- per-tab dirty state versus the current single `useDocumentPersistence` state;
- per-tab CodeMirror view, scroll, selection, and autosave timers;
- close prompts for dirty tabs;
- ambiguous assistant context when multiple tabs are open;
- proposal ownership when a pending review tab is closed;
- workspace-change cleanup across many active buffers.

Iliad can avoid that until users demonstrate a real need for multi-open document editing.

## Required State Model

Introduce a workspace-level review state independent of the active editor:

```ts
type ReviewProposalStatus =
  | "pending"
  | "viewed"
  | "partially_accepted"
  | "applied"
  | "discarded"
  | "stale"
  | "error";

interface ReviewProposalFile {
  path: string;
  relativePath: string;
  kind: "modify" | "create";
  baseHash?: string;
  proposedContent: string;
  unifiedDiff: string;
  status: ReviewProposalStatus;
  lastViewedAt?: string;
  error?: string;
}

interface ReviewProposal {
  id: string;
  runId: string;
  title: string;
  summary: string;
  createdAt: string;
  files: ReviewProposalFile[];
  status: ReviewProposalStatus;
}
```

This state should live above `AssistantPanel`, likely in `App` or a small `useReviewProposals` app hook, because it affects the assistant, review drawer, file tree badges, topbar affordances, navigation, and workspace cleanup.

V1 can adapt the current single-file `AgentPatchProposal` and `AgentCreateDocumentProposal` into this shape without changing the model runtime yet. Multi-file proposals can follow once the renderer has a file-by-file review surface.

## How To Handle Changed Files And New Files

### Existing Changed Files

For a proposal that modifies existing Markdown:

1. Store target path, relative path, base hash, replacement content, and diff.
2. Show the file in the proposal list and in the review drawer.
3. Let the user inspect the diff without making that file the active editor document.
4. Before applying, flush the active editor save, re-read the target file, and compare the current hash to the proposal base hash.
5. If the file is stale, mark only that file `stale`; keep other files reviewable.

The current `applyPatch` behavior already checks base hash for one file. The review queue should generalize that check per file.

### Generated New Files

A generated new document should be reviewed as a create-file diff:

```diff
--- /dev/null
+++ b/annex.md
@@ New document @@
+# Annex
+...
```

Call this an **all-green diff** in product planning, but present it as a normal create-file review in the UI. The user should see:

- proposed relative path;
- whether parent folders will be created;
- full Markdown content;
- any duplicate-path or hidden-path warning;
- `Apply`, `Discard`, and later `Rename target`.

Do not open the generated file as an editable active document before apply. It is not canonical yet. Opening it early would make users think the file exists and would blur the difference between proposal content and saved Markdown.

After apply:

1. write the new Markdown file through the existing safe path;
2. refresh the tree;
3. open the new document in the active editor;
4. record normal navigation from the previous active file;
5. mark the proposal file `applied`.

This matches the current `applyAssistantNewDocument` behavior after approval, but moves the "review as diff" step before file creation.

## Pending Proposals Across Files

The assistant should be allowed to produce a proposal that touches multiple Markdown files, but the first multi-file UI should be conservative:

- one proposal card in the transcript;
- one persistent topbar or assistant-bottom `Review changes` button;
- a review drawer with an affected-file list on the left and the selected file diff on the right;
- per-file status: pending, viewed, applied, discarded, stale;
- proposal-level actions: `Apply all clean files`, `Discard all`;
- file-level actions: `Apply file`, `Discard file`;
- no partial hunk apply until the full-file flow is reliable.

Partial paragraph/hunk apply is attractive for prose, but it should come after the app can safely track per-file proposal state. The initial model can still show a unified diff and apply complete replacements.

## Dirty And Pending-Review States

Iliad needs two separate state axes:

| State | Meaning | Owner | UI cue |
| --- | --- | --- | --- |
| Dirty | The user's active editor buffer differs from saved disk content. | Document persistence | topbar save status, later file-tree dot |
| Saving/error | The active editor is writing or failed to write. | Document persistence | existing topbar status plus sticky error |
| Pending review | A proposal exists for this file. | Review proposal queue | file-tree badge, `Review changes` button |
| Stale proposal | The file changed since proposal base hash. | Review proposal queue | warning badge in review drawer and file tree |
| Viewed proposal file | User inspected this file's proposed change. | Review proposal queue | reduced badge or check in review list |

Do not overload tabs or the single topbar document label with all of these. The file tree is the best place to show document-level state because it already represents every workspace file, including files that are not active.

Suggested file tree cues:

- unsaved active document: small dot on the active row;
- pending review: small colored marker or badge on any target file row;
- stale proposal: warning marker on the file row and review list;
- generated new file not yet applied: show only inside review drawer and proposal list, not in the file tree unless there is a dedicated "Proposed files" section.

## Navigation Behavior

Document navigation should continue to mean "change the active editor document." Proposal review navigation should be a separate mode.

Rules:

- Clicking a file-tree Markdown row opens it in the active editor as today.
- Back/Forward history should record active editor navigation only, not movement inside the review drawer.
- Clicking a pending-review badge or `Review changes` opens the review surface, not necessarily the document.
- In the review drawer, `Next file` and `Previous file` move between proposal files and mark files viewed. They do not mutate document history.
- A button such as `Open document` from the review drawer can open the target in the active editor, using the normal save-before-open path and recording history.
- If a stale proposal target is opened manually and edited, the stale state remains until regenerated or discarded.
- Same-document links and external links keep the current behavior from `fileActions`.

This preserves the mental model: the editor is where canonical Markdown is edited; the review drawer is where proposed Markdown is evaluated.

## Close Behavior

Before full tabs, there are only a few close-like actions:

- close assistant panel;
- close review drawer;
- start new chat;
- change workspace;
- quit app.

Recommended behavior:

- Closing the review drawer hides it but does not discard pending proposals.
- Closing the assistant panel does not discard pending proposals. The topbar should still expose `Review changes`.
- `New Chat` should warn only if it would discard proposal cards that are not stored in the workspace-level review queue. Once proposals are app-level, new chat can leave pending proposals intact or ask whether to discard them.
- Workspace change should either clear pending proposals for the old workspace after confirmation, or persist them in app data keyed by workspace hash. For first pass, confirm before dropping unapplied proposals.
- App quit should rely on autosave for active dirty text, but pending proposals should be preserved if there is any local assistant persistence. If persistence is not implemented yet, warn that pending reviews will be lost.

If document tabs are later added:

- closing a clean tab simply removes that file from the working set;
- closing a dirty tab must flush or confirm;
- closing a tab with pending review does not discard the proposal;
- closing the last tab should leave the editor empty, not clear review state;
- reopening a file should restore its pending-review badge from the proposal queue.

## Does Iliad Need Tabs Before Review?

No. The minimum viable doc-native review stack is:

1. Workspace-level proposal queue.
2. Persistent review affordance outside the assistant transcript.
3. File-by-file review drawer for changed and generated files.
4. Per-file proposal state and stale checks.
5. File-tree badges for pending review and dirty state.
6. Navigation rules that keep editor history separate from review traversal.
7. Close rules that never equate hiding UI with discarding proposals.

Tabs become worthwhile when Iliad needs one of these:

- users routinely compare multiple source documents while writing;
- users want to keep generated/applied documents open while editing another document;
- assistant context should be assembled from a user-curated set of open documents;
- per-document scroll/cursor state becomes a frequent pain point;
- Back/Forward plus file tree is no longer enough for normal writing.

Until then, tabs would mostly add lifecycle ambiguity to review work.

## Proposed Milestones

### Milestone 1: Single-File Review Lifecycle

- Lift current `reviewTarget` out of `AssistantPanel`.
- Keep proposals pending when assistant is closed.
- Add a persistent `Review changes` affordance.
- Show pending-review badge for the active target file.
- Review replacement and new-document proposals in one drawer.
- Keep current full-file apply semantics and base-hash stale check.

### Milestone 2: Multi-File Proposal Review

- Extend proposal types to contain `files[]`.
- Add file list navigation in review drawer.
- Support create-file all-green diffs.
- Track per-file viewed, stale, applied, discarded states.
- Add `Apply all clean files` with per-file failure reporting.

### Milestone 3: Better Prose Review Controls

- Add paragraph or hunk-level accept/reject.
- Let users rename generated file targets before apply.
- Persist pending proposals per workspace in app data.
- Add proposal history for applied/discarded items.

### Milestone 4: Evaluate Tabs

- Revisit document tabs only after the review lifecycle is stable.
- If needed, start with VS Code-style preview behavior: one reusable preview slot for file-tree browsing, promoted to a kept tab when edited or explicitly pinned.
- Keep proposal state independent of tab state.

## Open Questions

- Should pending proposals survive app restart in the first doc-native review release, or is a quit warning acceptable?
- Should generated new documents appear in a "Proposed files" virtual section before apply?
- Should the assistant be allowed to propose folder creation separately from creating a Markdown file in a new folder?
- What is the exact visual treatment for pending-review badges in the calm file tree?
- Should a stale proposal offer "regenerate against current file" directly from the review drawer?

## Source Index

- Internal: [`docs/architecture.md`](../../architecture.md)
- Internal: [`docs/source-as-contract.md`](../../source-as-contract.md)
- Internal: [`docs/agent-panel-v1-architecture.md`](../../agent-panel-v1-architecture.md)
- Internal: [`docs/research/agent-chat-ux-patterns.md`](../agent-chat-ux-patterns.md)
- Internal: [`specs/2026-05-22-document-navigation-history.md`](../../../specs/2026-05-22-document-navigation-history.md)
- Internal: [`src/App.tsx`](../../../src/App.tsx)
- Internal: [`src/app/useDocumentHistory.ts`](../../../src/app/useDocumentHistory.ts)
- Internal: [`src/app/useDocumentPersistence.ts`](../../../src/app/useDocumentPersistence.ts)
- Internal: [`src/files/fileActions.ts`](../../../src/files/fileActions.ts)
- Internal: [`src/components/AssistantPanel.tsx`](../../../src/components/AssistantPanel.tsx)
- Internal: [`electron/agent/agentService.ts`](../../../electron/agent/agentService.ts)
- External: [VS Code User Interface docs](https://code.visualstudio.com/docs/getstarted/userinterface)
- External: [Cursor Agent overview](https://docs.cursor.com/chat/overview)
- External: [Cursor Checkpoints](https://docs.cursor.com/en/agent/chat/checkpoints)
- External: [Antigravity Review Changes](https://www.antigravity.google/docs/review-changes-editor)
- External: [Antigravity Artifact Review](https://antigravity.google/docs/artifact-review)
- External: [Antigravity Changes Sidebar](https://www.antigravity.google/docs/changes-sidebar)
- External: [GitHub filtering files in a pull request](https://docs.github.com/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/filtering-files-in-a-pull-request)
- External: [GitHub mark files as viewed](https://github.blog/news-insights/product-news/mark-files-as-viewed/)
- External: [Google Docs suggested edits](https://support.google.com/docs/answer/6033474)
