# Review Supersession After Accept All

## Problem

When the assistant has produced multiple pending proposals for the same file path, the review queue currently keeps older proposals reachable but hides them behind the newest visible item. This creates a bad interaction:

1. The assistant proposes changes for `doc.md`.
2. The assistant later proposes newer changes for `doc.md`.
3. The user accepts the newer proposal from the assistant panel or sidebar.
4. The visible queue briefly clears.
5. An older hidden pending proposal for the same path becomes visible again, so `Accept all` / `Reject all` reappears even though the user just accepted the current proposal.

This violates the expected model: a newer proposal for the same internal-agent file path supersedes older unresolved internal-agent proposals for that path.

## Decision

Internal-agent review should be path-superseding, not merely path-hiding. This amends the earlier internal-agent review integrity spec: different-run same-path proposals should no longer remain independently reachable when a newer same-path internal proposal exists.

- For internal-agent proposals, only the newest proposal per normalized path is reviewable in the active queue.
- "Newest" is based on stable creation order (`createdAt`, with deterministic id fallback), not `updatedAt`, because review actions mutate `updatedAt`.
- Older same-path internal-agent proposals are treated as `superseded_same_path` and must not reappear after the newer proposal is accepted or rejected.
- Supersession compares against all internal proposal files, including terminal files, not only currently mutable files.
- Same-run duplicate file entries remain grouped as today.
- Bulk actions must apply/reject same-run duplicate file ids as well as the representative file id.
- External filesystem proposals keep priority over internal proposals for the same path, because live disk state is the stronger source of truth.
- Mixed-source same-path conflicts remain visible as external review only, with internal items blocked as `external_drift_same_path`.

## UI Behavior

- Sidebar `Accept all` accepts every currently visible review item and does not reveal older same-path internal proposals afterward.
- Sidebar `Reject all` rejects every currently visible review item and does not reveal older same-path internal proposals afterward.
- Assistant-panel `Accept all` / `Reject all` on a proposal handles every mutable file in that proposal. Once complete, same-path superseded older internal proposals must stay hidden from the file tree and pending count.
- Assistant-panel pending proposal cards use the same queue visibility rules. Superseded same-path older internal proposals are not shown as actionable cards.
- The pending count is based on visible, actionable review items only.

## Diagnostics

Keep the existing `[review-nav]` logs and add queue-level debug details when useful:

- log visible queue count and superseded count when building bulk actions;
- log proposal/file ids accepted or rejected in bulk actions.

Do not persist renderer logs yet unless the jump/reappearing behavior continues after this fix.

## Tests

- Add review queue tests proving that older same-path internal proposals are marked `superseded_same_path` and excluded from `visibleItems`.
- Add a test proving that after the newer same-path proposal is terminal, the older same-path item still does not become visible.
- Add assistant pending proposal tests for multi-file `Accept all` / `Reject all`.
- Add assistant pending proposal tests proving superseded same-path older proposals are not rendered as actionable cards.
- Add App or hook-level tests for sidebar bulk action behavior if a suitable harness exists; otherwise keep the queue logic unit-tested and cover file-tree rendering.
- Add same-run duplicate bulk behavior coverage.
- Add external/internal same-path regression proving external still wins and internal supersession does not override `external_drift_same_path`.

## Non-goals

- Do not delete old proposal records from disk immediately; this change is about queue visibility and reviewability.
- Do not change external filesystem capture semantics.
- Do not auto-navigate to older proposals after accepting or rejecting a review item.
