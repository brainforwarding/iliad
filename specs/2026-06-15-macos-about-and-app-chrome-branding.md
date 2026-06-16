# macOS About And App Chrome Branding

Date: 2026-06-15
Status: reviewed and revised; ready for implementation
Scope: macOS About/version placement, empty topbar branding, and workspace picker cleanup.

## Problem

Iliad currently exposes product/build identity in places that do not match the
user's task:

- The topbar shows `Iliad MD` when no document is open. This makes the center of
  the app chrome read like a title, even though the topbar is otherwise used for
  document navigation and document actions.
- The workspace picker footer shows `Iliad 0.2.5 - <hash> - <date>`. The
  workspace picker is a folder-switching menu, so build metadata feels
  unrelated and makes the menu heavier.
- The existing native macOS application menu already has an About entry, but it
  is not being used as the primary home for version/build identity.

The result is a subtle information-architecture mismatch: workspace controls,
document chrome, and app identity are mixed together.

## Decision

Move app identity to the native macOS About surface, and keep Iliad's in-app
chrome focused on workspace and document context. Package version must be shown
in About. Commit hash and build date may be shown only if the implementation
adds a shared build-identity source that Electron main can read.

The in-app result should be:

- no centered `Iliad MD` label in the topbar when no document is open,
- no version/build footer in the workspace picker,
- workspace picker content limited to current workspace, open-folder action, and
  recent workspaces,
- agent settings remain inside the right-side agent panel,
- no new generic in-app Settings screen.

## Goals

- Make the empty-document topbar quiet. When no document is open, the document
  title/tab area should not show the app name.
- Keep document tabs unchanged when a document is open.
- Remove the build/version footer from `WorkspaceMenu`.
- Add or configure the native macOS About panel so users can find the package
  version through the application menu.
- Preserve the existing native macOS menu roles for Services, Hide, Quit, Edit,
  View, and Window.
- Keep the workspace picker focused on folder switching.
- Keep this as a small UI cleanup with no app settings expansion.

## Non-Goals

- No new in-app Settings panel.
- No new in-app About modal.
- No changes to agent settings, model selection, API keys, or Telegram remote
  settings.
- No changes to editor typography, language, writing-assist controls, focus
  mode, or file-tree behavior.
- No package/release rebrand from `Iliad MD` to `Iliad` in this pass. Changing
  `productName`, release artifact names, Dock/menu identity, or app data
  location should be specified separately because it can affect packaging and
  persisted local state.
- No Windows/Linux application menu work in this pass. Non-macOS builds may keep
  the current hidden/null application menu behavior.

## UX Behavior

### Empty Topbar

Current empty state:

```text
topbar center: Iliad MD
main surface:  Pick a file to start
```

Target empty state:

```text
topbar center: empty/reserved document area
main surface:  Pick a file to start
```

The topbar should keep its layout stable. Removing the label must not cause the
right-side action group or left-side navigation controls to jump.

### Open Document Topbar

When a document is open, behavior stays as-is:

```text
topbar center: README  x
main surface:  document content
```

### Workspace Picker

Current:

```text
my-docs v
------------------------
.../iliad-site/my-docs
Open folder...        Cmd+O
------------------------
RECENT
courses
docs
------------------------
Iliad 0.2.5 - 00b2e95 - 2026-06-15
```

Target:

```text
my-docs v
------------------------
.../iliad-site/my-docs
Open folder...        Cmd+O
------------------------
RECENT
courses
docs
```

If there are no recents, the picker should simply end after the open-folder
action. Do not add a replacement footer.

### macOS About

The macOS application menu is the correct home for build identity:

```text
Iliad MD
  About Iliad MD
  Services
  Hide Iliad MD
  Quit Iliad MD
```

The About panel should show at least:

- app name from the current macOS app identity,
- package version, e.g. `0.2.5`.

If a shared Electron-readable build metadata source is added, the About panel
may also show:

- build hash, e.g. `00b2e95`,
- build date, e.g. `2026-06-15`.

Exact About panel formatting should use Electron's native About APIs. Prefer
`app.setAboutPanelOptions()` and the native `role: "about"` menu item over a
custom renderer UI. Package version should use a native version field. Optional
hash/date may use native fields such as `version`, `copyright`, or `credits`
only if they render cleanly on macOS; do not force old workspace-footer
formatting into a custom in-app modal.

In development, the current app menu label is `Iliad MD Dev`; in packaged builds
it is `Iliad MD`. This spec does not change that split.

## Implementation Notes

### Renderer

- In `src/App.tsx`, remove the fallback render of `.topbar-brand` when
  `activeFile` is absent.
- Keep the surrounding topbar grid/flex structure stable. The current topbar CSS
  uses a three-column layout, so implementation should either render an empty
  middle slot when no document is open or adjust the grid deliberately. Removing
  the fallback node must not move the right action group into the document-tab
  column.
- In `src/components/WorkspaceMenu.tsx`, remove:
  - `appBuildLabel`,
  - the `__APP_VERSION__`, `__APP_BUILD_HASH__`, and `__APP_BUILD_DATE__` usage
    in this component,
  - the final divider and `.workspace-version` footer.
- Remove unused `workspace-version` CSS if no other component uses it.
- Update the Vite build-identity comment so it no longer says the workspace menu
  shows version/build metadata.
- If `__APP_VERSION__`, `__APP_BUILD_HASH__`, or `__APP_BUILD_DATE__` become
  unused after removing the workspace footer, either delete those Vite defines
  and `src/vite-env.d.ts` declarations or replace them with the shared
  build-identity source described below.

### Electron Main

- Keep `installApplicationMenu()` as the owner of the macOS menu.
- Configure the native About panel from Electron main, preferably near
  `installApplicationMenu()` so the ownership is clear.
- `app.getVersion()` supplies the required package version.
- Do not read renderer-only Vite globals from Electron main. They are not
  available in the main process.
- If hash/date remain desirable, add one explicit shared source for build
  identity, such as `electron/buildIdentity.ts` or a generated JSON file
  included in both dev and packaged builds. That source may read environment
  variables or generated build constants, but it must degrade cleanly when git
  metadata is unavailable.
- If hash/date are unavailable in a packaged app, the About panel should still
  show a valid package version and omit missing fields rather than showing
  placeholders.
- Preserve the current non-darwin behavior: `Menu.setApplicationMenu(null)`.

## Risks

- Native macOS About customization is constrained by Electron and the operating
  system. Commit/date may not render exactly like the old workspace footer
  without using awkward fields; version alone is acceptable for this pass.
- The product-name split is intentional but temporary-looking: in-app empty
  chrome removes `Iliad MD`, while Dock/menu/About keep `Iliad MD` or
  `Iliad MD Dev`. Broader naming cleanup should be handled in a separate
  packaging-aware spec.
- If the renderer build globals are removed, tests or type declarations that
  mention them need to be cleaned up in the same implementation change.

## Data And State

- No workspace file changes.
- No localStorage changes.
- No migration of saved settings or credentials.
- No change to recent-workspace storage.
- No change to Electron `userData` path.

## Accessibility

- Removing `Iliad MD` from the empty topbar should not remove any actionable
  control or landmark.
- The workspace picker continues to expose menu items with their current roles
  and labels.
- The native About menu item remains reachable through standard macOS keyboard
  and menu navigation.

## Verification

- Run typecheck/build after implementation.
- On macOS, launch the Electron app and verify:
  - the empty topbar no longer shows `Iliad MD`,
  - an open document still shows its document tab,
  - the workspace picker no longer shows version/build metadata,
  - the native About menu opens and contains the package version,
  - dev builds label the app menu as `Iliad MD Dev` and packaged builds label it
    as `Iliad MD`,
  - non-document topbar actions remain aligned and usable.
- Spot-check the no-recents workspace picker state.

## Review Notes

- It is acceptable for the native app menu label to remain the current app
  identity, `Iliad MD`, while the in-app chrome removes `MD`. This spec keeps
  broader product-name changes out of scope to avoid app identity and local-data
  side effects.
- Package version is sufficient for implementation. Commit/date are optional and
  require a shared main-process-readable build identity source.
