# Editor Writing Corrector

Date: 2026-06-14
Status: research-backed product/implementation spec
Scope: Inline spelling, grammar, and style diagnostics in the Markdown editor.

## Problem

Iliad should help users catch words and phrases that are misspelled, duplicated,
awkward, or grammatically wrong while they write Markdown. The feature should
feel like a writing surface aid, not an agent run: words are underlined, the
user clicks the mark, sees concrete fixes, and applies one fix with normal undo.

The implementation must preserve the source-as-contract rule. The corrector may
decorate text and apply explicit user-selected replacements, but it must never
rewrite the Markdown file in the background or on save.

## Research Summary

Best current fit:

1. Use CodeMirror 6 `@codemirror/lint` as the editor integration layer.
   CodeMirror diagnostics already support ranged marks, hover/tooltips, and
   diagnostic actions that can apply a fix to the current mapped range.
   Sources: [CodeMirror lint example](https://codemirror.net/examples/lint/),
   [CodeMirror reference](https://codemirror.net/docs/ref/).
2. Start with Harper for offline English correction. Harper is open source,
   Rust/WASM-based, privacy-first, and designed to run locally. Harper.js exposes
   async linting, suggestions, ignored lints, custom words, dialects, and spans
   that identify the problem text and replacement range.
   Sources: [Harper repo](https://github.com/Automattic/harper),
   [harper.js linting](https://writewithharper.com/docs/harperjs/linting),
   [Harper spans](https://writewithharper.com/docs/harperjs/spans).
3. Add LanguageTool or LTeX+ later for Spanish/multilingual grammar. LanguageTool
   is mature and supports many languages, but the local server is heavier and the
   public API is not the right default for per-keystroke checks.
   Source: [LanguageTool repo](https://github.com/languagetool-org/languagetool).
4. Keep Vale, textlint, and cspell as optional future engines. Vale is excellent
   for editorial style guides but is not a general-purpose grammar corrector.
   Textlint is pluggable and Markdown-aware, but requires rule selection. cspell
   is useful for spelling and dictionaries only.
   Sources: [Vale docs](https://vale.sh/docs),
   [textlint](https://textlint.org/),
   [cspell](https://github.com/streetsidesoftware/cspell).

Electron native spellcheck is not enough for Iliad's CodeMirror surface. Electron
does expose Chromium/native spellchecking, context-menu suggestions, language
configuration, and dictionary APIs, but this is spelling-only and works best for
native editable elements, not for a CodeMirror diagnostic/action model.
Source: [Electron SpellChecker](https://www.electronjs.org/docs/latest/tutorial/spellchecker).

## Recommendation

Build a local-first `writingCorrector` feature with a normalized engine
interface:

```ts
interface WritingIssue {
  id: string;
  from: number;
  to: number;
  originalText: string;
  severity: "info" | "warning" | "error";
  category: "spelling" | "grammar" | "style";
  source: "harper" | "languagetool" | "vale" | "textlint" | "cspell";
  ruleId: string;
  message: string;
  suggestions: Array<{ label: string; replacement: string }>;
  canAddToDictionary?: boolean;
  canIgnore?: boolean;
}
```

Phase 1 should ship Harper.js in a worker for English documents only. When the
app/document language is Spanish, the Corrector switch stays visible but shows a
subdued unavailable state such as `English corrector only for now`; the editor
does not mark Spanish text. Phase 2 should add a LanguageTool/LTeX+ sidecar or
explicit opt-in LanguageTool endpoint for Spanish and other languages. The UI
should already be engine-neutral so the second engine does not change editor
behavior.

## Goals

- Underline spelling/grammar/style issues in the CodeMirror Markdown editor.
- Let the user click an issue and apply a concrete correction.
- Support `Ignore once`, `Ignore in this document`, and `Add to dictionary`
  where the engine supports it.
- Keep all checking local by default.
- Run checking off the renderer hot path.
- Never mutate Markdown unless the user explicitly chooses a correction.
- Keep fixes undoable as one CodeMirror transaction.
- Respect Markdown structure: skip code fences, inline code, URLs, image paths,
  front matter where appropriate, and generated review blocks.
- Provide one topbar writing-assists popover with toggles for Corrector and
  Autocomplete.
- Provide a keyboard path to issue actions in Phase 1.

## Non-Goals

- No background auto-correct.
- No rewrite-on-save.
- No whole-document AI rewrite.
- No persistent diagnostic sidecar files inside the workspace by default.
- No required cloud service.
- No grammar panel in the first pass unless a later QA pass shows click popovers
  are insufficient.

## Current Architecture Fit

Relevant files today:

- `src/components/EditorPane.tsx` owns CodeMirror extensions and already disables
  built-in autocompletion in `basicSetup`.
- `src/editor/selectionComments/extension.ts` and `src/editor/aiReview/extension.ts`
  show the local pattern for defensive decorations, mapped positions, and
  stale-safe transactions.
- `src/styles/editor.css` already owns CodeMirror decoration styling.
- `src/components/TypographyMenu.tsx` is the model for compact topbar popovers.
- `src/preferences/editorPreferences.ts` persists display-only settings in
  `localStorage`.

The corrector should be a new editor module, not part of agent chat:

```text
src/editor/writingCorrector/
  extension.ts
  harperWorker.ts
  markdownRanges.ts
  issues.ts
  applyFix.ts
  __tests__/
src/editor/writingAssistContext.ts

electron/writingCorrector/
  correctorStore.ts
electron/ipc/writingCorrector.ts
```

Add `@codemirror/lint` and `harper.js` as direct dependencies. `@codemirror/lint`
is already present transitively through CodeMirror packages, but a direct
dependency makes the contract explicit. The Harper worker/WASM asset must be
verified in both Vite dev and packaged Electron builds.

## UX

### Topbar

Add a compact `WritingAssistsMenu` in `.topbar-actions`, adjacent to the current
typography/language controls. Use the existing 30px `.icon-button` pattern and a
writing-specific icon such as `PenLine`; avoid spark/wand imagery that suggests
an agent run. The popover contains two switches:

- `Corrector`
- `Autocomplete`

Each switch controls a local preference. The popover can later grow a short
secondary row for language/engine status, but it should not become a settings
panel.

Switch accessibility:

- Use `role="switch"` and `aria-checked`.
- Space/Enter toggles the focused switch.
- `Esc` closes the popover.
- Click outside closes the popover.
- Focus returns to the trigger after close.

### Issue Marks

- Phase 1 uses one subdued corrector squiggle color for all issue categories,
  backed by dedicated CSS tokens such as `--corrector-mark` and
  `--corrector-mark-active`. Do not reuse Flow's existing blue/comment,
  amber/pending, or red/diff-error hues for category meaning.
- Category appears in the popover metadata, not primarily through color.
- Style diagnostics are off by default. Start with spelling and concrete grammar
  issues such as repeated words; subjective style hints can be enabled later.
- Active line should still be editable source. Marks may remain visible, but
  popovers must not block the caret.
- Suppress marks on the current word/token while the user is typing.
- Suppress marks while IME composition is active.
- During persistent review, Tighten inline review, selection-comment composition,
  or any open correction popover, suspend new corrector runs. In review mode,
  also hide existing corrector diagnostics on changed review lines to avoid
  fighting the red/green review UI.

### Click-To-Fix Popover

Clicking or keyboard-focusing an issue opens a small anchored popover:

- Message, one line if possible.
- Up to 5 suggestions as buttons.
- Secondary actions: `Ignore`, `Add to dictionary`, `Disable rule` where
  available.
- Source/rule label in subdued text, for example `Harper: RepeatedWords`.

Keyboard behavior:

- `Esc` closes the popover.
- `Enter` applies the focused suggestion.
- `Tab` follows normal focus navigation inside the popover, not autocomplete.
- `Mod-.` opens issue actions at the cursor in Phase 1, matching the code action
  pattern used in editors such as VS Code.

Do not use CodeMirror's default lint hover behavior if it becomes visually noisy.
Iliad should open correction UI on click or explicit keyboard invocation, not on
incidental hover.

Keyboard precedence:

1. Active correction popover handles `Esc`, `Enter`, and focus traversal first.
2. Ghost-text autocomplete handles `Tab`/`Esc` only when no correction popover is
   active.
3. Selection comments, Tighten review, and persistent review shortcuts keep
   their existing precedence.

Opening a correction popover dismisses active ghost text and suppresses new
autocomplete requests until the popover closes and the user makes another
meaningful edit.

## Engine Behavior

### Harper Phase

Use Harper.js `WorkerLinter` where possible. Harper's own docs recommend the
worker implementation for interactive web apps because local WASM work on the
main event loop can hurt responsiveness.

Flow:

1. On enable, lazy-load the worker and call setup during idle time.
2. On document change, debounce linting by 600-900 ms.
3. Send only the active document text and language/dialect settings to the
   worker.
4. Convert Harper lint spans to CodeMirror offsets.
5. Convert Harper suggestions into diagnostic actions.
6. Cache ignored lint hashes and custom words through the main-backed corrector
   store.

Harper spans are over Unicode scalar values. JavaScript and CodeMirror offsets
are UTF-16 code units. The adapter must include tested offset conversion for
emoji, combined accents, and non-ASCII punctuation.

### LanguageTool/LTeX+ Phase

Spanish support should not be forced through Harper until Harper has real
Spanish coverage. Options:

- Local sidecar: ship or locate LanguageTool/LTeX+, spawn from Electron main or
  a utility process, bind to localhost/random port, and manage lifecycle.
- User-provided endpoint: allow an advanced opt-in endpoint, clearly labeled as
  sending document text outside the app.

Do not use the LanguageTool public API as the default real-time backend. If a
cloud endpoint is added, make it explicit, opt-in, rate-limited, and off by
default.

## Markdown Filtering

Prefer engine-native Markdown awareness when available, then add Iliad-side
guardrails:

- Do not lint fenced code blocks.
- Do not lint inline code.
- Do not lint raw URLs, image/link destination paths, or HTML attributes.
- Do lint link labels and normal prose.
- Be conservative in YAML front matter: spelling can be noisy in keys and paths.
- Do not run on virtual `create_file` review content unless explicitly enabled.

Use a shared `src/editor/writingAssistContext.ts` helper for both corrector and
autocomplete. It should expose prose ranges, excluded Markdown ranges, heading
context, and cursor classification so both features agree on what counts as
normal prose. Use CodeMirror/Lezer Markdown syntax tree where practical. Avoid
regex-only Markdown parsing except for simple fallback range exclusion.

## Data And Privacy

- Corrector enabled/disabled: `localStorage`.
- Engine choice and English dialect: `localStorage` at first; move to a settings
  store only when there are cross-window preferences.
- User dictionary: app user data, not Markdown files, via a main/preload-backed
  store under Electron `userData`.
- Workspace dictionary: future explicit `.harper-dictionary.txt` or equivalent,
  only if the user opts into sharing dictionary entries with the workspace.
- Ignored lint hashes: app user data per workspace/session, stored through the
  same main-backed corrector store.
- No text leaves the device in Phase 1.

Renderer code may hold transient worker state, but durable dictionary and ignore
actions must not depend on `localStorage`.

## Implementation Plan

1. Add `useWritingAssistPreferences` for `correctorEnabled` and
   `autocompleteEnabled`.
2. Add `WritingAssistsMenu` to `src/components/`.
3. Add `@codemirror/lint` direct dependency.
4. Add `harper.js` direct dependency and verify worker/WASM loading in dev and
   packaged Electron.
5. Add `electron/writingCorrector/correctorStore.ts`, preload methods, and IPC
   handlers for dictionary and ignored-lint persistence.
6. Build `writingCorrectorExtension(options)` that converts `WritingIssue[]` to
   CodeMirror diagnostics/actions.
7. Add a Harper worker adapter behind an engine interface.
8. Add shared Markdown/prose exclusion helper with tests.
9. Wire the extension into `EditorPane` only when enabled, file is a real open
   Markdown file, and no create-file review is active.
10. Pass `blockedLineRanges` into `writingCorrectorExtension`, mirroring review
    and Tighten line suppression.
11. Style squiggly marks and popovers in `src/styles/editor.css` or a small
   `writing-corrector.css` imported from the existing style bundle.
12. Add tests for issue mapping, Unicode offsets, dictionary actions, ignored
    lints, and stale-safe correction application.

## Acceptance Safety

Applying a suggestion must synchronously verify that the current document slice
at `{ from, to }` still equals `issue.originalText`. If it does not match,
dismiss the issue and wait for the next lint run.

```ts
view.dispatch({
  changes: { from, to, insert: suggestion.replacement },
  selection: { anchor: from + suggestion.replacement.length }
});
```

No `await` may happen between verification and dispatch.

## Verification

- `npm run typecheck`
- `npm run build`
- Unit tests:
  - Harper span to CodeMirror offset conversion with non-ASCII text.
  - Markdown code fence/inline code exclusion.
  - Diagnostic actions apply and undo as one transaction.
  - Stale issue ranges do not apply.
  - Main-backed dictionary and ignore persistence.
  - Review/Tighten blocked lines suppress diagnostics.
  - Current word and IME composition suppress marks/runs.
  - Corrector toggle persists without modifying Markdown.
- Manual checks:
  - English typo gets squiggly underline and suggestions.
  - Repeated word gets a grammar/style suggestion.
  - Code blocks and image URLs are not underlined.
  - Clicking a suggestion applies only that replacement.
  - Review mode does not show noisy corrector marks inside red/green diffs.
  - Packaged Electron build can load the Harper worker and WASM asset.

## Open Questions

- Should workspace dictionaries live outside the workspace by default, with an
  explicit "share dictionary with this workspace" command later?
- Should there be navigation commands for next/previous issue in the first
  release?
