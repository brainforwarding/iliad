# Agent-Installable Iliad: `iliad install`, a Stable DMG URL, and a Homebrew Cask

Date: 2026-09-25
Status: v2 — Codex xhigh review folded in; implemented on the branch
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
- Windows/Linux. `iliad install` is macOS-only: it requires the
  `.app/Contents/Resources/bin` layout and the wrapper runs
  `Contents/MacOS/Iliad MD`. Other platforms get a clear `not-app-bundle`
  refusal.
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
from `/Volumes/Iliad MD/Iliad MD.app` (or any mount point, e.g. `/tmp/…`). A
link there breaks when the image is ejected. After `realpath`-ing the script
folder, refuse when a path segment is `AppTranslocation`, or when a write
probe on the bundle fails with `EROFS` (read-only filesystem: a mounted DMG,
wherever it is mounted). A bundle the user merely cannot write (`EACCES`,
installed by another admin) and apps on writable external disks still work.
(Review: replaced the v1 `/Volumes/` prefix rule.)

**Ownership rule.** A slot counts as ours only when it is a symlink whose
target is this wrapper or matches `/<name containing "Iliad">.app/Contents/Resources/bin/iliad`
(an old, renamed or deleted Iliad bundle); v1's "any `*.app/…/bin/iliad`" was
too broad. Empty slots are filled with a plain `symlink()` (fails with `EEXIST`
if anything appeared meanwhile — then the slot counts as taken); an old Iliad
link is re-read right before an atomic temp-link + `rename`. The remaining
window (a foreign program replacing an old Iliad link in the microseconds
between re-read and rename) is accepted for a single-user desktop tool.

**JSON contract.** With `--json`, every outcome of `install`/`uninstall` is one
JSON object on stdout, including usage errors:
`{ "ok": false, "code": "<code>", "error": "<message>" }`, where `code` is one
of `usage` (exit 2), `not-app-bundle`, `disk-image`, `no-folder`,
`folder-unusable`, `slot-taken`, `error` (exit 1).

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
`bundleWrapperPath` (bundle detection + disk-image refusal), `InstallError`.

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

`scripts/verifyUpdateMetadata.mjs` adds checks: `latest-mac.yml` lists exactly
`Iliad-MD-X.Y.Z-mac-arm64.dmg` and does *not* list the stable name;
`release/Iliad-MD-arm64.dmg` exists and has the size and SHA512 recorded for
that versioned entry (which the existing loop already matched against the
file on disk), so a stale or pre-staple copy fails. The refresh script does
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
  works, but the choice becomes deterministic: first the exact file name
  `Iliad-MD-X.Y.Z-mac-<arch>.dmg`, then any DMG for this arch, then an
  arch-neutral DMG (never another arch). Tested with both asset orders, a
  versioned DMG for another arch, and an unrelated asset containing the
  version. Any future
  electron-updater only reads files listed in `latest-mac.yml`, which never
  lists the stable copy (the verifier also fails if it does).
- **(b) CLI links survive app updates.** The link points at
  `/Applications/Iliad MD.app/Contents/Resources/bin/iliad`, a path, not a
  version: replacing the bundle in place (drag from a new DMG, `brew upgrade`,
  a future Squirrel/ShipIt swap) keeps it valid, and the wrapper resolves the
  bundle's executable at run time. Moving the app elsewhere leaves a dangling
  Iliad link; `iliad install` from the moved bundle replaces it (links to an
  `*Iliad*.app/Contents/Resources/bin/iliad` count as ours), and `uninstall` removes
  it. The installed skill is a copy and does not follow updates; the release
  notes / README tell users to re-run `iliad skill install` after updating
  (cheap and idempotent). Automatic skill refresh is out of scope.
- **Homebrew and the notify-only updater.** See `auto_updates` below. Brew
  users keep seeing the in-app notice ("Iliad MD X.Y.Z is available." with
  Download / View Release) for now. Following it is not harmless in
  Homebrew's eyes: dragging a DMG over a cask-managed app leaves brew's
  recorded version stale (`brew outdated` and `brew upgrade` then act on a
  version that is no longer installed; the app itself keeps working). Known
  and accepted until the tap has users. A brew-aware hint ("Run `brew upgrade --cask iliad-md`",
  detected by `<prefix>/Caskroom/iliad-md`) needs main + IPC type + UI + i18n
  changes and is deferred to `docs/backlog.md` until the tap is published and
  has users.

### 3c. When Iliad is already installed (agent flow)

`install.md` must not make an agent reinstall a working app. The decision the
spec fixes (and the website text follows):

1. If `brew` exists and `brew list --cask iliad-md` succeeds, Homebrew owns
   the install (whatever its `--appdir`); use `brew info --cask iliad-md` for
   the version and the app path. Otherwise look for `/Applications/Iliad MD.app`
   then `~/Applications/Iliad MD.app` and read its version
   (`defaults read "<app>/Contents/Info" CFBundleShortVersionString`).
2. If it is at least the first release with `iliad install`: do **not**
   download anything; run `"<app>/Contents/Resources/bin/iliad" install --json`
   (idempotent; brew installs report `unchanged`) and then the skill step
   below. Done.
3. If it is older: do not replace it silently, and never while it runs. Ask
   the user first. Brew: `brew upgrade --cask iliad-md` (Homebrew may quit
   the app, so ask before). Otherwise: the user updates from Iliad's update
   notice, or, with their OK and with Iliad quit (`iliad status` exits 3, or
   no `Iliad MD` process), the agent replaces the bundle from the stable DMG
   as in step 4.
4. If Iliad is not installed: with `brew` on PATH, offer
   `brew install --cask brainforwarding/tap/iliad-md` (links the CLI; skip
   `iliad install`). Otherwise download the stable DMG with `curl -fL`,
   `hdiutil attach -nobrowse -readonly -mountpoint <tmp dir>`, `ditto` the app
   into `/Applications` (or `~/Applications` if `/Applications` is not
   writable), `hdiutil detach` (also on failure), then
   `"<app>/Contents/Resources/bin/iliad" install --json`. Never `sudo`, and
   never strip quarantine (`xattr -d`) without explicit user approval (a
   `curl` download is not quarantined; the app is notarized).
5. Skill: run it through an absolute path, not a bare `iliad` (the agent's
   non-interactive shell may not have the link folder on PATH yet): the
   `linkPath` from the JSON, or the bundle wrapper path —
   `"<linkPath>" skill install` (Claude Code) or `"<linkPath>" skill print`
   (paste into `AGENTS.md` for other agents). If `onPath` is false, tell the
   user which `export PATH=…` line to add.

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
  depends_on macos: :monterey

  app "Iliad MD.app"
  binary "#{appdir}/Iliad MD.app/Contents/Resources/bin/iliad"

  zap trash: [
    "~/Library/Application Support/Iliad MD",
    "~/Library/Caches/md.iliad.app",
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
Iliad. A user who instead follows the in-app notice and drags a new app over
the brew-installed one leaves brew's recorded version stale (see 3b; a
brew-aware notice is in the backlog). Homebrew's Cask Cookbook also says
`auto_updates` does not apply to an app that merely opens a download page.
Revisit
if the app ever adopts electron-updater/Squirrel — then add
`auto_updates true` in the same change. Monterey is
Electron 42's `LSMinimumSystemVersion` (12.0); `depends_on macos: :monterey`
is the symbol form `brew style` requires (v1's `">= :monterey"` string was
flagged). `zap` leaves `~/.claude/skills/iliad` alone: agent configuration
belongs to the user. No `ShipIt` cache: nothing uses Squirrel. The `zap` list
should be confirmed against a real launched profile during tap QA.

Checked locally in a throwaway local tap (removed afterwards): `brew style`
reports no offenses and `brew audit --cask --online --strict` passes against
the real v0.3.2 DMG (download + sha256 match); `brew info` shows
`Required: arm64 architecture, macOS >= 12` and the `Binary` artifact.

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
  - ownership: another app's `bin/iliad` link is foreign; a renamed Iliad
    bundle's is ours.
  - bundle detection: checkout layout refused; App Translocation and an
    `EROFS` bundle (DMG mounted under `/tmp`) refused; an `EACCES` bundle
    accepted; a symlinked script folder resolved first.
  - uninstall removes only Iliad links, skips Homebrew-owned ones.
  - the Electron loader imports the repo's `bin/lib/install.mjs` and applies
    the same refusals.
  - `runCli`: routing of `install`/`uninstall` options, human and JSON output,
    JSON for usage errors (`code: "usage"`, exit 2) and refusals (stable
    `code`, exit 1), with injected folders.
  - end to end: a fake `Iliad MD.app/Contents/{MacOS/Iliad MD,Resources/bin}`
    in a temp folder, the repo's `bin/` copied in and `MacOS/Iliad MD`
    pointing at the current Node binary; run the real `bin/iliad` wrapper with
    `install --dir <tmp> --json` and a temp `HOME`; then `--help`,
    `skill install` and `install` again through the created link.
- `tests/release/releaseScripts.test.ts`: the verifier passes with a matching
  stable DMG and fails when it is missing, stale, or listed in
  `latest-mac.yml`; the cask script rewrites only `version`/`sha256` and fails
  without the DMG; the cask keeps `binary` and has no `auto_updates`.
- `tests/electron/updateService.test.ts`: exact versioned name wins in either
  asset order; a versioned DMG for another arch never hides this arch's
  stable copy; an unrelated asset containing the version does not win.

Not unit-tested: the `EEXIST` race on an empty slot and the re-read before
rename (they need filesystem fault injection; covered by review and the
single-call structure).

Never write into the real `/opt/homebrew/bin`, `/usr/local/bin` or
`~/.local/bin` in tests: every test injects folders and `HOME`.

## Manual QA

1. Packaged app (next release candidate): from Terminal,
   `"/Applications/Iliad MD.app/Contents/Resources/bin/iliad" install`, then
   `iliad --help`, again `install` (says Already installed), `install --json`,
   `uninstall`, and the menu item still shows its dialog with the same result.
2. Mount the DMG (at `/Volumes/…` and at a `-mountpoint /tmp/…`) and run the
   CLI from it: refused with `disk-image`.
3. In a Claude Code session with no `iliad` on PATH, and on a clean macOS user:
   paste the install.md steps and watch it complete without GUI clicks; check
   first launch (curl downloads are not quarantined; a browser download is,
   and Gatekeeper then shows its notarized-app prompt once).
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

Codex (xhigh, read-only), 2026-09-25, on v1 of this spec plus the
work-in-progress branch: **NO-GO** with 1 P0, 8 P1, 1 P2. Folded in as v2:

1. P0 existing entries could be clobbered (inspect-then-rename race; the
   `*.app/Contents/Resources/bin/iliad` regex claimed any app's link; cut
   `uninstall`). **Accepted in part.** Empty slots are now filled with a plain
   `symlink()` (`EEXIST` = taken, never replaced); an old Iliad link is re-read
   right before the atomic rename; ownership requires `Iliad` in the bundle
   name. **Rejected:** never replacing old/dangling Iliad links (a moved or
   deleted app would leave users with a broken command and no fix but manual
   `rm`; the shipped menu already replaces them), a durable ownership record
   (extra state for no practical gain), and cutting `uninstall` (it is an
   explicit user command that removes only Iliad-owned links and leaves
   Homebrew's; cheap and useful for QA).
2. P1 disk-image refusal only covered `/Volumes` and did not resolve the
   script path. **Accepted:** `realpath` first; refuse on `EROFS` from a write
   probe (any mount point) or an `AppTranslocation` segment. Mount-metadata
   parsing (`hdiutil info`) rejected as heavier than the `EROFS` signal.
3. P1 "works on Linux" was false. **Accepted:** macOS-only, stated.
4. P1 `--json` lost on usage errors. **Accepted:** one JSON object for every
   outcome, with stable `code` values; exit codes 0/1/2 documented. `install`
   and `--dir` kept; no `setup` (agreed).
5. P1 updater selection could miss the stable arm64 DMG when only an x64
   versioned DMG exists, and matched unrelated names. **Accepted:** exact
   `Iliad-MD-X.Y.Z-mac-<arch>.dmg`, then this arch, then arch-neutral; tests.
6. P1 verifier did not tie the stable copy to `latest-mac.yml`. **Accepted:**
   the versioned DMG must be listed; the stable copy is compared with that
   entry. **Rejected:** parameterizing the script's root (tests run a copy of
   the script in a temp repo layout instead; no production change needed).
7. P1 already-installed flow unsafe in agent shells. **Accepted:** Homebrew
   checked first (any `--appdir`), ask before `brew upgrade`, `hdiutil attach
   -readonly -mountpoint` with cleanup, `~/Applications` fallback, no `sudo`
   or quarantine stripping without approval, skill commands via the absolute
   `linkPath`.
8. P1 cask macOS DSL and "harmless" brew drift. **Accepted:** `:monterey`
   (confirmed by `brew style`), `auto_updates` stays omitted (Codex agrees,
   citing the Cask Cookbook), wording fixed, `ShipIt` zap path dropped. The
   brew-aware in-app notice stays deferred (backlog) until the tap has users.
9. P2 test fixture naming / packaged-app smoke. **Accepted:** the end-to-end
   test uses `Iliad MD.app/Contents/MacOS/Iliad MD`; `docs/release.md` adds a
   packaged `install --dir` smoke check.
10. P1 test migration incomplete (`cliMain.test.ts` imported removed
    exports). **Stale:** Codex read the tree mid-edit; the move to
    `tests/cli/cliInstall.test.ts` was already done and the suite passes.
