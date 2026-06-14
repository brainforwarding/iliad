# Agent Provider Contract

Date: 2026-06-14

## Sources

- OpenAI Codex Models: `https://developers.openai.com/codex/models`
- OpenAI Codex Config Reference: `https://developers.openai.com/codex/config-reference`
- OpenAI Codex App Server: `https://developers.openai.com/codex/app-server`
- Local runtime catalog checked with `codex debug models` on 2026-06-14.

## Regular Agent Chat And Edits

Runtime selection is provider-first:

1. If Codex app-server is available and connected, use `codex-app-server`.
2. Otherwise, if an OpenAI API key is available, use `openai-api`.
3. Otherwise, prompt the user to connect Codex or add an API key.

The visible regular-chat model selector must include only models that work on both regular provider paths:

- `gpt-5.5`
- `gpt-5.4`
- `gpt-5.4-mini`

Do not include deprecated ChatGPT-sign-in Codex models (`gpt-5.2`, `gpt-5.3-codex`) in regular settings.
Do not include Codex-only preview models (`gpt-5.3-codex-spark`) in the regular selector unless the UI becomes provider-aware.

Mode maps to reasoning effort:

- Fast -> `low`
- Balanced -> `medium`
- Deep -> `high`

Codex app-server regular runs:

- `thread/start`: selected model, `sandbox` `workspace-write` for desktop and `read-only` for remote read-only, `approvalPolicy` `on-request` for desktop and `never` for remote read-only.
- `turn/start`: `effort` from mode mapping, `summary: "concise"`.

OpenAI Responses regular runs:

- Endpoint: `POST https://api.openai.com/v1/responses`
- `model`: selected model.
- `reasoning.effort`: from mode mapping when reasoning is enabled.
- `reasoning.summary: "auto"` when reasoning is enabled.
- `text.verbosity: "low"` when supported.
- Markdown document tools are sent only for desktop-capable runs; remote read-only excludes UI-open tools.

If OpenAI rejects optional request features such as reasoning summaries, verbosity, or tool parameters, the OpenAI provider may retry with narrower options. Codex app-server runs should not use `minimal` effort while app-server tools are attached.

## Idea Autocomplete

Autocomplete has a separate model policy because it is latency-sensitive and single-shot text-only.

Autocomplete request modes:

- Automatic inline: triggered only after meaningful text edits. Uses short inline continuation.
- Manual inline: triggered by `Mod-Enter` away from a natural paragraph boundary. Uses short inline continuation.
- Manual paragraph: triggered by `Mod-Enter` at a natural paragraph boundary. Uses one short next paragraph.

Codex path:

- Try `gpt-5.4-mini` first.
- Then try `gpt-5.3-codex-spark` only through Codex if it is available.
- `turn/start`: `effort: "low"`, `summary: "concise"`.
- Max output: 48 tokens for inline, 140 tokens for manual paragraph.

OpenAI API fallback path:

- Used only when the user enables API fallback and an API key is available.
- Model: `gpt-5.4-mini`.
- Endpoint: `POST https://api.openai.com/v1/responses`.
- `reasoning.effort: "low"`.
- No tools.

Do not use `reasoning.effort: "minimal"` for Codex app-server autocomplete unless the app-server request is proven tool-free and the selected model advertises support for it.

## Other Agent Tasks

Chat title generation:

- Uses the regular runtime selection.
- Uses the saved regular model.
- Uses Fast mode.

Conversation compaction:

- Uses the regular runtime selection.
- Uses the saved regular model.
- Uses Fast mode.
- Uses remote-read-only profile.

Dictation:

- API only.
- Model: `gpt-4o-mini-transcribe`.
- Does not use Codex subscription billing.

## Settings UX

- Model and mode changes save immediately.
- API keys require an explicit "Save key" action after the user types a key.
- Do not show a persistent "Save settings" button when there are no unsaved settings.
