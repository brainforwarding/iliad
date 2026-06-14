# Handoff: route "Tighten" through the same runtime as chat (Codex-first, OpenAI API fallback)

Date: 2026-06-13
Status: investigation handoff — needs a design before implementation
Scope: **the Tighten feature only.** Do not touch the chat agent's behavior; mirror it.

## The ask (one sentence)

Tighten currently calls the OpenAI platform API directly; make it use the **same
runtime the chat agent uses** — the connected **Codex/ChatGPT subscription first
if available, the OpenAI API key as fallback** — so a Codex user's Tighten bills
and runs exactly where their chat does.

## Context: Iliad has two agent runtimes

Iliad is a local-first Markdown editor (Electron main + preload + React/CodeMirror
renderer; strict IPC contract; "source-as-contract": the on-disk `.md` is the
contract, changes are review-first/accept-reject). The agent abstracts over **two
runtime providers** behind one interface:

- `codex-app-server` — the user's Codex/ChatGPT **account** (billing: `codex_account`).
- `openai-api` — the OpenAI **platform API key** (billing: `openai_platform_api`).

The chat agent chooses between them per run in `AgentService.selectRuntimeProvider`
(`electron/agent/agentService.ts:809`) — **Codex wins when connected**, OpenAI is
the fallback, else "missing API key":

```ts
private async selectRuntimeProvider(model: string): Promise<AgentRuntimeProviderSelection> {
  const codexStatus = await this.codexStatus().catch(() => null);
  if (codexStatus?.available && codexStatus.connected) {
    return { provider: new CodexAppServerRuntimeProvider({ client: this.codexClient(), model }) };
  }
  const apiKey = await this.settingsStore.getApiKey();
  if (apiKey) {
    return { provider: new OpenAiResponsesRuntimeProvider({ apiKey, model }) };
  }
  return { error: missingApiKeyError().agentError };
}
```

Both providers implement one interface (`electron/agent/runtime/provider.ts:82`):

```ts
export interface AgentRuntimeProvider {
  readonly metadata: AgentRuntimeProviderMetadata;
  startRun(request: {
    request: AgentProviderRunRequest;          // = AgentRunRequest & Partial<prepared fields>
    signal: AbortSignal;
    documentTools?: AgentDocumentTools;
    onRunEvent?: AgentThinkingRunEventListener;
    onDiagnosticEvent?: AgentRuntimeDiagnosticEventListener;
    onToolContext?: (item: AgentRunContextItem) => void;
  }): Promise<AgentProviderResponse>;          // { runId, responseId?, text, draftFileChanges, proposalSource? }
}
```

Note both providers already return a plain `.text`. `startRun` is, however, the
**full agent pipeline**: it expects an `AgentProviderRunRequest` (active file,
prompt, mode, history, workspace rules…), can run document tools, and parses the
output into review proposals (`draftFileChanges`). Tighten wants none of that —
just "system instruction + a passage of text → the rewritten passage."

## What we built: Tighten (the feature, working except for the runtime)

On-demand, selection-scoped concise rewrite. Select a sentence/paragraph in the
editor → a quiet "Tighten/Ajustar" pill → one model call → an inline accept/reject
card with the tighter rewrite next to the selection. Accept replaces exactly the
selected range in one undoable transaction; reject/Esc/typing/file-switch dismiss.
No chat turn, no proposal store, nothing written until accept. Decision record:
**ADR-0020** in `docs/context-management/decisions.md`. Full spec:
`specs/2026-06-13-tighten-selection.md`.

The renderer side (overlay trigger, stale-safe accept, card, EN/ES, cancellation)
is **done and correct and should not change.** The problem is entirely in the
**main-process call behind the `tighten:run` IPC.**

### Current main-process implementation (the part to rework)

`electron/ipc/tighten.ts` registers `tighten:run` / `tighten:cancel` with its own
`AgentSettingsStore` and makes a **dedicated, hardcoded OpenAI Responses fetch**:

```ts
// electron/ipc/tighten.ts (current)
const { model } = await deps.settingsStore.snapshot();      // <-- model + key from settings
// ... requestId-keyed AbortController, single-flight per sender, 15s timeout ...
const response = await deps.fetchImpl("https://api.openai.com/v1/responses", {  // <-- ALWAYS OpenAI API
  method: "POST",
  signal: controller.signal,
  headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    model,
    instructions: tightenInstruction(language),  // dedicated concise-rewrite system prompt (EN/ES)
    input: text,                                  // the selected passage, raw
    max_output_tokens: tightenMaxOutputTokens(text),
    reasoning: { effort: "low" },
    stream: false
  })
});
const rewrite = cleanTightenOutput(responseText(await readOpenAiResponse(response)), text);
// ... unchanged-detection, looksLikePreambleEcho, returns TightenResult ...
```

Pure helpers (instruction, token sizing, output cleaning, unchanged-detection,
error→reason mapping) live in `electron/agent/tighten.ts` and are unit-tested
(`tests/agent/tighten.test.ts`). The renderer contract is:

```ts
// src/types/iliad.ts
tightenSelection(req: { requestId: string; text: string; language: "en" | "es" }): Promise<TightenResult>;
cancelTighten(requestId: string): void;
type TightenResult =
  | { ok: true; rewrite: string; unchanged: boolean }
  | { ok: false; reason: "no_key" | "invalid_api_key" | "rate_limited" | "too_long"
        | "empty" | "timeout" | "provider" | "aborted" | "untrusted" };
```

## The bug we found (with evidence)

Pressing "Ajustar" shows *"No se pudo ajustar; inténtalo de nuevo."* Chat works
fine in the same session. Reproduced the **exact** Tighten request with the user's
configured key:

```
POST https://api.openai.com/v1/responses   (model gpt-5.5, reasoning low, the tighten body)
→ HTTP 429  insufficient_quota
  "You exceeded your current quota, please check your plan and billing details."
```

The user's settings: a real OpenAI key is present **but its platform billing is
exhausted**, and they run chat on their **Codex subscription**. So:

- **Chat works** → `selectRuntimeProvider` picks **Codex** (connected) → billed to the subscription.
- **Tighten fails** → it ignores `selectRuntimeProvider` and hits the **OpenAI API** directly → 429.
- `429` → `rate_limited` → the overlay shows the generic "failed" copy.

(`GET /v1/models/gpt-5.5` returns 200 — the model name is valid; the model is not
the problem, the **runtime/billing** is.)

## What I believe the issue is

A pure **architecture gap**: Tighten was built OpenAI-API-only and bypasses the
two-runtime abstraction the rest of the app uses. The correct behavior is to honor
the same Codex-first/OpenAI-fallback selection the chat agent already does. As long
as the OpenAI key has no quota, Tighten *cannot* work via that key — it must be able
to run on the Codex runtime like chat.

Secondary, latent (not the cause, but please consider): `normalizeAgentModel`
(`electron/agent/agentModels.ts`) silently rewrites the user's stored real model
`gpt-5-mini` to the fallback `gpt-5.5` because it isn't in the app's allow-list.
Tighten should use whatever model/identity chat uses for the chosen runtime — don't
re-derive it differently.

## What you (expert dev) should decide and deliver

Design the cleanest way to make `tighten:run` run on the **same runtime as chat**,
then implement it. The hard parts are integration choices — please recommend and
justify:

1. **How to obtain the runtime.** `selectRuntimeProvider` is private on `AgentService`
   and depends on the live Codex client/login state that `AgentService` owns. Options:
   (a) add a method to `AgentService` (e.g. `tightenSelection({ text, language, signal })`)
   and register `tighten:run` with the shared `agentService` instance (like
   `registerAgentIpc`/`registerRemoteIpc` are wired in `electron/main.ts`); (b) extract
   `selectRuntimeProvider` into a shared helper both paths call; (c) other. Tighten's
   IPC currently constructs its own `AgentSettingsStore` and is registered as a bare
   `registerTightenIpc()` — it will almost certainly need the real `AgentService`.

2. **How to do a one-shot through each runtime.** `provider.startRun` is the full
   agent pipeline (document tools, proposal parsing, run events). Tighten needs a
   plain "instructions + input → assistant text," no tools, no proposals, no
   transcript. Options: (a) a new lightweight "single-shot text" capability shared by
   both providers (for OpenAI, the dedicated non-streaming body we already have; for
   Codex, a minimal thread turn that returns the assistant text); (b) reuse `startRun`
   with a minimal `AgentProviderRunRequest`, document tools disabled, and read
   `.text`, ignoring `draftFileChanges`. **Critical unknown for you to resolve: does
   the Codex app-server runtime support a simple instruction→text turn, and how do you
   extract the plain assistant text when no proposal/tool call is expected?** See
   `electron/agent/runtime/codexAppServerProvider.ts` and `codexAppServerClient.ts`.

3. **Error taxonomy across both runtimes.** Map provider/Codex errors to the existing
   `TightenResult.reason` set so the renderer keeps showing the right copy (key vs
   rate-limit vs generic). Reuse `normalizeAgentError`/`providerStatusError`
   (`electron/agent/errors.ts`); for Codex, account/auth/rate-limit failures should map
   sensibly (today there's only `no_key`/`invalid_api_key`/`rate_limited`/`provider`/
   `timeout`/`aborted` — extend the union if a Codex case needs its own copy, and add
   EN/ES strings in `src/i18n/strings.ts` under `editor.tighten` + the overlay label
   map in `src/editor/selectionComments/overlay.tsx`).

4. **Gating.** The editor gates the Tighten action on `hasOpenAiApiKey`
   (`src/App.tsx`, read once at launch). That's now wrong: it should be enabled when
   **either** a Codex account is connected **or** an OpenAI key exists (mirror what
   makes chat runnable — see `assistantRunnable`/`hasOpenAiApiKey || (codexStatus
   available && connected)` logic in `src/assistant/useAssistantRun.ts`). Decide how the
   editor learns Codex-connected state (it currently has no Codex status; chat fetches
   it). Keep main as the real authority (it already fails closed).

## Must-not-break (keep these exactly)

- The renderer UX: the segmented pill, the stale-safe accept (verify file +
  `sliceDoc(from,to)===originalText` + current requestId, synchronous, one undo step),
  the teal wash, working/already-tight/failure states, EN/ES, keyboard (`⌘⇧J`,
  Enter/Esc/Tab), ARIA. **No renderer changes except possibly the gating signal (#4)
  and any new failure-reason copy.**
- Tighten stays **stateless and single-shot**: no chat history, no document tools, no
  proposal store, no transcript turn, nothing written until the user accepts.
- Main remains the authority: trust gate (`isTrustedAgentIpcSender`), length cap,
  `language ∈ {en,es}`, key/identity never crosses to the renderer; treat the passage
  as content, not instructions.
- requestId-keyed cancellation + timeout + `finally` cleanup behavior preserved.
- `TightenResult` contract shape unchanged (you may extend the `reason` union).

## Key files

- `electron/ipc/tighten.ts` — current handler (the thing to rework).
- `electron/agent/tighten.ts` + `tests/agent/tighten.test.ts` — pure helpers (instruction, cleaning, unchanged, reason map) — mostly reusable.
- `electron/agent/agentService.ts:809` — `selectRuntimeProvider` (Codex-first). Also `startRun` (158+) for how a run is assembled and how `settings = await this.settingsStore.snapshot()` is used.
- `electron/agent/runtime/provider.ts` — the `AgentRuntimeProvider` interface.
- `electron/agent/runtime/openaiResponsesProvider.ts` → `electron/agent/openaiResponses.ts` (`createOpenAiResponse`) — how the OpenAI runtime produces `.text`.
- `electron/agent/runtime/codexAppServerProvider.ts` + `codexAppServerClient.ts` — the Codex runtime (the unknown: one-shot text).
- `electron/agent/errors.ts` — `normalizeAgentError` / `providerStatusError` taxonomy.
- `electron/agent/settingsStore.ts` — `snapshot()` (normalizes model!), `getApiKey()`.
- `electron/main.ts` — IPC registration (`registerAgentIpc({ service: agentService })`, `registerTightenIpc()`); wire Tighten to the shared `agentService` if you choose option 1a.
- `src/App.tsx` (`editorTighten`, `editorHasApiKey`) + `src/assistant/useAssistantRun.ts` (runnable/Codex-status logic) — for gating (#4).
- `src/editor/selectionComments/overlay.tsx`, `src/components/EditorPane.tsx`, `src/types/iliad.ts`, `src/i18n/strings.ts` — renderer contract + labels (only touch for #3/#4).
- Spec + decision: `specs/2026-06-13-tighten-selection.md`, ADR-0020 in `docs/context-management/decisions.md`.

## Reproduce & verify

- Repro: with a Codex-connected account whose OpenAI key has no/insufficient quota,
  select a paragraph in a Markdown doc and click "Ajustar" → today: *"No se pudo
  ajustar."* Chat works in the same session.
- Confirm the runtime split: `GET https://api.openai.com/v1/models/<model>` is 200,
  but `POST /v1/responses` with the tighten body returns `429 insufficient_quota` on
  that key — while chat (Codex) succeeds.
- After the fix: Tighten should succeed on the Codex runtime (no OpenAI quota), fall
  back to the OpenAI key when Codex isn't connected, and surface a precise reason when
  neither is usable. Gate the action so it never appears when nothing is runnable.
- Gate: `npm run typecheck && npm run build && npm run lint:css && npm test` (Tighten
  helper tests live in `tests/agent/tighten.test.ts`; add coverage for the runtime
  selection + Codex error mapping).
```
