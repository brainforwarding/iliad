# Development secrets

1Password is canonical; local files are disposable working copies. Requires Python 3, Git, 1Password CLI, and the application dependencies. Normal application commands do not invoke 1Password.

```sh
./scripts/dev-secrets provision
./scripts/dev-secrets refresh
./scripts/dev-secrets status
./scripts/dev-secrets status --json
python3 scripts/tests/dev-secrets.test.py
```

The default profile is `env-local`. Select another explicitly with `--profile NAME`. Profiles use the existing loader filenames; they are never combined automatically. Safe schema classifications and references live in `.dev-secrets.json`.

Provision refuses existing files. Refresh requires a generated owner-only file and refuses unknown/duplicate variables. Existing unmanaged files are preserved for explicit verification/adoption. Replacements are atomic per file; every candidate validates before replacements start. Do not run concurrent refreshes, and restart application processes after refresh.

Offline status reports only names and metadata; exit 0 means healthy, 2 means drift/review, 1 means schema/error. It never resolves references. Missing reference fields and disabled profiles require the documented review/import before provisioning. Local test fixture credentials are intentionally ordinary fixture configuration, not remote canonical secrets.

Fresh Linux checkout: clone this repository, install its dependencies, unlock/authorize 1Password and run provision; then use ordinary application commands. Pull safe schema changes and run refresh after canonical updates. Never transfer a plaintext env file.

## Migration notes


## Profiles

- `env-local` -> `.env.local` (enabled)
