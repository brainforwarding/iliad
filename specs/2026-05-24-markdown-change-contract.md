# Markdown Change Contract

Date: 2026-05-24
Status: reviewed spec

## Problem

Iliad's roadmap and vision currently describe separate agent capabilities for
editing one document, creating a new document, and proposing multi-file changes.
That wording is too close to a tool-per-artifact architecture, even though the
implemented proposal model already treats all reviewable document work as one
proposal containing file-level operations.

This matters because the product direction is intentionally simple: Iliad is a
Markdown workspace. A rubric, handout, deck outline, course map, or annex is a
Markdown file. The agent should not need different durable artifact tools for
those cases, and "create a document" should not be a magical edit to a path
that does not exist.

## Product Intent

Define one internal normalized review-first Markdown change contract:

```text
propose_markdown_changes(changes[])
```

Each change inside the proposal is explicit:

- `edit_file`: revise an existing Markdown file from known base content.
- `create_file`: create a new Markdown file with proposed content.

For this spec, `propose_markdown_changes` is not a new provider-facing tool and
not a new renderer API. It is the product name for the proposal shape Iliad
already uses internally: one proposal containing explicit file operations. A
future provider-facing tool can reuse this contract later, but that is outside
this implementation.

This keeps the agent surface small while preserving the important distinction
between modifying an existing source file and creating a new source file.

## Goals

- Update the roadmap and vision docs so they describe one Markdown proposal
  contract, not separate top-level tools for edits, new docs, and multi-file
  changes.
- Make new document creation an explicit `create_file` operation inside a
  proposal.
- Keep multi-file work as repeated `edit_file` and `create_file` operations in
  one proposal, not a separate write primitive.
- Extract proposal construction from `AgentService` into a small,
  unit-tested contract module.
- Preserve the existing review UI, proposal storage, Codex proposal bridge, and
  OpenAI API fallback behavior.
- Make assistant copy consistent with the contract: multi-file changes should
  be described as one proposal containing multiple file changes, not as
  multiple proposals.
- Add focused tests proving mixed edit/create changes become one proposal with
  explicit file operation kinds.
- Avoid duplicate durable schemas or parallel renderer contract names.

## Non-Goals

- No new UI.
- No new provider API calls.
- No provider-facing `propose_markdown_changes` tool in this spec.
- No renderer contract rename.
- No new persisted proposal schema.
- No manual context picker, `@file`, search tool, or subagent runtime in this
  spec.
- No broad rename of persisted proposal JSON fields.
- No deletion, move, rename, binary file, or non-Markdown operations.
- No general computer-agent tools such as shell, git, Python, package install,
  browser automation, or arbitrary system inspection.
- No separate tools such as `create_rubric`, `create_handout`, or
  `create_slide_deck`.

## Contract

The conceptual contract is:

```ts
interface ProposeMarkdownChanges {
  changes: MarkdownChangeOperation[];
}

type MarkdownChangeOperation = EditFileOperation | CreateFileOperation;

interface EditFileOperation {
  kind: "edit_file";
  relativePath: string;
  baseHash: string;
  baseContent: string;
  replacement: string;
  unifiedDiff: string;
  summary: string;
}

interface CreateFileOperation {
  kind: "create_file";
  relativePath: string;
  content: string;
  unifiedDiff: string;
  summary: string;
}
```

This is explanatory pseudocode. The current `AgentDraftFileChange[]` type is
already the implementation payload and should be reused. This spec should not
add duplicate `MarkdownChangeOperation` types unless they are aliases or
documentation comments around the existing type. The important change is to make
the contract explicit and centralize the conversion from draft operations into a
persisted `AgentChangeProposal`.

## System Flow

1. A provider returns zero or more `AgentDraftFileChange` operations.
2. If there are no operations, no proposal is saved.
3. If there are operations, Iliad creates exactly one
   `AgentChangeProposal` for the run.
4. Each operation becomes one `AgentProposalFileChange`:
   - `edit_file` keeps base content, base hash, replacement, and diff.
   - `create_file` keeps proposed content and diff.
5. The proposal store adds/rebuilds hunks for edit operations as it does today.
6. The document review UI shows changes from the proposal store.
7. Files are changed on disk only when the user accepts the proposal, a file,
   or a hunk.

## Path And Review Rules

- Paths are workspace-relative Markdown paths.
- Hidden paths, absolute paths, parent traversal, and non-Markdown paths remain
  invalid at the existing capture/conversion/apply boundaries.
- The product Markdown extension set is the existing workspace set:
  `.md`, `.markdown`, `.mdown`, and `.mkd`. Some provider-specific adapters may
  be narrower temporarily, but the shared contract should not invent a new
  extension set.
- The new pure proposal builder assumes provider/capture code has already
  produced valid draft operations. It should not read the filesystem or add a
  second path-validation layer.
- Creating a new file must use `kind: "create_file"`.
- Editing a missing file should fail before proposal creation, during capture,
  or during apply as a stale/failed proposal. It should not silently become a
  create operation.
- Creating an already existing file may be rejected early by provider adapters
  that can see the workspace snapshot. If it reaches proposal storage, it must
  fail when the user applies it rather than overwriting the existing file.
- Multi-file course work is represented as one proposal with many file changes.

## Documentation Updates

Update:

- `docs/agent-runtime-roadmap.md`
- `docs/agent-vision.md`
- `docs/architecture.md`
- The tool section in `specs/2026-05-23-agent-context-management.md`, as a
  superseded note rather than a rewrite of the old spec.

The docs should describe:

- Read/search/list tools can be separate later because they gather context.
- Write intent flows through one `propose_markdown_changes` contract.
- The contract supports both existing and new Markdown files.
- Rubrics, handouts, session guides, deck contents, and other durable outputs
  are just Markdown files.

## Implementation

Add `electron/agent/markdownChangeContract.ts` with pure helpers:

- `buildMarkdownChangeProposal(...)`
- `markdownChangeProposalTitle(...)`
- `markdownChangeProposalSummary(...)`

`buildMarkdownChangeProposal` should accept the run request, model, response id,
source, draft operations, and an optional clock. It returns
`AgentChangeProposal | null`.

The proposal summary uses the first non-empty draft summary as the run summary,
matching current behavior. File-level summaries stay on transient draft
operations only; they are not added to the persisted file schema in this spec.

Update `AgentService.saveDraftProposals` to call the helper and then persist the
returned proposal with `AgentProposalStore`.

Keep `proposalSourceFromProviderResponse` in `AgentService` because it is about
runtime provider selection, not the Markdown proposal contract.

Do not implement list/read/search tools here. Those are future context tools.
This spec only consolidates the write-proposal contract that already exists.

## Tests

Add `tests/agent/markdownChangeContract.test.ts` covering:

- Empty draft operations return `null`.
- One `edit_file` draft becomes one proposal file with `kind: "edit_file"`.
- One `create_file` draft becomes one proposal file with
  `kind: "create_file"`.
- Mixed edit/create drafts become one proposal with both explicit operations.
- A create operation is never converted to an edit operation.
- Proposal title and summary remain stable for single-file and multi-file
  proposals.
- Codex provider assistant copy for multi-file draft operations says one
  proposal was prepared, not `N` proposals.

Run:

- `npm run typecheck`
- `npm test`
- `npm run smoke:review`
- `npm run build`
- `git diff --check`

## Rollout

This is an internal architecture and documentation cleanup. It should not
change visible UI or proposal behavior. Existing pending proposals remain
compatible because persisted proposal file kinds already use `edit_file` and
`create_file`.

## Decisions

- `propose_markdown_changes` is internal in this spec.
- Provider-facing document tools remain future work.
- Existing `AgentDraftFileChange[]` and persisted proposal file kinds are the
  implementation contract.
- Validation remains in provider parsing, Codex capture/conversion, proposal
  apply, and path-safety helpers. The new builder stays pure.
- Per-file `summary` remains transient draft metadata. Persisting per-file
  summaries requires a separate UI/storage decision.
