# Flow — visual identity refresh (graphite accent, gold mark, two-tier diff)

Date: 2026-06-13
Status: design-ready (palette + diff direction chosen with the user via `owl-lab/flow-glass.html`; needs a reviewer pass before implementation)

## Context

The desktop app and the marketing site (`/Users/sebastian/dev/iliad-site`) had drifted into two identities. The site is the public face: **warm cream canvas, a gold paperclip mark, bright/cheerful accents**. The app shipped a **teal accent + white-owl-on-teal icon**. This spec brings the app's *look* into one family with the site while keeping the app's calm, content-first feel. It also upgrades the agent's review diff to a two-tier, sentence-level presentation.

Design exploration and the live reference for every decision below: **`owl-lab/flow-glass.html`** (Paper + Light direction, three-accent comparison, two-tier diff). Keep it until this ships; it is the source of the exact values.

The canvas, ink, and hairlines already match the site and **do not change**. What changes: the interactive accent hue, the brand mark, and how diffs render.

## Decisions

1. **Direction = "Paper + Light".** Chrome stays opaque and calm (today's app). Glass (`backdrop-filter`) is reserved for floating surfaces only (typography popover, launch/overlay). Ambient motion is minimal: a ~7–10% light sheen on the active file (~13s) and a slow breathing dot for agent presence. **The writing column never moves.**
2. **Accent = Graphite (near-monochrome).** The interactive color (active file, links, Accept button, focus, selection) becomes a warm graphite instead of teal. Chosen over indigo/plum for universality and longevity; it lets the gold mark and the diff colors be the only chromatic signals. (iA Writer / Linear-neutral lineage.)
3. **Brand mark = gold paperclip**, shared verbatim with the site. Retire the owl-on-teal icon.
4. **Agent presence dot pulses in gold** — the one deliberate warm exception in the monochrome, placed where presence matters. Trivially revertible to graphite (`--agent-pulse: var(--accent-bright)`).
5. **Diff = two tiers, sentence-level.** A whole changed sentence is washed lightly (added = green, removed = coral + strikethrough); the words that actually changed within it get a **stronger shade**. Both tiers use **one fixed band geometry** (bottom-half wash, `~0.62em`, inline `box-decoration-break: clone`) so light and dark occupy the same space and hug the text. Pure single-sided edits collapse to one line (see §Diff).
6. **Highlight stays a real feature** (gold marker), in its own color family so it never reads as a diff.

Four color families, each with one meaning: **graphite = interactive · green = added · coral = removed · gold = brand mark + highlight + agent pulse.**

## Token changes — `src/styles/tokens.css`

`tokens.css` is the single source of truth (lint-enforced). All accent values below are illustrative-final from the mock; lock exact hex against WCAG AA on `#fffefa` during implementation (graphite text ≥ 7:1, comfortably AA).

**Rename for role-correctness** (CLAUDE.md: name by role, never value). The legacy `--teal*` tokens are value-named; rename to `--accent*` and update consumers. Affected files (≈50 refs): `base.css`, `editor.css`, `assistant.css`, `sidebar.css`, `chrome.css`, `mark.css`, `visual-markdown.css`, `popovers.css`. Mechanical find/replace, one PR.

| token (new name) | old (teal) | new (graphite) | role |
|---|---|---|---|
| `--accent` | `#196f64` | `#3a3f47` | links, active filename, icon glyphs, Accept fill |
| `--accent-deep` | `#145b52` | `#2c3036` | hover / pressed |
| `--accent-deepest` | `#104d46` | `#20242a` | strongest |
| `--accent-tint` | `#e8efe9` | `#eeede9` | soft filled tiles |
| `--accent-soft` | `rgba(25,111,100,.06)` | `rgba(60,66,74,.07)` | active row / user bubble fill |
| `--accent-border` | `rgba(25,111,100,.10)` | `rgba(60,66,74,.12)` | soft interactive border |
| `--accent-rail` | `rgba(25,111,100,.65)` | `rgba(58,63,71,.70)` | active-file inset bar |
| `--accent-wash` | `rgba(25,111,100,.28)` | `rgba(60,66,74,.16)` | stronger active fill |
| `--selection-wash` | `rgba(25,111,100,.20)` | `rgba(60,66,74,.14)` | editor text selection |
| `--tighten-wash` | `rgba(25,111,100,.13)` | `rgba(60,66,74,.10)` | range being tightened |
| `--focus-ring` | `…(25,111,100,.14)` | `…(60,66,74,.18)` | focus ring |
| `--focus-ring-border` | `#9db4ad` | `#9a9ea6` | focus ring border |
| `--ring-accent-soft`, `--rail`, `--glow-on/off` | teal rgba | graphite rgba (same alphas) | inputs / rail / working glow |

**Add brand + agent tokens:**
```
--brand-gold: #e8920a;        /* paperclip mark, gold moments */
--brand-gold-bright: #ffad1f;
--brand-gold-ink: #5a3d00;    /* text on gold fills */
--agent-pulse: rgba(232,146,10,.35);  /* gold breathing dot (decision 4) */
```

**Upgrade the diff/review channels to the brighter, two-tier set** (today's `--review-insert/-delete` are muted single-tier):
```
--diff-ins-ink: #2c5a38;
--diff-ins-soft: rgba(108,196,140,.16);   /* whole added sentence */
--diff-ins-strong: rgba(108,196,140,.42); /* changed words */
--diff-del-ink: #9a4b36;
--diff-del-soft: rgba(244,150,118,.15);   /* whole removed sentence */
--diff-del-strong: rgba(244,150,118,.40); /* changed words */
--diff-del-line: rgba(154,75,54,.5);      /* strikethrough */
--highlight: rgba(255,205,90,.5);         /* user gold marker */
```
Keep `--pending`, `--comment-wash` (amber), `--create`, `--error` unchanged — with graphite as the accent there is no longer any amber/accent collision.

## Diff rendering — `src/editor/aiReview/`

Today `diff.ts` is **line-level only** (`splitLineSegments`, hunks with old/new line ranges); `extension.ts` washes changed line ranges. Two changes:

1. **Add word-level intradiff** in `diff.ts`. For each hunk, run a token-level LCS/Myers diff between old and new text. Emit, per side, the changed-token ranges (offsets) on top of the existing line ranges. Tokenize on word boundaries keeping punctuation and inter-token spaces; when wrapping an inserted token, include/normalize its adjacent space so spacing stays clean.
2. **Render two tiers** in `extension.ts` as CodeMirror marks, both using the **bottom-half band** (`background-size:100% .62em; background-position:0 90%; box-decoration-break:clone`):
   - sentence/hunk range → `--diff-ins-soft` / `--diff-del-soft` (+ strikethrough `--diff-del-line` on removed),
   - nested changed-token ranges → `--diff-ins-strong` / `--diff-del-strong`.
3. **Collapse single-sided edits.** When one side has zero changed tokens (pure insertion or deletion), render **one line** with the change inline (strong shade on the inserted/deleted run), not two near-identical washed sentences. Only show the removed-above-added pair when *both* sides have changed tokens. (Example that motivated this: inserting `el` into a 14-word sentence currently washes both full sentences red+green; correct behavior highlights only `el`.)

Marks come from the diff engine — never hand-authored. CSS for `.cm-diff-*` lives in `editor.css` referencing the tokens above (no raw color, per lint rule).

## Highlight — `src/editor/visualMarkdown/inline.ts` + `mark.css`

The `==highlight==` feature already exists. Point its color at the new `--highlight` token and render it with the same bottom-half band as the diff so highlight and diff share one visual language but distinct hues (gold vs green/coral). Confirm it never overlaps a diff range ambiguously (highlight is user content; diff is agent-pending — different layers).

## Assets — the gold paperclip

- `public/favicon.svg` — replace owl/teal with the gold paperclip (reuse the site's `clipmark` path, `stroke: #E8920A`).
- `build/icon.svg` — replace the white-owl-on-teal squircle. Use the gold paperclip glyph. **Dock caveat:** keep a *filled* squircle (gold paperclip on a soft fill), not the site's white-card favicon, so the dock icon stays visible on light backgrounds.
- Regenerate `build/icon.png` / `icon.icns` / `icon.ico` from the new master.

## Mascot — a faceless paperclip replaces the owl

The app's signature mascot is Athena's owl (`src/components/IliadMark.tsx` + `src/styles/mark.css`): an inline SVG that breathes, smile-blinks, hops off its branch (rare auto + on click + wing-flash), and has an `asleep` crash state (shut eyes + zzz). Replace it with a **faceless gold paperclip** of equal character.

**Decision: no eyes.** An eyed paperclip in an AI writing app reads as Microsoft's Clippy — same object, same category (assistant-in-a-word-processor) — which undercuts Iliad's premium, "the tool disappears under your eye" positioning. The owl earned eyes (a creature + the classical Athena/literary symbol); a paperclip is an office object, so anthropomorphizing it *reenacts* the Clippy meme. It would also re-fork the app↔site identity we just unified (the site's paperclip is faceless). **Personality comes from motion, not a face** (Pixar-lamp principle).

- New component `src/components/ClipMark.tsx` + styles in `mark.css` (or `clip.css`), **same props** as `IliadMark` (`size`, `asleep`, `className`) so call sites swap 1:1.
- Repertoire (mirror the owl): idle **sway + breathe** (balancing-wire feel), a **rare hop** (30–60s) + **click-to-hop** with squash-and-stretch, a static **ground shadow** that shrinks/fades on the hop (the owl's branch equivalent), and an **asleep** state = droop + desaturate + zzz. All motion off under `prefers-reduced-motion`.
- **Color = gold** (`--brand-gold`), themed via `currentColor` — the one deliberate warm brand moment, not graphite.
- Body = the site's clipmark path (`M5 9.5 V23 a3 3 0 0 0 6 0 V7 a4.5 4.5 0 0 0 -9 0 v17 a6.5 6.5 0 0 0 13 0 V10`).
- Swap all three call sites: `src/App.tsx:781` (launch, size 60), `src/components/EditorPane.tsx:449` (empty editor, size 76), `src/components/EditorErrorBoundary.tsx:50` (crash, `asleep`, size 72). Retire `IliadMark.tsx`.
- Live reference (final motion + states): `owl-lab/clip-lab.html`. (Leaving the `owl-lab/` dir name as-is is fine; out of scope to rename.)

## Out of scope / non-goals

- No change to the cream canvas, ink ramp, or hairlines.
- No web fonts in the app (system stacks remain the brand, per `tokens.css`). Cross-app consistency rides on color + mark + canvas, not typeface.
- No new editor surfaces, panels, or AI flows (CLAUDE.md restraint). This is re-skin + diff-render upgrade only.
- No glass on the file rail or editor; glass stays on popover/overlay only.

## Manual checks (`docs/architecture.md` "Manual checks")

- `npm run lint:css` passes (no raw hex/rgba outside `tokens.css`).
- `npm run typecheck && npm run build`.
- In-app: active file, links, Accept, focus rings read graphite; agent dot breathes gold; selection wash is neutral.
- Agent diff: a multi-word rewrite shows light sentence wash + strong changed words on the same band height; a one-word insertion collapses to a single line with only that word strong.
- A `==highlight==` renders gold and is visually distinct from any diff.
- App/dock icon and favicon show the gold paperclip.

## Reference

- `owl-lab/flow-glass.html` — the live study: Paper + Light, graphite accent (option C), two-tier diff, gold mark/highlight. Exact values come from here.
- `owl-lab/clip-lab.html` — the mascot study: faceless gold paperclip, idle sway/breathe, hop, asleep state (the owl's replacement).
- `iliad-site/index.html` (`:root`, lines ~110–131) — the site palette this aligns to (gold, pastels, ins/del).
