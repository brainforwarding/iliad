# Public Document Collaboration

Date: 2026-06-14
Status: revised after full-stack/security and UI/UX review

Review note, 2026-06-14: the first draft was reviewed by a full-stack/security
agent and a UI/UX agent. This revision tightens the trust boundary: public
payloads must not expose local paths, bearer links expire by default, the relay
has an explicit request/response contract, comments are visibly public to anyone
with the link, and V1 remains comment-only with accessible fallback controls.

Review note, 2026-06-15: a second UX pass scoped the comment lifecycle. It
decides V1 comments are flat (no replies or threads), makes owner resolution and
deletion legible on the public page instead of a silent disappearance, defines
how the live document refreshes while a visitor reads without yanking content,
persists visitor identity so edit/delete rights survive reloads, and adds
click-a-block comment discovery. It deliberately does not add reader presence,
view counts, or an always-on "you are sharing" indicator: reach is visible
through the share popover's online state, and a forgotten share is bounded by
mandatory expiry. This follows Google Docs precedent and Iliad's minimal-surface
rule rather than surfacing share status while the owner is writing.

## Product Intent

Iliad should let a writer share any local Markdown document as a beautiful,
temporary web page whose live origin is the writer's own computer while Iliad is
open.
The first version should make review frictionless: send a link, let people read
the document in the browser, and collect anchored comments without asking anyone
to install Iliad, create an account, or touch the owner's files directly.

The feature is deliberately local-first. The Markdown file on disk remains the
source of truth. Public collaboration data is workflow metadata around that file:
comments, reviewer identity hints, sessions, and later edit proposals. Direct
remote writes to the `.md` file are not allowed in V1.

## Inspiration From LXD

The LXD extension has two patterns worth borrowing:

- Course Preview comments: select text in rendered HTML, press a small
  "Comentar" pill, write a note, and persist an anchored comment to a
  `.review.json` sidecar. The host reloads the sidecar for each incoming action
  before writing, which avoids clobbering unrelated comments.
- Review Mode HTML export: render the same review UI as a self-contained browser
  page, backed by a browser-safe state reducer and storage adapter. The page is
  typographic, quiet, and does not need an install.

For Iliad, the idea becomes more ambitious: the HTML page is not only exported
as a file. It is generated on demand by the desktop app and served through a
share session while the computer is online.

## Phased Plan

### V1 - Comment Link

Goal: public read-only review of one Markdown document with anchored comments.

The owner opens a Markdown file, presses `Share`, creates a comment link, and
copies it. Visitors see a clean rendered page with Iliad-like typography. They
can select text or focus a block, press `Comment`, and leave a note. Comments
are visible to anyone with the link, appear in Iliad's owner UI, and are saved
as workspace review metadata. The owner can resolve, delete, copy review notes,
or keep the comments as review history.

V1 does not allow browser visitors to edit Markdown. It also does not require
Git, accounts, direct port forwarding, or a cloud database.

### V2 - Suggested Edits

Goal: visitors can propose Markdown edits, but the owner still reviews before
anything lands on disk.

The public page gains a `Suggest changes` mode: a Markdown editor opens beside a
rendered preview, scoped to the shared document. Visitors submit a suggestion.
Iliad computes a Markdown diff against the owner's current local file, stores it
as an external review proposal, and shows it through the existing
document-native red/green review UI. The owner can accept or reject hunks.

This should feel closer to GitHub pull requests than Google Docs direct editing:
outside edits are proposals against a base hash. If the local document changed
meanwhile, Iliad rebases only non-overlapping hunks and marks conflicts as
stale.

### V3 - Live Editing For Trusted Sessions

Goal: optional live collaborative editing for trusted sessions.

The owner can explicitly upgrade a share session to `Live editing`. The browser
and desktop use a CRDT-backed Markdown text model for real-time co-editing.
Iliad still writes to disk through its autosave path, with a visible "Live
session" state and recovery snapshots. This mode is for small, trusted groups
and should be visually distinct from V1/V2 because it changes the risk model.

V3 can also add presence, cursors, inline comment threads, reviewer roles, and
Git-backed session history. It is optional future power, not the natural
destination of the feature, and should not be built before V2's proposal path is
boring and trustworthy.

## V1 User Experience

### Owner Entry Points

- Active document topbar: `Share` icon button using `Share2` from lucide.
- File tree context menu: `Share for comments`.
- Command palette later; not required for V1.

The share popover is compact:

```text
Share document

docs/session-plan.md
Anyone with the link can read this rendered document and visible comments while
Iliad is open and this computer is awake and online. The link goes dark when the
computer sleeps or loses connection, then works again when it returns.

Comments are saved as workspace review metadata. Ending the link stops future
access but keeps received comments.

Available until tomorrow, 10:30     Change
[Create comment link]

https://share.iliad.md/s/abc...     [Copy]
3 open comments                      [Review]
End link
```

If the relay is unavailable in development, the popover shows the local/LAN URL
and an "Advanced: use your own tunnel" note. LAN sharing is a separate opt-in
because it exposes the local server on the network. Production should prefer the
relay path so normal users do not need port forwarding.

### Public Page

The public page opens directly on the document, not a landing page.

Visual direction:

- Warm paper background matching `--editor` and a centered 720-780px prose
  column with a 68-74ch measure. The prose column is never boxed.
- Serif body typography using Iliad's `--font-serif`, 17-18px, 1.65 line
  height. Headings use the existing serif heading scale.
- Sparse sans UI in the top bar and comment controls. The top bar/comment rail
  use `--card`; outside gutters may use `--paper` only when an app frame is
  visible.
- Graphite links with underline affordance; monospace code blocks; tables and
  code blocks scroll horizontally on mobile.
- Headings retain the calm Iliad hierarchy, no oversized hero and no marketing
  copy.
- Comments use the existing blue comment family: bottom-half text wash for
  anchors, small margin cards on desktop, inline cards on mobile.
- The page must look good with zero comments. The document remains the main
  event.

Desktop layout:

```text
top bar: title                         Online / comment name

                 document column                         comment rail
                 # Heading                               anchored cards
                 body text...
```

Comment density:

- At `>=1120px`, show a right comment rail when there is enough horizontal room.
- Below that breakpoint, render collapsed inline comment cards under the
  referenced block.
- Multiple comments on the same anchor use one blue mark with a small count, not
  stacked washes.
- New comments are visible to everyone with the link in V1. The public page
  should say this quietly near the composer: "Visible to people with this link."

Mobile layout:

- Top bar compresses to title + status.
- Comment cards appear inline under the block they reference.
- The selection comment pill appears below the selection and never covers text.
- Touch targets are at least 44px. The composer never relies on hover.

### Live Document Updates

The public page is served live from the owner's disk, so the document can change
while a visitor is reading it. The page must not yank content out from under the
reader:

- Each comments poll also returns the session's current `documentHash`. When it
  changes, the page shows a quiet, dismissible "Document updated" affordance
  rather than re-rendering immediately.
- The visitor chooses when to refresh. Refresh restores scroll position to the
  nearest still-resolvable anchor where possible.
- The page never refreshes the document body while a composer is open or text is
  selected. It waits until the visitor saves or cancels.
- After a refresh, comments re-anchor through the normal resolution order.
  Comments whose anchors no longer resolve move to the visitor's view of the
  unanchored group rather than disappearing.

### Public Comment Flow

1. Visitor selects text, which anchors the comment to that span.
2. A small `Comment` pill appears near the selection.
3. With no selection, clicking anywhere on a block reveals the same pill
   anchored to that whole block, so a reader who does not select text can still
   comment. Select-or-click-then-pill is the primary discovery path; commenting
   is found by trying to interact with the text, not by a separate affordance.
4. Keyboard/touch fallback: focusing a paragraph, list item, table cell, or
   heading reveals an `Add comment` control. Keyboard users can tab to it and
   press Enter/Space.
5. Clicking opens a compact composer under the nearest block.
6. The composer shows a short quoted preview, optional display name, comment
   textarea, character count, Save/Cancel, retry/error state, and posted state.
7. If the visitor skips the name, assign stable local labels such as
   `Guest reviewer 1`, `Guest reviewer 2`.
8. Visitors can edit or delete their own open comments while the share remains
   active. Identity is held in a per-browser `visitorId` persisted in
   `localStorage`, so edit/delete rights and the assigned guest label survive
   reloads and return visits within the same browser. Clearing site data ends
   that ability: the comment stays, but the browser can no longer prove
   authorship. The owner can resolve or delete any comment.
9. On save, the comment appears immediately and syncs to the owner.

No modal, no account prompt, no sidebar requirement.

### Owner Review Flow

In Iliad, shared comments appear in two places:

- The document editor gets the same restrained blue bottom-band highlights used
  for comments today, but with a separate "shared comment" state from assistant
  selection comments.
- A small `Comments` button with a count opens a right-side review drawer. The
  drawer lists comments in document order, with Resolve, Delete, and Copy review
  notes.

V1 should not mix shared comments into `useSelectionComments`, because those
comments currently mean "pending instructions to send to the assistant". Shared
comments are durable review objects with resolve state.

Drawer details:

- Empty state: "No shared comments yet."
- Filter tabs: Open, Resolved, Unanchored.
- Click a comment to scroll the editor to the anchor and mark that card active.
- Unanchored comments group at the top of their nearest section when possible,
  otherwise in a global Unanchored group.
- `Resolve` is the primary action. `Delete` is a quieter secondary action with
  undo for a short window.
- Keyboard focus moves into the drawer when opened and returns to the triggering
  button when closed.
- New incoming comments update the count and announce via `aria-live="polite"`;
  they do not produce noisy toasts.

### Comment Lifecycle

V1 comments are flat review notes, not conversations. There are no replies, no
threads, and no owner-to-visitor responses. This is a deliberate scope choice,
not an omission: the owner's "reply" to a comment is to resolve it, delete it, or
change the document. Replies and threading are explicitly deferred (see
Non-Goals) and are not the natural destination of the feature.

Because resolution is the owner's only response, it must be legible to the
visitor, never a silent disappearance:

- Resolving keeps the comment on the public page in a quiet `Resolved` state with
  a text label, not color alone. The anchor mark de-emphasizes but does not
  vanish, so the visitor can see their note was addressed.
- Deleting removes the comment from the public page. Because there are no
  replies, a visitor whose comment was deleted simply no longer sees it; their
  recourse is to comment again. Owner delete keeps the short undo window.
- Visitors cannot resolve. They may edit or delete only their own open comments;
  once the owner resolves a comment it becomes read-only on the public side.
- Resolved and deleted states propagate to the public page on the next comments
  poll, the same channel used for new comments. No new transport is required.

### Accessibility Requirements

- Public comment creation works keyboard-only.
- Focus rings use the existing focus token and are visible on public and owner
  surfaces.
- Anchor marks and comment cards have screen-reader labels that include comment
  count and status.
- Status is never color-only; open/resolved/unanchored have text labels.
- `prefers-reduced-motion` disables non-essential transitions.
- Verify the public page at 375px width, including selection, fallback comment
  button, composer, and inline cards.

## V1 Technical Spec

### Architecture Overview

```text
src/
  collaboration/
    anchors.ts
    types.ts
    serialize.ts
    sharedMarkdown.tsx
    useSharedComments.ts
    publicPage/
      main.tsx
      PublicDocumentPage.tsx
      styles.css
  editor/
    sharedComments/
      extension.ts
      overlay.tsx

electron/
  collaboration/
    collabSessionStore.ts
    collabCommentStore.ts
    collabServer.ts
    collabRelayClient.ts
    collabRenderer.ts
  ipc/
    collaboration.ts

relay/
  share/
    src/
      worker.ts
      relayCore.ts
```

The desktop app owns sessions, reads the Markdown file, resolves assets, accepts
comments, and persists comments. The public browser app is a separate, minimal
browser bundle. It does not get Electron preload access.

### Internet Reachability

Serving "from your own computer" has a practical constraint: most users are
behind NAT and cannot accept inbound internet traffic. V1 should use a bounded
outbound relay tunnel:

1. Electron starts a local collaboration server bound to `127.0.0.1` for session
   handling and static assets.
2. Electron registers the share session with an Iliad share relay over an
   outbound WebSocket using a desktop-only registration token.
3. The public URL points at the relay.
4. The relay converts browser HTTP requests into request frames for the desktop
   connection and returns the desktop response to the browser.
5. The relay stores no document content and no comments. If the computer is
   asleep or Iliad is closed, the link shows an offline page.

This keeps the user's computer as the origin while avoiding router setup. A LAN
URL remains useful for development and private networks.

V1 deliberately avoids streaming through the relay. The public page polls
comments every 3-5 seconds. SSE/WebSocket presence can be added later after the
request tunnel is proven.

Relay frame contract:

```ts
type RelayFrame =
  | {
      type: "desktop_hello";
      protocolVersion: 1;
      desktopConnectionId: string;
      desktopAuthToken: string;
      sessionIds: string[];
    }
  | {
      type: "http_request";
      requestId: string;
      sessionId: string;
      method: "GET" | "POST" | "PATCH" | "DELETE";
      path: string;
      headers: Record<string, string>;
      bodyBase64?: string;
    }
  | {
      type: "http_response";
      requestId: string;
      status: number;
      headers: Record<string, string>;
      bodyBase64?: string;
    }
  | { type: "request_cancel"; requestId: string }
  | { type: "error"; requestId?: string; code: string; message: string };
```

Relay limits:

- Browser request body max: 64KB in V1.
- Desktop response body max: 2MB for JSON/document payloads; assets use a
  separate route with an explicit per-asset size cap.
- Request timeout: 20 seconds.
- In-flight request cap per desktop connection: 16; overflow returns 503.
- The relay maps each `sessionId` to exactly one authenticated desktop
  connection and must reject cross-session frames.
- The relay must not log bearer tokens, document content, comments, or absolute
  paths.

### Threat Model And Privacy Contract

- Anyone with the active link and token can read the full rendered document and
  all visible comments while Iliad is online.
- V1 comments are public to link holders by default. Owner-only comments are a
  future mode, not V1.
- The relay transports encrypted HTTPS/WebSocket traffic but must not persist or
  cache document content, comments, asset bytes, local paths, or tokens.
- Public responses must never include `workspaceRoot`, absolute file paths,
  app-data paths, raw local asset paths, or bearer tokens.
- Every public response sets `Cache-Control: no-store`,
  `Referrer-Policy: no-referrer`, and `X-Robots-Tag: noindex`.
- No cookies are required. The public API authenticates with the capability
  token on every document, comment, and asset request.
- The local server binds to `127.0.0.1` by default and disables CORS. LAN
  binding is a separate advanced opt-in.
- Ending the link invalidates the token immediately. Expiry is mandatory by
  default.

### IPC Surface

Add `window.iliad.collaboration`:

```ts
interface CollaborationApi {
  createShare(request: {
    workspaceSessionId: string;
    documentRelativePath: string;
    mode: "comment";
  }): Promise<OwnerShareSessionSnapshot>;
  stopShare(request: {
    workspaceSessionId: string;
    sessionId: string;
  }): Promise<void>;
  getShareStatus(request: {
    workspaceSessionId: string;
    documentRelativePath: string;
  }): Promise<OwnerShareSessionSnapshot | null>;
  listSharedComments(request: {
    workspaceSessionId: string;
    documentRelativePath: string;
  }): Promise<OwnerSharedComment[]>;
  updateSharedComment(request: {
    workspaceSessionId: string;
    commentId: string;
    patch: { status?: "open" | "resolved" };
  }): Promise<OwnerSharedComment>;
  deleteSharedComment(request: {
    workspaceSessionId: string;
    commentId: string;
  }): Promise<void>;
}
```

All handlers must resolve `workspaceSessionId` through the current window,
validate normalized POSIX workspace-relative Markdown paths, and reject hidden
paths, ignored paths (`node_modules`, `dist`, `dist-electron`), Windows drive
paths, absolute paths, parent segments, control characters, and symlinks. This
should follow the stricter selection-comments `workspaceSessionId` pattern plus
the agent document-tool path rules, not the older file IPC shape that accepts
absolute paths from preload.

Only app-owned metadata under `.iliad/collaboration/` may bypass the hidden-path
rule, and no public request may address that path directly.

### Public HTTP API

The relay forwards these routes to the desktop server. Public routes are scoped
by `sessionId`; no route accepts workspace paths.

```text
GET  /s/:sessionId
GET  /s/:sessionId/api/session
GET  /s/:sessionId/api/document
GET  /s/:sessionId/api/comments
POST /s/:sessionId/api/comments
PATCH /s/:sessionId/api/comments/:commentId
DELETE /s/:sessionId/api/comments/:commentId
GET  /s/:sessionId/assets/:assetId
```

`GET /s/:sessionId` returns a tiny HTML shell plus the public bundle. The page
then fetches document and comment state. V1 uses polling for comment updates. The
`GET /comments` response also carries the session's current `documentHash` so the
page can detect that the underlying document changed and offer a refresh without a
separate request. `PATCH` and `DELETE` only work for the visitor's own comments,
authenticated by their visitor token and the comment's author record. Owner
moderation stays on the Electron IPC surface.

### Capability Links

Public links use high-entropy capabilities:

```text
https://share.iliad.md/s/<sessionId>#t=<capabilityToken>
```

The token is placed in the URL fragment so it is not sent in the initial HTTP
request. The public page reads it and sends it in `Authorization: Bearer ...` or
`X-Iliad-Share-Token` for API calls.

V1 has one role: `commenter`. V2 can add `suggestor`. Owner-only operations
never use public tokens.

Security limits:

- Session IDs and tokens are random 128-bit or stronger.
- Public API never accepts filesystem paths.
- Max comment length: 4,000 chars.
- Max selected quote length: 20,000 chars.
- Max comments per document per session: 500.
- Rate limit by session + visitor id + IP at the relay.
- Expiry is mandatory. Default: 24 hours, renewable by the owner. "Keep active
  until ended" is an explicit advanced choice, not the default.
- Ending the link invalidates the public token immediately.
- `POST /comments` requires an idempotency key. Duplicate keys return the first
  stored comment rather than creating duplicates.

### Data Model

```ts
interface OwnerShareSessionSnapshot {
  id: string;
  documentRelativePath: string;
  fileLabel: string;
  fileName: string;
  mode: "comment";
  baseHash: string;
  relayUrl: string | null;
  localUrl: string;
  expiresAt: string;
  createdAt: string;
  stoppedAt?: string;
  counts: { open: number; resolved: number; unanchored: number };
}

interface ShareSessionSecretRecord {
  id: string;
  workspaceRoot: string; // app-data only, never public and never in workspace metadata
  documentRelativePath: string;
  fileName: string;
  tokenHash: string;
  desktopConnectionId?: string;
  desktopAuthTokenHash?: string;
  mode: "comment";
  baseHash: string;
  expiresAt: string;
  createdAt: string;
  stoppedAt?: string;
}

interface PublicSessionSnapshot {
  id: string;
  title: string;
  fileName: string;
  mode: "comment";
  documentHash: string;
  expiresAt: string;
  status: "online" | "offline" | "stopped" | "expired";
  commentVisibility: "visible_to_link_holders";
}

interface SharedCommentAnchor {
  quote: string;
  prefix: string;
  suffix: string;
  occurrence: number; // 1-based, matching Iliad selection comments
  headingPath: string[];
  blockHash: string;
  sourceRange?: { from: number; to: number };
}

interface SharedCommentRecord {
  version: 1;
  id: string;
  sessionId: string;
  documentRelativePath: string;
  anchor: SharedCommentAnchor;
  text: string;
  author: {
    visitorId: string;
    displayName?: string;
  };
  status: "open" | "resolved";
  createdAt: string;
  updatedAt: string;
}

interface OwnerSharedComment extends SharedCommentRecord {
  resolution: {
    anchored: boolean;
    line?: number;
    from?: number;
    to?: number;
    sectionLabel?: string;
  };
}

interface PublicSharedComment {
  id: string;
  anchor: SharedCommentAnchor;
  text: string;
  author: { displayName: string; ownComment: boolean };
  status: "open" | "resolved";
  createdAt: string;
  updatedAt: string;
}
```

Session secrets live in app data. Comments should live in the workspace under:

```text
.iliad/collaboration/comments.json
```

This keeps feedback portable with the project while keeping it out of ordinary
Markdown files and the visible file tree. It is a documented source-as-contract
exception: comments are review workflow metadata, not document content required
to understand the `.md` file. Accepted future edits still become explicit
Markdown diffs before landing.

Persistence rules:

- Store schema version at the file root and on records.
- Public comment mutations are append/update/delete operations, not wholesale
  document replacement.
- Each mutation reloads the current store, applies one validated change, writes a
  temp file, and atomically renames it over the store. This copies the LXD
  reload-before-write pattern and avoids the replacement-style persistence used
  by transient assistant selection comments.
- Corrupt stores do not get overwritten silently. Move the corrupt file aside
  with a timestamp, start a fresh store, and show an owner warning.
- `workspaceRoot` never appears in workspace comment metadata; it is resolved
  from the active window/session at runtime.

### Anchoring

Borrow the LXD approach but adapt it to general Markdown:

- Capture rendered selection text as `quote`.
- Capture `prefix` and `suffix` from neighboring rendered text.
- Capture nearest Markdown heading path.
- Capture 1-based occurrence ordinal within the containing block.
- Capture a block hash based on normalized rendered block text.
- When possible, capture source offsets from the rendered block's
  `data-source-from/to`.

Concrete source-map plan:

- Build a small Markdown block index from the mdast positions produced by the
  remark pipeline. Convert line/column positions to absolute source offsets with
  a precomputed line-start table.
- Public renderer components attach `data-block-id`, `data-source-from`, and
  `data-source-to` to paragraphs, headings, list items, blockquotes, table
  cells, and code blocks where positions are available.
- If a block has no reliable source position, capture the text-only anchor
  fields and skip `sourceRange`.
- Do not rely on generic `react-markdown` output to provide offsets implicitly;
  the source-map wrapper is part of this feature.

Resolution order:

1. Exact source range if the current source hash still matches.
2. Same block hash + quote occurrence.
3. Same heading path + quote occurrence.
4. Prefix/suffix tiebreaker across all quote matches.
5. Orphan: show the comment in an "Unanchored comments" group, never drop it.

For V1, anchoring should be robust enough for comments while the owner is editing
locally. It does not need Google Docs-level operational transform.

### Markdown Rendering

Reuse the existing renderer configuration where possible:

- `react-markdown`
- `remark-gfm`
- `remark-math`
- `rehype-katex`
- existing `latexMathToDollar`
- a public-specific safe link handler

Do not execute raw HTML from Markdown in the public page. Render or escape it as
literal source unless a later spec defines a safe allowlist.

The public safe link handler must not reuse `safeMarkdownHref` unchanged because
that helper allows `file:` URLs for internal review surfaces. Public links allow
only `https:`, `http:`, and `mailto:`. `javascript:`, `data:`, `file:`, and
unknown schemes render as inert text.

Comment text, display names, file labels, and error copy render as text only.
Never inject them with `innerHTML`.

Images and local assets:

- Public page rewrites relative image URLs to `/assets/:assetId`.
- Electron resolves each asset against the shared document path using existing
  Markdown asset rules, then builds a per-session allowlist from the parsed
  document.
- Only allowlisted files inside the workspace and referenced by the shared
  document are served.
- Each asset request requires the capability token.
- Asset resolution uses canonical `lstat` checks, rejects symlinks, rejects
  hidden/ignored paths, and enforces a size cap.
- Serve only conservative image types in V1: PNG, JPEG, GIF, WebP, and AVIF.
  SVG is blocked unless a later sanitizer is added.
- Remote images are not loaded by default in public shares because they leak
  visitor IP/referrer to third parties. Render a quiet placeholder with the
  remote domain and an ordinary external link.
- Missing assets render as quiet broken-media placeholders.

### Owner-Side Editor Rendering

Add a separate CodeMirror extension under `src/editor/sharedComments/`:

- Blue bottom-band decoration for open comments.
- Muted/very light band for resolved comments when the drawer is open; otherwise
  resolved comments can be hidden by default.
- Hover or click opens a compact popover with comment text and Resolve/Delete.
- The review drawer owns bulk actions and `Copy review notes`.

Keep this separate from `selectionCommentsExtension`, because assistant
selection comments are transient instructions, while shared comments are durable
review state.

Owner sync:

- The collaboration server emits an internal event after every public comment
  mutation.
- `electron/ipc/collaboration.ts` broadcasts that event only to windows whose
  current `workspaceSessionId` matches the session's workspace.
- `src/collaboration/useSharedComments.ts` subscribes to those events, reloads
  comments for the active document, and re-resolves anchors against current
  editor text.
- If the user is offline from the relay but still editing locally, owner comment
  management continues to work against the local store.

### Copy Review Notes

V1 should provide a browser-safe serializer similar to LXD's clipboard payload:

```text
Comments on `docs/example.md`:

1. Line 18 - "selected quote"
   Visitor: Maria
   Comment: This transition feels abrupt.

Unanchored comments:
...
```

Line numbers are computed at copy time by resolving each anchor against the
current Markdown. Open comments sort by resolved position; orphans sort last.
The owner-facing button label is `Copy review notes`; any assistant-specific
destination belongs in helper text or a later AI workflow, not the primary
action label.

### V2 Proposal Direction

V2 should prefer an `ExternalChangeProposal` model with an adapter into the
existing hunk review UI, rather than reusing `AgentChangeProposal` directly.
`AgentChangeProposal` currently carries AI-specific fields such as run id, model,
and source. The existing hunk renderer and apply/reject mechanics are still the
right visual surface, but external suggestions need their own source metadata
and stale/rebase semantics.

Non-overlapping rebase is not implemented today. V2 must either implement it
explicitly or mark changed-base suggestions stale and ask the visitor/owner to
refresh.

### Build And Packaging

The public page should be a real browser bundle, not a hand-written template
string. Vite can build an additional entry for `src/collaboration/publicPage`.
The Electron server reads the built JS/CSS from `dist/` in production and from
the Vite dev server in development.

The relay worker should be isolated under `relay/share` and tested separately,
following the existing `relay/telegram` pattern.

The public bundle must not import Electron preload APIs or Node-only modules.
Shared code between owner and public surfaces must stay browser-safe.

### Error And Offline States

Public page states:

- Owner online: normal page.
- Owner offline: page chrome plus "The owner's computer is not available. Try
  again later."
- Share stopped: "This link has ended."
- Token invalid: "This link is invalid or incomplete."
- Share expired: "This link has expired."
- Document renamed or deleted: "The document is no longer available."
- Document changed while reading: quiet, dismissible "Document updated" affordance
  that refreshes on the visitor's command, never mid-composer.

Owner states:

- Relay connected.
- Relay reconnecting.
- Local-only URL available.
- Share stopped.
- New comments received.

Do not show noisy toasts for every comment. A count badge and drawer update are
enough.

## V1 Non-Goals

- No public Markdown editing.
- No direct remote writes to disk.
- No accounts.
- No workspace-wide sharing.
- No arbitrary file browsing through public URLs.
- No raw HTML execution in public Markdown.
- No Git integration.
- No CRDT or presence.
- No public LAN binding unless the owner explicitly opts into advanced LAN
  sharing.
- No permanent hosted copy after the owner's computer goes offline.
- No comment replies, threads, or owner-to-visitor responses; V1 comments are
  flat notes and the owner's reply is resolve, delete, or edit the document.
- No reader presence, view counts, or "who opened the link" reporting; reach is
  visible only as the share's online/offline state in the owner popover.
- No always-on "you are sharing" indicator in the editor chrome; the owner checks
  share state by opening the Share popover, and mandatory expiry bounds a
  forgotten share.

## V1 Verification

Unit tests:

- Anchor capture and resolution across unchanged, lightly edited, repeated, and
  orphaned text.
- Collaboration comment store sanitization, schema versioning, idempotent
  append/update/delete mutations, atomic write, corrupt-store recovery, and max
  length limits.
- IPC rejection for untrusted senders, wrong `workspaceSessionId`, hidden paths,
  ignored paths, symlinks, absolute paths, Windows paths, parent segments, and
  non-Markdown targets.
- Public API token validation and path-free routing on every route, including
  assets and polling.
- Public API rejects missing/invalid/stopped/expired tokens, oversized bodies,
  malformed JSON, duplicate POST idempotency keys, and visitor attempts to edit
  someone else's comment.
- Asset resolution only serves referenced workspace files and rejects SVG,
  symlinks, hidden/ignored paths, oversize files, traversal, and unallowlisted
  assets.
- Copy-review-notes serializer ordering and orphan handling.
- Relay core forwards request frames only to the correct desktop session,
  enforces frame/body caps, cleans up timeouts, handles desktop disconnect
  mid-request, and never persists payload content.
- Security rendering covers raw HTML, `javascript:` URLs, `file:` URLs,
  comment-text XSS, display-name XSS, and remote image placeholders.
- Data privacy tests assert public payloads and logs never include
  `workspaceRoot`, absolute asset paths, app-data paths, tokens, or raw local
  asset paths.
- Concurrency tests cover two visitors posting at once and owner resolving while
  a visitor posts.

Renderer tests:

- Public page renders Markdown without executing raw HTML.
- Selection creates a comment draft and POSTs the expected anchor.
- Clicking a block with no selection reveals the comment pill anchored to that
  block.
- Owner drawer sorts, resolves, deletes, and copies comments.
- Keyboard-only block comment creation works.
- Mobile-width public page keeps the composer and comment cards readable.
- Multiple comments on one anchor render one mark with a count.
- Resolving a comment shows the visitor a labeled `Resolved` state rather than
  removing it; deleting removes it; a resolved comment is read-only to the
  visitor.
- A changed `documentHash` shows the quiet refresh affordance and never reflows
  the body while a composer is open.
- A persisted `visitorId` keeps edit/delete rights and the guest label across a
  reload; cleared site data drops authorship without deleting the comment.

Manual checks:

- Share a document, open link in another browser, comment, see the owner UI
  update.
- End the link and verify the public link stops working.
- Close Iliad and verify the public link shows offline.
- Rename or edit the document locally and verify comments re-anchor or orphan
  safely.
- Try path traversal and oversized comment payloads against public API.
- Confirm public responses include `Cache-Control: no-store`,
  `Referrer-Policy: no-referrer`, and `X-Robots-Tag: noindex`.

## Decisions To Revisit After V1

- Whether comments should be committed to Git by default, ignored by default, or
  configurable per workspace.
- Whether V2 edit proposals should reuse `AgentChangeProposal` directly or use a
  sibling `ExternalChangeProposal` type that renders through the same review UI.
- Whether built-in relay service should be Iliad-hosted, self-hostable, or both.
- Whether trusted live edit sessions in V3 should autosave continuously or stage
  changes behind a "sync to disk" button.
- Whether a future mode should let owners keep public comments owner-only rather
  than visible to all link holders.
- Whether remote images should be proxied by the owner's computer, allowed with
  owner consent, or kept as placeholders permanently.
