# Iliad — Design Guidelines ("Flow")

Shareable reference for the Iliad dev. The visual companion is **`owl-lab/design-guidelines.html`** (open it to see every colour, the wash mechanics, and the live mascot). The enforced source of truth for colour values is **`src/styles/tokens.css`** — never put raw hex anywhere else (`npm run lint:css`).

## Principles

1. **Text is the focus; chrome recedes.** Warm cream canvas; panels are a hair off-white separated by hairlines. Never a grey mass that competes with the writing.
2. **One colour, one meaning.** Graphite = interactive · gold = brand + highlight · green = added · coral = removed · blue = comment · amber = pending. Don't let two families share a hue.
3. **Restraint.** System fonts, weights capped at 400/500/600/700, two radii. Add a *semantic* token before any new value.
4. **Personality through motion, not ornament.** The mascot has no face; it's alive because it moves. The writing column never moves.
5. **Best practices over invention.** Adapt the converged pattern (macOS chrome, editorial diff) quietly; don't reinvent.

## Colour

All values live in `src/styles/tokens.css`. Roles below.

### Surfaces, ink, hairlines (unchanged — already match the site)
| token | value | role |
|---|---|---|
| `--editor` | `#fffefa` | writing canvas, inputs, chrome panels |
| `--card` | `#fbfaf4` | rails / panels / topbar |
| `--paper` | `#f4f3ec` | app ground, neutral hovers |
| `--ink-1 … --muted-2` | `#1f211f` → `#62675f` | prose → meta floor |
| `--ink-inverse` | `#fffdf6` | text on accent/gold fills |
| `--hairline / -strong / --border-control` | `#e3e0d6` / `#d9d7cc` / `#cfcec3` | dividers / overlay edges / control outlines |

### Accent — graphite (the interactive colour)
Near-monochrome. Used for active file, links, Accept, focus, selection. Chosen for universality; lets the gold mark and diff colours be the only chroma.
| token | value | role |
|---|---|---|
| `--accent` | `#3a3f47` | links, active filename, icon glyphs, Accept fill |
| `--accent-deep` | `#2c3036` | hover / pressed |
| `--accent-soft` | `rgba(60,66,74,.07)` | active row / user bubble fill |
| `--accent-rail` | `rgba(58,63,71,.70)` | active-file inset bar |
| `--selection-wash` | `rgba(60,66,74,.14)` | live text selection (full-height) |
| `--focus-ring-border` | `#9a9ea6` | focus ring |

### Brand — gold (the one warm note)
| token | value | role |
|---|---|---|
| `--brand-gold` | `#e8920a` | paperclip mark, gold moments |
| `--brand-gold-bright` | `#ffad1f` | brighter fills / agent pulse |
| `--brand-gold-ink` | `#5a3d00` | text on gold fills |

### Text-mark families (annotations & diff)
| token | value | role |
|---|---|---|
| `--highlight` | `rgba(255,205,90,.5)` | user `==highlight==` |
| `--comment` | `rgba(91,141,210,.20)` | comment / annotation wash |
| `--comment-ink` | `#2f4d80` | commented text / margin marker |
| `--diff-ins-soft` / `-strong` | `rgba(108,196,140,.16)` / `(…,.42)` | added: sentence / changed word |
| `--diff-ins-ink` | `#2c5a38` | added text |
| `--diff-del-soft` / `-strong` | `rgba(244,150,118,.15)` / `(…,.40)` | removed: sentence / changed word |
| `--diff-del-ink` | `#9a4b36` | removed text |
| `--diff-del-line` | `rgba(154,75,54,.5)` | strikethrough on removed |

### Status (meaning, not decoration)
`--pending #c98912` (in-progress) · `--create #2f9a5b` · `--error #8a3d2a`. Amber is reserved for *pending* — it is no longer an accent, so it never collides.

## The bottom-half wash — house style for text marks

Every **persistent** mark over readable text (diff, comment, highlight) is a fixed-height band low on the line, not a full-height block. This keeps glyphs clean and stays calm at volume.

```css
.mark {
  background-image: linear-gradient(var(--c), var(--c));
  background-size: 100% 0.62em;     /* fixed band — same for every tier */
  background-position: 0 90%;        /* low on the line */
  background-repeat: no-repeat;
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;       /* hug the text, stop at its end, wrap correctly */
  border-radius: 2px;
}
```

- **Live text selection is the exception:** a full-height `--selection-wash` (graphite), so it visibly dominates whenever it overlaps an annotation.
- The fixed `em` band means light and strong tiers occupy the **same space** — the strong never peeks past the light. Don't drive band height off `line-height` (it changes thickness when leading changes).

### Diff (agent edits) — two tiers, sentence-level
Render the agent's review as **whole sentences** added/removed, with the **words that actually changed** in a stronger shade.

- Added sentence → `--diff-ins-soft`; changed words → `--diff-ins-strong`; text in `--diff-ins-ink`.
- Removed sentence → `--diff-del-soft` + strikethrough `--diff-del-line`; changed words → `--diff-del-strong`; text in `--diff-del-ink`.
- Both tiers share the band geometry above; **only the alpha differs.**
- **Compute a word-level (token) intradiff** between old/new — don't wash the whole sentence uniformly. Common prefix/suffix stay soft; only the differing run is strong.
- **Collapse single-sided edits:** when one side has zero changed tokens (pure insertion/deletion), show **one line** with the change inline — not two near-identical washed sentences.
- Implementation: `src/editor/aiReview/diff.ts` (today line-level only — add the token intradiff) and `src/editor/aiReview/extension.ts` (CodeMirror marks). Marks come from the diff engine, never hand-authored.

### Comments
A blue (`--comment`) bottom-half wash on the commented range; optional left margin marker in `--comment-ink`. One tier. Distinct from diff (green/coral), highlight (gold), and selection (graphite). Lives with the selection-comments overlay (`src/editor/selectionComments/`).

### Highlight
The user's `==highlight==` renders as a gold (`--highlight`) bottom-half wash — same band language as diff/comment, distinct hue. It's user content, not agent status. `src/editor/visualMarkdown/inline.ts`.

## Mascot — the clip

A **faceless gold paperclip** (no eyes — an eyed paperclip in an AI writing app reads as Clippy). Personality comes from motion.

- Idle: **sway + breathe** (balancing-wire feel). Rare **hop** (every 30–60s) and **on click**, with squash-and-stretch; a static ground shadow shrinks/fades on the hop.
- **Asleep** state (crash / no API key): droops, desaturates, shows a `z`.
- Colour: `--brand-gold` via `currentColor` — the one warm brand moment.
- All motion off under `prefers-reduced-motion`.
- Component: `src/components/ClipMark.tsx` (replaces `IliadMark.tsx`; same props `size`/`asleep`/`className`). Body path = the site's clip:
  `M5 9.5 V23 a3 3 0 0 0 6 0 V7 a4.5 4.5 0 0 0 -9 0 v17 a6.5 6.5 0 0 0 13 0 V10`.
- Live reference: `owl-lab/clip-lab.html`.

## Typography

System stacks are the brand — **no web fonts** (offline, fast, native feel).
- `--font-serif`: Iowan Old Style / New York → Georgia (canvas prose & headings).
- `--font-sans`: Avenir Next / Inter → system-ui (chrome).
- `--font-mono`: ui-monospace / Menlo.
- Weights: 400/500/600/700 only (600 is the emphasis weight; avoid 700 in chrome).
- Two scales: a sans chrome scale and a separate serif canvas-heading scale (see `tokens.css`).

## Radii & motion

- Radii: `--radius-surface 8px` (panels/cards), `--radius-control 6px` (buttons/inputs), `--radius-pill 999px`.
- Motion is ambient and quiet: active-file light sheen ~7–10% over ~13s; agent presence = a slow breathing dot (pulses in gold). Glass (`backdrop-filter`) only on floating surfaces (typography popover, launch/overlay) — never the file rail or editor. **The writing column never animates.**

## Where things live

- Colour source of truth: `src/styles/tokens.css` (lint-enforced).
- Diff: `src/editor/aiReview/{diff,extension}.ts`.
- Comments: `src/editor/selectionComments/`.
- Highlight: `src/editor/visualMarkdown/inline.ts`.
- Mascot: `src/components/ClipMark.tsx`.
- Brand assets: `public/favicon.svg`, `build/icon.svg` (gold paperclip).
- Full plan: `specs/2026-06-13-flow-visual-identity.md`. Visual companion: `owl-lab/design-guidelines.html`.
