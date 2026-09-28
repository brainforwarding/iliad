# Writing rules for the built-in AI (prompt v3)

Date: 2026-09-27. Status: spec, reviewed by Codex (xhigh) and revised; implementing. Target release: 0.6.1
(also the first real self-update through 0.6.0's updater).

Sources: the owner's guide `~/Documents/docs/Circles/ia-inacap/on-good-writing.md`
(Spanish: 10 traits of good writing, 12 typical AI mistakes); the owner's
decisions in this conversation (2026-09-27): bring the guide's rules into the
built-in AI's instructions, and avoid em dashes, semicolons and colons.

## Problem

Suggestions (⌘, ⌘. ⌘/) and ✦ AI edits (Tighten, Edit) can read like AI text:
filler sentences, "in an increasingly…" openers, "the future is promising"
closers, inflated words ("crucial", "plays a key role"), "not just X but Y",
reflexive lists of three, em dashes and semicolons. The current prompts
(v1 instructions, reused by v2) only say "preserve voice" and "don't invent
facts" (autocomplete) or "more concise and direct" (Tighten).

## Decisions

- **New prompt version v3.** v2 is frozen (released in 0.5.0). v3 has the
  same task shapes and fields as v2 (autocomplete, selection, name) and the
  same budgets; only the system prompt changes for autocomplete and selection.
  `name` is unchanged apart from the version number.
- **One short rule block** (about eight lines, EN and ES), added to the system
  prompt of autocomplete and selection, after the task instructions and before
  the preferences rule:

  EN:
  > Write plainly. Every sentence must add something: no filler, no restating
  > what was said, no explaining the obvious. Prefer concrete words (numbers,
  > names, actions) and plain verbs over vague nouns. No scene-setting openers
  > and no summarizing or uplifting endings. Don't inflate importance
  > ("crucial", "a key role", "a milestone"). Never invent facts, reasons,
  > numbers or sources; if the document doesn't say it, leave it out. Avoid
  > stock phrasing such as "not just X, but Y" and automatic lists of three.
  > Don't use em dashes or semicolons, and use a colon only before a list or
  > in a time; write two sentences instead.

  ES: the same in Spanish (natural Spanish, not a literal translation; stock
  words to avoid include "fundamental", "ecosistema", "potenciar").

  Note the rule text itself avoids em dashes; the semicolon in "sources; if"
  is replaced by a period in the final text.
- **Precedence:** the rule block is a default style. The writer's preferences
  may override it (e.g. "I like em dashes"): the preferences rule already says
  preferences cannot override *these rules*, so v3 words it as "The writer's
  preferences may change the style rules above, but not the rest." For ✦ AI
  Edit, an explicit instruction also overrides the style rules ("unless the
  instruction asks otherwise"). Voice, language, tense and point of view are
  still preserved.
- **Not included:** "take a position" (a suggestion must not push an opinion
  into the writer's text) and formatting rules (suggestions and edits keep the
  document's Markdown).
- **Rollout:** the Worker must serve v3 before the app ships. Deploy
  `relay/ai-proxy` with `SUPPORTED_PROMPT_VERSIONS = "1,2,3"` first, then
  release 0.6.1, whose free and own-key routes send v3 for every task.
  `LATEST_PROMPT_VERSION = 3`. `FREE_ROUTE_PROMPT_VERSIONS` and
  `promptVersionFor` (the temporary per-route split left over from 0.5.0) are
  removed; both routes send the latest version.
- **Older apps keep working:** 0.4 sends v1, 0.5/0.6.0 send v2; the Worker
  keeps serving both.

## Implementation outline

- `electron/writing/groq/prompts/v3.ts`: types `…V3` = v2 shapes with `v: 3`;
  `parseWritingAiTaskV3` reuses v2 validation (refactor v2's parser to take
  the expected version without changing v2 behaviour); `buildPromptV3` =
  `buildPromptV2` plus the rule block and the revised preferences sentence.
  Pure (the Worker imports it).
- `prompts/index.ts`: export v3, `WritingAiTask` union adds v3,
  `LATEST_PROMPT_VERSION = 3`, remove `FREE_ROUTE_PROMPT_VERSIONS`/
  `promptVersionFor` and their callers (always send the latest).
- Worker (`relay/ai-proxy`): dispatch v3 to `buildPromptV3`,
  `SUPPORTED_PROMPT_VERSIONS = "1,2,3"`; tests.
- App: request builders produce v3 tasks; tests updated (exact bodies).
- Benchmark (`scripts/benchmarkAutocomplete.ts`): a paired v2/v3 mode over
  the existing fixtures (sentence, paragraph, idea, tighten, edit; EN and ES)
  reporting latency, finish reasons, output length and counts of em dashes,
  semicolons, colons (outside times/lists) and a small list of stock phrases.
- Docs: `docs/architecture.md` (v3), `docs/release.md` (Worker first), ADR
  note, backlog.

## Validation

- Unit: v3 parser accepts exactly v2's fields with `v: 3`; v3 prompt contains
  the rule block for autocomplete/selection and not for name; preferences
  sentence; v1/v2 prompts byte-identical to before (frozen).
- Worker tests: v3 accepted, v1/v2 still served.
- Benchmark before release (own key, direct Groq): v3 vs v2 on the fixtures,
  3 trials. Accept v3 if: em dashes and semicolons in outputs drop to ~0,
  stock phrases drop, latency p50 within +10 %, no rise in cleaner rejections,
  and a hand check of the samples reads better (the owner's guide as the bar).
- After deploy: one free-route completion and one ✦ AI edit against the live
  Worker with v3.
- Release 0.6.1 through the normal script; the owner updates with the new
  Update button (first real self-update).

## Review (Codex xhigh, 2026-09-27) and revisions (these override the text above)

1. **Final rule block** (replaces the draft above). Warning signs, not bans:
   "do not introduce", voice and Markdown first (fiction may set scenes;
   Spanish dialogue uses the raya).

   EN:
   > Write plainly while preserving the writer's voice and Markdown. Do not add
   > filler, obvious explanations, or empty restatements. Prefer concrete
   > details and direct verbs when the document provides them. Do not invent
   > facts, numbers, sources, or names, and do not turn facts into unsupported
   > reasons or conclusions. Avoid generic scene-setting openings, generic
   > summaries or upbeat endings, inflated claims such as "crucial", "a key
   > role", or "milestone", stock contrasts such as "not just X but Y", and
   > three-part lists used only for effect. Unless the established voice,
   > Markdown, a preference, or an edit instruction requires them, do not
   > introduce em dashes or semicolons, or colons other than for real lists or
   > times.

   ES:
   > Escribe con sencillez y conserva la voz del autor y el Markdown. No añadas
   > relleno, explicaciones obvias ni repeticiones vacías. Prefiere detalles
   > concretos y verbos directos cuando el documento los aporte. No inventes
   > hechos, cifras, fuentes ni nombres, y no conviertas hechos en causas o
   > conclusiones sin respaldo. Evita aperturas genéricas de contexto,
   > resúmenes genéricos o cierres optimistas, afirmaciones infladas como
   > «fundamental», «un papel clave» o «un hito», fórmulas como «no solo X,
   > sino Y» y listas de tres creadas solo para dar efecto. Salvo que la voz
   > establecida, el Markdown, una preferencia o la instrucción de edición lo
   > requieran, no introduzcas rayas largas, puntos y coma ni dos puntos salvo
   > en listas reales u horas.

2. **Preferences precedence:** change BOTH the system preferences rule and the
   labelled user preferences section: preferences may change this default
   style guidance, but not factual limits, task boundaries, output format, the
   Edit instruction, or the writing direction. Edit's instruction may override
   the default style. Tighten's "do not add or remove information" stays.
3. **Make v3 actually used:** exhaustive `switch`es in parser/builder dispatch
   (`prompts/index.ts`), real v2/v3 branches in `buildAutocompleteTask` /
   `buildSelectionTask` (`electron/writing/aiTasks.ts`), a v3 `name` task in
   `suggestName`/`writingAiService.ts`. Exact free-route bodies for all three
   tasks and own-key prompt assertions in tests. Only then
   `LATEST_PROMPT_VERSION = 3` and remove the dead `promptVersionFor`.
4. **Frozen v1/v2:** keep exported v1/v2 parsers as wrappers around any shared
   helper; golden snapshots for v1/v2 unchanged; separate v3 snapshots; update
   the purity test's file list.
5. **Worker:** it builds generically through `prompts/index.ts` (no own
   branch). Deploy the v3 source and `SUPPORTED_PROMPT_VERSIONS = "1,2,3"`
   together; keep `MIN_CLIENT_VERSION = "0.4.0"`; Worker tests for v1, v2, v3.
   Deployment proof is a real v3 generate request, not `/healthz`.
6. **Budget:** extend `--budget-probe` to v3 and confirm
   `PROMPT_OVERHEAD_TOKENS = 150` still holds (else raise it).
7. **Benchmark:** adapt `--context` to pair v2/v3 (alternating order), 5
   trials, report raw/cleaned length, finish reason, cleaner/guard rejection
   reason, em-dash/semicolon counts and a labelled colon heuristic; add four
   synthetic bait cases (unsupported causal claim, generic opening, inflated
   ending, three-part rhetoric). Latency is reported, not a hard gate
   (default temperature). Shuffled samples hand-checked against the guide.
8. No ADR/backlog needed; update `docs/architecture.md` and `docs/release.md`
   (stale per-route wording).
