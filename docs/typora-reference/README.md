# Typora Feature Reference

A mined inventory of Typora's published features and release history, captured here as inspiration for Iliad. Every section is summarized in our own words from Typora's public support site (`support.typora.io`). Screenshots and GIFs are downloaded locally under `assets/` and referenced inline.

This is a **reference / idea bank**, not a spec. Pick features from here that fit Iliad's direction (`docs/architecture.md`) before turning anything into a spec under `specs/`.

## Verdicts under `source-as-contract`

Sections in the files below may carry one of four tags from [`../source-as-contract.md`](../source-as-contract.md):

- **REJECTED** — breaks the rule that the on-disk `.md` is ground truth. Don't ship the feature in the form Typora ships it; either rework it or drop the idea.
- **BORDERLINE** — acceptable if used deliberately. If shipped, document the dialect choice or constraint.
- **CONDITIONAL** — safe in one implementation, rejected in another. The annotation calls out which is which.
- **ALIGNED** — the feature reinforces the rule. Worth borrowing.

Unflagged sections are safe by default. When in doubt, run the feature through the four-question test in `source-as-contract.md` before adding it to a spec.

## Contents

| File | What's in it |
| --- | --- |
| [`00-hero-priorities.md`](./00-hero-priorities.md) | **Start here.** The 10 features Typora puts in their landing-page hero, with descriptions and a tiered prioritization read for Iliad. The fastest way to skim what's worth stealing. |
| [`01-quick-start.md`](./01-quick-start.md) | The Quick Start docs — Markdown reference, tables, links, math, images, code fences, diagrams, outline/TOC, themes, file management, platform notes, sync. The widest view of what Typora considers its core writing surface. |
| [`02-how-tos-part1.md`](./02-how-tos-part1.md) | How-Tos for the editor itself — typography, focus/typewriter mode, dark mode, word count, zoom, custom CSS, task lists, line breaks, smart punctuation, version control, page width, auto-save, RTL, code-block themes. |
| [`03-how-tos-part2.md`](./03-how-tos-part2.md) | How-Tos for export, integration, and config — Pandoc, image upload services, YAML front matter, snippets, search, TOC, launch arguments, advanced settings, debug tooling, VS Code "Open in Typora" extension. |
| [`04-whats-new-1x.md`](./04-whats-new-1x.md) | Release notes 1.0 → 1.13 (2021-11 → 2026-04). The forward-looking changelog — track what shipped recently and where the product has been moving. |
| [`05-whats-new-0x.md`](./05-whats-new-0x.md) | Release notes for the 0.x betas (0.9.54 → 0.11, 2018-08 → 2021-07). The pre-1.0 history. Useful for seeing which features Typora considered foundational and which arrived late. |

## Assets layout

```
assets/
├── quick-start/<article-slug>/
├── how-tos-1/<article-slug>/
├── how-tos-2/<article-slug>/
├── whats-new-1x/<version>/
└── whats-new-0x/<version>/
```

About 326 images across 64 MB. Each section file links into its matching assets folder using relative paths, so the doc works locally without needing the asset directory inlined.

## How to use this

- **Looking for ideas in a specific area** (e.g., images, tables, focus mode): start with `01-quick-start.md` or `02-how-tos-part1.md` — they're grouped by feature, not by date.
- **Wondering what's been added lately**: skim `04-whats-new-1x.md` newest-first. Recent releases highlight what Typora's team is investing in now.
- **Looking for less-obvious power-user features** (snippets, advanced config keys, launch args, debug tools): `03-how-tos-part2.md`.
- **Curious which features pre-date 1.0**: `05-whats-new-0x.md`. The visual Markdown editor, math, diagrams, focus mode, and image uploads all landed in the betas.

## Caveats

- Summaries are in our words, condensed for skimmability — they will miss subtleties. When something looks promising, **open the source URL** linked at the top of each section to read Typora's full article.
- The source pages live on `support.typora.io` (the `typora.io/<slug>/` form 404s in some cases). All `Source:` links in the section files use the working host.
- A handful of images on Typora's CDN return 404 and are noted as `[image unavailable]` inline.
- The 1.12 release page is partially imaged for the same reason — most of its screenshots are missing on the source.
- This is a frozen snapshot. Re-run the compile if you want it refreshed.
