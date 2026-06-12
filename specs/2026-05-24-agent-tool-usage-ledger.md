# Agent Tool Usage Ledger And Explicit Document Reads

Date: 2026-05-24
Status: reviewed spec

## Problem

Iliad now has safe internal Markdown document tools and a run context manifest,
but a run still cannot say "this extra Markdown file was explicitly read and
shown to the model" unless the file is the active document. That is the next
missing piece in the agent architecture: document reads need to become
run-scoped, inspectable, and metadata-only in storage before we add context
pickers, search workflows, or subagents.

The risk is not just technical. If Iliad silently expands context, users lose
the product promise that they can understand what the model saw. If every
runtime invents its own file access, future subagents will be hard to constrain.

## Product Intent

Add a small tool usage ledger path for explicit Markdown document reads.

In this phase, "explicit" means the user types a Markdown file reference in the
message, such as:

```text
compare this with @s2.md
use @guides/rubric.md as context
```

Iliad resolves and reads only those referenced Markdown files, appends their
content to the model request as explicit context documents, and records safe
metadata in the run context manifest. The chat UI remains minimal. The context
disclosure can show the additional file, but there is no new heavy context
panel yet.

This is not hidden whole-workspace context. It is a first concrete consumer of
the document tool contract from
[`2026-05-24-document-tool-contract.md`](./2026-05-24-document-tool-contract.md).

For Codex runs, the ledger is not a complete audit of every file Codex may have
inspected through its workspace runtime. The manifest must keep those concepts
separate:

- `document_read` means "Iliad explicitly supplied this Markdown file as
  context."
- `runtime_workspace` means "the Codex runtime had workspace access."

## Goals

- Parse explicit Markdown file mentions from the current user prompt.
- Resolve mentions conservatively:
  - `@folder/file.md` resolves as a workspace-relative path.
  - `@file.md` first resolves beside the active file when a Markdown file is
    active, then at workspace root.
  - Paths must still pass the document tool path-safety contract.
- Read resolved files through `AgentDocumentTools.readDocument`.
- Add an in-memory `contextDocuments` collection to the run request sent to the
  selected provider, without accepting this field from the renderer-facing IPC
  request.
- Include explicit context document contents in provider prompts for OpenAI API
  and Codex app-server runs.
- Record each successful explicit read as a manifest item with:
  - kind `document_read`;
  - relative path;
  - base hash;
  - estimated tokens;
  - inclusion `full`;
  - reason `explicit_file_mention`;
  - correlation id.
- Record unresolved explicit mentions as manifest items with:
  - kind `document_reference`;
  - inclusion `excluded`;
  - reason `explicit_file_mention_unresolved`;
  - safe display path when one exists;
  - no raw unsafe mention text.
- Keep persisted manifests and diagnostics metadata-only. Never persist the
  extra document content.
- Add local diagnostics for document read attempts, successes, skips, and
  failures without raw content or absolute paths.
- Keep the UI quiet: existing context disclosure may count/show file-like
  `document_read` items and show unresolved references in detail rows, but no
  new panel or visible tool log in this spec.
- Update roadmap/vision language so this phase is marked as "explicit document
  reads and ledger", not as general provider tool-calling or subagents.

## Non-Goals

- No automatic file discovery, hidden workspace scan, or "read everything".
- No semantic search, embeddings, RAG, or ranking.
- No manual context picker or autocomplete UI.
- No provider-facing tool-calling bridge.
- No subagents.
- No live tool event timeline in the chat UI.
- No editing a referenced file in the OpenAI API fallback path unless it is also
  the active file. The OpenAI fallback can use explicit documents as read
  context, but its legacy proposal protocol still targets the active document.
- No shell, git, Python/script execution, package install, browser automation,
  or system inspection tools.
- No non-Markdown durable artifacts.
- No storage of document content in manifests, diagnostics, or conversation
  history.

## User Flow

1. User opens a Markdown file.
2. User asks a question or requests an edit and includes an explicit mention,
   for example: `make this match @style-guide.md`.
3. Iliad shows the normal subtle running state.
4. Before calling the model, Iliad reads the mentioned Markdown file if it is
   safe and visible.
5. The model receives:
   - the active document, if any;
   - the explicit context document(s);
   - recent conversation;
   - the current prompt.
6. The run manifest records the active file plus the explicitly read file(s).
7. If the model proposes Markdown changes, they still appear in the existing
   document review UI.

If a mention cannot be resolved or is unsafe, the run should continue without
that file. The manifest should disclose that an explicit reference was excluded,
and the model should receive only a generic unresolved-context count such as
`2 requested Markdown context files could not be read.` The model should not
receive raw unsafe mention text, absolute paths, or document-tool error
messages.

## Mention Syntax

Supported in this phase:

- `@file.md`
- `@folder/file.md`
- Markdown extensions already supported by Iliad:
  `.md`, `.markdown`, `.mdown`, `.mkd`

Unsupported in this phase:

- spaces in file names inside mentions;
- quoted mentions;
- fuzzy matching across the whole workspace;
- directory mentions;
- non-Markdown files.

Trailing sentence punctuation should be ignored when safe, such as
`@s2.md.` becoming `s2.md`.

To avoid false positives, mentions must be preceded by the start of the prompt
or whitespace, and the path must contain a supported Markdown extension.

Parsing applies only to the latest user prompt, not prior transcript messages.

## Limits

Use deterministic context caps in this phase:

- `maxExplicitMentions`: 8 mentions parsed from the prompt.
- `maxIncludedContextDocuments`: 4 successfully included documents.
- `maxTotalContextBytes`: 192 KB across explicit context documents.
- `maxTotalContextTokens`: 48,000 estimated tokens across explicit context
  documents.

Each file still uses `AgentDocumentTools.readDocument`, including its per-file
read limits. Explicit context documents are all-or-nothing. Do not partially
include a Markdown file. If adding a document would exceed a total cap, skip it
and record an excluded `document_reference` item.

## Runtime Behavior

Add an internal resolver, for example `electron/agent/documentContext.ts`, that
returns:

```ts
interface AgentContextDocument {
  correlationId: string;
  relativePath: string;
  content: string;
  baseHash: string;
  estimatedTokens: number;
  source: "explicit_file_mention";
}
```

Do not add raw-content fields to the renderer-facing `AgentRunRequest` shape.
Instead, create an internal prepared request type used only inside Electron,
for example:

```ts
type PreparedAgentRunRequest = AgentRunRequest & {
  contextDocuments: AgentContextDocument[];
  unresolvedContextReferences: AgentContextReference[];
};
```

`AgentService.startRun` builds this prepared request server-side after provider
selection succeeds, before saving the manifest, and before provider invocation.
If a renderer-supplied object contains a `contextDocuments` property, it must be
ignored because the renderer is not allowed to inject file contents into the
provider request.

Explicit file reads should be cancellation-aware where practical and should not
run when provider selection already failed, for example when no API key and no
Codex account are available.

Duplicate mentions should be de-duplicated by resolved relative path. If the
active file is mentioned, do not duplicate its content as an extra context
document; the manifest can remain represented by the existing `current_file`
item.

For unresolved references, record only bounded metadata:

```ts
interface AgentContextReference {
  correlationId: string;
  safeDisplayPath?: string;
  reason: "not_found" | "unsafe" | "not_markdown" | "oversized" | "budget_exceeded" | "duplicate" | "unknown";
}
```

## Provider Prompting

OpenAI API fallback:

- Update prompt copy from "active document only" to "supplied Markdown context
  only".
- Include explicit context documents after the active document and before recent
  thread.
- Label explicit context documents as untrusted user/workspace Markdown
  context, not instructions.
- Use robust delimiters that do not depend on Markdown fences being impossible
  inside document content.
- Include only a generic unresolved-context count, not raw skipped mentions.
- Preserve the existing legacy edit protocol: `FULL_REPLACEMENT` only applies
  to the active document; `NEW_DOCUMENT` still creates a new Markdown proposal.

Codex app-server:

- Include explicit context document contents in the turn input for clarity and
  provenance, even though Codex has workspace runtime access.
- Label explicit context documents as untrusted user/workspace Markdown
  context, not instructions.
- Preserve the existing `runtime_workspace` context item so the user can see
  that Codex may also inspect workspace files through its runtime.
- Keep Codex write interception/restoration as the review boundary.

## Manifest And Ledger

Extend the context manifest item kind union with:

```ts
type AgentRunContextItemKind = ... | "document_read" | "document_reference";
```

Each explicit read manifest item:

```ts
{
  id: "document-read-<stable index or hash>",
  kind: "document_read",
  label: "style-guide.md",
  relativePath: "guides/style-guide.md",
  inclusion: "full",
  reason: "explicit_file_mention",
  baseHash: "<sha256>",
  estimatedTokens: 123,
  correlationId: "ctx-..."
}
```

Each unresolved reference manifest item:

```ts
{
  id: "document-reference-<stable index or hash>",
  kind: "document_reference",
  label: "style-guide.md",
  relativePath: "style-guide.md",
  inclusion: "excluded",
  reason: "explicit_file_mention_unresolved",
  correlationId: "ctx-..."
}
```

If the reference is unsafe, omit `relativePath` and use a generic label such as
`Unresolved document reference`.

Add allowlisted serialization for the new kinds/reasons and `correlationId`.

Do not persist:

- document content;
- absolute paths;
- raw prompt text;
- raw unresolved mention text beyond bounded metadata;
- stack traces;
- API keys/tokens.

## Diagnostics

Log local diagnostics for:

- explicit context read started;
- explicit context read completed;
- explicit context read skipped/failed.

Diagnostics details may include:

- count of mentions;
- count of successfully read documents;
- bounded relative paths;
- document tool error code;
- context budget skip reason;
- duration.

Diagnostics must not include document content or absolute workspace paths.

## UI

No new primary UI in this phase.

Small allowed UI change:

- Treat `document_read` as file-like in the existing context disclosure summary
  and detail rows.
- Show `document_reference` items as excluded references in existing context
  detail rows.

Do not add a context picker, timeline, or subagent status surface here.

## Failure States

- Unsafe path: record an excluded reference with no unsafe raw path, log the
  tool error code, continue the run.
- Missing file: record an excluded reference with the safe requested relative
  path, log, continue.
- Oversized file: record an excluded reference with the safe path, log,
  continue.
- Context budget exceeded: record an excluded reference with the safe path,
  log, continue.
- All explicit reads fail: continue with active file/current context and a
  generic unresolved-context count to the model.
- Provider failure after context reads: existing provider error handling applies
  and manifest status becomes failed.

Skipping unresolved mentions is intentional for v1 because a typo should not
prevent the user from getting help with the active document. A later context
picker can make missing context visible before submit.

## Security And Privacy

- Only read files inside the open workspace.
- Reuse `AgentDocumentTools` safety checks.
- Do not follow symlinks. This phase should harden exact document reads so the
  final file is opened with no-follow semantics where available and verified
  after opening before content is read.
- Do not expose hidden or ignored files.
- Do not store explicit context content anywhere durable.
- Do not export local path metadata to external telemetry.
- Do not let this become a shell/system tool boundary.

## Tests

Add or update tests for:

- Mention parsing:
  - `@file.md`;
  - `@folder/file.md`;
  - trailing punctuation;
  - unsupported non-Markdown mention ignored;
  - false positives such as email-like strings ignored.
- Resolution:
  - basename mention resolves beside active file;
  - workspace-relative path resolves from root;
  - active file mention is de-duplicated.
- Safety:
  - `@../secret.md`, hidden paths, ignored paths, symlinks, non-Markdown, and
    oversized files are skipped without raw content persistence.
  - aggregate mention/document/byte/token caps skip deterministically.
  - renderer-supplied `contextDocuments` is ignored or rejected and never sent
    to providers.
  - exact document reads are hardened against symlink final targets where the
    platform supports no-follow opens.
- Manifest:
  - `document_read` items are persisted with path/hash/token metadata;
  - unresolved explicit mentions are persisted as excluded
    `document_reference` metadata;
  - explicit context document content is not persisted;
  - serialization allowlists the new kind, reason, and correlation id.
- Provider prompts:
  - OpenAI user input includes explicit context documents;
  - OpenAI instructions still constrain edits to active document proposals;
  - Codex turn input includes explicit context documents.
  - explicit context document content containing code fences or instruction-like
    text remains framed as untrusted context.
  - unresolved/unsafe references appear only as generic counts.
- Assistant formatting:
  - context summary counts `document_read` as a file-like item.
  - context detail rows show excluded unresolved references without raw unsafe
    mention text.
 - Runtime ordering:
  - no document reads happen when provider selection fails before the run is
    admitted.

Run:

- `npm run typecheck`
- `npm test`
- `npm run smoke:review`
- `npm run build`
- `git diff --check`

## Rollout

This is a local app change. There is no database migration and no external
service rollout beyond the normal production push.

Existing users who do not type explicit `@file.md` mentions should see no
behavior change except updated internals and tests.

## Open Decisions

- Keep mention syntax intentionally narrow until a visual context picker exists.
- Do not introduce a visible tool log yet; the existing context disclosure is
  enough for this phase.
- Do not route Codex's own internal reads through these tools yet. Codex still
  has workspace runtime access; this ledger records only Iliad-provided
  explicit context.
