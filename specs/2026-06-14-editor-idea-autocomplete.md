# Editor Idea Autocomplete

Date: 2026-06-14
Status: research-backed product/implementation spec
Scope: Optional AI ghost-text continuation in the Markdown editor.

## Problem

Iliad should optionally suggest the next few words or the next sentence while a
user writes Markdown. The feature should feel like code-editor autocomplete:
quiet ghost text at the cursor, `Tab` to accept, `Esc` or continued typing to
dismiss, and no chat transcript or review proposal unless the user asks for a
larger rewrite.

Autocomplete must be helpful without becoming an interruption. It should be easy
to disable, conservative about when it appears, and careful about context.

## Research Summary

Best current fit:

1. Build a custom CodeMirror 6 ghost-text extension with decorations/widgets.
   CodeMirror's `@codemirror/autocomplete` is designed for completion menus and
   async completion sources; it is useful for future slash commands or reference
   pickers, but not enough by itself for Copilot-style inline ghost text.
   Sources: [CodeMirror autocomplete example](https://codemirror.net/examples/autocompletion/),
   [CodeMirror reference](https://codemirror.net/docs/ref/),
   [CodeMirror decorations](https://codemirror.net/examples/decoration/).
2. Follow VS Code/Copilot interaction patterns: dim ghost text, `Tab` accept,
   partial accept as an advanced option, `Esc` reject, enable/disable controls,
   and context from the current and related open files.
   Sources: [VS Code inline suggestions](https://code.visualstudio.com/docs/editing/ai-powered-suggestions),
   [GitHub Copilot suggestions](https://docs.github.com/en/copilot/how-tos/get-code-suggestions/get-ide-code-suggestions).
3. Use Continue-style latency safeguards: debounce, small context windows,
   model timeout, one in-flight request, and file/language disable rules.
   Source: [Continue autocomplete docs](https://docs.continue.dev/customize/deep-dives/autocomplete).
4. Use OpenAI Responses API only through main-process/provider code, never from
   the renderer. The Responses API is the recommended direct text-generation
   endpoint, supports streaming, and supports structured outputs if the app
   later needs strict JSON response shapes.
   Sources: [OpenAI text generation](https://developers.openai.com/api/docs/guides/text),
   [OpenAI streaming](https://developers.openai.com/api/docs/guides/streaming-responses),
   [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

Important auth caveat: Iliad can route autocomplete through the same provider
selection it already uses for Tighten, where Codex app-server is selected before
OpenAI API when available. But the implementation should not treat raw Codex
account tokens as general OpenAI API credentials. OpenAI's Codex docs state that
Codex access tokens are for trusted Codex local workflows, while Platform API
keys remain the right credential for general API calls.
Sources: [Codex authentication](https://developers.openai.com/codex/auth),
[Codex access tokens](https://developers.openai.com/codex/enterprise/access-tokens),
[OpenAI API overview](https://developers.openai.com/api/reference/overview/).

## Recommendation

Build `ideaAutocomplete` as an opt-in renderer ghost-text extension plus
main-process text endpoint. Autocomplete is off by default. API fallback is a
separate explicit preference, because frequent autocomplete calls can spend
Platform credits.

```text
CodeMirror update/keymap
  -> renderer trigger heuristics
  -> window.iliad.autocompleteIdea(request)
  -> main AgentService autocomplete method
  -> existing runtime provider selection:
       Codex app-server when connected and suitable
       OpenAI API key fallback only when explicitly enabled
  -> sanitized suggestion
  -> ghost text widget
```

The request should be single-shot, read-only, low-output, cancellable, and never
persisted in chat history or proposal stores.

## Goals

- Add a topbar control to enable/disable autocomplete.
- Default autocomplete off until the user enables it.
- Show ghost text at the cursor after a short pause when the app has enough
  context.
- Accept the full suggestion with `Tab`.
- Dismiss with `Esc`, cursor movement, selection change, document change that
  invalidates the prefix, or file switch.
- Keep `Tab` as normal indentation when no suggestion is visible.
- Offer a manual keyboard trigger for "suggest now" that works after cursor
  navigation without enabling click-triggered automatic requests.
- Keep automatic suggestions short; allow next-paragraph suggestions only from
  the manual trigger at natural prose boundaries.
- Use enough local context to make suggestions useful without sending the whole
  workspace.
- Prefer Codex app-server via the existing provider abstraction when available,
  fallback to OpenAI API key only if the user explicitly enables API fallback for
  autocomplete.
- Never expose API keys or Codex auth material to the renderer.
- Avoid appearing in contexts where it is likely to be wrong or disruptive.

## Non-Goals

- No multi-file agent run.
- No chat message.
- No review proposal.
- No automatic acceptance.
- No autocomplete in code fences in the first pass.
- No large paragraph generation by default.
- No raw Codex token use as an OpenAI API bearer token.
- No raw `workspaceRoot` accepted from renderer IPC.
- No always-visible status spinner while waiting for suggestions.

## Current Architecture Fit

Relevant files today:

- `src/components/EditorPane.tsx` owns CodeMirror extensions, keymaps through
  local extensions, and `onEditorViewChange`.
- `electron/agent/agentService.ts` already has `tightenSelection`, which uses
  `selectRuntimeProvider`: Codex app-server first, then the OpenAI API key path.
  Autocomplete should reuse the provider abstraction but gate API fallback behind
  its own explicit preference.
- `electron/ipc/tighten.ts` is the model for trust gate, timeout, cancellation,
  request ids, and output cleaning.
- `electron/preload.ts` exposes narrow IPC calls to the renderer.
- `src/preferences/editorPreferences.ts` shows local display preference storage.
- `src/components/TypographyMenu.tsx` shows the topbar popover pattern.

Add new modules:

```text
src/editor/ideaAutocomplete/
  extension.ts
  context.ts
  ghostText.ts
  heuristics.ts
  __tests__/

electron/agent/autocomplete.ts
electron/ipc/autocomplete.ts
```

Also update:

- `src/types/iliad.ts` for `autocompleteIdea`, `cancelAutocompleteIdea`, and a
  writing-assist availability/status response.
- `electron/preload.ts` for the new IPC surface.
- `electron/main.ts` to register autocomplete IPC beside Tighten and pass the
  same `resolveWorkspaceRootForSession` session resolver used by agent context
  IPC.

## UX

### Topbar

Use the same `WritingAssistsMenu` described in the corrector spec. The popover
contains:

- `Corrector` switch.
- `Autocomplete` switch.
- `Use API fallback for autocomplete` switch, shown only when an OpenAI API key
  exists or the user is in settings/advanced state. This switch defaults off.
- Optional future action: `Snooze autocomplete` for 10 minutes.

Do not put usage explanations in the app surface. Tooltips and accessible labels
are enough.

Switch accessibility:

- Use `role="switch"` and `aria-checked`.
- Space/Enter toggles the focused switch.
- `Esc` closes the popover.
- Click outside closes the popover.
- Focus returns to the trigger after close.

### Ghost Text

- Render as dim inline text after the cursor.
- Match the editor font and line height.
- Never use a card, tooltip, or animated bubble for the suggestion itself.
- If the suggestion wraps to the next line, keep it visually quiet.
- No spinner. If the request is slow, show nothing.
- Optional future hover affordance can show tiny controls, but Phase 1 should
  rely on keyboard behavior.
- The ghost text DOM must use `aria-hidden="true"`, `pointer-events: none`, and
  CSS that prevents selection/copying. It must not be announced as document
  content by screen readers.
- No animation.

Keyboard behavior:

- `Mod-Enter`: manually request a suggestion at the current cursor
  (`Cmd-Enter` on macOS, `Ctrl-Enter` on Windows/Linux). `Ctrl-Space` is kept
  as a best-effort fallback where the OS does not intercept it.
- `Tab`: accept a visible suggestion that came from typing or the manual
  trigger.
- `Esc`: dismiss visible suggestion and temporarily suppress until the next
  meaningful edit.
- `Mod-Right`: future partial accept next word.
- `Enter`: never accepts autocomplete in prose.

## Trigger Heuristics

Autocomplete follows writing intent, not cursor position. A click, focus return,
selection collapse, arrow-key move, file switch, or document open must never
start an automatic provider request. Those events clear any visible suggestion
and suppress automatic suggestions until the next meaningful text edit.

Trigger automatically only when all are true:

- Autocomplete is enabled.
- Editor is focused and writable.
- Main selection is a single empty cursor.
- No selection-comment composer, Tighten review, persistent review, or popover
  is actively handling keyboard input.
- No correction popover is active.
- The last relevant editor event was a meaningful text edit in normal prose:
  user-inserted characters, `Enter`, punctuation, or paste.
- Cursor is not inside a fenced code block, inline code span, raw URL, Markdown
  link destination, image path, HTML tag, or YAML front matter key.
- At least 20 non-whitespace prefix characters exist in the current paragraph or
  heading section.
- The user has not dismissed suggestions repeatedly in the last short window.
- The editor is not in IME composition and dictation is not actively inserting
  text.

Do not treat these as meaningful edits:

- Pointer clicks, focus changes, scroll, selection changes, or arrow navigation.
- Undo/redo.
- Programmatic document updates.
- Formatting commands.
- Corrector autofix insertions.
- Autocomplete acceptance itself.

The manual `Mod-Enter` trigger bypasses click/navigation suppression and dismissal
suppression, but it still respects provider rate-limit/provider cooldowns,
read-only state, IME composition, unsafe Markdown contexts, and provider
availability.

Suggestion length:

- Automatic trigger: inline continuation only, 3-15 words, no newline, no new
  paragraph.
- Manual trigger inside a sentence: inline continuation.
- Manual trigger at a natural boundary: next paragraph may be suggested.

Natural boundaries for paragraph suggestions:

- Cursor on a blank line after a non-empty prose paragraph.
- Cursor at the end of a paragraph after sentence-ending punctuation.
- Cursor at the end of a Markdown heading.
- Cursor at the end of a completed list item.

Paragraph suggestions are still conservative: one paragraph, no heading, no code
fence, and no multi-paragraph draft.

Implemented timing:

- Debounce: 900 ms after typing stops.
- Main-process provider timeout: 18 seconds.
- One in-flight request per editor; new edit aborts the old request.
- Provider/rate-limit failures apply shared cooldowns across editor instances.
- Exact context caching is a future optimization, not a Phase 1 requirement.

Suppression defaults:

- After `Esc`: suppress until the next meaningful text edit.
- After three dismissals without acceptance in 60 seconds: suppress for 5
  minutes.
- After accept: wait for the next meaningful edit before requesting again.
- After blur, IME composition, dictation, provider timeout, or rate-limit
  response: suppress until the next stable editing pause, with longer cool-downs
  for provider/rate failures.

## Context Window

Use fill-in-the-middle style context:

```ts
interface IdeaAutocompleteRequest {
  requestId: string;
  workspaceSessionId: string;
  documentRelativePath: string;
  language: "en" | "es";
  cursor: number;
  prefix: string;
  suffix: string;
  headingPath: string[];
  documentTitle: string;
  nearbyHeadings: string[];
  trigger: "automatic" | "manual";
  suggestionKind: "inline" | "paragraph";
}
```

The renderer must not send `workspaceRoot`. Main resolves `workspaceSessionId`
through the trusted window/session resolver, validates `documentRelativePath`
with `ensureMarkdownFile`, and rejects unsafe or stale requests before provider
selection.

Context selection:

- Prefix: up to 2500 chars before the cursor within the current Markdown
  section. This intentionally crosses paragraph boundaries so the model sees
  the recent local voice, argument, and structure.
- Suffix: up to 1200 chars after the cursor within the current Markdown
  section. This can include following paragraphs so fill-in-the-middle
  suggestions do not contradict text below the cursor.
- Section boundary: stop at the nearest Markdown heading boundary rather than
  sending unrelated later sections.
- Heading path: nearest preceding Markdown headings.
- Document title: active file stem.
- No whole-workspace context in Phase 1.
- Future opt-in: recently opened related Markdown files or explicit pinned
  context, shown in receipts/settings if added.

Use the shared `src/editor/writingAssistContext.ts` helper from the corrector
spec for Markdown exclusions and heading/cursor classification. Do not maintain
a separate regex-only prose classifier for autocomplete.

Prompt direction:

- Continue the user's current thought in the same language, voice, and Markdown
  structure.
- Return only text to insert at the cursor.
- Prefer 3-15 words, max 1 sentence by default.
- No preamble, no alternatives, no code fences.
- Do not repeat the prefix.
- Stop before starting a new major section unless the prefix clearly asks for
  one.

## Provider And Auth

Add `AgentService.autocompleteIdea` instead of calling OpenAI directly from the
renderer. It should reuse `selectRuntimeProvider(settings.model)` so the runtime
selection is consistent with Tighten:

1. Codex app-server if connected and `generateText` is available.
2. OpenAI API key if present and `autocompleteApiFallbackEnabled` is true.
3. Return a disabled/unavailable result.

The main process remains responsible for:

- trusted sender validation
- workspace session resolution and Markdown file validation
- input length caps
- timeout/cancellation
- provider selection
- diagnostics logging
- output cleaning

Because autocomplete can be frequent, add a separate feature-level rate limiter
before provider calls. If rate limits or usage limits are hit, silently suppress
autocomplete for a cool-down period and show only a subdued status in the
writing-assists popover.

Do not rely on `AgentSettingsStore.snapshot().runtimeProvider` for writing-assist
availability. Add a main-owned status method that checks current Codex
availability and API-key/API-fallback state explicitly.

## Output Cleaning

Reject suggestions when:

- Empty after trimming.
- Starts by echoing a long suffix/prefix.
- Contains Markdown code fences.
- Contains multiple paragraphs unless explicitly triggered.
- Exceeds max chars/tokens.
- Changes text before the cursor.
- Looks like instructions, commentary, or a chat response.

Normalize line endings to match the current document. Preserve leading space
only when the insertion point is in an indentation-sensitive context.

## CodeMirror Extension Shape

Use a `ViewPlugin` plus `StateField` or plugin-local state:

- Track current suggestion `{ requestId, from, insert, acceptedPrefix }`.
- Render ghost text as inline `Decoration.widget({ side: 1 })` at the cursor.
- Use `Prec.high(keymap.of([...]))` so `Tab` accepts only when suggestion state
  is active.
- Return `false` from the `Tab` command when there is no active suggestion.
- Abort on doc changes, cursor movement, blur, review mode, and document switch.
- Do not steal `Escape` from selection comments, correction popovers, or review
  controls. If those surfaces are active, autocomplete must already be dismissed.
- Dispatch accept as one CodeMirror transaction:

```ts
view.dispatch({
  changes: { from: cursor, insert: suggestion.insert },
  selection: { anchor: cursor + suggestion.insert.length }
});
```

## Data And Privacy

- Autocomplete enabled/disabled: `localStorage`, default `false`.
- API fallback for autocomplete: `localStorage`, default `false`, and only used
  by main when an API key exists.
- Temporary cache: memory only.
- Provider requests: main process only.
- API key remains in the existing settings store/main process.
- Codex auth remains behind the existing Codex app-server client.
- Do not log raw prefix/suffix. Log request size, duration, provider id, and
  success/failure category only.
- Main-side validation enforces maximum prefix/suffix lengths even if the
  renderer sends a larger payload.

## Implementation Plan

1. Add shared writing-assist preferences and `WritingAssistsMenu`.
2. Add `ideaAutocompleteExtension` with local fake provider for UI tests.
3. Add context extraction and Markdown context exclusion helpers.
4. Add `electron/agent/autocomplete.ts` prompt, validation, and output cleaning.
5. Add `electron/ipc/autocomplete.ts` with request ids, cancellation, timeout,
   trusted sender validation, workspace-session resolution, Markdown path
   validation, and single-flight behavior.
6. Expose `window.iliad.autocompleteIdea`, `cancelAutocompleteIdea`, and
   writing-assist status methods.
7. Wire `registerAutocompleteIpc({ service, resolveWorkspaceRootForSession })`
   beside Tighten in `electron/main.ts`.
8. Wire `EditorPane` to pass active file/session/language and enabled state.
9. Add diagnostics logging without raw document content.
10. Tune latency thresholds with manual writing sessions.

## Verification

- `npm run typecheck`
- `npm run build`
- Unit tests:
  - Trigger heuristics skip code fences, inline code, URLs, link destinations,
    review mode, non-empty selections, and front matter keys.
  - `Tab` accepts only when ghost text is active.
  - `Esc` dismisses and suppresses the current suggestion.
  - Late provider responses are ignored after edits/file switch.
  - Output cleaning rejects preambles, echoed prefixes, multi-paragraph output,
    and code fences.
  - Provider fallback selects Codex first when connected, API key second only
    when autocomplete API fallback is explicitly enabled.
  - API fallback is never used unless explicitly enabled.
  - IPC rejects raw/unsafe workspace or document paths and resolves session ids
    in main.
  - Length caps are enforced in main.
  - No raw prefix/suffix appears in diagnostics.
- Manual checks:
  - Suggestions appear after a pause in prose.
  - Suggestions do not appear while typing quickly.
  - Pressing `Tab` inserts the suggestion and one undo removes it.
  - Pressing `Tab` with no suggestion still indents/navigates normally.
  - No visible spinner appears during slow requests.
  - Disabling autocomplete in the topbar immediately stops new requests.
  - Packaged Electron build exposes the autocomplete IPC and rejects unsafe
    session/path requests.

## Open Questions

- Should Spanish autocomplete use the same model and prompt immediately, or wait
  for Spanish-specific evaluation examples?
- Should Phase 2 add partial accept next word/line, or keep full accept only
  until the base behavior feels calm?
