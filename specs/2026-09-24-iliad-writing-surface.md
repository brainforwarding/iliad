# Iliad Writing Surface: Remove the Internal Agent, Work With Outside Agents

Date: 2026-09-24
Status: v2 — review panel folded in; pending Codex go/no-go
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

## v2 decisions (override the stage text above where they differ)

Review panel: UI/UX agent, architecture agent, Codex `gpt-6-sol` high (NO-GO on v1).

Stage order and scope

- V1 Stage A keeps `selectionCommentsStore` + its IPC and the comment UI working
  (only the send-to-agent path is removed). They are retired in Stage D after
  file-backed comments and the migration exist.
- V2 Review IPC keeps the existing `agent:*` channel names (no rename); handlers
  move to `electron/ipc/review.ts`, call the baseline service directly, and
  resolve the workspace root from `workspaceSessionId` instead of trusting a
  renderer-sent root. Keep the `externalRevisionRef = 0` reset on workspace
  change when `getExternalReview` replaces `listProposals`.

Per-chunk review (Stage B)

- V3 Chunk ids stay positional (`${fileId}-hunk-${n}`); every action carries the
  baseline and disk hashes the renderer saw and main rejects mismatches as
  `stale`. Content-addressed ids are cut.
- V4 Guarded replacement for every outside-review Restore (chunk and file):
  rename the current file to a hidden holding path (atomic), verify the held
  bytes hash to the expected disk hash; on mismatch rename it back and return
  `stale`; on match write the new content to a temp file in the same folder and
  publish it with a no-clobber operation (hard link temp → path, which fails
  with EEXIST if anything appeared at the path; then remove the temp), then
  move the held original to the Trash (never delete it: a writer with an
  already-open descriptor may still write into that inode; if trashing fails
  it stays at its unique hidden holding path). Any no-clobber failure (including putting the held file
  back on mismatch) leaves the newer file untouched, keeps the held bytes via
  the existing held-file recovery pattern (`returnHeldFile`: a unique
  `name (outside copy N).md` published by no-clobber hard link), and returns
  `stale`. Restoring an outside deletion creates the file exclusively
  (`O_EXCL`). Replaces the read-then-truncate write (`writeNoFollow`) for
  restores.
- V5 Conflict mode: no Keep action (file, chunk, Keep all, last chunk) may load
  disk over a dirty buffer. After any review action, resume autosave only if
  disk still equals the buffer's `savedText` hash; otherwise stay in conflict.
- V6 Labels: outside edits use **Keep / Restore** (chunk) and **Keep all /
  Restore all** (file toolbar and tree strip); outside-created files **Keep
  file / Move to Trash**; outside deletions **Confirm deletion / Restore file**;
  tighten stays **Accept / Reject** (singular labels). Drop `rejectRemaining`.
- V7 Keyboard: Esc and Tab never act on outside chunks (no disk write by
  accident); after Keep/Restore focus moves to the next chunk's Keep button.
  Tighten keeps Tab/Esc.
- V8 Whitespace-only chunks stay separate in v1 (backlog: merge with neighbour).

Companion files (Stage D)

- V9 One pure `isCompanionPath(relPath)` by name shape only
  (`*.notes.md`, `*.comments.md`; the companion of any Markdown document
  extension is `stem.notes.md` / `stem.comments.md`), never by sibling
  existence. Applied in `classify` (null), `scanDirectory`, before every
  baseline `set`/move/reconcile record, and as an early return in
  `noteDiskChange`. Companions never enter outside review and never lock.
- V10 Main annotates `FileTreeNode` with `companion: {kind, documentPath}` when
  the sibling document exists (no mirrored renderer helpers). Orphans are
  ordinary rows (no marker, no reattach UI).
- V11 Tree: companion child rows appear only under the active document and
  when search reveals them; labels "Notes" and "Comments · N". Companion
  context menu: Open, Reveal in Finder, Move to Trash.
- V12 No companions of companions: comments and "Open notes" are disabled when
  the active file is a companion; creating/renaming documents to
  companion-shaped names is rejected.
- V13 File ops: preflight every target path of the group (document +
  companions); duplicate picks a stem free for the whole group; companion
  moves use hard-link-then-remove-source (no silent overwrite); all group paths
  go into `runIliadMutation.paths`; trash the document first, then companions,
  reporting failures (no rollback for trash).
- V14 Comments file format: entries separated by a blank line, `---`, blank
  line. Each entry: a metadata line `<!-- iliad:comment id=<id> -->`
  (plus `occurrence=N prefix="…"` only when the quote is not unique), the
  quoted passage as a blockquote (multi-line allowed), then the comment text.
  Comment lines that equal `---` or start with `>` are escaped (`\---`, `\>`);
  unknown text between entries is preserved as comment text. Round-trip tests
  cover separators, `>` lines, multi-line quotes, duplicates.
- V15 Re-anchoring: a duplicate quote anchors only if its stored prefix still
  matches that occurrence; otherwise the comment is detached (never guesses).
- V16 File-backed comments hook: positions are kept in memory; the file is
  written only when the serialized entries differ from the last disk text
  (not on every position change). Merge on `disk_changed` is three-way by id
  (last-read disk, local, fresh disk): an outside deletion wins unless the
  comment text was edited locally. `flushPersist` returns a promise chained into
  `flushSave`; a read of a path waits for that path's pending write.
- V17 Comments removed outside during this session are remembered per document;
  if the writer restores the outside edit of that document (chunk or file),
  those comments whose quote is found again are re-added automatically.
- V18 Detached comments: "N detached comments" in the existing editor toolbar
  slot, hidden while that document has a pending outside review; list with
  Delete only.
- V19 Migration of legacy comments is per workspace on attach: move that
  workspace's entries (skip documents that no longer exist), rewrite the JSON
  without them, delete the JSON when empty. The reader remains for migration.
- V20 Notes: the whole file is guidance (no template, no heading parsing);
  "Open notes" creates an empty `stem.notes.md` and opens it (Back returns).
  Autocomplete ranks lines with `selectWritingGuidance` over the whole text.
- V21 `file:remove-companion` reuses `removeMarkdownIfUnchanged`, limited to
  companion paths.

Gemini (Stage C)

- V22 Share request/response handling with autocomplete but keep the SSE
  streaming path, cancellation and `STOP` rules; tighten maps MAX_TOKENS and
  SAFETY to explicit failures with neutral wording.
- V23 Writing assists: with no key, the Gemini key field is the first row; with
  a key, a quiet bottom row "Gemini key ••••1234 · Change". No "Using Gemini"
  note. ✦ AI without a key is shown disabled; clicking opens Writing assists
  at the key field. Leftover copy ("Check assistant settings", Codex, API
  fallback) removed.

CLI (Stage E)

- V24 Launcher chosen by where the script lives: inside an app bundle → that
  app; inside a checkout with `node_modules/.bin/electron` → the checkout;
  `ILIAD_APP` overrides. The packaged wrapper runs the script with
  `ELECTRON_RUN_AS_NODE=1` and the spawned GUI app gets an env **without**
  `ELECTRON_RUN_AS_NODE`.
- V25 `open`: `realpath` the file; target window = open window whose canonical
  workspace contains it (longest root), else a new window for the file's own
  directory (no git-root). Cold start: launch the app with that folder (never
  the file or a subcommand as argv), then retry the socket. The open request is
  queued in the window manager and pulled by the renderer once the workspace is
  loaded (same pattern as `getLaunchWorkspace`); the socket replies only after
  the renderer acknowledges the document opened and the line was revealed, and
  returns its failure otherwise.
- V26 Socket: `chmod 0600` right after `listen`.
- V27 Output: `status` one line per window (`~/dev/book  chapters/03.md
  (focused)` or `no document open`); not running → `Iliad is not open.` exit 3;
  `open` silent on success; `skill install` → `Installed skill: <path>`. Menu
  "Install ‘iliad’ Command…" shows where it installed and warns if that folder
  is not on PATH.
- V28 Skill description: "Use when editing Markdown in a folder open in the
  Iliad app, or when the user refers to 'this document', 'my comments' or 'my
  notes'." Rules: run `iliad status` first; read `stem.notes.md` before
  writing; address `stem.comments.md` entries and delete only handled ones
  (keep the metadata line with its entry); minimal edits (no reflow or
  whitespace churn — each chunk becomes a review item); finish with `iliad open
  <file> --line N`; never create or rename companions; Markdown only.

Rejected or deferred

- Attribution ("changed by …"), per-chunk review of creates/deletes, baseline
  persistence across restarts: deferred (non-goals).
- Orphan marker and "reattach" UI, "reattach to selection" for detached
  comments, heading-parsed notes, notes template: cut.

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

1. A (removal + slim services + review IPC move, comments store kept) —
   foundation; everything else builds on it. Verify: typecheck/test/build, outside review still works
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

- [x] v1 spec written
- [x] Review panel (UI/UX, architecture, Codex) → v2
- [x] Codex go/no-go on v2 (V4 fixed as prescribed)
- [x] A removal (1de8393) — app-verified: no panel, outside review works, key row
- [x] C Gemini tighten + key UI (with A)
- [x] B per-chunk (7e16291) — app-verified: Keep one chunk + Restore other → disk correct
- [x] E CLI + skill (branch worktree-agent-acd2d817aa39f4f0d, f58dade; merges
  cleanly with B — verified in qa-integration: status/open/errors against the app)
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
- v2: UI/UX review (labels, keyboard safety, comments serializer, tree
  companions only under the active document, notes without template, key
  placement, skill wording, CLI output); architecture review (companion
  exclusion across all baseline paths, ELECTRON_RUN_AS_NODE leak, store
  sequencing and per-workspace migration, comment write churn and 3-way merge,
  comments lost on restore, open queueing/ack, no git-root, companions of
  companions, launcher by script location, group preflight); Codex NO-GO
  (conflict-buffer overwrite on Keep, restore truncate race, exclusion
  coverage, migration sequencing, anchor guessing, merge identity, open ack,
  streaming preserved; cuts: content-addressed ids, channel rename, mirrored
  helpers). All adopted as V1–V28 except the listed cuts.
- v2 Codex second pass: all earlier findings resolved except V4 (final rename
  could clobber a concurrently created file; deletion restore). V4 now
  specifies no-clobber publish, held-file recovery, exclusive create — exactly
  the fix given; treated as GO without a third pass.
