# Telegram Settings UI Cleanup

Date: 2026-05-27
Status: implemented pending visual review
Roadmap: `specs/2026-05-27-telegram-remote-chat-roadmap.md`
Branch: `feat/telegram-settings-ui-cleanup`

## Problem

The first Telegram Remote Chat implementation made pairing functional, but the
settings placement and pairing control are rough:

- Telegram Remote Chat appears between the Codex account card and the OpenAI API
  key card, splitting two local AI connection controls that belong together.
- The pairing state renders a full `https://t.me/...` URL in a wrapping code
  row. Long URLs make the settings panel feel unstable and visually heavier than
  the rest of Iliad's minimal settings UI.
- The user has to copy the link manually even though the most natural action is
  opening Telegram from the generated link.

## Product Intent

Keep settings quiet, compact, and easy to scan. Local AI connection controls
should remain visually connected. Telegram should read as remote access, not as
another local model or account provider.

## Goals

- Keep `Codex agent` and `OpenAI API key` adjacent inside the existing
  `Connection` section.
- Move `Telegram Remote Chat` into a separate `Remote access` section.
- Keep the Telegram card copy short and preserve current status, privacy, and
  read-only cues.
- Replace the raw expanding pairing URL row with a compact one-line value.
- Add a copy action that copies the full pairing URL or token.
- Add an open action when a pairing URL exists, using Iliad's trusted
  `window.iliad.openUrl` bridge.
- Use icon buttons with accessible labels and tooltips for compact pairing
  actions.
- Preserve existing enable, disable, pair, revoke, and error behavior.
- Preserve the local-only secret boundary: no device secret, relay secret, or
  full pairing token/link should render as normal text or tooltip content in the
  settings UI.

## Non-Goals

- No conversation history changes.
- No active remote conversation selector.
- No relay protocol changes.
- No Telegram command changes.
- No QR code generation.
- No new design language or larger settings redesign.

## Proposed UX

Settings order:

```text
Connection
  Codex agent
  OpenAI API key

Remote access
  Telegram Remote Chat

Model
Mode
Save settings
```

Pairing UI:

```text
Pairing link
[ t.me/iliadmd_bot... ] [copy icon] [open icon]
Expires ...
```

The visible value should stay on one line and truncate with ellipsis if the
panel is narrow. It should be a shortened display value only. The full pairing
link/token is available through Copy and Open actions, but it should not be
rendered as normal text, native `title` tooltip content, or another inspectable
visible string.

The open button appears only for URL-based pairing responses. Token-only
pairing responses keep the copy action but do not show an open button.

Show Open only for a parseable HTTPS Telegram deep link with host `t.me`. Open
the exact validated full URL. Invalid or non-Telegram URLs fall back to
copy-only behavior.

The pairing row should be a single compact flex row: the value uses
`min-width: 0`, `white-space: nowrap`, `overflow: hidden`, and
`text-overflow: ellipsis`; action icons keep a stable fixed hit area and do not
wrap independently. Do not add a nested card, a louder bordered container, or
extra divider. Remote access should use the same quiet section/card treatment
and spacing as the existing settings groups.

## Implementation Notes

- Update `src/components/assistant/AssistantSettings.tsx`.
- Add or reuse localized strings in `src/i18n/strings.ts`:
  - `remote.section`
  - `remote.openLink`
- Icon-only Copy/Open buttons must use localized `aria-label` and
  `data-tooltip` text. Icons should be `aria-hidden`.
- Buttons should have visible focus state, disabled state while busy, and
  stable compact dimensions.
- Use lucide icons for copy/open actions.
- Keep button dimensions stable and compact.
- Add remote-specific pairing row/value/action classes. Do not change
  `.assistant-codex-code-row` behavior.
- Use `window.iliad.openUrl(pairingUrl)` only when `pairingUrl` is present and
  validated as an HTTPS `t.me` URL. Do not synthesize a URL from token-only
  responses.
- Keep the full pairing value out of normal visible text and tooltip attributes,
  but keep it available to the copy/open handlers.

## Tests

- Update assistant settings render tests to verify section order:
  - `Connection` contains Codex and OpenAI API key.
  - `Remote access` renders as a separate section containing Telegram Remote
    Chat.
  - `Remote access` appears after `Connection` and before `Model`.
- Update the existing pairing-link test so it no longer expects the full URL as
  visible `<code>` text.
- Verify pairing renders a compact display value, localized accessible
  copy/open icon buttons, and expiry.
- Verify token-only pairing renders copy but not open.
- Verify rendered settings still do not expose secret material or the full
  pairing URL/token in visible text or tooltip attributes.
- Because current assistant settings tests use static markup, test click
  behavior through small helper functions when possible and use render tests for
  accessible markup.
- Run focused assistant settings tests.
- Run typecheck, CSS lint, full test suite, and production build before merge.

## Review Panel

Spec review should include:

- UI/UX reviewer focused on Iliad's minimal, clean design line, settings
  hierarchy, action density, and long-value behavior.
- Frontend implementation reviewer focused on React structure, accessibility,
  localized strings, test coverage, and regression risk.

The review panel completed before implementation. The final implementation
incorporates the requested changes: no full token-bearing pairing value in
rendered text/tooltips, HTTPS `t.me` validation before showing Open, localized
icon labels/tooltips, remote-specific compact pairing CSS, and separate
Connection/Remote access render tests.
