# Premium pass: calmer chrome, paper-premium colors, review in the top row

Date: 2026-09-27. Status: implemented and verified locally (2026-09-27); implementation reviewed by Codex xhigh; not released (owner).
Branch: `premium-pass` (off `record-shortcuts`). Endpoint: implemented and
verified in the local build, **no release** (owner, 2026-09-27).

Sources of truth:
- Figma `i2BTwgceho8SqRYGZKjLhB`, page "Premium pass (2026-09-27)", board
  `75:3`, frames A–J (A writing, B reviewing, C sidebar hidden, D peek,
  E full screen, F/G empty states, H settings, I rendered suggestion,
  J updates in Settings / folder menu).
- `~/Documents/docs/iliad-ideas.md` (+ its comments): the discussion and the
  owner's decisions, points 1–10.

Owner decisions (2026-09-27): paper premium (warm page, neutral light chrome);
system font for the UI; no tab; no focus button; app settings in a sidebar
footer; files without icons; empty state G (recent documents, lighter
version); Settings has **no shortcut** (⌘, stays the Sentence key); the
sidebar peek is the same sidebar (rounded right corners, faint edge, no
shadow); settings tabs sit at the **bottom** of the panel so they never move.

## Problem

The app feels close to premium but not quite: a brand-y UI font (Avenir
Next), lines and bands instead of tone, cream everywhere with olive greys,
controls that don't line up with the traffic lights, an icon on every tree
row, heavy mixed icons, a clip-art empty state, a single tab that promises
tabs we don't have, and review controls that sometimes disappear.

## What stays the same

Save model, file operations, review engine (baseline, hunks, keep/restore
semantics), comments, writing AI, shortcuts recording, CLI, i18n EN/ES,
sidebar resize and width limits, Back/Forward history, ⌘W close, ⌘O open,
the document serif (`--font-serif`, Iowan Old Style / New York).

## Stage 1 — Foundations (tokens, font, icons, the shift bug)

1. **Font.** `--font-sans` → `-apple-system, BlinkMacSystemFont, "SF Pro
   Text", "Helvetica Neue", system-ui, sans-serif` (drop Avenir Next / Inter).
   Add `--text-ui: 0.8125rem` (13px) for sidebar rows and chrome labels.
2. **Colors** (`src/styles/tokens.css`; roles unchanged, values change):
   - `--editor` (page) `#fdfcf8`; `--card` / `--sidebar` (chrome) `#faf9f6`.
   - `--hairline` `#ecebe7`; `--hairline-strong` `#e3e2dd`;
     `--border-control` `#d9d8d3`.
   - Neutral greys (no olive): `--ink-1` `#1d1d1f` (prose), `--ink-2`
     `#2c2c2e` (chrome text), `--ink-3` `#37373a` (tree rows), `--muted-1`
     `#5f5f64`, `--muted-2` `#6e6e73` (caption floor, ≥4.3:1 on both
     surfaces), `--muted-3` `#9c9ca0` (decorative/disabled only).
   - New `--icon: #8e8e93` for icon glyphs (≥3:1 on `#faf9f6` for WCAG
     1.4.11; Figma's `#9c9ca0` is too faint for icon buttons — deliberate
     deviation).
   - Selected / hover rows: `--row-selected: #f0efeb`, `--hover-wash` a
     neutral equivalent. `--paper` stays the "ground + neutral hover" role
     with a neutral value (`#f3f2ef`).
   - Accent graphite, brand gold, status, diff, comment tokens: unchanged.
3. **Icons.** New `src/components/Icon.tsx`: wraps a lucide icon with the one
   drawing rule — 16px, `strokeWidth` 1.5, `currentColor` (callers color it
   `--icon`). Every chrome icon uses it. Allowed exceptions: 12px chevrons in
   the tree, the ✦ mark.
4. **Panels never shift** (review bar hidden / gap above the pending band):
   `.app-content`, `.editor-shell`, `.sidebar` (and `.app-shell`) get
   `overflow: clip` instead of `hidden`, so code (focus, `scrollIntoView`)
   can't scroll them. Inner scroll owners are unchanged (see Review).
5. **Light scrollbars** (owner, from GPT): today there is no scrollbar
   styling, so Chromium's default grey bar shows. All scroll areas (tree,
   editor, popovers, search results) get a thin (8px) scrollbar with no
   track and a faint rounded thumb (`--scrollbar-thumb`, a neutral close to
   `--hairline-strong`), one step darker on hover (`--scrollbar-thumb-hover`).

## Stage 2 — Window chrome (Figma A, C, D, E)

1. **Top row** 52px (`--topbar-height`, one token replacing the three
   hard-coded 44px). No background of its own, no bottom line: the left part
   has the sidebar color, the rest the page color. `trafficLightPosition`
   re-centered on the 52px row (tune live; start `{ x: 20, y: 19 }`).
2. **Left controls** — sidebar toggle, ‹ › — sit right of the traffic lights,
   inside the sidebar column (Figma A). Toggle icon: lucide `PanelLeft`.
3. **Removed:** the document tab (and its ×; ⌘W still closes), the focus
   button and `focusMode` state (Escape no longer toggles it), the Aa / pen /
   language icon buttons (they move into Settings, stage 4).
4. **Sidebar hidden** (Figma C): the same controls stay beside the traffic
   lights; a quiet breadcrumb follows (`folder / sub / name`, `.md` hidden,
   last part `--muted-2`, the rest `--muted-3`, ellipsized from the left).
   The breadcrumb shows only while the sidebar is hidden.
5. **Peek** (Figma D): with the sidebar hidden, hovering the toggle or a 6px
   left-edge zone shows the regular sidebar over the page (same width, color,
   content; right corners 10px; faint edge; no shadow). It hides ~250ms after
   the pointer leaves both; clicking the toggle pins it (sidebar open).
   The page does not move. Escape hides the peek.
6. **Full screen** (Figma E): main tells the renderer when the window enters
   or leaves full screen (`window:fullscreen-changed` event + initial state in
   `getWindowState()`), the shell gets `is-fullscreen`, and the left controls
   move to the far left (no traffic-light gap).
7. **Shortcut ⌃⌘S** toggles the sidebar: a View menu item "Show Sidebar" /
   "Hide Sidebar" (accelerator `Ctrl+Cmd+S`) sent to the focused window.
   Tooltips can show a shortcut chip (`data-tooltip-shortcut`, rendered as a
   small `kbd` in the tooltip). `Mod-Ctrl-s` joins the taken-shortcut list.
8. **⌘N** creates a new document (window keydown, same rules as ⌘O);
   `Mod-n` joins the taken-shortcut list.

## Stage 3 — Sidebar (Figma A, B)

1. **Header:** "docs ⌄" + two icons: search and new document (lucide
   `SquarePen`). **New folder** moves to the WorkspaceMenu ("New folder",
   after "Open folder…") and to the tree context menu on folders; both use the
   existing `onCreateFolder` and its creation target rules. The WorkspaceMenu
   becomes only about the folder: path, Open folder… ⌘O, New folder, recent
   folders. **Check for updates leaves it** (stage 4, Figma J).
2. **Rows:** 28px, `--text-ui`, `--ink-3`. Files: no icon. Folders: 12px
   chevron (right / down) instead of Folder/FolderOpen, in `--icon`.
   Pending create/delete keep their meaning through the dot (create green,
   delete with strike-through) instead of FilePlus/FileX icons. Non-Markdown
   files: no icon, muted as today, external hint on hover as today.
3. **Active row:** soft rounded fill (`--row-selected`, radius 6), no rail.
4. **Footer:** one "Settings" row (gear icon, label, no shortcut) at the
   bottom of the sidebar, always visible; the tree scrolls above it.
5. **All-documents review row** (replaces the grey "N pending review items"
   band): one light row under the header, shown only when pending documents
   exist **other than the one open** (i.e. `count > 1`, or `count === 1` and
   it is not the open document). Text "{n} changed" / "{n} con cambios" +
   "Keep all" + "Restore all" as quiet text buttons; same handlers as today.

## Stage 4 — Settings panel (Figma H)

1. The footer row opens one panel anchored above it (and the app menu gets
   "Settings…", no accelerator, opening the same panel). Outside click and
   Escape close it (same model as today's menus).
2. **Tabs at the bottom** (segmented control: General · Typography ·
   Writing), content above; the tabs stay put when switching. Last tab is
   remembered (localStorage display preference).
3. Content is **exactly today's controls**, one-row style:
   - Typography: Font Serif/Sans/Mono, Size A− N px A+ (14–24), Reset.
   - General (Figma J): App language English / Español; Version "Iliad MD
     x.y.z"; Updates — the update check and status that live in the
     WorkspaceMenu today ("Up to date", checking, error, "Iliad MD x is ready"
     with Download / What's new). The app menu's "Check for Updates…" stays
     and opens nothing new (it keeps its current behavior).
   - **Update dot:** when an update is available, a small amber dot on the
     Settings footer row and on the General tab.
   - Writing: today's Writing assists panel unchanged (incl. recorded
     shortcut chips, Reset shortcuts, AI key row, Privacy).
4. Refactor: the three menus become panel bodies (`TypographySettings`,
   `GeneralSettings`, `WritingAssistsSettings`) inside a new
   `SettingsPanel`; App keeps one `settingsOpen` + `settingsTab` state
   instead of three `*Open` flags. `requestGroqKey` opens the panel on the
   Writing tab and focuses the key field, as today.

## Stage 5 — Review in the top row and rendered suggestions (Figma B, I)

1. **This document:** the review controls move from the band above the text
   to the right of the top row: "{n} changes · ↑ ↓ · Keep all · Restore all"
   (create/delete modes: their two buttons). Rendered by EditorPane through a
   portal into a top-row slot (EditorPane owns the review state and view).
   ↑ ↓ scroll to the previous/next unresolved hunk (labels already exist,
   never rendered). The save-state text stays in the same slot when there is
   no review. Conflict and detached-comments bars stay bands (rare), restyled
   light.
2. **Rendered added text:** `InsertedTextWidget` renders the added lines as
   Markdown instead of raw source, using the Markdown parser the editor
   already loads (`@lezer/markdown` via `@codemirror/lang-markdown`) and the
   visual-markdown classes (headings, blockquote, lists, bold/italic/code,
   links as text). Changed-word emphasis (`cm-ai-review-inserted-token`)
   survives where the token boundaries allow; if a changed range crosses
   Markdown syntax, emphasis is dropped for that line rather than breaking
   the render.
3. **One continuous block:** the green background and a 2px rail on the
   whole inserted block (full width, no gaps between lines), not per-glyph
   spans.
4. Removed lines stay as they are (struck-through source in the document).

## Stage 6 — Empty state G (recent documents)

1. **Recent documents** per workspace: new display-preference store
   (`src/preferences/recentDocuments.ts`, localStorage key
   `iliad:recent-documents`, map workspace root → up to 10 relative paths +
   last-opened ISO date), recorded when a Markdown document is opened.
   Never written into the workspace.
2. Empty state (no document open): serif line "Pick up where you left off" /
   "Retoma donde lo dejaste" (smaller, `--text-title`), then up to 5 recent
   documents that still exist in the tree: name (no `.md`), its folder in
   faint text, the day on the right (Today / Yesterday / weekday / short date,
   via `Intl`, app language). No fill at rest, soft fill on hover, one click
   opens it. Then "New document ⌘N" as a plain link. With no recents: the
   serif line "Pick a document to start" and the link only. ClipMark leaves
   the empty state (it stays on the launch screen and the error boundary).

## Review (Codex, xhigh, 2026-09-27)

Accepted:
- **Hunk navigation (↑ ↓)** has no state today (`activeHunkId` is always
  null). EditorPane owns a local active-hunk index keyed to the review
  snapshot, scrolls with `EditorView.scrollIntoView`, feeds the extension's
  active id, and disables the arrows for stale/empty reviews. Escape and Tab
  still never act on an outside review.
- **Portal lifecycle:** the top-row slot is a callback ref stored as App
  state and passed to EditorPane; the portal renders only once the element
  exists. Review ownership stays in EditorPane.
- **All-documents row:** one derived `showPendingReviewStrip` drives both the
  strip and the sidebar grid class (today an empty strip still reserves a
  grid row). Bulk handlers unchanged.
- **Peek** is a transient state separate from the pinned `sidebarOpen`: the
  peek sidebar is an overlay that doesn't change `.app-content` columns; one
  leave timer, cancelled while the pointer is on the toggle, edge zone or
  sidebar; Escape closes only the peek.
- **Settings panel:** closing it or switching away from Writing must cancel
  shortcut recording (and release menu-shortcut suppression), as closing the
  Writing menu does today. Non-modal dialog, focus returns to the opener,
  semantic tabs (`role=tablist`), a scrollable content region above the fixed
  bottom tabs so Writing fits at the 640px minimum window height.
  `requestGroqKey` keeps focusing the key field.
- **IPC stays narrow:** `window.isFullscreen()` + `window.onFullscreenChanged()`
  and one menu-event channel (toggle sidebar, open Settings), delivered to the
  window the menu click belongs to (Electron's focused window), not the
  "most recent" window. main, preload, `IliadApi` and the preload-surface test
  change together.
- **Tree a11y:** folder rows get `aria-expanded`; "New folder" from the
  context menu passes its target folder explicitly instead of relying on the
  selection update; the context menu measures or clamps its height after the
  new item.
- **overflow: clip** only on the outer layout wrappers (`.app-shell`,
  `.app-content`, `.editor-shell`, `.sidebar`); the named inner scroll owners
  (tree, editor surface, popovers, detached comments, display math) stay
  scrollable. Live-check CodeMirror and tree-search `scrollIntoView`.
- **Recents:** recorded only after a real document opens successfully
  (`readMarkdown` ok); exclude companion files and virtual create/delete
  review files; normalized relative paths; stale entries filtered against the
  tree; renames/moves update the entry.
- **Tooltip shortcut:** TooltipLayer renders a separate shortcut element;
  the button's accessible name stays the action label.

Rejected (with reason):
- **"Keep added text as raw source" (High).** Rendering suggested text is the
  owner's explicit decision (point 10, Figma I): writers judge the text, not
  the syntax. We keep the reviewer's safety concern with a narrower design:
  no new renderer — the widget parses the added lines with the Markdown
  parser the editor already loads and only **hides syntax marks and styles
  their spans** (the same thing visual Markdown does on inactive lines).
  The text itself is never rewritten, and changed-word emphasis is kept by
  splitting segments on both boundaries. If a changed range touches hidden
  syntax (a changed URL, marker or heading level), that line is shown as
  source, so no change can hide inside a syntax mark.

Deferred to `docs/backlog.md`: keyboard access to the tree context menu.

## Done when

- Every stage's behavior matches the Figma frames; EN and ES copy.
- `npm run typecheck`, `npm test`, `npm run build`, `npm run lint:css` pass;
  tests updated where markup changed (FileTree strip, writing assists menu,
  aiReview widget, tooltip, preload surface).
- Live check per stage in the Electron app (isolated `--user-data-dir`),
  screenshots compared with the Figma: windowed, sidebar hidden, peek, full
  screen, review with 1 and 3 documents, settings tabs, empty state with and
  without recents; the review bar never shifts; ⌃⌘S, ⌘N, ⌘W, ⌘O work.
- `docs/architecture.md` updated (chrome, sidebar, settings, review UI);
  deferred items in `docs/backlog.md`.
- No release (owner).

## Plan and state

One commit per stage on `premium-pass`. Order: 1 → 2 → 3 → 4 → 5 → 6
(2 and 3 share App/FileTree wiring; 5 depends on 2's top-row slot).
State is tracked in this file's "Progress" section below.

## Progress

- [x] Stage 1 — foundations (tokens, system font, `Icon` 16/1.5, overflow clip on `.app-shell`/`.app-content`/`.editor-shell` only — `.sidebar` stays visible so its menus aren't cut, light scrollbars)
- [x] Stage 2 — window chrome (52px top row, `trafficLightPosition {x:20,y:19}`, controls at 88px; View menu item is a fixed "Toggle Sidebar" ⌃⌘S — a Show/Hide label would need extra renderer→main state, tooltip does switch; breadcrumb includes the workspace name as in Figma C; peek via `useSidebarPeek`; fullscreen via `window:is-fullscreen` / `window:fullscreen-changed`; menu commands via `window:menu-command`; Aa/pen/language kept on the right until stage 4)
- [x] Stage 3 — sidebar (review row sits under the header, above search; `shouldShowPendingReviewStrip`; `createFolder(explicitDirectoryPath?)`; context menu clamps to its measured size; Settings footer props `onOpenSettings`/`settingsOpen`/`updateAvailable` wired in stage 4; Check for updates stays in the folder menu until stage 4)
- [x] Stage 4 — settings panel (`src/components/settings/`, `useSettingsPanel`; update check moved from the workspace menu to General; app menu "Settings…")
- [x] Stage 5 — review in the top row (`ReviewControls` portaled into the top-row slot; ↑ ↓ wrap, local active hunk, hidden when stale), rendered suggestions (`renderedInsert.ts`), removed rows full width and aligned with the added block (owner feedback), resize line hidden at rest so the sidebar edge is one hairline (owner feedback)
- [x] Stage 6 — empty state G (`EditorEmptyState`, `src/preferences/recentDocuments.ts`; recorded via `useFileActions` `onDocumentOpened`, relocated via `onPathRelocated`; stale entries skipped at render)

## Implementation review (Codex xhigh, 2026-09-27)

- High (fixed): file-level Keep all / Restore all — from the top row, the
  conflict banner and the tree's bulk row — now carry the revision the writer
  saw (baseline + disk hash); main refuses with `stale` if it changed, writes
  nothing and shows the refreshed review. Restore all requires the exact shown
  set. A stale Keep on a create/delete no longer clears the open buffer.
- Medium (fixed): the ↑ ↓ cursor key includes the reviewed content hash, so it
  resets when an outside revision arrives.
- Low (fixed): whitespace.

