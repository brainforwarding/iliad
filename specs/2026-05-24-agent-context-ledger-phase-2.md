# Agent Context Ledger Phase 2

Date: 2026-05-24
Status: reviewed spec

## Problem

Phase 1 creates a run-scoped context manifest, but users still cannot see what a
completed assistant response used. The composer has an `Auto` chip, yet that
chip does not explain the policy and the transcript does not show whether a run
used the current file, Codex workspace runtime access, or the OpenAI API
current-request-only path.

The risk is the same product risk identified in the roadmap: the agent can feel
like magic context, or like it is attached to a single file, instead of a
workspace conversation with explicit per-run context.

## Product Intent

Phase 2 adds a quiet, minimal context disclosure on assistant responses. It
should be visible only after a run exists, collapsed by default, and grounded in
the Phase 1 manifest. It should not become a dashboard or a replacement for the
future context picker.

## Goals

- Attach `result.contextManifest` to the assistant transcript entry for
  successful runs.
- Render a small collapsed disclosure under assistant messages that have a
  manifest.
- Summarize context in one muted line, for example `Context: 1 file` or
  `Context: 1 file + workspace access`.
- When expanded, show human-meaningful metadata first:
  - current file relative path or label;
  - workspace access, when Codex runtime access was available;
  - explicitly excluded workspace files, when the OpenAI API fallback was used.
- Keep provider/model/status as a secondary muted metadata line.
- Do not show base hashes or inclusion modes as primary text in Phase 2.
- Keep the disclosure visually quieter than assistant prose.
- Add localized English/Spanish copy through `AppStrings`.
- Make the composer `Auto` chip minimally inspectable with `aria-label` and a
  subtle hover/focus tooltip. Do not add persistent explanatory copy to the
  composer.
- Cover the summary/formatting helpers with unit tests.

## Non-Goals

- No manual context picker.
- No `@file` mention parsing.
- No workspace search UI.
- No persistent run history browser.
- No new provider events.
- No assistant response parsing for context. The UI must use the typed
  `contextManifest`.
- No large popover or always-expanded explanation in the chat.

## User Flow

1. User sends a message.
2. The agent runs as it does today.
3. On success, the assistant message appears normally.
4. Under that message, a small collapsed disclosure appears:

   ```text
   Context: 1 file + workspace access
   ```

5. If the user expands it, they see a compact metadata list:

   ```text
   s2.md

   Workspace access

   Codex · gpt-5.5
   ```

6. Error entries may omit the disclosure in Phase 2 to keep failure UI simple,
   even though failed manifests are persisted.

## UI Details

- The assistant text itself must continue to render exactly as prose with
  preserved line breaks.
- The context disclosure is a separate child element under assistant text, not
  pasted into the assistant message string.
- Closed disclosure text should be short, secondary, and clearly interactive.
  Use the existing secondary text color family (`#72766e` or equivalent),
  smaller assistant/chrome type, and no card/border treatment.
- Expanded rows should use the assistant/chrome font, not the document renderer
  font.
- Use a `<details>` element for native keyboard accessibility.
- Wrap assistant prose and context disclosure separately so existing message
  line breaks stay `pre-wrap`, while the context disclosure uses
  `white-space: normal`.
- The disclosure should not affect proposal cards or the document review UI.
- The `Auto` chip should stay in the composer and remain visually chip-like.
  Add `assistant.context.autoTooltip` copy and render it through the same
  tooltip affordance used by icon buttons where practical. Future work can
  replace this with a richer popover when manual context controls exist.

## Implementation

Touch:

- `src/assistant/useAssistantRun.ts`
  - Extend `AssistantEntry` with `contextManifest?: AgentRunContextManifest`.
  - Attach `result.contextManifest` to the assistant entry after a successful
    run.

- `src/components/assistant/AssistantTranscript.tsx`
  - Render assistant text and, when present, an
    `AssistantContextDisclosure`.

- `src/assistant/assistantUtils.ts`
  - Add pure helpers for context summary, item grouping, short hashes, and item
    display text.

- `src/i18n/strings.ts`
  - Add `assistant.context.run`, `included`, `available`, `excluded`,
    `provider`, and `autoTooltip` in English/Spanish. Inclusion labels may
    exist for tests/future use, but should not dominate the primary UI.

- `src/components/assistant/AssistantComposer.tsx`
  - Add a native tooltip/aria-label to the `Auto` chip using the new context
    copy.

- `src/styles/assistant.css`
  - Add quiet styles for the disclosure and chip tooltip affordance.

## Tests

Add/update tests for:

- `contextManifestSummary` with:
  - no file;
  - one current file;
  - multiple file-like items;
  - Codex workspace available item;
  - OpenAI excluded workspace item.
- `shortContextHash` truncates safely and omits empty hashes.
- `contextManifestDetailRows` never exposes workspace ids as primary display
  text and produces stable labels from manifest items.
- `proposal`/`reference` items, empty `items`, missing `baseHash`, and
  failed/canceled statuses do not break formatting.
- One render-level test or lightweight component/hook test that stubs
  `contextManifest` and verifies the assistant transcript renders a context
  disclosure. If adding React component test infrastructure is too heavy, keep
  this to a direct `AssistantTranscript` render with the existing test stack.

Run:

- `npm run typecheck`
- `npm test`
- `npm run smoke:review`
- `npm run build`

## Rollout

This is additive UI. Existing transcripts from before Phase 1 simply lack
`contextManifest` and render unchanged.
