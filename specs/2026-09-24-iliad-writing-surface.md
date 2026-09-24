# Iliad Writing Surface: Remove the Internal Agent, Work With Outside Agents

Date: 2026-09-24
Status: v1 — pending review panel
Branch: `iliad-writing-surface` (from `master` at `3e16899`)
Target release: Iliad MD 0.3.0 (GitHub release + local install + iliad.md site)
Figma: "Iliad — AI writing interactions" (file `i2BTwgceho8SqRYGZKjLhB`), page 1 = final Iliad, page 2 = website

## Reviewer brief

The product direction is decided by the owner (Sebastián, currently the only
user). Review the implementation plan: incorrect assumptions about the code,
regressions in outside-change review and file safety, missed edge cases in the
companion files and per-chunk review, CLI/socket security proportional to a
local single-user desktop app, and simpler approaches. Do not reopen the
product decisions listed under "Decided".

## Problem

Iliad carries a full internal agent (chat panel, Codex app-server runtime,
OpenAI runs, proposal store, history, context manifests, compaction, dictation,
Telegram remote) — roughly 17k lines — that duplicates what Claude Code and
Codex already do better, and it consumes most maintenance. Meanwhile the parts
that make Iliad valuable are the writing surface (inline completion, selection
AI actions, corrector) and reviewing what an agent changed. Outside changes are
only reviewable per file, comments and writing notes are hidden in app data
where outside agents cannot see them, and outside agents cannot tell which
document the writer is looking at.

## Decided (product, with the owner)

1. Iliad focuses on writing one document at a time (inline completion, ✦ AI
   menu, corrector). Larger or multi-document AI work is done by outside agents
   (Claude Code, Codex) writing to the folder; Iliad is where the writer reviews it.
2. Remove the assistant/chat panel, the internal agent runtime (Codex
   connection, OpenAI runs/key, proposals, history, context), voice dictation,
   and the Telegram remote (including `relay/telegram/`).
3. All built-in AI runs on one Gemini key: autocomplete (already) and the ✦ AI
   selection menu (moves from Codex/OpenAI to Gemini).
4. Outside changes are reviewed chunk by chunk (Keep / Restore per chunk), with
   Keep all / Restore all per file kept.
5. Per-document companion files next to the document:
   `name.notes.md` (writing notes: voice/audience, facts) and
   `name.comments.md` (comments anchored to quoted passages). Grouped under the
   document in the tree. When an agent handles a comment it deletes it from the
   file.
6. An `iliad` CLI for outside agents: `iliad skill install`, `iliad status`,
   `iliad open <file> [--line N]` (plus the existing `iliad <folder>`), and a
   Claude skill shipped with Iliad describing what Iliad renders and how to
   work with it. No `iliad selection`, `iliad comments`, `iliad notes` (files
   make them unnecessary).
7. Done = released as 0.3.0 (signed, notarized, GitHub release with update
   metadata), installed on the owner's Mac and verified there, iliad.md updated.

## Goals

- G1 Remove the internal agent and everything only it needs, without breaking
  outside-change review, tighten/edit, autocomplete, corrector, comments.
- G2 One Gemini key powers all built-in AI; its setting lives in Writing assists.
- G3 Per-chunk Keep/Restore for outside edits of existing files.
- G4 Notes and comments are plain companion Markdown files that move with their
  document and are readable by any agent.
- G5 `iliad status` / `iliad open` / `iliad skill install` work against the
  running app (dev checkout and packaged app); the packaged app can install the
  `iliad` command.
- G6 Docs, ADR, and site reflect the new product; 0.3.0 shipped and verified.

## Non-goals

- Attribution of outside changes to a specific tool/run ("changed by Codex").
- Per-chunk review of outside-created or deleted files (file-level stays).
- Persisting the baseline across app restarts (unchanged: in-memory per session).
- MCP server; Windows/Linux CLI polish (macOS first; code stays portable).
- Deleting stale data left in `userData/assistant/*` by old versions (ignored;
  harmless). Exception: comments and notes are migrated (below).

## Design

### Stage A — Remove the internal agent

Remove (per the removal map; see "Removal map" appendix for file lists):
chat panel and `src/components/assistant/*`, `src/assistant/useAssistantRun.ts`,
`useDictation`, chat history, streaming, context attachments (except helpers
still used), `electron/agent/runtime/*`, `openai/*`, proposal store/drafts,
context manifests/tools, transcription, compaction, chat stores,
`workspaceMutationLease` and all Codex lease/journal hooks in the baseline
service, `electron/remote/*`, `electron/ipc/remote.ts`, `relay/telegram/`,
related tests and scripts (`relay:*`, `smoke:review`; `benchmark:autocomplete`
becomes Gemini-only or is removed), `react-markdown`/`remark-*`/`rehype-katex`,
the microphone usage string and audio-input entitlement, `assistant.css`.

Keep and slim:

- `electron/writing/writingAiService.ts` (new home, replaces `AgentService` for
  writing AI): `autocompleteIdea` (Gemini only), `tightenSelection` (Gemini),
  `writingAssistStatus` (Gemini only), `getSettings()/setGeminiApiKey()`.
  A shared `electron/writing/geminiText.ts` does the generateContent call
  (factored from `geminiAutocomplete.ts`) for both autocomplete and tighten.
- Key storage: slim `settingsStore` to the Gemini key only, same file
  (`userData/assistant/settings.json`) so existing keys keep working; env
  fallbacks `GEMINI_API_KEY`/`GOOGLE_API_KEY` stay.
- `electron/review/*` stays. A new `electron/ipc/review.ts` exposes the review
  surface directly on the baseline service (no `AgentService`):
  `review:get`, `review:keep-file`, `review:restore-file`, `review:restore-all`,
  `review:keep-chunk`, `review:restore-chunk`, push `review:changed`.
  Channel rename is done in one change across main, preload, types.
- `isTrustedAgentIpcSender` moves to `electron/ipc/trust.ts` (renamed
  `isTrustedIpcSender`); autocomplete, tighten, corrector-memory import it.
- Renderer: `useAgentProposals` becomes `src/app/useOutsideReview.ts`, external
  only (no internal branches, no `flushSave` before review actions, no
  `listProposals` merge; first load uses `review:get`). `reviewQueue`,
  `pendingFileTree`, `reviewNavigation` lose internal-source branches and move
  from `src/assistant/` to `src/review/`. Type names (`AgentChangeProposal` etc.)
  stay to limit churn.
- App layout: no right column; topbar loses the assistant toggle.
- Old stored internal proposals, chat history, Codex home, run journals are
  simply no longer read.

### Stage B — Per-chunk review of outside edits

Model: for an outside `edit`, disk = baseline + all chunks (all pending).
Per-chunk actions collapse into new baseline or new disk text; no per-chunk
status is stored.

- Chunk ids become content-addressed: `hash(oldStartLine | old lines | new lines)`
  within the file, so re-projection after an unrelated change keeps ids.
- Request carries `{fileId, chunkId, baselineHash, diskHash}` exactly as the
  renderer saw them; main (on `enqueueWrite`) requires both hashes to match the
  current item, recomputes chunks from the item, finds the chunk; otherwise
  refreshes and returns `stale` (existing stale notice).
- Keep chunk: `baseline := reconstruct(baseline, [chunk])` (no disk write).
  When baseline equals disk the item disappears.
- Restore chunk: git-HEAD guard as today, last-look re-read, write
  `reconstruct(baseline, all chunks except this one)` through the same direct
  path `restoreItem` uses (not `writeMarkdownIfUnchanged`, which refuses
  pending paths and advances the baseline). Baseline unchanged.
- Creates/deletes stay file-level. Keep all / Restore all per file unchanged.
- Renderer: the review extension shows Keep / Restore on each chunk of an
  outside edit (buttons exist; `hideHunkActions` removed for outside edits);
  after an action: `refreshExternalReview`, reload the active document from
  disk unless the editor is in conflict; no `flushSave`. Hidden while in
  conflict mode (unchanged).
- Whitespace-only chunks: shown as their own chunks (no merging in v1).
- Tighten inline review keeps its own accept/reject (unchanged).

### Stage C — Gemini for the ✦ AI menu; key in Writing assists

- `tightenSelection` calls Gemini (`gemini-3.8-flash`, thinking `low`) with the
  existing `selectionTransformInstruction`, `tightenModelInput`, cleaning and
  validation; output budget raised to fit thinking (Gemini counts it).
- Writing assists menu: new "Gemini API key" row (masked, Save / Change,
  "Get a key" link to Google AI Studio) replacing the assistant-panel field.
  Autocomplete note shows "Using Gemini 3.8 Flash" or "Add a Gemini API key".
- Remove API fallback / Codex / OpenAI strings, props and preferences.
  Unavailable states: ✦ AI hidden-disabled with "Add a Gemini API key" title.

### Stage D — Companion files (notes and comments)

Naming and identity

- For document `dir/name.md`: `dir/name.notes.md`, `dir/name.comments.md`.
  A `.notes.md`/`.comments.md` file is a companion only if `name.md` exists in
  the same folder; otherwise it is an orphan companion (shown, flagged).
- Creating or renaming a document to a companion-shaped name
  (`*.notes.md`, `*.comments.md`) is rejected with a clear message.
- Shared pure helpers in `electron/fs/companionFiles.ts`, mirrored in
  `src/files/companionFiles.ts`.

Review and safety

- Companions are excluded from outside-change review (scan filter, refresh
  scope, records) but remain writable only through the compare-and-swap write.
  Rationale: an agent deleting a handled comment or editing notes is metadata,
  not document text; reviewing it would also lock the file (`pending_review`)
  and block the writer's own comment writes. The document text the agent
  changed is still reviewed per chunk. (Deviation from what was first described
  to the owner — "you see the comment deletion in review" — recorded here.)

File operations (main, inside the same `runIliadMutation`)

- Rename/move document: preflight availability of companion targets, move the
  document, then each existing companion; roll back on partial failure; one
  `move` record per path.
- Duplicate: companions copied next to the copy using the copy's final stem.
- Trash: existing companions trashed with the document.
- Companion rows: no rename/move/duplicate/drag (they follow the document);
  orphans can be renamed (to reattach) or trashed.
- Renderer flushes pending companion writes before file operations (same
  `flushSave` chain).

Tree

- `buildFileTreeDisplayNodes` attaches companions to their document node;
  `TreeRow` renders them as child rows ("Notes", "Comments") when the document
  is the active document or expanded; orphans stay in place with an orphan
  marker. Search matches on companions reveal them under the document.

Comments file format (`name.comments.md`)

```markdown
> Durante dos minutos, una persona cuenta un desafío reciente.

Esto es muy largo.

---

> Al terminar, cada pareja comparte una frase

¿Una frase o una idea? Aclarar.
```

- Entries separated by a line `---`. Each entry: a blockquote (the exact quoted
  passage, may span lines) then the comment text. Optional metadata line
  `<!-- iliad: occurrence=2 prefix="…" -->` written only when the quote is
  not unique in the document. Blockquote chosen over a heading so multi-line
  quotes round-trip.
- Parse/serialize in pure `src/comments/commentsFile.ts`; anchoring reuses
  `selectionCommentsAnchor.ts` (quote → occurrence → prefix; never guesses).
- `src/app/useSelectionComments.ts` becomes file-backed: reads the companion on
  document open and on watcher change events for that path; writes debounced
  through `writeMarkdown` CAS; on `disk_changed` re-reads, reapplies the local
  edit (add/update/delete by quote+comment identity), retries once, then
  surfaces an error. No statuses (in the file = open). Deleting the last
  comment deletes the file (new guarded `file:remove-companion` IPC, limited to
  companion paths).
- Detached comments (quote no longer found — e.g. the agent rewrote the
  passage): shown in a small "N comments lost their passage" notice above the
  editor with a list (quote + comment, Remove / Reattach to selection).
- Migration: on first workspace attach after upgrade, main moves pending
  comments from `userData/assistant/selection-comments.json` into companion
  files (merge if a file exists), then renames the JSON to `.migrated`.

Notes file format (`name.notes.md`)

```markdown
## Voice & audience
Informal, second person, for new facilitators.

## Facts
- The activity lasts 20 minutes.
```

- Free Markdown; if the headings are present, "Voice & audience" feeds `voice`
  and "Facts" lines feed `facts`; otherwise the whole file is treated as facts.
  Autocomplete keeps using `selectWritingGuidance` (relevance-ranked, capped).
- Writing assists "Writing notes" becomes one action: "Open notes" (creates the
  file from the template if absent and opens it in the editor). The "Use for
  this document" toggle is removed (file present = on).
- Notes are read on document open and on watcher changes; not cached across
  documents.
- Migration: localStorage notes for a document are written to its notes file
  (only if absent) the first time the document is opened, then the key removed.

### Stage E — CLI and skill

Transport: a Unix domain socket `userData/iliad.sock` (mode 0600, stale socket
unlinked on start since the single-instance lock guarantees one listener,
removed on quit). Newline-delimited JSON, one request per connection,
`{v:1, cmd, ...}` → `{ok, ...}` or `{ok:false, error}`. Dev runs with
`VITE_DEV_SERVER_URL` use their own userData and therefore their own socket.

- Main tracks per window: workspace (exists) and active document (new renderer
  push `window:set-active-document` on active-file change).
- `status` → `{windows:[{workspace, document, focused}]}`; CLI prints a short
  human form, `--json` for machines. Not running → exit 3, "Iliad is not open".
- `open <file> [--line N]`: CLI resolves the absolute path; main picks the
  window whose workspace contains it (longest root), else opens a window for
  the file's folder (git root if inside one, else the file's directory), then
  sends `cli:open-document {path, line}`; the renderer opens it via
  `openNode` (flushes saves) and reveals the line via the existing
  content-search reveal. Non-Markdown/unsafe path → error. If the app is not
  running, the CLI launches it (below) and retries the socket for up to 10 s.
- `skill install` copies the bundled `SKILL.md` to `~/.claude/skills/iliad/`
  (overwrites; prints the path). `skill print` writes it to stdout (for Codex
  `AGENTS.md` or other agents).
- `iliad <folder>` unchanged.
- Launcher resolution order: `ILIAD_APP` env → running from inside the app
  bundle → `/Applications/Iliad MD.app` / `~/Applications/…` → dev checkout
  (`node_modules/.bin/electron`). The packaged app is launched by spawning its
  executable with args (argv preserved).
- Packaging: `bin/` and `resources/skill/` shipped via `extraResources`; the
  app menu gets "Install ‘iliad’ Command…", which symlinks
  `Contents/Resources/bin/iliad.mjs` (via a tiny sh wrapper that runs it with
  the app's bundled Node? — see Open question Q1) into the first writable of
  `/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`, and reports where.

Skill content (`resources/skill/iliad/SKILL.md`): when to use it (Markdown
workspace open in Iliad), `iliad status` to find "this document", `iliad open`
to show results, companion files (read notes before writing; read comments,
address each, delete handled entries; keep/rename companions with documents),
what Iliad renders (headings, lists, task lists, tables, math, images under
`assets/<document-slug>/`, YouTube links), that edits are reviewed by the writer
per chunk (write directly; do not ask permission per file), Markdown only,
don't touch hidden files.

### Stage F — Docs and ADR

- ADR-0021 in `docs/context-management/decisions.md` (or a new
  `docs/decisions.md` if that file is removed with context-management docs):
  "Iliad has no internal agent; outside agents write, Iliad reviews."
- Rewrite `docs/agent-vision.md` → `docs/product-vision.md` (writing surface +
  review for outside agents; decision test updated). Update
  `docs/architecture.md`, `docs/source-as-contract.md` (companion files),
  `README.md`, `CLAUDE.md`, `docs/outside-changes-qa-matrix.md`,
  `docs/backlog.md`. Remove docs wholly about the removed agent (list in
  appendix). Specs stay as history.

### Stage G — Release and site

Follow `docs/release.md` exactly: version 0.3.0, lint/typecheck/test/build,
`npm audit --omit=dev`, signed + notarized DMG/zip, staple, refresh and verify
update metadata, GitHub release with the exact artifacts, push source
(fast-forward `origin/master`), install locally, verify. Update iliad.md from
the Figma page 2 direction (content in sync with 0.3.0, release notes, docs
pages for removed features) and deploy with `deploy.sh`; verify live.

## Open questions (engineering, resolved by the main agent)

- Q1 Packaged CLI runtime: the packaged app has no standalone `node`. Options:
  run the CLI with the app executable in Node mode (`ELECTRON_RUN_AS_NODE=1
  "Iliad MD" iliad.mjs`) via a sh wrapper — no Dock icon, no dependency on a
  system Node. Preferred.

## Acceptance criteria

1. No chat panel, no Codex/OpenAI settings, no dictation, no Telegram anywhere
   in the app, build, or package; microphone entitlement gone.
2. With only a Gemini key: autocomplete (all lengths), ✦ AI menu presets and
   typed instructions work; without a key both show the add-key hint.
3. An outside edit with ≥2 chunks: Keep one chunk → only that chunk leaves
   review, disk unchanged; Restore one chunk → disk loses only that chunk; stale
   when the file changed meanwhile; Keep all / Restore all still work;
   create/delete file-level still work; conflict banner behavior unchanged.
4. Comments: create/edit/delete in Iliad writes `name.comments.md`; an outside
   edit deleting an entry removes the comment wash; a rewritten passage shows
   the comment as detached; rename/move/duplicate/trash carry companions;
   legacy comments migrated.
5. Notes: "Open notes" creates/opens `name.notes.md`; autocomplete uses it;
   legacy notes migrated.
6. `iliad status`, `iliad open file --line`, `iliad skill install`,
   `iliad <folder>` work with the installed 0.3.0 app; the menu installs the
   command.
7. `npm run typecheck`, `npm test`, `npm run lint:css`, `npm run build`,
   `npm audit --omit=dev --audit-level=high` pass; QA matrix rows for outside
   review re-run.
8. 0.3.0 published per `docs/release.md` with verified update metadata,
   installed at `/Applications/Iliad MD.app` and smoke-tested; iliad.md live.

## Implementation plan (stages and order)

1. A (removal + slim services + review IPC rename) — foundation; everything
   else builds on it. Verify: typecheck/test/build, outside review still works
   in the app.
2. C (Gemini tighten + key UI) — small, depends on A.
3. B (per-chunk) and E (CLI + skill) in parallel (different areas; E touches
   main.ts/preload/types lightly).
4. D (companion files) — after B (both touch the baseline scan/records).
5. F docs; G release + site.

Each stage: implemented by a subagent against this spec, reviewed and
integrated by the main agent, committed on the branch with tests green.

## Tests

- Removal: suite green after deleting the listed tests; a guard test that the
  preload API has no `agent.startRun`/`remote`/`transcribe`.
- Per-chunk: baseline service unit tests (partial keep leaves partial baseline;
  last keep clears; restore writes disk minus chunk, baseline unchanged; hash
  mismatch → stale, nothing written; disk change → stale; whitespace split
  pair; content-addressed ids stable across unrelated re-projection).
- Companions: pure naming/orphan tests; file-op tests (rename/move/duplicate/
  trash carry companions, rollback, name rejection); baseline scan excludes
  companions; comments file parse/serialize round-trip (multi-line quote,
  duplicate quote with occurrence metadata, unknown text preserved as comment);
  hook merge on `disk_changed`; notes parsing; migrations.
- CLI: argv router, protocol codec, socket server (status/open/errors) with a
  fake window manager, launcher resolution; skill install to a temp HOME.
- Gemini tighten: request shape, cleaning, failure mapping.

## Risks

- Large deletion breaks hidden couplings → staged commits, green suite per stage,
  app smoke after A.
- Per-chunk restore racing an agent still writing → hash checks + last-look;
  worst case "stale", never silent overwrite.
- Companion excluded from review lets an agent rewrite notes silently → accepted
  (notes are guidance; the agent's document edits are still reviewed).
- CLI socket: local only, 0600 in the user's own Library; commands are
  read/navigation only (no writes); acceptable for a single-user desktop app.

## State (resumable)

- [ ] v1 spec written
- [ ] Review panel (UI/UX, architecture, Codex) → v2
- [ ] Codex go/no-go on v2
- [ ] A removal
- [ ] C Gemini tighten + key UI
- [ ] B per-chunk
- [ ] E CLI + skill
- [ ] D companion files
- [ ] F docs + ADR
- [ ] G release 0.3.0 + install + site

## Appendix: removal map

Source: exploration on 2026-09-24 (see agent report summary in the review log).
Main files to remove: `src/components/AssistantPanel.tsx`,
`src/components/assistant/*`, `src/assistant/{agentModels,chatHistory,runEntries,
selectionContext,streaming,useAssistantRun,useDictation,useMarkdownContextDocuments,
pendingReviewState}.ts`, `src/components/markdown/MarkdownContent.tsx`,
`src/styles/assistant.css`, `electron/agent/{agentModels,chatHistoryStore,
compactionCacheStore,contextManifest,contextManifestStore,contextPaths,
conversationHistory,documentContext,documentTools,openaiResponses,proposalDrafts,
proposalStore,textStream,transcription,workspaceMutationLease,selectionCommentsStore}.ts`,
`electron/agent/openai/*`, `electron/agent/runtime/*`, `electron/remote/*`,
`electron/ipc/{remote,agent,selectionComments}.ts`, `relay/telegram/`,
`scripts/reviewDiffSmoke.mjs`, and their tests. Split: `agentService.ts`
(→ writing + review services), `types.ts`, `settingsStore.ts`, `reviewDiff.ts`,
`autocomplete.ts`, `errors.ts` (OpenAI wording), `App.tsx`, `preload.ts`,
`src/types/iliad.ts`, `strings.ts`, `useAgentProposals.ts`, `assistantUtils.ts`,
`contextAttachments.ts`, `reviewQueue.ts`, `main.ts`.
Docs wholly about the removed agent: `docs/agent-panel-v1-architecture.md`,
`docs/agent-runtime-roadmap.md`, `docs/internal-agent-review-workflow.md`,
`docs/deterministic-review-note-policy.md`,
`docs/review-render-diagnostics-and-delete-notes.md`,
`docs/context-management/*` (ADRs move), `docs/research/chatgpt-login/*`,
`docs/research/agent-chat-ux-patterns.md`,
`docs/research/agentic-architecture-survey.md`.

## Review log

- v1: written from four code maps (removal, per-chunk review, companions/file
  ops, CLI/launch).
