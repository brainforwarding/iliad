# Calm the agent panel — weight, color, and context noise

**Date:** 2026-05-25
**Status:** reviewed (codex fullstack + UX) → ready to implement

> **Review note (2026-05-25).** Folded in two reviews. Codex (fullstack):
> signature must include `baseHash`, use structured `JSON.stringify` instead of
> delimiter-concat, keep strict `provider.label`/`.id` (both required on the
> type), and thread a local `previousAssistantContextSignature` updated only for
> assistant entries with a manifest (status entries don't reset it). UX: use the
> system **eyebrow + title** header pattern instead of a title-with-"Agente"
> fallback; give headings real **size + color** steps (not just weight); and fold
> the **purple links** and **red-brown inline code** into the one teal accent —
> the two remaining "second accent" violations. Sections below updated.

## Problem

The agent panel (right side) reads as cluttered and heavy, against the design
system's own rules (`owl-lab/design-system.html`): *"Restraint. Fewer things,
better spaced."* and the explicit Don't: *"Introduce a second accent color or
heavy bold."*

Concretely, `src/styles/assistant.css` alone carries:

- **~15 distinct font sizes** (0.67 → 1.06rem).
- **~7 weights** (400 body, 500, 520, 560, 600, 650, 680) **plus an un-styled
  `<strong>` that falls through to the browser default 700**.
- **~16 different ink/grey hexes**, none of which reference a token — several are
  near-identical greys (e.g. `#72766e`, `#73776f`, `#74786f`, `#767a72`) that
  should all be one value.

The design system defines a 6-step ink/muted scale and a single accent. **It also
claims those tokens live in `src/styles/base.css` as the source of truth — but
they do not exist there.** `base.css` defines only the two radii and the focus
ring; every color in the app is a hardcoded hex. So step one is to make that
claim true.

User-reported pain points (in priority order):

1. Rendered-markdown **bold is too bold** (browser-default 700 in a narrow sans
   column).
2. The **"Contexto: 1 archivo + …" line repeats under every message**, is itself
   semi-bold, and is redundant with the composer's context chips.
3. The **header** stacks a bold "Agente" label over a muted chat title, inverting
   the hierarchy (the label wins over the actual content).
4. General **weight/color sprawl** — too many slightly-different values.

## Goals

- Make weight mean "this matters more." Reserve ≥600 for genuine emphasis.
- Collapse the panel's grey palette onto the design-system ink/muted scale.
- Show context provenance **only when it changes**, not once per message.
- No behavior change to runs, proposals, dictation, history, or review.

## Non-goals

- Migrating the **whole app** to tokens. We define the tokens app-wide but only
  convert `assistant.css` in this change; sidebar/editor/chrome stay on their
  current hexes (follow-up). Defining unused vars is additive and changes
  nothing until consumed.
- Touching the editor canvas (serif prose). Its bold is fine — serif on a wide
  measure. This change is sans-chrome only.
- Changing what context is *collected*; only how/when it is *displayed*.

## Changes

### A. Introduce the color tokens (`src/styles/base.css`)

Add the design-system palette to `:root`, copied verbatim from the values in
`owl-lab/design-system.html` so the doc's "source of truth" claim becomes true:

```css
/* surfaces */
--paper: #f7f6f0;  --editor: #fffefa;  --sidebar: #f3f2ec;  --card: #f4f3ec;
/* ink / text */
--ink-1: #1f211f;  --ink-2: #242624;  --ink-3: #2d302c;
--muted-1: #52584f; --muted-2: #62675f; --muted-3: #767a72;
/* teal accent */
--teal: #196f64; --teal-deep: #145b52; --teal-deepest: #104d46; --teal-tint: #e8efe9;
/* hairlines */
--line-1: #eeece5; --line-2: #e9e5dc; --line-3: #dfded5; --line-4: #d8d7ce;
/* status */
--error: #8a3d2a; --pending: #c98912; --create: #2f9a5b;
```

These are additive. Existing hardcoded hexes elsewhere keep working unchanged.

### B. Markdown bold + headings (`src/styles/assistant.css`)

The user's most visceral complaint. Add an explicit emphasis rule and lighten
headings so hierarchy comes from **size + space, not weight**:

```css
.assistant-markdown strong,
.assistant-markdown b {
  font-weight: 600;            /* was inherited 700 */
}

.assistant-markdown h1,
.assistant-markdown h2,
.assistant-markdown h3,
.assistant-markdown h4 {
  margin: 12px 0 0;            /* was 2px — earn hierarchy with space */
  color: var(--ink-2);
  font-weight: 600;            /* was 680 */
  line-height: 1.25;
}

.assistant-markdown h1 { font-size: 1.05rem; }   /* was 1.06 — = system Subsection */
.assistant-markdown h2 { font-size: 0.95rem; }   /* was 0.98 */
.assistant-markdown h3,
.assistant-markdown h4 {
  font-size: 0.88rem;          /* was 0.92 */
  color: var(--muted-1);       /* step DOWN in color, not just size, so the
                                  lowest headings don't read as full-ink bold */
}
```

**Why size + color, not weight (UX review).** At 600 — the same weight as inline
bold — headings must differentiate some other way. The old sizes (1.06 / 0.98 /
0.92) were only a 14% spread and h2 sat 0.06rem above inline bold, so an h2 next
to a bolded lead-in word was indistinguishable. The new steps give a real ~19%
spread, and h3/h4 step *down* in color (`--muted-1`) so the hierarchy reads even
when sizes are close. `.assistant-markdown` is `display:grid; gap:9px`; grid
items do **not** margin-collapse, so the 12px `margin-top` is additive to the gap
(~21px above a heading) — real breathing room. `:first-child` reset zeroes the
top margin of the first block.

600 is the design-system's sanctioned emphasis weight ("Subsection · sans · 600"
at 1.05rem — h1 now matches it exactly). Table-header `th { font-weight: 650 }` →
`600` for the same reason.

### C. Header → eyebrow + title (`AssistantHeader.tsx` + `assistant.css`)

The chat title is the content; "Agente" is a label for something already obvious
from the panel's position. But fully dropping the label and falling back to
`activeThreadTitle || labels.title` makes the fallback string *masquerade as a
title* at the same weight, and flips to a real title on first reply.

Use the design system's documented **eyebrow + content** pattern instead (per UX
review): a tiny persistent uppercase "AGENTE" kicker that durably signals "this
is the agent" (and is the listed Do — "reach for… the meta-label pattern"),
with the chat title as the primary line beneath it. A brand-new thread shows just
the calm eyebrow; once titled, the title appears below.

`AssistantHeader.tsx`:

```tsx
<div className="assistant-title-block">
  <span className="assistant-eyebrow">{labels.title}</span>
  {activeThreadTitle ? <span className="assistant-thread-title">{activeThreadTitle}</span> : null}
</div>
```

(Two classed spans — semantically neutral, no false `<strong>` emphasis on a
title.)

`assistant.css` — scope new rules to `.assistant-header` only; **leave the shared
`.assistant-header span, .assistant-review-header span` and `.assistant-header
small, .assistant-review-header strong` rules (lines ~30–46) and the review
header (lines ~938+) untouched** so the proposal/review panel is unaffected:

```css
.assistant-header .assistant-eyebrow {
  color: var(--muted-2);
  font-size: 0.66rem;
  font-weight: 650;
  letter-spacing: 0.08em;
  line-height: 1.3;
  text-transform: uppercase;
}

.assistant-header .assistant-thread-title {
  overflow: hidden;
  color: var(--ink-2);
  font-size: 0.86rem;
  font-weight: 500;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

Both selectors (`.assistant-header .assistant-eyebrow` / `.assistant-header
.assistant-thread-title`) are more specific than the shared `.assistant-header
span` rule, so they override font-size/weight without editing the shared rule.

### D. De-bold meta (`src/styles/assistant.css`)

The context disclosure summary reads as emphasized at 520 while being the least
important thing on screen. Drop it to body weight, keep it accessible:

```css
.assistant-context-disclosure        { color: var(--muted-2); }   /* was #72766e */
.assistant-context-disclosure summary { font-weight: 400; }       /* was 520 */
.assistant-context-disclosure summary::marker { color: var(--muted-3); }
```

`--muted-2` (#62675f) keeps small-meta contrast ≥ 4.3:1 per the system; we do
**not** drop informational text to the decorative `--muted-3`.

Convert the remaining greys in this file to the nearest token (see mapping). The
near-duplicate greys collapsing onto one value *is* the intended visual change.

### E. Context disclosure — render only on change

`src/assistant/assistantUtils.ts` — add a signature derived from what's displayed.
Per codex review: include `baseHash` (so a *content* change to the same file
re-shows context, not just a path change), build it with `JSON.stringify` over
structured tuples (paths/labels may contain `:`/`|`, which would collide under
delimiter-concat), **preserve item order** (the detail UI renders original order,
so the signature should too — no `.sort()`), and use the strict required
`provider` fields:

```ts
export function contextManifestSignature(
  manifest: Pick<AgentRunContextManifest, "items" | "provider" | "model"> | undefined | null
): string {
  if (!manifest) return "";
  const items = (manifest.items ?? []).map((i) => [
    i.kind,
    i.relativePath ?? i.label ?? "",
    i.inclusion,
    i.baseHash ?? ""
  ]);
  return JSON.stringify({ items, provider: manifest.provider.id, model: manifest.model });
}
```

`AssistantTranscript.tsx` — per codex's assessment, keep a single mutable
`previousAssistantContextSignature` while mapping `entries`. For each **assistant**
entry that has a `contextManifest`, compute its signature; render
`<AssistantContextDisclosure>` only when it differs from the previous one, then
update the tracker. Status/error/user entries interleaved between assistant
messages must **not** reset the tracker. The disclosure stays a child of the
existing `entry.id`-keyed wrapper, so React keys are unaffected.

Result: first assistant message in a thread shows context; identical successors
stay silent; attaching a *different* file — or editing the same file between runs
(baseHash changes) — makes it reappear.

**Considered and deferred (UX review).** The UX reviewer preferred a *persistent
ultra-quiet per-message anchor* (a tiny dot that expands only on change) over
removing the affordance entirely, to avoid "where did it go" ambiguity. We're
keeping pure render-on-change because (a) it's the behavior the user explicitly
approved and the quietest option, and (b) the composer's context chips remain the
always-visible "what's in context now" display. If absence proves confusing in
use, the persistent-dot variant is the documented next step.

The composer's context chips remain the "what's in context right now" display;
the per-message disclosure becomes purely the "what changed" record.

## Grey → token mapping (assistant.css)

| Current hex | Token | Notes |
|---|---|---|
| `#242624` | `--ink-2` | exact |
| `#2f332e` | `--ink-3` | body text, ~exact |
| `#2b2d2a`, `#343733`, `#373a36` | `--ink-3` | near-identical inks |
| `#4f554e`, `#555a53` | `--muted-1` | |
| `#62675f` | `--muted-2` | exact |
| `#72766e`, `#73776f`, `#74786f`, `#767a72`, `#7a7e76` | `--muted-3` | collapse the duplicate greys |
| `#8a8f86`, `#9da29a`, `#a5aaa0`, `#b8aaa3` | `--muted-3` (or leave) | decorative; markers/disabled — reviewer's call |
| `#eeece5` | `--line-1` | borders |
| `#e9e8e1`, `#e5e3dc`, `#e2e0d6` | `--line-2`/`--line-3` | nearest |
| `#d8d7ce`, `#ddddd4` | `--line-4` | controls |
| `#196f64` / `#145b52` | `--teal` / `--teal-deep` | accent stays |

### Fold stray hues into the one accent (UX review)

Two genuine "second accent" violations in this file get mapped to teal — the
highest-leverage clutter reduction available, and squarely on the "too many
colors" complaint:

```css
.assistant-markdown a    { color: var(--teal-deep); }   /* was #725de2 purple */
.assistant-markdown code {
  border-color: var(--teal-tint);
  background: var(--teal-tint);
  color: var(--teal-deep);                               /* was #8b3c2d red-brown */
}
```

This matches the design system's own `.prose a` (teal-deep) and `code.tok`
(teal-deep on teal-tint), and stops inline code from reading like error text.

Keep the genuine status/error reds (`#8a3d2a`, `#fff3ee`) — those carry meaning.
The `is-unsafe` link override (`color: inherit`) stays as-is.

## Risk & test plan

- **Risk:** assistant.css is large; a stray selector edit could hit the shared
  `.assistant-review-header`. Mitigation: scope header rules to `.assistant-header`
  and leave the shared rule intact.
- **Risk:** dedupe hides context when it *should* show (e.g. two runs, second
  removed a file). Mitigation: signature includes inclusion + path + provider +
  model, so any displayed difference re-shows it.
- No test suite exists. Verify with `npm run typecheck` && `npm run build`, then
  manual checks in the Electron app:
  1. Send a message → bold in the reply is semibold, not black; headings read as
     headings via size/space.
  2. Header shows the chat title on one line; a brand-new chat shows "Agente".
  3. Ask two questions in a row with the same file attached → context disclosure
     appears under the first answer only.
  4. Attach a different file (or edit the same file between runs → baseHash
     changes), ask again → disclosure reappears.
  5. Open the context disclosure → rows still legible; summary no longer bold.
  6. Links in a reply are teal (not purple); inline `code` is teal-on-tint (not
     red-brown); a brand-new chat header shows the "AGENTE" eyebrow with no title.
  7. Review/proposal panel header and inline `<strong>` styling unaffected.
```
