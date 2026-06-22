# Deterministic Review Note Policy

## Problem

Iliad can append deterministic system notes to agent chat responses after the
agent run finishes. Some of these notes describe internal reconciliation details,
such as Codex protocol conversion not supporting a delete while disk
reconciliation still produced a normal reviewable delete proposal.

That is confusing because the review UI already shows the real outcome. A user
who sees an edited file, a new file, and a deleted file in the file tree does not
need a chat note narrating one internal operation. Worse, an intermediate note
can be false by the time it reaches the user.

## Decision

Delete deterministic chat notes from the successful review path.

For this policy, a successful review path means Iliad created a reviewable
proposal that safely represents the relevant Markdown changes. A proposal is not
enough by itself if some expected change was omitted, unsafe, or impossible to
restore; those cases are actionable exceptions.

When Iliad creates a reviewable proposal, the chat transcript should only show
the normal completion text:

> I prepared a proposal. Review it in the document.

Routine proposal contents are communicated by the review UI:

- file tree badges;
- created/deleted file icons and colors;
- changed-file count;
- red/green document diff;
- file-scoped and global accept/reject controls.

Do not append chat notes for routine mechanics:

- files edited;
- files created;
- files deleted;
- files emptied;
- disk reconciliation recovered a protocol-skipped change;
- protocol and disk capture disagreed but Iliad selected a safe reviewable
  result.

## Keep Deterministic Messages Only For Actionable Exceptions

A deterministic message may be user-visible only when the user needs to know
that expected review output is missing, unsafe, or incomplete. If an actionable
exception exists alongside a proposal, it should appear as a product-level
warning near the relevant review surface, not as an implementation note appended
to the agent's chat answer.

Examples to keep:

- no proposal exists and no useful model text exists, with a clear next step;
- a requested context document could not be read before the run;
- a path was outside the workspace or unsafe;
- a non-Markdown file could not be reviewed;
- restore failed or could not be done safely;
- a read-only run attempted to change files;
- the user must save the current document before review/cancel can continue.

These exception messages should be phrased as product-level outcomes, not
implementation notes. Avoid text such as "Codex protocol" or "using disk
change" in user-visible UI.

## Logging

Internal reconciliation notes should go to diagnostics, not chat.

Diagnostics may record:

- skipped protocol change count;
- recovered-by-disk count;
- restored count;
- conflict count;
- sanitized relative path when useful and allowed by the diagnostics policy;
- the implementation reason, such as protocol delete unsupported.

## Implementation Plan

1. Update `codexFinalAssistantText` so `draftCount > 0` ignores deterministic
   routine notes and returns only proposal completion text. If later we add
   actionable exception severities, only those product-level exceptions may be
   surfaced elsewhere in the UI.
2. Keep note fallback behavior when `draftCount === 0` and the provider produced
   no raw text, so truly unrepresented runs can still explain what happened with
   a next step.
3. Stop showing successful external-capture proposal notices solely because
   `unsupportedNotes.length > 0`; a reviewable proposal is already the user-facing
   result.
4. Keep unsafe, save-required, Git-baseline-changed, no-change, and truly
   unsupported-restored notices when no proposal exists.
5. Add tests proving:
   - proposal text does not append notes when a reviewable proposal exists;
   - Spanish proposal text follows the same rule;
   - notes remain visible when there is no proposal and no raw answer;
   - external capture with a proposal and unsupported notes does not show the
     "unsupported restored" notice.

## Non-Goals

- Do not remove diagnostics.
- Do not change proposal creation, review, accept, or reject semantics.
- Do not hide true failures.
- Do not change agent-authored text. This policy only applies to deterministic
  system notes appended by Iliad.
