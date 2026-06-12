# Follow-Up Turn Activity Visibility

Date: 2026-05-27

Status: implemented.

Review status: reviewed by a focused frontend agent. Feedback accepted:
test the scroll helper directly and cancel the scheduled animation frame in
cleanup.

## Problem

The first message in a chat shows the right active-run experience:

```text
user message
thinking dots
live activity rows such as "Searching documents..." and "Reading..."
```

On later messages in the same conversation, especially after the transcript is
already long, the agent still works and may still search/read documents, but the
visible panel can stay parked on the new user bubble. The thinking dots and live
activity row can sit below the visible scroll area until the final assistant
response replaces them.

This makes it feel as if the follow-up turn is not using the rich activity UI.

## Goal

Every active run should visibly show the same working row and activity trail,
whether it is the first message or the tenth message in a chat.

## Non-Goals

- No change to model prompts.
- No change to document-search behavior.
- No new persisted chat-history format.
- No new activity types.
- No change to the final context receipt.
- No worktree for this small fix, per user request.

## UX Rule

When the user sends any message:

```text
new user bubble
active working row with animated dots
live activity trail as tool events arrive
```

The transcript should stay pinned to the true bottom while a run is active, so
new status/activity rows are visible without the user having to scroll.

This continues the current behavior of auto-following the transcript during a
run. It does not introduce hidden chain-of-thought; only tool activity metadata
is shown.

## Likely Cause

`useAssistantRun` already appends a status entry for every run and
`AssistantTranscript` already renders a fallback active row when needed. The
bug is most likely scroll timing: the transcript uses a passive `useEffect` with
`scrollTo({ top: scrollHeight })`. In a long grid transcript, the status row and
activity trail can be committed after the browser has already painted the user
bubble view.

## Implementation Plan

- Replace the passive transcript auto-scroll effect with a layout-timed scroll.
- Scroll immediately after React commits the new entries/activity state.
- Schedule one additional `requestAnimationFrame` scroll so dynamic activity
  rows and expanded detail height are included.
- Cancel the scheduled animation-frame scroll in effect cleanup so stale frames
  do not fire after completion, cancellation, workspace changes, or opening a
  different chat.
- Keep the scroll scoped to the transcript element.
- Preserve the existing active status row and fallback row rendering.

## Tests

- Existing `AssistantTranscript` tests should continue to prove active status
  and activity rows render only while a run is active.
- Add a small regression test for the transcript scroll helper: it scrolls
  immediately, schedules one animation-frame follow-up scroll, uses the latest
  `scrollHeight`, and cancels the frame in cleanup.
- Run targeted assistant transcript tests, typecheck, CSS lint, and a full test
  run if targeted checks pass.
