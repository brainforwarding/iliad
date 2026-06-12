# Codex Model Options Spec

Date: 2026-05-24
Status: implemented

## Problem

Iliad currently saves one free-text `model` setting with default `gpt-5-mini`.
After the Codex account runtime became the primary chat path, that default is
wrong: local verification with the same Iliad Codex account returned:

```text
The 'gpt-5-mini' model is not supported when using Codex with a ChatGPT account.
```

The same login succeeds with `gpt-5.5`. The Codex CLI model picker currently
offers:

- `gpt-5.5`
- `gpt-5.4`
- `gpt-5.4-mini`
- `gpt-5.3-codex`
- `gpt-5.3-codex-spark`
- `gpt-5.2`

## Product Intent

The app should present model choices that are actually valid for the active
Codex account runtime. `gpt-5.5` should be the default and the recommended
option. We should stop exposing `gpt-5-mini` in the app settings.

## Goals

- Replace the free-text model input with a minimal select/control listing the
  Codex-supported model options above.
- Default new and invalid saved settings to `gpt-5.5`.
- Sanitize existing saved `gpt-5-mini` settings to `gpt-5.5` on snapshot/update.
- Use the selected Codex model when Codex is connected.
- Keep the app resilient if a selected model does not emit thinking summaries:
  the existing generic status fallback remains valid.
- Update labels from "OpenAI model" to neutral "Agent model" / "Modelo del
  agente".
- Add tests around default/sanitized model behavior and UI copy.

## Non-Goals

- No live dynamic model-list endpoint.
- No separate advanced API model picker in this slice.
- No model benchmarking or pricing UI.
- No changes to dictation model.
- No attempt to support legacy/hidden Codex models.

For now, the same saved model setting is used by both the Codex account runtime
and the API fallback path. That is intentional for this slice: the agent is
Codex-first, the user asked to show Codex-available models only, and adding a
second advanced API-only model picker would add UI weight. If the API fallback
needs a separate model list later, it should be handled as a separate settings
spec.

## UX

Settings should show one compact model selector:

- `gpt-5.5` - recommended/current/default;
- `gpt-5.4`;
- `gpt-5.4-mini`;
- `gpt-5.3-codex`;
- `gpt-5.3-codex-spark`;
- `gpt-5.2`.

The selector must use the same clean/minimal settings style. Avoid a dense
technical model catalog. The visible labels can be just model IDs; helper copy
can say these are Codex-compatible agent models.

## Implementation Plan

1. Add a shared `agentModels` module with:
   - `defaultAgentModel = "gpt-5.5"`;
   - ordered `agentModelOptions`;
   - `normalizeAgentModel(value)`.
2. Update `AgentSettingsStore` to use `defaultAgentModel` and normalize stored
   model values on snapshot/update.
3. Update runtime/provider tests expecting `gpt-5.5` where defaults matter,
   while preserving explicit model pass-through tests.
4. Replace the free-text settings input with a `<select>` over
   `agentModelOptions`.
5. Update i18n labels and settings-copy tests.
6. Verify full tests/build.

## Tests

- Settings snapshot defaults to `gpt-5.5`.
- Settings snapshot converts saved `gpt-5-mini` to `gpt-5.5`.
- Settings update rejects/normalizes unknown model values.
- Settings UI renders allowed Codex model options and does not render
  `gpt-5-mini`.
- Settings UI says "Agent model" / "Modelo del agente" rather than "OpenAI
  model".
- Existing runtime tests continue passing.

## Review Notes

- Accepted reviewer feedback to constrain the UI with a selector rather than a
  free-text input.
- Accepted reviewer feedback to normalize stale or unknown saved values in the
  settings store.
- Accepted reviewer feedback to rename the setting from OpenAI-specific copy to
  neutral agent copy.
- Scoped reviewer feedback about API fallback into a documented non-goal instead
  of adding another picker.

## Rollout

Push to `master`. No data migration is required because settings are sanitized
when read and updated.
