# Agent-Installable Iliad: `iliad install`, a Stable DMG URL, and a Homebrew Cask

Date: 2026-09-25
Status: v1 — draft for Codex review
Branch: `agent-installable-iliad` (from `master` at `438af42`, Iliad MD 0.3.2)
Target release: the next patch release after 0.3.2

## Reviewer brief

Review the plan for: incorrect assumptions about the existing CLI, launcher and
packaged layout; safety of writing into shared `bin` folders (never clobber a
foreign `iliad`, never leave a link to a disk image); exit-code and `--json`
contracts an agent can rely on; whether the Electron-main and `bin/` code can
really share one implementation; release-process changes that could break
`release:verify-update-metadata` or the updater; and Homebrew cask correctness
(stanzas, token, `binary` target, `zap`, `auto_updates`); interaction with
the in-app update check (the extra DMG must never confuse it; CLI links must
survive an app update); and the "already installed" agent flow. Challenge scope
creep; the product direction (agents install Iliad from a terminal) is decided.

## Problem

The website will tell users to paste into their agent: "Set up Iliad for me:
follow https://iliad.md/install.md". An agent (Claude Code, Codex) works from a
terminal and cannot click menus. Today:

1. The only way to put `iliad` on `PATH` is the app menu **Iliad MD → Install
   ‘iliad’ Command…** (`electron/cli/installCommand.ts`, called from
   `electron/main.ts`). There is no terminal equivalent.
2. There is no stable download URL. `releases/latest/download/Iliad-MD-arm64.dmg`
   404s; each release only has `Iliad-MD-X.Y.Z-mac-arm64.dmg`, so an agent has
   to query the GitHub API to find the file name.
3. There is no package-manager path (`brew install --cask …`), which is what
   many agents try first on macOS.

## Goals

- G1 An agent can put `iliad` on `PATH` from a terminal using only the app
  bundle: `"/Applications/Iliad MD.app/Contents/Resources/bin/iliad" install`.
  Same folder order and safety rules as the menu item, idempotent, clear exit
  codes, `--json`.
- G2 One implementation of the install logic, used by both the CLI and the
  menu item.
- G3 Every release also carries an unversioned `Iliad-MD-arm64.dmg`, so
  `https://github.com/brainforwarding/iliad/releases/latest/download/Iliad-MD-arm64.dmg`
  always downloads the latest DMG. The release verifier enforces it.
- G4 A draft Homebrew cask (`iliad-md`) in the repo, plus release steps to
  update and publish it to an own tap, so `brew install --cask
  brainforwarding/tap/iliad-md` installs the app and links `iliad`.

## Non-goals

- Publishing anything (GitHub release assets, tap repository, iliad.md). This
  change only prepares the repo; the owner publishes.
- Submitting to `homebrew/cask` now (see Homebrew below).
- An `iliad setup` one-shot (install command + skill). Rejected: the skill step
  is agent-specific (`skill install` targets Claude Code; Codex users paste
  `skill print` into `AGENTS.md`), so a one-shot would either guess the agent
  or grow flags. Two explicit commands are simpler for an agent to follow and
  to verify. `install` prints the next step instead.
- Windows/Linux installers. The install command keeps working on Linux as a
  plain folder link, but the target list is the macOS one.
- Detecting or fixing the user's shell profile. When the chosen folder is not
  on `PATH` we say so and print the `export` line; we never edit dotfiles.
- A downloadable install script (`curl | sh`). `install.md` is read by an agent
  that runs the steps itself; a script would be one more thing to sign/trust.

## Design

### 1. `iliad install` / `iliad uninstall`

**Name.** `install` (with `uninstall` as its counterpart). It is what an agent
guesses, it reads naturally from the bundle path
(`…/bin/iliad install`), and it matches the menu label ("Install ‘iliad’
Command"). `install-command` was considered and rejected: longer, and there is
nothing else top-level to install (the skill already lives under
`iliad skill install`). Like `status`/`open`/`skill`, a folder literally named
`install` must now be written as a path (`iliad ./install`); the usage text
already says so.

**UX.**

```text
iliad install [--dir <folder>] [--json]
iliad uninstall [--json]
```

- `install` without `--dir` links `iliad` into the first *usable* folder of
  `/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin` (the last one is
  created if missing). A folder is usable when it is a writable directory and
  its `iliad` slot is empty or already an Iliad link. Real files and links to
  anything else are never replaced (same rule as today).
- `--dir <folder>` links into exactly that folder (it must exist and be
  writable; same slot rule). For users with an unusual `PATH` and for tests.
- The link target is the wrapper of the app bundle the command runs from
  (`<App>.app/Contents/Resources/bin/iliad`, resolved from the running script,
  symlinks followed), never a guessed `/Applications` path.
- Idempotent: if the chosen slot already links to this wrapper, nothing is
  written and the result says `unchanged`. A link to another Iliad bundle (an
  old or moved app) is replaced.

Human output (stdout, exit 0):

```text
Installed: /opt/homebrew/bin/iliad -> /Applications/Iliad MD.app/Contents/Resources/bin/iliad
Next: `iliad skill install` adds the Iliad skill for Claude Code; other agents can use `iliad skill print`.
```

```text
Already installed: /opt/homebrew/bin/iliad -> /Applications/Iliad MD.app/Contents/Resources/bin/iliad
```

When the folder is not on `PATH` (from the invoking process's `PATH`), a
warning follows (still exit 0, the command is installed):

```text
/Users/w/.local/bin is not on your PATH. Add it to your shell profile, for example:
  export PATH="/Users/w/.local/bin:$PATH"
```

When another `iliad` comes earlier on `PATH` than the link (e.g. a foreign one
in `/opt/homebrew/bin` made us fall back to `~/.local/bin`):

```text
Another `iliad` comes first on your PATH: /opt/homebrew/bin/iliad
```

`--json` prints one object on stdout, for success and failure:

```json
{ "ok": true, "action": "installed", "linkPath": "/opt/homebrew/bin/iliad",
  "directory": "/opt/homebrew/bin",
  "target": "/Applications/Iliad MD.app/Contents/Resources/bin/iliad",
  "onPath": true, "shadowedBy": null }
```

`action` is `installed` or `unchanged`. On failure:
`{ "ok": false, "error": "<message>" }` on stdout, exit 1.

`uninstall` removes every `iliad` link in the three default folders that
points to an Iliad wrapper, and nothing else. It leaves a link alone when the
folder's Homebrew prefix has `Caskroom/iliad-md` (Homebrew owns it) and says so.

```text
Removed: /opt/homebrew/bin/iliad
```

```text
No Iliad command link found.
```

JSON: `{ "ok": true, "removed": ["…"], "skipped": [{ "linkPath": "…", "reason": "…" }] }`.

**Exit codes** (existing table): 0 success (including "not on PATH" and
"nothing to remove"), 1 failure, 2 usage error. Messages on failure:

| Case | Message (exit 1) |
| --- | --- |
| Run from a checkout / `npm link` (no `.app` bundle) | `iliad install works from the Iliad MD app. In a checkout, run \`npm link\` instead.` |
| Bundle on a mounted disk image or App Translocation | `Iliad MD is running from a disk image or a quarantined location (<app>). Copy it to /Applications first.` |
| No usable folder | `No writable folder for the command. Tried: <folders>.` (existing text) |
| `--dir` missing/not writable/slot taken | `Cannot install into <dir>: <reason>.` |

**Refusing disk images.** An agent may mount the DMG and run the CLI straight
from `/Volumes/Iliad MD/Iliad MD.app`. A link there breaks when the image is
ejected. Refuse when the app path contains `/AppTranslocation/`, or is under
`/Volumes/` and the bundle is not writable (a mounted DMG is read-only; apps on
a writable external disk still work).

**Old app versions.** 0.3.0–0.3.2 do not know `install`; they route it as
`iliad <folder>` and launch the app on a folder named `install`. `install.md`
must require ≥ the release that ships this change (check
`iliad --help` lists `install`, or read `CFBundleShortVersionString`). Noted in
the website follow-up.

### 2. One implementation

The logic moves from `electron/cli/installCommand.ts` to
`bin/lib/install.mjs` (plain ESM, no dependencies, like the rest of `bin/lib`).
It exports `installCliCommand`, `uninstallCliCommand`, `isIliadWrapperTarget`,
`directoryIsOnPath`, `firstOnPath`, `commandInstallDirectories`,
`wrapperFromScriptDirectory` (bundle detection + disk-image refusal).

Sharing across the boundary: `electron/` compiles with `rootDir: "."`, so it
cannot statically import `bin/lib/*.mjs`. But the menu item only works in the
packaged app, where `bin/` is an extraResource at `process.resourcesPath/bin`.
So `electron/cli/installCommand.ts` becomes a thin loader:

- `loadInstallModule(resourcesPath)` dynamically imports
  `pathToFileURL(<resources>/bin/lib/install.mjs)` and returns it typed by a
  small TypeScript interface declared next to it.
- `loginShellPath()` stays (GUI apps get a minimal `PATH`; the menu passes the
  login shell's `PATH` so the "not on PATH" warning is right).

The menu handler keeps its dialogs; it calls the shared `installCliCommand`
with `wrapperPath = <resources>/bin/iliad`. The disk-image refusal applies to
the menu too (today the menu happily links into a mounted DMG). Rejected
alternative: spawning `bin/iliad install --json` from main. It is the purest
"same path", but it adds a process, a timeout and JSON parsing to a dialog, for
no extra coverage over importing the same module.

Tests import `bin/lib/install.mjs` directly; the old
`tests/cli/cliMain.test.ts` install cases move to a new
`tests/cli/cliInstall.test.ts` that also covers the loader against the repo's
`bin/`.

### 3. Stable DMG asset per release

`docs/release.md`, after the DMG is stapled and the metadata-named copies
exist:

```bash
cp -p "release/Iliad MD-X.Y.Z-mac-arm64.dmg" "release/Iliad-MD-arm64.dmg"
```

and `gh release create` also uploads `release/Iliad-MD-arm64.dmg`. It is not
referenced by `latest-mac.yml` (the updater keeps using the versioned zip), and
the naming rule in `release.md` becomes: upload the files referenced by
`latest-mac.yml`, `latest-mac.yml`, and the stable `Iliad-MD-arm64.dmg` —
nothing else (still no space-named source artifacts).

`scripts/verifyUpdateMetadata.mjs` adds one check: `release/Iliad-MD-arm64.dmg`
exists, has the same size and SHA512 as the `.dmg` listed in
`latest-mac.yml` (so a stale or pre-staple copy fails), and is *not* itself
listed in `latest-mac.yml`. The refresh script does
not change (the stable copy is not updater metadata). A test runs the verifier
against a temp `release/` folder.

**Status (2026-09-25).** The owner already uploaded a byte-identical
`Iliad-MD-arm64.dmg` to the v0.3.2 release (its SHA512 matches the DMG entry in
that release's `latest-mac.yml`), and the stable URL resolves. This change only
makes it a documented, verified step of every future release; `latest-mac.yml`
stays untouched.

### 3b. In-app updates

What the "updater" actually is today (`electron/updates/updateService.ts`): a
notify-only check. It reads `api.github.com/repos/brainforwarding/iliad/releases/latest`,
compares versions, picks a DMG asset with `selectMacDmgAsset` and the UI
(`WorkspaceMenu`, `App.tsx`) opens that URL in the browser; the user replaces
the app by hand. electron-updater is not a dependency; `latest-mac.yml` and
`app-update.yml` are kept correct for a future updater but nothing reads them.

- **(a) The extra asset must never confuse the updater.** `selectMacDmgAsset`
  takes the first `.dmg` whose name contains the arch, so with two DMGs the
  choice depends on GitHub's asset order. Both are byte-identical, so either
  works, but the choice becomes deterministic: prefer the DMG whose name
  contains the release version (`Iliad-MD-X.Y.Z-mac-arm64.dmg`), then fall
  back to the current rules. Tested with both asset orders. Any future
  electron-updater only reads files listed in `latest-mac.yml`, which never
  lists the stable copy (the verifier also fails if it does).
- **(b) CLI links survive app updates.** The link points at
  `/Applications/Iliad MD.app/Contents/Resources/bin/iliad`, a path, not a
  version: replacing the bundle in place (drag from a new DMG, `brew upgrade`,
  a future Squirrel/ShipIt swap) keeps it valid, and the wrapper resolves the
  bundle's executable at run time. Moving the app elsewhere leaves a dangling
  Iliad link; `iliad install` from the moved bundle replaces it (links to any
  `*.app/Contents/Resources/bin/iliad` count as ours), and `uninstall` removes
  it. The installed skill is a copy and does not follow updates; the release
  notes / README tell users to re-run `iliad skill install` after updating
  (cheap and idempotent). Automatic skill refresh is out of scope.
- **Homebrew and the notify-only updater.** See `auto_updates` below.

### 3c. When Iliad is already installed (agent flow)

`install.md` must not make an agent reinstall a working app. The decision the
spec fixes (and the website text follows):

1. If `/Applications/Iliad MD.app` (or `~/Applications/…`) exists, read its
   version (`defaults read "<app>/Contents/Info" CFBundleShortVersionString`).
2. If it is at least the first release with `iliad install`: do **not**
   download anything; run `<app>/Contents/Resources/bin/iliad install`
   (idempotent) and `iliad skill install`. Done.
3. If it is older: do not replace it silently. If `brew list --cask iliad-md`
   succeeds, run `brew upgrade --cask iliad-md`. Otherwise tell the user to
   update from Iliad's update notice (Iliad menu → update, which downloads the
   DMG) or, with their OK and with Iliad quit (`iliad status` exits 3), replace
   the bundle from the stable DMG. Never replace a running app.
4. If Iliad is not installed: brew if the user uses Homebrew (`brew` on PATH)
   → `brew install --cask brainforwarding/tap/iliad-md` (links the CLI; skip
   `iliad install`); otherwise stable DMG → `hdiutil attach -nobrowse` →
   `ditto` the app into `/Applications` → `hdiutil detach` → `iliad install`.
   Then `iliad skill install` (Claude Code) or `iliad skill print` (others).

### 4. Homebrew cask

**Token and tap.** `iliad-md` (Homebrew derives tokens from the app name:
`Iliad MD.app` → `iliad-md`; `iliad` alone could collide with other tools).
Start with an own tap, `brainforwarding/homebrew-tap` →
`brew install --cask brainforwarding/tap/iliad-md`. Submitting to
`homebrew/cask` needs a notable project (their "notability" bar for
self-submitted casks: GitHub stars/forks/watchers) and a stable release
cadence; revisit later. Only the tap step changes then; the cask file is the
same.

**File.** `packaging/homebrew/iliad-md.rb` (new `packaging/` folder for
distribution recipes; not under `build/`, which electron-builder reads). Draft,
pinned to the last published release (0.3.2, sha256 from the GitHub asset
digest):

```ruby
cask "iliad-md" do
  version "0.3.2"
  sha256 "fdb0c7ad83c1d0f381e6a0b67eec47af43ff3b39248a858692d68fd1fd641892"

  url "https://github.com/brainforwarding/iliad/releases/download/v#{version}/Iliad-MD-#{version}-mac-arm64.dmg",
      verified: "github.com/brainforwarding/iliad/"
  name "Iliad MD"
  desc "Local-first Markdown writing workspace"
  homepage "https://iliad.md/"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on arch: :arm64
  depends_on macos: ">= :monterey"

  app "Iliad MD.app"
  binary "#{appdir}/Iliad MD.app/Contents/Resources/bin/iliad"

  zap trash: [
    "~/Library/Application Support/Iliad MD",
    "~/Library/Caches/md.iliad.app",
    "~/Library/Caches/md.iliad.app.ShipIt",
    "~/Library/HTTPStorages/md.iliad.app",
    "~/Library/Logs/Iliad MD",
    "~/Library/Preferences/md.iliad.app.plist",
    "~/Library/Saved Application State/md.iliad.app.savedState",
  ]
end
```

Notes: the versioned URL (not the stable one) because Homebrew needs a
checksum per version. `binary` links `$(brew --prefix)/bin/iliad` to the
wrapper inside `/Applications`, which resolves its own symlink, so brew users
never run `iliad install`.

`auto_updates`: **omitted** (false), deliberately. The lead suggested
`auto_updates true` so brew does not fight the updater, but Iliad does not
update itself: the in-app check only opens the DMG download (see 3b).
Homebrew's rule is that `auto_updates true` is for apps that replace
themselves; with it, `brew upgrade` would skip Iliad (unless `--greedy`) and
brew users would only ever update by hand. Without it, `brew upgrade` updates
Iliad, and a user who instead follows the in-app notice and drags a new app
over the brew-installed one just leaves brew's recorded version behind (the
next `brew upgrade` reinstalls the same or newer version; harmless). Revisit
if the app ever adopts electron-updater/Squirrel — then add
`auto_updates true` in the same change. Monterey is
Electron 42's `LSMinimumSystemVersion` (12.0). `zap` leaves
`~/.claude/skills/iliad` alone: agent configuration belongs to the user.

**Release process.** New script `scripts/updateHomebrewCask.mjs`
(`npm run release:update-homebrew-cask`): reads the version from
`package.json`, hashes `release/Iliad-MD-X.Y.Z-mac-arm64.dmg` (sha256), and
rewrites the `version`/`sha256` lines of `packaging/homebrew/iliad-md.rb`. The
owner then, after the GitHub release is live: copies the file to the tap's
`Casks/iliad-md.rb`, runs `brew audit --cask --online --strict
brainforwarding/tap/iliad-md`, `brew style`, `brew install --cask
brainforwarding/tap/iliad-md`, checks `iliad --help`, and pushes the tap. The
updated repo file is committed with the post-release record commit. The script
fails if the DMG is missing or the cask lines are not found.

### Docs and skill

- README "The `iliad` command": terminal install (`…/bin/iliad install`),
  Homebrew, `uninstall`, stable download URL.
- `docs/architecture.md` CLI section and module map: `bin/lib/install.mjs` is
  the single install implementation; the menu loads it from resources.
- `docs/release.md`: stable DMG copy + upload, verifier check, Homebrew steps,
  packaged `iliad install --dir` smoke check.
- `resources/skill/iliad/SKILL.md`: one line — if `iliad` is not found, the
  command lives at `/Applications/Iliad MD.app/Contents/Resources/bin/iliad`
  and `… install` links it.

## Tests

- `tests/cli/cliInstall.test.ts` (new; replaces the install cases in
  `cliMain.test.ts`):
  - first usable folder wins; read-only and missing folders are skipped;
    `~/.local/bin` is created; PATH membership is exact.
  - never replaces a real file or a foreign link; replaces an old Iliad link.
  - idempotent: second run returns `unchanged` and does not touch the link.
  - `--dir`: exact folder, missing folder and taken slot fail.
  - `shadowedBy` reports an earlier `iliad` on PATH; null when ours is first.
  - bundle detection: checkout layout refused; `/Volumes/…` read-only bundle
    and `/AppTranslocation/` refused.
  - uninstall removes only Iliad links, skips Homebrew-owned ones.
  - the Electron loader imports the repo's `bin/lib/install.mjs`.
- `tests/cli/cliRouter.test.ts`: routing of `install`, `install --dir x
  --json`, bad options, `uninstall`; `runCli` human and JSON output and exit
  codes with injected folders.
- End-to-end (in vitest): build a fake `X.app/Contents/{MacOS,Resources/bin}`
  in a temp folder with the repo's `bin/` copied in and `Contents/MacOS/X`
  pointing at the current Node binary; run the real `bin/iliad` wrapper with
  `install --dir <tmp> --json` and a temp `HOME`; assert the link and JSON; run
  it through the created link (`<tmp>/iliad --help`) to prove the wrapper
  resolves its symlink.
- `tests/release/verifyUpdateMetadata.test.ts`: the verifier passes with a
  matching stable DMG and fails when it is missing, differs, or is listed in
  `latest-mac.yml`.
- `tests/electron/updateService.test.ts`: with both the versioned and the
  stable DMG in either order, `selectMacDmgAsset` returns the versioned one.
- `tests/release/updateHomebrewCask.test.ts`: the script rewrites version and
  sha256 in a temp copy.

Never write into the real `/opt/homebrew/bin`, `/usr/local/bin` or
`~/.local/bin` in tests: every test injects folders and `HOME`.

## Manual QA

1. Packaged app (next release candidate): from Terminal,
   `"/Applications/Iliad MD.app/Contents/Resources/bin/iliad" install`, then
   `iliad --help`, again `install` (says Already installed), `install --json`,
   `uninstall`, and the menu item still shows its dialog with the same result.
2. Mount the DMG and run the CLI from `/Volumes/…`: refused.
3. In a Claude Code session with no `iliad` on PATH: paste the install.md steps
   and watch it complete without GUI clicks (other than first-launch
   Gatekeeper, which does not apply to a curl-downloaded, notarized app).
4. Release dry run: verifier fails without `release/Iliad-MD-arm64.dmg`, passes
   with it.
5. Tap: in a scratch tap, `brew install --cask ./packaging/homebrew/iliad-md.rb`
   (or via the tap), `iliad status`, `brew uninstall --zap --cask iliad-md`.

## Risks

- **Reserving `install`/`uninstall`** breaks `iliad install` meaning "open the
  folder named install". Same trade-off already made for `status`, `open`,
  `skill`; the path spelling still works.
- **Brew-owned link.** `iliad install` on a brew install finds the brew link
  pointing at the same wrapper and reports `unchanged` — correct. `uninstall`
  skips it when `Caskroom/iliad-md` exists next to the folder; otherwise
  it would remove brew's link (brew then warns on uninstall; harmless).
- **Dynamic import in main.** If `bin/lib/install.mjs` is missing from
  resources the menu shows an error dialog, never a crash. The release runbook
  already asserts the packaged `bin/lib` exists.
- **Stable DMG drift.** Enforced by the verifier (size + SHA512).
- **Old versions** misroute `install` (see above); install.md must gate on
  version.
- **Cask sha drift** if the DMG is rebuilt after the cask is updated: the
  script is run after the final stapled DMG; `brew audit --online` and a real
  `brew install` catch mismatches before the tap push.

## Review

(pending Codex xhigh review)
