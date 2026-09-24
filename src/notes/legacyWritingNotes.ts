import { writingGuidanceStorageKey } from "../editor/ideaAutocomplete/options";
import type { WriteMarkdownResult } from "../types/iliad";

/**
 * Before notes were a companion file, each document's writing notes lived in
 * localStorage as `{enabled, voice, facts}`. The first time the document is
 * opened they move into `stem.notes.md` (only if that file does not exist yet:
 * the voice line, then the facts), and the key is removed.
 */
export function legacyNotesText(raw: unknown): string {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const voice = typeof value.voice === "string" ? value.voice.trim() : "";
  const facts = typeof value.facts === "string" ? value.facts.trim() : "";
  const text = [voice, facts].filter(Boolean).join("\n\n");

  return text ? `${text}\n` : "";
}

interface LegacyNotesStorage {
  getItem: (key: string) => string | null;
  removeItem: (key: string) => void;
}

export async function migrateLegacyWritingNotes({
  storage,
  workspacePath,
  documentRelativePath,
  writeIfAbsent
}: {
  storage: LegacyNotesStorage;
  workspacePath: string;
  documentRelativePath: string;
  /** Exclusive create of the notes file; `disk_changed` means it already exists. */
  writeIfAbsent: (content: string) => Promise<WriteMarkdownResult>;
}): Promise<"none" | "written" | "kept-existing"> {
  const key = writingGuidanceStorageKey(workspacePath, documentRelativePath);
  let raw: string | null;

  try {
    raw = storage.getItem(key);
  } catch {
    return "none";
  }

  if (raw === null) {
    return "none";
  }

  let parsed: unknown = null;

  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }

  const text = legacyNotesText(parsed);

  if (!text) {
    storage.removeItem(key);
    return "none";
  }

  const result = await writeIfAbsent(text);

  if (result.status === "written") {
    storage.removeItem(key);
    return "written";
  }

  if (result.reason === "disk_changed") {
    // A notes file already exists: it wins; the old notes are not merged in.
    storage.removeItem(key);
    return "kept-existing";
  }

  return "none";
}
