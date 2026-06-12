# Document Tool Contract

Date: 2026-05-24
Status: reviewed spec

## Problem

Iliad now has the right write-side shape: all model-authored document changes
flow through one review-first Markdown proposal contract with explicit
`edit_file` and `create_file` operations. The read-side is still less formal.
The roadmap says the agent should have narrow document tools, but today there
is no single typed contract for listing, reading, or searching Markdown files
inside the open workspace.

Without that contract, future context selection, subagents, and evented runs
will either keep relying on provider-specific workspace behavior or grow
ad-hoc file access in multiple places. That would make it harder to keep
Iliad's agent constrained to writing work and harder to explain what context a
run used.

## Product Intent

Create a small internal document tool contract for Markdown context:

```text
list_documents
read_document
search_documents
```

These are read-only context tools. Write intent remains the separate
review-first proposal contract from
[`2026-05-24-markdown-change-contract.md`](./2026-05-24-markdown-change-contract.md).

This spec implements the local, safe, typed tool surface. It does not yet add a
manual context picker, a visible tool log, subagents, or provider tool-calling.
Those later pieces should call this contract instead of inventing their own
file access.

This phase constrains only Iliad-owned document APIs. It does not remove or
narrow Codex's current broad workspace runtime access. Until future runtime
work routes Codex reads through evented document tools, the context manifest
must continue treating Codex workspace access as broad runtime availability,
not as file-level read provenance.

## Goals

- Add a typed `AgentDocumentTools` module under `electron/agent/`.
- Implement safe, bounded `listDocuments`, `readDocument`, and
  `searchDocuments` functions for Markdown files inside the open workspace.
- Add a small read-limit options object. Defer worker permissions and
  allowed-tool envelopes until provider tool-calling or subagents exist.
- Keep all paths workspace-relative, visible, non-hidden, non-symlinked, and
  Markdown-only, including ignored-directory segments.
- Reuse the existing Markdown extension set:
  `.md`, `.markdown`, `.mdown`, `.mkd`.
- Keep returned paths slash-normalized and deterministic.
- Add deterministic tests for path safety, listing, reading, searching,
  ignored directories, symlinks, limits, and metadata privacy.
- Update docs/roadmap language so this step is marked as an internal
  foundation, not a finished subagent/runtime tool UI.

## Non-Goals

- No new assistant UI.
- No automatic whole-workspace context injection.
- No `@file` mentions or manual context picker.
- No provider-facing OpenAI tool calls in this spec.
- No custom Codex app-server tool bridge in this spec.
- No automatic integration into `AgentService.startRun`.
- No conversation history changes.
- No subagent implementation.
- No `AgentRunRequest` or renderer type changes.
- No shell, git, package-manager, Python/script execution, browser automation,
  arbitrary MCP connector access, or system inspection.
- No non-Markdown durable artifact types.
- No delete, rename, move, binary, image, or asset tools.

## Tool Contract

Use these conceptual names, implemented as TypeScript functions rather than
provider-facing tool calls in this phase.

```ts
interface AgentDocumentToolLimits {
  maxListResults: number;
  maxReadBytes: number;
  maxSearchResults: number;
  maxSearchFiles: number;
  maxDepth: number;
  maxDirectories: number;
  maxFilesystemEntries: number;
  maxExcerptChars: number;
}

list_documents(input?: {
  directory?: string;
  depth?: number;
  limit?: number;
}): {
  files: Array<{
    relativePath: string;
    name: string;
    sizeBytes: number;
    estimatedTokens: number;
  }>;
  truncated: boolean;
  skipped: {
    ignored: number;
    unsafe: number;
    unreadable: number;
    oversized: number;
    nonMarkdown: number;
    symlink: number;
  };
}

read_document(input: {
  path: string;
}): {
  relativePath: string;
  hash: string;
  content: string;
  sizeBytes: number;
  estimatedTokens: number;
}

search_documents(input: {
  query: string;
  limit?: number;
}): {
  matches: Array<{
    relativePath: string;
    line: number;
    matchType: "path" | "content";
    excerpt: string;
  }>;
  truncated: boolean;
  searchedFiles: number;
  skipped: {
    ignored: number;
    unsafe: number;
    unreadable: number;
    oversized: number;
    nonMarkdown: number;
    symlink: number;
  };
}
```

The actual implementation may use more specific TypeScript names such as
`listDocuments`, `readDocument`, and `searchDocuments`.

Types should live in the new `electron/agent/documentTools.ts` module unless
the implementation becomes large enough to warrant a sibling
`documentToolTypes.ts`. Do not expand `AgentRunRequest`, `AgentRunEvent`, or
renderer types in this phase.

## Path Safety Rules

- All user/model/tool paths are POSIX-style workspace-relative strings.
- Root listing is represented by omitted `directory`, not `""`.
- Raw path inputs are syntactically validated before being joined to
  `workspaceRoot`.
- Reject POSIX absolute paths, Windows drive paths, UNC paths, backslashes,
  repeated slashes, trailing slashes for file reads, empty segments, `.`, `..`,
  hidden segments, ignored segments, NUL/control characters, and any path whose
  normalization would change the user's input.
- Use one shared document-path resolver for all three tools.
- The resolver joins the validated relative path to `workspaceRoot`, then
  checks each ancestor segment and the final target with `lstat`.
- Symlinks are not followed. `read_document` rejects symlink ancestors and
  symlink files. `list_documents` and `search_documents` skip symlinked files,
  symlinked directories, and broken symlinks.
- Ignored directories use the existing `ignoredNames` set and are rejected or
  skipped for every tool, including direct `read_document`.
- Only files with the existing `markdownExtensions` set are visible to these
  tools.
- `read_document` must reject directories, non-existing files, non-Markdown
  files, hidden paths, and symlinks.
- `list_documents` and `search_documents` must skip unreadable files rather
  than fail the whole run, unless the root/directory input itself is invalid.
- All returned paths use slash separators and are sorted with a
  locale-independent comparator before applying limits.

## Limits

Defaults should be conservative but useful:

- `maxListResults`: 500
- `maxReadBytes`: 512 KB
- `maxSearchFiles`: 500
- `maxSearchResults`: 50
- `maxExcerptChars`: 240
- `maxDepth`: 2
- `maxDirectories`: 200
- `maxFilesystemEntries`: 2,000
- `depth`: default `1`, clamped to `maxDepth`.

Reject negative, non-integer, `NaN`, or infinite numeric inputs. Clamp positive
`limit` and `depth` to the configured maxima. Return `truncated: true` when a
result or traversal cap is hit.

If a file is larger than `maxReadBytes`, `read_document` should fail with a
clear error. It should not silently truncate exact Markdown because future edit
proposals need exact base content. Search can inspect only files under the byte
limit and skip oversized files.

`list_documents` must not read file contents. Its token estimates should come
from `lstat.size` only. `read_document` and `search_documents` check byte size
before reading.

## Search Behavior

Keep search simple and deterministic:

- Normalize query whitespace.
- Split query into case-insensitive terms.
- Match if all terms appear in the file path or in a single line.
- Path matches use `line: 0`, `matchType: "path"`, and the relative path as the
  excerpt.
- Content matches use one-based line numbers and `matchType: "content"`.
- Return at most one path match per file. Content matches may also appear for
  the same file if matching lines exist.
- Return path matches before content matches, then sort by normalized relative
  path and line number.
- Excerpts should be single-line, whitespace-compacted, and bounded.
- Empty queries should return no matches, not the whole workspace.

This is not semantic search, embeddings, RAG, or ranking. Those can be separate
future features.

## Runtime Integration

Phase 1 creates the module and contract only. It should not change the visible
chat flow.

Add a factory such as:

```ts
createAgentDocumentTools({ workspaceRoot, limits, onToolEvent? })
```

Tool events should be metadata-only and safe to send to diagnostics or future
run events:

- tool name;
- status;
- result counts;
- relative paths only when the event is stored locally for user-inspectable
  manifests or ledgers;
- duration;
- error code/message without raw stack traces.

Do not persist document content in diagnostics, tool events, or context
manifests. Relative paths can also be sensitive; do not export them to crash
logs, provider telemetry, or external diagnostics unless a future spec adds
explicit redaction and user-visible rationale.

When a future runtime actually uses these tools to gather context, each tool
call must produce a manifest/ledger item with:

- tool name;
- correlation id;
- query or directory metadata;
- result count;
- relative paths surfaced to the model;
- read hashes and token estimates for exact reads;
- no document content.

`AgentService` does not need to invoke these tools automatically in this spec.
Future specs can wire them into provider tool-calling, explicit context
selection, or subagents.

## Tests

Add tests for:

- Listing Markdown documents recursively while skipping hidden folders,
  `node_modules`, `dist`, `dist-electron`, non-Markdown files, and symlinks.
- Listing from a subdirectory and respecting `depth` and `limit`.
- Listing uses size-based token estimates without reading file contents.
- Reading a Markdown document returns exact content, hash, byte size, and token
  estimate.
- Reading rejects absolute paths, `..`, hidden paths, backslashes,
  ignored-directory paths, non-Markdown files, directories, missing files,
  symlink ancestors, symlink files, broken symlinks, and oversized files.
- Searching by file name and line content returns bounded deterministic matches.
- Empty search query returns no matches.
- Search skips oversized or unreadable files without failing.
- Numeric limits reject invalid inputs, clamp valid inputs, and set
  `truncated` when caps are hit.
- Windows drive/UNC paths, repeated slashes, trailing file-read slashes, `.`
  segments, and NUL/control characters are rejected.
- Tool events contain metadata only and do not include document content.

Run:

- `npm run typecheck`
- `npm test`
- `npm run smoke:review`
- `npm run build`
- `git diff --check`

## Rollout

This is an internal foundation. Existing users should see no UI change. The
main behavior change is that future code now has one safe document-tool module
to call.

## Decisions

- Keep exact document reads exact; do not truncate reads for edit context.
- Do not auto-search or auto-attach workspace files yet.
- Do not expose provider-facing tool calls yet.
- Keep write intent on `propose_markdown_changes`.
- Keep `propose_markdown_changes` as a separate contract; this spec implements
  read tools only.
- Keep the tool contract Markdown-only.
