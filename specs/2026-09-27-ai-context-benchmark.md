# AI context benchmark: prompt v1 vs v2

Date: 2026-09-27. Branch: `premium-pass`. Spec:
`specs/2026-09-27-ai-context-and-preferences.md` (Review, "Benchmark").

Paired v1/v2 runs, direct to Groq (`openai/gpt-oss-120b`, own-key route, the
same pinned params as the app), synthetic fixtures only:

```bash
npm run benchmark:autocomplete -- --context [--trials=N] [--only=a,b] [--dry-run]
```

The v1 task is what the free route sends today (the renderer's section window
from `buildAutocompleteContext`, or the ✦ AI passage); the v2 task is built by
`electron/writing/aiTasks.ts` from the same request plus the full document.
Cleaning and guards are the app's (autocomplete cleaner; for edits the
preamble, context and new reference-echo guards).

## Cases

| Case | What |
| --- | --- |
| late-en-sentence | Late cursor in a ~18k-char EN report (names defined only at the start) |
| late-en-idea | Same, full idea |
| extend-en-paragraph | Extending an unaccepted draft (draft re-inserted at the cursor) |
| late-es-app-en | Spanish report, English app language |
| late-es-app-es | Spanish report, Spanish app language |
| unicode-max | CJK + emoji + quotes/backslashes document far over the budget (trimmed) |
| edit-en-rewrite | ✦ AI Rewrite of a late EN paragraph |
| tighten-es-app-es | ✦ AI Shorten, Spanish, Spanish app |
| edit-es-app-en | ✦ AI Rewrite, Spanish document, English app |
| edit-unicode-max | ✦ AI edit in the max-byte Unicode document |

## Run 1 — all cases, 1 trial each (20 requests)

| | v1 | v2 |
| --- | --- | --- |
| Requests / errors / accepted | 10 / 0 / 10 | 10 / 0 / 10 |
| Body bytes (max) | 474 | 57,324 (budget 57,344) |
| Prompt tokens p50 / max | 320 / 410 | 5,261 / 17,925 |
| Time to first token p50 / max | 424 / 886 ms | 820 / 1,638 ms |
| Completion p50 / max | 528 / 979 ms | 929 / 1,715 ms |
| Cost (10 requests) | $0.0011 | $0.0121 |

Per case (body bytes → prompt tokens, TTFT, complete):

| Case | v1 | v2 |
| --- | --- | --- |
| late-en-sentence | 418 B → 299 tok, 509 / 565 ms | 19,654 B → 4,392 tok, 859 / 929 ms |
| late-en-idea | 414 B → 342 tok, 319 / 528 ms | 19,650 B → 4,435 tok, 533 / 1,086 ms |
| extend-en-paragraph | 474 B → 354 tok, 424 / 503 ms | 19,710 B → 4,447 tok, 642 / 749 ms |
| late-es-app-en | 460 B → 320 tok, 695 / 761 ms | 21,254 B → 5,326 tok, 928 / 1,011 ms |
| late-es-app-es | 461 B → 410 tok, 886 / 979 ms | 21,255 B → 5,436 tok, 965 / 1,066 ms |
| unicode-max | 279 B → 286 tok, 529 / 573 ms | 57,323 B → 17,868 tok, 1,638 / 1,715 ms |
| edit-en-rewrite | 416 B → 306 tok, 344 / 434 ms | 19,364 B → 4,365 tok, 760 / 778 ms |
| tighten-es-app-es | 420 B → 321 tok, 525 / 616 ms | 20,872 B → 5,280 tok, 777 / 853 ms |
| edit-es-app-en | 461 B → 320 tok, 329 / 506 ms | 20,913 B → 5,261 tok, 820 / 923 ms |
| edit-unicode-max | 177 B → 266 tok, 368 / 393 ms | 57,324 B → 17,925 tok, 1,326 / 1,360 ms |

No cleaner or guard rejections, no finish other than `stop`. One quality
finding: v2 `late-es-app-en` restated the sentence before the cursor ("Para el
próximo invierno, la capitana de puerto debería ajustar…"), which the cleaner
does not catch mid-line. The v2 completion rules now say "starting exactly
there: do not repeat the text just before it" (EN/ES).

## Run 2 — after that fix, 4 completion cases × 2 trials (16 requests)

| | v1 | v2 |
| --- | --- | --- |
| Accepted | 8 / 8 | 8 / 8 |
| Prompt tokens p50 / max | 320 / 410 | 4,461 / 5,452 |
| TTFT p50 / max | 421 / 718 ms | 576 / 1,607 ms |
| Completion p50 / max | 496 / 804 ms | 644 / 1,685 ms |
| Cost (8 requests) | $0.0010 | $0.0064 |

No restated prefix in the 8 v2 answers.

## Samples (run 1, first ~200 chars)

- late-en-sentence v1: "adjust the schedule to accommodate slower traffic and allocate additional staff during peak periods to improve efficiency."
- late-en-sentence v2: "adjust the timetable to provide earlier departures, increase buffer times between sailings, and coordinate with the ferry operator to ensure reliable service despite adverse weather conditions."
- late-en-idea v2: "extend service hours during peak commuter periods … real-time digital signage at the slipway and on the Brannock Street …" (uses places defined earlier in the document).
- extend-en-paragraph v2: "…consider consolidating services to twice weekly during the low-demand periods…" (continues the re-inserted draft).
- edit-en-rewrite v1: "The winter timetable was this year's weakest point. The harbor manager believes the boat to the island should run less frequently in January…"
- edit-en-rewrite v2: "This year's biggest issue was the winter timetable; the harbor manager believes the ferry to the island should operate fewer times in January…" ("ferry", as the document calls it).
- tighten-es-app-es v2: "El mayor problema este año fue el horario de invierno; el responsable del puerto considera reducir la frecuencia del ferry en enero, pues hay poca demanda y es costoso operarlo."

## Read

- v2 works on both languages and the max-byte bodies, with no rejections.
- Context shows up in the answers (ferry vs boat, the slipway, Brannock
  Street), but the model rarely reaches for the proper names defined only at
  the document start (Mara Quint, the Gull Line, TIDEWATCH) in these prompts.
- Latency: time to first token rises ~150–400 ms at p50 for a typical
  ~5k-token document and to ~1.3–1.6 s at the 56 KiB maximum (~18k tokens of
  CJK). Cost per request rises ~10× for a 20 KB document (still ~$0.0007) and
  to ~$0.003 at the maximum; the Worker's worst-case reservation for the
  largest body is ~$0.011 (bytes, not tokens, bound it) before settling.
- Owner call before release: keep the 40,000-character / 56 KiB cap, or lower
  it if the ~1.5 s first token on very long documents feels slow in live use.
