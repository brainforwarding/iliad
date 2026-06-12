# Model/provider comparison for an Iliad agent panel

Date: 2026-05-22

Status: research snapshot. For current product direction, provider split, and
model/runtime sequencing, use [`../agent-vision.md`](../agent-vision.md) and
[`../agent-runtime-roadmap.md`](../agent-runtime-roadmap.md). This document
should not be treated as the active roadmap.

Scope: current viable hosted and local model providers for a Cursor-like agent panel in an Electron/React app. The focus is agent runtime fit: tool-calling reliability, context windows, latency, cost, streaming, structured outputs, multi-agent orchestration, and API ergonomics.

## Executive recommendation

Use a provider-neutral agent adapter, but ship v1 with OpenAI as the default primary provider, Anthropic Claude as the premium/high-autonomy provider, Gemini as the low-cost long-context and fallback hosted provider, and Ollama/OpenAI-compatible local endpoints as an opt-in offline/privacy fallback.

For v1, the most pragmatic default stack is:

| Role | Recommended model/provider | Why |
| --- | --- | --- |
| Default agent model | OpenAI GPT-5 mini for v1, GPT-5.2 where cost/latency allow | Best balance of first-party agent API ergonomics, structured outputs, function calling, streaming, large context, and predictable integration surface. |
| Higher-autonomy coding/reasoning | Claude Sonnet 4.6, with Opus 4.7 for expensive hard tasks | Claude's latest docs position Opus 4.7 for complex reasoning and agentic coding, Sonnet 4.6 as the speed/intelligence balance, both with 1M context. |
| Low-cost/high-volume summarization and repo indexing | Gemini 3.5 Flash where Google provider support is enabled | Strong speed/capability fit for agentic and coding workflows; keep provider-conformance tests because Iliad's harness is custom. |
| Local/private fallback | Ollama with a strong local coding model exposed through OpenAI-compatible `/v1/chat/completions` or `/v1/responses` | Good for offline/privacy mode and demos, but weaker reliability and model-dependent context/tool behavior means it should not be the default autonomous agent path. |

Do not hard-code one provider's event format into the UI. Normalize all model calls into an internal stream of `assistant_text_delta`, `tool_call_delta`, `tool_call`, `tool_result`, `structured_result`, `usage`, and `error` events.

## Provider snapshots

### OpenAI

Current relevant models:

| Model family | Agent-panel fit | Context/output | Pricing signal | API notes |
| --- | --- | --- | --- | --- |
| GPT-5.2 | Best OpenAI default for harder agentic/coding work when cost and latency are acceptable. | 400,000 context, 128,000 max output. | Higher-cost flagship tier. | Supports Responses API, streaming, function calling, structured outputs, image input, and built-in tools where enabled. |
| GPT-5.2 pro | Premium hard-thinking option for difficult synthesis. | Same family; intended for harder tasks that can take longer. | Premium tier. | Use selectively for expensive, high-value work. |
| GPT-5 mini/nano or GPT-4.1 mini/nano | Fast/cheap helper agents: title generation, command classification, summarization, routing. | Varies by model; GPT-5 mini is documented for cost-optimized reasoning/chat. | Mini/nano tiers are cheaper in the pricing selector. | Recent GPT families support the Responses API and the capabilities needed for v1 text/edit workflows. |

Strengths:

- Best first-party API ergonomics for an app that needs typed tool calls, streaming, structured results, and eventual hosted tools.
- Responses API gives a single modern surface for text, tools, structured output, and built-in tools.
- Official docs list function calling, structured outputs, streaming, image input, and Responses API support for current GPT-5-family models.
- Built-in tools listed for recent GPT models include web search, file search, image generation, code interpreter, and MCP where supported.
- Pricing page includes service tiers such as Batch, Priority, and Flex; Batch gives a 50% discount for asynchronous work.

Risks:

- Reasoning models charge output tokens including hidden/visible reasoning tokens, so autonomous loops can become expensive if not capped.
- The latest model line changes quickly. Use pinned snapshots where stability matters, and expose a remotely configurable model registry.
- Deep tool loops need strict budgets and telemetry; the API will reliably emit tool calls, but application-side execution and recovery remain Iliad's responsibility.

Official sources:

- OpenAI model comparison: https://developers.openai.com/api/docs/models/compare
- GPT-4.1 model page: https://developers.openai.com/api/docs/models/gpt-4.1
- OpenAI API pricing: https://openai.com/api/pricing/

### Anthropic Claude

Current relevant models:

| Model | Agent-panel fit | Context/output | Pricing signal | API notes |
| --- | --- | --- | --- | --- |
| Claude Opus 4.7 | Premium hard-task and agentic coding model. | 1M context. | $5 input / $25 output per 1M tokens. | Most capable generally available model for complex reasoning and agentic coding, moderate latency. |
| Claude Sonnet 4.6 | Strong default alternative to OpenAI for coding agents. | 1M context. | $3 input / $15 output per 1M tokens. | Best combination of speed and intelligence, fast latency. |
| Claude Haiku 4.5 | Fast helper/utility model. | 200k context. | $1 input / $5 output per 1M tokens. | Fastest current Claude model with near-frontier intelligence. |

Strengths:

- Claude's model docs explicitly position Opus 4.7 for complex reasoning and agentic coding, and Sonnet 4.6 for speed/intelligence balance.
- First-party tool-use docs describe a clear agent loop: Claude emits `tool_use`, the app runs the tool, then returns `tool_result`.
- Structured outputs are generally available for current Claude API models including Opus 4.7, Opus 4.6, Sonnet 4.6, Sonnet 4.5, Opus 4.5, and Haiku 4.5.
- Strict tool use can enforce schema validation for tool names and inputs.
- Streaming is mature via SSE and SDKs; tool-use streaming is supported, including fine-grained tool input streaming for latency-sensitive cases.
- Prompt caching can materially lower cost and latency for repeated project context; cache hits are 10% of standard input price.

Risks:

- Tool calling is reliable but more visibly "bring your own loop" than OpenAI's Responses surface; Iliad needs a robust execution loop, retries, and UI state reconciliation.
- Fine-grained tool streaming can emit partial or invalid JSON during the stream; only treat final tool calls as executable unless the tool is explicitly designed for partial data.
- Some fast-mode and data-residency choices apply price multipliers.

Official sources:

- Claude models overview: https://platform.claude.com/docs/en/about-claude/models/overview
- Claude pricing: https://platform.claude.com/docs/en/about-claude/pricing
- Claude tool use: https://platform.claude.com/docs/en/tool-use
- Claude structured outputs: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- Claude streaming: https://platform.claude.com/docs/en/api/messages-streaming

### Google Gemini

Current relevant models:

| Model | Agent-panel fit | Context/output | Pricing signal | API notes |
| --- | --- | --- | --- | --- |
| Gemini 3.5 Flash | Fast frontier option for agentic/coding workflows and subagents. | Long-context Flash family; verify exact per-model limits in Gemini API metadata. | Google positions Flash as lower-compute and faster than larger frontier models. | Generally available via Antigravity and Gemini API; supports Google agent/runtime ecosystem features. |
| Gemini 3 Flash | Older fast frontier option where 3.5 is unavailable. | 1,048,576 input, 65,536 output in API docs for preview. | Lower-cost Flash tier. | Useful fallback, but prefer 3.5 where available. |
| Gemini 2.5 Flash / Flash-Lite | Stable cheap helper/fallback line where newer Flash models are unavailable. | Large-context family, optimized for low latency and cost. | Very low cost helper tier. | Best for summarization, lightweight classification, and high-throughput background work. |
| Gemini 2.5 Pro | Harder reasoning/coding fallback when Google ecosystem is preferred. | 1M-class context. | Higher cost than Flash; pricing has prompt-length tiers. | Better for complex coding/reasoning than older Flash lines, but less cost-attractive for v1 default. |

Strengths:

- Gemini has compelling context/cost ratios, especially Flash and Flash-Lite.
- Google announced Gemini 3.5 Flash on May 19, 2026 as generally available through Antigravity, the Gemini API in Google AI Studio, Android Studio, Gemini Enterprise Agent Platform, and Gemini Enterprise.
- Google describes the Antigravity agent harness and Gemini 3.5 Flash as co-optimized for fast agentic work at scale.
- Official function-calling and structured-output docs should still be used as conformance gates because model/runtime capabilities move quickly.
- Built-in grounding/search, URL context, file search, code execution, and Google ecosystem integrations are useful for research-heavy agent tasks.

Risks:

- Gemini 3 Flash is preview, so v1 should not depend on it for deterministic production behavior.
- Google's function-calling docs explicitly tell implementers to check `finishReason` for cases where a valid function call was not generated. Treat this as a signal that robust fallback parsing/retry logic is required.
- Structured outputs use a subset of JSON Schema, so shared schemas need a provider compatibility layer.
- Search grounding can bill per underlying search query; app-level budgets must account for one user request causing multiple search queries.

Official sources:

- Gemini models: https://ai.google.dev/gemini-api/docs/models
- Gemini pricing: https://ai.google.dev/gemini-api/docs/pricing
- Gemini function calling: https://ai.google.dev/gemini-api/docs/function-calling
- Gemini structured outputs: https://ai.google.dev/gemini-api/docs/structured-output

### Open/local fallback

Recommended local path:

| Provider/runtime | Agent-panel fit | Context/tool notes | Cost | API notes |
| --- | --- | --- | --- | --- |
| Ollama | Opt-in local/offline/privacy mode, not the v1 default autonomous agent. | Model-dependent; context size can be changed with a Modelfile `PARAMETER num_ctx`. | No hosted token cost; user pays local hardware/performance cost. | OpenAI-compatible Chat Completions and Responses API support. Responses support is non-stateful. |
| LM Studio / other OpenAI-compatible local servers | Similar role to Ollama. | Model- and server-dependent. | Local hardware cost. | Useful if hidden behind the same OpenAI-compatible adapter, but verify tool-call semantics per runtime. |
| Hosted open models through OpenRouter/Together/Fireworks/etc. | Optional future marketplace-like provider layer. | Depends heavily on model and provider. | Often cheaper than frontier models. | Good later, but it broadens support burden for v1. |

Strengths:

- Local mode is valuable for privacy-sensitive project context and offline demos.
- Ollama officially supports OpenAI-compatible endpoints and the OpenAI Responses API, including streaming and tools/function calling on `/v1/responses`.
- A local provider exercises the provider abstraction and avoids a single-vendor architecture.

Risks:

- Tool-call reliability is model-dependent and generally below the top hosted models.
- OpenAI-compatible does not mean behavior-compatible. Streaming event shapes, tool arguments, refusal behavior, context limits, and structured output guarantees need runtime-specific tests.
- Ollama's Responses API support is documented as non-stateful; Iliad must own conversation state.

Official sources:

- Ollama API introduction: https://docs.ollama.com/api/introduction
- Ollama OpenAI compatibility: https://docs.ollama.com/api/openai-compatibility

## Recommendation matrix

Scores: 5 = best fit for Iliad v1, 1 = poor fit. Scores combine official capabilities with implementation risk for a desktop coding-agent panel.

| Provider/model | Tool calling reliability | Context | Latency | Cost | Streaming | Structured outputs | Multi-agent fit | API ergonomics | Overall v1 role |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| OpenAI GPT-5.2 | 5 | 5 | 4 | 3 | 5 | 5 | 5 | 5 | Primary high-quality default where cost allows. |
| OpenAI GPT-5 mini | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | Pragmatic Iliad v1 default for cost/speed. |
| OpenAI mini/nano helpers | 4 | 4 | 5 | 5 | 5 | 5 | 5 | 5 | Cheap router/summarizer/critic agents. |
| Claude Opus 4.7 | 5 | 5 | 3 | 3 | 5 | 5 | 5 | 4 | Premium hard coding/reasoning. |
| Claude Sonnet 4.6 | 5 | 5 | 4 | 4 | 5 | 5 | 5 | 4 | Strong alternate primary agent. |
| Claude Haiku 4.5 | 4 | 3 | 5 | 4 | 5 | 5 | 4 | 4 | Fast helper model. |
| Gemini 3.5 Flash | 4 | 5 | 5 | 5 | 4 | 4 | 5 | 4 | Strong fast agent/subagent option after conformance tests. |
| Gemini 3 Flash | 4 | 5 | 5 | 5 | 4 | 4 | 4 | 4 | Older fast hosted option where 3.5 is unavailable. |
| Gemini 2.5 Flash / Flash-Lite | 3 | 5 | 5 | 5 | 4 | 4 | 4 | 4 | Background summarization and cheap fallback. |
| Ollama/local | 2 | 2-4 | 2-5 | 5 | 3 | 2-4 | 3 | 4 | Opt-in local/privacy fallback. |

## Tool-calling and structured-output design notes

Build a provider-neutral tool contract:

- Define Iliad tools once as JSON Schema plus TypeScript runtime validators.
- Compile provider-specific tool definitions for OpenAI, Claude, Gemini, and local OpenAI-compatible runtimes.
- Treat tool calls as proposals until validated locally.
- Enforce per-turn and per-task budgets: max tool calls, max shell commands, max file edits, max tokens, max wall time.
- Log the original provider event stream and the normalized event stream for debugging.
- Use structured outputs for final agent decisions where UI state depends on exact fields: plan updates, patch summaries, approval requests, diagnostics, and task completion status.

Provider-specific cautions:

- OpenAI: use Responses API as the primary integration target; keep Chat Completions support only if needed for compatibility.
- Claude: support explicit `tool_use` / `tool_result` loops; do not execute partial fine-grained streamed JSON.
- Gemini: always inspect `finishReason`; implement retry-on-invalid-tool-call with lower temperature and stricter prompt/tool schema.
- Ollama/local: feature-detect tool and structured output behavior per selected model, not just per runtime.

## Latency and cost implications

For an Electron/React agent panel, perceived latency matters more than total turn time. Prioritize streaming text and tool progress immediately, even when the full agent loop takes longer.

Recommended latency strategy:

- Use fast helper models for routing, intent classification, file selection, and summaries.
- Use a stronger model only for the main planning/editing turn.
- Stream model text and tool-call deltas into the panel.
- Run independent read-only context-gathering tools concurrently before invoking the main model.
- Cache repo summaries and project instructions aggressively.

Recommended cost controls:

- Default to one main model call per user turn plus bounded tool loops.
- Use cheaper helper models for background summarization.
- Use prompt caching where available for stable project context.
- Avoid sending whole files repeatedly; send symbol- or hunk-level context where possible.
- Put search/code-execution/grounding behind explicit budget counters because provider tools can add non-token charges.

## Implications for Iliad v1

1. Build a model registry, not a model enum.

   Store provider, model ID, display name, stability level, context window, max output, supports tools, supports structured output, supports images, supports prompt caching, default temperature, and cost metadata in remote-configurable data.

2. Use OpenAI-compatible abstractions only at the edge.

   OpenAI compatibility is useful for local providers, but Claude and Gemini have distinct concepts that should not be forced through a leaky OpenAI-only interface. Internally normalize events and tool calls instead.

3. Make provider choice visible but not central.

   The v1 UI should expose simple hosted modes: `Fast`, `Balanced`, and `Deep`. Map those to prompt/model choices through config. Advanced users can override model IDs later; local/offline providers should be a later explicit capability because they need separate warnings.

4. Treat all tool calls as untrusted input.

   The model should never directly mutate files or run commands. Iliad should validate schemas, render proposed actions, apply workspace policy, then execute through controlled app services.

5. Support resumable agent state in Iliad, not in the provider.

   Some APIs support server-side state and some do not. Persist normalized conversation turns, tool calls, tool results, file snapshots, and budgets locally so a task can resume across app restarts and provider swaps.

6. Design for multi-agent orchestration from day one, but keep v1 orchestration small.

   A practical v1 can use three roles: `router`, `worker`, and `critic`. The router should be cheap/fast, the worker should use the selected main model, and the critic can be a smaller model for linting plans, checking structured outputs, and summarizing diffs.

7. Add provider conformance tests.

   Before exposing a provider as production-ready, run a small suite: single tool call, parallel/multiple tool calls, invalid tool args recovery, structured output schema conformance, long-context retrieval, streaming interruption, cancellation, and usage accounting.

8. Plan for preview churn.

   Rapidly moving Gemini and GPT aliases are useful, but v1 should prefer stable aliases/snapshots for defaults. Preview models can live behind an `experimental` flag.

## Proposed v1 defaults

| Iliad mode | Primary | Fallback | Notes |
| --- | --- | --- | --- |
| Fast | Gemini 3.5 Flash or OpenAI GPT-5 mini/nano | Claude Haiku 4.5 | Short summaries, routing, labels, low-risk transformations. |
| Balanced | OpenAI GPT-5 mini for v1, GPT-5.2 when cost allows | Claude Sonnet 4.6 | Default assistant mode. |
| Deep | OpenAI GPT-5.2 pro or Claude Opus 4.7 | Claude Sonnet 4.6 | Complex edits, architecture, hard debugging. |

## Sources

- OpenAI latest model guide: https://platform.openai.com/docs/guides/latest-model
- OpenAI models catalog: https://platform.openai.com/docs/models
- OpenAI GPT-5 mini model details: https://platform.openai.com/docs/models/gpt-5-mini
- OpenAI API pricing: https://platform.openai.com/docs/pricing
- Claude models overview: https://platform.claude.com/docs/en/about-claude/models/overview
- Claude pricing: https://platform.claude.com/docs/en/about-claude/pricing
- Claude tool use: https://platform.claude.com/docs/en/tool-use
- Claude structured outputs: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- Claude streaming: https://platform.claude.com/docs/en/api/messages-streaming
- Gemini models: https://ai.google.dev/gemini-api/docs/models
- Gemini 3.5 Flash announcement: https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-5/
- Gemini 3.5 Flash in Antigravity: https://www.antigravity.google/blog/gemini-3-5-flash-in-google-antigravity
- Gemini pricing: https://ai.google.dev/gemini-api/docs/pricing
- Gemini function calling: https://ai.google.dev/gemini-api/docs/function-calling
- Gemini structured outputs: https://ai.google.dev/gemini-api/docs/structured-output
- Ollama API introduction: https://docs.ollama.com/api/introduction
- Ollama OpenAI compatibility: https://docs.ollama.com/api/openai-compatibility
