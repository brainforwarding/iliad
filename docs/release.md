# Release Runbook

This repo has two separate release surfaces:

- **Source publication:** pushing commits to `brainforwarding/iliad`.
- **Public app release:** creating a GitHub release with signed, notarized macOS
  artifacts.

Pushing source does not update the public downloadable app. A user-facing
release happens only after a versioned GitHub release contains validated DMG/zip
artifacts.

Update-aware releases also have a machine-readable updater manifest. Treat
`release/latest-mac.yml` as a required artifact, not a convenience file. Future
agents should never rely on memory here: run the verification script in this
runbook and do not create the GitHub release if it fails.

## Repositories And History

The local `origin` remote may point at the old/private development repository:

```text
origin  https://github.com/brainforwarding/iliad-markdown-editor.git
```

The public repository is:

```text
public  https://github.com/brainforwarding/iliad.git
```

The public repository uses a squashed public history. Do not push the local
development branch directly to `public/master`, because that can expose private
development history.

GitHub Desktop may show:

- `Push origin` because local `master` is ahead of the old/private `origin`.
- `public/master` as another branch because it is the remote-tracking branch for
  the public repository.

Do not use `Push origin` as the public release action. It pushes to the
old/private remote configured as `origin`; it does not create a public app
release.

For a public source update, create a public-safe commit on top of
`public/master` with the final verified file tree:

```bash
VERSION=X.Y.Z
LOCAL_COMMIT="$(git rev-parse HEAD)"

git fetch public master --tags
git worktree add -b "release/${VERSION}-public" "../iliad-public-release-${VERSION}" public/master
cd "../iliad-public-release-${VERSION}"
git read-tree --reset -u "${LOCAL_COMMIT}^{tree}"
git commit -m "Release Iliad MD ${VERSION}" # or a narrower docs/change message
git push public HEAD:master
```

Verify the public commit tree matches the verified local tree before pushing:

```bash
git rev-parse HEAD^{tree}
git -C ../iliad rev-parse "${LOCAL_COMMIT}^{tree}"
```

After pushing, clean up the temporary worktree:

```bash
cd ../iliad
git worktree remove "../iliad-public-release-${VERSION}"
git branch -D "release/${VERSION}-public"
```

## Version And Verification

Before building release artifacts:

```bash
npm version X.Y.Z --no-git-tag-version
npm run lint:css
npm run typecheck
npm run smoke:review
npm test
npm run build
npm audit --omit=dev --audit-level=high
```

`npm audit --audit-level=high` may report dev/build-tool advisories. The
production release gate is `npm audit --omit=dev --audit-level=high`.

## macOS Signing And Notarization

The app is signed with the Developer ID Application certificate:

```text
Developer ID Application: ED4.ONE SpA (K542ZFQH6B)
```

Electron Builder can notarize automatically only if these environment variables
are available:

```text
APPLE_ID
APPLE_APP_SPECIFIC_PASSWORD
APPLE_TEAM_ID
```

If they are unset, `npm run dist:mac:signed` signs the app but prints:

```text
skipped macOS notarization reason=`notarize` options were unable to be generated
```

That output means the build is **not** ready to publish.

This machine has a stored Apple notarization profile named `iliad-notary`.
Prefer that profile over recovering raw credentials:

```bash
xcrun notarytool history --keychain-profile iliad-notary
```

## Artifact Build Flow

Build the app:

```bash
npm run dist:mac:signed
```

If notarization was skipped, notarize the `.app` manually:

```bash
ditto -c -k --keepParent "release/mac-arm64/Iliad MD.app" /tmp/Iliad-MD-notary.zip
xcrun notarytool submit /tmp/Iliad-MD-notary.zip --keychain-profile iliad-notary --wait
xcrun stapler staple "release/mac-arm64/Iliad MD.app"
xcrun stapler validate "release/mac-arm64/Iliad MD.app"
spctl --assess --type execute --verbose=4 "release/mac-arm64/Iliad MD.app"
```

The `spctl` result must be:

```text
accepted
source=Notarized Developer ID
```

Rebuild distributable artifacts from the stapled `.app` bundle. Use the `.app`
path, not the parent folder, otherwise the DMG can contain a nested
`Iliad MD.app/Iliad MD.app` bundle:

```bash
rm -f "release/Iliad MD-X.Y.Z-mac-arm64.zip" \
      "release/Iliad MD-X.Y.Z-mac-arm64.zip.blockmap" \
      "release/Iliad MD-X.Y.Z-mac-arm64.dmg" \
      "release/Iliad MD-X.Y.Z-mac-arm64.dmg.blockmap"

npx electron-builder --mac dmg zip \
  --prepackaged "release/mac-arm64/Iliad MD.app" \
  --publish never \
  -c.mac.notarize=false
```

Notarize and staple the DMG:

```bash
xcrun notarytool submit "release/Iliad MD-X.Y.Z-mac-arm64.dmg" \
  --keychain-profile iliad-notary \
  --wait
xcrun stapler staple "release/Iliad MD-X.Y.Z-mac-arm64.dmg"
xcrun stapler validate "release/Iliad MD-X.Y.Z-mac-arm64.dmg"
```

Create the exact artifact filenames referenced by `latest-mac.yml`. Electron
Builder may write visible artifacts with spaces while writing URL-safe names
inside update metadata:

```bash
cp -p "release/Iliad MD-X.Y.Z-mac-arm64.dmg" "release/Iliad-MD-X.Y.Z-mac-arm64.dmg"
cp -p "release/Iliad MD-X.Y.Z-mac-arm64.zip" "release/Iliad-MD-X.Y.Z-mac-arm64.zip"
cp -p "release/Iliad MD-X.Y.Z-mac-arm64.dmg.blockmap" "release/Iliad-MD-X.Y.Z-mac-arm64.dmg.blockmap"
cp -p "release/Iliad MD-X.Y.Z-mac-arm64.zip.blockmap" "release/Iliad-MD-X.Y.Z-mac-arm64.zip.blockmap"
```

Refresh `latest-mac.yml` after DMG stapling and metadata-named copies are in
place. Stapling changes the DMG size and SHA512:

```bash
npm run release:refresh-update-metadata
```

Validate the app inside both artifacts:

```bash
MOUNT_ROOT="$(mktemp -d /tmp/iliad-dmg.XXXXXX)"
ZIP_ROOT="$(mktemp -d /tmp/iliad-zip.XXXXXX)"

hdiutil attach "release/Iliad MD-X.Y.Z-mac-arm64.dmg" \
  -readonly \
  -nobrowse \
  -mountpoint "$MOUNT_ROOT" >/dev/null
spctl --assess --type execute --verbose=4 "$MOUNT_ROOT/Iliad MD.app"
xcrun stapler validate "$MOUNT_ROOT/Iliad MD.app"
hdiutil detach "$MOUNT_ROOT" >/dev/null

ditto -x -k "release/Iliad MD-X.Y.Z-mac-arm64.zip" "$ZIP_ROOT"
spctl --assess --type execute --verbose=4 "$ZIP_ROOT/Iliad MD.app"
xcrun stapler validate "$ZIP_ROOT/Iliad MD.app"

rm -rf "$MOUNT_ROOT" "$ZIP_ROOT"
```

## Update Metadata Verification

After the final artifacts are rebuilt from the notarized/stapled `.app`, verify
the DMG is stapled, metadata-named copies exist, and update metadata is
refreshed, verify the updater metadata before upload:

```bash
npm run release:verify-update-metadata
```

This script checks:

- `release/latest-mac.yml` exists.
- its version matches `package.json`;
- its top-level `path` points to the macOS ZIP updater artifact;
- every file referenced by `latest-mac.yml` exists in `release/`;
- referenced file sizes and SHA512 hashes match the actual files;
- the packaged app contains `Contents/Resources/app-update.yml`;
- `app-update.yml` points at the public GitHub update provider
  `brainforwarding/iliad`.

If this script fails, fix the build output or regenerate the metadata. Do not
publish and hope the updater can recover.

Important naming rule: upload only the exact filenames referenced by
`latest-mac.yml`, plus `latest-mac.yml` itself. Electron Builder writes the
source artifacts with spaces, such as `Iliad MD-X.Y.Z-mac-arm64.dmg`, but GitHub
normalizes uploaded asset names with spaces into dotted names. Uploading both
the source artifacts and the metadata-named copies creates duplicate-looking
assets, such as `Iliad.MD-X.Y.Z-mac-arm64.dmg` and
`Iliad-MD-X.Y.Z-mac-arm64.dmg`. The updater uses the hyphenated filenames in
`latest-mac.yml`, so those are the only public release assets to upload.

## GitHub Release

Create the public release against the public-safe commit. Include the updater
metadata and the exact generated filenames referenced by that metadata:

```bash
gh release create "vX.Y.Z" \
  "release/Iliad-MD-X.Y.Z-mac-arm64.dmg" \
  "release/Iliad-MD-X.Y.Z-mac-arm64.zip" \
  "release/Iliad-MD-X.Y.Z-mac-arm64.dmg.blockmap" \
  "release/Iliad-MD-X.Y.Z-mac-arm64.zip.blockmap" \
  "release/latest-mac.yml" \
  --repo brainforwarding/iliad \
  --target PUBLIC_SAFE_COMMIT_SHA \
  --title "Iliad MD X.Y.Z" \
  --notes-file /tmp/iliad-release-notes.md
```

Final checks:

```bash
gh release view "vX.Y.Z" --repo brainforwarding/iliad --json tagName,targetCommitish,url,assets
git ls-remote public refs/heads/master refs/tags/vX.Y.Z
```
