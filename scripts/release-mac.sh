#!/usr/bin/env bash
# One-command signed, notarized macOS release of Iliad MD.
#
# Run on the signing Mac (Apple Silicon) that has the Developer ID Application
# certificate "ED4.ONE SpA (K542ZFQH6B)" and the `iliad-notary` notarytool
# keychain profile. It automates docs/release.md step by step; that runbook
# stays the source of truth and the manual reference.
#
#   scripts/release-mac.sh [options] <version>
#
# Options:
#   --notes <file>   Release notes (Markdown). Defaults to
#                    docs/release-notes/<version>.md if that file exists.
#                    Required for a real release.
#   --bump           If package.json is not <version>, run
#                    `npm version <version> --no-git-tag-version`, commit
#                    "Release Iliad MD <version>" and push to origin master.
#   --from <step>    Resume at <step> after a failure (preflight always runs).
#   --dry-run        Preflight + validation + an unsigned `--dir` package only.
#                    No signing, notarization, commits, pushes or uploads.
#   -h, --help       Show this help.
#
# Steps, in order:
#   bump          commit the version bump (only with --bump)
#   deps          npm ci
#   validate      lint:css, typecheck, test, build, npm audit --omit=dev
#   build         npm run dist:mac:signed (dry run: npm run package)
#   notarize-app  notarize + staple release/mac-arm64/Iliad MD.app
#   repackage     rebuild DMG + ZIP from the stapled .app (--prepackaged)
#   notarize-dmg  notarize + staple the versioned DMG
#   copy          metadata-named copies + stable Iliad-MD-arm64.dmg
#   metadata      npm run release:refresh-update-metadata
#   check         codesign/spctl/stapler on app, DMG, ZIP; packaged CLI;
#                 npm run release:verify-update-metadata
#   release       gh release create v<version> on brainforwarding/iliad
#   verify        download checks of every asset + latest/download sha512
#   homebrew      update the cask, push it to brainforwarding/homebrew-tap,
#                 commit it in this repo and push origin master
#
# Log: release/release-<version>.log (appended on every run).

set -euo pipefail

STEPS="bump deps validate build notarize-app repackage notarize-dmg copy metadata check release verify homebrew"
PUBLIC_REPO="brainforwarding/iliad"
TAP_REPO="brainforwarding/homebrew-tap"
SIGNING_TEAM="K542ZFQH6B"
SIGNING_IDENTITY="Developer ID Application: ED4.ONE SpA (${SIGNING_TEAM})"
NOTARY_PROFILE="iliad-notary"
APP_NAME="Iliad MD"
STABLE_DMG="Iliad-MD-arm64.dmg"

usage() {
  sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'
}

die() {
  printf '\n[release] ERROR: %s\n' "$*" >&2
  if [ "${DRY_RUN:-0}" -eq 1 ] && [ -n "${CURRENT_STEP:-}" ]; then
    printf '[release] Dry run failed in step "%s". Fix the cause and run the dry run again.\n' "$CURRENT_STEP" >&2
  elif [ "${CURRENT_STEP:-}" = "preflight" ]; then
    printf '[release] Preflight failed. Fix the cause and run the same command again.\n' >&2
  elif [ -n "${CURRENT_STEP:-}" ]; then
    printf '[release] Failed in step "%s". Fix the cause, then resume with:\n' "$CURRENT_STEP" >&2
    printf '[release]   scripts/release-mac.sh --from %s%s %s\n' "$CURRENT_STEP" "${NOTES_HINT:-}" "${VERSION:-<version>}" >&2
  fi
  exit 1
}
log() { printf '[release] %s\n' "$*"; }
warn() { printf '[release] WARNING: %s\n' "$*"; }
ok() { printf '[release]   ok: %s\n' "$*"; }
run() {
  printf '[release] $ %s\n' "$*"
  "$@"
}

# ---------------------------------------------------------------- arguments
VERSION=""
NOTES_FILE=""
BUMP=0
DRY_RUN=0
FROM_STEP=""

while [ $# -gt 0 ]; do
  case "$1" in
    --notes) [ $# -ge 2 ] || die "--notes needs a file"; NOTES_FILE="$2"; shift 2 ;;
    --notes=*) NOTES_FILE="${1#--notes=}"; shift ;;
    --from) [ $# -ge 2 ] || die "--from needs a step"; FROM_STEP="$2"; shift 2 ;;
    --from=*) FROM_STEP="${1#--from=}"; shift ;;
    --bump) BUMP=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    -*) die "unknown option: $1 (see --help)" ;;
    *) [ -z "$VERSION" ] || die "unexpected argument: $1"; VERSION="$1"; shift ;;
  esac
done

[ -n "$VERSION" ] || { usage; die "missing <version>"; }
VERSION="${VERSION#v}"
printf '%s' "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || die "not a release version: $VERSION (expected X.Y.Z)"

step_index() {
  local i=0 s
  for s in $STEPS; do
    i=$((i + 1))
    if [ "$s" = "$1" ]; then echo "$i"; return 0; fi
  done
  echo 0
}

if [ -n "$FROM_STEP" ]; then
  [ "$(step_index "$FROM_STEP")" -gt 0 ] || die "unknown step for --from: $FROM_STEP (steps: $STEPS)"
  [ "$DRY_RUN" -eq 0 ] || die "--from and --dry-run cannot be combined"
fi
FROM_INDEX=$(step_index "${FROM_STEP:-bump}")

# Should this step run, given --from?
wants() { [ "$(step_index "$1")" -ge "$FROM_INDEX" ]; }
# Is the resume point at or after this step?
resuming_past() { [ "$FROM_INDEX" -gt "$(step_index "$1")" ]; }

ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
cd "$ROOT"

if [ -n "$NOTES_FILE" ]; then
  [ -f "$NOTES_FILE" ] || die "notes file not found: $NOTES_FILE"
  NOTES_FILE="$(cd "$(dirname "$NOTES_FILE")" && pwd -P)/$(basename "$NOTES_FILE")"
elif [ -f "docs/release-notes/${VERSION}.md" ]; then
  NOTES_FILE="$ROOT/docs/release-notes/${VERSION}.md"
fi
if [ -n "$NOTES_FILE" ]; then NOTES_HINT=" --notes \"$NOTES_FILE\""; else NOTES_HINT=""; fi

REL="release"
APP="$REL/mac-arm64/$APP_NAME.app"
SRC_DMG="$REL/$APP_NAME-$VERSION-mac-arm64.dmg"
SRC_ZIP="$REL/$APP_NAME-$VERSION-mac-arm64.zip"
DMG="$REL/Iliad-MD-$VERSION-mac-arm64.dmg"
ZIP="$REL/Iliad-MD-$VERSION-mac-arm64.zip"
TAG="v$VERSION"
RELEASE_BASE_URL="https://github.com/$PUBLIC_REPO/releases"

mkdir -p "$REL"
LOG_FILE="$ROOT/$REL/release-$VERSION.log"
exec > >(tee -a "$LOG_FILE") 2>&1

TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/iliad-release.XXXXXX")"
MOUNTED=""
cleanup() {
  if [ -n "$MOUNTED" ]; then hdiutil detach "$MOUNTED" >/dev/null 2>&1 || true; fi
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

CURRENT_STEP=""
begin() {
  CURRENT_STEP="$1"
  printf '\n[release] ==== %s ==== (%s)\n' "$1" "$(date '+%Y-%m-%d %H:%M:%S')"
}

log "Iliad MD release $VERSION  root=$ROOT"
log "started $(date '+%Y-%m-%d %H:%M:%S %Z')  log=$LOG_FILE"
[ "$DRY_RUN" -eq 1 ] && log "DRY RUN: no signing, notarization, commits, pushes or uploads"
[ -n "$FROM_STEP" ] && log "resuming from step: $FROM_STEP"

# ---------------------------------------------------------------- preflight
begin preflight
DRY_WARNINGS=""
# In a dry run, git-state problems are reported but do not stop the run, so
# the script can be exercised from a branch. A real release stops on them.
gitcheck_fail() {
  if [ "$DRY_RUN" -eq 1 ]; then
    warn "(dry run, a real release stops here) $*"
    DRY_WARNINGS="${DRY_WARNINGS}  - $*
"
  else
    die "$*"
  fi
}

[ "$(uname -s)" = "Darwin" ] || die "macOS only"
[ "$(uname -m)" = "arm64" ] || die "run on an Apple Silicon Mac (release/mac-arm64 is the expected output)"
for tool in git node npm npx gh curl openssl xcrun ditto hdiutil codesign spctl security shasum; do
  command -v "$tool" >/dev/null 2>&1 || die "missing required tool: $tool"
done
ok "tools present (node $(node -v), npm $(npm -v))"

origin_url="$(git remote get-url origin 2>/dev/null || true)"
if ! printf '%s' "$origin_url" | grep -Eq "github\.com[:/]${PUBLIC_REPO}(\.git)?$"; then
  die "origin is '$origin_url', expected the public repo $PUBLIC_REPO. This script releases from a checkout whose origin is the public repository; for the private-origin/public-squash setup follow docs/release.md by hand."
fi
ok "origin is the public repo $PUBLIC_REPO"

branch="$(git rev-parse --abbrev-ref HEAD)"
[ "$branch" = "master" ] || gitcheck_fail "on branch '$branch', expected master"

# The homebrew step may have left only the cask modified before failing.
dirty="$(git status --porcelain --untracked-files=normal)"
if [ -n "$dirty" ]; then
  if wants homebrew && resuming_past release && [ "$dirty" = " M packaging/homebrew/iliad-md.rb" ]; then
    warn "packaging/homebrew/iliad-md.rb is modified (left by a previous homebrew step); continuing"
  else
    gitcheck_fail "working tree is not clean:
$dirty"
  fi
fi

log "fetching origin"
git fetch --quiet origin master --tags || die "git fetch origin failed"
if git rev-parse --verify --quiet origin/master >/dev/null; then
  counts="$(git rev-list --left-right --count HEAD...origin/master)"
  ahead="${counts%%[[:space:]]*}"
  behind="${counts##*[[:space:]]}"
  [ "$behind" -eq 0 ] || gitcheck_fail "HEAD is $behind commit(s) behind origin/master; pull first"
  [ "$ahead" -eq 0 ] || gitcheck_fail "HEAD is $ahead commit(s) ahead of origin/master (unpushed work); push or reset before releasing"
  if [ "$behind" -eq 0 ] && [ "$ahead" -eq 0 ]; then ok "HEAD matches origin/master ($(git rev-parse --short HEAD))"; fi
else
  die "origin/master not found after fetch"
fi

pkg_version="$(node -p 'require("./package.json").version')"
if [ "$pkg_version" = "$VERSION" ]; then
  ok "package.json version is $VERSION"
  BUMP_NEEDED=0
elif [ "$BUMP" -eq 1 ] && ! resuming_past bump; then
  log "package.json is $pkg_version; --bump will set it to $VERSION"
  BUMP_NEEDED=1
else
  die "package.json version is $pkg_version, not $VERSION (pass --bump to bump it, or check the version argument)"
fi

if [ "$DRY_RUN" -eq 1 ]; then
  log "SKIPPED in dry run: signing identity check ($SIGNING_IDENTITY)"
  log "SKIPPED in dry run: notary profile check ($NOTARY_PROFILE)"
elif wants build || wants notarize-app || wants repackage || wants notarize-dmg; then
  identities="$(security find-identity -v -p codesigning 2>/dev/null || true)"
  case "$identities" in
    *"$SIGNING_IDENTITY"*) ;;
    *) die "signing identity not found: $SIGNING_IDENTITY (security find-identity -v -p codesigning)" ;;
  esac
  ok "signing identity present"
  xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null 2>&1 \
    || die "notary profile '$NOTARY_PROFILE' does not work (xcrun notarytool history --keychain-profile $NOTARY_PROFILE)"
  ok "notary profile $NOTARY_PROFILE works"
else
  log "signing/notary checks not needed when resuming at $FROM_STEP"
fi

gh auth status >/dev/null 2>&1 || die "gh is not authenticated (gh auth login)"
ok "gh authenticated"

tag_remote="$(git ls-remote --tags origin "refs/tags/$TAG")"
if gh release view "$TAG" --repo "$PUBLIC_REPO" >/dev/null 2>&1; then release_exists=1; else release_exists=0; fi
if resuming_past release; then
  [ "$release_exists" -eq 1 ] || die "resuming at $FROM_STEP but release $TAG does not exist on $PUBLIC_REPO"
  ok "release $TAG exists (resuming)"
else
  if [ -n "$tag_remote" ]; then gitcheck_fail "tag $TAG already exists on origin"; fi
  if [ "$release_exists" -eq 1 ]; then gitcheck_fail "release $TAG already exists on $PUBLIC_REPO"; fi
  if [ -z "$tag_remote" ] && [ "$release_exists" -eq 0 ]; then ok "tag and release $TAG do not exist yet"; fi
fi

if [ "$DRY_RUN" -eq 0 ] && wants release; then
  [ -n "$NOTES_FILE" ] || die "release notes required: pass --notes <file> (or add docs/release-notes/$VERSION.md)"
  [ -s "$NOTES_FILE" ] || die "release notes file is empty: $NOTES_FILE"
  ok "release notes: $NOTES_FILE"
fi

if wants homebrew && [ "$DRY_RUN" -eq 0 ]; then
  git ls-remote "https://github.com/$TAP_REPO.git" HEAD >/dev/null 2>&1 || die "cannot reach https://github.com/$TAP_REPO.git"
  ok "tap repo reachable"
fi

# --------------------------------------------------------------------- bump
if wants bump; then
  begin bump
  if [ "${BUMP_NEEDED:-0}" -eq 0 ]; then
    log "package.json already $VERSION; nothing to bump"
  elif [ "$DRY_RUN" -eq 1 ]; then
    log "dry run: would run npm version $VERSION --no-git-tag-version, commit 'Release Iliad MD $VERSION' and push origin master"
  else
    run npm version "$VERSION" --no-git-tag-version
    run git add package.json package-lock.json
    run git commit -m "Release Iliad MD $VERSION"
    run git push origin HEAD:master
    ok "version bump committed and pushed ($(git rev-parse --short HEAD))"
  fi
fi

# --------------------------------------------------------------------- deps
if wants deps; then
  begin deps
  run npm ci
fi

# ----------------------------------------------------------------- validate
if wants validate; then
  begin validate
  run npm run lint:css
  run npm run typecheck
  run npm test
  run npm run build
  log "npm audit --omit=dev (production gate: high and critical fail; lower severities are reported only)"
  if ! run npm audit --omit=dev --audit-level=high; then
    die "npm audit --omit=dev found high or critical production advisories"
  fi
fi

# -------------------------------------------------------- CLI bundle checks
# Packaged CLI wrapper and skill, per docs/release.md. Mode "packaged" runs
# the wrapper (the app's own executable in Node mode). Mode "node" is for the
# dry run: an ad-hoc-signed hardened-runtime build cannot launch its own
# executable (library validation), so the packaged iliad.mjs runs on the
# system Node instead and the installed link is checked, not executed.
check_cli_bundle() {
  local app="$1" mode="${2:-packaged}" bin cmd_dir help_out
  bin="$app/Contents/Resources/bin"
  test -x "$bin/iliad" || die "wrapper not executable in $app"
  test -f "$bin/iliad.mjs" || die "bin/iliad.mjs missing in $app"
  ls "$bin/lib" >/dev/null || die "bin/lib missing in $app"
  test -f "$app/Contents/Resources/skill/iliad/SKILL.md" || die "bundled skill missing in $app"
  cli() {
    if [ "$mode" = "node" ]; then node "$bin/iliad.mjs" "$@"; else "$bin/iliad" "$@"; fi
  }
  cli --help >/dev/null || die "iliad --help failed in $app ($mode)"
  cli skill print >"$TMP_ROOT/skill.txt" || die "iliad skill print failed in $app ($mode)"
  head -5 "$TMP_ROOT/skill.txt"
  cmd_dir="$(mktemp -d "$TMP_ROOT/iliad-cmd.XXXXXX")"
  cli install --dir "$cmd_dir" --json || die "iliad install --dir failed ($app)"
  echo
  if [ "$mode" = "node" ]; then
    [ "$(readlink "$cmd_dir/iliad")" = "$(cd "$bin" && pwd -P)/iliad" ] \
      || die "installed iliad link does not point at the bundle wrapper ($app)"
  else
    help_out="$("$cmd_dir/iliad" --help)" || die "installed iliad --help failed ($app)"
    case "$help_out" in
      *"iliad install"*) ;;
      *) die "installed iliad command does not work ($app)" ;;
    esac
  fi
  rm -rf "$cmd_dir"
  ok "packaged CLI wrapper, skill and install work ($app, $mode)"
}

# -------------------------------------------------------------------- build
clean_release_outputs() {
  log "removing previous build outputs in $REL/ (the log is kept)"
  rm -rf "$REL/mac-arm64" "$REL/builder-debug.yml" "$REL/builder-effective-config.yaml" "$REL/latest-mac.yml"
  find "$REL" -maxdepth 1 -type f \( -name '*.dmg' -o -name '*.zip' -o -name '*.blockmap' \) -delete
}

if [ "$DRY_RUN" -eq 1 ]; then
  begin build
  clean_release_outputs
  log "dry run: unsigned --dir package"
  run npm run package
  [ -d "$APP" ] || die "unsigned package did not produce $APP"
  ok "built $APP"
  log "app-update.yml is only written by a full (publishing-target) build; the check step verifies it in a real release"
  check_cli_bundle "$APP" node
  CURRENT_STEP=""
  printf '\n[release] DRY RUN PASSED for %s.\n' "$VERSION"
  log "skipped: signing identity + notary profile checks, signing, notarization, stapling, repackage, metadata, GitHub release, Homebrew"
  if [ -n "$DRY_WARNINGS" ]; then
    printf '[release] A real release would have stopped on:\n%s' "$DRY_WARNINGS"
  fi
  exit 0
fi

if wants build; then
  begin build
  clean_release_outputs
  run npm run dist:mac:signed
  [ -d "$APP" ] || die "build did not produce $APP"
  run codesign --verify --deep --strict --verbose=2 "$APP"
  case "$(codesign -dv --verbose=2 "$APP" 2>&1)" in
    *"Authority=$SIGNING_IDENTITY"*) ;;
    *) die "$APP is not signed by $SIGNING_IDENTITY" ;;
  esac
  ok "app signed by $SIGNING_IDENTITY"
fi

# ------------------------------------------------------------- notarize-app
assess_app() {
  local app="$1" out
  out="$(spctl --assess --type execute --verbose=4 "$app" 2>&1)" || { printf '%s\n' "$out"; die "spctl rejected $app"; }
  printf '%s\n' "$out"
  case "$out" in *accepted*) ;; *) die "spctl did not accept $app" ;; esac
  case "$out" in *"source=Notarized Developer ID"*) ;; *) die "spctl source is not 'Notarized Developer ID' for $app" ;; esac
}

if wants notarize-app; then
  begin notarize-app
  if xcrun stapler validate "$APP" >/dev/null 2>&1; then
    log "$APP already carries a stapled ticket (electron-builder notarized it); skipping manual notarization"
  else
    notary_zip="$TMP_ROOT/Iliad-MD-notary.zip"
    run ditto -c -k --keepParent "$APP" "$notary_zip"
    run xcrun notarytool submit "$notary_zip" --keychain-profile "$NOTARY_PROFILE" --wait
    run xcrun stapler staple "$APP"
  fi
  run xcrun stapler validate "$APP"
  assess_app "$APP"
  ok "app notarized and stapled"
fi

# ---------------------------------------------------------------- repackage
if wants repackage; then
  begin repackage
  xcrun stapler validate "$APP" >/dev/null 2>&1 || die "$APP is not stapled; run --from notarize-app"
  rm -f "$SRC_ZIP" "$SRC_ZIP.blockmap" "$SRC_DMG" "$SRC_DMG.blockmap" \
        "$DMG" "$ZIP" "$DMG.blockmap" "$ZIP.blockmap" "$REL/$STABLE_DMG"
  run npx electron-builder --mac dmg zip \
    --prepackaged "$APP" \
    --publish never \
    -c.mac.notarize=false
  # latest-mac.yml is kept (not deleted) so its file list survives even if
  # the prepackaged build does not rewrite it; the metadata step refreshes it.
  for f in "$SRC_DMG" "$SRC_ZIP" "$SRC_DMG.blockmap" "$SRC_ZIP.blockmap" "$REL/latest-mac.yml"; do
    [ -f "$f" ] || die "repackage did not produce $f"
  done
  ok "DMG, ZIP, blockmaps and latest-mac.yml rebuilt from the stapled app"
fi

# ------------------------------------------------------------- notarize-dmg
if wants notarize-dmg; then
  begin notarize-dmg
  if xcrun stapler validate "$SRC_DMG" >/dev/null 2>&1; then
    log "$SRC_DMG already stapled; skipping submission"
  else
    run xcrun notarytool submit "$SRC_DMG" --keychain-profile "$NOTARY_PROFILE" --wait
    run xcrun stapler staple "$SRC_DMG"
  fi
  run xcrun stapler validate "$SRC_DMG"
  ok "DMG notarized and stapled"
fi

# --------------------------------------------------------------------- copy
if wants copy; then
  begin copy
  run cp -p "$SRC_DMG" "$DMG"
  run cp -p "$SRC_ZIP" "$ZIP"
  run cp -p "$SRC_DMG.blockmap" "$DMG.blockmap"
  run cp -p "$SRC_ZIP.blockmap" "$ZIP.blockmap"
  run cp -p "$SRC_DMG" "$REL/$STABLE_DMG"
  ok "metadata-named copies and stable $STABLE_DMG in place"
fi

# ----------------------------------------------------------------- metadata
if wants metadata; then
  begin metadata
  run npm run release:refresh-update-metadata
fi

# -------------------------------------------------------------------- check
if wants check; then
  begin check
  log "app bundle"
  run codesign --verify --deep --strict --verbose=2 "$APP"
  run xcrun stapler validate "$APP"
  assess_app "$APP"

  log "DMG"
  run xcrun stapler validate "$DMG"
  if codesign -dv "$DMG" >/dev/null 2>&1; then
    run codesign --verify --strict --verbose=2 "$DMG"
  else
    log "DMG has no code signature of its own (electron-builder default); its notarization ticket is validated above"
  fi
  printf '[release] $ spctl -a -vv -t open --context context:primary-signature %s  (informational)\n' "$DMG"
  spctl -a -vv -t open --context context:primary-signature "$DMG" 2>&1 || true
  cmp -s "$DMG" "$REL/$STABLE_DMG" || die "$REL/$STABLE_DMG differs from $DMG"
  ok "stable DMG is byte-identical to $DMG"

  mount_root="$(mktemp -d "$TMP_ROOT/iliad-dmg.XXXXXX")"
  run hdiutil attach "$DMG" -readonly -nobrowse -mountpoint "$mount_root" >/dev/null
  MOUNTED="$mount_root"
  [ -d "$mount_root/$APP_NAME.app" ] || die "DMG does not contain $APP_NAME.app at its root"
  [ ! -d "$mount_root/$APP_NAME.app/$APP_NAME.app" ] || die "DMG contains a nested $APP_NAME.app bundle"
  run codesign --verify --deep --strict --verbose=2 "$mount_root/$APP_NAME.app"
  assess_app "$mount_root/$APP_NAME.app"
  run xcrun stapler validate "$mount_root/$APP_NAME.app"
  hdiutil detach "$mount_root" >/dev/null
  MOUNTED=""
  ok "app inside the DMG is notarized and stapled"

  log "ZIP"
  zip_root="$(mktemp -d "$TMP_ROOT/iliad-zip.XXXXXX")"
  run ditto -x -k "$ZIP" "$zip_root"
  run codesign --verify --deep --strict --verbose=2 "$zip_root/$APP_NAME.app"
  assess_app "$zip_root/$APP_NAME.app"
  run xcrun stapler validate "$zip_root/$APP_NAME.app"
  check_cli_bundle "$zip_root/$APP_NAME.app"
  rm -rf "$zip_root"
  ok "app inside the ZIP is notarized and stapled"

  run npm run release:verify-update-metadata
fi

# Asset list: exactly the files referenced by latest-mac.yml, latest-mac.yml
# itself, and the stable DMG (docs/release.md, "Important naming rule").
metadata_assets() {
  node -e '
    const fs = require("fs");
    const text = fs.readFileSync(process.argv[1], "utf8");
    const names = new Set();
    for (const line of text.split(/\r?\n/)) {
      let m = /^\s*-\s+url:\s*(.+)$/.exec(line) || /^path:\s*(.+)$/.exec(line);
      if (m) names.add(m[1].trim().replace(/^[\x27"]|[\x27"]$/g, ""));
    }
    for (const n of names) console.log(n);
  ' "$1"
}

# sha512 (base64) of the versioned DMG entry in a latest-mac.yml.
metadata_dmg_sha512() {
  node -e '
    const fs = require("fs");
    const [file, name] = process.argv.slice(1);
    let current = null;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      let m = /^\s*-\s+url:\s*(.+)$/.exec(line);
      if (m) { current = m[1].trim().replace(/^[\x27"]|[\x27"]$/g, ""); continue; }
      m = /^\s+sha512:\s*(.+)$/.exec(line);
      if (m && current === name) { console.log(m[1].trim().replace(/^[\x27"]|[\x27"]$/g, "")); process.exit(0); }
    }
    process.exit(1);
  ' "$1" "$2"
}

metadata_version() {
  sed -n 's/^version:[[:space:]]*//p' "$1" | tr -d "'\"" | head -1
}

expected_assets() {
  { metadata_assets "$REL/latest-mac.yml"; echo "latest-mac.yml"; echo "$STABLE_DMG"; } | sort -u
}

# ------------------------------------------------------------------ release
if wants release; then
  begin release
  run npm run release:verify-update-metadata
  git fetch --quiet origin master
  [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/master)" ] \
    || die "HEAD $(git rev-parse --short HEAD) is not origin/master; the release must target the pushed commit"
  target_sha="$(git rev-parse HEAD)"
  assets=""
  upload_paths=()
  while IFS= read -r name; do
    [ -f "$REL/$name" ] || die "missing asset $REL/$name"
    upload_paths+=("$REL/$name")
    assets="$assets $name"
  done <<EOF
$(expected_assets)
EOF
  log "uploading:$assets"
  run gh release create "$TAG" \
    "${upload_paths[@]}" \
    --repo "$PUBLIC_REPO" \
    --target "$target_sha" \
    --title "Iliad MD $VERSION" \
    --notes-file "$NOTES_FILE"
fi

# ------------------------------------------------------------------- verify
http_ok() {
  # HEAD, following redirects; fall back to a one-byte range request.
  local url="$1" code
  code="$(curl -sSIL -o /dev/null -w '%{http_code}' "$url" || true)"
  if [ "$code" = "200" ]; then return 0; fi
  code="$(curl -sSL -r 0-0 -o /dev/null -w '%{http_code}' "$url" || true)"
  [ "$code" = "200" ] || [ "$code" = "206" ]
}

sha512_b64() { openssl dgst -sha512 -binary "$1" | openssl base64 -A; }

if wants verify; then
  begin verify
  run gh release view "$TAG" --repo "$PUBLIC_REPO" --json tagName,targetCommitish,url,isDraft,isPrerelease
  actual="$(gh release view "$TAG" --repo "$PUBLIC_REPO" --json assets -q '.assets[].name' | sort -u)"
  expected="$(expected_assets)"
  if [ "$actual" != "$expected" ]; then
    printf 'expected assets:\n%s\nactual assets:\n%s\n' "$expected" "$actual"
    die "release assets do not match latest-mac.yml + stable DMG"
  fi
  ok "release assets are exactly: $(printf '%s' "$actual" | tr '\n' ' ')"

  while IFS= read -r name; do
    url="$RELEASE_BASE_URL/download/$TAG/$name"
    http_ok "$url" || die "asset not downloadable: $url"
    ok "200 $url"
  done <<EOF
$actual
EOF

  # releases/latest can take a moment to point at the new release.
  latest_ok=0
  for attempt in 1 2 3 4 5 6; do
    remote_yml="$TMP_ROOT/latest-mac.yml"
    if curl -sSfL -o "$remote_yml" "$RELEASE_BASE_URL/latest/download/latest-mac.yml" \
      && [ "$(metadata_version "$remote_yml")" = "$VERSION" ]; then
      latest_ok=1
      break
    fi
    log "releases/latest does not serve $VERSION yet (attempt $attempt/6); waiting 20s"
    sleep 20
  done
  [ "$latest_ok" -eq 1 ] || die "releases/latest/download/latest-mac.yml does not report version $VERSION"
  ok "releases/latest/download/latest-mac.yml reports $VERSION"
  cmp -s "$remote_yml" "$REL/latest-mac.yml" || die "published latest-mac.yml differs from $REL/latest-mac.yml"
  ok "published latest-mac.yml matches the local file"

  stable_url="$RELEASE_BASE_URL/latest/download/$STABLE_DMG"
  http_ok "$stable_url" || die "stable download not reachable: $stable_url"
  log "downloading $stable_url"
  curl -sSfL -o "$TMP_ROOT/$STABLE_DMG" "$stable_url" || die "download failed: $stable_url"
  want_sha="$(metadata_dmg_sha512 "$remote_yml" "Iliad-MD-$VERSION-mac-arm64.dmg")" \
    || die "latest-mac.yml has no entry for Iliad-MD-$VERSION-mac-arm64.dmg"
  got_sha="$(sha512_b64 "$TMP_ROOT/$STABLE_DMG")"
  [ "$got_sha" = "$want_sha" ] || die "downloaded $STABLE_DMG sha512 does not match latest-mac.yml's versioned DMG entry"
  ok "stable $STABLE_DMG sha512 matches latest-mac.yml ($VERSION DMG entry)"
  rm -f "$TMP_ROOT/$STABLE_DMG"
fi

# ----------------------------------------------------------------- homebrew
if wants homebrew; then
  begin homebrew
  run npm run release:update-homebrew-cask
  git --no-pager diff -- packaging/homebrew/iliad-md.rb

  tap_dir="$TMP_ROOT/homebrew-tap"
  run gh repo clone "$TAP_REPO" "$tap_dir" -- --quiet
  mkdir -p "$tap_dir/Casks"
  cp packaging/homebrew/iliad-md.rb "$tap_dir/Casks/iliad-md.rb"
  if command -v brew >/dev/null 2>&1; then
    run brew style --cask "$tap_dir/Casks/iliad-md.rb" || die "brew style failed for the cask"
  else
    warn "brew not installed; skipping brew style (run it on a Mac with Homebrew)"
  fi
  if [ -z "$(git -C "$tap_dir" status --porcelain)" ]; then
    log "tap already has iliad-md $VERSION; nothing to push"
  else
    run git -C "$tap_dir" add Casks/iliad-md.rb
    run git -C "$tap_dir" commit -m "iliad-md $VERSION"
    run git -C "$tap_dir" push origin HEAD
    ok "pushed Casks/iliad-md.rb to $TAP_REPO"
  fi

  if [ -n "$(git status --porcelain -- packaging/homebrew/iliad-md.rb)" ]; then
    run git add packaging/homebrew/iliad-md.rb
    run git commit -m "Homebrew cask: iliad-md $VERSION"
    run git push origin HEAD:master
    ok "cask change committed and pushed to origin master"
  else
    log "packaging/homebrew/iliad-md.rb already at $VERSION in this repo"
  fi

  if command -v brew >/dev/null 2>&1; then
    log "online audit of the published tap (informational)"
    if brew tap "${TAP_REPO%/homebrew-tap}/tap" >/dev/null 2>&1 \
      && git -C "$(brew --repository)/Library/Taps/${TAP_REPO}" pull --quiet --ff-only >/dev/null 2>&1; then
      brew audit --cask --online --strict "${TAP_REPO%/homebrew-tap}/tap/iliad-md" || warn "brew audit reported problems; check before announcing"
    else
      warn "could not tap/update ${TAP_REPO%/homebrew-tap}/tap; run brew audit by hand"
    fi
  fi
fi

CURRENT_STEP=""
printf '\n[release] DONE: Iliad MD %s released.\n' "$VERSION"
log "release: $RELEASE_BASE_URL/tag/$TAG"
log "stable:  $RELEASE_BASE_URL/latest/download/$STABLE_DMG"
log "brew:    brew install --cask brainforwarding/tap/iliad-md"
log "log:     $LOG_FILE"
