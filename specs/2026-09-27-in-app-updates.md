# In-app updates

Date: 2026-09-27. Status: spec, reviewed by Codex (xhigh) and revised; implementing. Target release: 0.6.0.

Sources: the owner's request in this conversation (ChatGPT desktop as the
reference: a small download button at the bottom left of the sidebar that
grows into "Update" on hover, then shows downloading, then the app quits and
reopens by itself; a one-time "what's new" card after the update); Figma
`i2BTwgceho8SqRYGZKjLhB`, page "In-app updates (2026-09-27)".

## Problem

Today (0.5.0) updating is manual and mostly invisible:

- Iliad never checks on its own. The only check is the app menu's "Check for
  Updates…" (`src/App.tsx` `checkForUpdatesFromMenu`), so most people never
  learn a new version exists.
- When a check finds one, "Download" opens the DMG in the browser. The writer
  mounts it, drags the app to Applications, confirms the replace, quits the old
  app and opens the new one.
- Every release already publishes what a real updater needs — the ZIP,
  `latest-mac.yml`, and `app-update.yml` inside the app (all verified by
  `scripts/verifyUpdateMetadata.mjs`) — but nothing uses them.

## Decisions

- **Updater:** `electron-updater` (electron-builder's own), GitHub provider,
  reading the `latest-mac.yml` we already publish. On macOS it installs through
  Squirrel.Mac, which requires the new app to keep the same bundle id
  (`md.iliad.app`), Team ID and designated requirement. No new server, no new
  release asset. Update channel: Apple Silicon (arm64), like every release.
- **Check automatically:** ~10 s after launch, then every 6 hours while Iliad
  is open, plus the existing menu item and "Check now". A failed automatic
  check is silent; the next one retries. At most one check per 6 hours per
  process unless the writer asks (GitHub's unauthenticated limit is 60/hour/IP).
- **Download in the background** as soon as an update is found, so clicking
  Update usually restarts at once. If the writer clicks before the download
  finished, the button shows its progress, then restarts.
- **Install:** clicking Update saves every window's work, then quits and
  reopens on the new version. If the writer never clicks, the update installs
  when they quit Iliad — through the same guarded flow (save first), never
  through `autoInstallOnAppQuit`, which is off.
- **Where it shows:** a small round button at the right end of the sidebar
  footer, on the Settings row's line (replaces the amber dot). Hover or
  keyboard focus grows it into a pill "Update" / "Actualizar". Settings →
  General shows the same state in words. The floating "Iliad X is available"
  toast is removed (it duplicated the footer).
- **After an update:** a one-time "What's new" card when the new version has
  one (bundled in the app, written per release; most patch releases have none).
  0.6.0's card announces updating itself.
- **Homebrew:** the cask gets `auto_updates true`, so `brew upgrade` leaves the
  app to update itself (the standard for self-updating casks). Brew users get
  the same in-app flow; no brew-specific UI.
- **Can't update itself** (running from the disk image, a translocated copy,
  or a folder Iliad can't write to): keep today's fallback — the button opens
  the DMG download — and Settings says "This copy can't update itself" in one
  line. `~/Applications` and any other writable folder work.

## Behavior

### States (main process owns them; every window mirrors them)

`idle` → `checking` → `current` | `available` → `downloading(percent)` →
`ready` → `installing`; plus `error` (manual checks only surface it) and
`unsupported` (can't self-update; carries the DMG URL, like today).

- `available`/`downloading`: the footer button shows (download arrow). The
  download runs in the background.
- `ready`: same button; clicking restarts right away.
- A newer release found while one is already `ready` replaces it (download
  again). Never downgrade; ignore pre-releases.

### The footer button (Figma frames 2–6)

- 22 px circle, accent fill (`--accent`), down-arrow glyph in
  `--ink-inverse`, at the right end of the footer line next to Settings.
  Visible only in `available`, `downloading`, `ready`, `installing`,
  `unsupported`.
- Hover / focus: the circle grows leftward into a pill labelled "Update"
  (~180 ms ease-out width, label fades in after ~60 ms). `prefers-reduced-motion`:
  no animation, the pill just appears.
- Click in `ready`: saves, then "Restarting…" and the app relaunches.
- Click in `available`/`downloading`: sets `installWhenReady`; the pill stays
  expanded as "Downloading 42%" with a light progress fill, then the restart
  flow runs when the download finishes. Further clicks do nothing.
- Click in `unsupported`: opens the DMG download (today's behaviour).
- `aria-label`: "Update Iliad to 0.6.1" / "Downloading update, 42%".
- When the sidebar is hidden the button isn't shown; Settings → General still
  has it, and the sidebar peek shows the footer as usual.

0.6.2 (Figma board `156:2`, option 2A): the footer now shows what Settings
says. `available`/`downloading` (not clicked): no fill, a 2px ring on the
circle's edge (track `--update-ring-track`, arc `--accent`, from 12 o'clock
clockwise, 240 ms ease-out) around an accent ↓; hover/focus opens the
"Downloading 42%" pill, and a click still sets `installWhenReady`. `ready`:
the solid circle with lucide RotateCw (10 px in the 12 px box); hover/focus
reads "Restart to update", the Settings string. Tooltips "Downloading Iliad
0.6.1…" / "Iliad 0.6.1 is ready. Restart to update" (aria-label matches for
ready). The solid ↓ circle ("↓ Update") remains only for `unsupported`. The
pill max-width is 15em, and the Settings label fades out (120 ms) while an
open pill would reach it (the Spanish ready pill at the default width).

### Restart safety

Before quitting for an update, main asks every window's renderer to prepare:

1. Flush pending saves (`useDocumentPersistence.flushSave`) and pending
   comment writes. If any save fails, cancel the restart and show the normal
   save error; the button returns to "Update".
2. If any window has an outside-change review pending (the baseline is
   session-scoped, so restarting ends that review), show a confirmation first
   (Figma frame 6): "Restart to update? Your agent's pending changes stay as
   they are on disk, without review." — Not now / Restart.
3. Only when every window answered OK: `autoUpdater.quitAndInstall(false,
   true)` (install silently, relaunch). The relaunched app opens the last
   workspace, as on any launch. Other windows and their open documents are not
   restored (same as quitting today); not promised.

Timeout: a window that doesn't answer within 10 s cancels the restart (never
quit with an unknown save state).

**Normal Quit with an update ready** (⌘Q, menu, last window on non-mac is
n/a): main intercepts `before-quit` once (`preventDefault`), runs step 1 only
(a normal quit already ends reviews, so no confirmation), then
`quitAndInstall(true, false)` (install, don't relaunch). If a save fails, the
quit is cancelled and the save error shows, as it should. Renderers are never
asked anything during `before-quit-for-update`.

### Settings → General "Updates" row (Figma frame 7)

- current: "Up to date" + Check now.
- available/downloading: "Downloading 0.6.1… 42%".
- ready: "Iliad 0.6.1 is ready" + "Restart to update" + "What's new" (release
  page).
- unsupported: "Iliad 0.6.1 is available" / "This copy can't update itself."
  + Download.
- error (manual check): "Couldn't check for updates." + Check now.

### What's new card (Figma frame 8)

- Shown once, on the first launch of a version that has an entry in
  `src/whatsNew/` (per-version title, one line, optional illustration, EN/ES),
  and only for someone who used Iliad before: a stored last-seen version
  older than this one, or — for 0.6.0, since 0.5.0 stored none — an existing
  last-workspace preference. A fresh install sees nothing. The last seen
  version is a local preference (localStorage), never written to documents.
- Centred card over a dimmed window; "Got it" closes it; "Release notes" opens
  the GitHub release. Esc closes. Only in the first window that opens.
- 0.6.0 entry: "Iliad updates itself now" — "When a new version is ready,
  click Update at the bottom of the sidebar. Iliad saves your work and
  reopens." (ES: "Iliad ahora se actualiza solo" …).
- People updating from 0.5.0 to 0.6.0 do it by hand (0.5.0 has no updater);
  they see the card because they have a last-workspace preference.

## Implementation outline

- **Main** `electron/updates/`: replace the notify-only service with an
  `AppUpdater` wrapper around `electron-updater`'s `autoUpdater`
  (`autoDownload = true`, `autoInstallOnAppQuit = false`,
  `allowPrerelease = false`, `allowDowngrade = false`), a state machine, the
  schedule, and `canSelfUpdate()` (packaged, macOS, not under
  `/AppTranslocation/` after resolving the real bundle path, not on a
  read-only volume, bundle's parent directory writable; quarantine alone is
  not a reason; reuse the checks in `bin/lib/install.mjs` where they fit).
  Keep `selectMacDmgAsset`/GitHub-API code only for the `unsupported`
  fallback. The updater's `logger` goes to `console` (no `electron-log`); no
  new dependency beyond `electron-updater`.
- **IPC** (`electron/ipc/updates.ts`, `electron/preload.ts`,
  `src/types/iliad.ts` together): `updates:get-state`, `updates:check`,
  `updates:install` (starts the restart flow), push `updates:state` to all
  windows, and `updates:prepare-restart` request → renderer answers
  `{ok, reason}`.
- **Renderer:** `src/app/useAppUpdate.ts` (state subscription, install,
  prepare-restart handler that flushes saves and asks for confirmation when a
  review is pending); `src/components/UpdateButton.tsx` in the sidebar footer;
  General settings row; `src/components/WhatsNewCard.tsx` + `src/whatsNew/`;
  remove the update toasts; i18n EN/ES in `src/i18n/`.
- **Styles:** `src/styles/sidebar.css` (button + growth animation),
  a new responsibility file for the card if needed; tokens only.
- **Packaging:** `electron-updater` in `dependencies`. `release-mac.sh` and
  `verifyUpdateMetadata.mjs` already publish/verify the ZIP and yml — verify
  the ZIP is what Squirrel installs (it must contain the stapled app).
  Homebrew cask: `auto_updates true` (`packaging/homebrew/iliad-md.rb` and
  `scripts/updateHomebrewCask.mjs`): it tells Homebrew the app updates itself,
  so plain `brew upgrade` skips it (`--greedy` still upgrades). Keep the
  release script's order: staple the .app, repackage the ZIP from it
  (`--prepackaged`), then hash that final ZIP into `latest-mac.yml`.
- **Docs:** `docs/architecture.md` (replace the "notify-only" paragraph),
  `docs/release.md` (the ZIP and yml now drive live updates: never publish a
  release whose ZIP isn't the notarized, stapled app), ADR in
  `docs/decisions.md`, backlog: remove "Brew-aware update notice".

## Validation

- Unit: state machine transitions, schedule, `canSelfUpdate`, prepare-restart
  (save failure cancels; pending review asks; timeout cancels), What's new
  once-only logic, i18n keys.
- **End-to-end on this Mac, before release:** build a signed QA app `0.6.0`
  whose `app-update.yml` points at a local generic feed, install it in a
  writable scratch folder, serve a signed `0.6.1-qa` ZIP + `latest-mac.yml`
  from `localhost`, and confirm: the button appears, hover grows it, click
  downloads/restarts, the relaunched app is 0.6.1-qa, an unsaved edit made
  just before clicking is on disk, and the pending-review confirmation
  appears. QA builds are never published.
- After releasing 0.6.0: install 0.5.0 → update by hand → 0.6.0 shows the
  What's new card. The first real self-update is verified at 0.6.1 (a later
  small release), recorded in the backlog.
- QA conditions (from review): the source QA app gets its generic
  `app-update.yml` before signing (never edited after); the target ZIP is made
  from the signed target app and `latest-mac.yml` hashes that final ZIP; the
  local server stays up through download and install; the source runs from a
  writable, non-translocated folder; both builds share bundle id, Team ID and
  designated requirement. After the relaunch, `iliad status` answers.

## Out of scope

- Windows/Linux updates (Iliad ships macOS only).
- Delta/blockmap downloads (full ZIP, ~160 MB, is fine for now).
- Release channels / betas.
- A setting to turn automatic updates off (add only if someone asks; the
  update never installs without either a click or a quit).

## Review (Codex xhigh, 2026-09-27) — how it was folded in

- Taken: no `autoInstallOnAppQuit`; normal Quit with an update ready runs the
  guarded save flow; no promise to restore every window/document (last
  workspace only); What's new detection via the existing last-workspace
  preference; precise Squirrel.Mac invariants; `canSelfUpdate` on the resolved
  bundle path with writable-parent test and neutral fallback copy; arm64
  stated; `installWhenReady` resolves the click-while-downloading conflict;
  Homebrew wording; 6-hour check cooldown; QA conditions and a CLI check after
  relaunch.
- Rejected: nothing material. Not adding a restart snapshot of all windows
  (few users use several windows; revisit on request).

## Figma deviations accepted (board `115:3`)

- The pill keeps the ↓ arrow ("↓ Update"); downloading/restarting are text.
- Confirm popover: title "Restart to update?", line "Unreviewed changes from
  your agent will be kept as they are." (ES: "¿Reiniciar para actualizar?" /
  "Los cambios de tu agente sin revisar quedarán tal como están.").
- The amber dot goes away everywhere (the footer button replaces it).
- Unsupported copies still show the footer button (it opens the download);
  the Figma note assuming the old dot there is superseded by this spec.

