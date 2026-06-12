# CLI Open Workspace Windows

Date: 2026-05-22
Status: reviewed; ready for implementation

## Product Intent

Typing `iliad .` in a terminal should open Iliad directly on that folder. This is a desktop workflow feature: it should feel like `code .` or `typora .`, while preserving Iliad's local-first workspace model and save safety.

If Iliad is already running, opening a different folder from the terminal should create a second Iliad window. Opening a folder that is already open should focus the existing window instead of creating a duplicate editor for the same workspace.

## Problem

Iliad currently opens either the last persisted workspace or the launch screen. A terminal user cannot run `iliad .` to open the current folder. The Electron main process also has a single `mainWindow` variable, so it cannot represent multiple workspaces in multiple windows.

The app needs a small launch/workspace window manager before adding more desktop integration features.

## Goals

- Support `iliad <folder>` from a terminal when the package CLI is linked or installed.
- Resolve relative paths against the invoking terminal's current working directory.
- On first launch, open a window with the requested folder as its workspace.
- On later launches while Iliad is already running:
  - focus the existing window if that workspace folder is already open
  - otherwise open a new window for the requested folder
- Keep existing no-argument startup behavior: load the last persisted workspace or show the launch screen.
- Keep the renderer save model intact. Opening another window must not close or replace the current window.
- Keep workspace path safety in Electron main. CLI paths must be resolved and validated as directories before they are handed to the renderer.
- Document how to use the local CLI during development.

## Non-Goals

- No file-opening behavior yet, such as `iliad README.md`.
- No automatic Markdown file creation from missing CLI paths.
- No packaged installer, shell integration, or OS file association work in this pass.
- No changes to Markdown source files or the source-as-contract rules.
- No multi-workspace sidebar inside a single window.
- No cross-window shared editor state.

## User Flow

### First Instance

1. User runs `iliad .` from `/Users/me/project`.
2. CLI launches the Electron app with `/Users/me/project` as an argument.
3. Electron main resolves the argument to an absolute path and verifies it is a directory.
4. Main creates a BrowserWindow with launch workspace metadata.
5. Renderer asks preload for the launch workspace during initial workspace setup.
6. Renderer opens that workspace instead of the last persisted workspace.

### Second Instance, Different Folder

1. Iliad is already running with `/Users/me/project-a`.
2. User runs `iliad ../project-b`.
3. Electron's `second-instance` handler receives the new argument and working directory.
4. Main resolves and validates `/Users/me/project-b`.
5. Main creates a new BrowserWindow with that launch workspace.
6. The first window remains open.

### Second Instance, Same Folder

1. Iliad already has a window for `/Users/me/project-a`.
2. User runs `iliad /Users/me/project-a`.
3. Main resolves the path and finds an existing window registered for the same normalized workspace path.
4. Main restores/focuses that window.
5. No duplicate workspace window is opened.

### Invalid Folder

If the CLI path does not exist or is not a directory:

- main should not create a new workspace window for that path
- if no windows exist, it should open the normal launch screen on first launch
- if at least one window exists, it should focus the most recently active window instead of opening a blank duplicate
- the failure should be logged in the main process for development visibility

## Architecture Decisions

### CLI Entry

Add a package `bin` entry:

```json
"bin": {
  "iliad": "./bin/iliad.mjs"
}
```

The local CLI script should:

- resolve the project root
- locate the local Electron binary
- spawn Electron with the app root and user-provided args while preserving the terminal invocation cwd
- detach from the terminal so `iliad .` returns promptly
- print a clear error if local dependencies are missing

For local development, the expected setup is:

```bash
npm install
npm run build
npm link
iliad .
```

### Argument Parsing

Electron main should own launch argument parsing, not the renderer.

Rules:

- accept one workspace path argument; if multiple are supplied, the first supported path wins
- ignore the Electron app path argument used by source/dev and linked CLI launches
- resolve relative paths against the relevant working directory
- support spaces in paths
- ignore unsupported options for now, except `--` which ends option parsing
- validate that the resolved path exists and is a directory

The parser must be pure enough to cover with lightweight scripted checks. Expected shapes:

| Invocation shape | Main-process argv / cwd behavior | Expected parsed workspace |
| --- | --- | --- |
| `iliad .` from `/repo` | CLI passes app root plus `.`; Electron `second-instance` provides terminal cwd | `/repo` |
| `iliad ../notes` from `/repo/app` | relative path resolved against invocation cwd | `/repo/notes` |
| `iliad "/tmp/folder with spaces"` | quoted shell arg arrives as one argv element | `/tmp/folder with spaces` |
| `iliad -- --starts-with-dash` | `--` ends option parsing | `<cwd>/--starts-with-dash` |
| `iliad --verbose .` | unsupported option ignored | `<cwd>` |
| `iliad a b` | first path wins | `<cwd>/a` |
| `electron .` in dev | app root is ignored | no workspace |

Second-instance parsing must use Electron's `workingDirectory` argument, not the first instance process cwd.

### Canonical Workspace Identity

Window de-duplication must compare canonical directory identity:

- resolve the candidate path against the invocation cwd
- require it to exist and be a directory
- use `fs.realpath` after validation for the canonical key so symlinks, `..`, and trailing slashes collapse to one identity
- compare canonical keys case-insensitively on platforms where Node's `realpath` returns case-insensitive filesystem paths in practice; no extra cross-platform case folding is required in this pass
- return the canonical path in `WorkspaceInfo.path` so renderer persistence, asset loading, and duplicate detection all use the same identity

The UI may later add a separate display path if preserving the user's typed spelling matters; this pass intentionally keeps one path.

### Single Instance And Window Management

Use Electron's single-instance lock:

- first instance owns app lifecycle
- second invocations are routed to `app.on("second-instance", ...)`
- second invocations never replace an existing window
- lock acquisition happens before `app.whenReady()`
- if the lock cannot be acquired, the process quits immediately
- if a second-instance request arrives before the app is ready, queue it and process it after IPC/protocol/window manager setup
- a no-argument second invocation focuses the most recently active window, or opens the normal launch screen if no windows exist
- minimized windows are restored before focus

Replace the single `mainWindow` model with a small window manager:

- `createIliadWindow({ launchWorkspace })`
- track windows by `webContents.id`
- track normalized workspace path for windows that have one
- key launch workspace metadata by `webContents.id`
- `getLaunchWorkspace()` resolves from `event.sender.id`
- focus an existing window for duplicate workspace requests
- unregister windows on close
- maintain the existing macOS activate behavior by opening/focusing a normal window when no windows exist

Windows can gain workspace association in two ways:

- launch workspace passed at window creation
- renderer later reads a workspace via `workspace:read-directory` or chooses one via `workspace:open-dialog`

Launch workspace metadata should survive renderer reloads for the life of the window. It is cleared only when the window closes or when the window associates with a different workspace through IPC.

### Renderer Launch Workspace

Expose a preload API such as:

```ts
getLaunchWorkspace: () => Promise<WorkspaceInfo | null>
```

`src/app/useWorkspace.ts` should read launch workspace first, then fall back to the persisted workspace. Launch workspace should use the same `setWorkspace` path as dialog-opened workspaces so persistence and tree refresh behavior stay consistent.

The renderer must use an explicit initialization gate:

- do not synchronously load persisted workspace before `getLaunchWorkspace()` resolves
- after bootstrap, choose launch workspace first, then persisted workspace, then `null`
- guard async tree refreshes so stale reads from a previous workspace cannot overwrite the current tree
- failed launch workspace reads should surface through the existing error channel and fall back only when the main process returns `null`, not when a requested directory was valid

### Existing Workspace Dialog

Opening a workspace through the UI remains available. It should continue to update the current window's workspace association in Electron main so later `iliad <same-folder>` can focus that window.

Workspace IPC ownership must be per sender:

- `workspace:open-dialog` parents dialogs to `BrowserWindow.fromWebContents(event.sender)`, falling back to the active window only when necessary
- `workspace:read-directory` validates and successfully reads the directory before updating the window-to-workspace association
- neither handler should depend on a global `mainWindow`

## Data, Permissions, And Security

- No data model changes.
- No Markdown file changes.
- No new renderer filesystem access.
- CLI workspace validation happens in Electron main.
- Workspace roots are still remembered through `workspaceRegistry` for `iliad-file://` asset serving.
- Hidden paths are still hidden from the file tree; passing a hidden parent directory as the workspace root is not explicitly rejected in this pass, matching current open-dialog behavior.

## Required Tests And Verification

Automated:

- `npm run typecheck`
- `npm run build`

Manual or scripted local checks:

- `npm link` exposes an `iliad` command.
- `iliad .` opens the current folder as the workspace.
- Running `iliad <different-folder>` while the app is open creates a second window.
- Running `iliad <same-folder>` while that workspace is open focuses the existing window.
- Running Iliad without a folder still opens the last workspace or launch screen.
- Existing UI workspace open flow still works.
- Parser/scripted checks cover relative paths, absolute paths, paths with spaces, `--`, unsupported options, multiple paths, and dev `electron .`.
- Duplicate detection treats a symlinked folder and its real path as the same workspace.
- Startup with persisted workspace A plus `iliad <workspace-b>` opens workspace B, not A.
- Opening a workspace from a second window updates that window's association, not another window's association.
- Invalid paths are handled without opening extra blank windows when another window is already present.
- Rapid second launch during startup is queued and handled after readiness.
- Focusing an already-open minimized window restores it before focus.

Release workflow:

- Push to `origin/master` after verification.
- No GitHub Actions workflows are present, so there are no CI jobs to inspect unless new remote checks appear.

## Risks And Mitigations

- **Argument parsing accidentally treats `electron .` app path as a workspace.**
  - Mitigation: explicitly ignore the app root path when parsing argv.
- **Two windows edit the same workspace.**
  - Mitigation: normalize resolved workspace paths and focus existing windows for duplicates.
- **Launch workspace races persisted workspace.**
  - Mitigation: renderer workspace initialization should resolve launch workspace before falling back to localStorage.
- **Window map gets stale.**
  - Mitigation: unregister on `closed` and update association on workspace IPC reads/dialog results.
- **CLI works only after build in local dev.**
  - Mitigation: document `npm run build` before `npm link`; keep packaged-app support as future work.

## Acceptance Criteria

- `iliad .` is available after `npm link` and opens that folder.
- First instance and second-instance launches both support folder args.
- Same-folder launches focus existing windows.
- Different-folder launches create new windows.
- No-argument launches behave as before.
- Existing preload API remains compatible except for an additive `getLaunchWorkspace`.
- `npm run typecheck` and `npm run build` pass.
- README/CLAUDE or architecture docs explain local CLI usage and feature placement.

## Open Questions

- Should a future pass support `iliad file.md` by opening that file's parent workspace and active document?
- Should packaged app installation ship an official shell command or only a developer `npm link` command for now?
