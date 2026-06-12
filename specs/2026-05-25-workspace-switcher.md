# Workspace switcher (change the open folder)

Date: 2026-05-25
Status: implemented (Codex-reviewed) — typecheck + 191 tests + build green

> Review folded in (supersedes details below):
> - **Drop the new `workspace:open-path` IPC.** `workspace:read-directory`
>   already canonicalizes, returns the canonical `WorkspaceInfo` + tree, handles
>   missing paths, and is request-tagged. Recent-open = `readDirectory(path)`;
>   on `ok` commit `result.workspace`/`result.tree`, on `missing` toast + prune.
>   This also dissolves the trust-model concern (no renderer-controlled path
>   reaches a new privileged IPC).
> - **Flush before any state-mutating IPC** (dialog mutates main workspace before
>   returning) — keep `flushSave()` first; validate recents (read) before
>   clearing current, so a stale recent never blows away the open folder.
> - **MRU lives in `useWorkspace`**, pushed from `refreshTree` on `status:"ok"`
>   using the canonical `result.workspace` (covers launch/dialog/recent uniformly);
>   pruned on `missing`. Dedup by canonical path, cap ~6.
> - **Expand the reset**: also clear `renamingPath`, tree context menu, `notice`,
>   `languageOpen`, `typographyOpen` (factored into `resetForWorkspaceSwitch`).
>   Mid-agent-run cancellation is a known limitation (same as today's dialog
>   switch) — documented, not solved here.
> - **Guard `⌘O`**: ignore while initializing or a switch is in flight, ignore
>   repeats/composing/`defaultPrevented`, call `preventDefault()`.
> - **No generic `.popover`** — add a dedicated `.workspace-popover` mirroring the
>   typography/language popovers.

## Problem

`openWorkspace()` (`App.tsx`) already flushes saves, opens the native folder
picker, and swaps the workspace — but it's only wired to the launch screen.
Once a folder is open there's **no in-app way to switch**. Add the entry point
(approved UX): the sidebar workspace **name becomes a switcher** → popover with
the current path, "Open folder…", `⌘O`, and Recent folders.

## UX (approved)

```
 courses ⌄        [＋] [📁＋]
 ╭───────────────────────────╮
 │ ~/dev/iliad/courses        │  current path (muted; click = Reveal in Finder)
 │ ───────────────────────────│
 │ 📂  Open folder…       ⌘O  │  native picker → switches THIS window
 │ ───────────────────────────│
 │ RECENT                     │
 │   notes        ~/notes     │
 │   udd-specs    ~/dev/udd    │
 ╰───────────────────────────╯
```

## Implementation

### Renderer
- New `src/components/WorkspaceMenu.tsx` (mirror `TypographyMenu`/`LanguageMenu`:
  trigger button + absolutely-positioned popover, outside-click + Esc to close,
  reuse `.popover` styling). Trigger = `workspace.name` + a small chevron.
- `FileTree` renders `WorkspaceMenu` in place of the plain `.workspace-name`
  span; new props: `recentWorkspaces`, `onOpenFolder`, `onOpenRecent`,
  `onRevealWorkspace`.
- `App.tsx`:
  - Factor the existing reset logic in `openWorkspace` into
    `switchToWorkspace(info)` (flush, reset tree/active/selection/proposals/
    document) used by **both** the dialog path and recent-folder path.
  - `openWorkspace()` → dialog → `switchToWorkspace`.
  - `openWorkspaceByPath(path)` → `window.iliad.openWorkspaceByPath(path)` →
    `switchToWorkspace` (or toast + prune from MRU on failure).
  - Global `keydown`: `⌘/Ctrl+O` → `openWorkspace()` (ignore while a native
    dialog/initializing).
- **Recent (MRU)** in `localStorage` (`iliad:recent-workspaces`): array of
  `{ path, name }`, most-recent-first, deduped by path, capped (~6). Updated on
  every successful open (launch, dialog, path). The switcher lists recents
  excluding the current workspace.

### Main / IPC (new `workspace:open-path`)
- `electron/ipc/workspace.ts`: `ipcMain.handle("workspace:open-path", (event, p)
  → canonicalizeWorkspaceDirectory(p) → rememberWorkspace + setWindowWorkspace →
  WorkspaceInfo)`. Return `null` (or a "missing" signal) if the path no longer
  exists / isn't a directory (mirror `read-directory`'s `isMissingPathError`).
- `electron/preload.ts`: `openWorkspaceByPath(path) =>
  invoke("workspace:open-path", path)`.
- `src/types/iliad.ts`: add to `IliadApi`.
- Trust model: same as the dialog — `canonicalize` validates a real directory,
  `rememberWorkspace` allow-lists it for `iliad-file://`/fs reads. Paths come
  only from the user's own previously-opened folders (localStorage), but still
  validated server-side.

### i18n
- `sidebar.openFolder` ("Open folder…" / "Abrir carpeta…"),
  `sidebar.recent` ("Recent" / "Recientes"),
  `sidebar.switchWorkspace` (aria, "Change folder" / "Cambiar carpeta").
- Error: `workspaceMessages.recentMissing` ("That folder is no longer
  available." / "Esa carpeta ya no está disponible.").

## Edge cases / risks
- Recent folder deleted/moved → open fails → toast + remove from MRU.
- Dirty document → `switchToWorkspace` must flush first (reuse existing).
- Don't switch mid-agent-run without resetting proposals (existing reset covers).
- Popover must not shift the sidebar header layout; chevron is inline with the
  name. Keyboard: trigger is a real `<button>` with `aria-expanded`; focus ring.
- `⌘O` must not fire while typing in the editor/composer if it would steal a
  browser/OS binding — scope to when no native dialog is open; it's a global app
  shortcut so that's acceptable.

## Out of scope
- "Open in new window" (the app supports multiple windows via CLI; defer).
- Drag-a-folder-onto-window to open.

## Tests / checks
- Unit: MRU helper (add/dedup/cap/most-recent-first; prune-missing).
- `npm run typecheck`, `npm test`, `npm run build`.
- Manual: switch via Open folder…, via a recent, via `⌘O`; dirty-doc flush;
  deleted recent → toast + pruned; current folder excluded from recents; popover
  Esc/outside-click; focus ring.
