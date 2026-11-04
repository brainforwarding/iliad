# Iliad MD 0.8.0 Verification

Released 2026-11-04 for Apple Silicon macOS.

[Public release](https://github.com/brainforwarding/iliad/releases/tag/v0.8.0)
from source commit `ce5cbb18dd2e7507485df664dc2f67155ba3bc6f`.
The implementation was merged through [PR #3](https://github.com/brainforwarding/iliad/pull/3),
with two subsequent folder-restoration fixes. The spec and implementation were
independently reviewed by GPT-6.1 Sol at High reasoning.

## Validation

- All 1,241 tests across 123 files, full app/Electron/proxy typecheck, CSS lint,
  production build, and the production dependency audit high gate passed.
- Native full-app checks covered per-document undo, selection and outer scroll,
  late text/comment edits during reads, text/comment save failures, active and
  inactive close, outside review, ghost dismissal, and restoring open documents.
- A delayed initial folder read, A → B → A, and selecting the current folder
  passed. Replaying the delayed-read check against the prior App failed as expected.
- Rendered editor checks covered bold/italics, hidden-marker boundary clicks,
  drag/double click, and undo. Native tab UI checks covered keyboard focus and
  overflow in English and Spanish at the minimum window width.

## Signed Artifacts and Public Delivery

The app and disk image were signed by Developer ID Application: ED4.ONE SpA,
Team `K542ZFQH6B`, notarized, and stapled. The ZIP/DMG were rebuilt from the
stapled app. Codesign deep/strict, Gatekeeper, stapler, bundled CLI/install,
and updater metadata verification passed, including the app inside both artifacts.

Accepted final notarization submissions:

- App: `de9bd2fc-9616-4d29-9286-80cc3353e577`.
- DMG: `e355da6d-1e42-4085-8089-933a29ba2539`.

Every published asset returned HTTP 200. Public `latest-mac.yml` matched the local
manifest and reported 0.8.0. The downloaded stable DMG matched its versioned
manifest SHA512. The downloaded ZIP matched its 162,126,401-byte size and SHA512
in both manifest entries, and its app reported bundle version 0.8.0.

| Artifact | SHA256 |
| --- | --- |
| `Iliad-MD-0.8.0-mac-arm64.dmg` | `510a7eea47794bbfbae44af19122b4ec4879c1d6ea00c75a37b6bbec352e5fb2` |
| `Iliad-MD-0.8.0-mac-arm64.zip` | `9071fa23e755a4dc4b142eb10e92e21691505e03d6a791ab63322800eb039518` |

The downloaded public app passed codesign, Gatekeeper (Notarized Developer ID),
and stapler validation. An isolated temporary workspace/profile exercised the
single-document breadcrumb, Cmd+B/Cmd+I saved Markdown, second-document tabs,
independent undo with the other document unchanged, and close-to-one breadcrumb.
The existing installed app and user profile were left untouched.

The Homebrew cask was updated with the final DMG checksum and published to
`brainforwarding/homebrew-tap` in commit `8f03518`; repository cask commit `0d5ef6c`.
Homebrew style passed. The online audit result is recorded in the release log.
An unavailable SSH agent during the tap clone was handled using the existing
HTTPS GitHub access for that command; no credential or global configuration changed.

The release used an isolated public-safe checkout. Unrelated passage-comment
changes in the original checkout were excluded and preserved. The only comment
session change shipped here prevents edits during an in-flight write from being
lost on navigation. Undici received the compatible 7.30.1 audit fix.
