# Codex Discovery Receipts And Working Indicator

Date: 2026-05-26

Status: implemented.

Review status: reviewed in concept by two architecture/implementation agents;
focused review feedback folded in where it applied. This is a follow-up to
`2026-05-26-codex-context-discovery-and-live-activity.md`, not a replacement for
that broader discovery spec.

## Problem

The Codex runtime can now use Iliad-owned Markdown document tools to search,
list, and read workspace documents. That is the right direction, but the user
experience is still confusing in two cases.

First, the final context receipt can show a broad failed discovery row such as:

```text
Búsqueda de documentos
0 resultados · 499 archivos revisados · truncado
```

even when the same run later found and read the right files. The model did useful
work, but the receipt makes it look like discovery failed.

Second, the transcript can show the pulsing active-run glow while the model is
working, but not show the three-dot thinking indicator. The glow says "work is
happening"; the dots should always be visible too.

## Decision

Use the smallest Codex-harness improvement, not a new indexing system.

The winner architecture is:

```text
Codex app-server
  -> Iliad dynamic Markdown tools
  -> shared AgentDocumentTools
  -> live activity rows
  -> final context manifest receipts
```

This follows the OpenClaw/Codex-runtime lesson already documented in
`docs/context-management/openclaw-codex-runtime-research.md`: Codex is the agent
runtime, while app-owned dynamic tools are the place where Iliad can enforce
workspace policy and create user-visible receipts.

## Goals

- Keep path-first document discovery inside Iliad's existing safe Markdown
  document tools.
- Preserve `searchedPaths` through persisted context manifests so receipts can
  distinguish path metadata checks from content scans.
- Keep useful discovery receipts, but suppress only superseded noisy rows:
  zero-result, capped search/list rows that are followed by a successful
  model-directed document read in the same Codex run.
- Make capped discovery copy less alarming than bare `truncated`.
- Preserve live activity ordering when a started activity later completes.
- Always show the three-dot working indicator while `runningRunId` is active,
  even if the status entry was removed or not created.
- Keep activity metadata safe: no document content, excerpts, prompts, absolute
  paths, secrets, or Codex thread ids in UI rows.

## Non-Goals

- No shell tool for Iliad's user-facing agent.
- No embeddings, semantic index, or background indexer.
- No web search.
- No persistent pinned context.
- No change to explicit `@file.md` or file-chip semantics.
- No hidden chain-of-thought display.

## Product Behavior

### Good Discovery

If the agent first searches broadly and gets no result, then later finds and
reads the relevant file, the final receipt should emphasize what actually
helped:

```text
Contexto: 2 archivos + acceso al espacio de trabajo
curso-odisea/estado-proyecto.md
curso-odisea/curso-1/s1/s1.md
Codex · gpt-5.5
```

It may also show useful list/search rows that returned positive results. It
should not lead with a superseded `0 resultados` row.

### No Discovery

If the agent searches and finds nothing, the zero-result row remains visible:

```text
Búsqueda de documentos
0 resultados · 499 archivos revisados · búsqueda limitada
```

That receipt is useful because it explains why the assistant asked for a
clarification.

If the search was capped or traversal was limited, the UI and assistant should
not imply that no matching document exists anywhere. The honest interpretation
is: "this bounded search did not return a match." The assistant should ask the
user to narrow the request or name/attach the file when exact context is needed.

### Active Run Indicator

While the model is working, the transcript should always show:

```text
[three animated dots] optional status text
optional live activity trail
```

If the normal status row is missing, the transcript renders a synthetic active
status row. This row is transient UI state and is not saved to chat history.

## Backend Design

### Preserve Search Metadata

`search_documents` already computes:

- `searchedPaths`: Markdown path metadata candidates inspected.
- `searchedFiles`: Markdown file contents read/scanned.

Persist both in `serializeContextItem`. Without this, reloaded manifests and
final receipts lose path-search evidence.

### Codex Receipt Cleanup

After a Codex run completes, merge context manifest items as today, then apply a
Codex-only cleanup pass.

Suppress a discovery row only when all conditions are true:

- the item reason is `model_directed_document_search` or
  `model_directed_document_list`;
- `resultCount === 0`;
- `truncated === true`;
- a later successful model-directed `document_read` exists in the same merged
  manifest order;
- the manifest provider is `codex-app-server`.

Do not suppress:

- zero-result rows when there was no successful read;
- zero-result rows that appear after the successful read;
- productive search/list rows with `resultCount > 0`;
- explicit user-provided context rows;
- OpenAI API provider rows.

This keeps receipts honest without hiding useful evidence.

### Activity Ordering

Live activity rows are keyed by `activityId`. A `completed` event updates the
same row that was created by the `started` event. The update must preserve the
original `sequence` so rows stay in start order instead of jumping when a tool
finishes.

If a completed activity arrives without a matching started activity, append it
with its own sequence. It should still be visible, but it should not reorder an
existing row.

Renderer copy is derived from safe structured fields: kind, status, sanitized
query, sanitized relative path, and bounded metadata. The backend `title` field
is not a display contract and should not be rendered. In a later cleanup it can
be removed from the event type.

This version does not add a separate "Found path" activity event. Concrete path
evidence appears through completed read rows and final manifest `document_read`
items. Adding top search matches to live activity can be considered later if it
can be done with the same metadata-only safety constraints.

Content search continues to match individual content lines. Combined
path-plus-line semantic matching is out of scope for this fix; path relevance is
handled by path-first matches.

## Frontend Design

### Context Detail Copy

Replace bare `truncated` display for search/list metadata with a clearer cap
label:

```text
search capped
búsqueda limitada
```

The underlying boolean can remain `truncated`; the UI copy should describe that
the discovery result was bounded, not that the assistant failed.

### Fallback Working Row

`AssistantTranscript` currently renders the dots only for the active status entry
whose id matches `${runningRunId}-status`. It should render the normal row when
present, and render a fallback active status row at the end when no active status
row was rendered.

The fallback row should reuse:

- `StatusWave`
- `AssistantActivityTrail`
- existing active-status classes and aria label

## Tests

- `contextManifest` serialization keeps `searchedPaths`.
- Codex manifest cleanup removes a superseded zero-result capped discovery row
  after a later model-directed read.
- The same zero-result capped discovery row remains when no later read exists.
- A zero-result capped row before a read is suppressed, but a zero-result capped
  row after a read remains visible.
- OpenAI API provider manifests do not suppress zero-result capped discovery
  rows through the Codex cleanup rule.
- Productive discovery rows remain visible.
- Activity merge preserves the original sequence when a row is updated.
- Assistant metadata displays the new capped wording in English and Spanish.
- Unsafe activity details remain hidden for absolute paths, token-like strings,
  control characters, and long queries.
- Assistant transcript renders the status wave when `runningRunId` is active but
  the matching status entry is absent.
- Fallback active row still renders live activity rows.
- OpenAI API provider runs do not start rendering Codex live activity merely
  because the shared document-tool executor changed.

## Rollout

This is local app behavior. No database migration, external API contract change,
or production data operation is required.

Run targeted tests, then full typecheck/build checks before merging to `master`.
