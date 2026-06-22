# Post-Fix Marketing Screenshot Plan

Date: 2026-06-21
Status: later work

This plan starts after the internal assistant review work and external
filesystem review regression both pass.

## Repositories

- App repo: `/Users/sebastian/dev/iliad`
- Website repo: `/Users/sebastian/dev/iliad-site`
- Website demo content workspace:
  `/Users/sebastian/dev/iliad-site/my-docs`

The goal is to replace mockups on the Iliad website with real screenshots from
the app using the demo files already created in `my-docs`.

## Capture Method

Bring Iliad to the front and save a screenshot:

```sh
osascript -e 'tell application "System Events" to set frontmost of process "Iliad MD" to true'
screencapture -x /private/tmp/iliad-marketing-shot.png
```

Then inspect the PNG locally. If the screenshot includes too much desktop or
terminal UI, use one of these refinements:

- crop the saved image after capture;
- use `screencapture -l <window-id> -x <output.png>` after finding a reliable
  Iliad window id;
- run a controlled Electron dev window at a fixed size and capture the whole
  screen with only Iliad visible.

Suggested output folder for final assets:

```text
/Users/sebastian/dev/iliad-site/assets/iliad-screenshots/
```

Before changing the website, inspect existing image usage in
`/Users/sebastian/dev/iliad-site` and match its naming, dimensions, and image
compression conventions.

## Demo Workspace

Use `/Users/sebastian/dev/iliad-site/my-docs` as the screenshot workspace. It
contains files for:

- novel/document reading and clean editor layout;
- research notes and tables;
- review workflows;
- teaching/workshop examples;
- visuals/image workflows;
- workspace/file-tree interactions;
- writing assists such as corrector and tightening examples.

Do not use destructive repeated QA directly on these files unless they are
reset first. Use disposable temp workspaces for stress tests, and use
`my-docs` only for curated final states.

## Shot List

Capture these after the app is stable:

- Clean Markdown editing with the file tree open.
- Internal assistant proposal with green additions and review controls.
- Internal assistant hunk-level review after accepting/rejecting one hunk.
- External filesystem review showing live outside changes.
- New external file review showing all-green content.
- Deleted external file review showing struck file-tree row and removed text.
- Writing corrector suggestions.
- File tree search/content discovery.
- Context attachments or assistant panel with a clean proposal card.
- Focus/full-screen editor mode if it remains a product feature.

## Quality Bar

Each screenshot should:

- show real Iliad UI, not a browser mockup;
- use stable curated content from `my-docs`;
- avoid visible terminal windows, test folders, or temp paths;
- avoid duplicated pending cards or broken review states;
- fit the website's current visual dimensions or be easy to crop into them;
- have a saved source PNG and an optimized website asset.

## Later Workflow

1. Finish internal assistant review fixes.
2. Re-run external filesystem review visual regression.
3. Open `/Users/sebastian/dev/iliad-site/my-docs` in Iliad.
4. Prepare one feature state at a time.
5. Capture the screenshot to `/private/tmp`.
6. Inspect the screenshot.
7. Copy final screenshots into the website asset folder.
8. Replace website mockup references in `/Users/sebastian/dev/iliad-site`.
9. Run the website locally and verify the final pages visually.
