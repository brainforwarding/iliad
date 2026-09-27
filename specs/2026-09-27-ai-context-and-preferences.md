# AI: whole-document context and writing preferences

Date: 2026-09-27. Status: reviewed (Codex xhigh, 2026-09-27); waiting for naming to land. Branch: `premium-pass`.
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

- [ ] Spec reviewed
- [ ] Context + prompts v2 + per-route versions + proxy
- [ ] Writing preferences (store, settings UI, sent with requests)
- [ ] Benchmark, live verification, docs
