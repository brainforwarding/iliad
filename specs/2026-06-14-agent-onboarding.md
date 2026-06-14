# Agent Onboarding Cleanup

Date: 2026-06-14
Status: reviewed and implemented

## Problem

The settings screen makes the first run feel broken:

- Codex can show `Unavailable`, even when assistant editing works through an OpenAI API key.
- The API key card says it powers only dictation, but it also powers chat, `Editar`, and `Ajustar`.
- Telegram setup appears too early and adds noise.

## Goal

Make the first settings screen answer one question:

> How is the assistant connected?

Use as little copy as possible.

## Product Rule

Runtime selection stays unchanged:

```text
if Codex is connected:
  use Codex account
else if OpenAI API key is saved:
  use OpenAI API key
else:
  ask for either Codex or an API key
```

## UI

### Connection

Show the Codex and API key routes as two quiet options.

Codex:

- Label: `Codex`
- Role: `ChatGPT plan.`
- State:
  - `Connected`
  - `Not connected`
  - `Unavailable`
- If unavailable and the app-server is missing, say only: `Codex CLI not found.`
- For other unavailable cases, say only: `Codex unavailable.`

OpenAI API key:

- Label: `OpenAI API key`
- Role: `Chat, editing, and dictation.`
- State:
  - `Active` when Codex is not connected and a key exists.
  - `Saved` when Codex is connected and a key exists.
  - no state when no key exists.

If there is no active provider because Codex is not connected and no key is saved,
keep the API key input visible.
If a key is saved, hide the input behind `Change key`.

### Remote Access

Keep Telegram lower in the screen and compact.

- Disabled state: title, status, one role line, `Enable`.
- Hide unpaired/thread/privacy details while disabled.
- Show privacy/read-only details only after it is enabled.

### Copy Rules

- Do not say assistant editing is unavailable when API fallback exists.
- Avoid explanatory paragraphs.
- Use Spanish strings in Spanish UI.
- Keep graphite for actions, normal status dots, existing cards, and 8px-or-less radii.

## Implementation Notes

- Change renderer copy and layout only; provider selection stays in `AgentService.selectRuntimeProvider`.
- Keep Codex status as provider-specific status.
- Derive API key state from `settings.hasOpenAiApiKey` and Codex connection state.
- Derive API key input visibility from current settings, not only initial render.
- Do not add a new persistent onboarding step.

## Verification

- No key + no Codex: screen asks for Codex or API key.
- Codex unavailable + API key saved: screen shows API key as active.
- Codex connected + API key saved: screen shows Codex connected, API key saved.
- Telegram disabled: compact card only.
- Settings still render correctly while settings/Codex status are loading.
- `npm run typecheck`
- `npm run test`
- `npm run build`
