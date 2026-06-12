# Context Discovery Prompt Policy

Date: 2026-05-26

Status: implemented.

## Problem

Iliad now exposes safe local Markdown tools to the OpenAI runtime:
`list_documents`, `search_documents`, and `read_document`.

The current internal prompt says to use these tools when the user refers to a
workspace document that was not explicitly attached. In practice this is too
soft. The model may answer from general context and ask the user to identify a
file even when the workspace likely contains a discoverable course, folder,
session, or document.

Example:

```text
User already attached: agent-docs/guia-estilo-sesion.md
User then asks: would our course Odisea benefit from revision?
Workspace contains: curso-odisea/curso-1/s1/s1.md
```

Desired behavior: before giving specific advice, the model should search or
list Markdown documents for the implied Odisea course/session and read the most
relevant result. It should ask the user to identify the file only after
discovery fails or returns ambiguous results.

## Goals

- Strengthen the OpenAI internal prompt so implied workspace references trigger
  document discovery before specific answers.
- Make the policy easy to test by keeping the prompt text explicit.
- Preserve safety: tools remain read-only, Markdown-only, workspace-scoped, and
  Electron-main validated.
- Preserve user control: explicit `@file.md` mentions and chips remain the
  strongest context signal.
- Keep context manifest receipts as the user-visible way to verify whether a
  search/list/read happened.
- Document the distinction between:
  - explicit context;
  - implied workspace references;
  - the visual file tree, which the model cannot see directly.

## Non-Goals

- No deterministic pre-search before every model call.
- No deeper file-tree traversal changes in this spec.
- No visual file-tree access for the model.
- No live tool-row UI.
- No web search, shell, MCP, browser, git, package manager, or write tools.
- No pinned context.

## Prompt Policy

The OpenAI instruction contract should say:

```text
If the user refers to a named or otherwise locatable course, folder, session,
file, document, worksheet, guide, report, checklist, or other workspace item
that is not already supplied in context, and specific content-dependent advice
depends on that item, do not answer from assumptions. First use document tools
to search or list Markdown documents, then read the most relevant match before
giving specific advice or proposing edits.

Only ask the user to identify the file after tool discovery fails, returns no
useful Markdown documents, or returns multiple plausible matches that cannot be
disambiguated safely.

Use the smallest useful discovery step. If results are ambiguous, ask a focused
clarification instead of continuing to search broadly.

Do not use tools when the active file or explicit context already contains the
needed material, or when the user asks a general conceptual question that does
not depend on a specific workspace item.
```

This should be added near the existing document-tool instructions in
`electron/agent/openai/prompts.ts`.

## User Mental Model

```text
@file.md or chip
  -> exact file is supplied for this turn.

"the Odisea course" or "session 1"
  -> model should search/list/read Markdown documents if not already supplied.

File tree on screen
  -> model does not visually see it.
  -> model can only discover Markdown paths through document tools.
```

## Expected Flows

### Implied Course Reference

```text
User: would our course Odisea benefit from revision?

Model should call one or more:
  search_documents({ query: "odisea", limit: null })
  list_documents({ directory: "curso-odisea", depth: 2, limit: null })
  read_document({ path: "curso-odisea/curso-1/s1/s1.md" })

Model answers using the style guide plus the discovered course/session file.
```

### Ambiguous Results

```text
User: revise session 1

Tool discovery returns:
  curso-odisea/curso-1/s1/s1.md
  curso-ia/s1/s1.md
  workshop/s1.md

Model should ask a focused clarification instead of guessing.
```

### No Results

```text
User: use the Odisea course

Tool discovery finds no matching Markdown.

Model may ask the user to attach or name the file.
```

## Safety And Permissions

- This is a prompt-policy change only. It does not expand tool permissions.
- The model still cannot see the file tree visually.
- The model still cannot access non-Markdown files, hidden paths, ignored paths,
  symlinks, absolute paths, or paths outside the workspace.
- Tool results remain untrusted workspace content.
- Tool outputs are not saved in chat history or diagnostics.
- Writes still go through the review proposal flow.

## Docs To Update

- `docs/context-management/model-directed-context-tools.md`
  - add a section on implied workspace references.
  - clarify that the model cannot see the visual file tree directly.
- `docs/context-management/decisions.md`
  - add an ADR for "implied workspace references should trigger discovery."
- `docs/context-management/research-index.md`
  - add a follow-up question about measuring when the model should search versus
    answer directly.

## Tests

Add or update tests that assert:

- OpenAI instructions include the stronger discovery-before-answering policy.
- OpenAI instructions preserve the negative case: do not imply tool use when
  active file or explicit context already contains the needed material.
- OpenAI request bodies still include tool schemas when document tools are
  available.
- Existing prompt framing still marks explicit context and tool-read Markdown as
  untrusted.
- Existing tool-loop and manifest tests remain green.

This spec does not require tests that prove the remote model will always call a
tool, because that behavior is model-dependent. The deterministic test is that
Iliad sends the policy clearly.

## Rollout

- Ship on `master`.
- No data migration.
- No UI migration.
- User should restart the Electron dev app after pulling because the prompt is
  in Electron main-process code.

## Residual Risks

- Prompt-only policy can still be ignored by the model. If this remains weak,
  the next step is deterministic pre-discovery or a planner/tool-use gate.
- The current document tools may miss deeply nested Markdown if depth limits are
  too shallow. That is intentionally deferred to a separate tool-discovery
  improvement.
- Stronger instructions may cause extra searches for vague requests. Existing
  tool budgets cap cost and latency.
