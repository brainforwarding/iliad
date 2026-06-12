# Agent Dictation Spec

Date: 2026-05-23
Status: implemented

## Product Intent

Add a small microphone control next to the chat submit button. The user presses
it, dictates a message, stops recording, and Iliad transcribes the completed
audio into the existing chat input. This is not a realtime voice assistant and
does not send the message automatically.

The feature should feel like a quieter alternative to typing. It should not add
a large modal, waveform-heavy UI, or voice conversation surface.

## Source Material

OpenAI documentation:

- Speech-to-text guide:
  <https://developers.openai.com/api/docs/guides/speech-to-text>
- Audio transcription API reference:
  <https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create>
- `gpt-4o-transcribe` model page:
  <https://developers.openai.com/api/docs/models/gpt-4o-transcribe>

Relevant current docs findings:

- The transcription endpoint accepts uploaded audio files and returns text.
- Supported transcription models include `gpt-4o-transcribe`,
  `gpt-4o-mini-transcribe`, `gpt-4o-mini-transcribe-2025-12-15`,
  `whisper-1`, and `gpt-4o-transcribe-diarize`.
- `gpt-4o-transcribe` is described as more accurate than the original Whisper
  models, with better language recognition.
- Upload formats include `flac`, `mp3`, `mp4`, `mpeg`, `mpga`, `m4a`, `ogg`,
  `wav`, and `webm`.
- The docs list a 25 MB upload limit for audio files.

## Current State

The assistant composer is text-only:

- `AssistantPanel` owns the input value in `prompt`.
- Enter sends; Shift+Enter adds a newline.
- The send/stop button is the only composer action.
- Electron stores the OpenAI API key locally through `AgentSettingsStore`.
- There is no media permission flow or audio IPC surface.

## Goals

- Add push-to-dictate transcription into the existing assistant composer.
- Insert transcribed text into the composer without sending it.
- Keep the UI minimal: one microphone icon beside send/stop.
- Use the existing locally stored OpenAI API key.
- Prefer `gpt-4o-mini-transcribe` for v1 default to control cost/latency.
- Allow future settings to switch to `gpt-4o-transcribe` for higher accuracy.
- Let the transcription model auto-detect language in v1.
- Show compact recording/transcribing/error states.
- Keep audio transient; do not persist recordings.

## Non-Goals

- No realtime voice chat.
- No streaming partial transcription in v1.
- No voice activity detection UI.
- No diarization.
- No audio history.
- No automatic message send after transcription.
- No custom vocabulary UI in v1.

## UX

Composer states:

- Idle: send button and microphone button are visible.
- Recording: microphone changes from `Mic` to `Square`/`StopCircle`; send is
  disabled with tooltip `Stop recording before sending`.
- Transcribing: microphone shows a compact disabled progress state; send stays
  disabled until insertion finishes.
- Error: show a compact composer-adjacent error, not a chat transcript entry.

Button placement:

- Put the microphone to the left of the send button.
- Keep the current bottom-right composer alignment.
- Use the same icon-button dimensions and restrained styling as the send/stop
  button.
- Use a 4-8 px gap between mic and send controls.

Text insertion:

- If the composer is empty, set it to the transcript.
- Capture the textarea selection when recording starts or stops.
- Insert the transcript at that captured selection if the prompt has not been
  cleared. Otherwise append to the current prompt.
- Add one separating space only when adjacent characters require it.
- Preserve focus in the composer after transcription.
- Allow typing while transcription is in flight, but never overwrite edits made
  while transcribing.
- Do not submit automatically.

Copy:

- English labels: `Dictate`, `Stop recording`, `Transcribing`,
  `Could not transcribe`.
- Spanish labels: `Dictar`, `Detener grabación`, `Transcribiendo`,
  `No se pudo transcribir`.
- Recoverable errors:
  - `Microphone access denied`
  - `No speech detected`
  - `Recording too long`
  - `Add an OpenAI API key to dictate`
- Spanish recoverable errors:
  - `No se permitió usar el micrófono`
  - `No se detectó voz`
  - `La grabación es demasiado larga`
  - `Agrega una clave API de OpenAI para dictar`

Accessibility:

- Every icon-only state needs an `aria-label`.
- Status/error copy should use `aria-live="polite"`.
- Keyboard activation must work on the microphone control.
- `Esc` cancels an active recording and discards buffered audio.
- Do not rely on motion-only recording indicators.

## Browser And Electron Design

Renderer:

- Use `navigator.mediaDevices.getUserMedia({ audio: true })`.
- Use `MediaRecorder` to collect a completed recording.
- Use `MediaRecorder.isTypeSupported` and choose from an allowlist, preferring
  `audio/webm`.
- Collect chunks with a timeslice and count bytes as chunks arrive.
- Stop immediately when duration or byte caps are exceeded.
- Handle `MediaRecorder.onerror`, `track.onended`, empty chunks, and device
  unplug.
- Stop all media tracks after stop/cancel/error in a `finally` path.
- Convert the recording to an `ArrayBuffer` and send it through IPC.
- Use a per-recording `requestId`.
- Ignore stale transcription responses after cancel or a newer recording.
- Enforce a local duration cap before sending. Recommended v1 cap: 45 seconds.
- Enforce a local size cap below the API limit. Recommended v1 cap: 24 MB.
- Guard double start/stop/cancel.

Electron packaging and permissions:

- Add packaged-app microphone permission metadata, including macOS
  `NSMicrophoneUsageDescription`.
- On macOS, preflight with Electron media access APIs where practical and
  handle denied/restricted states clearly.
- If permission changes require app restart, show a concise message.

Electron:

- Add `agent:transcribe-audio` IPC.
- Keep OpenAI API key usage in Electron, not the renderer.
- Accept:
  - `requestId`;
  - audio bytes;
  - MIME type;
  - optional explicit dictation language, when a future UI adds it.
- Validate runtime shape before reading the API key.
- Validate sender/window where practical.
- Allowlist MIME types and derive the filename extension from the MIME type.
- Enforce byte caps again in the main process.
- Reject unsupported MIME, oversize, empty, or malformed requests.
- Build a `FormData` request to `https://api.openai.com/v1/audio/transcriptions`.
- Use model `gpt-4o-mini-transcribe` by default.
- Return `{ text }` or normalized `AgentError`.

## Provider Behavior

Recommended v1 request:

```ts
const form = new FormData();
form.set("file", new Blob([audio], { type: mimeType }), filenameForMimeType(mimeType));
form.set("model", "gpt-4o-mini-transcribe");
```

Notes:

- The docs say `gpt-4o-transcribe` and `gpt-4o-mini-transcribe` currently
  support `json` response format for transcription. Use JSON and read `text`.
- Omit `language` in v1 so the model can auto-detect mixed English/Spanish
  dictation. Only set `language` if a future explicit dictation-language
  control exists.
- Do not add timestamps, diarization, chunking, logprobs, prompts, or streaming
  in v1.
- Do not use `whisper-1` as the default unless newer models are unavailable.
- Do not use `gpt-4o-transcribe-diarize`; this is single-speaker composer
  dictation, not meeting transcription.

Fallback:

- No model fallback in v1. If the transcription model is rejected or
  unavailable, show a normalized provider/model error.

## Privacy And Security

- Audio is sent to OpenAI for transcription.
- Audio should never be written to disk by Iliad.
- Do not include audio or transcript in future agent context until the user
  explicitly sends the message.
- Do not log audio bytes or raw provider payloads.
- Release microphone tracks after every stop/cancel/error.
- Validate MIME, byte size, and request shape in Electron before using the
  stored API key.
- If the OS denies microphone permission, show a short recoverable error.

## Failure States

- Missing API key: open settings or show the existing missing-key behavior.
- Permission denied: show a microphone permission message.
- No speech/empty transcript: leave composer unchanged.
- File too large or too long: stop recording and show a concise error.
- Network/provider failure: show normalized transcription error.
- Cancellation: discard the current audio buffer.
- Stale response: ignore it and do not insert text.

## Tests

Local checks:

- `npm run typecheck`
- `npm run build`
- `npm run smoke:review`
- `git diff --check`

Focused tests:

- MediaRecorder unsupported state disables microphone gracefully.
- Starting/stopping recording releases tracks.
- MediaRecorder errors release tracks and clear recording state.
- Empty chunks/empty transcript leave the composer unchanged.
- Oversize or over-duration recording stops immediately.
- Main-process IPC rejects invalid MIME and oversized requests.
- Main-process IPC validates request shape before using the API key.
- OpenAI request uses the derived filename extension.
- OpenAI request omits `language` by default.
- Transcription response inserts text without submitting.
- Existing composer text is preserved and appended to.
- Typing while transcription is in flight is not overwritten.
- Stale response after cancel/new recording is ignored.
- Missing API key shows the correct settings/error state.
- Failed transcription leaves existing prompt unchanged.
- Transcribed text is not included in agent messages until the user sends.

Manual checks:

- Record a short Spanish phrase and confirm it appears in the composer.
- Record a short English phrase and confirm it appears in the composer.
- Cancel midway and confirm no text is inserted.
- Send after transcription and confirm normal agent flow still works.
- Confirm packaged macOS microphone permission copy appears correctly.

## Rollout

Ship as part of the existing local Electron app. No database or cloud migration
is needed. The feature should be disabled when there is no microphone support
or when the app cannot obtain microphone permission.

## Open Questions

- Should dictation have its own model setting, or should v1 use a fixed model?
- Should the microphone button remain visible when no API key is saved?
- Should a future version expose explicit dictation language?
- Is 45 seconds the right v1 cap for a composer-only dictation feature?
