# Assistant history: in-panel drawer (not a floating popover)

Date: 2026-05-25
Status: implemented (Approach A — lift state + conditional swap into `grid-row: 4`)

## How it shipped

- `historyOpen` lives in `AssistantPanel`; the header is now a controlled toggle
  (`historyOpen` + `onToggleHistory`).
- `AssistantHistoryPopover` → `AssistantHistoryView` (presentational, pinned to
  the chat's `grid-row: 4`, with a back + clear header and Esc-to-close).
- While history is open, settings/pending/transcript are not rendered; the panel
  header (row 1) and composer (row 5) stay put. Slide-in is gated by
  prefers-reduced-motion. Opening history closes the settings pane.
- No IPC/data changes, as planned.

## Follow-up (same day): unified shell + settings

History and Settings now share one shell, `AssistantPanelView` (back header +
scroll body + Esc), both pinned to `grid-row: 4`:

- History, Settings, and chat are mutually exclusive; opening one closes the
  other. The composer is hidden whenever either overlay is open (chat no longer
  peeks at the bottom).
- Settings opens the same way (full-body swap with a back arrow) instead of an
  additive row above the chat.
- Drill-in navigation: opening History/Settings **replaces** the control bar
  (rather than stacking a second title bar under it). The shared view spans the
  full panel (`grid-row: 1 / -1`) and its bar mirrors `.assistant-header`, so the
  only controls are `‹ Back` (+ Clear in History). No cross-navigation between
  sub-views and no dead `+`/icon buttons; one way in, one way out.
- Settings content was made more minimal: uppercase section labels
  (`Connection / Model / Mode`), two connection cards with role tags ("Powers
  chat" / "Powers dictation") and a status dot, the OpenAI API key collapsed
  behind "Change key" once saved, trimmed helper text, and a compact
  right-aligned Save button.

## Problem

The Agent history (`Historial`) currently renders as an absolutely-positioned
popover anchored to the clock button in the assistant header
(`.assistant-history-popover`, `position: absolute; right: -42px`). Because the
assistant panel is only ~280–320px wide and the popover is 320px wide and
offset to the right, it spills **out over the editor**, reading as a detached
floating window rather than part of the Agent panel. It also overlaps the topbar
icons and the editor content.

We want history to live **inside the Agent panel** — a contained view that
slides over the panel body (below the header), never escaping the panel's
bounds.

## Goal

- History opens as an in-panel drawer occupying the assistant content region
  (the area between `.assistant-header` and the composer), not a floating box.
- It never overlaps the editor or topbar.
- It has its own back/close affordance and a title row, so it reads as a
  distinct view rather than a tooltip-sized popover.
- Selecting a thread loads it and returns to the chat view.
- Behavior under `prefers-reduced-motion`: no slide, just show/hide.

## Proposed look

Closed (today):

```
┌ Agent ──────────────── [+] [🕐] [⚙] ┐   ← clock toggles history
├──────────────────────────────────────┤
│  (chat transcript)                     │
│                                        │
├──────────────────────────────────────┤
│  Ask anything…              [🎙] [➤]  │
└──────────────────────────────────────┘
```

Open — history covers the body, stays inside the panel:

```
┌ Agent ──────────────── [+] [🕐] [⚙] ┐
├──────────────────────────────────────┤
│ ‹ Historial                  Limpiar │  ← view header: back + clear
│ ──────────────────────────────────── │
│ Hoy                                   │
│   Plan de clase            2h         │
│   Rúbrica módulo 3      ›  ahora      │  ← active row marked
│ Ayer                                  │
│   Ideas charla VMA         1d         │
│ Esta semana                           │
│   Borrador curso UDD       3d         │
├──────────────────────────────────────┤
│  Ask anything…              [🎙] [➤]  │  ← composer stays visible (disabled)
└──────────────────────────────────────┘
```

Empty:

```
├──────────────────────────────────────┤
│ ‹ Historial                           │
│ ──────────────────────────────────── │
│                                        │
│        Sin conversaciones guardadas    │
│                                        │
├──────────────────────────────────────┤
```

## Implementation sketch

Owner files (per CLAUDE.md feature placement):

- `src/components/AssistantPanel.tsx` — owns the `historyOpen` state (lift it up
  from `AssistantHeader`) and renders either the chat body or the history view
  in the panel's content region.
- `src/components/assistant/AssistantHistoryPopover.tsx` — rename to
  `AssistantHistoryView.tsx`; drop the `role="dialog"`/popover framing, add the
  view header (back button + title + clear). Same grouping/threads logic.
- `src/components/assistant/AssistantHeader.tsx` — the clock button becomes a
  toggle that flips `historyOpen` (passed down), with `aria-expanded`. Remove the
  inline `AssistantHistoryPopover` render and the `.assistant-history-anchor`.
- `src/styles/assistant.css` — replace `.assistant-history-popover` absolute
  positioning with an in-flow `.assistant-history-view` that fills the content
  grid row; add a slide-in transition gated by `prefers-reduced-motion`.

Layout: `.assistant-panel` is a grid of `header / body / composer`. The history
view occupies the same grid cell as the chat body (`grid-row` of the body), so
it never changes the panel's outer size. Composer stays mounted but its controls
are disabled while history is open (matches existing `historyDisabled`).

State/transitions:

- Opening from chat → slide history in from the right edge of the panel
  (`transform: translateX(8px)` + fade, ~160ms).
- `Esc` closes history back to chat.
- Selecting a thread: load, then `setHistoryOpen(false)` (existing behavior).

No IPC or data changes — chat threads, grouping, age formatting, and clear all
stay as-is. This is a presentation/placement change only.

## Out of scope (future)

- Search/filter within history.
- Renaming or pinning threads.
- Recent-workspaces list on the launch screen (separate change; needs renderer
  persistence of a workspace MRU + an open-by-path IPC).
```
