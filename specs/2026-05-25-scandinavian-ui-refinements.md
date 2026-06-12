# Scandinavian-minimalist UI refinements

Date: 2026-05-25
Status: implemented (designer-reviewed) — typecheck + 188 tests + build green

> Implemented all 8 final-scope items. Deferred only the topbar **regrouping**
> (sub-grouping the action icons needs a TSX restructure; the `T`→`ALargeSmall`
> glyph swap and icon focus rings shipped). Radius tokens applied to the surfaces
> in scope; no spacing/type-scale sweep, as agreed.

> Review folded in. Changes from draft: surface radius `8px` (not 10 — 10 reads
> "soft-SaaS"); **drop** the 8px spacing-grid sweep and type-scale tokens
> (over-engineered — keep the pass visual); **add** a focus-ring spec and darken
> tiny meta labels (accessibility); concrete sage/clay annotation values; topbar
> is a **grouping** problem, not raw gap; typography glyph is `ALargeSmall`. Final
> scope below supersedes the original section bodies.

Polish pass, not a redesign. The app is already restrained (warm paper ground,
single teal accent, serif prose + sans chrome, owl used sparingly). Goal: sand the
edges toward Nordic calm — quieter weights, fewer boxes, one consistent rhythm —
without changing layout, features, or the palette.

Principles: weight *or* color (not both), hairlines/space over outlines, one radius
system + one spacing grid, surfaces over borders for "active". No new colors; no
new components; keep focus mode, the owl, the editor measure untouched.

## 1. Calmer sidebar (highest impact)

`src/styles/sidebar.css`. Markdown filenames are `font-weight: 580`
(`.tree-item.is-markdown .tree-name`, :101) — against lighter folders this reads
semi-bold and busy down the whole column.

- Reduce Markdown filename weight to ~`500`; keep folders at their base weight.
  No item should look bold at rest.
- Active file: keep the grey fill but add a **2px teal left-edge marker**
  (`box-shadow: inset 2px` or a pseudo-element) — a quiet "you are here" instead
  of weight. Selected (not open) stays fill-only.
- Leave the existing low-opacity treatment for `.is-external`/`.is-asset` (0.66) —
  it already does the right job.

## 2. De-box settings + typography popover

Nordic separation = space and faint lines, not outlined rectangles.

- **Settings connection cards** (`.assistant-conn-card`, `assistant.css`): drop the
  `1px` border; use the tint `#fbfaf4` only, and a single hairline (`#eeece5`)
  *between* the two cards rather than a box around each. Keep internal padding.
- **Typography popover** (`src/styles/popovers.css`): remove the nested box around
  the `A- / 16px / A+` row and the `Serif/Sans/Mono` segmented control; let them
  sit on the popover surface separated by whitespace. Keep the popover's own
  surface (one container, gentle radius, soft shadow).

## 3. One radius system + 8px spacing grid

Radii today: 4/5/6/7/8/9px scattered (plus 999px pills, 50% dots). Consolidate to
**two**: `--radius-surface: 10px` (panels, cards, popovers, large buttons) and
`--radius-control: 6px` (inputs, small buttons, chips). Keep `999px` pills and
`50%` dots. Spacing: standardize gaps/padding to an **8px rhythm** (4/8/12/16/24)
on the surfaces we touch — don't churn unrelated files.

- Add the two radius tokens to `:root` (in `base.css`) and apply on the surfaces in
  scope; leave out-of-scope rules alone to keep the diff small.

## 4. Quieter segmented "active" state

`.assistant-mode-row` (Rápido/Equilibrado/Profundo) and the typography
`Serif/Sans/Mono` control show active via a **teal border** (outline). Switch to a
**soft filled pill**: active = faint teal tint `#e8efe9` + teal text (`#145b52`),
no border; inactive = plain text on the track, transparent. Less line, more
surface.

## 5. Soften the review annotation colors

`editor.css`: the inserted background `rgba(42,126,84,0.12)` and removed-red read a
touch highlighter-bright on paper. Desaturate slightly toward sage/clay (lower
saturation, marginally warmer) so they read as annotation, not marker. Keep enough
contrast for the active hunk state.

## 6. Topbar icon clarity + breathing room

`chrome.css`. The editor-zone icons (`T`, translate, panel-toggle, focus) cluster
tightly, and `T` (typography) is the one ambiguous glyph.

- Add a touch more gap between icon-buttons; keep a consistent 16–17px glyph size.
- Replace the `T` typography glyph with a clearer **`Aa` / type-size** mark
  (lucide `CaseSensitive` or `ALargeSmall`), so minimal isn't cryptic. Tooltip
  stays.

## 7. Type-scale discipline

Document a small explicit scale as CSS custom properties and apply on the surfaces
in scope (don't restyle prose): display ~`2.4rem` serif (empty state), section
~`1.05rem`, chrome body `0.9rem`, meta `0.74rem`. The rendered-doc serif headings
are the anchor — chrome should defer to them. Mostly this is *naming* what's
already there so future surfaces don't drift.

## Final scope (supersedes the bodies above)

1. **Sidebar** (`sidebar.css`): Markdown filename weight 580 → ~`500`; **active
   file** = neutral fill + a non-shifting `2px` inset left marker
   `rgba(25,111,100,0.65)` (no teal text, no weight change). Dots avoided (clash
   with pending dots).
2. **De-box** (`assistant.css`, `popovers.css`): connection cards lose the border
   (tint `#fbfaf4` + a single hairline `#eeece5` *between* cards) — they're status
   groupings, not buttons. Typography popover: remove the boxed segmented track,
   **but** `A-`/`A+`/reset/`Serif·Sans·Mono` keep real hit areas, hover, and focus
   (not plain labels).
3. **Radii**: tokens `--radius-surface: 8px`, `--radius-control: 6px` in `:root`;
   apply on the surfaces in scope only. **No** spacing-grid sweep, **no** type-scale
   tokens this pass.
4. **Segmented active** (`.assistant-mode-row`, typography control): filled pill —
   active `background:#e8efe9; color:#145b52` (≈6.8:1), no border/shadow; inactive
   transparent, text `#4f554e`; hover `rgba(214,211,198,0.30)`.
5. **Annotations** (`editor.css`): desaturate (not just opacity). Inserted
   `rgba(93,125,98,0.12)`, active `0.18`; removed `rgba(155,102,88,0.10)`, active
   `0.16`. Keep active hunks clearly stronger.
6. **Topbar** (`chrome.css` + the topbar TSX): swap the `T` typography glyph for
   lucide `ALargeSmall`. **Group**, don't globally widen: nav tight; typography +
   language together; slightly more separation before panel/focus. (Gap is already
   10px.)
7. **Focus ring (new, accessibility)**: one visible ring
   `box-shadow: 0 0 0 2px rgba(25,111,100,0.14)` + `border-color:#9db4ad` on
   `:focus-visible` for icon buttons, segmented buttons, popover buttons, text
   actions, and file rows. Tooltip/hover is not a focus indicator.
8. **Meta labels (new, contrast)**: bump tiny uppercase/meta text from `#8a8f86`
   (~3.3:1) to `#62675f` (settings section labels, similar small chrome).

## Explicitly out of scope / unchanged

The owl (singular, keep), the paper palette + single teal accent, focus mode, the
editor measure/margins, layout, and any feature behavior. No dark mode in this pass.

## Risks

- Radius/spacing token rollout can balloon — **bound it to the surfaces named
  here**; do not sweep every rule.
- Active left-edge marker must not shift row text (use inset shadow/absolute
  pseudo-element, not a layout border).
- Don't regress contrast/legibility when softening weights and annotation colors
  (check the active-hunk green still reads).

## Tests / checks

No behavior change, so mostly visual. Run `npm run typecheck`, `npm test` (ensure
the 188 stay green — the `codexSettingsCopy`/transcript DOM-string tests must not
break on class/structure tweaks), `npm run build`. Manual: sidebar at rest (no
bold), active file marker, settings/typography popover de-boxed, segmented pills,
review colors, topbar spacing + new typography glyph, across light paper.
