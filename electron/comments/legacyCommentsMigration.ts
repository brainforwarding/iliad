import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { hashMarkdown } from "../review/hash.js";
import type { WorkspaceBaselineService } from "../review/workspaceBaseline.js";
import { companionPathsFor } from "../shared/companionFiles.js";
import {
  countQuoteOccurrences,
  parseCommentsFile,
  serializeCommentsFile,
  type CommentsFileEntry
} from "../shared/commentsFile.js";

/**
 * One pending comment as the old app-data store kept it
 * (`userData/assistant/selection-comments.json`). Only read now, to move
 * comments into `stem.comments.md` companion files (spec V19).
 */
export interface LegacySelectionComment {
  id: string;
  workspacePath: string;
  documentRelativePath: string;
  quote: string;
  occurrence?: number;
  prefix?: string;
  comment: string;
  status?: string;
}

export type CompanionWriteExpectation = { kind: "absent" } | { kind: "hash"; hash: string };

export interface LegacyMigrationIo {
  /** Compare-and-swap write of a companion (the baseline service's guarded write). */
  writeCompanion: (
    absolutePath: string,
    content: string,
    expected: CompanionWriteExpectation
  ) => Promise<{ status: "written" } | { status: "conflict"; reason: string }>;
  hash: (content: string) => string;
}

export function legacyCommentsStorePath(userDataPath: string) {
  return path.join(userDataPath, "assistant", "selection-comments.json");
}

function isLegacyComment(candidate: unknown): candidate is LegacySelectionComment {
  if (!candidate || typeof candidate !== "object") {
    return false;
  }

  const value = candidate as Record<string, unknown>;

  return (
    typeof value.id === "string" &&
    typeof value.workspacePath === "string" &&
    typeof value.documentRelativePath === "string" &&
    typeof value.quote === "string" &&
    typeof value.comment === "string" &&
    (value.status === undefined || value.status === "pending")
  );
}

/** Reads the legacy store: null when there is none, [] when it cannot be parsed. */
export async function readLegacySelectionComments(userDataPath: string): Promise<unknown[] | null> {
  try {
    const parsed = JSON.parse(await readFile(legacyCommentsStorePath(userDataPath), "utf8")) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    if (error instanceof SyntaxError) {
      return [];
    }

    throw error;
  }
}

async function writeLegacySelectionComments(userDataPath: string, rows: unknown[]) {
  const storePath = legacyCommentsStorePath(userDataPath);

  if (rows.length === 0) {
    await rm(storePath, { force: true });
    return;
  }

  await mkdir(path.dirname(storePath), { recursive: true });
  const tempPath = `${storePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
  await rename(tempPath, storePath);
}

async function isRegularFile(filePath: string) {
  try {
    const stats = await lstat(filePath);
    return stats.isFile() && !stats.isSymbolicLink();
  } catch {
    return false;
  }
}

function normalizeDocumentRelativePath(relativePath: string) {
  const normalized = relativePath.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\.?\//, "").trim();
  const segments = normalized.split("/");

  if (!normalized || segments.some((segment) => !segment || segment === "." || segment === ".." || segment.startsWith("."))) {
    return null;
  }

  return normalized;
}

function entryFor(comment: LegacySelectionComment, documentText: string): CommentsFileEntry {
  const entry: CommentsFileEntry = { id: comment.id, quote: comment.quote, comment: comment.comment };

  if (countQuoteOccurrences(documentText, comment.quote) > 1) {
    entry.occurrence = comment.occurrence && comment.occurrence > 0 ? comment.occurrence : 1;
    entry.prefix = comment.prefix ?? "";
  }

  return entry;
}

async function migrateDocument(
  documentPath: string,
  comments: LegacySelectionComment[],
  io: LegacyMigrationIo
): Promise<string | null> {
  const companionPath = companionPathsFor(documentPath)?.comments;

  if (!companionPath) {
    return null;
  }

  const documentText = await readFile(documentPath, "utf8");

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let existingText: string | null = null;

    try {
      existingText = await readFile(companionPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }

    // Merge by id: entries already in the file win.
    const existing = existingText === null ? [] : parseCommentsFile(existingText);
    const known = new Set(existing.map((entry) => entry.id));
    const added = comments.filter((comment) => !known.has(comment.id)).map((comment) => entryFor(comment, documentText));

    if (added.length === 0) {
      return companionPath;
    }

    const result = await io.writeCompanion(
      companionPath,
      serializeCommentsFile([...existing, ...added]),
      existingText === null ? { kind: "absent" } : { kind: "hash", hash: io.hash(existingText) }
    );

    if (result.status === "written") {
      return companionPath;
    }
  }

  throw new Error("The comments file kept changing during migration.");
}

let migrationQueue: Promise<unknown> = Promise.resolve();

/**
 * Moves one workspace's legacy comments into companion files (spec V19):
 * merged by id into an existing file, skipped (and kept in the store) when
 * the document no longer exists or the write fails. The store is rewritten
 * without the migrated entries and removed when empty. Returns the companion
 * paths that were written.
 */
export function migrateLegacyCommentsForWorkspace(
  userDataPath: string,
  workspaceRoot: string,
  io: LegacyMigrationIo
): Promise<string[]> {
  const run = migrationQueue.then(() => migrateNow(userDataPath, workspaceRoot, io));
  migrationQueue = run.catch(() => undefined);
  return run;
}

async function migrateNow(userDataPath: string, workspaceRoot: string, io: LegacyMigrationIo): Promise<string[]> {
  const rows = await readLegacySelectionComments(userDataPath);

  if (rows === null) {
    return [];
  }

  const root = path.resolve(workspaceRoot);
  const byDocument = new Map<string, LegacySelectionComment[]>();
  const migratedRows = new Set<unknown>();
  const invalidRows = new Set<unknown>();

  for (const row of rows) {
    if (!isLegacyComment(row)) {
      // Sent/discarded or malformed rows were never shown; drop them.
      invalidRows.add(row);
      continue;
    }

    if (path.resolve(row.workspacePath) !== root) {
      continue;
    }

    const relativePath = normalizeDocumentRelativePath(row.documentRelativePath);

    if (!relativePath) {
      invalidRows.add(row);
      continue;
    }

    const list = byDocument.get(relativePath) ?? [];
    list.push(row);
    byDocument.set(relativePath, list);
  }

  const written: string[] = [];

  for (const [relativePath, comments] of byDocument) {
    const documentPath = path.join(root, relativePath);

    if (!(await isRegularFile(documentPath))) {
      continue;
    }

    try {
      const companionPath = await migrateDocument(documentPath, comments, io);

      if (companionPath) {
        written.push(companionPath);
        comments.forEach((comment) => migratedRows.add(comment));
      }
    } catch {
      // Left in the store; the next attach tries again.
    }
  }

  if (migratedRows.size > 0 || invalidRows.size > 0) {
    await writeLegacySelectionComments(
      userDataPath,
      rows.filter((row) => !migratedRows.has(row) && !invalidRows.has(row))
    );
  }

  return written;
}

/** The attach hook main wires into the workspace IPC: migration through the guarded companion write. */
export function legacyCommentsAttachHook(
  userDataPath: string,
  baseline: Pick<WorkspaceBaselineService, "writeMarkdownIfUnchanged">
) {
  return (workspaceRoot: string) =>
    migrateLegacyCommentsForWorkspace(userDataPath, workspaceRoot, {
      hash: hashMarkdown,
      writeCompanion: (absolutePath, content, expected) =>
        baseline.writeMarkdownIfUnchanged(workspaceRoot, {
          relativePath: path.relative(workspaceRoot, absolutePath).split(path.sep).join("/"),
          content,
          expected
        })
    });
}
