# Source as Contract

The on-disk Markdown file is the contract between Iliad, its users, and any tool that reads or writes those documents. This is the lens to use when evaluating any new feature.

## The principle

> Reading the `.md` file gives a tool everything it needs to reconstruct what the user sees. Writing a Markdown change to the file produces exactly the rendered change the user expected — nothing more, nothing less.

If a feature breaks either direction of that statement, it is risky and should be reworked, restricted, or rejected.

## Why this matters

1. **AI integration.** Iliad is on a path toward an AI assistant that reads and edits the same documents the user does. That only works when the `.md` file is ground truth. If the editor renders something the source doesn't justify, or stores meaning outside the file, the AI is at a permanent disadvantage.
2. **Portability.** Iliad documents will be opened in GitHub previews, VS Code, mobile editors, pandoc, static-site generators. Features that depend on Iliad-specific behavior make those tools unreliable.
3. **Trust.** When a user types `--`, they want `--` saved. When they reopen a file from yesterday, they want to see what they typed. Silent transformations erode the sense that the editor is on their side.

## The two failure modes

Features fail this rule in one of two ways:

**Implicit source mutation.** The editor changes the file in ways the user didn't directly type. Smart quotes replacing `"` with `“`/`”`. Image upload rewriting local refs to CDN URLs on save. Autoformat-on-save reflowing paragraphs. The user sees one thing while typing and finds another on reopen.

**Out-of-file state.** Information needed to interpret the file is stored outside it — sidecar files, a custom database, editor-only attributes. The file stops being self-describing; a tool reading the `.md` cannot recover the user's view.

## The decision rule

Before shipping a feature, all four of these must be yes:

1. **Round trip.** If a tool reads the source as standard GFM and writes it back unchanged, does the user's rendered view stay the same?
2. **Source = view.** Can a person reading the raw `.md` understand everything that's rendered, without consulting any other source?
3. **No silent rewrites.** If the feature transforms text, is the transformation triggered by an explicit user action (drag-drop, command, button) — not by save-time or background processes?
4. **No hidden state.** Does the feature work the same way if someone opens the file in another editor, or moves the workspace folder elsewhere?

If any answer is no, the feature needs rework or a deliberate, documented exception.

## Examples

### Safe

- Visual rendering of standard Markdown (headings, lists, tables, math, code fences, links, images)
- Visual table editing that round-trips to pipe-table syntax
- Outline / TOC sidebar panel (display only, no token written to the file)
- Focus mode, typewriter mode, word count, themes, typography (display only, `localStorage`-backed)
- Drag-drop image insert that writes standard `![alt](./relative/path)` — Iliad already does this
- Auto-pair brackets (the user typing `(` and getting `()` is adding characters they intended, not a silent rewrite)
- Mermaid, math via code fences (the source is a canonical fenced block)
- Spellcheck (display only)

### Borderline — fine if used deliberately, but write down the choice

- `<img width="…">` for image resize: valid GFM, but non-canonical. Prefer when a plain `![]()` can't express the intent.
- YouTube embeds from `![title](youtube-url)`: Iliad renders recognized YouTube image URLs as videos, while other Markdown tools may show a broken image. The source stays self-describing, preserves the exact URL, and uses no hidden state, but this is an intentional Iliad visual extension rather than standard Markdown video syntax.
- `[TOC]` token: non-standard, survives round-trip cleanly if reader and writer agree. Prefer a sidebar outline panel.
- Footnotes, highlight (`==x==`), sub/superscript (`H~2~O`, `x^2^`): pick the dialect once, document it here.
- YAML front matter: meta-only and useful for site generators, but not all parsers handle it. Worth the cost only if many users need it.

### Rejected

- **Smart punctuation** — silent rewrite at typing time (`"` → `“`/`”`, `--` → `—`, `...` → `…`). High diff churn, surprises the user, breaks AI suggestions that round-trip through the source.
- **Image upload as a save-time side effect** — the file mutates without an explicit edit. An explicit "Upload this image" command is fine; the silent-on-save version is not.
- **Page breaks via `<div style="page-break:…">`** — HTML layout creeping into Markdown.
- **Text snippets / auto-expansion** — what the user typed and what's in the file diverge.
- **Editor-only attributes** (fold state, view anchors, custom IDs) written into the file body.
- **Custom CSS classes used for layout** (`<div class="two-column">…</div>`). Layout markup belongs out of the document.

## When to break the rule

Rarely, and deliberately. Document the reasoning in a spec under `specs/` and record the resulting decision in `docs/architecture.md`. Two scenarios that might justify it:

- A feature so important to users that they accept the portability cost (e.g., front matter for site generators).
- A feature where the silent transformation is reversible and the rewrite is visible in the diff (e.g., a one-shot "Upload all images" command that the user invokes explicitly).

If you find yourself reaching for an exception more than once or twice across the product's life, the rule is the wrong rule — revisit this document instead of accumulating exceptions.

## Relationship to AI integration

The agent operates on the same `.md` text the user sees. Every durable writing
artifact it creates should be a Markdown document, whether the user calls that
artifact a rubric, handout, lesson plan, script, deck outline, research annex,
or template. Every diff it proposes should be a Markdown diff. Every edit the
user accepts should be applied to the same source file.

Features that pass this rule make agent workflows safe by default. Features
that fail it would require special-case handling in the AI layer, which is
exactly the complexity worth avoiding before it accrues.

A useful side effect: Markdown diffs are human-reviewable. Keeping the source
canonical means AI suggestions stay reviewable too.

See [`agent-vision.md`](./agent-vision.md) for the Markdown-first agent
boundary.
