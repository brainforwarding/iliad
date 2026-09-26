# Iliad

A calm, local-first Markdown writing app for macOS and Windows x64, built with Electron. Iliad
is the place to write one document with small AI help, and the place to review
what an outside AI agent (Claude Code, Codex, or any tool) did to your writing.
It has no chat panel and no agent of its own. See
[`docs/product-vision.md`](docs/product-vision.md).

## Features

- Open a local folder as a workspace and browse it in a left sidebar.
- Create, rename, duplicate, and move Markdown files and folders to Trash.
- Edit with CodeMirror 6 and autosave to real `.md` files.
- Navigate backward and forward through recently opened documents (no tabs).
- Render common Markdown visually while inactive lines hide syntax, including
  links, images, YouTube embeds from image syntax, math, quotes, and pipe tables.
- Toggle Markdown task checkboxes inline.
- Open Markdown links inside Iliad, web links in the browser, and other local
  files with the system default app.
- Drag or paste images into a document; they are saved to
  `assets/<document-name>/` and inserted as Markdown references.
- Adjust typography from one compact popover; switch the interface between
  English and Spanish; use focus mode to hide the sidebar.
- Search file names and document contents from the sidebar.
- **Inline completion** (Gemini): a sentence, paragraph, or full idea as ghost
  text, accepted with Tab.
- **✦ AI menu** on a selection (Gemini): a typed instruction, or Rewrite /
  Expand / Shorten / Summarize / Turn into a list, reviewed inline with
  Accept / Reject.
- **Corrector**: local English writing checks, no key needed.
- **Outside-change review**: when another tool edits a document, Iliad shows
  each change in place; Keep or Restore it chunk by chunk, or Keep all /
  Restore all. Outside-created files offer Keep file / Move to Trash; outside
  deletions offer Confirm deletion / Restore file. Restores never overwrite
  newer work.
- **Comments and notes as files**: comments on a selection live in
  `name.comments.md` next to the document, and writing notes in
  `name.notes.md` (Writing assists → Open notes). Both are plain Markdown that
  outside agents can read, and they follow the document when it is renamed,
  moved, duplicated, or trashed.
- **`iliad` command** for the terminal and for outside agents (see below).

## Windows x64

Build a per-user installer with `npm run dist:win`. The bundled CLI needs no
Node.js installation and can optionally be added to PATH. See
[Windows setup](docs/windows.md) and [validation](docs/windows-validation.md).

## Run

```bash
npm install
npm run dev
```

## Gemini key

Built-in AI runs on one Gemini API key. Open **Writing assists** in the topbar
and paste the key in the Gemini key field (it powers autocomplete and the ✦ AI
menu). The key is stored in Electron app data, never in your Markdown files.
For development, `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) is also read. Google
bills this API separately. Without a key, autocomplete is off and ✦ AI is shown
disabled.

Autocomplete shortcuts (configurable under Shortcuts & accessibility):

- Cmd/Ctrl+Enter (the AI key): a sentence; press again for longer. With text
  selected it opens the ✦ AI menu.
- Cmd/Ctrl+, / Cmd/Ctrl+. / Cmd/Ctrl+/: a sentence, paragraph, or full idea.
- Tab accepts; Escape dismisses; Option/Alt+Up/Down cycles alternatives.

Automatic suggestions wait for a 450 ms pause at a word boundary; "Suggest
while I type" and "Pause for 10 min" control them. The suggestion toolbar offers
Longer, Another, and Steer…. The document's notes file guides suggestions. See
the [research and design notes](docs/research/writing-autocomplete-2026-09.md).
For a synthetic, credential-free UI preview, run Vite and open
`/tests/manual/autocomplete.html`.

## The `iliad` command

Put the command on your `PATH` from a terminal (this is what an agent does):

```bash
"/Applications/Iliad MD.app/Contents/Resources/bin/iliad" install
```

or, in the app, choose **Iliad MD → Install ‘iliad’ Command…**. Both run the
same code (`bin/lib/install.mjs`): they link the command into the first
writable of `/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin` (created if
missing), never replace another program's `iliad`, and warn if that folder is
not on your `PATH`. Running it again is harmless (`Already installed`). The
link points at the app bundle, so it keeps working after you update the app
in place. `iliad install --dir <folder>` picks the folder; `--json` prints one
object (`{"ok": true, "action": "installed" | "unchanged", "linkPath", …}` or
`{"ok": false, "code", "error"}`, also for usage errors); failures exit 1,
usage errors 2. It refuses to link a copy running from a mounted DMG: copy
the app to `/Applications` first. `iliad uninstall` removes the links it
created (not Homebrew's).

The latest DMG is always at
<https://github.com/brainforwarding/iliad/releases/latest/download/Iliad-MD-arm64.dmg>.
With Homebrew, `brew install --cask brainforwarding/tap/iliad-md` installs the
app and links `iliad` itself. The cask source is `packaging/homebrew/iliad-md.rb`,
copied to the `brainforwarding/homebrew-tap` repo on each release.

```bash
iliad [folder]                 # open a folder (the last one if omitted)
iliad status [--json]          # each window's folder and open document
iliad open <file> [--line N]   # show a Markdown file in Iliad, at line N
iliad skill install            # install the Iliad skill for Claude Code
iliad skill print              # print the skill (for AGENTS.md or other agents)
iliad install [--dir D] [--json]  # put `iliad` on PATH (run from the app bundle)
iliad uninstall [--json]       # remove the links install created
```

The skill is a copy: after updating Iliad, run `iliad skill install` again.

`iliad status` prints `Iliad is not open.` and exits 3 when the app is not
running. The CLI only reads and navigates; it never writes documents. The skill
(`resources/skill/iliad/SKILL.md`, installed to `~/.claude/skills/iliad/`)
tells agents to check `iliad status`, read the notes file, address and delete
handled comments, keep edits minimal, and finish with `iliad open`.

To test the CLI from a checkout:

```bash
npm install
npm run build
npm link
iliad .
```

Folder launches are resolved by Electron main and exposed to the renderer
through `window.iliad.getLaunchWorkspace()`. Keep changes to this path in sync
across workspace IPC/window management, `electron/preload.ts`,
`src/types/iliad.ts`, and `src/app/useWorkspace.ts`.

## Verify

```bash
npm run typecheck
npm test
npm run lint:css
npm run build
npm audit --audit-level=high
```

### Release builds (macOS)

Public releases are manual. Pushing source code does not update the public
downloadable app; the public version changes only when a signed, notarized
artifact is uploaded to a GitHub release.

Read [`docs/release.md`](docs/release.md) before releasing. In particular:

- The public GitHub repository uses a squashed public history. Do not push the
  private/local development history directly to `brainforwarding/iliad`.
- `npm run dist:mac:signed` signs the app, but it may skip notarization unless
  Apple notarization credentials are available to Electron Builder.
- This machine has a stored `notarytool` profile named `iliad-notary`; use that
  profile for manual notarization when the Apple env vars are not present.
- Update-aware releases must include the generated updater manifest. Before
  creating the GitHub release, run `npm run release:refresh-update-metadata`
  after final stapling/copying, then `npm run release:verify-update-metadata`.
  Upload `release/latest-mac.yml` plus the exact updater ZIP/DMG filenames it
  references. Do not replace metadata-referenced files with renamed copies
  unless the manifest is refreshed and verified again.

The base macOS build command is:

```bash
npm run dist:mac:signed
```

## Product Direction

Iliad does two things well: writing one document at a time with small,
review-first AI help, and reviewing what outside agents changed in a folder of
Markdown. Larger or multi-document AI work belongs to outside agents. Every
durable thing is plain Markdown on disk. See
[`docs/product-vision.md`](docs/product-vision.md) and ADR-0021 in
[`docs/decisions.md`](docs/decisions.md).

## Development Notes

Keep this README as a brief inventory of the app's user-facing features, functionality, and common development commands. When a feature ships, add or adjust one short bullet here; keep detailed rationale in `docs/` and implementation plans in `specs/`.

Read [`docs/architecture.md`](docs/architecture.md) before changing the app. It records the current product and code decisions so future work can start from the intended architecture instead of rediscovering it from the whole codebase.

Read [`docs/source-as-contract.md`](docs/source-as-contract.md) before evaluating new features. Iliad's source of truth is the on-disk Markdown file; UI features should not make the file harder to inspect, edit elsewhere, or recover.

Read [`docs/product-vision.md`](docs/product-vision.md) before adding AI or
agent-facing features. It records what Iliad is for and the directions it
avoids.

When adding features, keep behavior in the owner modules described in `docs/architecture.md`:

- `src/App.tsx` should stay a composition layer.
- Renderer workspace, persistence, file actions, preferences, and visual Markdown logic have dedicated modules under `src/app/`, `src/files/`, `src/preferences/`, and `src/editor/`.
- Electron lifecycle stays in `electron/main.ts`; filesystem enforcement and IPC handlers belong under `electron/fs/` and `electron/ipc/`.
- Styles belong in the responsibility-specific files under `src/styles/`, with `src/styles/app.css` as the import list only.

Keep `docs/` current when important product, UX, architecture, or implementation decisions are made. If a future change intentionally changes one of those decisions, update the relevant docs in the same change.

## License

MIT. See [`LICENSE`](LICENSE).
