# Internal Agent Delete File Proposals

## Problem

The proposal store and review UI already support `delete_file` review items, but the internal assistant cannot reliably propose a file deletion. The model-facing transport currently teaches:

- anchored edits for targeted edits;
- `FULL_REPLACEMENT` for whole-document rewrites;
- `NEW_DOCUMENT` for new Markdown files.

It does not teach a delete-file proposal transport. When the user asks the internal assistant to delete a Markdown file, the model can only express a full replacement with empty content. Iliad then shows that as an `edit_file` whose replacement is empty, which clears the file contents instead of proposing a deletion.

## Decision

Add an explicit internal-agent delete-file proposal transport for the OpenAI legacy-marker path, and align the Codex desktop capture path so real file deletions can be converted into reviewable `delete_file` drafts safely.

The user-visible model stays the same: the assistant prepares a proposal and the user reviews it. The internal transport adds a machine-readable delete marker, for example:

```text
DELETE_DOCUMENT: teaching/workshop-plan-edit-note.md
```

Requirements:

- The parser may produce a delete intent without base content/hash; the agent service hydrates it into an `AgentDraftFileChange` with `kind: "delete_file"` before persistence.
- The deleted path must be workspace-relative, safe, visible, not ignored, and use Iliad's existing Markdown extensions.
- The marker must reject unsafe absolute paths, parent traversal, hidden path segments, non-Markdown paths, missing files, directories, and symlinks before saving a proposal.
- If the marker targets the active file, use the supplied active file snapshot as the base content/hash when the path matches.
- If the marker targets a non-active file, the agent service must read the file from the workspace before building the proposal, so the delete review can show the previous contents and can reject/restore safely.
- A delete proposal must not be represented as an empty `edit_file`.
- The assistant prompt must clearly say to use `DELETE_DOCUMENT` when the user asks to delete/remove a whole Markdown file, and not to use `FULL_REPLACEMENT` with empty content for that purpose.
- Empty `FULL_REPLACEMENT` blocks are ignored for edit proposals; a valid `DELETE_DOCUMENT` marker is required for file deletion.
- Transport cleanup must strip `DELETE_DOCUMENT` from visible assistant text, streaming cutoffs, conversation summaries, and thinking summaries.

## UI Behavior

- Internal delete proposals appear in the file tree as pending deleted files.
- The editor header shows `Pending delete: path.md`.
- The editor toolbar uses the same scoped review language as other review items:
  - `Accept changes`
  - `Reject changes`
- Accepting the proposal deletes the file if the file still matches the captured base content.
- Rejecting the proposal leaves/restores the file unchanged.

## Diagnostics

The existing agent diagnostics already records proposal kind counts. Keep or extend that so internal assistant runs that emit delete proposals include:

- `deleteFileCount`;
- proposal id;
- run id.

Add parser/provider tests that fail if delete requests become empty full replacements.

## Tests

- Parser unit test: `DELETE_DOCUMENT: path.md` becomes one `delete_file` draft.
- Parser unit test: delete markers reject unsafe paths and non-Markdown paths.
- Agent service/proposal test: non-active file delete markers read the target file and build a valid delete proposal.
- Prompt tests:
  - OpenAI local instructions mention `DELETE_DOCUMENT`;
  - Codex desktop instructions allow delete-file proposals only through safe review capture;
  - remote read-only instructions still forbid delete proposals.
- Codex file-change capture test: a deleted Markdown file becomes a `delete_file` draft and is restored to disk for review.
- Transport leakage tests: `DELETE_DOCUMENT` is stripped from visible assistant text, streaming output, conversation summaries, and thinking summaries.
- Proposal store tests already cover applying/rejecting delete files; keep them passing.

## Non-goals

- Do not add arbitrary file deletion tools outside the review proposal system.
- Do not delete files automatically during an assistant run.
- Do not support renaming files in this change.
