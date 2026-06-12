# Make the design system prescriptive: token consolidation + enforcement

**Date:** 2026-05-25
**Status:** in review (design-systems review folded in; codex pending)

> **Review note — design-systems (folded in).** Measured ΔL\* surfaced a blocking
> issue and several value fixes: (1) darkening surfaces makes the old `--hairline`
> invisible on the new rails (ΔL\* 1.9) — borders must be **re-derived darker
> after** surfaces; (2) the surface ladder had *shrinking* steps — evened out, and
> `--editor` warmed off pure white; (3) `--ink-1`↔`--ink-2` were 2.4 ΔL\* apart
> (the same sub-perceptual redundancy we're killing) — `--ink-2` widened; (4) the
> `560`+`600` weight pair is that redundancy too — ladder is now **400/500/600/700**
> (real Avenir cuts; UI-medium 560→500, strong stays 600); (5) one small type size
> dropped (6 chrome sizes, not 7); (6) enforcement must also allow-list **font-size
> and font-family**, not just color/weight, or type re-sprawls; (7) fix doc-drift
> structurally: extract tokens into `tokens.css` as the single source the doc
> *links*, rather than hand-mirroring; (8) enumerate the serif `--serif-*` sizes so
> the prose system is prescriptive too. All applied below.

## Problem

Measured across `src/styles/*.css`, the app uses **~110 hex + ~30 rgba ≈ 140
colors, ~30 font-sizes, 10 font-weights, 2 serif + 2 mono stacks, and 5 radii** —
in an app whose entire thesis is "restraint, fewer things, quiet." Raw hex is
used **257×**; design tokens only **52×**. Tokens lose to copy-paste ~5:1.

Two independent expert reviews (a design-systems architect and a product/visual
designer) reached the same verdict: **the design system is descriptive, not
prescriptive.** `base.css` already defines a good ~24-token palette; the rest of
the app ignores it and hand-mixes near-duplicates (e.g. eight greys inside
`#62675f`–`#777c73`, a dozen warm off-whites `#fffefa`→`#f0efea`). Most of the
sprawl is *perceptually invisible* (`#767a72` vs `#73776f` is ΔE ~1.2, below the
human threshold) — so it doesn't read as richness, it reads as accident, and it
guarantees drift. This is a **consolidation, not a redesign**: the judgment
(teal ramp, serif/sans split, spacing rhythm, `#62675f` legibility floor) is
already sound.

Concrete still-broken specifics the reviews surfaced:
- The **writing canvas** still renders links purple (`#725de2`, hover `#5a45c5`)
  and inline code red-brown (`#8b3c2d`) in `visual-markdown.css` — a second/third
  accent on the most-looked-at surface. (The agent panel was already folded to
  teal; the canvas was missed.)
- The **agent panel is `--editor` white — same as the canvas**, so the layout's
  intended composition (two quiet rails framing one luminous page) is flattened.
- The **4 surface tokens are within ~2% lightness** of each other ("a surface
  system where surfaces are indistinguishable is blurry, not calm").

## Goals

1. One prescriptive **semantic** token set (~26 colors), defined once in
   `base.css`, named by **role** ("what kind of thing is this?"), consumed
   everywhere. No primitive layer (single theme, one accent — primitives would be
   ceremony; revisit only if dark mode lands).
2. A real **type scale** (≤8 sans/chrome sizes) and **weight ladder** (4).
3. One serif stack, one mono stack.
4. **Respread** the 4 surfaces to perceptible ~3% steps; **recede** the agent
   panel to `--sidebar`.
5. Fold the **canvas** links/code into the one teal accent.
6. **Enforce**: Stylelint bans raw hex/rgba outside `base.css` + a font-weight
   allow-list; `npm run lint:css` wired in; design-system doc regenerated to
   mirror `base.css`; a CLAUDE.md rule so future edits (incl. AI) obey it.

## Non-goals

- Redesigning any component or layout beyond surface color + the two accent
  fixes. Spacing rhythm (4/8/12/16/24) stays.
- Tokenizing the **serif canvas** heading sizes into the chrome scale — serif
  prose is a deliberately separate type system ("serif writes, sans operates").
  Its sizes get de-duplicated but keep their own values.
- The "two working signals" motion question (glow + dot-wave) — tracked
  separately; this pass is color/type only.

## The token set (define in `tokens.css`, ~26 colors)

All color literals live in **`src/styles/tokens.css`** — a pure `:root` of custom
properties, the single source of truth. `base.css` imports it; the design-system
doc `<link>`s it (so the doc can no longer drift). It is the only file the
Stylelint color ban ignores.

### Surfaces — 4, evened ladder (role decides the shade)

| Token | Value | ≈L\* | Role — "this kind of background is…" |
|---|---|---|---|
| `--editor` | `#fffdf6` | 99.3 | the writing canvas **+ true text inputs** (composer, rename, settings). The one luminous surface — warmed off clinical white. |
| `--card` | `#f6f5ed` | 96.0 | a raised grouping **inside** a panel (connection cards, pending/patch strips). Lighter than the panel it sits on. |
| `--paper` | `#efeee5` | 93.4 | the app ground / chrome behind everything (topbar, recessed strips). |
| `--sidebar` | `#e8e7dd` | 90.7 | the operational **side rails**: file tree **and the agent panel**, panel headers. Most receded. |

Steps ≈ 3.3 / 2.6 / 2.7 — roughly even and each perceptible. Starting values, to
be eyeballed live. Overlays (popover/menu/toast) are `--editor` @ ~98% + shadow,
not a 5th surface.

### Ink — 6 (keep names; one job each)

| Token | Value | ≈L\* | Role |
|---|---|---|---|
| `--ink-1` | `#1f211f` | 12.5 | prose, primary headings, active filename |
| `--ink-2` | `#272a26` | 16.0 | default chrome text — *widened* from `#242624` so ink-1↔ink-2 is a real ~3.5 ΔL\*, not 2.4 |
| `--ink-3` | `#2f332e` | 20.0 | soft: secondary headings, tree rows at rest |
| `--muted-1` | `#52584f` | 36 | secondary/supporting text, icon glyphs |
| `--muted-2` | `#62675f` | 42 | meta/caption floor — still ≥4.8:1 even on the darkened `--sidebar` |
| `--muted-3` | `#767a72` | 50 | decorative / disabled — the single light grey (≈3.7:1 on sidebar → not for informational text) |

### Borders — 3 (semantic; replaces `--line-1..4`)

**Re-derived darker** to stay visible on the darkened surfaces (old `#e9e5dc`
hairline was ΔL\* 1.9 — invisible — on the new `--sidebar`):

| Token | Value | ≈L\* | Role |
|---|---|---|---|
| `--hairline` | `#e3e0d6` | 88.5 | default 1px rule: dividers, panel edges, table cells |
| `--hairline-strong` | `#d9d7cc` | 85.5 | popover/overlay edges |
| `--border-control` | `#cfcec3` | 82.5 | input/button outlines — the "interactive edge" on white |

Only **6** `--line-*` references exist (all in `assistant.css`); replaced directly
when `--line-*` is removed (no temporary aliases needed).

### Accent — 1 hue / 4 tones + washes (already good; lock it)

`--teal #196f64` · `--teal-deep #145b52` · `--teal-deepest #104d46` ·
`--teal-tint #e8efe9`. Plus tokenized alphas that today are inline:
`--accent-glow rgba(25,111,100,0.10)`, `--hover-wash rgba(214,211,198,0.32)`.
Keep `--focus-ring`, `--focus-ring-border`. **Teal is the only chromatic
interactive signal** — links, buttons, active rail, selected pill, code bg, glow.

### Status — 3 hues + 2 review tints + surfaces

`--error #8a3d2a` · `--pending #c98912` · `--create #2f9a5b`.
`--error-surface #fff3ee` (error backgrounds). Review/diff is *status applied to
diffs*, not a new accent: `--review-insert rgba(47,154,91,0.12)`,
`--review-delete rgba(138,61,42,0.10)`.

### Inverse — 2 (tooltips / on-accent)

`--surface-inverse rgba(35,37,35,0.94)` · `--ink-inverse #fffefa`.

### Fonts — 3 family tokens

`--font-serif` (Iowan Old Style …) · `--font-sans` (Avenir Next …) ·
`--font-mono` (SFMono-Regular …). Collapses the 2 serif + 2 mono stacks to one
each. **Every** `font-family` becomes `var(--font-*)` (lint-enforced).

## Type scale — tokenized, two families

Chrome/sans sizes become `--text-*` tokens; serif **canvas** sizes become
`--serif-*` tokens (a deliberately separate prose system per "serif writes / sans
operates"). Every `rem` font-size becomes a token (lint-enforced: `font-size`
must be a `var()`, `em`, `clamp()`, or `inherit`).

**Chrome — 6 sizes** (snap the ~16 values in 0.66–0.92rem onto these):

| Token | Value | Job |
|---|---|---|
| `--text-display` | `3rem` | launch H1 |
| `--text-title` | `1.5rem` | empty-state title / large headings |
| `--text-lg` | `1.05rem` | subsection, assistant H1 |
| `--text-md` | `0.9rem` | chrome body default |
| `--text-sm` | `0.8rem` | secondary / dense rows |
| `--text-xs` | `0.72rem` | meta, captions, eyebrow, tooltip, timestamp |

Dropped the 7th size: meta and eyebrow share `0.72rem` (eyebrow is set apart by
uppercase + letterspacing, not 0.04rem). `em`-relative sizes (e.g. inline code
`0.82em`) and the prose `clamp()` measure stay relative — not tokens.

**Serif canvas — enumerated `--serif-*`** (de-duplicated from the current
1.08/1.22/1.42/2/2.4/2.6/3 sprawl; exact set finalized against
`visual-markdown.css` + `editor.css` during migration, ~4–5 sizes).

## Weight ladder — 4 (real Avenir cuts)

`400` body · `500` medium (UI labels, active items, eyebrows) · `600` strong
(headings, table headers, **inline emphasis** — the user-validated "not-too-bold"
weight) · `700` reserved (serif canvas H1–H2, serif prose `<strong>`). Drop the
synthesized in-betweens `450/520/560/580/650/760`: `560`→`500`, `650`→`600`.
These are the four weights Avenir Next actually ships as distinct cuts, so each is
perceptible (unlike 560-vs-600). Lint allow-lists exactly `400/500/600/700`.

## Migration plan (ordered so the build never breaks mid-way)

Per codex: the current CSS fails lint immediately, so **do not enable the lint
gate until the migration is done.**

1. **Create `src/styles/tokens.css`** — pure `:root` with the full token set
   above (colors, `--font-*`, `--text-*`, `--serif-*`, washes, status, inverse).
   Import it first from `app.css` (before `base.css`). Move the existing tokens
   out of `base.css`; `base.css` keeps only element/reset rules and consumes
   tokens.
2. **Canvas teal** (`visual-markdown.css`): links `#725de2`/`#5a45c5` →
   `--teal`/`--teal-deep`; code `#8b3c2d` → `--teal-deep` on `--teal-tint`.
3. **Recede agent panel** (`assistant.css`): `.assistant-panel` background
   `--editor` → `--sidebar`; topbar (`chrome.css`) `#f0f0ec` → `--paper`.
4. **Snap raw values → tokens** across `sidebar.css`, `editor.css`, `chrome.css`,
   `popovers.css`, `mark.css`, `visual-markdown.css`, `assistant.css`, `app.css`,
   `responsive.css`, `base.css`. Greys → nearest ink; creams → nearest surface;
   lines → nearest border (replace the 6 `--line-*` refs); accent alphas → the
   named washes; font-family → `--font-*`; font-size → `--text-*`/`--serif-*`;
   weights → 400/500/600/700. **Stylelint is the completeness checker.**
5. Reconcile `assistant.css` literals/tokens duplication from the prior pass; drop
   `--line-*`.
6. **Then** enable the lint gate.

Every color/size move is "to the nearest perceptually-equal value," so the app
should look **identical** except the 3 intended changes (receded panel, respread
surfaces, canvas teal) plus the deliberate weight lightening (560→500).

## Enforcement

`.stylelintrc.json` (from codex — `overrides` keeps weight rules applying to the
token file; only `tokens.css` is exempt from the color bans):

```json
{
  "rules": {
    "color-no-hex": true,
    "function-disallowed-list": ["/^rgba?$/i", "/^hsla?$/i"],
    "declaration-property-value-allowed-list": {
      "font-weight": ["/^(400|500|600|700|inherit)$/"],
      "font-family": ["/^var\\(--font-/", "inherit"],
      "font-size": ["/^var\\(--/", "/em$/", "/^clamp\\(/", "inherit"],
      "font": ["inherit"]
    }
  },
  "overrides": [
    {
      "files": ["src/styles/tokens.css"],
      "rules": { "color-no-hex": null, "function-disallowed-list": null }
    }
  ]
}
```

- `package.json`: `"lint:css": "stylelint \"src/styles/**/*.css\""`. Add to the
  verify flow alongside `typecheck`/`build`.
- `font: ["inherit"]` blocks the shorthand from smuggling a raw weight/size past
  the per-property rules.
- **Doc drift fixed structurally:** `owl-lab/design-system.html` currently
  *re-declares* tokens in its own `:root` — the root cause of drift. Remove that
  block and have the doc `<link rel="stylesheet" href="../src/styles/tokens.css">`
  so it consumes the single source. (We split tokens into their own file precisely
  so the doc can link them without inheriting `base.css`'s element/reset rules.)
  Update the swatch JS arrays to the new token names/roles.
- **CLAUDE.md** Styles section: "Color/rgba lives only in `src/styles/tokens.css`;
  raw hex/rgba/hsl elsewhere is a lint error (`npm run lint:css`). font-family must
  be `var(--font-*)`; font-size must be a `var(--text-*)`/`var(--serif-*)` token
  (or `em`/`clamp` for relative/prose); font-weight is limited to 400/500/600/700.
  To add a value, add a *semantic* token first — never a one-off."

## Risk & test plan

- **Risk:** mis-mapping a hex to the wrong token shifts a color visibly.
  Mitigation: map by nearest luminance; build + eyeball after each file; the 3
  *intended* visual changes are called out so anything else is a regression.
- **Risk:** respread surfaces / receded panel look too grey or too heavy. They're
  starting values; tune live. This is the one genuinely visible change set.
- **Risk:** getting `lint:css` fully green is the bulk of the work and could miss
  a file. Mitigation: the linter itself enumerates every remaining raw color.
- **Risk:** dropping `--line-*` breaks the prior pass's `assistant.css` refs.
  Mitigation: migrate those to the new border tokens in the same change.
- No test suite. Gates: `npm run typecheck` && `npm run build` && `npm run
  lint:css` all green, then manual checks:
  1. App looks unchanged except: agent panel is grey (receded), surfaces read as
     distinct depths, canvas links/code are teal.
  2. Sidebar, editor, topbar, popovers, toasts, review annotations all legible.
  3. No raw hex remains outside `tokens.css` (`npm run lint:css` green).
