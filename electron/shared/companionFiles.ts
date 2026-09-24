/**
 * Companion files (spec V9): `stem.notes.md` and `stem.comments.md` live next
 * to a document `stem.<markdown extension>`. A path is a companion by its name
 * shape alone, never by whether the document exists; that is what keeps them
 * out of outside-change review consistently. Pure string helpers: they work on
 * workspace-relative POSIX paths and on absolute paths alike.
 *
 * Shared by main (`electron/fs/companionFiles.ts`) and the renderer
 * (`src/files/companionFiles.ts`): files under `electron/shared/` have no
 * imports and are part of both TypeScript projects.
 */

export type CompanionKind = "notes" | "comments";

export const companionSuffixes: Record<CompanionKind, string> = {
  notes: ".notes.md",
  comments: ".comments.md"
};

const documentExtensions = [".md", ".markdown", ".mdown", ".mkd"];

function splitDirectory(filePath: string) {
  const index = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));

  return index >= 0
    ? { directory: filePath.slice(0, index + 1), name: filePath.slice(index + 1) }
    : { directory: "", name: filePath };
}

/** The companion kind of a path by name shape (`*.notes.md` / `*.comments.md`), or null. */
export function companionKindOf(filePath: string): CompanionKind | null {
  const { name } = splitDirectory(filePath);
  const lower = name.toLowerCase();

  for (const kind of ["notes", "comments"] as const) {
    const suffix = companionSuffixes[kind];

    // A bare ".notes.md" is a hidden file, not a companion of an empty stem.
    if (lower.endsWith(suffix) && lower.length > suffix.length) {
      return kind;
    }
  }

  return null;
}

export function isCompanionPath(filePath: string) {
  return companionKindOf(filePath) !== null;
}

function markdownExtensionOf(name: string) {
  const lower = name.toLowerCase();
  return documentExtensions.find((extension) => lower.endsWith(extension) && lower.length > extension.length) ?? null;
}

/** The stem of a Markdown document (`dir/name.md` → `name`), or null for non-Markdown or companion paths. */
export function documentStemOf(filePath: string) {
  if (isCompanionPath(filePath)) {
    return null;
  }

  const { name } = splitDirectory(filePath);
  const extension = markdownExtensionOf(name);

  return extension ? name.slice(0, name.length - extension.length) : null;
}

/**
 * The companion paths of a document (`dir/name.<any md ext>` →
 * `dir/name.notes.md`, `dir/name.comments.md`), or null when the path is not
 * a Markdown document or is itself companion-shaped (no companions of companions).
 */
export function companionPathsFor(documentPath: string): Record<CompanionKind, string> | null {
  const stem = documentStemOf(documentPath);

  if (stem === null) {
    return null;
  }

  const { directory } = splitDirectory(documentPath);

  return {
    notes: `${directory}${stem}${companionSuffixes.notes}`,
    comments: `${directory}${stem}${companionSuffixes.comments}`
  };
}

/** The stem a companion belongs to (`dir/name.notes.md` → `name`), or null. */
export function companionStemOf(filePath: string) {
  const kind = companionKindOf(filePath);

  if (!kind) {
    return null;
  }

  const { name } = splitDirectory(filePath);
  return name.slice(0, name.length - companionSuffixes[kind].length);
}

/** Candidate document names for a companion (same folder, same stem, any Markdown extension). */
export function documentNamesForCompanion(filePath: string) {
  const stem = companionStemOf(filePath);
  return stem === null ? [] : documentExtensions.map((extension) => `${stem}${extension}`);
}

export const companionNameMessage =
  "Names ending in .notes.md or .comments.md are reserved for a document's notes and comments.";
