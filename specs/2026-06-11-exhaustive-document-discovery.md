# Exhaustive document discovery (the agent must find files that exist)

Date: 2026-06-11
Status: implementation-ready (v2 — revised after a four-lens panel: backend, security, testing, product fidelity; review log at end)

## Reviewer brief

Read first: `electron/agent/documentTools.ts` (traversal + limits — the bug lives here), `electron/agent/openai/documentTools.ts` (schemas, arg validation, output serialization, tool budgets; shared by Codex via `runtime/codexDocumentTools.ts`), `electron/agent/documentContext.ts` (`candidatePathsForMention`, `listedExtensionlessCandidatePaths`), `electron/agent/openai/prompts.ts` + `runtime/codexAppServerProvider.ts` (four document-tool policy blocks: default + remote per provider; `safeDocumentToolArguments`), `electron/fs/pathSafety.ts` (`ignoredNames`), `tests/agent/documentTools.test.ts`. Industry reference (best practices, not invention): Claude Code's Glob/Grep — filename discovery is **exhaustive over the workspace tree** with output-count caps, content search scoped by an optional `path` parameter; Cursor and VS Code index all paths and use ripgrep; Codex CLI uses `rg`/`find`. No mature tool truncates filename discovery at a small traversal slice.

## Problem (reproduced 2026-06-11)

The user asked: *"en el curso odisea encuentra la sesión 2 s2.md"*. The file exists at `courses/curso-odisea/curso-1/s2/s2.md`. The agent ran 5+ searches, all `0–50 resultados · 598 rutas revisadas · búsqueda limitada`, guessed a wrong path, and asked the user. The matching logic was never the problem — the alias expansion (`sesión 2` → `s2`) would have matched. **The file was never collected.**

Root causes, in `documentTools.ts`:

1. `collectMarkdownFiles` aborts at `maxDirectories: 200` / `maxFilesystemEntries: 2_000`. The walk is alphabetical (case-sensitive, uppercase first), so a real workspace burns the budget on early siblings before reaching `courses/curso-odisea` — the target was beyond the traversal slice on every attempt.
2. `listDocuments` defaults to depth 1 with `maxDepth: 2` — it cannot enumerate a 4-level course tree.
3. `maxContentSearchDepth: 2` makes deep content unsearchable at any budget; content candidates are also taken alphabetically (`.slice(0, maxContentSearchFiles)`) — the same starvation in content form.
4. The model cannot scope a search, so its only retry is repeating the identical capped query (observed 5×, burning the 8-call tool budget).
5. (Found in review) Extensionless `@`-mention resolution has the same bug at another layer: `listedExtensionlessCandidatePaths` matches against a `listDocuments` output **sliced to 500 alphabetical rows**, and bails out of basename fallback whenever the listing is truncated.

## What the industry does (and what we will not do)

Converged pattern: **filename/path discovery is cheap and exhaustive; only output is capped.** Scoping (Grep's `path`) is the standard escape hatch.

Explicitly rejected: giving the model Python/shell for searching (owner suggestion, evaluated). It violates the documented tool boundary — `docs/agent-vision.md` "Tool Boundary" lists shell/terminal execution and "running Python or arbitrary scripts" under Avoid, and ADR-0009's non-goals include shell access — and it destroys receipt granularity (a script is not an auditable tool row). Structured, validated, receipted tools remain the boundary. No new ADR needed for declining something already documented as out of scope.

## Goals

- A file that exists is found by a single `search_documents` call naming its file, folder, or session alias — regardless of depth or alphabetical position, in workspaces up to tens of thousands of entries. Same guarantee for extensionless `@`-mentions.
- The model can scope a search to a directory and is prompted to narrow, not repeat, on a capped zero-result.
- `truncated` becomes the exception (genuinely pathological workspaces), and walks are abortable and cheap (no per-entry `lstat`).
- No new tools; no security regression (same path validation, symlink rejection, ignored/hidden filtering, Markdown-only reads).

## Non-goals

- No shell/Python/code execution (above). No persistent index or watcher (fresh bounded walk per call; source-as-contract favors the disk; revisit only if profiling demands). No embeddings. No ripgrep dependency. No UI changes.

## Design

### 1. Traversal budgets become backstops; the walk becomes cheap and abortable

```ts
maxDepth:               2 → 8        // list ceiling; default list depth stays 1
maxPathSearchDepth:     6 → 16
maxContentSearchDepth:  2 → 8
maxDirectories:         200 → 10_000
maxFilesystemEntries:   2_000 → 100_000
maxPathSearchFiles:     2_000 → 20_000
```

Output/IO budgets unchanged: `maxSearchResults` 50, `maxContentSearchFiles` 500, `maxListResults` 500, `maxReadBytes` 512 KB.

Walk mechanics (panel-mandated, the perf premise depends on them):

- **No `lstat` in the walk.** `readdir` already runs `withFileTypes: true`; `Dirent.isSymbolicLink()/isDirectory()/isFile()` cover all filtering. Entries of unknown type are skipped as unsafe. The walk collects `{ absolutePath, relativePath, name }` only.
- **Sizes are an output concern**: `listDocuments` stats only the ≤`maxListResults` rows it returns (stat failure → `skipped.unreadable`, row dropped). `searchDocuments` needs no sizes (`readSearchCandidate` already re-checks content candidates itself).
- **Memory bound**: collection stops once `maxPathSearchFiles` Markdown files are collected (sets `truncated`), in addition to the dir/entry caps.
- **Abortable**: the three tool methods accept an optional `AbortSignal` (second parameter); the walk checks it per directory and the content pass per file. The OpenAI/Codex executors and `documentContext` pass the signal they already hold.

### 2. Content candidates ranked by path relevance — within the depth filter

Selection over the (scope-relative, see §3) depth-filtered set: files whose path matched the query (`pathMatchRank` computed **once** in the path pass into a map) first — ordered rank 0 < 1 < 2, then existing order — then the remaining files, capped at `maxContentSearchFiles`. Ranking reorders **only within the depth-filtered candidates**: the existing test pinning `searchedFiles === 0` for a too-deep file under injected `maxContentSearchDepth: 1` must stay green.

### 3. Directory scope for search (the Grep `path` parameter)

- `SearchDocumentsInput.directory?: string`, resolved with `resolveDirectory` (error message parameterized by tool name — it currently hardcodes `list_documents`).
- **Scope-relative depth** (panel): with a scope set, the content-depth filter and the truncation computation count depth from the scope directory, not the workspace root — otherwise scoping into a deep folder leaves zero content-search levels, defeating the escape hatch. (`relativeDepth = documentDirectoryDepth(path) − scopeDepth`.)
- Schema (`openai/documentTools.ts`): `directory: { type: ["string", "null"] }` added to `search_documents` properties **and** `required` (the strict-mode all-required-nullable convention). Strict mode will emit `directory: null` on every unscoped call, so: `rejectExtraProperties` allowlist gains `"directory"`, and validation mirrors `list_documents` (null/undefined → unscoped; non-string → `invalid_arguments`). Codex inherits the schema via `codexDocumentDynamicTools()`.
- **Receipts**: `safeDocumentToolArguments` (Codex) gains a `search_documents` directory branch through the existing `safeActivityRelativePath` sanitizer, mirroring `list_documents` — a scoped search must not render as unscoped in the audit surface.

### 4. Tool output fitting must degrade, not fail

`fitSerializedToolOutput` only shrinks a string `content` field; outputs whose `files`/`matches` arrays exceed `MAX_TOOL_OUTPUT_BYTES` (96 KB) are replaced wholesale with `tool_output_too_large`. With depth-8+ paths, 500 list rows can exceed 96 KB — a new total-failure mode in exactly the workspaces this spec targets. Fix: for outputs carrying `files` or `matches` arrays, drop trailing rows until the serialization fits and set `truncated: true`.

### 5. Mention resolution stops depending on the sliced list

`listedExtensionlessCandidatePaths` switches from `listDocuments` (alphabetical 500-row slice + truncated-bail — the same starvation, which a deeper `maxDepth` would have made *worse* by flipping `truncated` in >500-file workspaces) to `searchDocuments`'s now-exhaustive path pass: query the mention text, then apply the existing exact-stem / single-basename / ambiguity rules over the returned path matches. The conservative bail survives as: if the search reports `truncated` and no exact match was found, refuse the basename fallback (never guess from partial coverage). Slashed extensionless mentions keep their direct extension-append resolution (no listing involved).

### 6. Prompt policy: narrow, don't repeat (all four blocks)

One instruction added to the document-tool policy in **four** places — `instructions()` default + `remote_read_only` (`openai/prompts.ts`) and `codexDeveloperInstructions` default + remote (`codexAppServerProvider.ts`, exported for tests): *"If a document search returns zero results and reports it was capped, scope the next search to the most likely directory with the `directory` input (or list that directory) instead of repeating the same query."* This composes with, not contradicts, the existing "ambiguous or fails → ask one focused clarification" line: a capped zero-result now means *scope once, then* clarify. Cost note: each retry consumes the shared per-run tool budget (8 calls, last reserved for `read_document`), which is exactly why the funnel must converge in two steps.

## Docs to update (same change — repo rule)

1. `docs/context-management/current-architecture.md` — "Current Limits": replace the "Document search is bounded…" bullet with: path discovery enumerates the tree up to backstop caps (10k directories / 100k entries / 20k Markdown files); output stays capped (50 matches / 500 list rows); content search reads ≤500 files preferring path-relevant candidates; searches accept a directory scope; "search capped" now signals an unusually large workspace and the model is told to scope, not repeat. Also update the "Implied Workspace References" prompt-policy quote to include the narrow-don't-repeat line.
2. `docs/context-management/README.md` — search paragraph gains directory scoping + exhaustive path coverage framing.
3. `docs/context-management/model-directed-context-tools.md` — tool surface line becomes `search_documents(query, directory?, limit?)`.
4. `docs/context-management/decisions.md` — amendment notes (no new ADR; budgets remain, resized to backstops; an input on an existing tool is not a new boundary): ADR-0009 gains "Amended 2026-06-11: traversal budgets are backstops against pathological trees, sized so real workspaces never hit them; output budgets remain the working limits; `search_documents` accepts an optional directory scope." ADR-0010 gains "Amended 2026-06-11: when a search is capped with zero results, the smallest useful next step is one directory-scoped retry; clarification comes after that."
5. `docs/context-management/change-log.md` — entry under 2026-06-11 with the limit changes, ranking, directory scope, prompt policy, mention-resolution fix, and the rejected shell/Python alternative.

## Implementation plan

1. `documentTools.ts`: limits, dirent walk + signal + collection cap, list-side stats, scoped + scope-relative search, rank-map candidate selection, parameterized `resolveDirectory`. Verify: unit tests.
2. `openai/documentTools.ts`: schema + validation + allowlist, signal passthrough to tool methods, array-aware output fitting. `codexAppServerProvider.ts`: receipt args branch, policy lines, export `codexDeveloperInstructions`. `openai/prompts.ts`: policy lines.
3. `documentContext.ts`: mention resolution via search.
4. Docs (section above).
5. `npm test`, `npm run typecheck`, `npm run build`.

## Tests

- `documentTools.test.ts`:
  - **Defaults pin**: assert the six new limit values on `createAgentDocumentTools({ workspaceRoot }).limits` (a typo like 1_000 vs 10_000 must not ship silently).
  - **Regression (the bug)**: ≥200 empty early-alphabetical sibling directories (`a-000…a-199` — lowercase sorts before `courses`; empty dirs keep mkdtemp fast) + target at `courses/curso-odisea/curso-1/s2/s2.md`, **default limits**: `search_documents("curso odisea sesion 2")` returns the path with `truncated: false`. Comment: 200 chosen to exceed the pre-fix `maxDirectories`.
  - Deep file (depth 6+) found by path search; `list_documents` `depth: 8` enumerates it; list rows still carry sizes.
  - **Ranking outcome** (passes only with the fix): injected `maxContentSearchFiles: 1`; `aaa.md` (no match) + `zzz-needle-phrase.md` (path + content match) → content match with `line > 0` found and `searchedFiles === 1` (the single slot went to the ranked candidate).
  - Ranking respects the depth filter: existing "finds deep course session paths…" test (injected `maxContentSearchDepth: 1`, asserts `searchedFiles === 0`, `skipped.oversized === 0`) stays green **unmodified**.
  - **Scope**: scoped search finds a content match inside a directory deeper than `maxContentSearchDepth` from the root (scope-relative depth); unsafe/hidden/missing/file-not-directory scopes raise the same errors as `list_documents`; tiny injected caps + scope prove scope is the escape hatch where unscoped truncates.
  - Abort: an already-aborted signal makes search/list throw promptly.
  - Caps still enforce at the new bounds (tiny injected limits).
- `openaiDocumentToolLoop.test.ts`: `search_documents` with `directory: null` succeeds (the case every strict-mode call hits); `directory: 123` → `invalid_arguments`; scoped call reaches the tool. Output fitting: a `files`/`matches` payload over the byte cap returns rows-dropped + `truncated: true`, not `tool_output_too_large`.
- `documentContext.test.ts`: bare-basename extensionless mention (dash, no digits — e.g. `@pauta-evaluacion`) of a depth-4 file resolves into `contextDocuments` with `source: "explicit_file_mention"`; companion with injected tiny limits where truncated + no exact match still refuses basename fallback.
- `prompts.test.ts`: the narrow-don't-repeat line present in all four policy blocks (`instructions()` both profiles; `codexDeveloperInstructions` both profiles).
- `codexAppServerProvider.test.ts` (extend): scoped search surfaces the sanitized directory in tool args/receipts.

## Risks & mitigations

- **Slow walks on huge/network volumes**: no per-entry stat; per-directory abort checks; backstop caps; `ignoredNames` + hidden filtering prune the usual offenders.
- **Memory**: collection cap at 20k path entries (~few MB), single sort.
- **Schema drift**: Codex consumes the OpenAI schemas verbatim.
- **Mention-resolution behavior change**: conservative bail preserved; exact matches always win; covered by both new tests.
- **Model retry loops**: scoped-retry instruction + exhaustive coverage converge the funnel; budget pressure documented.

## Review log (v1 → v2)

Four-lens panel. **Product (needs_revision)**: BLOCKER — no docs section; added with the five exact edits (current-architecture Current Limits + prompt quote, README, model-directed-context-tools signature, change-log) plus ADR-0009/0010 amendment notes and the agent-vision.md citation for the shell/Python rejection. Prompt-policy composition with the existing "fails → clarify" lines specified (scope once, then clarify) with the four exact blocks named and the tool-budget cost noted. **Backend/security (needs_revision)**: §5's "no code change" claim was false — mention resolution is starved by the 500-row alphabetical list slice and its truncated-bail, and a deeper walk would have *regressed* it; redesigned to resolve through the exhaustive search path pass. Scope-relative depth defined (workspace-relative filtering would have defeated scoping in deep folders). Per-entry `lstat` removed from the walk (Dirent types; sizes only for returned list rows) and `AbortSignal` threaded through — the 100k-entry perf premise was false for the lstat-per-entry implementation. 96 KB output fitting extended to drop `files`/`matches` rows instead of failing wholesale. Memory bounded by collection cap; rank computed once into a map with intra-group ordering (0<1<2); `resolveDirectory` error message parameterized; scoped directory surfaced in Codex receipts via the existing sanitizer. **Testing (needs_revision)**: regression test shape made reproducing (200 empty early dirs vs. vague "several folders"); defaults-pinning test added; ranking constrained to the depth-filtered set so the existing deep-course test stays green; `directory: null` strict-mode case (the one every production call hits) and invalid-type case added; mention test corrected to a bare-basename mention (slashed mentions never used the listing); content-ranking test made outcome-changing (`maxContentSearchFiles: 1`); prompt tests cover both run profiles per provider; noted no existing test pins the old defaults.