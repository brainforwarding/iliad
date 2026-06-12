# Iliad Agent Runtime Roadmap

Date: 2026-05-24

## Product Direction

Read [`agent-vision.md`](./agent-vision.md) before using this roadmap. The
roadmap explains sequencing; the vision doc defines the product boundary.

Iliad's agent should become a workspace-aware Markdown writing agent that can
coordinate bounded AI work, propose document changes in the editor, and
eventually manage subagents. The long-term agent path follows this runtime
split:

- Primary agent runtime: Codex app-server / Codex SDK style runtime.
- Media providers: OpenAI Platform API for transcription, realtime, images,
  embeddings, and other non-agent features.
- Fallback agent provider: the current OpenAI API-key assistant path remains
  available while the Codex runtime matures.

Codex account auth must not be treated as a general OpenAI API key replacement.
It is for the agent runtime. Normal OpenAI API features still use API keys
unless separately proven and documented.

The durable output of the agent is Markdown. A rubric, handout, facilitator
guide, course map, deck outline, research annex, or checklist is just a
Markdown document in Iliad. Do not add artifact-specific agent tools for those
forms.

## Implementation Order

### Done Or In Place

1. **Provider/runtime boundary**
   - The agent has a provider seam.
   - Codex app-server is the preferred connected-account runtime.
   - OpenAI API-key text runs remain as fallback.

2. **Codex account connection**
   - The app can connect through Codex-managed account auth.
   - Iliad does not ask for ChatGPT email/password and does not store ChatGPT
     cookies.
   - Settings should make clear that Codex powers the main agent, while OpenAI
     API keys still power media/API features such as dictation.

3. **Codex proposal bridge**
   - Codex runs against the real workspace.
   - Markdown file changes are captured, restored, and converted into Iliad
     proposals containing explicit file-level operations.
   - The document-native red/green review UI remains the approval boundary.

4. **Thinking, diagnostics, and dictation foundations**
   - The chat can show subtle runtime/thinking progress.
   - Diagnostics are redacted and user-facing errors should be actionable.
   - Dictation uses the API-key media path, not Codex account auth.

5. **Run context manifest and ledger**
   - Every agent run has a run-scoped manifest when provider selection
     succeeds.
   - Manifests persist safe metadata outside workspace Markdown files and
     return with run responses.
   - The manifest records current file context, provider/runtime, model, mode,
     lifecycle status, token estimates, proposal ids, explicit document reads,
     unresolved document references, and whether Codex workspace runtime access
     was available.
   - Assistant messages can show a quiet context disclosure. The `Auto` chip is
     inspectable without becoming a heavy context panel.
   - The current file is treated as one context source, not as the agent's
     identity.

6. **Document tool and proposal contract**
   - Iliad has internal, read-only Markdown context tools for
     `list_documents`, `read_document`, and `search_documents`.
   - The tools enforce workspace-relative visible Markdown paths, ignored
     folders, symlink rejection, deterministic limits, and metadata-only tool
     events.
   - Explicit user references such as `@file.md` can be read through this
     contract, included as supplied context, and recorded in the run manifest.
   - Write intent routes through one review-first Markdown proposal contract
     that supports existing-file edits and new Markdown file creation.
   - Multi-file work is represented as one proposal containing explicit
     `edit_file` and `create_file` operations.
   - This is not yet a visible context picker, subagent surface, or
     provider-facing tool-calling integration.

7. **Evented agent runs**
   - Runtime status now uses typed `run_phase` events instead of assistant
     prose or arbitrary status strings.
   - `AgentService` owns renderer-facing phases. Providers cannot emit visible
     UI phases directly.
   - Providers may emit thinking-summary events only; provider diagnostics stay
     separate from chat UI state.
   - Generic phases stay visually quiet. Thinking summaries take precedence.
   - Terminal phases such as `completed`, `failed`, and `canceled` are useful
     for state/history, but should not add redundant chat copy.
   - Unknown future run events are ignored safely by the renderer.

### Next Architecture Targets

1. **Conversation and run history**
   - Persist local thread summaries, run manifests, event metadata, and pending
     proposal links outside workspace Markdown files.
   - Keep old conversation text and large document payloads bounded.
   - Add clear controls for new chat and history cleanup before long-lived
     history grows.
   - Use the event and manifest foundations already in place. Do not store
     full Markdown payloads, raw provider responses, or hidden whole-workspace
     context in history.

2. **Context selection expansion**
   - Add selected text, explicit attachments, searched files, and recent
     summaries after conversation/run history is stable.
   - Keep all context inspectable through the manifest and quiet disclosure.
   - Prefer user-visible selection and explicit references over automatic
     whole-workspace context.
   - A future context picker can make these choices easier, but it should stay
     lightweight and Markdown-first.

3. **Provider-facing document tool integration**
   - Wire the safe Markdown document tools into future scoped worker runtimes or
     provider tool-calling only when the runtime can enforce tool boundaries.
   - Keep tool results metadata-ledgered and bounded.
   - Do not expose shell, git, Python, package-install, browser, or arbitrary
     computer-use tools.

4. **Read-only subagents V1**
   - Add bounded child jobs only after the main runtime, manifest, and event
     contracts are stable.
   - First useful roles: Reader, Researcher, Reviewer, and Style editor.
   - Subagents receive scoped context, limited document tools, budgets, status,
     and return summaries or evidence to the supervisor.
   - Subagents do not write files directly.

5. **Writer orchestration**
   - Add writer workers only after read-only workers are reliable.
   - Writer outputs are Markdown changes inside one proposal contract, not
     direct file writes.
   - The supervisor owns final synthesis and review handoff for multi-document
     tasks such as building a course from an outline.

6. **Media features**
   - Keep dictation/transcription, image generation, realtime voice, and
     embeddings separate from the Codex agent runtime.
   - These features can use normal OpenAI API keys or future provider-specific
     credentials.

## Superseded Spec Notes

- `specs/2026-05-23-chatgpt-account-login.md` is too broad in its conclusion.
  It remains correct that ChatGPT login is not a general API-billing
  replacement, but it is superseded for the Codex-agent runtime path.
- `specs/2026-05-23-agent-context-management.md` remains the next functional
  source for remaining context-selection work. Its completed foundations are
  now split across context manifests, explicit `@file.md` reads, document
  tools, and evented runs.
- `specs/2026-05-23-assistant-experience-review.md` remains a broad UX/runtime
  source, not a single implementation unit.
- `specs/2026-05-24-evented-agent-runs.md` is implemented. Future event work
  should extend the typed service-owned event contract rather than letting
  providers emit arbitrary UI status.

## Hard Product Rules

- Do not ask users for ChatGPT email/password.
- Do not store ChatGPT cookies.
- Do not call private `chatgpt.com/backend-api/codex` endpoints from Iliad as a
  production dependency.
- Do not copy OpenClaw OAuth client IDs or external-token bridging.
- Do not imply ChatGPT Plus/Pro pays for Iliad's OpenAI API calls.
- Do not let any runtime write directly to user Markdown files without Iliad's
  review layer.
- Do not store ChatGPT/Codex access or refresh tokens until OS keychain storage,
  logout, refresh recovery, and redacted diagnostics exist.
- Do not let provider adapters emit renderer-facing run phases directly.
  `AgentService` owns visible run lifecycle events; providers emit thinking
  summaries and diagnostics only.
- Do not add general development tools such as shell, git, package managers,
  Python/script execution, or arbitrary system inspection to the writing agent.
- Do not add separate durable artifact types for rubrics, handouts, slide
  outlines, or course materials. They are Markdown documents.
- Do not make whole-workspace context hidden or automatic.
