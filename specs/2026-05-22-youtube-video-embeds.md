# YouTube Video Embeds From Markdown Image Syntax

## Problem

Iliad currently renders `![alt](path)` as an image widget and `[label](href)` as a link widget on inactive editor lines. Users can paste normal YouTube links, but there is no lightweight way to preview a video inline without leaving the document.

## Product Intent

Keep normal Markdown links as links. Treat image syntax with a recognized YouTube URL as a visual embed:

```markdown
[Video title](https://www.youtube.com/watch?v=d7y9z7pjCRM)
![Video title](https://www.youtube.com/watch?v=d7y9z7pjCRM)
![Video title](https://youtu.be/d7y9z7pjCRM?si=YNISd1s0rYB_tj-Z)
```

The first line stays a normal link. The second and third lines render as embedded videos while inactive, and reveal the raw Markdown source when the cursor is on the line.

## Goals

- Support YouTube embeds from `![title](youtube-url)` in visual Markdown.
- Accept common copied YouTube URLs: `youtube.com/watch?v=...`, `youtu.be/...`, `youtube.com/embed/...`, `youtube.com/shorts/...`, and `youtube.com/live/...`.
- Preserve the source URL exactly as the user wrote it.
- Use `youtube-nocookie.com/embed/<id>` only for the rendered iframe.
- Keep `[title](youtube-url)` behavior unchanged.
- Keep local and remote image rendering unchanged for non-YouTube image syntax.
- Document the feature in the README and architecture notes.

## Non-Goals

- No Markdown source migration or automatic conversion from links to embeds.
- No generic video support for arbitrary `.mp4`, Vimeo, Loom, Drive, or other providers in this change.
- No video upload, local video asset management, thumbnails, captions track support, or media library.
- No new user settings for video rendering.

## UX Flow

- On inactive lines, `![title](recognized-youtube-url)` is replaced by an embedded player with a 16:9 frame and an optional caption using the title text.
- On the active line, the raw Markdown syntax is shown and editable, matching current image behavior.
- If the URL is not a recognized YouTube URL, the existing image widget path handles it.
- If a YouTube URL is malformed or lacks an ID, it is treated as a normal image source and no special embed is attempted.
- Share parameters, playlist parameters, and timestamps are ignored for this first pass. Rendering uses only the video ID.
- Loading, unavailable, deleted, age-restricted, blocked, or offline video failures are handled by the iframe provider UI. Iliad does not add retry state in this change.

## URL Parser Contract

- Only absolute `http:` and `https:` URLs are considered.
- Accepted hosts are exactly `youtube.com`, `www.youtube.com`, `m.youtube.com`, `music.youtube.com`, `youtube-nocookie.com`, `www.youtube-nocookie.com`, and `youtu.be`.
- Host spoofing must be rejected by using the URL parser hostname, not string prefixes. Examples such as `youtube.com.evil`, `notyoutube.com`, and `https://youtube.com@evil.test/watch?v=...` must not be embedded.
- Accepted path forms:
  - `youtube.com/watch?v=<id>`
  - `youtube.com/embed/<id>`
  - `youtube.com/shorts/<id>`
  - `youtube.com/live/<id>`
  - `youtube-nocookie.com/embed/<id>`
  - `youtu.be/<id>`
- The ID must match `^[A-Za-z0-9_-]{11}$`.
- Invalid, missing, too-short, too-long, or non-YouTube IDs fall back to image rendering.

## Security And Privacy

- Rendering uses `https://www.youtube-nocookie.com/embed/<id>` so the app does not embed the standard watch page.
- Only the derived `https://www.youtube-nocookie.com/embed/<id>` URL may be assigned to `iframe.src`.
- The iframe uses `title`, `loading="lazy"`, `allowFullscreen`, `referrerPolicy="strict-origin-when-cross-origin"`, and `allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"`.
- Do not add `sandbox` in this first pass. YouTube playback normally needs scripts, same-origin behavior, popups, and presentation permissions; a partial sandbox is likely to break expected playback while adding little protection inside the already fixed `youtube-nocookie.com` iframe source. Revisit this if Iliad embeds untrusted arbitrary providers.
- The parser only accepts `http:` and `https:` YouTube URLs from recognized hosts.
- The source Markdown remains self-describing. Other Markdown tools may show a broken image for YouTube `![]()` syntax, so this is a deliberate, documented Iliad visual extension rather than standard Markdown video syntax.

## Data, API, And Permissions

- No filesystem, IPC, schema, or permission changes.
- No new dependencies.
- All behavior is renderer-only inside the visual Markdown decoration layer.

## Implementation Plan

- Add a small YouTube URL parser in `src/editor/visualMarkdown/media.ts`.
- Add a `YouTubeVideoWidget` beside the existing image and link widgets, including an `eq()` implementation.
- Update `addImageDecorations` to choose the video widget when the image URL is recognized as YouTube.
- Add scoped CSS for the video widget in `src/styles/visual-markdown.css`. Keep it compatible with CodeMirror's inline widget limitation; do not introduce block decorations from the visual Markdown plugin.
- Update `README.md`, `docs/architecture.md`, and `docs/source-as-contract.md` with the portability tradeoff.

## Required Tests

- `npm run typecheck`
- `npm run build`
- Parser test cases, either automated or explicitly smoke-checked during verification:
  - Accept `https://www.youtube.com/watch?v=d7y9z7pjCRM`.
  - Accept `https://youtu.be/d7y9z7pjCRM?si=YNISd1s0rYB_tj-Z`.
  - Accept `https://www.youtube.com/embed/d7y9z7pjCRM`.
  - Accept `https://www.youtube.com/shorts/d7y9z7pjCRM`.
  - Accept `https://www.youtube.com/live/d7y9z7pjCRM`.
  - Accept `https://www.youtube-nocookie.com/embed/d7y9z7pjCRM`.
  - Reject `https://youtube.com.evil/watch?v=d7y9z7pjCRM`.
  - Reject `https://youtube.com@evil.test/watch?v=d7y9z7pjCRM`.
  - Reject `javascript:alert(1)`.
  - Reject missing, short, or long IDs.
- Manual/source review cases:
  - `[Video](https://youtu.be/d7y9z7pjCRM)` remains a link.
  - `![Video](https://youtu.be/d7y9z7pjCRM)` renders as a YouTube embed.
  - `![Video](https://youtu.be/d7y9z7pjCRM?si=YNISd1s0rYB_tj-Z)` ignores share parameters for rendering.
  - `![Video](https://www.youtube.com/watch?v=d7y9z7pjCRM)` renders as a YouTube embed.
  - `![Video](./local-image.png)` remains an image.

## Open Questions

- None for this first pass. Generic video providers can be reconsidered after YouTube embeds prove useful.
