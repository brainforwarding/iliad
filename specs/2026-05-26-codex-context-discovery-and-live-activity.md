# Codex Context Discovery And Live Activity

Date: 2026-05-26

Status: implemented.

Review status: reviewed by architecture/UX agents and one focused spec
reviewer. Feedback accepted where it improves safety, correctness, or test
coverage; scope-expanding suggestions are deferred.

## Problem

Codex can already call Iliad-owned Markdown document tools, but two things are
not good enough yet:

1. Discovery can miss the file the user means.
2. The UI does not show an ordered live trail of what Codex is doing.

The concrete failure case is:

```text
User: el curso de odisea, la sesion 1, necesita algun ajuste?
```

The workspace has material under a folder like:

```text
curso-odisea/
  curso-1/
    s1/
      s1.md
```

Before this change, the `search_documents` tool searched paths and content, but
it first collected Markdown candidates with `maxDepth: 2`. From the workspace
root, that could reach `curso-odisea/curso-1/` but not
`curso-odisea/curso-1/s1/s1.md`. So the model could search and still never see
the target file.

Before this change, the UI also showed only final, generic receipts such as:

```text
Document search
Document list
```

That is too vague. Users need a live, ordered, metadata-only activity trail like
Codex and Claude Code:

```text
Searching documents for "odisea session 1"
Found curso-odisea/curso-1/s1/s1.md
Reading curso-odisea/curso-1/s1/s1.md
```

This is not hidden chain-of-thought. It is visible tool activity.

## Goals

- Make Codex document discovery find deeply nested Markdown course/session
  files by path before spending time on content search.
- Support common course/session aliases:
  `sesion 1`, `sesión 1`, `session 1`, `s1`, `curso 1`, and `curso-1`.
- Keep document tools safe: Markdown-only, workspace-relative, no hidden or
  ignored paths, no symlinks, bounded traversal, bounded content reads.
- Add a live, ordered, metadata-only activity stream during an agent run.
- Keep final context receipts compact, but make them more informative for
  search/list/read tool activity.
- Avoid persisting activity rows in chat history.
- Preserve current explicit `@file.md` and file-chip behavior.

## Non-Goals

- No web search.
- No shell tool.
- No generic filesystem tool.
- No embeddings or semantic index in this version.
- No pinned context or automatic carryover of files from earlier turns.
- No display of model hidden chain-of-thought.
- No raw document content, excerpts, absolute paths, tool payloads, Codex thread
  ids, or prompts in UI activity rows.

## Previous Code Facts

- Codex dynamic Markdown tools already existed. `CodexAppServerRuntimeProvider`
  passes `dynamicTools` to the Codex app-server thread and handles
  `item/tool/call`.
- `search_documents` previously:
  - collects Markdown files from the workspace root at `limits.maxDepth`;
  - sorts them;
  - slices to `limits.maxSearchFiles`;
  - reads each candidate;
  - only then checks whether the path matches;
  - then scans content lines.
- `defaultAgentDocumentToolLimits.maxDepth` was `2`.
- Tool diagnostics were logged, but renderer run events only exposed phase,
  legacy status, and thinking-summary events.
- Context manifest tool rows were merged after provider completion or failure.

## Implemented Behavior

- Codex and OpenAI provider paths both use Iliad-owned Markdown document tools:
  `list_documents`, `search_documents`, and `read_document`.
- `search_documents` now checks path metadata before content. Path discovery can
  go deeper than content search and does not require reading file contents.
- The path matcher normalizes accents and separators and handles common
  course/session aliases such as `sesión 1`, `session 1`, `s1`, and `curso-1`.
- Search receipts distinguish path metadata checks (`searchedPaths`) from
  content scans (`searchedFiles`).
- Codex runs emit metadata-only live activity rows for document search/list/read
  work and final context receipts record the files and tool activity.

## User Flow

### Successful Discovery

```text
User sends:
do you think the first session of curso odisea needs work?

UI live trail:
Searching documents for "curso odisea session 1"
Found curso-odisea/curso-1/s1/s1.md
Reading curso-odisea/curso-1/s1/s1.md

Assistant answers from the style guide plus the read Odisea session.

Final receipt:
Contexto: 2 archivos + acceso al espacio de trabajo
- agent-docs/guia-estilo-sesion.md
- curso-odisea/curso-1/s1/s1.md
- Document search: 3 matches, 499 files searched
- Codex · gpt-5.5
```

### Failed Or Ambiguous Discovery

```text
UI live trail:
Searching documents for "odisea session 1"
No matching document found
```

The assistant should ask a focused clarification rather than guessing from the
style guide alone.

## Backend Design

### Path-First Search

`search_documents` should split discovery into two phases:

1. Path metadata search.
2. Content search.

Path search must:

- traverse deeper than content search, using the same safety checks;
- not require reading file content;
- include path matches for oversized Markdown files;
- rank path matches before content matches;
- search the full safe path, path segments, and basename/stem.

Content search may stay more conservative:

- only read bounded Markdown candidates;
- respect `maxReadBytes`;
- stop at bounded traversal and result limits.

### Limits

Add separate search limits so path discovery can be deeper without making
content search expensive:

```ts
maxContentSearchDepth: number;
maxPathSearchDepth: number;
maxPathSearchFiles: number;
maxContentSearchFiles: number;
```

For this version:

- path search depth should allow normal course folder structures, at least
  `6`;
- content search can remain shallower or share existing caps;
- total directory and filesystem-entry caps still apply.

Existing `maxDepth` remains for list operations and backward compatibility.

### Search Count Semantics

`searchedFiles` currently means "files whose content was read and scanned." That
becomes misleading once path-first search can inspect paths without reading
contents.

Keep `searchedFiles` backward-compatible as the number of files whose content
was scanned. Add:

```ts
searchedPaths: number;
```

`searchedPaths` means Markdown path metadata candidates inspected by path search.
UI activity and final receipts may show both:

```text
3 matches, 842 paths checked, 200 files searched
```

If only one count fits, prefer `searchedPaths` for path-discovery rows because
that is what answers "did it look through folder/file names?"

### Alias Matching

Normalize path and query matching with:

- lowercase;
- accent folding;
- separator folding (`-`, `_`, `/`, whitespace);
- session aliases:
  - `sesion 1`
  - `sesión 1`
  - `session 1`
  - `s1`
- course aliases:
  - `curso 1`
  - `course 1`
  - `curso-1`

The implementation should be deterministic and conservative:

- exact normalized term matches rank highest;
- alias matches rank below exact path/stem matches;
- ambiguous top matches should remain visible to the model so it can ask a
  focused clarification.

Practical v1 algorithm:

- tokenize normalized query into words and numbers;
- tokenize normalized path into words and numbers, preserving joined forms such
  as `s1` and `curso1`;
- expand query phrases so `sesion 1`, `sesión 1`, and `session 1` can also
  match `s1`;
- expand `curso 1` and `course 1` so they can also match `curso1` or
  `curso-1`;
- require every non-alias query token to match somewhere in the path or content
  target.

The key regression is combined matching:

```text
query: curso odisea session 1
path:  curso-odisea/curso-1/s1/s1.md
```

### Tool Budget

The current shared budget caps total calls and read calls. The issue is that
repeated list/search calls can consume all total calls before any read happens.

For this version, preserve the total cap but reserve at least one read slot:

- Track successful reads separately, for example `readDocumentSucceeded`.
- Validate the tool name and arguments before consuming budget when possible.
- A failed `read_document` attempt does not unlock the final non-read slot.
- If no `read_document` has succeeded yet, non-read tool calls should stop
  before consuming the final total-call slot.
- The model should receive a structured tool error telling it to read one of the
  existing matches or ask a clarification.

This keeps the agent from looping on search/list until it has no budget left to
read the best file.

## Live Activity Design

Add a new run event:

```ts
type AgentActivityRunEvent = {
  type: "activity";
  runId: string;
  activityId: string;
  sequence: number;
  kind:
    | "document_list"
    | "document_search"
    | "document_read"
    | "document_read_failed";
  status: "started" | "completed" | "failed";
  title: string;
  relativePath?: string;
  query?: string;
  resultCount?: number;
  searchedPaths?: number;
  searchedFiles?: number;
  truncated?: boolean;
};
```

Rules:

- Electron main owns the `sequence`.
- The renderer orders activity rows by `sequence`.
- Titles use fixed localized templates or sanitized metadata, not model-written
  text.
- Search query display is optional. When shown, the query must be stripped of
  control characters, absolute paths, token-like secrets, and overly long text.
  If it cannot be made safe, omit `query` and use a generic title.
- No raw document content, excerpts, absolute paths, prompt text, hidden
  reasoning, or provider thread ids.
- Activity rows are transient UI state and are not saved to chat history.

### Type Boundary

The provider interface currently exposes `onRunEvent` only for thinking
summaries. This change must widen that boundary or add a separate listener so
Codex document-tool activity can reach the renderer without abusing thinking
events.

Implementation preference:

```ts
onRunEvent?: AgentRunEventListener;
```

The provider should still only emit provider-owned run events it is allowed to
know about: thinking summaries and safe activity events. Agent-service-owned
phase events continue to be emitted by `AgentService`.

### Event Emission

Emit activity events from the shared document-tool execution layer where
possible, so tool metadata is consistent. Renderer display should initially be
enabled for Codex app-server runs. The OpenAI API path may emit the same safe
events internally later, but user-visible live activity for OpenAI is not a goal
of this change.

Emit:

- `started` before a document tool executes;
- `completed` after successful list/search/read;
- `failed` after safe document-tool errors.

For read successes, include the validated relative path. For read failures,
include a path only if it passes the same workspace-relative, visible,
Markdown-only display validation used for context manifests; otherwise omit the
path. For search/list, include result counts, searched-path/file counts, and
truncation. For search, include the sanitized query string only when safe.

## Renderer Design

`useAssistantRun` should maintain live activity outside of `entries`, for
example:

```ts
const [runActivities, setRunActivities] = useState<AgentActivityRunEvent[]>([]);
```

Behavior:

- Clear activity when a new run starts.
- Append/update activities as `activity` run events arrive.
- Render live activity under the active status row while the run is active.
- When the final assistant message arrives, stop rendering live activity and
  rely on the final context receipt.
- Do not persist activity rows to chat history.

The transcript should remain calm:

- show at most the latest several activity rows;
- use compact text;
- avoid noisy nested cards;
- keep the existing final context disclosure.

## Final Context Receipts

Improve final detail labels for model-directed rows:

- `model_directed_document_search`: show result count, searched-file count, and
  truncation.
- `model_directed_document_list`: show result count and truncation.
- `model_directed_document_read`: show the relative path as today.
- `model_directed_document_read_failed`: show failed read path when safe.

The final summary can remain:

```text
Contexto: 1 archivo + acceso al espacio de trabajo
```

because detailed search/list rows belong inside the expandable receipt.

When multiple search/list calls happen in one run, final receipts should not
silently keep only the first row. For v1, preserve per-call search/list rows
because live activity and final receipts should agree. If this becomes noisy,
aggregate later with an explicit design.

## Security And Privacy

- No document content in activity events.
- No content excerpts in activity events.
- No absolute workspace path.
- No unsafe failed-read paths in activity events.
- No unsanitized search queries in activity events.
- No renderer-supplied path accepted as trusted context.
- Existing path safety rules still run in Electron main.
- Hidden, ignored, symlinked, non-Markdown, and oversized reads remain rejected
  or skipped as today.
- Chat history continues to store visible user/assistant text, not raw context
  payloads or live activity.

## Rollout

This is local app behavior only. There are no database migrations, RLS changes,
or remote service changes.

The repo currently has one production trunk:

```text
feature worktree -> master -> origin/master
```

## Required Tests

- `documentTools.test`: path search finds a nested file such as
  `curso-odisea/curso-1/s1/s1.md`.
- `documentTools.test`: path match can be returned for an oversized Markdown
  file without reading content.
- `documentTools.test`: search is accent-insensitive and handles
  `sesion 1` / `sesión 1` / `session 1` / `s1`.
- `documentTools.test`: combined query `curso odisea session 1` finds
  `curso-odisea/curso-1/s1/s1.md`.
- `documentTools.test`: path phase still rejects hidden directories, ignored
  names, symlinks, and traversal outside the workspace.
- Shared document-tool execution tests: non-read calls reserve the final budget
  when no read has succeeded.
- Codex provider tests: document tool calls emit ordered live activity events
  with safe metadata.
- Codex provider tests: failed read activity omits unsafe paths.
- Assistant utils tests: final receipt rows show useful metadata for list/search.
- Assistant transcript tests: active run renders live activity, completed run
  renders final receipt.
- Renderer state tests: stale activity events, cancellation, new chat, workspace
  switch, and history load do not leave old live rows visible.
- Chat history tests continue proving activity/context metadata is not persisted.

## Review Reconciliation

Accepted:

- Search query display must be sanitized or omitted.
- Provider event types must be widened deliberately.
- Tool budget must track successful reads, not only attempted reads.
- Failed read paths must pass strict display validation before UI exposure.
- `searchedFiles` and path-first search count semantics must be split.
- Final search/list receipts should preserve per-call rows for v1.
- Combined alias matching and path-phase safety tests are required.
- Renderer cleanup tests are required for stale activity rows.

Rejected or deferred:

- Making OpenAI API live activity a product requirement. Shared safe metadata is
  fine, but this feature is aimed at the Codex runtime path the user is testing.

## Open Questions

- Should the final receipt show search query strings? For v1, prefer live trail
  query display and final receipt count metadata only.
- Should path search include non-Markdown filenames? No for v1; only Markdown is
  available as model-readable document context.
- Should the activity trail remain visible after completion? No for v1; final
  receipts are the durable record.
