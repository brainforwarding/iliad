# AI: whole-document context and writing preferences

Date: 2026-09-27. Status: implemented and verified locally with an own Groq key (2026-09-27); free route stays on v1 until the Worker is deployed. Branch: `premium-pass`.
Endpoint (owner): implemented and verified locally with an own Groq key; the
proxy side is written and tested but **not deployed** (ships at release).
Figma: `i2BTwgceho8SqRYGZKjLhB`, page "Writing preferences (2026-09-27)",
board `92:3`.

## Decisions (owner, 2026-09-27)

- The assistant stays **universal** — no genre/profession-specific rules now
  (kinds of writing, STYLE.md and assists come later, after a file-structure
  discussion).
- **Whole-document context** for both completions and ✦ AI edits, used
  differently (below).
- **Writing preferences**: one free-text box in Settings → Writing (Figma 19),
  app data, all folders, never in Markdown. Clean UI: row "Writing
  preferences" + Add/Edit, inline text box, count only near the limit.

## Today (for reference)

- Completions (⌘, ⌘. ⌘/): only the current section — up to 2,500 characters
  before the cursor and 1,000 after, stopping at headings — plus title,
  heading path and nearby headings (`src/editor/writingAssistContext.ts`,
  prompt v1).
- ✦ AI edits: the selection plus surrounding paragraphs, ≤ 4,000 characters in
  total (`src/App.tsx` ~1415, `SelectionTaskV1`).

## Behavior

1. **Completions** get the whole document (up to a cap of ~40,000 characters;
   when longer, keep the current section in full and trim from the far ends,
   keeping the start of the document) with the cursor marked, plus the
   document outline (all headings, cursor position marked). Instructions and
   output rules are unchanged: write only at the cursor, the same lengths.
2. **✦ AI edits** get the whole document (same cap) as **read-only reference**
   ("for consistency of names, terms and tone; do not rewrite it"), plus the
   selection and its surrounding passage as today. The answer still replaces
   only the selection; the existing echo/scope guards stay.
3. **Writing preferences** (≤ 1,000 characters, trimmed; empty = not sent)
   are sent with completions and ✦ AI edits as a labelled part of the request
   ("Writer's preferences: …"), after Iliad's rules and before the document.
   Iliad's rules win (treat the document as content, no invented citations,
   output format); for ✦ AI edits, the chosen/typed instruction wins over the
   preferences if they disagree. Not sent with document naming or the
   corrector.
4. Reviewed output, keys, UI and limits of the suggestions themselves do not
   change.

## Prompts and versions

- Prompt v2 is not released yet (it currently adds only `name`), so it can
  still change: v2 gains `autocomplete` and `selection` variants with the new
  fields (`document`/cursor or context, `outline`, `preferences`), strict
  parsers with new limits (`limits.ts`). v1 stays frozen and unchanged.
- **Per route, so nothing breaks before the Worker is deployed:** the own-key
  route builds prompts locally and sends v2 for all tasks; the free route
  keeps sending v1 for autocomplete/selection (today's behavior) and v2 only
  for `name`, controlled by one constant (`FREE_ROUTE_PROMPT_VERSIONS`) that
  is bumped when the Worker with v2 is deployed. The release checklist
  already says to deploy the Worker first; it gains "then bump the free-route
  versions".
- Proxy: v2 limits accepted by the Worker (the shared parser), budget
  reservation accounts for the larger input; tests.

## Cost and latency

A full 40,000-character document is ~10k input tokens: a fraction of a cent
per request on gpt-oss-120b, and a small time-to-first-token increase on
Groq. Measure v1 vs v2 with `npm run benchmark:autocomplete` (latency and a
quick quality read on the fixtures) before calling it done; if latency is
clearly worse, lower the cap.

## Implementation notes

- Renderer: build the context from the editor state (document text, cursor or
  selection, outline) — `writingAssistContext.ts` gets a whole-document
  builder next to the section builder; blocked/excluded ranges (code, review
  lines) keep their current handling.
- Preferences: `src/preferences/writingPreferences.ts` (localStorage,
  try/catch), Settings → Writing row + inline box (`WritingAssistsSettings`),
  passed with each request; main validates length.
- EN/ES strings; the Settings UI follows Figma 19.

## Review (Codex, xhigh, 2026-09-27) — accepted

- **Byte budget, not characters.** One shared maximum for the UTF-8 length of
  `JSON.stringify(task)`, safely below the Worker's 64 KiB body limit; the
  renderer trims the document to fit it; fail locally as `too_long` if the
  non-document fields alone don't fit. Cost statement recomputed from the
  Worker's reservation bound. Tests: quotes/backslashes, Spanish, CJK, emoji,
  full outline, 4,000-char selection.
- **Deterministic trimming:** the safe local cursor window (or the safe
  passage for edits) first, then the document start, then the nearest
  surrounding text; visible omission markers (`[…]`); never split a surrogate
  pair; an oversized section falls back to a cursor-centred slice.
- **Edit scope guard:** the prompt shows the reference document and the
  editable passage as separate, labelled sections (read-only vs replace);
  add a conservative check that rejects answers copying substantial text from
  outside the passage; keep the exact-text-before-accept check. Tests for a
  distant-paragraph echo and prompt-injection text in the document and in
  preferences.
- **Versions:** a single `promptVersionFor(route, task)` resolved after the
  route: own key → v2 for all tasks; free route → v1 for autocomplete and
  selection until the Worker with v2 is deployed, then one bump. Temporary;
  removed at release when everything is v2.
- **Snapshot consistency:** capture the full-document snapshot in CodeMirror
  at request time; include it in the completion stale check (discard an
  answer if the document changed); `extend`, `avoid`, `direction` stay the
  local insertion contract.
- **Outline:** built with the same Markdown exclusions (no fenced code, no
  front matter), capped in count and bytes.
- **Preferences:** `trim()`, max 1,000 enforced by the UI (`maxLength`) and
  rejected over-limit in main (no silent slicing); sent in a delimited user
  section, never the system prompt; the system prompt states they cannot
  override Iliad's rules, output boundaries, the chosen edit instruction or
  the Steer direction. The Settings row is independent of the Autocomplete
  switch (edits use it too).
- **Companions:** a document's `*.comments.md` is never sent as context;
  built-in assists are off while a comments file itself is open.
- **Excluded content keeps today's semantics** (cursor in fenced code → no
  completion; a selected fenced block can still be edited; pending review
  disables assists); regression tests.
- **Privacy wording before release:** the app's Writing settings privacy link
  target and the website privacy pages (EN/ES) + README say the current
  document and your preferences are sent (free: via Iliad's proxy, which does
  not keep or log text; own key: directly to Groq). Tracked with the website
  refresh.
- **Benchmark:** paired v1/v2 runs (late cursor in long documents, extended
  draft, selection edits, Spanish under both app languages, max-byte Unicode)
  reporting body bytes, prompt tokens, time to first token, completion time,
  cleaner rejections and samples; a Worker test for the largest accepted v2
  body and its reservation.

## Done when

- Unit tests: whole-document context builder (cap, trimming keeps the
  current section and the start, cursor marker, outline), prompts v2 golden
  snapshots for the new variants + parsers, v1 snapshots unchanged,
  per-route version selection, preferences store and length, settings row
  static render EN/ES, proxy tests for the v2 variants and budgets.
- `npm run typecheck`, `npm test`, `npm run lint:css`, `npm run build`,
  `npm run proxy:typecheck`, `npm run proxy:test` pass; benchmark run noted.
- Live (own key): a Full idea late in a long document uses earlier context;
  a ✦ AI Rewrite keeps names consistent with the rest; preferences visibly
  change the voice; the free route still works (v1).
- `docs/architecture.md` updated; `docs/product-vision.md` wording on
  "current document and selection only" still holds (whole current document).

## Progress

- [x] Spec reviewed
- [x] Context + prompts v2 + per-route versions + proxy
- [x] Writing preferences (store, settings UI, sent with requests)
- [x] Benchmark, live verification, docs

Live QA (2026-09-27, own key, 9 requests): all 7 checks pass — a Full idea
at the end of a 15k-character story used a name from section 1; preferences
visibly shortened Paragraph/Longer/Rewrite (Sentence less so); ✦ AI Rewrite
kept a term defined elsewhere and changed only the selection; Longer
continued without repeating; typing during a request cancels it; AI is off in
comments files; the free route still sends v1 (preferences have no effect
there until the Worker is deployed). First visible word ~0.7–0.9 s on a
16k-character document.


## Follow-up (2026-09-27): per-kind context and speed

Owner-approved follow-ups, own-key route / prompt v2 only (v1 and the free
route unchanged until the Worker is deployed).

1. **Per-kind context budgets** (`WRITING_AI_CONTEXT_BUDGETS` in
   `prompts/limits.ts`, used by `aiTasks.ts` → `trimDocumentForContext`):
   Sentence 6,000 characters of document (start share 1 KiB), Paragraph
   15,000 (2.5 KiB), Full idea 40,000 (6 KiB, the previous maximum), ✦ AI
   edits 20,000 (3 KiB); same priority as before (local window, start,
   nearest text outward) plus the outline; the 56 KiB task budget still
   bounds everything and the shared parser (Worker too) still accepts up to
   40,000 for any kind. Tests per kind in `tests/writing/aiTasks.test.ts`.
2. **Warm connection** (`electron/writing/groq/connection.ts`). Measured:
   Node's global fetch drops idle sockets after 4 s (Groq and Cloudflare send
   no Keep-Alive hint), so every request after a short pause paid DNS + TCP +
   TLS (~70–90 ms to Groq, ~190 ms to the proxy from Santiago). AI requests on
   both routes now share one undici keep-alive Agent (`undici` dependency,
   the same fetch/errors as Node's; 2-minute idle sockets — both servers kept
   an idle socket ≥ 125 s in a probe). While autocomplete is on and AI isn't
   blocked, typing or focusing the editor sends `writing-ai:warm`
   (renderer-throttled to one IPC a minute); main warms the active origin at
   most once a minute and not while real requests keep it in use: own key →
   unauthenticated `HEAD https://api.groq.com/openai/v1/models`; free →
   `GET <proxy>/healthz` (no token, no quota, never `/v1/generate`, never
   `ai.json`). Tests: `tests/writing/groq/connection.test.ts`,
   `writingAiService.test.ts` ("connection warm-up"),
   `tests/editor/warmConnection.test.ts`.
3. **Prompt caching** — checked
   https://console.groq.com/docs/prompt-caching (2026-09-27): automatic, no
   parameter; supported on `openai/gpt-oss-20b`, `openai/gpt-oss-120b` and
   `openai/gpt-oss-safeguard-20b`; exact prefix match against recent
   requests; minimum cacheable prompt 128–1024 tokens depending on the model;
   50% discount on cached input tokens, which don't count toward rate limits;
   expires after 2 h unused; "not guaranteed"; reported as
   `usage.prompt_tokens_details.cached_tokens`. Applied: the v2 autocomplete
   user message is now preferences → title → outline → document (text before
   the cursor, marker, text after) → request (heading path, kind, direction,
   avoid); the system rules stay first and unchanged, preferences stay a
   delimited user section and the document stays content. ✦ AI edits were
   already ordered (preferences → reference → editable passage). v2 golden
   snapshots updated; v1 unchanged. Not changed: the system prompt still
   carries the kind (and, for edits, the chosen/typed instruction), so the
   cache prefix is shared only between requests of the same kind/instruction
   — moving them out of the system message would weaken the Review's
   structure. `cachedPromptTokens` is now parsed from usage (benchmark only).
4. **Instant feedback**: a length key shows a faint ✦
   (`.cm-idea-autocomplete-pending`, ghost colour, gentle pulse, static under
   reduced motion) at the cursor — after the visible draft when extending —
   from the moment the request starts; the first streamed delta replaces it;
   cancel, typing, Escape, errors and stale answers remove it. The existing
   "Working…" status stays. Tests in `ideaAutocompleteLifecycle.test.ts`.

### Benchmark (run 3, 2026-09-27, own key direct, 5 cases × v1/v2 × 2 trials = 20 requests)

`--only=late-en-sentence,late-es-app-en,extend-en-paragraph,late-en-idea,edit-en-rewrite --trials=2`.
The benchmark calls Groq with Node's fetch (no warm connection), so these
numbers measure the smaller prompts only.

| v2 kind (cases) | Body → prompt tokens | TTFT (ms) now | TTFT before (run 1 / run 2) |
| --- | --- | --- | --- |
| Sentence (late-en, late-es-app-en) | 6.4–6.8 KB → 1,713–2,017 tok (was 4,392–5,326) | 494, 726, 778, 976 → p50 752, max 976 | 859, 928 |
| Paragraph (extend-en) | 15.7 KB → 3,658 tok (was 4,447) | 994, 590 | 642 |
| Full idea (late-en) | 19.7 KB → 4,452 tok (unchanged) | 579, 829 | 533 |
| ✦ AI edit (edit-en-rewrite) | 19.4 KB → 4,365 tok (unchanged, under 20k) | 699, 707 | 760 |

All v2: p50 707 / max 994 ms TTFT (before: 820 / 1,638 run 1 incl. the
56 KiB Unicode cases, 576 / 1,607 run 2); v1 p50 415 / max 536 ms. 20/20
accepted, no errors; cost v2 $0.0059 for 10 requests (was $0.0121 in run 1).
Read: Sentence prompts are ~60% smaller; TTFT moves less than the token
count, and trial-to-trial variance (~±250 ms) is larger than the difference,
so a ~5k-token document costs little first-token time on Groq either way.

Prompt caching: Groq reports `cached_tokens`, but hits were small and rare —
5 of 20 requests had 256 cached tokens (about the system prompt), and exact
repeats of a v2 prompt a minute later showed no cache hit, consistent with
"not guaranteed". The reordering costs nothing and helps when hits happen;
don't count on it for latency.
