# Writing Corrector Memory

## Goal

Persist the user's corrector choices across app restarts so dismissed writing issues do not reappear immediately after reopening the editor.

## User Behavior

- `Ignore` hides this kind of issue in the current document across restarts.
- `Add to dictionary` hides this spelling word everywhere for the current language across restarts.
- Corrector memory should load silently when a Markdown document opens.
- Corrector memory should not expose rule ids, provider names, offsets, or storage details in the UI.

## Storage Model

Use an Electron main-process JSON store under user data:

`{userData}/assistant/writing-corrector-memory.json`

Shape:

```ts
interface WritingCorrectorMemoryStoreV1 {
  version: 1;
  documents: Array<{
    workspacePath: string;
    documentRelativePath: string;
    ignoredIssueFingerprints: string[];
    updatedAt: string;
  }>;
  dictionary: Array<{
    language: "en" | "es";
    word: string;
    createdAt: string;
  }>;
}
```

## Keys

Do not persist position-based issue keys. Offsets change as the user edits, so they are bad memory keys.

Add a stable issue fingerprint derived from:

- language
- source
- rule id
- category
- normalized original text
- normalized replacement values

Keep position-based ids only for DOM decoration identity and stale-safe correction application.

## Scope

Document ignores are workspace + relative-path scoped. This means ignoring lowercase `i` in one draft does not suppress every lowercase `i` in every other document.

In v1, document ignores do not follow a rename or move. The cleaner long-term option is to add document ids, but the editor does not have stable document identities yet, and path-scoped memory is predictable and safe.

Dictionary words are global per language because that matches user intent for terms, names, abbreviations, and domain vocabulary.

## IPC

Add a trusted IPC surface:

- `writing-corrector-memory:get({ workspaceSessionId, documentRelativePath, language })` returns `{ ignoredIssueFingerprints, customWords }`.
- `writing-corrector-memory:ignore({ workspaceSessionId, documentRelativePath, language, fingerprint })` appends one ignored issue fingerprint and returns the document memory snapshot.
- `writing-corrector-memory:add-dictionary-word({ language, word })` appends one language-scoped dictionary word and returns `{ customWords }`.

The main process resolves `workspaceSessionId` to the actual workspace root, validates `documentRelativePath` as a Markdown file, and ignores renderer-provided workspace paths.

Do not expose a generic `save(memory)` method. The renderer should send user actions, not replacement JSON blobs. This keeps the persistence surface narrow and prevents a compromised renderer path from deleting unrelated memory entries.

## Renderer Integration

`EditorPane` owns active corrector state today, so it should also own loading/saving corrector memory through callbacks passed in `writingAssists`.

On document change:

- reset in-memory corrector state
- load persisted memory for the new document
- apply `ignoredIssueFingerprints` and `customWords` to the corrector extension
- ignore stale load responses if the active file changed while the request was in flight

On `Ignore`:

- add the issue fingerprint to the document ignore set
- call the append-only ignore IPC action

On `Add to dictionary`:

- add the normalized word to the language dictionary
- call the append-only dictionary IPC action

Wiring:

- `electron/writingCorrector/writingCorrectorMemoryStore.ts` owns JSON storage.
- `electron/ipc/writingCorrectorMemory.ts` owns IPC validation and action handlers.
- `electron/main.ts` registers the IPC with the workspace-session resolver.
- `electron/preload.ts` and `src/types/iliad.ts` expose the typed renderer API.
- `src/App.tsx` binds the active workspace/document/language to `EditorPane`.
- `src/components/EditorPane.tsx` keeps optimistic UI state and delegates persistence through callbacks.

## Safety

- Bound array sizes to prevent unbounded growth.
- Sanitize strings and timestamps.
- Use atomic writes through a temp file + rename.
- Queue writes in the store to avoid corrupting JSON during rapid actions.
- On malformed JSON, fall back to empty memory rather than breaking the editor.

## Tests

- Store persists document ignores and dictionary words across a reopened store instance.
- Store scopes document ignores by workspace + document path.
- Store sanitizes and bounds malformed renderer input.
- IPC rejects untrusted senders and invalid document paths.
- Corrector issue detection suppresses both old position keys and new stable fingerprints.
- Renderer load/save behavior preserves an ignored issue after document reload.
