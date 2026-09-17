# Writing autocomplete: findings and design

Reviewed 16 September 2026. Competitor findings are from public product documentation, not hands-on account testing. Local behavior was traced through the editor extension, context builder, IPC, and AgentService.

## What matters to a writer

A useful completion should preserve the writer's intent, voice, and momentum. Length is one dimension; accepting only the useful part matters just as much. Default to a small suggestion. Make larger continuations explicit and predictable. A paragraph should develop the current thought, not unexpectedly introduce a character or claim.

## Prior behavior and problems

- Automatic requests waited 900 ms before any provider work started.
- Automatic output asked for 3–15 words. Cmd/Ctrl+Enter and Ctrl+Space selected short output or a new paragraph based on punctuation, so the same key changed meaning.
- Every edit cleared the ghost and canceled a pending request, including typing words already in the displayed suggestion. Acceptance was all-or-nothing.
- Codex was preferred, with a fresh text-run/thread lifecycle; an explicitly enabled OpenAI API was the fallback. Neither path used Gemini.
- Provider output was accumulated before delivery to the renderer. It is still delivered as one finished suggestion in this pass.
- The renderer allowed 1,200 suffix characters, while IPC rejected more than 1,000. Completions inside longer sections could fail before reaching a model.
- An old rejected promise could apply a cooldown after cancellation. A pending debounce could also survive navigation or composition. Repeated dismissals paused even explicit manual requests.
- The model sees up to 2,500 preceding characters, 1,000 following characters, the title, heading path, and nearby headings. This is useful local context but not a novel's story memory.

## Comparable products

| Product | Documented behavior | Useful lesson for Iliad |
| --- | --- | --- |
| [HyperWrite TypeAhead](https://www.hyperwriteai.com/blog/typeahead-ai) | Inline suggestions; Tab accepts all, right arrow accepts words, Alt+up/down offers alternatives. | Partial acceptance gives writers control without another model call. Use a modified arrow in Iliad to preserve ordinary cursor movement. |
| [Sudowrite Write](https://docs.sudowrite.com/using-sudowrite/1ow1qkGqof9rtcyGnrWUBS/write/6JmxspPSKDf6y7K5PVBZxa) | Auto and guided continuation, configurable output length, creativity, multiple variants, and contextual details. | Separate automatic continuation from intentional expansion; direction can matter more than length. Avoid copying a large card interface into inline completion. |
| [Sudowrite POV and tense](https://docs.sudowrite.com/using-sudowrite/1ow1qkGqof9rtcyGnrWUBS/setting-pov-and-tense/5gKBNzBQLB7C8yuBhHQ983) | Project or chapter settings control narrative perspective and tense. | Match local voice now; consider explicit document-level writing guidance later. |
| [Novelcrafter Codex](https://www.novelcrafter.com/features/codex) | Organizes characters, locations, story knowledge, and changes across the story. | Long-form usefulness requires selected story facts beyond the immediately preceding paragraph. |
| [Lex](https://lex.page/) | Editing commands, feedback, idea generation, and alternative versions within documents. | Give a writer specific actions such as finding a word or making a point concrete, without requiring a chat detour. |

## Implemented first pass

| Action | Shortcut / behavior |
| --- | --- |
| Short phrase | Ctrl+Space; also automatic after a 450 ms pause at a word boundary |
| Finish this sentence / suggest one next sentence | Cmd/Ctrl+Enter |
| Continue for a paragraph | Cmd/Ctrl+Shift+Enter; finishes an incomplete sentence in place, starts a new paragraph at a completed boundary |
| Accept all visible text | Tab |
| Accept one word, keeping the rest visible | Option/Alt+Right |
| Cancel pending or visible suggestion | Escape |
| Request another possibility | Repeat the desired length shortcut |

Typing the displayed suggestion retains its remainder, avoiding another request. Moving the cursor, making different edits, changing focus, or starting IME composition invalidates it. Explicit manual requests remain available after the automatic pause caused by repeated dismissals. Provider rate-limit cooldowns still apply to all requests. Acceptance uses a separate undo group.

Instructions now ask for continuity of language, viewpoint, tense, rhythm, and formality; discourage invented facts, citations, and names; and explicitly tell the model to fit the following text. This is guidance, not a factuality guarantee. Lengths are prompt targets with defensive character limits, not guaranteed exact word counts.

## Gemini route and speed

[Google documents `gemini-3.8-flash`](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash) as available. It supports low, medium, and high thinking; **minimal is unsupported**. Use low for autocomplete. The [Generate Content API documentation](https://ai.google.dev/gemini-api/docs/generate-content/thinking) describes the direct text endpoint and filtering thought parts from user-facing output.

Saving a Gemini API key in assistant settings makes this the primary autocomplete route. Development can use GEMINI_API_KEY or GOOGLE_API_KEY. No Codex status probe, agent tools, filesystem workspace creation, or chat history is needed on this path. Existing Codex/OpenAI behavior remains available when there is no Gemini key. A configured Gemini failure is surfaced rather than silently switching providers. The main chat model is independent.

The generation token allowance includes room for thinking, while prompt instructions and the shared output cleaner limit displayed prose. A tiny 48-token total budget would risk exhausting the output budget before producing a suggestion. Incomplete or blocked responses are discarded.

The fixed pre-request pause is reduced by 450 ms. Direct model latency and perceived typing speed have **not been benchmarked**: this environment has no configured Gemini key. Do not claim that Flash is faster than the previous provider from its name alone. Provider completion duration and output size are logged without document text or keys to support later measurement.

## Recommended next iterations

1. **Intent controls:** a small optional continuation prompt: “give an example”, “bridge to the next idea”, “make the scene more tense”. Offer these on demand, especially for paragraphs. Generic expansion often adds words without advancing the draft.
2. **Relevant writing memory:** opt-in document guidance for audience, tone, tense, and a short set of facts or character constraints. Retrieve only relevant facts for each completion; avoid sending the entire workspace on every pause.
3. **Alternatives without waiting:** cache a small number of alternatives only when explicitly requested. Cycle them locally; do not generate three candidates on every keystroke.
4. **Streaming at stable boundaries:** show a short phrase after a complete word, then extend it. Keep acceptance tied to the exact displayed text and cancel safely. Avoid rapidly changing prose under the cursor. This requires a streaming IPC contract and tests for acceptance during generation.
5. **Quiet mode and accessibility:** manual-only mode, an explicit snooze control, remappable shortcuts (Ctrl+Space can belong to the OS), and an opt-in screen-reader announcement for suggestions. The present ghost is aria-hidden, an existing accessibility limitation.
6. **Evaluate actual writing:** compare Flash and the existing provider on English and Spanish fiction, essays, dialogue, and middle-of-paragraph edits. Measure pause-to-visible p50/p95, acceptance and partial acceptance, timeouts, and immediate undo. Target under a second for short suggestions as a product goal, not an observed result. Keep document contents out of diagnostics.

Avoid automatic paragraphs, repeated unrequested retries, animated word-by-word “thinking” displays, and suggestions that repeatedly restate the previous sentence. Those can make the feature busier while reducing the writer's control.
