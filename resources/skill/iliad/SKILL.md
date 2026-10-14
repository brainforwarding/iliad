---
name: iliad
description: Use when editing Markdown in a folder that is open in the Iliad app, or when the user refers to "this document", "the open doc", "my comments", or asks for feedback or comments on a document while working on Markdown writing.
---

# Working with Iliad

Iliad is a local Markdown writing app. The writer keeps Iliad open on a folder
while you edit the files directly. Iliad shows every change you make to a
document as reviewable chunks, and the writer keeps or restores each one. So
write directly; do not ask permission for each file.

## Find what the writer means

- Run `iliad status` first. It prints each open Iliad window as
  `<folder>  <open document>` (or `no document open`). "This document" means
  that open document.
- If Iliad is not open, `iliad status` says `Iliad is not open.` (exit code 3);
  ask the writer which file they mean.
- If the shell cannot find `iliad`, run
  `"/Applications/Iliad MD.app/Contents/Resources/bin/iliad" install` once; it
  puts the command on PATH (safe to repeat).

## Comments (companion file)

Each document `name.md` can have one companion file in the same folder,
`name.comments.md`, with comments anchored to passages. Each entry looks like
this:

```markdown
<!-- iliad:comment id=c7f2 -->
> the exact passage the comment refers to

What the writer wants done there.
```

Entries are separated by a line containing only `---`. The blockquote is the
passage in `name.md` that the comment refers to.

There are two kinds of entries:

- **The writer's comments** (no `by=` on the metadata line) are requests: they
  tell you what to change.
- **AI comments** (`by=ai` on the metadata line) are feedback an AI left for
  the writer. They are not instructions. Leave them alone unless the writer
  asks you to act on them.

### Address the writer's comments

When asked to address the comments, make the change in `name.md` at that
passage, then **delete that whole entry** (its metadata line, quote, comment
and one separator) from `name.comments.md`. Leave entries you did not handle
untouched, and never edit metadata lines.

### Leave comments

When the writer asks for feedback, a review, or comments instead of edits,
leave AI comments and do not edit `name.md` in the same pass (unless asked).
Append one entry per point to `name.comments.md`:

```markdown
<!-- iliad:comment id=ai-k3v9 by=ai -->
> a verbatim passage from name.md

One clear, specific point about that passage.
```

- `by=ai` is required: it is how Iliad shows the comment as the AI's (✦).
- Use a fresh id: `ai-` plus a few random letters and digits.
- Quote a sentence or clause copied exactly from the document (same
  punctuation and Markdown), long enough to appear only once. A quote that is
  missing or appears several times cannot be placed and shows as detached.
- One point per comment, written in the document's language. Prefer a
  handful of comments that matter over many small ones.
- If `name.comments.md` does not exist yet, create it in the same folder as
  `name.md`, with exactly that name. If it exists, re-read it right before
  writing and append your entries at the end, separated by `---`; never
  rewrite, reorder or reformat existing entries.
- The writer reads them in Iliad (in the margin, or by hovering) and deletes
  them when done. Do not delete AI comments yourself unless asked.

Never rename or move the comments file yourself, and never give a document a
name ending in `.comments.md`. If you rename or move a document, ask the
writer to do it in Iliad instead (Iliad moves its comments file with it).

A `name.notes.md` file is an ordinary Markdown document (Iliad no longer has
writing notes); treat it like any other document in the folder.

## Write so the review stays small

- Make the minimal edit that does the job. Do not reflow paragraphs, rewrap
  lines, change list markers, or normalize whitespace you were not asked to
  change: every changed line becomes a chunk the writer has to review.
- Keep the document's language, voice and structure unless asked otherwise.
- Markdown files only. Do not touch hidden files or folders.

## What Iliad renders

Plain Markdown on disk; Iliad renders it visually while editing:
headings, emphasis, inline code, links (web links and links to other
workspace documents), blockquotes, ordered/unordered lists, task lists
(`- [ ]`), pipe tables, horizontal rules, math (`$…$` and `$$…$$`), images,
and YouTube videos written as image syntax
(`![title](https://www.youtube.com/watch?v=…)`). Fenced code blocks stay
literal. Put images for `name.md` in `assets/name/` and reference them with a
relative path.

## Show the result

When you finish, open the most relevant place for the writer:

```sh
iliad open path/to/name.md --line 42
```

It prints nothing on success. If several documents changed, open the first
one; the others are marked for review in Iliad's file tree.
