# Windows x64

Iliad supports Windows x64 with a per-user NSIS installer. The installed app
and CLI include Electron; Node.js is required only for development.

## Installation and CLI

Build with `npm ci` and `npm run dist:win`. Run the versioned `.exe` in
`release/`. Local and CI installers are unsigned and may show a Windows warning.
The installer needs no administrator privileges and preserves documents and
preferences on uninstall.

Command installation is optional and unchecked on fresh installs. Enable
**Install the iliad command**, or later use **File > Install iliad Command**
(press Alt to show the menu). Open a new terminal after installing it.
The managed shim lives at `%LOCALAPPDATA%\Iliad\bin\iliad.cmd`.
Foreign commands are never overwritten; an earlier command on PATH is reported.
`iliad uninstall` removes only the managed shim and its owned PATH entry.

```powershell
iliad 'C:\Writing\My book'
iliad status --json
iliad open 'C:\Writing\My book\Chapter 1.md' --line 5
iliad skill print
```

Silent installs accept `/S /ILIADCLI=1` (enable) or `/S /ILIADCLI=0`
(disable). Omitting the option preserves the previous choice, defaulting to
disabled on fresh installs. CLI failures are reported and can be retried from
the application menu.

## Development and verification

Use Node.js 22, then run `npm ci`, `npm run typecheck`, `npm test`,
`npm run lint:css`, and `npm run dist:win`.

```powershell
npm run test:windows:app -- 'release/win-unpacked/Iliad MD.exe'
```

Application tests create synthetic documents and isolated profiles under
`test-artifacts/`. Neither API keys nor personal documents are used.
See [the validation checklist](windows-validation.md) for installer and manual tests.

## Platform contracts

- The existing NDJSON CLI protocol and exit codes are unchanged. Windows uses
  a user/profile-derived named pipe; Unix platforms keep a Unix-domain socket.
  Both processes use the same endpoint implementation. `ILIAD_USER_DATA`
  must match on both sides when selecting an alternate profile.
- The pipe name is an identifier, not authentication or a security boundary.
  The CLI is a local navigation interface and does not write documents.
- Windows names are validated before filesystem mutations. Physical workspace
  containment also checks symlinks and junctions, including new destinations.
- Pending saves are serialized. Closing waits for an acknowledged save;
  failures retain the window and buffer for recovery.
- `npm run dist:win` marks its package as `iliadDistribution: local`, disabling
  release checks independently of OS. `ILIAD_UPDATE_URL` explicitly overrides
  the endpoint (an empty value disables it). Official builds without the local
  marker use the existing upstream release service and select matching assets.
- Gemini assistance remains document-scoped. The local corrector supports
  English; Gemini can assist with Spanish. Provider availability is independent
  of Windows support. No internal agent or chat is added.
