# Iliad MD 0.8.1 Verification

Released 2026-11-04 (America/Santiago).

[Public release](https://github.com/brainforwarding/iliad/releases/tag/v0.8.1)
from source `c4cf065b96ea0a4fb2a2bc1119e25ce8f70355ee`.

## Change and Validation

The macOS window exposes native Window Controls Overlay geometry. CSS uses its
left safe area and a native-height minimum, and the topbar track fits its
controls at reduced zoom. Fullscreen retains its compact inset. The fix adds
no IPC, resize listeners, preferences, or document changes.

GPT-6.1 Sol at High reasoning independently reviewed the design and implementation.
All 1,241 tests across 123 files, full typecheck, CSS lint, build, and the
production audit high gate passed.

The built-app native regression passed 50%, 67%, 80%, 100%, and 125% zoom in
open, collapsed, and peeking sidebar states. It used the actual 220px minimum
sidebar, three tabs, both history controls, complete button bounds and widths,
drag regions, fullscreen enter/exit, and native minimize/restore. Native
screenshots confirmed clearance. Run `tests/manual/window-chrome.cjs` as described
in the spec to repeat it.

## Release and Installed App

Both app and DMG are signed, notarized, and stapled. Accepted submissions:

- App: `a216f916-5ead-43a2-8f44-4cf72bbb3956`.
- DMG: `aa29f147-295e-4c46-9c1b-764827256f70`.

Artifact signatures, attached tickets, packaged CLI/install, updater metadata,
public URLs, and the downloaded stable DMG checksum passed. Homebrew cask
`73a1f4a` was published; style and online audit passed. Repository cask commit
is `2674e7f`.

The independently downloaded public ZIP matched its 162,126,194-byte size
and both updater SHA512 fields. Its app reported 0.8.1 and passed codesign,
Gatekeeper, stapler, writing/tab/undo workflows, and native WCO clearance checks.

The installed archive was verified against the non-draft public release,
GitHub asset SHA256, and published updater SHA512 before installation:

- ZIP SHA256: `70e03470b0427ccbe1dc0ca58f899a8780d1c9b115fc50e2c4c324d98aa8d424`.
- ZIP SHA512: `RHOSIn1959xb7mKan4rPnZVggy8fvA+rhq0mQ+mj20P96cVimjj4pvKZE3LpkPwh/kEKS+PexIQ8C4m+f2si7A==`.

Iliad quit normally through its save guard. Official 0.8.1 was installed at
`/Applications/Iliad MD.app`, verified, and brought to the front. The existing
profile, zoom settings, and documents were preserved. The owner confirmed the
corrected spacing in the installed window. Temporary standalone app bundles
were unregistered and moved to Trash; the canonical installed app remains.
