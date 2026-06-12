# Agent Panel V1

Date: 2026-05-22
Status: implemented locally

Historical note: this spec describes the first assistant slice. For future
agent direction, use [`docs/agent-vision.md`](../docs/agent-vision.md),
[`docs/agent-runtime-roadmap.md`](../docs/agent-runtime-roadmap.md), and the
later Codex/context specs. Do not use this implemented v1 spec as the roadmap
for provider choice, context architecture, or subagent work.

## Product Intent

Iliad should gain a clean, minimal assistant panel that feels native to the current writing app, not like a full IDE bolted onto it. The assistant should help with the active Markdown document, explain or revise selected/current text, and propose reviewable Markdown changes without silently mutating files.

This spec implements the first thin slice of the broader architecture in [`docs/agent-panel-v1-architecture.md`](../docs/agent-panel-v1-architecture.md). The research backing this direction lives in:

- [`docs/research/agentic-architecture-survey.md`](../docs/research/agentic-architecture-survey.md)
- [`docs/research/agent-chat-ux-patterns.md`](../docs/research/agent-chat-ux-patterns.md)
- [`docs/research/model-provider-comparison.md`](../docs/research/model-provider-comparison.md)
- [`docs/research/community-sentiment-reddit.md`](../docs/research/community-sentiment-reddit.md)

## Problem

The research docs define a fuller supervisor/worker agent workbench. Implementing all of that at once would add too much surface area to a small local-first editor. Iliad needs a first assistant slice that proves the trust model:

- context is explicit,
- model calls happen behind Electron main,
- API credentials are not spread through renderer code,
- assistant output is visible,
- edits are reviewable,
- writes happen only through the existing Markdown persistence path.

## Goals

- Add a right-side assistant panel that can be opened/closed from the topbar.
- Keep the existing file tree, editor, autosave, language menu, typography menu, and focus mode behavior intact.
- Store the OpenAI API key and selected model locally for now, through Electron main IPC.
- Send the active Markdown document content, active file metadata, and user prompt to the model.
- Use a concise system prompt that enforces Iliad's source-as-contract behavior.
- Render a clean chat transcript with user turns, assistant turns, status/error states, patch proposal cards, and new-document proposal cards.
- Support a simple review-first patch format: if the assistant returns an explicit full-document replacement payload, generate a diff and show it as a proposal rather than applying it automatically.
- Let the user apply a whole-file replacement only after review. V1 patch application may be intentionally conservative.
- Let the user apply a separate new Markdown document only after review when the assistant returns an explicit new-document payload.
- Persist no assistant state inside the user's Markdown files.
- Add localized English and Spanish UI strings for new visible controls.
- Update README feature inventory when the assistant slice ships.

## Non-Goals

- No multi-agent runtime in code yet.
- No real agent spawning/delegation yet; if the user asks for agents, the assistant should be transparent and offer a workflow/prompt instead.
- No background agents.
- No terminal execution.
- No browser/computer-use automation.
- No MCP connectors.
- No whole-workspace upload.
- No hidden automatic memory.
- No cloud task dashboard.
- No provider picker beyond OpenAI model text input.
- No streaming requirement in this first slice; the UI should still show clear running status.
- No partial hunk accept/reject. V1 can apply the proposed full replacement only.
- No secure OS keychain integration yet. The user explicitly accepted local storage for now.

## Panel Selection

This change touches Electron IPC, local app data, model API calls, React UI, app chrome, i18n, CSS, docs, and verification. Panel:

- UX/design reviewer: checks the spec and UI plan against Iliad's clean minimal style.
- Implementation worker: owns the code implementation in the feature worktree.
- Verification worker: independently reviews behavior and runs typecheck/build.

The orchestrator owns spec writing, review reconciliation, panel sizing, final integration, final verification, commit/push judgment, and worktree cleanup.

## UX Direction

The panel should follow the existing chrome:

- quiet `#fffefa` / `#f3f2ec` surfaces,
- thin borders,
- 6-8px radii,
- compact icon buttons using `lucide-react`,
- no nested cards,
- no marketing copy,
- no decorative gradients or blobs.

Accepted UX review feedback:

- Build the assistant as a native right-side utility pane, not a floating chat widget or dashboard.
- Use neutral task/status language such as `Reading`, `Drafting`, and `Waiting for review`; do not expose "subagent", "worker", "sandbox", or provider internals in v1 UI.
- Treat `Review changes` as the primary trust surface. Do not apply edits directly from a transcript card.
- Keep panel width around 320-380px and add it as a third app-content column so the editor layout remains stable.
- Add only the assistant-specific CSS tokens needed for this pane. Do not migrate the whole app color system in this change.

Target layout:

```text
Assistant panel
  Header: title, settings, new chat, close
  Context strip: Current file chip
  Transcript
    user message
    assistant message
    proposal card when a diff is detected
    error row when needed
  Review drawer
    proposed replacement / diff
  Composer
    prompt textarea
    submit/stop button
```

The panel should sit as a third column to the right of the editor when open. In focus mode, hide the assistant with the sidebar. On narrower screens, responsive CSS may collapse the panel below or cover less width, but it must not overlap topbar controls or editor text incoherently.

## User Flows

### Configure Key

1. User opens the assistant panel.
2. If no API key exists, the panel shows a small settings area.
3. User enters an OpenAI API key and optional model.
4. Electron main stores it in local app data.
5. The UI does not print or echo the stored key.

### Ask About Active Document

1. User opens a Markdown file.
2. The assistant context strip shows the current file name.
3. User asks a question.
4. Renderer sends workspace path, file path, file relative path, document text, and prompt to Electron main.
5. Electron main calls OpenAI and returns assistant text.
6. Renderer appends the assistant response.

### Request A Rewrite

1. User asks for a rewrite of the active document or a section.
2. Assistant may answer with explanation, a fenced `diff` block, and an exact `FULL_REPLACEMENT:` Markdown block.
3. Electron main extracts only the labelled full replacement, generates the review diff, and returns a proposal card payload to the renderer.
4. User can review the diff text.
5. User opens `Review changes`.
6. User clicks Apply from the review surface.
7. Renderer flushes pending autosave, then applies the replacement only if the proposal has a full replacement payload.
8. If the proposal is not safely applicable, the UI tells the user to manually copy/retry rather than guessing.

### Error State

1. Missing API key, network failure, provider error, or save failure appears as a sticky transcript error.
2. Errors do not auto-dismiss.
3. A failed save blocks applying assistant changes.

### New Chat

1. User clicks New Chat.
2. Transcript resets locally.
3. Document content is untouched.

## Backend / Electron Behavior

Add `electron/ipc/agent.ts` and supporting helpers under `electron/agent/`.

Renderer-facing IPC:

- `agent:get-settings`
- `agent:update-settings`
- `agent:start-run`
- `agent:cancel-run`
- `agent:apply-patch`
- `agent:apply-new-document`

Settings shape:

```ts
interface AgentSettingsSnapshot {
  hasOpenAiApiKey: boolean;
  model: string;
  mode: "fast" | "balanced" | "deep";
}
```

Settings update shape:

```ts
interface AgentSettingsUpdate {
  openAiApiKey?: string;
  model?: string;
  mode?: "fast" | "balanced" | "deep";
}
```

Run request shape:

```ts
interface AgentRunRequest {
  runId: string;
  workspaceRoot: string;
  activeFile: {
    path: string;
    relativePath: string;
    content: string;
    baseHash: string;
  } | null;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  prompt: string;
  mode: "fast" | "balanced" | "deep";
  language: "en" | "es";
}
```

Run response shape:

```ts
interface AgentRunResponse {
  runId: string;
  responseId?: string;
  text: string;
  patch: AgentPatchProposal | null;
}

interface AgentPatchProposal {
  id: string;
  runId: string;
  summary: string;
  path: string;
  relativePath: string;
  baseHash: string;
  replacement: string;
  unifiedDiff: string;
}

interface AgentCreateDocumentProposal {
  id: string;
  runId: string;
  summary: string;
  relativePath: string;
  content: string;
}
```

Electron main must:

- store settings under `app.getPath("userData")`,
- avoid logging the key,
- validate the active file is a visible Markdown file inside the workspace,
- call OpenAI Responses API using `fetch`,
- use the selected model or a default,
- include the selected response mode in prompt context,
- cap output tokens,
- return a clear error message on missing key/provider failure.

Default model: `gpt-5-mini` for cost/speed. The user can edit the model field locally.

## Prompt Contract

System prompt should say:

- You are Iliad's Markdown writing assistant.
- The on-disk Markdown source is the contract.
- Do not invent facts about files not provided.
- Do not request or assume hidden workspace access.
- Answer concisely.
- If proposing edits, include a short explanation and then a fenced `diff` block.
- For whole-document replacement, include the exact label `FULL_REPLACEMENT:` followed by a fenced `markdown` block containing the complete replacement after the diff.
- For separate new Markdown documents, include the exact label `NEW_DOCUMENT:` followed by a safe relative Markdown path, then a fenced `markdown` block containing the complete new document.

V1 extraction should only create an applicable proposal when the exact labelled full replacement Markdown block is present. This is conservative and avoids unreliable partial patch parsing.
V1 should only create a new document when the exact labelled new-document block is present and the path validates as a visible Markdown file inside the workspace.

## Renderer Behavior

Add:

- `src/components/AssistantPanel.tsx`
- `src/styles/assistant.css`

Update:

- `src/App.tsx`
- `src/styles/app.css`
- `src/styles/chrome.css` or responsive styles as needed
- `src/i18n/strings.ts`
- `src/types/iliad.ts`
- `electron/preload.ts`
- `electron/main.ts`
- `README.md`

`AssistantPanel` props should receive:

- workspace,
- active file,
- current `documentText`,
- language,
- labels,
- `onApplyPatch`.

`App.tsx` should own assistant open/closed state, flush pending autosave before apply, and apply the reviewed replacement through Electron main's existing Markdown-safe write path.

The transcript proposal card should expose `Review` and `Discard`, not `Apply`. Applying happens only from the expanded review surface.

New-document proposal cards follow the same rule: `Review` and `Discard` in the transcript, with `Apply` only in the review surface.

## Permissions And Security

- The assistant can read only the active document passed by renderer in v1.
- The assistant cannot search the workspace in this implementation.
- The assistant cannot write files directly.
- The assistant cannot apply a change without a user click.
- API key is local app data for now; this is accepted as temporary and should be called out in code/spec, but the key must still not be logged.
- Provider errors should not include request payloads or key material.

## Data / API / RLS Changes

- No database.
- No RLS.
- No remote app backend.
- New local app-data JSON file for assistant settings.
- New OpenAI HTTPS call from Electron main.

## Race Conditions

- Applying a replacement must flush current autosave first.
- If save fails, do not apply.
- While a model request is running, the composer submit button becomes a stop/cancel affordance. If true network abort is not implemented in v1, the UI must ignore stale responses after cancellation.
- If active file changes while a request is running, the returned proposal remains in the transcript but applying should target the file from the original request only if it is still active. Otherwise block and ask the user to reopen/regenerate.

## Rollout

This is local desktop functionality only. No provider deployment is involved.

## Required Verification

- `npm run typecheck`
- `npm run build`
- Manual UI smoke through `npm run dev` if practical:
  - assistant panel opens/closes,
  - settings save without showing the key,
  - no active file state is handled,
  - prompt submits with missing-key error,
  - new chat resets transcript,
  - replacement apply updates editor text and autosave status.

## Open Questions

- Whether to commit this first slice without a true streaming event protocol. Current answer: yes, because it keeps the first implementation smaller and still establishes the safe Electron/provider/UI boundary.
- Whether to support Gemini 3.5 Flash in v1. Current answer: not in code yet; keep the provider adapter narrow and add Gemini after OpenAI conformance is working.
