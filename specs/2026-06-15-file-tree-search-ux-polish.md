# File Tree Search UX Polish And Resizable Sidebar

Date: 2026-06-15
Status: reviewed implementation spec
Scope: Polish the file-tree search UI shipped in
`2026-06-14-file-tree-search.md`, and add a resizable sidebar so long file names
are easier to inspect.

## Problem

The initial file-tree search implementation works, but the search control is not
clear enough at a glance:

- Two adjacent `X` buttons look identical even though one clears the query and
  one closes the search control.
- The `ScanSearch` icon for fuzzy matching is visually ambiguous; it can read as
  target, locate, or scan current result rather than "fuzzy search".
- The filter icon is recognizable, but it is not obvious that it toggles between
  highlight mode and filter mode.
- The visible status text is too verbose for the narrow sidebar. Showing the
  active file name plus `match 1 of 3` consumes the same horizontal space users
  need for file names.
- The sidebar has a fixed width, so users with deeply nested folders or long
  filenames have no direct way to inspect the tree comfortably.

## Decision

Ship these fixes together:

1. Make the file-tree sidebar resizable with a subtle right-edge drag handle.
2. Simplify the search control:
   - put Clear inside the search input;
   - keep Close as a distinct control, labeled `Done` where there is room;
   - show visible match status as compact `1/3`;
   - expose the active match relative path through a visually-hidden
     `aria-live` status region, not visible status text;
   - use compact text toggles with stable labels instead of ambiguous standalone
     icons.
3. Preserve single-line tree rows with ellipsis, and show the full relative path
   on hover/focus through a custom path peek. Keep native `title` only as a
   fallback.

Do not wrap filenames by default. Multi-line rows make the file tree harder to
scan and cause row-height jumps while navigating. Do not add horizontal scrolling
inside the tree; it is harder to use than resizing the sidebar and often hides
folder context.

## UX Details

### Resizable Sidebar

- Add a draggable resize handle at the sidebar's right edge.
- Default width remains the current app width.
- Minimum width: `220px`.
- Preferred maximum width: `560px`, but the effective maximum must also respect
  viewport and neighboring-column constraints.
- Use one shared CSS variable, `--sidebar-width`, on `.app-shell` to drive both
  `.app-topbar` and `.app-content`. This must cover normal, assistant-open, and
  responsive states. Do not implement resize by setting width only on `<aside>`;
  the grid column would remain misaligned.
- Sidebar width state lives in `App`, not `FileTree`.
- Prefer an App-owned `.sidebar-frame` as the first grid child, wrapping
  `FileTree` and an absolutely positioned resize handle. Passing resize props
  down only to render the handle is acceptable if grid ownership remains in
  `App`.
- Persist width in a small preferences module that follows existing preference
  patterns, e.g. `src/preferences/sidebarPreferences.ts`, with exported
  clamp/read helpers and localStorage key `iliad:sidebar-width`.
- Double-clicking the resize handle resets to the default width.
- The handle should be subtle at rest and visible on hover/focus.
- The handle must be keyboard accessible:
  - focusable;
  - `role="separator"`;
  - `aria-orientation="vertical"`;
  - localized `aria-label`, such as `Resize file tree`;
  - `aria-controls` pointing at the sidebar region;
  - `aria-valuemin`, `aria-valuemax`, and `aria-valuenow`;
  - localized `aria-valuetext`, such as `File tree width 276 pixels`;
  - `ArrowLeft` / `ArrowRight` adjust by 16px;
  - `Shift+ArrowLeft` / `Shift+ArrowRight` adjust by 48px;
  - `Home` resets to min width;
  - `End` sets max width;
  - `Enter` or double-click resets to default width.
- Use pointer capture while dragging.
- Give the handle a larger invisible hit target than the visible line.
- Set `touch-action: none` on the handle.
- While dragging, set a `col-resize` cursor and prevent text selection.
- Do not let resizing collapse the editor or assistant below their existing
  responsive constraints.

Bounds:

```ts
const min = 220;
const defaultWidth = 276;
const max = Math.max(
  min,
  Math.min(560, viewportWidth * 0.45, availableWidthAfterAssistantAndEditorFloor)
);
```

Use the effective max for interaction and `aria-valuemax`. Do not persist
temporary viewport down-clamps; persist the user's intended width, then clamp it
for the current viewport on render/interaction.

### Search Control Layout

Current layout:

```text
[query input..............] [x] [x]
[active filename, match 1 of 3] [fuzzy icon] [filter icon]
                         [prev] [next]
```

New layout:

```text
[search icon  query.......................... clear-x]
[1/3] [Loose] [Filter]
                                      [up] [down] [Done]
```

Responsive behavior:

- Keep the input row intact.
- The input wrapper is not a `<label>` if it contains the Clear button. Use an
  input `aria-label` or an explicit visually-hidden label instead.
- Put Clear inside the input wrapper at the trailing edge.
- Hide the native `type="search"` cancel affordance so it does not create a
  third close/clear visual.
- Use deterministic wrapping at `220px`; do not rely on unconstrained flex wrap:
  - control row A: visible status + `Loose` + `Filter`;
  - control row B: previous + next + `Done`.
- `Done` remains text at `220px`; it must not collapse to another bare `X`.
- Clear and Done must have distinct visible forms and accessible names.
- The visible count is:
  - empty string for empty query;
  - `No results` for non-empty query with zero matches;
  - `1/3` for active match count.
- The visible count element is not the live region. It may be `aria-hidden`.
- A separate visually-hidden `role="status" aria-live="polite"
  aria-atomic="true"` region announces the full active match relative path, for
  example:
  - `curso-1/s1/guia-dimensiones-casel.md, match 1 of 3`;
  - Spanish equivalent from localized labels.
- The fuzzy toggle visible label should avoid jargon where possible:
  - English visible label: `Loose`;
  - Spanish visible label: `Flexible`;
  - tooltip/description explains that it matches letters in order.
- The filter toggle visible labels:
  - English: `Filter`;
  - Spanish: `Filtro`.
- `Loose` and `Filter` are compact toggle buttons with stable accessible names
  and `aria-pressed`; do not rely on changing `aria-label` to communicate state.
- Tooltips:
  - Clear: `Clear search`;
  - Done: `Close search`;
  - Loose: localized fuzzy-state description, including "matches letters in
    order";
  - Filter on/off: current localized filter state;
  - Prev/next: current localized match navigation labels.

### File Names And Paths

- Keep file rows one line with ellipsis.
- Add a custom path peek/tooltip for truncated and non-truncated rows:
  - shown on row hover;
  - shown on row button `:focus-visible`;
  - viewport-clamped so it cannot be cut off by sidebar overflow;
  - contains the full relative path for real, pending, and virtual nodes;
  - uses `aria-describedby` or equivalent accessible text for keyboard users.
- Keep row `title` as a fallback only.
- The active match live text includes the full relative path; it must not consume
  visible layout width.
- Search descendant count badges remain beside the folder name and should not
  use the trailing pending/external status slot.
- Descendant count badges may remain visually compact and `aria-hidden`, but the
  row accessible description should include descendant-match count when present.
- If a row is both the active editor file and the active search match, both
  states must remain visually legible.

## Non-Goals

- No document-content search in this phase.
- No new global search panel.
- No multi-line file-tree rows by default.
- No horizontal scrolling inside the file tree.
- No new color palette.
- No sidebar layout rewrite beyond resizing and the search-control row polish.

## Implementation Plan

### Phase 1: Spec Review

- Have review agents check:
  - sidebar resizing mechanics and accessibility;
  - search-control clarity at 220px and default width;
  - localization fit for English and Spanish labels;
  - code ownership and preference persistence location.

### Phase 2: Search Control Polish

- Update `FileTreeSearchControl` in `src/components/FileTree.tsx`.
- Move clear into the search input row.
- Convert the input wrapper away from `<label>` if it contains the Clear button.
- Replace visible active-match filename text with compact count text.
- Add a separate visually-hidden live status with full relative path text.
- Replace `ScanSearch` and `ListFilter` icon-only toggles with compact text
  toggles: `Loose` / `Filter` in English and `Flexible` / `Filtro` in Spanish.
- Add short visible labels and stable accessible names in `src/i18n/strings.ts`.
- Ensure `Escape`, clear, close, previous, next, fuzzy, and filter behavior do
  not regress.
- Update `src/styles/sidebar.css` to support the new control layout.
- Add an `sr-only` or equivalent visually-hidden utility if one does not already
  exist.

### Phase 3: Resizable Sidebar

- Add `src/preferences/sidebarPreferences.ts` with:
  - `minimumSidebarWidth = 220`;
  - `defaultSidebarWidth = 276`;
  - `maximumPreferredSidebarWidth = 560`;
  - `sidebarWidthStorageKey = "iliad:sidebar-width"`;
  - `clampSidebarWidth`;
  - `readSidebarWidth`;
  - `useSidebarWidth` or equivalent hook.
- Add sidebar width state in `App` via that hook.
- Apply `--sidebar-width` on `.app-shell`.
- Update `src/styles/chrome.css` grid templates:
  - `.app-topbar`;
  - `.app-content`;
  - `.assistant-is-open .app-content`;
  - responsive `<=760px` overrides.
- Add an App-owned `.sidebar-frame` wrapper or equivalent first grid child that
  contains `FileTree` and the resize handle.
- Add a resize handle component or inline handle adjacent to `FileTree`, not
  inside the scrolling tree.
- Clamp loaded and dragged values to min/max bounds.
- Reset width on double-click and keyboard `Enter`.
- Avoid writing localStorage on every pointermove if a simple debounced or
  pointerup write is practical.
- Use pointer capture and restore document cursor/user-select state on pointer
  up or cancellation.

### Phase 4: Path Peek And Styling

- Use existing tokens only.
- Keep the handle subtle:
  - transparent/resting hit area;
  - visible hairline or accent wash on hover/focus/drag;
  - no large decorative grip.
- Preserve the sidebar's existing border-right visual.
- Add custom path peek styling in `src/styles/sidebar.css`.
- Show path peek on hover and keyboard focus.
- Ensure tooltip/peek is viewport-clamped or positioned so it is not clipped by
  sidebar overflow.
- Verify the search control does not overlap at:
  - default sidebar width;
  - 220px width;
  - 560px width;
  - 200% browser zoom if feasible.

## Testing

Automated:

- Existing `npm run typecheck`.
- Existing `npm test`.
- Existing `npm run lint:css`.
- Add focused pure tests for `src/preferences/sidebarPreferences.ts`:
  - clamps below min to `220`;
  - clamps above effective max;
  - effective max never falls below min;
  - malformed localStorage values fall back to default;
  - persisted preferred values are not overwritten by temporary viewport clamps;
  - reset returns default.
- Add tests for any extracted width keyboard helper, if one is created:
  - arrow increments;
  - Shift+arrow larger increments;
  - Home/End behavior;
  - Enter reset.
- Add a static render test for the search control if it can be exported without
  making `FileTree.tsx` harder to reason about. Otherwise document manual QA for
  the same assertions:
  - visible count is compact;
  - active filename is not rendered visibly in the count;
  - live status contains the full localized active-match relative path;
  - `Loose` and `Filter` toggles expose stable names and `aria-pressed`.

Manual QA:

- Drag sidebar wider and narrower.
- Double-click resize handle resets width.
- Keyboard resize handle with arrows, Shift+arrows, Home, End, Enter.
- Restart app and verify persisted sidebar width.
- Open search and verify Clear and Done are visually distinct.
- Type a query with 3+ matches and verify visible count is `1/3`.
- Toggle Loose and Filter and verify their state is understandable without
  relying on tooltips.
- Verify English and Spanish layouts at `220px`, default width, max width, and
  assistant-open state.
- Verify long file names remain single-line with ellipsis and full path peek on
  hover and keyboard focus.
- Verify pending dots, descendant badges, active editor row, and active search
  row can coexist.
- Verify resize separator ARIA attributes in browser dev tools or accessibility
  inspector.

## Acceptance Criteria

- `--sidebar-width` drives both topbar and content grid columns in normal,
  assistant-open, and responsive states.
- The resize handle exposes separator ARIA attributes and supports pointer,
  keyboard, double-click, and persistence behavior.
- English and Spanish search controls do not overlap at `220px`, default width,
  max width, and 200% zoom.
- Clear and Done have distinct visible forms and accessible names.
- Visible search status is compact; full active-match relative path appears only
  in the hidden live status and path peek/tooltip surfaces.
- Row full paths are reachable by hover and keyboard focus.
- All automated checks pass.

## Review Notes

Agent review completed:

- UI review confirmed the overall direction, but required grid-level sidebar
  constraints, deterministic 220px search-control wrapping, visible and hidden
  status separation, and a real path peek instead of native-only `title`.
- Accessibility/localization review required separator ARIA attributes,
  localized width value text, stable toggle names with `aria-pressed`, short
  visible English/Spanish labels, and keyboard-visible path access.
- Architecture review required App-owned sidebar width state, a
  `src/preferences/sidebarPreferences.ts` helper module, `--sidebar-width` on
  `.app-shell`, and updates to both topbar and content grid templates.
