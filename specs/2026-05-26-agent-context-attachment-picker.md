# Agent Context Attachment Picker And Chips

Date: 2026-05-26
Status: reviewed spec

## Product Intent

Iliad should let users attach Markdown files to the next agent message the way
modern coding agents attach files to chat: type `@`, choose a matching file, and
see the selected file as a chip in the composer. Dragging a Markdown file from
the file tree into the agent panel should create the same chip. Sending the
message means those chips are explicit, inspectable context for that run.

This is a UI layer on top of the document context and manifest architecture
already in place. It must not become hidden whole-workspace context, fuzzy
unbounded retrieval, or direct model filesystem access.

## Current State

Iliad already has safe explicit Markdown document reads:

- `@file.md` and `@folder/file.md` are parsed from the latest prompt.
- Safe files are read in Electron main through `AgentDocumentTools.readDocument`.
- Contents are supplied to the selected provider as explicit context documents.
- Manifest rows record metadata only.
- Unsafe, missing, duplicate, oversized, or budget-exceeded references are
  excluded and disclosed without storing document content.

The missing product surface is selection. Today users have to know the exact
workspace-relative Markdown path and include the extension. That is why typing
`@reporte-control-calidad` feels broken even though `@reporte-control-calidad.md`
works.

## Goals

- Typing `@` in the assistant composer opens a file suggestion list.
- As the user types after `@`, suggestions filter visible workspace Markdown
  files by basename and relative path.
- Pressing `Tab` selects the highlighted suggestion and turns it into a context
  chip.
- `Enter` also selects while the picker is open; normal message send happens
  only when the picker is closed.
- `ArrowUp` and `ArrowDown` move through suggestions.
- `Escape` closes the picker and leaves the typed text unchanged.
- The selected chip appears inside the composer context row, next to `Auto` and
  the current-file chip.
- Chips are removable before send.
- Dropping a Markdown file from the file tree into the composer or assistant
  panel creates the same chip.
- Dragging a Finder file into the composer may attach it only if it resolves to
  a visible Markdown file inside the open workspace.
- Attached files are read in Electron main at send time, not in the renderer.
- Run manifests show attached files as explicit context.
- Existing typed `@file.md` support continues to work for users who do not use
  the picker.
- Extensionless typed references such as `@reporte-control-calidad` should be a
  runtime convenience when they resolve to one safe, unambiguous Markdown file.

## Non-Goals

- No folder attachment in this pass.
- No non-Markdown attachment in this pass.
- No whole-workspace attach button.
- No hidden semantic search, embeddings, or broad retrieval.
- No automatic attachment of every matching file.
- No model-visible absolute paths.
- No renderer-supplied document content.
- No persistent context pinning across chats yet.
- No editing a referenced file in the OpenAI API fallback path unless it is also
  the active file. Attached files are read context; proposal write support stays
  governed by the runtime/provider proposal contract.

## UX Contract

### Composer Chips

The composer keeps its current compact shape:

```text
[ Ask anything...                         send ]
[ Auto ] [ s2.md ] [ reporte-control-calidad.md x ]
```

Chip rules:

- `Auto` remains the default policy chip.
- The current active Markdown file remains an automatic context chip when
  applicable.
- Manually attached files appear after automatic chips.
- Display the basename by default.
- If two attached or automatic files share a basename, show enough parent path
  to distinguish them, for example `s2/report.md` and `s3/report.md`.
- Tooltip/aria-label contains the workspace-relative path and context meaning.
- Each manual chip has an icon-only remove button with an accessible label.
- Backspace in an empty composer removes the last manual chip.
- Duplicate chips are ignored, with the existing chip briefly emphasized.
- A disabled state prevents adding more than the configured manual attachment
  limit.

Initial limit: 4 manual attachments per run. This matches the current explicit
document inclusion count budget, but it is not a guarantee that every chip will
be included: byte limits, token limits, duplicates, stale files, and typed
mentions can still exclude files. The run manifest is authoritative.

### `@` Picker

Typing `@` starts an attachment query when the caret is in normal composer text.

Picker trigger:

- Start of input: `@rep`
- After whitespace: `compare with @rep`
- After punctuation plus whitespace: `Use this. @rep`

Do not trigger inside:

- an email address;
- an inline code span;
- a fenced code block pasted into the composer;
- a token already converted to a chip.

The picker is a popover anchored to the active `@query` token. It keeps DOM
focus in the textarea, uses a textarea-backed combobox pattern, and never
covers the send/stop buttons.

Accessibility:

- The textarea exposes `aria-expanded`, `aria-controls`, and
  `aria-activedescendant` while the picker is open.
- The suggestion container uses `role="listbox"`.
- Suggestions use `role="option"` with stable ids.
- Highlight changes update `aria-activedescendant`.
- A polite live region announces no results, rejected drops, max-chip failures,
  and successful chip attachment/removal.
- Chip remove buttons are keyboard-focusable and labeled
  `Remove <relativePath> from context`.
- Selecting a suggestion returns focus to the textarea.

Suggestion row:

```text
[file icon] reporte-control-calidad.md
            reports/reporte-control-calidad.md
```

Ranking:

1. Basename prefix match.
2. Basename substring match.
3. Relative path prefix match.
4. Relative path substring match.
5. Current active file directory matches before unrelated folders.
6. Shorter relative paths before longer relative paths.
7. Stable path sort as final tie-breaker.

Filtering:

- Match case-insensitively.
- Match diacritic-insensitively for Spanish and other Latin-script filenames.
- Normalize spaces in the query to hyphens only for matching, not for stored
  paths.
- Search visible Markdown files only.
- Exclude hidden paths, ignored folders, symlinks, and non-Markdown files using
  the same visibility/path rules as the document tools.
- Limit visible suggestions to 8 rows.
- Bare `@` shows the first 8 visible Markdown files ranked by active-file
  sibling directory, then recently opened files when that signal exists, then
  stable path order.
- No-results state shows one disabled row with localized copy such as
  `No matching Markdown files`.
- If the underlying document list is truncated, show available matches but add a
  localized footer such as `Keep typing to narrow results`; never claim all
  workspace files were searched.

Keyboard behavior:

- `ArrowDown`/`ArrowUp`: move highlight.
- `Tab`: attach highlighted suggestion and remove the `@query` token.
- `Enter`: attach highlighted suggestion while picker is open.
- `Escape`: close picker and leave text as typed.
- `Space`: close picker and insert the space. It never selects a file and never
  traps normal typing.
- `Cmd/Ctrl+Enter`: sends only when picker is closed.

Mouse behavior:

- Click a suggestion to attach it.
- Clicking outside closes the picker and leaves text unchanged.

### Drag And Drop

File tree rows for real Markdown files become draggable context sources.

Drag payload:

```ts
{
  type: "iliad/context-file";
  workspaceSessionId: string;
  relativePath: string;
}
```

Only `relativePath` should be needed by the send path. `workspaceSessionId` is
an opaque renderer-safe id or nonce used to reject cross-workspace or stale
drags. Do not put absolute local paths in internal drag data.

Drop targets:

- Assistant composer.
- Empty assistant transcript area.
- Assistant panel body, routed to the composer.

Drop behavior:

- Markdown file from the current file tree: create a manual chip.
- Folder from the file tree: reject in V1.
- Pending virtual proposal node: reject in V1 unless the proposal has already
  been accepted into a real file.
- Finder file inside the workspace: attach only if Electron main can normalize
  it to a visible Markdown relative path.
- Finder file outside the workspace: reject.
- Non-Markdown file: reject.

Rejected drops should not add persistent explanatory text. Show a localized
temporary composer status or toast and announce the rejection in the live region.

## Data Model

Renderer state:

```ts
interface AssistantContextAttachmentChip {
  id: string;
  relativePath: string;
  label: string;
  source: "mention_picker" | "file_tree_drop" | "finder_drop";
}
```

Send request extension:

```ts
interface AgentRunRequest {
  // existing fields...
  contextAttachments?: Array<{
    relativePath: string;
    source: "manual_attachment";
  }>;
}
```

Renderer may send only relative path metadata. It must never send Markdown
content or hashes. Electron main revalidates every attachment, reads it through
`AgentDocumentTools.readDocument`, and computes hashes/tokens itself.

Prepared provider request:

```ts
interface AgentContextDocument {
  correlationId: string;
  relativePath: string;
  content: string;
  baseHash: string;
  estimatedTokens: number;
  source: "explicit_file_mention" | "manual_attachment";
}
```

Manifest item reasons:

```ts
type AgentRunContextReason =
  | "explicit_file_mention"
  | "explicit_file_mention_unresolved"
  | "manual_context_attachment"
  | "manual_context_attachment_unresolved";
```

Attachment chips are next-run context, not persistent pins. When the run starts
successfully, keep the visible user message as normal transcript text and clear
the manual chips from the composer. If validation fails before the run starts,
or the provider/network fails before context is accepted, preserve the chips so
the user can retry or edit them. The run manifest remains the durable record of
what was included after a run starts.

## Runtime Contract

### Typed Mentions

Keep existing parser behavior:

- `@file.md`
- `@folder/file.md`
- `.md`, `.markdown`, `.mdown`, `.mkd`

Add extensionless fallback:

- `@folder/reporte-control-calidad` may try common Markdown extensions for that
  explicit workspace-relative stem.
- Bare hyphenated slugs such as `@reporte-control-calidad` list visible Markdown
  documents within document-tool bounds and resolve only when exactly one safe
  Markdown document has a matching basename stem.
- Bare model/social-looking handles such as `@gpt-5` or `@user_name` should not
  be consumed by the runtime fallback. The picker can still find files with
  those names after explicit user selection.
- If multiple documents match the same basename stem, exclude the reference as
  ambiguous rather than guessing.
- If the bounded list is truncated, do not attach a bare basename match; there
  is not enough evidence of uniqueness.
- Unresolved extensionless text should remain visible in the prompt sent to the
  model. Exact Markdown-path mentions may still be redacted in the sanitized
  prompt.
- Preserve path safety, ignored folder rules, symlink rejection, read limits,
  and manifest-only metadata persistence.

This fallback is a convenience, not the main UX. The picker is the preferred
way to disambiguate files.

### Manual Attachments

At send time:

1. Build the existing current-file context item.
2. Parse explicit typed mentions from the prompt.
3. Read manual attachment chips through the same document tool contract.
4. De-duplicate by normalized relative path in this order:
   - current file;
   - manual chips in UI order;
   - typed mentions in prompt order.
5. Enforce document count, byte, and token limits.
6. Add included files to `contextDocuments`.
7. Add excluded files to `unresolvedContextReferences`.
8. Persist only manifest metadata.

The model input should distinguish attached documents from prompt text. The
prompt should not contain synthetic `@path.md` text for selected chips.

## IPC And Helpers

Add a renderer-safe document listing endpoint bound to the currently open
workspace session:

```ts
window.iliad.listMarkdownContextDocuments(workspaceSessionId): Promise<{
  files: Array<{
    relativePath: string;
    name: string;
    sizeBytes: number;
    estimatedTokens: number;
  }>;
  truncated: boolean;
}>;
```

This endpoint calls `AgentDocumentTools.listDocuments` in Electron main and
returns metadata only. Electron main must map the session id to the current
workspace root; it must not trust a renderer-supplied filesystem root.

Add a path normalization endpoint for external drops:

```ts
window.iliad.normalizeContextDrop(workspaceSessionId, absolutePath): Promise<
  | { ok: true; relativePath: string }
  | { ok: false; reason: "outside_workspace" | "not_markdown" | "unsafe" | "not_found" }
>;
```

The renderer should not infer workspace-relative paths from arbitrary absolute
paths itself. Electron main must validate the absolute path against the current
workspace session before returning a relative path.

## Implementation Plan

### Phase 1: Runtime Bridge

- Add extensionless typed mention fallback.
- Keep exact `@file.md` tests passing.
- Add tests for `@reporte-control-calidad` resolving to
  `reporte-control-calidad.md`.
- Add tests for unique nested basename resolution and ambiguous basename
  exclusion.
- Add tests for Windows drive-style mention rejection, truncated basename-list
  behavior, and preserving unresolved extensionless prompt text.

### Phase 2: Attachment Model

- Add `contextAttachments` to the validated renderer run request.
- Add `manual_attachment` context document source.
- Read attachments in Electron main through `AgentDocumentTools.readDocument`.
- Add manifest reasons for included/excluded manual attachments.
- Add unit tests proving renderer-supplied content/hashes are ignored.

### Phase 3: Document Suggestion Source

- Add the metadata-only document listing IPC.
- Cache the list in renderer per workspace tree version.
- Invalidate cache on workspace open, file create, rename, trash, move,
  duplicate, accepted new-document proposal, and file tree refresh.
- Add pure ranking/filtering tests.
- Add truncated-list UI behavior and diacritic-insensitive matching tests.

### Phase 4: Composer Picker

- Add picker state to the assistant composer.
- Parse active `@query` token around caret.
- Render accessible suggestion popover.
- Implement keyboard/mouse selection.
- Convert selected suggestion to a manual chip and remove the query token.
- Add tests for keyboard behavior and duplicate prevention.
- Add tests for no-results rows, `Escape`, `Space`, max-chip state, and chip
  removal by keyboard.

### Phase 5: Drag And Drop

- Mark real Markdown file tree rows as draggable.
- Set an internal drag payload with relative path metadata.
- Add composer/panel drop handling.
- Add external Finder drop normalization through Electron main.
- Reject unsupported drops without changing context.

### Phase 6: Polish And Verification

- Add English and Spanish strings for picker labels, chip removal, and rejection
  announcements.
- Verify narrow panel layout: chips wrap without covering send/dictation.
- Verify keyboard-only selection.
- Verify textarea-backed combobox behavior, option announcements, and remove
  button labels with screen-reader tooling or DOM-level accessibility tests.
- Verify no document content appears in diagnostics, manifest storage, or chat
  history.

## Acceptance Criteria

- Typing `@rep` in the composer shows `reporte-control-calidad.md` when that
  file exists in visible workspace Markdown files.
- Pressing `Tab` turns the highlighted suggestion into a chip and removes
  `@rep` from the text.
- Bare `@` shows bounded initial suggestions; a query with no matches shows the
  localized no-results row.
- `ArrowDown`/`ArrowUp` move the highlighted suggestion; `Escape` closes the
  picker without changing text; `Space` closes the picker and inserts a space.
- Sending a message with that chip includes the file as explicit context.
- The assistant response context disclosure counts the attached file.
- Removing the chip before send prevents the file from being included.
- Backspace in an empty composer removes the last manual chip.
- Duplicate chip selection does not add a second chip.
- The max-chip state prevents adding a fifth manual chip and announces why.
- Dragging `reporte-control-calidad.md` from the file tree into the assistant
  panel creates the same chip.
- Dropping a Markdown file from Finder inside the current workspace creates a
  chip after main-process normalization.
- Dropping a non-Markdown file does not create a chip.
- Dropping a Markdown file outside the workspace does not create a chip.
- `@reporte-control-calidad.md` still works without using the picker.
- `@reporte-control-calidad` works without using the picker only when it
  resolves to one safe Markdown file.
- If two files share the same basename stem, raw extensionless `@name` does not
  guess; the picker lets the user choose the exact relative path.
- Chip remove buttons and picker options have accessible labels in English and
  Spanish.

## Risks

- A broad `@` parser can accidentally treat social handles or model names as
  file references. Keep the picker UI separate from typed mention parsing, keep
  extensionless runtime fallback conservative, and preserve unresolved
  extensionless text in the prompt.
- Dragging file rows can interfere with normal click-to-open behavior. Use
  native drag thresholds and do not add visible drag handles unless testing
  shows row dragging is unreliable.
- Chips can make the composer too tall in the narrow assistant panel. Enforce
  a manual attachment limit and wrap chips inside the existing context row.
- Renderer document-list cache can go stale. Treat send-time main-process reads
  as authoritative and show excluded manifest rows for stale chips.

## Open Questions

- Should clicking a chip open or reveal the file? Optional later behavior; do
  not require it for V1.
- Should selected text become a chip in the same row? Defer, but the chip model
  should allow a future `selection` source.
- Should file tree folders support "attach all Markdown files in folder" later?
  Defer until there is a clearer token budget UI and folder-level manifest
  disclosure.
