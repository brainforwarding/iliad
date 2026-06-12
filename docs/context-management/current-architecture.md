# Current Context Architecture

Status: current as of 2026-06-11.

This document explains what the assistant sees in simple terms. The model does
not see the app, file tree, or editor UI directly. It receives text assembled by
Iliad at the moment the user presses Send.

## The One-Turn Packet

When the user sends a message, the model receives two main layers:

```text
1. Iliad assistant rules
   "You are Iliad's local Markdown writing assistant..."
   "Use only the supplied Markdown context and document tools..."

2. The user-turn packet
   response language
   + mode, like Auto/Fast/Deep
   + active Markdown file snapshot, if one is open
   + the current editor selection quoted with its line range, if one exists
   + workspace rules from a root AGENTS.md, framed as untrusted preferences
   + explicit context files attached with chips or @mentions
   + unresolved file references, if any could not be read
   + recent visible chat messages
   + the current user request

3. Local document tools, when the provider supports them
   list_documents
   search_documents
   read_document
   open_document (desktop runs only)
```

In code, the OpenAI API request uses `instructions` for the assistant rules and
one generated input string for the user-turn packet. The current packet shape is
assembled in [`electron/agent/openai/prompts.ts`](../../electron/agent/openai/prompts.ts).
For Codex, the same Iliad document tools are exposed as dynamic tools in the
Codex app-server runtime instead of being ordinary text in the prompt.

## Example 1: Message With An Active File

User has `report.md` open and sends:

```text
Make the conclusion shorter.
```

The model sees roughly:

````text
Iliad rules

Active file: report.md
Base hash: abc123
Active Markdown:
```markdown
...current report text...
```

Recent thread:
...recent visible chat...

Current request:
Make the conclusion shorter.
````

The active file is a snapshot from the editor at send time. If the user edits the
file later, the model will not know about that edit until the next turn.

## Example 2: Message With An Attached File

User has `draft.md` open, attaches `style-guide.md`, and sends:

```text
Make this match @style-guide.md.
```

The model sees roughly:

```text
Iliad rules

Active file: draft.md
...current draft text...

Explicit Markdown context document: style-guide.md
Base hash: def456
ILIAD_EXPLICIT_CONTEXT_ctx-1_BEGIN
...current style guide text...
ILIAD_EXPLICIT_CONTEXT_ctx-1_END

Recent thread:
...recent visible chat...

Current request:
Make this match [explicit Markdown context].
```

The chat UI still shows the user's typed text. The provider input may replace an
exact `.md` mention with a plain label so the file path is not treated as extra
instructions. The file content itself is included in the explicit context block.

## Example 3: Dragged File Chip

User drags `rubric.md` from the file tree into chat and sends:

```text
Use this rubric to improve the checklist.
```

The model sees:

```text
Active file, if one is open
+ explicit context document: rubric.md
+ recent visible chat
+ current request
```

The message text does not need to contain `@rubric.md`. The chip is enough to
send the file as context for that turn.

## What Happens On The Next Message

Assume this sequence:

```text
Turn 1 user: Use @style-guide.md to improve this.
Turn 1 assistant: I prepared a proposal...

Turn 2 user: Now make the intro warmer.
```

On turn 2, Iliad builds a new packet:

```text
Iliad rules
+ latest active Markdown file snapshot
+ files attached or @mentioned on turn 2
+ "Documents referenced earlier in this conversation (not included;
   re-read with document tools if needed): `style-guide.md`"
+ recent visible chat, including the turn 1 summary
+ "Now make the intro warmer."
```

`style-guide.md`'s content is not automatically sent again just because it was
used on turn 1 — only its path reappears, in an identifier-only reference index
(ADR-0014), so the model knows it can re-read the file with document tools. If
the user wants the latest `style-guide.md` content used again, they should
attach it again, mention it again, keep it open as the active document, or let
the model re-read it through document tools.

## What Happens After Reloading History

When the user leaves a conversation and later opens it from history, Iliad loads
the visible transcript:

```text
user messages
+ assistant messages
+ visible status/error rows
```

It does not reload old raw file snapshots into the new model request. On the next
send, Iliad again builds a fresh packet from:

```text
current active file
+ current selected chips or @mentions
+ recent visible transcript
+ current user message
```

This keeps old hidden document content from silently living forever in a chat.
It also means the user must reattach a document when they want the latest version
used again.

## What Is Stored

Iliad stores visible chat history as transcript text. It does not store raw file
contents inside chat history. See [`src/assistant/chatHistory.ts`](../../src/assistant/chatHistory.ts)
and [`electron/agent/chatHistoryStore.ts`](../../electron/agent/chatHistoryStore.ts).

Iliad also stores a context manifest for each run. A manifest is a receipt: it
records what kinds of context were included, which file paths were read, hashes,
token estimates, provider, model, and status. It is not the model's full prompt
and it does not persist the workspace root. See
[`electron/agent/contextManifest.ts`](../../electron/agent/contextManifest.ts)
and [`electron/agent/contextManifestStore.ts`](../../electron/agent/contextManifestStore.ts).

## Implied Workspace References

The model does not visually see the file tree. If the user says "the Odisea
course", the model does not get pixels from the sidebar. It can only discover
that material by calling local Markdown document tools.

The prompt policy tells the model:

```text
If the user names a locatable course, folder, session, document, worksheet,
guide, report, checklist, or similar workspace item that is not already supplied
in active or explicit context, and the answer depends on that item's content,
search/list Markdown documents and read the most relevant match before giving
specific advice. If a search returns zero results and reports it was capped,
scope the next search to the most likely directory instead of repeating the
same query.
```

It should not search when the active file or explicit context already contains
the needed material, or when the user asks a general conceptual question.

This is implemented for both provider paths through Iliad-owned local Markdown
tools. The OpenAI API provider runs a Responses API function-call loop. The
Codex app-server provider exposes the same safe Markdown tools as Codex dynamic
tools and records live activity plus final context receipts for
`list_documents`, `search_documents`, `read_document`, and — on desktop runs
only — `open_document`, which opens a validated visible Markdown document in
the editor and leaves an "Abrió" activity row in the receipt.

`search_documents` is path-first. It checks safe Markdown folder/file names
before reading document content, so a phrase like "curso Odisea session 1" can
match a deep path such as:

```text
curso-odisea/curso-1/s1/s1.md
```

The path search normalizes accents and separators and understands common aliases
such as `sesion 1`, `sesión 1`, `session 1`, `s1`, `curso 1`, and `curso-1`,
and covers the workspace tree exhaustively (traversal caps are backstops, not
working limits). The bounded content scan that follows prefers files whose path
matches the query over alphabetical order. This keeps the tool good at finding
named course/session files without reading every Markdown file in the
workspace.

Codex still also has workspace runtime access. Inside a turn's expanded
`Proceso` receipt, the row pair `Sin archivo incluido` +
`Acceso al espacio de trabajo · Disponible` means the workspace runtime was
available without any specific file in context. It does not by itself prove
Codex read a specific file. Specific proof comes from document-tool activity
rows and final receipts showing document search/list/read/open rows.

The answer text streams into the transcript while it generates; the stored
record remains the final text of the run.

## Current Limits

- Recent chat sent to both providers is the full visible transcript, newest
  first, until an estimated 40k-token budget
  (`electron/agent/conversationHistory.ts`). When older messages are omitted,
  the prompt says how many, the manifest records the omission as an excluded
  row, and an identifier-only index of documents referenced earlier in the
  conversation is included (paths only, never content). Past roughly 2k omitted
  tokens, a cached compaction summary of the omitted prefix (ADR-0015) rides
  above the recent thread — generated post-run, never inline — with a
  "Summary of N earlier messages" receipt row; the omission row then carries
  only the uncovered gap.
- Explicit file mentions are capped before model input is built.
- At most 4 explicit context documents are included in a single run today.
- Explicit context also has byte and token budgets.
- Other workspace files are not automatically appended to the prompt. Providers
  may discover Markdown files through bounded local document tools.
- Document path discovery enumerates the workspace tree up to backstop caps
  (10,000 directories / 100,000 entries / 20,000 Markdown files) sized so real
  workspaces never hit them; output stays capped (50 matches, 500 list rows).
  Content search reads at most 500 files, preferring files whose path matches
  the query over alphabetical order. Searches accept an optional directory
  scope, and content-search depth counts from the scope. A "search capped"
  receipt now signals an unusually large workspace; the prompt policy tells the
  model to scope the next search to a directory instead of repeating it.
- Codex live document-tool activity is transient UI state. Chat history keeps
  visible user/assistant text, not the live activity stream.
- There is no persistent "pinned context" feature, by decision: one-turn
  attachments, workspace rules, and fresh tool re-reads cover its intents
  without stale snapshots.

These limits are implemented around
[`electron/agent/documentContext.ts`](../../electron/agent/documentContext.ts)
and [`electron/agent/openai/prompts.ts`](../../electron/agent/openai/prompts.ts).

## Why This Design

The main product promise is: the user should be able to tell what the assistant
used. A file chip or `@file.md` means "use this now." It does not mean "keep this
file hidden in every future turn."

That design avoids stale file snapshots, surprise hidden context, and accidental
whole-workspace reads. The tradeoff is that repeated work sometimes needs
re-attaching a file until we add an explicit pinned-context feature.
