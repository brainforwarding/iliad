# Writing Assists Execution Roadmap

Date: 2026-06-14
Status: implementation roadmap
Scope: Phased delivery plan for the editor corrector and idea autocomplete specs.

## Source Specs

- `specs/2026-06-14-editor-writing-corrector.md`
- `specs/2026-06-14-editor-idea-autocomplete.md`

## Implementation Order

Implement the shared foundation first, then the local corrector, then
autocomplete. Corrector comes before autocomplete because it proves the editor
decoration, popover, keyboard, Markdown filtering, and stale-safe edit patterns
without adding provider latency, auth, and paid API fallback concerns.

## Phase 0: Shared Writing-Assist Foundation

Goal: add the app surfaces both features need without changing document content.

Deliverables:

- `useWritingAssistPreferences` with local preferences for:
  - `correctorEnabled`
  - `autocompleteEnabled`
  - `autocompleteApiFallbackEnabled`
- `WritingAssistsMenu` in the topbar, adjacent to typography and language.
- Shared `src/editor/writingAssistContext.ts` helper for:
  - excluded Markdown ranges
  - prose range checks
  - current word detection
  - heading path extraction
  - cursor context extraction
- Dedicated CSS tokens/classes for writing-assist UI.

Acceptance:

- Topbar control is keyboard accessible.
- Preferences persist across reloads.
- No Markdown file changes occur from toggling controls.
- Existing typography/language controls still work.

## Phase 1: Corrector MVP

Goal: ship local, explicit, stale-safe correction for common writing issues.

Deliverables:

- `src/editor/writingCorrector/` extension and issue model.
- Local issue detection path for spelling/repeated words in normal prose.
- Squiggly underline decoration.
- Click and `Mod-.` correction popover.
- Suggestion application as one CodeMirror transaction.
- `originalText` verification immediately before applying a fix.
- Suppression for current word, IME composition, read-only review surfaces, and
  blocked review/Tighten lines.

Preferred production engine:

- Harper.js worker for English documents.

Allowed first implementation slice:

- A local deterministic engine for obvious issues, behind the same normalized
  `WritingIssue` contract, if Harper packaging needs a separate dependency and
  packaged-Electron verification pass.

Acceptance:

- Common repeated words and simple misspellings underline in prose.
- Code fences, inline code, links, URLs, image paths, and front matter are
  skipped.
- Applying a fix is undoable in one undo step.
- Stale ranges are dismissed instead of modified.

## Phase 2: Corrector Hardening

Goal: make the corrector safe enough for broad daily writing.

Deliverables:

- Harper.js worker/WASM packaging verified in Vite dev and packaged Electron.
- Main-backed dictionary and ignored-lint persistence.
- English dialect option.
- Rule disable support where the engine exposes it.
- Tests for Unicode span mapping if the engine reports non-UTF-16 offsets.

Acceptance:

- Packaged Electron build loads the corrector engine.
- Dictionary/ignore actions survive app restart.
- Non-ASCII text maps diagnostics to the correct CodeMirror offsets.

## Phase 3: Autocomplete UI With Local/Fake Provider

Goal: prove ghost-text ergonomics before model calls.

Deliverables:

- `src/editor/ideaAutocomplete/` extension.
- Ghost text widget with `aria-hidden`, non-selectable styling, and no pointer
  interaction.
- Trigger heuristics based on shared Markdown context.
- `Tab` accept, `Esc` dismiss, no autocomplete in excluded Markdown regions.
- Cancellation/suppression on edits, cursor moves, blur, popovers, review modes,
  IME, and repeated dismissals.
- Local fake provider for tests and manual tuning.

Acceptance:

- Ghost text appears only in prose after a pause.
- `Tab` inserts suggestion only when ghost text is visible.
- Normal Tab behavior remains unchanged otherwise.
- One undo removes an accepted suggestion.

## Phase 4: Autocomplete IPC And Provider Path

Goal: connect autocomplete to trusted main-process model access.

Deliverables:

- `electron/ipc/autocomplete.ts`
- `electron/agent/autocomplete.ts`
- `AgentService.autocompleteIdea`
- Preload/types for `autocompleteIdea`, `cancelAutocompleteIdea`, and
  writing-assist availability/status.
- Workspace-session and Markdown path validation in main.
- Timeout, cancellation, single-flight, length caps, and no raw prefix/suffix
  diagnostics.

Provider order:

1. Codex app-server when connected and suitable.
2. OpenAI API key only when `autocompleteApiFallbackEnabled` is explicitly true.
3. Disabled/unavailable status otherwise.

Acceptance:

- Renderer never sends `workspaceRoot`.
- Unsafe/stale document paths are rejected in main.
- API fallback is never used unless explicitly enabled.
- Slow or failed provider calls suppress quietly.

## Phase 5: Autocomplete Tuning And QA

Goal: make the feature useful without becoming noisy.

Deliverables:

- Real-writing latency tuning.
- Suppression thresholds tuned from manual sessions.
- Optional status text in the writing-assists popover for unavailable provider
  states.
- Spanish evaluation examples before enabling broad Spanish autocomplete claims.

Acceptance:

- Suggestions feel quiet and cancellable.
- Autocomplete does not appear during review, correction popovers, code blocks,
  links, or active IME composition.
- Packaged Electron build exposes the IPC and rejects unsafe requests.

## Test Gate

Before asking for product QA:

- `npm run typecheck`
- `npm test -- --run`
- `npm run build`
- Focused unit tests for:
  - Markdown exclusion helper
  - corrector stale-safe fixes
  - corrector keyboard/click popover behavior
  - autocomplete keymap behavior
  - autocomplete IPC validation and API fallback opt-in

## Dependencies Between Phases

- Phases 1 and 3 both depend on Phase 0.
- Phase 4 depends on Phase 3 UI behavior being stable.
- Phase 2 can run in parallel with Phase 3 after the corrector MVP exists.
- Phase 5 should wait until provider integration is complete.

