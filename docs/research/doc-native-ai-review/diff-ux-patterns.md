# Diff UX Patterns for AI and Proposed Changes

Research date: 2026-05-23

This note compares how current developer tools expose AI-generated edits, pull request suggestions, and ordinary proposed changes for human review. The focus is practical UX for Iliad's minimal Markdown editor: where the diff lives, how additions and deletions are presented, what can be accepted or rejected, how users move through changes, and how chat coexists with review.

## Sources

- [Cursor docs: Diffs & Review](https://docs.cursor.com/en/agent/review)
- [Cursor docs: Chat overview](https://docs.cursor.com/chat/overview)
- [VS Code docs: Review AI-generated code edits](https://code.visualstudio.com/docs/copilot/chat/review-code-edits)
- [Claude Code docs: How Claude Code works](https://code.claude.com/docs/en/how-claude-code-works)
- [Claude Code docs: Configure permissions](https://code.claude.com/docs/en/permissions)
- [Claude Code docs: Desktop application](https://code.claude.com/docs/en/desktop)
- [GitHub Desktop docs: Committing and reviewing changes](https://docs.github.com/en/desktop/making-changes-in-a-branch/committing-and-reviewing-changes-to-your-project-in-github-desktop?platform=mac)
- [GitHub docs: Reviewing proposed changes in a pull request](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/reviewing-proposed-changes-in-a-pull-request)
- [GitHub docs: Incorporating feedback in your pull request](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/incorporating-feedback-in-your-pull-request)
- [GitHub Blog: Introducing split diffs in GitHub Desktop](https://github.blog/2020-11-17-introducing-split-diffs-in-github-desktop/)

## Pattern Summary

| Tool | Diff placement | Diff style | Bulk actions | Granular actions | Change navigation | Chat/review relationship |
| --- | --- | --- | --- | --- | --- | --- |
| Cursor | Agent lives in side pane; review appears as a dedicated review flow with a floating bar and a "Review changes" entry point. | Familiar code diff with color-coded added, deleted, and context lines. Current docs emphasize review diffs rather than a permanently split editor. | Accept/reject changes for the current file; accept all or reject all after line-level decisions. | Selective acceptance by accepting wanted lines or rejecting unwanted lines before using the bulk action. | Floating review bar moves to the next file with pending changes. | Chat generates edits; review is a follow-up mode attached to the agent response. |
| VS Code / Copilot Edits | Chat view lists files pending review; the changed file opens in the normal editor with an inline overlay. | Inline diff inside the editor after edits are applied and saved to disk. Sensitive-file edits can show a proposed-change diff before application. | Accept or reject all changes across all files from Chat. Source Control staging accepts pending edits; discarding rejects them. | Keep or Undo individual edits; hover an inline change to accept or reject that specific change. | Up/Down overlay controls move between edits; resolving an edit can auto-reveal the next pending edit, even in another file. | Chat remains the control surface and file list; the editor is the review surface. |
| Claude Code terminal | Primary interaction is terminal permission prompts and checkpoints; Desktop adds a visual diff review. | CLI emphasizes before-edit checkpoints and permission gates, not a rich in-terminal split diff. Desktop says users see a diff and can accept/reject each change. | Permission modes can ask every time, auto-accept file edits, or plan first. Checkpoints allow rewinding local file edits. | In Ask permissions mode, each change can be accepted or rejected in Desktop. CLI granularity is framed more around tool approvals and session rewind than hunk selection. | Terminal workflow relies on prompts, modes, and checkpoints; Desktop supports file-by-file visual review. | Chat/agent loop is the main surface. Diff review is either a permission checkpoint or, in Desktop, a visual pane within the app layout. |
| GitHub Desktop | Left sidebar lists changed files; selected file's diff fills the main pane; commit form is below the file list. | Unified and split diff display are supported. Additions/deletions use familiar green/red diff semantics; selected commit lines are highlighted blue. | Top checkbox includes all files in a commit; file checkboxes include/exclude entire files. Discard all or discard selected files. | Partial commits by selecting/deselecting changed lines. Discard one added line or a group of changed lines from the diff context menu. Single-line discard is disabled for mixed add/remove groups. | File list is the main navigation. Users can expand context above/below hunks or expand the whole file. | No chat-first review. Copilot appears only as commit message/detail generation, not as the diff review surface. |
| GitHub web PR/file diff | "Files changed" tab, with file tree/filtering and comments embedded in the diff. Copilot Chat can attach the PR as context from the page. | Unified or split view; hide whitespace option; rich/source diff toggle for some file types. | Submit overall review as Comment, Approve, or Request changes. Suggested changes can be committed one at a time or batched into one commit. | Line and multi-line comments; reviewer can insert a suggested change block that the PR author can commit. | File tree/filtering, per-file "Viewed" checkbox, and collapsed viewed files. | Chat is adjacent: Copilot Chat can explain PR intent, but review comments and suggestions remain embedded in the diff. |

## Observations

### Inline diff is the default for AI edits inside an editor

VS Code's Copilot Edits flow directly applies and saves AI changes, then tracks pending edits for review. When a changed file opens, the editor shows an inline diff with overlay controls. This keeps the user in the document instead of sending them to a separate compare screen. The Chat view acts as the pending-change index and global accept/reject surface.

Cursor is similar in spirit, but the review is more agent-turn oriented: the agent response ends with a review entry point, and a floating review bar supports current-file accept/reject and navigation to the next pending file. Cursor's docs describe additions, deletions, and context lines in a familiar diff format, with selective acceptance by accepting desired lines or rejecting undesired ones before using Accept all or Reject all.

Implication: for prose review, Iliad should prefer inline review marks in the Markdown editor over a permanent side-by-side pane. The document remains the object of attention, while an auxiliary review rail can index unresolved changes.

### Split diff is useful, but mostly as an optional inspection mode

GitHub web PR review and GitHub Desktop both support unified and split diff display. GitHub Desktop added split diff explicitly because many reviewers find side-by-side comparison easier for understanding larger changes. GitHub web remembers the user's diff view choice across PRs and also supports hiding whitespace.

However, split diff consumes horizontal space and works best for code files with stable line structure. For Markdown prose, long paragraphs and soft wraps make side-by-side views noisy on smaller screens. A split view is still valuable for a "full review" mode or wide desktop layout, especially when the user wants to compare an AI rewrite against the original text.

Implication: Iliad can start with inline diff as the primary path and reserve split diff for an optional focused review view, not the default editing state.

### Green additions and red deletions remain the universal visual grammar

Every tool that exposes textual diffs uses the familiar added/deleted/context distinction. Cursor documents color-coded additions and deletions. GitHub Desktop screenshots and docs describe green additions and removed/added file indicators. GitHub PR review uses the standard green/red code review presentation. This convention matters because it compresses explanation: users already know what green and red mean.

Implication: Iliad should use standard diff colors, but keep them quieter than code tools. Markdown authors need to read prose, not inspect syntax noise. Use soft green insertion highlights, soft red deletion highlights, and a gutter/status affordance for unresolved changes.

### Accept/reject all is useful only when paired with smaller decisions

VS Code provides accept/reject all across files, but also Keep/Undo per edit and hover-level accept/reject. Cursor supports current-file accept/reject plus selective line decisions before Accept all or Reject all. GitHub suggested changes can be committed one by one or batched. GitHub Desktop supports all/file/line-level inclusion and discard.

The common pattern is not just "bulk action exists"; it is "bulk action becomes safe after the user trims exceptions." Cursor makes this explicit: reject the unwanted lines, then accept all; or accept wanted lines, then reject all.

Implication: Iliad needs three levels from the start:

- Accept/reject all pending AI changes in the note.
- Accept/reject the current change group.
- Accept/reject a specific changed paragraph, list item, or sentence where feasible.

For a minimal editor, "paragraph hunk" is likely a better first granularity than arbitrary token-level selection.

### Navigation matters as much as acceptance

VS Code has Up/Down overlay controls and can automatically reveal the next pending edit after a decision. Cursor's floating bar moves to the next file with pending changes. GitHub web offers file tree/filtering, per-file viewed state, and collapsed reviewed files. GitHub Desktop anchors navigation in the changed-file list and lets users expand hunk context.

These controls reduce the cognitive burden of finding what still needs review. They also create a task-completion loop: inspect, decide, advance.

Implication: Iliad should include a small review navigator even if the editor stays visually minimal:

- Previous/next change.
- Count of unresolved changes.
- Accept/reject current change.
- Done state when no unresolved changes remain.

For Markdown, a "viewed" state is less important than an unresolved/resolved state because the user is usually author and reviewer at once.

### Chat should propose and explain; diff should decide

The strongest tools avoid making chat the only place to inspect changes. VS Code uses Chat for the edited-file list and global actions, but the editor is where review happens. Cursor's agent response points to "Review changes" rather than burying review in the transcript. GitHub web can attach Copilot Chat to the PR for explanation, but line comments and suggestions stay in the diff. Claude Code's terminal flow is more chat/permission centered, but its Desktop product adds visual diff review for each change.

Implication: Iliad should not ask users to approve prose rewrites from a chat transcript alone. Chat can summarize intent, answer "why did this change?", and regenerate alternatives. The editor/diff surface should own acceptance, rejection, and navigation.

## Recommended Iliad Shape

### Minimal first version

Use a single Markdown editor with inline pending-change marks:

- Insertions: soft green background and an "Accept" chip on hover/focus.
- Deletions: soft red strikethrough or red block marker, with "Reject deletion" / "Accept deletion" wording made clear in UI copy.
- Replacements: display as a paired deletion plus insertion within one change group.
- Review toolbar: `Previous`, `Next`, `Accept`, `Reject`, `Accept all`, `Reject all`, unresolved count.
- Chat panel: stays beside or below the editor, but its pending-change cards jump the editor to the relevant hunk rather than duplicating the diff.

### Granularity

Treat a Markdown block as the default hunk:

- Paragraph
- Heading
- List item or contiguous list segment
- Code fence
- Table block
- Blockquote

Sentence-level controls can be added later for prose-heavy workflows, but paragraph-level review maps better to Markdown structure and avoids fragile token diff UX.

### Optional full-review mode

Add a focused review mode later:

- Unified diff by default.
- Split diff on wide screens only.
- Hide whitespace-only changes, especially for wrapping and Markdown formatter churn.
- File/note outline if Iliad later reviews multiple Markdown files.

### Safety model

Borrow the "pending edits" model from VS Code and Cursor:

- AI changes may be previewed in the editor but remain pending until accepted.
- Closing/reopening should preserve pending review state.
- Saving the note should not silently accept all AI changes unless the product explicitly defines save as acceptance.
- A source-control-style "discard pending AI changes" action should be available even if Iliad does not expose Git.

### Copy and interaction details

Avoid code-review jargon where Markdown users may not know it:

- Prefer "change" over "hunk" in UI.
- Prefer "Keep" / "Undo" for simple replacements, but use more explicit labels for deletions.
- Show "3 changes left" rather than "3 unresolved hunks."
- Keep green/red semantics, but add icons or labels so color is not the only cue.

## Product Takeaways

1. Inline review should be the default because Iliad is a writing surface, not a code review app.
2. Bulk accept/reject is necessary, but safe bulk review depends on fast per-change decisions.
3. A tiny change navigator is high leverage: it turns review into a finite checklist without adding heavy UI.
4. Chat should never be the only approval surface. It can explain, regenerate, or scope changes; the editor should decide.
5. Split diff is worth designing for, but it can wait until the core inline review loop feels trustworthy.
6. Markdown structure should define review groups. Paragraph/list/table/code-block hunks are more useful than raw line hunks for prose.
7. Pending AI edits should survive navigation and reloads until accepted or rejected, matching current expectations in VS Code-style AI editing.
