# Telegram Remote Chat Roadmap

Date: 2026-05-27
Status: active roadmap

## Intent

Telegram Remote Chat now works end to end, but the first working version exposed
several product and UI follow-ups. This roadmap tracks those follow-ups and the
workflow we will use for each one.

The work should move one item at a time. Each item gets its own branch, spec,
agent review, implementation, verification, local product review, and merge
back to `master` before the next item starts.

## Workflow For Each Item

1. Create a dedicated branch and worktree from current `origin/master`.
2. Write a focused spec for the item.
3. Send the spec to appropriate review agents with enough local context.
4. For any design or UI decision, include a separate UI/UX review agent that
   understands Iliad's minimal, clean design line.
5. Improve the spec from review feedback.
6. Implement the reviewed spec on the branch.
7. Use separate implementation and verification passes when the change is more
   than trivial.
8. Run focused tests, then broader typecheck/build/lint checks as appropriate.
9. Test or inspect the feature locally with the user.
10. Improve the branch if local review finds problems.
11. Merge into `master`, push production branch, delete the feature branch, and
    remove the temporary worktree.
12. Continue with the next roadmap item only after the previous item is merged.

## Roadmap Items

### 1. Fix Settings UI Placement And Compact Pairing UI

Status: implemented pending visual review

The Telegram Remote Chat settings card currently appears between Codex login
and OpenAI API key setup. That visually splits the two local AI connection
controls. The pairing UI also exposes a full Telegram URL inside the settings
panel, which makes the card expand awkwardly.

This item should:

- keep Codex and OpenAI API key controls visually adjacent;
- move Telegram Remote Chat into its own remote access section;
- make the pairing link/code compact;
- add copy and open actions for the pairing link;
- preserve the existing enable, disable, pair, and revoke behavior.

### 2. Store Telegram Remote Conversations In Assistant History

Status: implemented

Telegram requests and Iliad replies should appear in the same conversation
history as local desktop chats when they target the same workspace and active
conversation. This would let a user start from Telegram and continue later on
the computer.

### 3. Add Active Remote Conversation Selection

Status: implemented

Only one conversation should be exposed to Telegram at a time. Iliad should make
that state clear in the UI and provide an explicit way to enable or move remote
access to a different conversation.

### 4. Add Telegram Conversation Commands

Status: planned

Telegram should grow a small command surface once conversation ownership exists:
status, start new remote conversation, list or switch allowed conversations, and
unlink. The command set should stay small and should not create editing powers.

### 5. Polish Desktop And Telegram Handoff

Status: planned

After history and conversation selection exist, the desktop should make handoff
clear: which messages came from Telegram, which conversation is remotely
enabled, and whether a remote answer is still running.

### 6. Improve Remote Status And Diagnostics

Status: planned

The settings UI should eventually distinguish relay reachability, Telegram
pairing, desktop WebSocket presence, and local enabled state without adding
debug noise to the primary UI.

### 7. Harden Multi-User And Non-Personal Releases

Status: planned

The current relay and pairing model is suitable for personal/internal use. Any
broader release should revisit relay tenancy, device ownership, abuse controls,
and account-level policy before enabling this by default.
