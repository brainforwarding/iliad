# Model-Directed Context Tools

Status: architecture discussion. Started 2026-05-26.

This document captures the product direction behind Iliad's next context step:
move from "the app decides all context before the model call" to "the model can
ask for missing context through safe, visible tools."

## Why This Matters

The current context model is predictable:

```text
active Markdown file
+ explicit @mentions or file chips
+ recent visible chat
+ current user request
```

That is safe, but it is not yet as capable as modern coding agents. If the user
asks "use the session style guide" without attaching the file, Iliad currently
does not search the workspace to find it. The assistant can only ask the user to
attach the file.

The target behavior is closer to Codex, Cursor, and Claude Code: the model can
decide it needs more information, call a search or read tool, inspect the result,
and then answer.

## Context Signals

Iliad has three different context signals:

```text
@file.md or a file chip
  -> exact Markdown is supplied as explicit one-turn context.

"the Odisea course", "session 1", or "the quality checklist"
  -> a named or locatable workspace item is implied.

file tree visible in the app
  -> the model cannot visually see it.
```

When the active file or explicit context already contains what the user needs,
the model should answer from that supplied material. When the user asks a
general conceptual question, it should answer normally without searching.

When the user asks for specific content-dependent advice about an implied
workspace item, the model should discover the Markdown through document tools
before answering from assumptions. It should use the smallest useful discovery
step: search by the named item or list a likely directory, then read the most
relevant Markdown result. If discovery fails, finds no useful Markdown, or
returns multiple plausible matches that cannot be safely disambiguated, the
model should ask a focused clarification instead of continuing broad search
loops.

## Minimal Great Version

The first useful version should stay narrow:

```text
User sends a message
  -> Iliad sends assistant rules, active document, recent chat, and tool schemas
  -> Model decides whether it can answer or needs a tool
  -> Model calls a local Markdown tool
  -> Iliad validates and runs the tool in Electron main
  -> Tool result goes back to the model
  -> Model answers or proposes reviewed Markdown changes
  -> Context manifest records every file read or search reference
```

The first tool set:

```text
list_documents(directory?, depth?, limit?)
search_documents(query, directory?, limit?)
read_document(path)
open_document(path)   # desktop runs only: opens the document in the editor
```

`open_document` is UI navigation, not a read: the path is validated with the
same discipline as `read_document` (visible, Markdown, symlink-free, inside the
workspace), the renderer opens it through the normal save-flushing flow, and
every open leaves an activity receipt row. Remote (Telegram) runs do not get
this tool — there is no UI to navigate.

No web search, generic filesystem access, shell, git, package manager, browser,
MCP, or direct write tool should ship in this first version.

## Trust Boundary

The model never reads files directly. The renderer never supplies file contents
as trusted context. Electron main owns the tools:

- path validation;
- workspace-relative Markdown-only access;
- ignored and hidden path rejection;
- symlink rejection;
- file size and search limits;
- cancellation;
- diagnostics;
- context manifest receipts.

Markdown read through tools is untrusted workspace content. It can inform the
answer, but it cannot override Iliad's assistant rules or grant new tool access.

## What Users Should See

The user does not need to watch every internal step, but they must be able to
inspect what happened.

For v1, the existing context manifest is enough if it shows:

- active file included;
- explicit files included;
- model-directed files read;
- model-directed document lists and searches performed as metadata-only
  references.

Later UI can add collapsed tool rows such as:

```text
Searched Markdown documents for "style guide"
Read agent-docs/guia-estilo-sesion.md
```

## How This Differs From Pinned Context

Tool use is not memory. A model-directed file read means "the model read this
for this run." It does not mean "keep this file attached forever."

Pinned context remains a separate future feature:

```text
one-turn chip       -> use now
model tool read     -> model found and used now
pinned context      -> keep using across this chat, visibly
```

## Safety Defaults

The first implementation should enforce:

- maximum tool-call rounds per run;
- maximum total tool calls per run;
- maximum full document reads per run;
- maximum bytes/tokens returned by tool results;
- structured error results instead of crashing on unsafe paths;
- metadata-only manifests and diagnostics;
- review-first writes through existing proposal flow only.

## External Guidance

OpenAI describes tool calling as a multi-step flow: send tools, receive tool
calls, execute application code, send tool outputs, and receive a final response
or more tool calls. See [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling).

OpenAI also documents `tool_choice: "auto"` as the default, where the model can
call zero, one, or multiple tools as needed, and `parallel_tool_calls: false` to
force simpler one-tool-at-a-time orchestration. See [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling#tool-choice).

For Iliad, that means the model can choose when to search or read, while Iliad
still owns what the tools can do.

## Open Questions

- How should repeated model-directed searches be summarized if they become noisy?
- When should the UI show live tool rows instead of only the final manifest?
- How should pinned context interact with model-directed reads?
- Should a future retrieval layer use local lexical search first, then optional
  embeddings?
- What approval, citation, and privacy rules are needed before adding web search?
