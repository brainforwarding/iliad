# App Update Delivery

Date: 2026-06-16
Status: proposed
Scope: update discovery, update UI, release metadata, and future in-app update installation for the signed macOS app.

## Problem

Iliad currently publishes signed and notarized macOS artifacts through GitHub
Releases, but the installed app has no user-facing update flow. Existing users
must discover releases manually, download the new DMG, and replace the app
themselves.

The release pipeline also does not yet enforce auto-update metadata as a release
artifact. The current build output can produce `latest-mac.yml` and the packaged
app contains `Resources/app-update.yml`, but the checked local
`release/latest-mac.yml` is stale at `0.2.5` after the `0.2.6` release, and the
GitHub release only uploaded the DMG and ZIP. A true updater would fail or see
old metadata unless this is made a script-checked release invariant.

## Product Intent

Users should understand when a better Iliad build exists and have a low-friction
path to install it. Updates should feel calm and explicit, not like an
interrupting web app banner.

The app is a local-first writing tool, so the update flow must not create fear
around documents. Updates should make clear that the user's Markdown files stay
on disk and are not migrated by the app update.

## Current Architecture

- Packaging uses `electron-builder`.
- macOS targets are `dmg` and `zip`.
- The app is signed and notarized during release.
- `package.json` already has repository metadata for
  `brainforwarding/iliad`.
- Packaged app output contains `app-update.yml` with:

```yaml
owner: brainforwarding
repo: iliad
provider: github
updaterCacheDirName: iliad-updater
```

- Current runtime code does not import Electron's built-in `autoUpdater` or
  `electron-updater`.
- Current release docs upload only URL-safe `.dmg` and `.zip` copies.
- Release artifacts currently do not include `latest-mac.yml` or blockmaps on
  GitHub.

## External Constraints

Official Electron and electron-builder docs imply these constraints:

- macOS apps must be signed for automatic updates.
- electron-builder's higher-level updater path uses `electron-updater`.
- electron-builder update flow expects generated metadata such as
  `latest-mac.yml`.
- For macOS, the ZIP target is required for Squirrel.Mac update metadata.
- `electron-updater` can use GitHub Releases and provides download progress,
  staged rollout support, and provider handling.

References:

- https://www.electron.build/docs/features/auto-update/
- https://www.electronjs.org/docs/latest/tutorial/updates
- https://www.electronjs.org/docs/latest/api/auto-updater

## Options

### Option A: Manual Release Link Only

Add `Check for Updates` to the app menu or About surface. The app opens
`https://github.com/brainforwarding/iliad/releases/latest` in the browser.

Pros:

- Very small implementation.
- No updater dependency.
- No release metadata requirements beyond the existing GitHub release.
- Hard to break.

Cons:

- The app does not know whether an update exists.
- Users still need to download and install manually.
- It feels unfinished once there are real users.

Use only as a fallback action, not the main long-term update strategy.

### Option B: Lightweight Update Discovery + Manual Install

The app checks the latest public GitHub release metadata, compares it to
`app.getVersion()`, and shows a quiet in-app update state:

- `Iliad MD 0.2.7 is available`
- `View release`
- `Download DMG`
- `Remind me later`

The app does not download or install in-process. It opens the release page or
the DMG asset URL in the browser.

Pros:

- Gives users the important part: "there is an update."
- Can ship before true auto-install.
- Avoids the risk of broken update metadata bricking the updater path.
- Works with the current GitHub Releases model.
- No background replacement of the app while the user is writing.

Cons:

- Still requires manual installation.
- GitHub API rate limits or network failures need graceful handling.
- Needs asset selection logic for platform/arch.

This is the recommended first implementation.

### Option C: `electron-updater` With GitHub Releases

Add `electron-updater` as an app dependency. Main process owns update checks,
downloads, progress, and install-restart. Renderer receives only typed update
state through preload IPC.

Typical flow:

1. App starts.
2. Main process checks for updates after a short delay.
3. If an update exists, renderer shows a quiet update item.
4. User chooses `Download`.
5. Main process downloads the update.
6. Renderer shows progress.
7. User chooses `Restart to update`.
8. Main process calls updater install/restart.

Pros:

- Best installed-app experience.
- Can keep the user in Iliad.
- Can show download progress.
- Uses the existing GitHub Releases release surface.
- Future staged rollout support is available.

Cons:

- Requires automated checks for release metadata correctness.
- Release must upload `latest-mac.yml`, ZIP, DMG, and likely blockmaps with
  matching filenames and checksums.
- The app must handle updater errors without becoming noisy.
- Harder to test because update behavior needs an older installed build and a
  newer published release.

This is the recommended second phase, after Option B and after release metadata
is generated, verified by script, and uploaded correctly for at least one
release.

### Option D: Custom Static Manifest On `iliad.md`

Host an Iliad-owned JSON manifest on the website or S3, for example:

```json
{
  "version": "0.2.7",
  "releaseDate": "2026-06-20T00:00:00Z",
  "notesUrl": "https://iliad.md/learn/?doc=release-notes-v0.2.7",
  "downloadUrl": "https://github.com/brainforwarding/iliad/releases/download/v0.2.7/Iliad.MD-0.2.7-mac-arm64.dmg",
  "minimumOs": "13.0",
  "arch": "arm64",
  "sha256": "..."
}
```

The app checks this manifest and opens the download URL. True installation could
still use `electron-updater` later, but discovery becomes independent of GitHub
API shape.

Pros:

- Simple, fast, and controllable.
- Avoids GitHub API rate limits.
- Lets the site and app share release notes.
- Easy to support beta/stable channels later.

Cons:

- Another release artifact to publish correctly.
- Must be generated and verified by script so it cannot become a hand-maintained
  stale file.
- Does not install updates by itself.

This is a strong alternative to Option B if we prefer website-owned release
metadata.

## Recommendation

Use a two-phase plan.

### Phase 1: Update Discovery With Manual Install

Implement a quiet, explicit update check now:

- Add app menu item: `Check for Updates...`.
- Add update status in the About panel or workspace menu footer only when useful.
- Check either GitHub latest release metadata or an Iliad-owned static manifest.
- Compare semver against `app.getVersion()`.
- If no update exists, show `Iliad is up to date`.
- If update exists, show version, date, short notes, and a `Download` or
  `View Release` action.
- Do not auto-download.
- Do not show a startup modal.
- Do not block app startup or document editing if update check fails.

Best UI placement:

- Native menu item for manual checks:
  `Iliad MD -> Check for Updates...`
- A small update row in the workspace menu only when an update is available.
- No persistent banner across the editor by default.

Reasoning: this matches Iliad's calm writing surface and gives users a real path
to update without taking on the operational risk of in-app install immediately.

### Phase 2: In-App Download And Install

After one or two releases with correct update metadata, add
`electron-updater`.

Use manual-triggered download by default:

- automatic background check is allowed;
- automatic background download is not enabled initially;
- install requires explicit user action;
- downloaded update can also be applied on next app restart.

Reasoning: users may be mid-document. Downloading is probably fine, but quitting
to install must be explicit.

## UX Details

### States

`idle`

- No visible UI unless the user opens the menu.

`checking`

- Menu item changes to `Checking for Updates...` or a small spinner in a
  popover.

`upToDate`

- Short confirmation after a manual check: `Iliad MD 0.2.6 is up to date.`
- Do not keep a permanent "up to date" badge.

`available`

- Show:
  - new version number,
  - release date,
  - one short release-note sentence,
  - `View Release`,
  - `Download`.

`downloadProgress` (Phase 2)

- Show percent and size only if reliable.
- Keep it dismissible and non-modal.

`downloaded` (Phase 2)

- Show `Restart to Update`.
- Copy: `Your documents are files on disk. Iliad will reopen after updating.`

`error`

- Manual checks can show a short error:
  `Could not check for updates. Try again later.`
- Automatic checks should fail silently, with a debug log.

### Copy Principles

- Say `update`, not `upgrade`.
- Prefer `A new version is available` over urgency language.
- Never say documents are being migrated unless a future release actually has a
  migration.
- Avoid a central modal unless the user explicitly checked for updates.

## Architecture

### Phase 1 Components

Main process:

- `electron/updates/updateService.ts`
  - reads current version via `app.getVersion()`;
  - fetches release metadata;
  - validates shape;
  - chooses an artifact for `darwin/arm64`;
  - compares versions;
  - returns typed result.

- `electron/ipc/updates.ts`
  - `updates:check`;
  - `updates:open-release`;
  - `updates:download-latest` (opens external URL for Phase 1).

Preload:

- expose `window.iliad.updates.check()`;
- expose `window.iliad.updates.openRelease(url)`;
- expose `window.iliad.updates.download(url)`.

Renderer:

- `src/app/useUpdateStatus.ts`;
- small UI in workspace menu or an update popover;
- localized strings in `src/i18n/strings.ts`.

Data:

- Local preference:
  - `iliad:update:last-dismissed-version`, optional;
  - `iliad:update:last-check-at`, optional throttle metadata.

Network:

- Check on startup at most once per day.
- Manual menu action always checks.
- Time out network requests quickly, e.g. 5 seconds.

### Phase 2 Components

Dependency:

- Add `electron-updater` to `dependencies`, not `devDependencies`.

Main process:

- `electron/updates/electronUpdaterService.ts`
  - wraps `electron-updater`;
  - owns events;
  - never exposes raw updater objects to renderer;
  - disables behavior in dev unless an explicit test env var is set.

IPC:

- `updates:check`;
- `updates:download`;
- `updates:install`;
- `updates:get-status`;
- `updates:on-status` event stream.

Renderer:

- same UI can graduate from manual `Download DMG` to in-app `Download Update`
  and `Restart to Update`.

Security:

- Renderer cannot set feed URLs.
- Renderer cannot pass arbitrary download URLs to the updater install path.
- Main process accepts only update metadata from the configured provider.
- Logs must not include tokens. Public GitHub releases should not require a
  token.

## Release Pipeline Requirements

Before Phase 2 ships, the release path must make metadata correctness an
automated gate rather than a human checklist. Every release must do this:

1. Build signed macOS DMG and ZIP.
2. Notarize/staple app and DMG.
3. Ensure final ZIP is the one referenced by `latest-mac.yml`.
4. Regenerate `latest-mac.yml` after any post-processing or filename copy.
5. Copy artifacts to the exact filenames referenced by `latest-mac.yml`.
6. Run `npm run release:refresh-update-metadata` after DMG stapling.
7. Run `npm run release:verify-update-metadata`.
8. Upload to GitHub release:
   - DMG,
   - ZIP,
   - `latest-mac.yml`,
   - `.blockmap` files if differential downloads are expected.
9. Verify through the script that `latest-mac.yml`:
   - version matches package version;
   - `path` matches the uploaded ZIP asset name;
   - SHA512 matches uploaded ZIP;
   - release date is current.
10. Smoke test from an older installed build.

Important current mismatch: `release/latest-mac.yml` is stale at `0.2.5` after
publishing `0.2.6`, and it references filenames that are not the URL-safe names
uploaded in the GitHub release. This must be fixed before enabling
`electron-updater`.

## Testing Plan

Phase 1:

- Unit-test semver comparison.
- Unit-test GitHub/static manifest parsing.
- Unit-test artifact selection for macOS arm64.
- Unit-test stale/current/error states.
- IPC tests for update check and open/download actions.
- Renderer tests for update UI states.

Phase 2:

- Build `0.2.x`, install it, then publish `0.2.x+1` to a test release channel.
- Confirm update availability is detected.
- Confirm download progress is displayed.
- Confirm `Restart to Update` installs the new build.
- Confirm skipped/dismissed update does not nag.
- Confirm update checks do nothing in dev by default.
- Confirm failure modes:
  - no network,
  - missing `latest-mac.yml`,
  - wrong checksum,
  - unsigned/not-notarized artifact,
  - no matching arch asset.

## Rollout

1. Ship Phase 1 in the next patch release.
2. Add release metadata refresh/upload and `npm run release:verify-update-metadata`
   to the release runbook.
3. Publish one release with script-verified metadata but without in-app install
   enabled.
4. Test updating from that release to the next release using a private or draft
   test channel if possible.
5. Ship Phase 2 only after the metadata path has been exercised.

## Open Questions

- Should update discovery use GitHub latest release directly, or an
  Iliad-owned manifest on `iliad.md`?
- Should beta/dev channels exist before `1.0`, or should every public release be
  stable?
- Should update checks be daily by default, weekly by default, or manual-only
  until the product has more users?
- Should the app expose release notes inside Iliad, or always open the website?

## Decision To Make Before Implementation

For the next implementation pass, choose one:

- **Recommended:** Phase 1 using an Iliad-owned static manifest on `iliad.md`.
- **Acceptable:** Phase 1 using GitHub Releases API directly.
- **Not yet recommended:** Phase 2 `electron-updater` install flow immediately,
  until release metadata generation and upload are enforced by script in the
  build/release path.
