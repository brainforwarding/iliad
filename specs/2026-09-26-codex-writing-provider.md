# Optional Codex provider for manual writing actions

Status: proposed. Windows prototype validated locally; not integrated into
current `master`, not a macOS release, and not an accepted amendment to the
product guardrail.

This is a separate feature from [Windows support, PR #1](https://github.com/brainforwarding/iliad/pull/1).
The provider does not require the Windows installer, CLI named pipes or PATH
changes. Its reference implementation happens to have been tested on that base.
This document can be reviewed and implemented without merging PR #1.

## Reviewer brief

Allow a writer who already has a ChatGPT plan with Codex access to choose Codex
for the existing selection and continuation actions. Keep Iliad a writing
surface: explicit requests, bounded context, a proposal, then acceptance.
There is no chat, conversation memory, folder exploration or model-authored
file write. The external-agent review workflow stays separate.

The tested prototype is available at
[`8659f291`](https://github.com/elcomparemaquito/iliad/commit/8659f291cd295fb63543387eaeb535a79a14ed32).
That single commit contains the Codex change; its ancestors include the Windows
work. Do not merge the whole prototype branch into `master` as this feature.

The integration target examined for this proposal is `782ef73` (0.4.0 release
preparation). It uses Groq and has removed automatic suggestions and writing
notes. The prototype predates those changes and still uses Gemini. Its runtime
adapter and tests are reference code, not a patch that can be applied unchanged.

## Problem

Writers may already pay for a Codex subscription and want to use it for small
writing actions without managing another provider key. An App Server adapter
lets Iliad use that account through its supported authentication flow. This
does not make the subscription unlimited, route it through Iliad's free proxy,
or give Iliad the user's existing Codex conversations.

## Decisions

### 1. Add a provider; keep the current default

Preserve ADR-0021's review-first, single-document boundary and ADR-0023's Groq
free/own-key routing. On current `master`, the choice would be Iliad AI (the
existing Groq routes) or Codex. Selecting Codex must not read a Groq failure as
permission to change providers, or fall back to the free proxy on an error.
Existing installations retain the current provider until explicitly changed.

Why: provider choice is a billing and privacy choice, not transport recovery.
The two Groq routes remain unchanged inside their own implementation.

Consequence: accepting this feature requires an explicit amendment to
ADR-0023's single-model policy and the product guardrail. This proposal does
not silently mark that amendment accepted.

### 2. Main owns a private App Server

Start a Codex child on demand over `stdio`, with `shell: false` and
`windowsHide: true`. Resolve a configured native executable, then PATH, then
the supported standard Windows installation location. Never include personal
paths or invoke Windows `.cmd` wrappers through a shell. Missing or unsupported
installations show a recoverable error and a native executable chooser.
Iliad does not bundle, download or update Codex in this iteration.

Use a dedicated `<userData>/codex-writing` home and an empty working directory
under it. Do not copy authentication from the normal CLI or desktop profile.
Codex manages the dedicated credentials; main exposes connection state, not
tokens, account details or protocol logs, through preload.

Why: this keeps process lifetime, credentials and environment handling out of
the renderer and avoids changing the user's normal Codex session. The writing
transport is unrelated to Iliad's local CLI socket or Windows named pipe.

### 3. Use a separate browser login and discovered models

Initialize the server, read account state, and start the ChatGPT login flow
only on request. Open the validated HTTPS authentication URL in the browser;
the user completes authentication. Support cancel and logout for this home
only. An API-key-authenticated account is not the subscription route.

Read paginated `model/list` results and use the advertised default model and
reasoning effort. Save a model identifier only as a preference; if it is no
longer available, resolve the current advertised default. Do not hardcode
model names from screenshots, another client, or a particular user's plan.
Missing rate-limit data means unknown, not zero remaining.

The prototype displays remaining limits in Writing assists. Current ADR-0023
deliberately avoids usage counts: the upstream UI decision is still open.
Keep Codex account limits distinct from Iliad's free-route quota in either
design. Follow the current one-row menu style and bilingual strings.

### 4. Treat each action as a bounded text transformation

Keep validation and task construction in the current writing service. Pass
only the selection or bounded continuation context already prepared by the
editor. Do not resurrect writing notes (ADR-0022), load repository instruction
files, inherit the conversation that developed this feature, or scan the book.

Start an ephemeral thread for each action. Request a structured response with
one `text` field. Offer only a completed, nonempty, bounded response; do not
insert streamed fragments, reasoning, canceled results or malformed JSON.
Existing range/document checks remain authoritative when accepting a proposal.

Why: the file remains the contract. The adapter produces text; existing editor
transactions apply it and autosave persists it. Neither App Server nor the
provider abstraction receives a document-write capability.

### 5. Restrict capabilities and fail closed on protocol changes

The tested runtime is **Codex CLI 0.154.0**. The prototype permits 0.154.x;
other patch releases in that range have not been individually validated.
Version acceptance is a compatibility guard, not proof of isolation.

Use strict configuration and verify the effective values with `config/read`.
Disable execution, editing, browsing, MCP, apps, plugins, skill discovery,
subagents, memory and hooks. Select a named read-only permission profile limited
to platform minimum reads and the isolated workspace, without tool network
access. Model-service communication remains necessary for inference.
Use `approvalPolicy: never`; reject client tool/approval requests and unexpected
tool items. A prompt saying "do not use tools" alone is insufficient.

In 0.154.0 the legacy `readOnly.access` shape is rejected. The prototype uses
experimental permission-profile fields and verifies the returned active profile,
provider, approval policy and absence of instruction sources. The typed
`config/read` response omits `tools.update_plan.enabled`; the prototype skips
that one comparison and rejects unexpected tool items at runtime. This is a
documented protocol limitation, not evidence that every capability is absent.

Consequence: a maintainer widening the version range must retest effective
restrictions and hostile tool attempts on each target OS. Read-only filesystem
permissions do not by themselves prohibit reading sensitive files; the lack of
tools, isolated context and runtime checks are separate boundaries. macOS
enforcement has not been validated by the prototype author.

### 6. Cancellation and failure must leave the editor usable

Share one active request per renderer across selection and continuation IPC.
A replacement request cancels the old one; different windows remain independent.
Cancel on document/window closure and application shutdown. Correlate JSONL
responses by request ID, handle fragmented messages, bound buffered input and
reject pending requests when the child exits.

Use a 90-second Codex action timeout without changing Groq's timeouts. Interrupt
the turn on cancellation and release subscriptions. An error must preserve the
document and offer a user-controlled retry; Iliad must not retry or switch
providers automatically. SDK/server-internal retry behavior must be examined
separately when validating a new runtime.

Keep expired login, limits, missing executable, incompatible protocol, timeout,
empty response and process failure distinguishable in the main-process result.
Map these into the current `AiNoticeBar`/writing error conventions rather than
replacing Groq notices wholesale. Log only provider, timings, status and error
codes, never writing context, instructions, credentials or raw protocol payloads.

## Module ownership and implementation sequence

Keep `electron/main.ts` and `src/App.tsx` as composition layers. The prototype
uses these owners; the port should preserve their responsibilities:

| Owner | Responsibility |
| --- | --- |
| `electron/writing/codexTransport.ts` | Child process, bounded JSONL framing, RPC correlation and failure cleanup |
| `electron/writing/codexProvider.ts` | Discovery, isolated home, authentication, capability checks and text generation |
| `electron/writing/codexTypes.ts` | Sanitized connection, model and limit types |
| `electron/writing/writingAiService.ts` | Provider selection after common input validation; preserve Groq routing |
| `electron/ipc/writingRequests.ts` | Request ownership across selection and continuation |
| `electron/ipc/writingSettings.ts` | Trusted settings/login operations and native dialogs |
| `electron/preload.ts`, `src/types/iliad.ts` | Matching, minimal renderer-facing contracts |
| `src/components/WritingAssistsMenu.tsx` and a provider row | Existing menu style, account actions and model selection |
| `src/i18n/strings.ts` | English and Spanish labels and recoverable errors |
| `tests/writing/codex*.test.ts` | Fake transport/provider tests without accounts or secrets |

1. Extract a small text-provider boundary around the current validated
   `WritingAiTask`. Preserve `checkedTask`, limits and Groq prompt versioning.
   Reuse suitable pure prompt helpers or add a Codex-specific serializer; do not
   change the Worker contract to accommodate a desktop-only provider.
2. Port the transport, isolated runtime and deterministic tests. Audit their
   protocol assumptions against the installed Codex version before enabling UI.
3. Add provider preferences without reviving the removed Gemini settings/key
   store. Preserve Groq safe-storage behavior. Extend status with selected
   provider and Codex state rather than overloading Groq's `free/own-key/blocked`.
4. Update main IPC, preload and renderer types together. Keep validation in main
   even when the menu hides an unavailable action. Preserve current length
   shortcuts; the prototype's older Ctrl+Enter continuation mapping is not the
   current specification. Do not restore automatic-suggestion controls.
5. Add UI and lifecycle regressions, then run the platform acceptance matrix.
   Review proposed product/ADR amendments separately from runtime correctness.

## Evidence and remaining release gates

The following evidence applies only to prototype commit `8659f291`, tested on
Windows x64 on 2026-09-26 with Codex CLI 0.154.0. It does not validate a port onto
`782ef73` or a future commit.

| Check | Observed result |
| --- | --- |
| Type checking, CSS lint, production build | Passed locally |
| Unit suite | 559 passed, 18 platform skips, zero failures |
| Production dependency audit | Zero reported vulnerabilities at test time |
| Installed Windows regression suite | 15 checks passed, including CLI, save/restart, locked-file recovery, images and outside review |
| Real account, Spanish, synthetic documents | Login/session restoration, rewrite accept/reject, continuation accept/discard and prose undo passed |
| Visual inspection | Connected status, discovered model, limits, manual continuation and disabled automatic requests observed |
| Exact whitespace restoration | One undo assertion differed by a trailing blank line; repeat verified prose with trailing whitespace normalized. Exact restoration remains to investigate |
| All presets in both languages with a real account | Not completed |
| macOS installed app, login and capability enforcement | Not run; no macOS build is submitted as validated |
| Current Groq integration | Not implemented or tested by the prototype |

After publishing the prototype, [CI run 36248535523](https://github.com/elcomparemaquito/iliad/actions/runs/36248535523)
passed on Windows, macOS and Linux for that same implementation commit. Each
job ran clean dependency installation, type checking, unit tests, CSS lint,
build and production audit. Windows also built the installer, tested the
packaged and installed application, and completed the opt-in/opt-out,
reinstallation, preference-preservation and uninstallation cycle. The run
provides temporary Windows installer/checksum artifacts. The macOS job did
not validate browser login, the desktop UI or runtime permission enforcement
with a real account; those gates above remain pending.

The local Windows installer SHA256 was
`c9607057cb4f22286a894b1d30092a16bdea8fd96318e48334017ec6961ff3c5`.
No installer, account profile, credentials, private document or personal log is
part of this documentation contribution.

Before shipping the upstream implementation:

- Run `npm ci`, type checking, the complete applicable test suites, CSS lint,
  build and production audit on each supported platform. Keep deterministic
  protocol tests independent of accounts, network availability and credentials.
- Exercise fragmented messages, malformed/empty responses, authentication
  cancellation, expired sessions, limits, timeout, child failure, unsafe tools,
  provider switching and simultaneous windows. Verify pending work is canceled
  when the document/window closes, and that stale output cannot be accepted.
- Test every manual action in English and Spanish, reject/accept, exact undo,
  edits during generation, restart and logout isolation using synthetic files.
- On a Mac, verify native executable discovery from a packaged app (including
  Finder's PATH), browser login, keychain/file credential behavior, permission
  restrictions, menu/shortcut layout, quit with pending saves and account
  restoration. Signing/notarization and distribution remain the maintainer's
  release process; passing headless macOS tests alone is not this validation.
- Publish results tied to the tested commit. Leave unexecuted checks pending.
  The tested Windows prototype is useful evidence, not a cross-platform release
  certificate or a reason to skip current Groq regressions.

## References

- [Product guardrail](../docs/product-vision.md), [source as contract](../docs/source-as-contract.md)
- [ADRs 0021–0023](../docs/decisions.md), [architecture](../docs/architecture.md)
- [Current writing-assists menu](2026-09-25-writing-assists-one-row.md)
- [Groq free/own-key design](2026-09-25-groq-ai-free-tier.md)
- [Codex App Server protocol](https://learn.chatgpt.com/docs/app-server)
