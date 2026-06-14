# Iliad

A local-first Markdown writing workspace built as an Electron desktop app.

## Current Prototype

- Open a local folder as a workspace.
- Browse files in a left sidebar.
- Create Markdown files and folders from the sidebar.
- Rename, duplicate, and move files or folders to Trash from the sidebar context menu.
- Open Markdown files in the center editor.
- Navigate backward and forward through recently opened Markdown documents.
- Edit with CodeMirror 6 and autosave to real `.md` files.
- Render common Markdown visually while inactive lines hide syntax, including links, images, YouTube embeds from image syntax, quotes, and pipe tables.
- Toggle Markdown task checkboxes inline.
- Open Markdown links inside Iliad, external links in the browser, and non-Markdown local links with the system default app.
- Open non-Markdown files with the system default app.
- Drag or paste images into a document; images are saved to `assets/<document-name>/` and inserted as Markdown references.
- Adjust editor typography with compact font size and family controls.
- Switch the app interface between English and Spanish from the topbar; document content and file names stay literal.
- Use focus mode to hide the sidebar and reduce the writing surface.
- Ask a right-side agent for help with the Markdown workspace, connect Codex for the main agent, keep an OpenAI API key for media/API features such as dictation, and review generated Markdown edits or new document drafts before applying them.

## Run

```bash
npm install
npm run dev
```

## Agent And API Keys

The main agent can use Codex account authentication when connected from the
right-side agent settings. OpenAI API keys remain useful for media/API features
such as dictation and fallback text runs.

In the app, open the right-side agent panel, click the settings icon, and add
the credential you want to use.

For local development, you can provide a placeholder-backed OpenAI API
environment variable instead of saving through the UI:

```bash
OPENAI_API_KEY=sk-your-openai-api-key-here npm run dev
```

The in-app settings flow stores credentials locally in Electron app data, not in
the workspace Markdown files. Codex account state is owned by Codex; Iliad
renders only account metadata.

## Local CLI Development

To test the desktop CLI workflow locally, build and link the package, then invoke `iliad` from the folder you want to open:

```bash
npm install
npm run build
npm link
iliad .
```

The CLI path is resolved by Electron main and exposed to the renderer through `window.iliad.getLaunchWorkspace()`. Keep future changes to this path in sync across the main workspace IPC/window management, `electron/preload.ts`, `src/types/iliad.ts`, and `src/app/useWorkspace.ts`.

## Verify

```bash
npm run typecheck
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

The base macOS build command is:

```bash
npm run dist:mac:signed
```

## Product Direction

The first milestone is the editing experience: local folders, real Markdown
files, autosave, visual Markdown editing, automatic image handling, and a
review-first agent that never persists model-authored document changes without
approval.

The agent direction is Markdown-first: course maps, session guides, rubrics,
handouts, scripts, slide outlines, annexes, and templates are all Markdown
documents. The agent should coordinate writing work over those documents without
becoming a general IDE, shell, browser, or office-suite agent. See
[`docs/agent-vision.md`](docs/agent-vision.md).

## Development Notes

Keep this README as a brief inventory of the app's user-facing features, functionality, and common development commands. When a feature ships, add or adjust one short bullet here; keep detailed rationale in `docs/` and implementation plans in `specs/`.

Read [`docs/architecture.md`](docs/architecture.md) before changing the app. It records the current product and code decisions so future work can start from the intended architecture instead of rediscovering it from the whole codebase.

Read [`docs/source-as-contract.md`](docs/source-as-contract.md) before evaluating new features. Iliad's source of truth is the on-disk Markdown file; UI features should not make the file harder to inspect, edit elsewhere, or recover.

Read [`docs/agent-vision.md`](docs/agent-vision.md) before changing the agent,
context, proposal, or runtime architecture. It records the Markdown-first agent
boundary and the directions Iliad should avoid.

When adding features, keep behavior in the owner modules described in `docs/architecture.md`:

- `src/App.tsx` should stay a composition layer.
- Renderer workspace, persistence, file actions, preferences, and visual Markdown logic have dedicated modules under `src/app/`, `src/files/`, `src/preferences/`, and `src/editor/`.
- Electron lifecycle stays in `electron/main.ts`; filesystem enforcement and IPC handlers belong under `electron/fs/` and `electron/ipc/`.
- Styles belong in the responsibility-specific files under `src/styles/`, with `src/styles/app.css` as the import list only.

Keep `docs/` current when important product, UX, architecture, or implementation decisions are made. If a future change intentionally changes one of those decisions, update the relevant docs in the same change.

## License

MIT. See [`LICENSE`](LICENSE).
