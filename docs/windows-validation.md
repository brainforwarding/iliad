# Windows contribution validation

Record the source commit, OS, architecture, commands and results in the PR.
Do not commit machine paths, profiles, API keys, manuscript content or binaries.
A pending check is not a passing check.

## Automated checks

The Desktop checks workflow runs types, unit tests, CSS lint, build and the
production dependency audit on Windows, macOS and Linux. Windows additionally
packages NSIS, tests the unpacked app, and installs/tests/uninstalls the product
on a disposable GitHub-hosted runner. Artifacts expire after seven days and
are unsigned test builds, not official releases.

For a fresh disposable Windows VM, run:

```powershell
./scripts/verifyWindowsInstaller.ps1 -DisposableMachine
```

The script refuses existing Iliad installations/profiles. It checks fresh
opt-out, explicit opt-in, preserved choice, explicit opt-out, preferences,
installed application smoke tests and uninstall cleanup. Never run this cycle
against a personal installation. The packaged-app test is safe to run locally
because it uses an isolated profile and synthetic workspace.

## Manual acceptance checklist

- Windows: installer checkbox and shortcuts, native menus, open folder/file,
  PowerShell and CMD with app open/closed, Unicode paths and no Node on PATH.
- Edit and restart; close immediately after editing; retry a locked-file save;
  close multiple windows while saves are pending.
- Image paste/drop, comments and notes, rename companions, Recycle Bin,
  outside-change Keep/Restore and newer simultaneous edits.
- Navigate nested files using mixed Windows separators; confirm the correct
  row is revealed without repeated missing-ancestor diagnostics.
- macOS: menus, Cmd shortcuts, normal quit and last-window behavior, CLI,
  autosave and outside review. Manual macOS validation remains a release gate.

## AI validation

CI uses injected provider responses, including HTTP 503, cancellation and empty
results; real API availability is not a CI dependency. During the initial local
Windows evaluation, sentence/paragraph completion, Shorten and Turn into a list
returned Spanish proposals. Other requests encountered provider unavailability,
a timeout, or an empty answer. A direct diagnostic returned HTTP 503 (high
demand). No generated proposal was applied to the user's document. This is
historical manual evidence, not certification of subsequent commits.
