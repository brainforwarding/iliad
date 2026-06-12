# Architecture Decisions

Status: living decision log. Started 2026-05-26.

## ADR-0001: Context Is Built Per Turn

Status: accepted.

Each assistant run gets a fresh context packet. The packet is assembled when the
user presses Send.

Why: the model should see current editor/file state, not stale hidden snapshots.

Consequence: old attachments are not automatically reused unless the user
attaches or mentions them again. Amended by ADR-0014: prior documents'
workspace paths may reappear as an identifier-only reference index; their
content is still never reused automatically.

## ADR-0002: Active Markdown File Is Included Automatically

Status: accepted.

If a Markdown document is open, Iliad includes the current editor snapshot as the
active file context.

Why: the assistant is part of a Markdown editor, and the open document is the
most natural default context.

Consequence: the active file is context, not the identity of the chat. The agent
header should not imply that the whole conversation belongs to one file.

## ADR-0003: Explicit Attachments Are One-Turn Context

Status: accepted.

Files selected through `@` autocomplete or drag/drop chips are sent as explicit
context for that run.

Why: the user made a direct context choice, so the app can read the file without
an extra approval prompt.

Consequence: chips clear after send. Persistent context needs a separate pinned
context design.

## ADR-0004: Context Manifests Are Receipts

Status: accepted.

Every run gets a context manifest that records what was included or excluded.

Why: the user should not have to infer what the model saw from chat prose.

Consequence: manifests store metadata such as file path, hash, inclusion reason,
provider, model, and token estimate. They are not raw prompt archives.

## ADR-0005: Chat History Stores Visible Transcript Text

Status: accepted.

Saved chat history stores visible user, assistant, status, and error text. It
does not store raw context payloads, proposal internals, provider diagnostics, or
context manifests in the thread transcript.

Why: history should restore the conversation without turning every old file
snapshot into hidden future context.

Consequence: opening an old chat and sending a new message creates a fresh
packet from current context plus recent visible transcript.

## ADR-0006: Attached Markdown Is Untrusted Content

Status: accepted.

Attached Markdown is reference material, not a system instruction.

Why: workspace files can contain arbitrary text. A file should not be able to
override Iliad's assistant rules.

Consequence: provider prompts label explicit context as untrusted
user/workspace Markdown.

## ADR-0007: Pinned Context Is Separate From Attachments

Status: proposed.

A future pinned-context feature should be visually and behaviorally distinct
from one-turn chips.

Why: "use this once" and "keep using this in this conversation" are different
user intents.

Consequence: pinned context needs its own UI, receipt rows, freshness policy,
and stale-file behavior.

## ADR-0008: Future Workers Need Scoped Context

Status: proposed.

Future Reader, Reviewer, Style, or Writer workers should receive explicit task
instructions, allowed files, tool limits, and output formats.

Why: subagents are only useful if their work is real, bounded, visible, and
reviewable.

Consequence: do not add subagent UI until context receipts and tool boundaries
can explain what each worker saw and did.

## ADR-0009: Let The Model Gather Context Through Safe Document Tools

Status: accepted for local Markdown tools; web search deferred.

The OpenAI API runtime may expose a small set of local Markdown tools to the
model: list documents, search documents, and read one document.

Why: users should not have to name every relevant document manually. The model
can often infer that it needs to search or read before answering, especially for
requests such as "use the session style guide" or "compare this with the quality
checklist."

Consequence: Iliad must keep the harness deterministic even when model choices
are flexible. Electron main validates every tool call, enforces budgets, records
metadata-only context receipts, and keeps all writes inside the existing review
proposal flow.

Non-goal: this does not create pinned context, whole-workspace upload, web
search, shell access, background agents, or direct model writes.

Amended 2026-06-11: traversal budgets are backstops against pathological trees,
sized so real workspaces never hit them; output budgets remain the working
limits. `search_documents` accepts an optional directory scope. Spec:
[2026-06-11 exhaustive document discovery](../../specs/2026-06-11-exhaustive-document-discovery.md).

## ADR-0010: Implied Workspace References Trigger Discovery

Status: accepted.

When the user refers to a named or otherwise locatable workspace item such as a
course, folder, session, document, worksheet, guide, report, or checklist, and
specific content-dependent advice depends on that item, the model should use
local Markdown document tools to discover and read the relevant file before
answering from assumptions.

Why: users often refer to visible or known workspace material by name rather
than attaching every file. The model cannot visually see the app's file tree, so
named workspace references require explicit discovery through `list_documents`,
`search_documents`, or `read_document`.

Consequence: the model should start with the smallest useful discovery step and
avoid broad search loops. It should ask the user to identify the file only after
discovery fails, returns no useful Markdown, or returns multiple plausible
matches that cannot be disambiguated safely.

Negative cases: no tool use is implied when the active file or explicit context
already contains the needed material, or when the user asks a general conceptual
question that does not depend on a specific workspace item.

Amended 2026-06-11: when a search is capped with zero results, the smallest
useful next step is one directory-scoped retry; asking the user comes after
that. Spec:
[2026-06-11 exhaustive document discovery](../../specs/2026-06-11-exhaustive-document-discovery.md).

## ADR-0011: Codex Is A Runtime Boundary

Status: accepted.

The Codex app-server path is a runtime with its own native thread, native tools,
native compaction, and app-server events. It is not the OpenAI Responses API with
a different auth token.

Why: OpenClaw's Codex harness shows that subscription-backed Codex usage works
best when provider/auth, model, runtime, and channel are separate layers.

Consequence: Iliad can share context policy across providers, but tool execution
and tool receipts need runtime-specific adapters. OpenAI API document tools do
not automatically apply to Codex turns.

## ADR-0012: Workspace Availability Is Not File Usage

Status: accepted.

A context row saying the Codex workspace runtime was available must not be
treated as proof that the model read any specific file.

Why: Codex may have native workspace access without Iliad receiving a precise
file-read receipt.

Consequence: future Codex context work should make model-directed file
discovery visible, either by exposing Iliad-owned document tools to Codex or by
translating Codex-native file events into context manifest rows.

## ADR-0013: Pending Review Navigation Is UI State, Not Model Context

Status: accepted.

Opening an agent proposal review surface is app navigation. It does not by
itself mean the model read a document, and a virtual pending create review must
not become `activeFile` until the user presses `Crear` and the Markdown file
exists on disk.

Why: pending create files are review artifacts, not durable Markdown documents.
Treating them as active file context would blur the line between proposed text
and source-of-truth workspace files.

Consequence: review auto-open and file-tree reveal behavior can be
provider-neutral over normalized proposal records. If a real existing file is
opened for a single-file edit review, that is ordinary document navigation and
the real file may become active context on the next run. Pending create reviews
remain visible UI only until created.

## ADR-0014: Conversation History Is Budget-Bounded; Earlier Document References Persist As Identifiers

Status: accepted.

Providers receive the full visible conversation history, newest first, within an
estimated token budget (40k in v1, defined in
`electron/agent/conversationHistory.ts`). The newest message is always included.
Selection runs once in the main process (`preparedRunRequest`), so both
providers and the manifest token estimate see the same trimmed messages. When
older messages are omitted, the omission is deterministic, announced in the
prompt ("N earlier messages omitted"), and mirrored in the context manifest as
an excluded item. An identifier-only index of documents previously included or
read in the conversation (sanitized relative Markdown paths, max 20, derived
in-session from prior run manifests, filtered against the current packet after
@-mention resolution) may be re-presented so the model can re-read them with
document tools.

Why: a fixed small window (the previous last-8-messages rule) is not industry
practice for iterative agent chats and silently drops earlier constraints and
references. Full-history-until-budget plus just-in-time retrieval over
lightweight identifiers is the converged pattern (see
[external best practices](./external-best-practices.md)).

Consequence: document content is never re-sent automatically — only paths. Every
indexed path appears in the run's context manifest as a reference row, and the
omission count appears as an excluded row, so the receipt mirrors the prompt.

Spec: [2026-06-11 conversation history budget and turn receipts](../../specs/2026-06-11-conversation-history-budget-and-turn-receipts.md).

## ADR-0015: Long-Thread Compaction Summaries

Status: accepted.

When a thread exceeds the history budget, a cached LLM summary of a
head-anchored prefix of the omitted messages augments the omission note: the
note shrinks to the uncovered gap and disappears only at full coverage.

Why: a deterministic omission note preserves honesty but not content; the
industry pattern (Claude Code, Codex CLI, Cursor) is a summary that preserves
decisions, constraints, and the file index, with recent turns kept verbatim.

The original gate ("not built until budget-only selection proves insufficient")
is explicitly amended rather than silently deleted: the fail-open design makes
the cost of being early one cached fast-mode call per long thread, while the
cost of being late is silent decision loss in exactly the threads users care
most about.

Consequence: summaries are generated post-run, fire-and-forget (mode "fast",
least-privilege profile, wall-clock timeout, failure cooldown) — a user turn
never waits on summarization. The cache is content-addressed by an injective
hash of the covered message prefix (no thread identity in the run path),
persisted, rolled forward oldest-first so every coverage claim is true by
construction, and wiped entirely by clear-chat-history. The summary embeds as
untrusted, delimiter-neutralized data; marker-bearing or oversized output is
discarded. Receipts: a "Summary of N earlier messages" row (counted in
estimated input tokens) plus the gap-only omitted row. Any failure degrades to
the plain omission note.

Spec: [2026-06-11 conversation compaction summaries](../../specs/2026-06-11-conversation-compaction-summaries.md).

## ADR-0016: UI Navigation Is A Receipted Tool

Status: accepted.

The agent may navigate the app — opening one visible workspace Markdown
document in the editor — only through a validated, profile-gated, receipted
tool (`open_document`). Navigation is not a write: the renderer executes it
through the normal save-flushing open flow, and every open leaves an activity
receipt row plus a manifest item. Remote profiles get no UI tools.

Why: the model hallucinated the capability ("Listo, abrí…") when users asked it
to open documents — the worst kind of trust failure. Giving it the real,
bounded verb is safer than prompting around the lie.

Consequence: injection-driven opens are bounded by the shared tool budget,
validated like reads, visible in receipts, and reversible through navigation
history. Failed opens loop back to the model as tool errors.

Spec: [2026-06-11 open document and answer streaming](../../specs/2026-06-11-open-document-and-answer-streaming.md).

## ADR-0017: Editor Selection Is One-Turn Context

Status: accepted.

When a non-empty editor selection exists at send time, its offsets travel with
the request; the main process re-validates bounds and slices the quoted excerpt
from the active-file snapshot itself (never a second renderer copy). One-turn
like attachments (ADR-0003): consumed on send, re-armed by any new selection,
un-consumed when the run fails. Always receipted with a line-range row.

Why: pointing is the cheapest instruction there is; describing a passage in
prose is slow and lossy. Cursor and Claude Code treat the live selection as
first-class context for the same reason.

Spec: [2026-06-11 editor selection as context](../../specs/2026-06-11-editor-selection-as-context.md).

## ADR-0018: Workspace Rules Live In AGENTS.md

Status: accepted.

A root-level `AGENTS.md` (the cross-tool standard name, not an Iliad invention)
is read fresh from disk on every run, both providers and both profiles, and
injected as user-authored, untrusted style preferences inside a framed,
delimiter-neutralized block. It is size-capped (2k estimated tokens); oversized
rules are excluded honestly with a receipt row and a prompt note, never
silently truncated. Every turn carries a "Workspace rules" receipt row with the
file hash, so the user can see which version of the rules ran. The rules path
never echoes into the earlier-documents reference index and never counts as a
Telegram answer source.

Why: standing preferences ("di estudiantes, no alumnos") otherwise must be
re-typed per thread (ADR-0001's fresh packet is deliberate); the rules file is
the industry-converged answer, and prior art exists in-repo
(agent-panel-v1-architecture proposed exactly this). This is the one standing,
always-receipted, user-authored inclusion — the deliberate exception to
"nothing automatic", justified by the receipt.

Consequence: Iliad injects on both providers. The Codex runtime may also layer
AGENTS.md natively (cwd is the workspace root; no app-server switch currently
exposes project-doc discovery), so bounded duplication is accepted over rules
silently not applying; revisit when the protocol exposes a switch (ADR-0012
covers native-access honesty).

Spec: [2026-06-11 workspace rules AGENTS.md](../../specs/2026-06-11-workspace-rules-agents-md.md).

## ADR-0019: Targeted Edits Are Anchored

Status: accepted.

On the OpenAI path, targeted edits travel as Aider-style exact-match
SEARCH/REPLACE blocks (`<<<<<<< SEARCH` / `=======` / `>>>>>>> REPLACE`,
line-anchored, case-insensitive markers, no label, no fences) applied
sequentially to the request's active-file snapshot. Each block must resolve to
exactly one viable (search, replace) split whose SEARCH matches the working
text exactly once — zero or ambiguous matches, malformed structure, or setext
`=======` collisions with no unique resolution fail the whole edit closed. A
failed edit produces no draft and replaces the visible answer with a
deterministic localized failure sentence so the model can self-correct next
turn. `FULL_REPLACEMENT` remains the rewrite path and wins when both are
present; `NEW_DOCUMENT` coexists with anchored edits. Codex native patches and
the remote profile are untouched; a leaked anchored block fails a Telegram
request closed.

Why: requiring the entire replacement document for a one-word fix is slow,
expensive, and invites unrequested rewrites. Anchored blocks make untouched
regions byte-identical by construction — source-as-contract enforced at the
transport level — and the downstream review pipeline (diff, hunks, per-hunk
accept) was already shaped for targeted changes.

Consequence: the model must copy SEARCH text verbatim and uniquely (the prompt
demands surrounding lines to disambiguate); CRLF-on-disk documents fail
anchored matching closed (documented limitation); the streaming cutoff and
Telegram marker guard both recognize the anchored opener.

Spec: [2026-06-11 anchored edits search replace](../../specs/2026-06-11-anchored-edits-search-replace.md).
