# Pending Document Review Navigation

Date: 2026-05-27

Status: implemented.

Review status: reviewed by one focused product/UX + frontend/runtime agent.
Feedback accepted where it clarified run scoping, user-navigation suppression,
and active-file context effects. No provider-specific UI split was recommended.

Implementation status: implemented in the renderer proposal/review navigation
layer with provider-neutral proposal records. Focused helper tests, full Vitest
suite, typecheck, and production build passed.

## Reviewer Brief

Reviewers should read these before signing off:

- [`docs/context-management/README.md`](../docs/context-management/README.md)
- [`docs/context-management/current-architecture.md`](../docs/context-management/current-architecture.md)
- [`docs/context-management/model-directed-context-tools.md`](../docs/context-management/model-directed-context-tools.md)
- [`docs/context-management/decisions.md`](../docs/context-management/decisions.md)
- [`docs/agent-vision.md`](../docs/agent-vision.md)
- [`specs/2026-05-25-pending-file-tree-proposals.md`](./2026-05-25-pending-file-tree-proposals.md)

The key context principle is that opening a review surface is UI navigation, not
model context. The active Markdown file remains the only automatically included
document context on the next run. A virtual pending create review must not become
`activeFile` until the user presses `Crear` and the file exists on disk.

## Problem

Iliad already shows pending agent-created files in the file tree with a green
indicator and opens them as all-green review documents. The remaining behavior
needs to be specified:

- when an agent run should automatically open a review target;
- when the current document should stay in place;
- when a new pending file should be merely marked in the tree;
- how the file tree should reveal the opened pending file;
- how this stays consistent for both OpenAI API and Codex runs.

The current single-document model is the right foundation. Tabs and a general
model-controlled `open_document` tool would add context and navigation ambiguity
before there is evidence that Iliad needs them.

## Product Intent

Keep one editor surface and one active document. Agent proposals should feel like
documents in the workspace, but they remain pending review objects until the user
chooses `Crear`, applies edit hunks, or discards them.

The assistant may create or edit Markdown documents. Iliad decides which review
surface to show from normalized proposal records, not from provider-specific
assistant prose.

## Goals

- Preserve the no-tabs, single-active-document model.
- Keep pending create files visible as green-dot virtual file-tree rows.
- Automatically open the pending review only when there is one clear review
  target or the current active document is the target.
- If the agent edits the current document and also creates another document,
  keep the current document review open and leave the new document marked in the
  file tree.
- When a pending document review opens from chat or the pending card, expand the
  file-tree ancestors, scroll the row into view, and highlight the row.
- Use existing review controls:
  - `Crear` creates an approved pending new file on disk;
  - `Descartar` rejects a pending file or proposal file;
  - existing edit-review controls accept/reject edit hunks or files.
- Make the behavior provider-neutral across OpenAI API and Codex.
- Keep context manifests and document-tool receipts unchanged.

## Non-Goals

- No tab system.
- No split panes.
- No general `open_document` model tool.
- No new pinned context behavior.
- No provider prompt changes.
- No new proposal persistence schema.
- No direct provider writes.
- No change to safe Markdown document tools.
- No new database, RLS, deployment, or external service behavior.

## Terminology

- **Pending create file:** a proposed new Markdown file represented by a
  `create_file` proposal entry. It is visible in the file tree before it exists
  on disk.
- **Create review:** the all-green review surface for a pending create file.
- **`Crear`:** the existing UI action that writes an approved pending create file
  to disk.
- **Edit review:** the red/green review surface for an existing Markdown file.
- **Review target:** `{ proposalId, fileId }`, the renderer state that selects
  which proposal file is shown in the editor review surface.

## Auto-Open Policy

After an agent run completes and its proposals are merged into renderer state,
Iliad should choose an initial review target with these rules:

1. Consider only mutable proposal files produced or updated by the just-completed
   run. Older pending proposals remain visible through the file tree and pending
   card, but they must not drive this run's auto-open choice.
2. If the user performed any editor/review navigation while the run was in
   flight, do not auto-open any new review target. This includes:
   - opening a different real Markdown file;
   - opening or closing a pending create review;
   - opening another proposal review from the file tree or pending card;
   - using document Back/Forward navigation.
3. If any pending edit from this run targets the real active Markdown file from
   the run, open that edit review.
4. Otherwise, if this run produced exactly one mutable proposal file, open that
   file's review:
   - one pending create file opens the create review;
   - one non-current existing-file edit opens that document in review mode.
5. Otherwise, do not auto-open. Keep the current editor view and rely on the
   file-tree indicators plus the compact pending card.

This means:

| Agent result | Initial UI behavior |
| --- | --- |
| Edits current document only | Stay on current document and show edit review. |
| Creates one new document only | Open the pending create review and reveal it in the file tree. |
| Edits current document and creates another document | Stay on current document review; mark the new file in the tree. |
| Edits one non-current document only | Open that document in edit review and reveal it in the tree. |
| Creates or edits multiple non-current files | Do not auto-jump; show pending markers and the pending card. |
| User changed editor or review target during the run | Do not auto-jump; show pending markers and the pending card. |

## Manual Navigation Policy

Manual review navigation remains direct:

- Clicking a green pending create row opens that create review.
- Clicking an existing file row with a pending edit opens that edit review.
- Clicking `Revisar` in the assistant pending card opens the next mutable
  proposal file using the same existing proposal ordering.
- Any manual review open should reveal the target row in the file tree.
- Normal file-tree navigation still clears incompatible create-review state.

## File Tree Reveal Behavior

When Iliad opens a review target from auto-open or from the pending card, the
file tree should:

1. expand all ancestor folders for the target;
2. scroll the exact target row into view;
3. select/highlight the target row;
4. preserve the existing pending dot;
5. avoid repeated scroll jumps when unrelated proposal state refreshes.

For pending create reviews, the active row is the virtual
`iliad-review://<relativePath>` file. For existing edit reviews, the active row
is the real Markdown file path. The reveal should work for both real and virtual
tree nodes.

Implementation should prefer an explicit one-shot reveal request over expanding
and scrolling every pending change whenever proposal state changes. Existing
automatic expansion for pending descendants can remain, but row scrolling should
only happen for the chosen review target.

## Context Behavior

This change must not alter what the model sees.

- A pending create review is visible UI, not active Markdown context.
- Opening a real non-current edit review is real document navigation. It changes
  `activeFile`, so that real file may be included as active context on the next
  run. This is intentional only for the single-file edit case where the proposed
  edit target is the clear primary artifact.
- The next run includes the current real active Markdown file, explicit chips or
  `@mentions`, recent visible chat, and available document tools as described in
  `docs/context-management`.
- If a pending new file has not been created with `Crear`, it is not a real
  Markdown document and should not be sent as `activeFile`.
- After `Crear`, the new real file becomes `activeFile` through the existing
  create/apply flow and may be included as active context on the next send.
- File-tree visibility is not model visibility. The model still cannot see the
  visual file tree unless it reads through explicit context or document tools.

## Provider Behavior

This should not require separate OpenAI API and Codex implementations.

Both provider paths already converge through `AgentService.startRun(...)`,
saved `AgentChangeProposal` records, `useAssistantRun`, and
`useAgentProposals`. The navigation choice should run after proposals are
normalized and merged, so the renderer can treat OpenAI API and Codex results
the same way.

Provider-specific work is only required if one path fails to emit equivalent
proposal records. In that case, fix the normalization boundary so both runtimes
produce the same proposal shape; do not add separate UI navigation rules per
provider.

## Implementation Notes

Likely touched areas:

- `src/assistant/useAssistantRun.ts`
  - capture the active Markdown relative path at run start;
  - replace unconditional `reviewableFile(firstProposal)` auto-open with a
    helper that implements the auto-open policy;
  - pass a reveal intent when auto-opening a review target.
- `src/app/useAgentProposals.ts`
  - keep `selectAgentReviewTarget` as the central review navigation path;
  - expose enough information for `App` to reveal the selected review target;
  - ensure virtual create reviews still produce `virtualReviewFile` without
    assigning it to `activeFile`.
- `src/App.tsx`
  - store a one-shot file-tree reveal path for review targets, separate from
    folder creation reveal state if needed;
  - pass that reveal path to `FileTree`.
- `src/components/FileTree.tsx`
  - support reveal requests for both real and virtual display node paths;
  - expand ancestors before scrolling;
  - mark rows with a stable data attribute or ref map so the exact row can call
    `scrollIntoView({ block: "center" })`.
- `src/assistant/pendingFileTree.ts`
  - reuse `pendingFileTreePath(relativePath)` and normalized relative path
    helpers for virtual row identity.

Keep helper functions pure where possible:

```ts
function chooseInitialReviewTarget(args: {
  proposals: AgentChangeProposal[];
  runId: string;
  runActiveRelativePath: string | null;
  currentActiveRelativePath: string | null;
  editorNavigationChangedDuringRun: boolean;
}): ReviewTarget | null
```

The helper should consider only mutable proposal files whose proposal `runId`
matches the completed run. If implementation needs finer granularity for
updated proposal records, pass the exact proposal ids returned by the run rather
than all currently visible pending proposals.

## Edge Cases

- If the run started with active file A but the user is viewing active file B
  when the result arrives, do not move the editor.
- If the user manually opened or closed a virtual pending create review while the
  run was in flight, do not replace that review when the run completes.
- If a pending edit targets the current document but the file hash is stale,
  selecting the review may show the existing stale/failed review state; do not
  overwrite the document.
- If a pending create path collides with an existing real file, keep the existing
  collision behavior from proposal apply and do not create a second row.
- If the target row cannot be found after refresh, the assistant pending card
  remains the fallback entry point.
- If sidebar is closed or focus mode hides the tree, do not force it open. The
  reveal should run the next time the file tree is mounted only if the target is
  still the active review target.
- If many proposals arrive at once, do not scroll repeatedly. Reveal only the
  chosen initial or manually requested target.
- If the user rejects the currently open pending create file, clear the review
  target and return to the last real file or empty editor state as current code
  allows. Do not auto-open another file unless the user clicks `Revisar`.

## Required Tests

- Unit test the auto-open helper:
  - current-file edit wins over pending create;
  - single pending create opens;
  - single non-current edit opens;
  - multiple non-current files do not auto-open;
  - active-file changed during run suppresses auto-open;
  - review-target changed during run suppresses auto-open;
  - older pending proposals from another run are ignored.
- Unit test or component test reveal path calculation:
  - pending create uses `iliad-review://<relativePath>`;
  - existing edit uses the real file path.
- Component/manual test for file-tree reveal:
  - nested pending create expands parent folders and scrolls row into view;
  - `Revisar` card reveals the target row;
  - clicking the pending tree row still opens the same review;
  - a reveal intent created while the sidebar is hidden or focus mode is active
    is not consumed before `FileTree` mounts.
- Regression check:
  - pending create review does not become `activeFile` before `Crear`;
  - after `Crear`, the real file opens and becomes active.
- Provider smoke checks:
  - OpenAI API run that creates one new doc opens/reveals the pending create
    review;
  - Codex run that creates one new doc opens/reveals the pending create review;
  - Codex run that edits the current doc and creates another stays on the
    current document review.

For this local Electron app, required command checks remain:

```bash
npm run typecheck
npm run build
```

No external deployment checks are required for the implementation.

## Rollout

Ship behind the existing proposal/review behavior, without a new setting. The
change is deterministic renderer navigation over existing proposal records and
does not alter model prompts, file writes, context manifests, or provider auth.

## Open Questions

- Should a future implementation persist the last selected pending review target
  across app reloads, or should review selection remain transient?
- If the sidebar is closed when a new pending create is auto-opened, should the
  app leave it closed or briefly expose a non-modal "shown in file tree" affordance
  later? This spec keeps the sidebar closed.

## Panel Selection

- Spec reviewer: one focused product/UX + frontend/runtime reviewer.
- Implementation worker later: one frontend worker for
  `useAssistantRun`, `useAgentProposals`, `App`, and `FileTree`.
- Verification worker later: one test/QA worker for helper tests, typecheck,
  build, and manual OpenAI/Codex smoke steps.
