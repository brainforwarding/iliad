// Builds the structured writing-AI task for a prompt version from a
// normalized IPC request (spec 2026-09-27-ai-context-and-preferences.md). v1
// tasks are built from the existing fields exactly as before; v2 tasks add the
// whole current document (trimmed to the shared byte budget), its outline and
// the writer's preferences. Pure (imports only the prompt module).

import {
  WRITING_PREFERENCES_MAX_CHARS,
  WRITING_AI_MAX_DOCUMENT_CHARS,
  WRITING_AI_MAX_TASK_BYTES,
  buildDocumentOutline,
  neutralizePromptDelimiters,
  trimDocumentForContext,
  utf8ByteLength,
  type AutocompleteKind,
  type PromptVersion,
  type SelectionMode,
  type SelectionRange,
  type WritingAiTask,
  type WritingLanguage
} from "./groq/prompts/index.js";

/** The request cannot fit the task budget even without the document (IPC answers `too_long`). */
export class WritingAiTooLongError extends Error {
  constructor() {
    super("The writing-AI request is too long.");
    this.name = "WritingAiTooLongError";
  }
}

export interface AutocompleteDocumentSnapshot {
  /** The full current document (without a visible, unaccepted draft). */
  text: string;
  /** The cursor (where a draft being extended sits). */
  cursor: number;
}

export interface SelectionDocumentSnapshot {
  text: string;
  /** Absolute offsets of the selection in `text`. */
  selectionFrom: number;
  selectionTo: number;
}

export interface AutocompleteTaskInput {
  language: WritingLanguage;
  kind: AutocompleteKind;
  extend: boolean;
  /** The local window before the cursor; ends with the draft when extending. */
  prefix: string;
  suffix: string;
  documentTitle: string;
  headingPath: string[];
  nearbyHeadings: string[];
  direction: string;
  avoid: string[];
  document?: AutocompleteDocumentSnapshot;
  /** Validated (trimmed, within the limit); "" or undefined = none. */
  preferences?: string;
}

export interface SelectionTaskInput {
  language: WritingLanguage;
  mode: SelectionMode;
  instruction?: string;
  /** The editable passage (selection plus its safe surrounding unit). */
  text: string;
  selection: SelectionRange;
  document?: SelectionDocumentSnapshot;
  preferences?: string;
}

const taskBytes = (task: WritingAiTask) => utf8ByteLength(JSON.stringify(task));

export function buildAutocompleteTask(version: PromptVersion, input: AutocompleteTaskInput): WritingAiTask {
  if (version === 1) {
    return {
      v: 1,
      task: "autocomplete",
      language: input.language,
      kind: input.kind,
      extend: input.extend,
      prefix: input.prefix,
      suffix: input.suffix,
      documentTitle: input.documentTitle,
      headingPath: input.headingPath,
      nearbyHeadings: input.nearbyHeadings,
      direction: input.direction,
      avoid: input.avoid
    };
  }

  const base: WritingAiTask = {
    v: 2,
    task: "autocomplete",
    language: input.language,
    kind: input.kind,
    extend: input.extend,
    documentTitle: input.documentTitle,
    headingPath: input.headingPath,
    direction: input.direction,
    avoid: input.avoid,
    document: "",
    outline: input.document ? buildDocumentOutline(input.document.text, input.document.cursor) : "",
    preferences: neutralizePromptDelimiters(input.preferences ?? "").trim()
  };
  const budgetBytes = WRITING_AI_MAX_TASK_BYTES - taskBytes(base);
  if (budgetBytes <= 0) throw new WritingAiTooLongError();

  const view = autocompleteDocumentView(input);
  const trimmed = trimDocumentForContext({ ...view, budgetBytes, maxChars: WRITING_AI_MAX_DOCUMENT_CHARS });
  if (!trimmed) throw new WritingAiTooLongError();
  return { ...base, document: trimmed.text };
}

/**
 * The document as the model should see it: the snapshot with the local
 * window (prefix + suffix, the prefix ending with any draft being extended)
 * at the cursor. The snapshot has no draft, so the prefix is aligned on the
 * longest start of it that ends at the cursor; the rest is the draft. A
 * snapshot that does not match the window (or none) → the window alone.
 */
export function autocompleteDocumentView(input: Pick<AutocompleteTaskInput, "prefix" | "suffix" | "extend" | "document">): {
  text: string;
  cursor: number;
  localWindow: { from: number; to: number };
} {
  const { prefix, suffix } = input;
  const windowOnly = { text: `${prefix}${suffix}`, cursor: prefix.length, localWindow: { from: 0, to: prefix.length + suffix.length } };
  const snapshot = input.document;
  if (!snapshot || !snapshot.text.startsWith(suffix, snapshot.cursor)) return windowOnly;

  const { text, cursor } = snapshot;
  let raw = -1;
  if (text.endsWith(prefix, cursor)) raw = prefix.length;
  else if (input.extend) {
    for (let length = prefix.length - 1; length > 0; length -= 1) {
      if (text.endsWith(prefix.slice(0, length), cursor)) {
        raw = length;
        break;
      }
    }
  }
  if (raw <= 0 && prefix.length > 0) return windowOnly;

  const from = cursor - raw;
  const viewCursor = from + prefix.length;
  return {
    text: `${text.slice(0, from)}${prefix}${text.slice(cursor)}`,
    cursor: viewCursor,
    localWindow: { from, to: viewCursor + suffix.length }
  };
}

export function buildSelectionTask(version: PromptVersion, input: SelectionTaskInput): WritingAiTask {
  const passage = {
    language: input.language,
    mode: input.mode,
    ...(input.mode === "edit" ? { instruction: input.instruction ?? "" } : {}),
    text: input.text,
    selection: { from: input.selection.from, to: input.selection.to }
  };
  if (version === 1) return { v: 1, task: "selection", ...passage };

  const base: WritingAiTask = {
    v: 2,
    task: "selection",
    ...passage,
    document: "",
    preferences: neutralizePromptDelimiters(input.preferences ?? "").trim()
  };
  const budgetBytes = WRITING_AI_MAX_TASK_BYTES - taskBytes(base);
  if (budgetBytes <= 0) throw new WritingAiTooLongError();

  const range = passageRangeInDocument(input);
  if (!range || !input.document) return base;
  const { text } = input.document;
  // Nothing but the passage: no reference to send.
  if (!(text.slice(0, range.from) + text.slice(range.to)).trim()) return base;
  const trimmed = trimDocumentForContext({ text, passage: range, budgetBytes, maxChars: WRITING_AI_MAX_DOCUMENT_CHARS });
  return trimmed ? { ...base, document: trimmed.text } : base;
}

/**
 * Where the editable passage sits in the snapshot, or null when the snapshot
 * does not contain it at the selection (then the edit goes out with its
 * passage only, as before).
 */
export function passageRangeInDocument(input: Pick<SelectionTaskInput, "text" | "selection" | "document">): { from: number; to: number } | null {
  const snapshot = input.document;
  if (!snapshot) return null;
  const from = snapshot.selectionFrom - input.selection.from;
  const to = from + input.text.length;
  if (
    from < 0 ||
    to > snapshot.text.length ||
    snapshot.selectionTo - snapshot.selectionFrom !== input.selection.to - input.selection.from ||
    snapshot.text.slice(from, to) !== input.text
  ) {
    return null;
  }
  return { from, to };
}

// ---------------------------------------------------------------------------
// IPC request validation (main is the authority).

export type PreferencesValidation = { ok: true; preferences: string } | { ok: false; reason: "too_long" };

/**
 * Writing preferences from the renderer: missing/undefined/non-string → none;
 * trimmed; over WRITING_PREFERENCES_MAX_CHARS → rejected (never sliced).
 */
export function validateWritingPreferences(value: unknown): PreferencesValidation {
  if (typeof value !== "string") return { ok: true, preferences: "" };
  const preferences = value.trim();
  return preferences.length > WRITING_PREFERENCES_MAX_CHARS ? { ok: false, reason: "too_long" } : { ok: true, preferences };
}

/** A well-formed autocomplete snapshot, or undefined (then the local window alone is sent). */
export function normalizeAutocompleteDocument(value: unknown): AutocompleteDocumentSnapshot | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { text, cursor } = value as { text?: unknown; cursor?: unknown };
  if (typeof text !== "string" || !Number.isInteger(cursor) || (cursor as number) < 0 || (cursor as number) > text.length) return undefined;
  return { text, cursor: cursor as number };
}

/** A well-formed ✦ AI snapshot, or undefined (then the passage alone is sent, as before). */
export function normalizeSelectionDocument(value: unknown): SelectionDocumentSnapshot | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { text, selectionFrom, selectionTo } = value as { text?: unknown; selectionFrom?: unknown; selectionTo?: unknown };
  if (
    typeof text !== "string" ||
    !Number.isInteger(selectionFrom) ||
    !Number.isInteger(selectionTo) ||
    (selectionFrom as number) < 0 ||
    (selectionTo as number) < (selectionFrom as number) ||
    (selectionTo as number) > text.length
  ) {
    return undefined;
  }
  return { text, selectionFrom: selectionFrom as number, selectionTo: selectionTo as number };
}
