import { useCallback, useEffect, useMemo, useState } from "react";
import { isCompanionPath } from "../files/companionFiles";
import type { FileTreeNode } from "../types/iliad";

/**
 * Recent documents per workspace (a display preference, spec 2026-09-27
 * stage 6). A map in localStorage keyed by the workspace root, each value the
 * last opened Markdown documents as normalized workspace-relative paths, most
 * recent first. Never written into the workspace.
 */
export const recentDocumentsStorageKey = "iliad:recent-documents";
export const maxStoredRecentDocuments = 10;
export const maxShownRecentDocuments = 5;

export interface RecentDocumentEntry {
  relativePath: string;
  /** ISO date of the last successful open. */
  openedAt: string;
}

export type RecentDocumentsMap = Record<string, RecentDocumentEntry[]>;

export interface RecentDocumentItem {
  relativePath: string;
  /** File name without its Markdown extension. */
  name: string;
  /** Workspace-relative folder ("" at the root). */
  folder: string;
  /** Today / Yesterday / weekday / short date, in the app language. */
  dayLabel: string;
  openedAt: string;
}

export interface RecentDayLabels {
  today: string;
  yesterday: string;
}

const markdownExtension = /\.(md|markdown|mdown|mkd)$/i;

/** POSIX, no leading "./" or "/", no empty/"."/".." segments; null when unusable. */
export function normalizeRecentPath(relativePath: string): string | null {
  if (typeof relativePath !== "string") {
    return null;
  }

  const segments = relativePath.replace(/\\/g, "/").split("/").filter((segment) => segment && segment !== ".");

  if (segments.length === 0 || segments.includes("..")) {
    return null;
  }

  return segments.join("/");
}

/** A real Markdown document: Markdown extension and not a comments companion. */
export function isRecordableDocumentPath(relativePath: string) {
  const normalized = normalizeRecentPath(relativePath);

  return Boolean(normalized && markdownExtension.test(normalized) && !isCompanionPath(normalized));
}

function isEntry(value: unknown): value is RecentDocumentEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as RecentDocumentEntry).relativePath === "string" &&
    typeof (value as RecentDocumentEntry).openedAt === "string"
  );
}

/** Keeps valid, recordable, de-duplicated entries (first wins), capped. */
export function sanitizeRecentDocuments(entries: unknown): RecentDocumentEntry[] {
  if (!Array.isArray(entries)) {
    return [];
  }

  const seen = new Set<string>();
  const result: RecentDocumentEntry[] = [];

  for (const entry of entries) {
    if (!isEntry(entry) || !isRecordableDocumentPath(entry.relativePath)) {
      continue;
    }

    const relativePath = normalizeRecentPath(entry.relativePath) as string;

    if (seen.has(relativePath)) {
      continue;
    }

    seen.add(relativePath);
    result.push({ relativePath, openedAt: entry.openedAt });

    if (result.length >= maxStoredRecentDocuments) {
      break;
    }
  }

  return result;
}

/** Moves (or adds) the document to the front; ignores non-recordable paths. */
export function recordRecentDocument(
  entries: RecentDocumentEntry[],
  relativePath: string,
  now: Date = new Date()
): RecentDocumentEntry[] {
  if (!isRecordableDocumentPath(relativePath)) {
    return entries;
  }

  const normalized = normalizeRecentPath(relativePath) as string;

  return sanitizeRecentDocuments([
    { relativePath: normalized, openedAt: now.toISOString() },
    ...entries.filter((entry) => normalizeRecentPath(entry.relativePath) !== normalized)
  ]);
}

/**
 * A rename or move of `oldPath` (a file or a folder) to `newPath`: entries at
 * or inside it follow. An entry that stops being a document is dropped; if the
 * new path collides with an existing entry, the more recent one wins.
 */
export function relocateRecentDocuments(
  entries: RecentDocumentEntry[],
  oldPath: string,
  newPath: string
): RecentDocumentEntry[] {
  const oldRoot = normalizeRecentPath(oldPath);
  const newRoot = normalizeRecentPath(newPath);

  if (!oldRoot || !newRoot || oldRoot === newRoot) {
    return entries;
  }

  const relocated = entries.map((entry) => {
    const current = normalizeRecentPath(entry.relativePath) ?? entry.relativePath;

    if (current === oldRoot) {
      return { ...entry, relativePath: newRoot };
    }

    if (current.startsWith(`${oldRoot}/`)) {
      return { ...entry, relativePath: `${newRoot}/${current.slice(oldRoot.length + 1)}` };
    }

    return entry;
  });

  // Keep most-recent-first order; sanitize drops the older duplicate.
  const ordered = [...relocated].sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt));

  return sanitizeRecentDocuments(ordered);
}

function collectDocumentPaths(nodes: FileTreeNode[], into: Set<string>) {
  for (const node of nodes) {
    if (node.kind === "markdown") {
      const normalized = normalizeRecentPath(node.relativePath);

      if (normalized) {
        into.add(normalized);
      }
    }

    if (node.children) {
      collectDocumentPaths(node.children, into);
    }
  }

  return into;
}

/** Entries whose document still exists in the tree (stale ones are skipped, not deleted). */
export function filterExistingRecentDocuments(entries: RecentDocumentEntry[], tree: FileTreeNode[]) {
  const existing = collectDocumentPaths(tree, new Set());

  return entries.filter((entry) => {
    const normalized = normalizeRecentPath(entry.relativePath);
    return Boolean(normalized && existing.has(normalized) && isRecordableDocumentPath(normalized));
  });
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function capitalize(text: string, language: string) {
  return text ? text.charAt(0).toLocaleUpperCase(language) + text.slice(1) : text;
}

/** Today / Yesterday / weekday (within the last week) / short date (with the year when it differs). */
export function recentDayLabel(openedAt: string, now: Date, language: "en" | "es", labels: RecentDayLabels) {
  const opened = new Date(openedAt);

  if (Number.isNaN(opened.getTime())) {
    return "";
  }

  const days = Math.round((startOfDay(now) - startOfDay(opened)) / 86_400_000);

  if (days <= 0) {
    return labels.today;
  }

  if (days === 1) {
    return labels.yesterday;
  }

  if (days < 7) {
    return capitalize(new Intl.DateTimeFormat(language, { weekday: "long" }).format(opened), language);
  }

  const options: Intl.DateTimeFormatOptions =
    opened.getFullYear() === now.getFullYear()
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" };

  return new Intl.DateTimeFormat(language, options).format(opened);
}

/** The rows the empty state shows: existing documents only, capped at five. */
export function recentDocumentItems(
  entries: RecentDocumentEntry[],
  tree: FileTreeNode[],
  now: Date,
  language: "en" | "es",
  labels: RecentDayLabels,
  limit = maxShownRecentDocuments
): RecentDocumentItem[] {
  return filterExistingRecentDocuments(entries, tree)
    .slice(0, limit)
    .map((entry) => {
      const relativePath = normalizeRecentPath(entry.relativePath) as string;
      const slash = relativePath.lastIndexOf("/");
      const fileName = slash >= 0 ? relativePath.slice(slash + 1) : relativePath;

      return {
        relativePath,
        name: fileName.replace(markdownExtension, "") || fileName,
        folder: slash >= 0 ? relativePath.slice(0, slash) : "",
        dayLabel: recentDayLabel(entry.openedAt, now, language, labels),
        openedAt: entry.openedAt
      };
    });
}

export function readRecentDocumentsMap(): RecentDocumentsMap {
  try {
    const raw = localStorage.getItem(recentDocumentsStorageKey);
    const parsed: unknown = raw ? JSON.parse(raw) : null;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const map: RecentDocumentsMap = {};

    for (const [root, entries] of Object.entries(parsed as Record<string, unknown>)) {
      const sanitized = sanitizeRecentDocuments(entries);

      if (root && sanitized.length > 0) {
        map[root] = sanitized;
      }
    }

    return map;
  } catch {
    return {};
  }
}

export function readRecentDocuments(workspaceRoot: string): RecentDocumentEntry[] {
  return readRecentDocumentsMap()[workspaceRoot] ?? [];
}

/** Replaces one workspace's list (re-reading the map so other windows' workspaces survive). */
export function writeRecentDocuments(workspaceRoot: string, entries: RecentDocumentEntry[]) {
  try {
    const map = readRecentDocumentsMap();

    if (entries.length > 0) {
      map[workspaceRoot] = sanitizeRecentDocuments(entries);
    } else {
      delete map[workspaceRoot];
    }

    localStorage.setItem(recentDocumentsStorageKey, JSON.stringify(map));
  } catch {
    // Storage can be unavailable; recents are only a convenience.
  }
}

/**
 * The current workspace's recents. `record` is called after a document
 * really opened; `relocate` after a rename or move. Each update re-reads
 * storage so another window's writes to the same workspace are not lost.
 */
export function useRecentDocuments(workspaceRoot: string | null) {
  const [entries, setEntries] = useState<RecentDocumentEntry[]>(() =>
    workspaceRoot ? readRecentDocuments(workspaceRoot) : []
  );

  useEffect(() => {
    setEntries(workspaceRoot ? readRecentDocuments(workspaceRoot) : []);
  }, [workspaceRoot]);

  const update = useCallback(
    (root: string, change: (current: RecentDocumentEntry[]) => RecentDocumentEntry[]) => {
      const next = change(readRecentDocuments(root));
      writeRecentDocuments(root, next);

      if (root === workspaceRoot) {
        setEntries(next);
      }
    },
    [workspaceRoot]
  );

  const recordRecent = useCallback(
    (root: string, relativePath: string) => {
      if (isRecordableDocumentPath(relativePath)) {
        update(root, (current) => recordRecentDocument(current, relativePath));
      }
    },
    [update]
  );

  const relocateRecent = useCallback(
    (root: string, oldRelativePath: string, newRelativePath: string) => {
      update(root, (current) => relocateRecentDocuments(current, oldRelativePath, newRelativePath));
    },
    [update]
  );

  return useMemo(() => ({ recentEntries: entries, recordRecent, relocateRecent }), [entries, recordRecent, relocateRecent]);
}
