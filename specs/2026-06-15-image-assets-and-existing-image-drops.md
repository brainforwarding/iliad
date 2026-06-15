# Image Assets And Existing Image Drops

Date: 2026-06-15
Status: reviewed implementation spec
Scope: Markdown editor image drop/paste behavior, asset storage, and image references.

## Problem

Iliad currently copies every dropped or pasted image into:

```text
<workspace root>/assets/<document-slug>/image-<timestamp>.<ext>
```

This is predictable while the user always opens the same workspace root. It is
less portable when the user later opens a subfolder as the workspace root. For
example, a document at `my-docs/visuals/flow-and-focus.md` gets an image under
`my-docs/assets/flow-and-focus/`. If the user later opens `my-docs/visuals`,
that image is outside the active workspace.

The current behavior also copies images that already live inside the current
workspace. If a user deliberately keeps `visuals/assets/water.png` in the file
tree and drags it into a document, Iliad should reference that file instead of
duplicating it.

## Recommendation

Use document-folder-local assets by default, and link existing workspace images
without copying.

For a document:

```text
visuals/flow-and-focus.md
```

new pasted or external dropped images should be copied to:

```text
visuals/assets/flow-and-focus-20260615-171623.png
```

and inserted as:

```markdown
![Image](./assets/flow-and-focus-20260615-171623.png)
```

If the dropped image already lives inside the current workspace, Iliad should
insert a relative Markdown image reference to the existing file and should not
copy it.

Portability guarantee: images copied by Iliad are stored beside the active
document's folder, so they continue to work if that folder is opened as its own
workspace later. Images that users already placed elsewhere in the workspace are
linked in place. Those links preserve the user's chosen organization, but they
only remain portable when the linked image stays inside the folder tree moved or
opened with the document.

## Behavior Matrix

| Source | Example | Behavior |
|---|---|---|
| Clipboard image | Screenshot pasted from clipboard | Copy into the active document folder's `assets/` directory. |
| Clipboard image file from inside workspace | Copy/paste a file from `visuals/assets/photo.png` | Insert a relative reference to the existing file when Electron exposes the path. No copy. |
| Clipboard image file from outside workspace | Copy/paste a file from `~/Downloads/photo.png` | Copy into the active document folder's `assets/` directory. |
| Browser or app drag without stable file path | Dragged image data only | Copy into the active document folder's `assets/` directory. |
| Finder drag from outside workspace | `~/Downloads/photo.png` | Copy into the active document folder's `assets/` directory. |
| Finder drag from inside workspace | `visuals/assets/photo.png` | Insert a relative reference to the existing file. No copy. |
| Iliad file-tree drag of an existing image | `assets/photo.png` row dropped into editor | Insert a relative reference to the existing file. No copy. |
| Non-image file drop into editor | PDF, Markdown, folder | Leave existing editor behavior unchanged. |

## Goals

- Keep image links portable when a document folder is opened as its own
  workspace later.
- Avoid duplicate files when the image already belongs to the workspace.
- Keep default drop/paste behavior simple. Do not show a prompt on every image
  insertion.
- Never insert absolute local paths such as `/Users/name/...`.
- Keep assets visible in the file tree, but visually de-emphasized as they are
  today.
- Preserve support for paste, drag from Finder, and drag from the file tree.

## Non-Goals

- No "move original into assets" option in this pass.
- No automatic cleanup of old unused assets.
- No asset rename when the Markdown document is renamed. Existing image links
  should keep working; old filename slugs are cosmetic.
- No cloud upload, optimization pipeline, or external hosting.
- No global asset library.
- No automatic copying of hidden, ignored, unsupported, missing, or non-renderable
  workspace files.

## Supported Formats

Supported image formats in this pass:

- `.png` / `image/png`
- `.jpg`, `.jpeg` / `image/jpeg`
- `.gif` / `image/gif`
- `.webp` / `image/webp`
- `.svg` / `image/svg+xml`

Pathless clipboard or drag image data must have a supported MIME type. Unknown
`image/*` data such as HEIC, TIFF, or AVIF should be skipped with a non-modal
notice rather than silently written with the wrong extension.

## Storage Rule

For newly copied image data, use:

```text
<document directory>/assets/<document-slug>-<timestamp>.<ext>
```

The document slug is derived from the current Markdown filename without the
extension:

- whitespace becomes `-`
- path separators are not allowed
- empty names fall back to `image`

If a filename collision occurs, keep the existing uniqueness behavior by adding
an index.

For file-backed images, default alt text should come from the filename stem:

```text
bottom-of-the-sea.png -> bottom of the sea
```

For pathless screenshots or image data, use the localized generic fallback
`Image`.

## Relative Link Rule

Markdown should always receive a path relative to the active Markdown document's
directory.

Examples:

```text
visuals/flow-and-focus.md
visuals/assets/flow-and-focus-20260615-171623.png
```

```markdown
![Image](./assets/flow-and-focus-20260615-171623.png)
```

```text
drafts/chapter.md
visuals/assets/water.png
```

```markdown
![water](../visuals/assets/water.png)
```

Absolute paths must not be inserted into Markdown.

One Markdown destination encoder should be used for both saved and referenced
assets. Encode path segments so spaces, `)`, `#`, `%`, and non-ASCII characters
do not break image rendering:

```markdown
![draft chart](./assets/draft%20chart%20%281%29.png)
```

Alt text derived from filenames should escape `[` and `]`.

## Existing Workspace Image Rule

When a dropped image has a stable local path:

1. Resolve the path.
2. Confirm it is inside the active workspace.
3. Confirm it is visible, not hidden, and not ignored by workspace rules
   (`node_modules`, `dist`, `dist-electron`, etc.).
4. Confirm neither the file nor its ancestors inside the workspace are symlinks.
5. Confirm it is an existing regular file.
6. Confirm it is a supported image by extension and MIME type where available.
5. Insert a relative Markdown image link to that file.

If a stable path exists inside the workspace but validation fails, do not copy
or insert it. Show a non-modal notice. Only external/pathless supported image
data should fall back to copying.

Electron exposes local paths for dropped `File` objects through
`webUtils.getPathForFile(file)`. Preload should expose a narrow helper that
returns the path for a file, not broad filesystem access.

## File Tree Image Drag

The file tree already supports dragging Markdown files for assistant context and
dragging any real node for move operations. Image rows should additionally set a
dedicated image-reference drag payload:

```text
application/x-iliad-image-reference
```

Payload:

```json
{
  "type": "iliad/image-reference",
  "workspaceSessionId": "session-id",
  "relativePath": "visuals/assets/water.png"
}
```

When dropped into the editor for the same workspace session, this payload should
insert a Markdown image reference. It should not trigger a file move.

Precedence: the editor drop handler checks
`application/x-iliad-image-reference` before `DataTransfer.files` or file-move
payloads. A valid image-reference payload calls `preventDefault`, uses
`dropEffect = "copy"`, inserts the image link, and consumes the drop. The file
tree should not show move-target styling, "move canceled," or other move status
for a successful editor image-reference drop.

## Main Process API

Asset IPC must treat every renderer-supplied path as untrusted. Handlers should
verify the active workspace from `event.sender` or a main-owned workspace session
and reject requests whose workspace does not match the active window.

Use two reference request shapes:

```ts
referenceWorkspaceImageAsset(request: {
  workspaceRoot: string;
  documentPath: string;
  imagePath: string;
}): SavedImageAsset
```

for local paths obtained from `webUtils.getPathForFile(file)`, and:

```ts
referenceWorkspaceImageAssetByRelativePath(request: {
  workspaceSessionId: string;
  documentPath: string;
  imageRelativePath: string;
}): SavedImageAsset
```

for internal file-tree image references. Main should resolve the relative path
against the active workspace. The renderer should not reconstruct absolute paths
for file-tree drops.

The function should validate:

- `documentPath` is a Markdown file inside the workspace.
- the active workspace/session matches the request.
- the image path is inside the workspace after path resolution.
- the image path is visible, not hidden, and not ignored.
- neither the image file nor its workspace-relative ancestors are symlinks.
- the image path has a supported image extension.

It returns the same shape as copied image saves:

```ts
{
  filePath: string;
  relativePath: string;
  markdown: string;
}
```

Preload can expose this as `referenceImageAsset`.

## Renderer Flow

For dropped or pasted `File` objects:

1. Collect image files as today.
2. For each file, ask preload for the local path if available.
3. If a local path exists, call `referenceImageAsset`.
4. If that succeeds, insert the returned Markdown.
5. If no path exists, or the path is outside the active workspace, copy through
   `saveImageAsset` when the image data is a supported format.
6. If the path is inside the workspace but invalid, hidden, ignored, symlinked,
   or unsupported, skip insertion and show a notice.

For file-tree image-reference drags:

1. Read and validate the dedicated payload.
2. Call the relative-path reference IPC with `workspaceSessionId`,
   `documentPath`, and `imageRelativePath`.
4. Insert the returned Markdown at the drop position.

Multi-image insertion should preserve the order of dropped/pasted images.
Partial success is allowed: insert successful images in order and show a notice
when some images were skipped.

## UI/UX

Do not prompt the user during normal image insertion.

User-facing notices:

- Copied image: "Copied image to ./assets/flow-and-focus-20260615-171623.png"
- Linked existing workspace image: "Inserted image link to ./assets/water.png"
- Skipped unsupported image: "This image format is not supported."

Use the exact document-relative path that was inserted. For multi-image
operations, use short batch notices that state copied count, linked count, and
skipped count when relevant. The distinction matters because it explains why no
new file appeared in the file tree for existing workspace images.

## Tests

Unit tests:

- `saveImageAsset` stores new images under the document directory's `assets/`.
- `saveImageAsset` returns a document-relative Markdown path.
- unsupported image MIME data is rejected rather than silently written.
- `referenceWorkspaceImageAsset` returns a document-relative Markdown path for
  images inside the workspace.
- `referenceWorkspaceImageAsset` rejects outside, hidden, unsupported, and
  non-existent paths.
- reference helpers reject symlink files and symlink ancestors.
- reference helpers reject ignored directory segments such as `node_modules`,
  `dist`, and `dist-electron`.
- asset IPC rejects requests for a workspace other than the active window
  workspace.
- Markdown image destinations encode spaces, parentheses, `#`, `%`, and unicode.
- Renderer image drop code prefers a valid existing workspace path and falls
  back to copy for external or pathless images.
- File-tree image drag payload validates workspace session and safe relative
  paths.
- Editor image-reference drops take precedence over file-move payloads.
- Multi-image insertion preserves order and supports partial success with notice.

Manual QA:

- Paste a screenshot into `visuals/flow-and-focus.md`; confirm it creates
  `visuals/assets/flow-and-focus-...png`.
- Drag `~/Downloads/bottom-of-the-sea.png` into the document; confirm it copies
  into `visuals/assets/`.
- Drag an image already under `visuals/assets/` into the same document; confirm
  it inserts a link without duplicating.
- Open `my-docs/visuals` as the workspace root; confirm the Markdown image still
  renders.
- Drag an existing workspace image into a document in another folder and confirm
  the inserted path uses `../` correctly.
