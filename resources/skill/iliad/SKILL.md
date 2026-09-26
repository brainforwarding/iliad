---
name: iliad
description: Use when editing Markdown in a folder that is open in the Iliad app, or when the user refers to "this document", "the open doc", "my comments" or "my notes" while working on Markdown writing.
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
- If the shell cannot find `iliad`, open a new terminal after installation.
  On Windows, use File > Install iliad Command in the app (press Alt to show
  the menu), or run `& "$env:LOCALAPPDATA\Programs\Iliad MD\resources\bin\iliad.cmd" install`
  in PowerShell for the default installation location. On macOS, run
  `"/Applications/Iliad MD.app/Contents/Resources/bin/iliad" install`.
  Installation is safe to repeat. Quote paths containing spaces in either shell.

## Notes and comments (companion files)

Each document `name.md` can have two companion files in the same folder:

- `name.notes.md`: the writer's notes for this document (audience, voice, tone,
  facts to respect). **Read it before writing or rewriting the document** and
  follow it. You may update it when a change you make affects it.
- `name.comments.md`: comments the writer attached to passages. Each entry
  looks like this:

  ```markdown
  <!-- iliad:comment id=c7f2 -->
  > the exact passage the comment refers to

  What the writer wants done there.
  ```

  Entries are separated by a line containing only `---`. The blockquote is the
  passage in `name.md` that the comment refers to. When asked to address the
  comments, make the change in `name.md` at that passage, then **delete that
  whole entry** (its metadata line, quote, comment and one separator) from
  `name.comments.md`. Leave entries you did not handle untouched. Never edit
  the metadata lines.

Never create, rename or move companion files yourself, and never give a
document a name ending in `.notes.md` or `.comments.md`. If you rename or move
a document, ask the writer to do it in Iliad instead (Iliad moves its
companions with it).

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
