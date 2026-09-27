import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isRecordableDocumentPath, normalizeRecentPath } from "./recentDocuments";
import type { FileTreeNode } from "../types/iliad";

/**
 * Naming candidates per workspace (spec 2026-09-27 "Name untitled
 * documents"): documents Iliad created that the writer has not named yet. A
 * local display preference — a map in localStorage keyed by the workspace
 * root, each value workspace-relative POSIX paths. Never written into the
 * workspace, never matched by name: only the exact path creation returned,
 * relocated by successful in-app renames and moves.
 */
export const namingCandidatesStorageKey = "iliad:naming-candidates";
export const maxNamingCandidates = 50;

export type NamingCandidatesMap = Record<string, string[]>;

/**
 * Why a path moved, for the one shared relocation callback (fileActions):
 * a manual rename names the document (drops it), a move keeps it a
 * candidate, an auto-rename consumes it.
 */
export type PathRelocationReason = "manual-rename" | "move" | "auto-rename";

export interface PathRelocation {
  workspaceRoot: string;
  oldPath: string;
  newPath: string;
  oldRelativePath: string;
  newRelativePath: string;
  reason: PathRelocationReason;
}

/** Valid, recordable, de-duplicated, capped (most recent last). */
export function sanitizeNamingCandidates(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const result: string[] = [];

  for (const entry of value) {
    if (typeof entry !== "string" || !isRecordableDocumentPath(entry)) {
      continue;
    }

    const normalized = normalizeRecentPath(entry) as string;

    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }

  return result.slice(-maxNamingCandidates);
}

export function recordNamingCandidate(candidates: string[], relativePath: string) {
  if (!isRecordableDocumentPath(relativePath)) {
    return candidates;
  }

  return sanitizeNamingCandidates([...candidates, normalizeRecentPath(relativePath)]);
}

export function dropNamingCandidate(candidates: string[], relativePath: string) {
  const normalized = normalizeRecentPath(relativePath);
  return normalized ? candidates.filter((candidate) => candidate !== normalized) : candidates;
}

export function isNamingCandidate(candidates: string[], relativePath: string | null | undefined) {
  const normalized = relativePath ? normalizeRecentPath(relativePath) : null;
  return Boolean(normalized && candidates.includes(normalized));
}

/**
 * A successful in-app rename or move of `oldPath` (a document or a folder).
 * The exact document: a manual rename or an auto-rename drops it (the
 * document is named), a move relocates it. Documents inside a renamed or
 * moved folder always follow.
 */
export function relocateNamingCandidates(
  candidates: string[],
  oldPath: string,
  newPath: string,
  reason: PathRelocationReason
) {
  const oldRoot = normalizeRecentPath(oldPath);
  const newRoot = normalizeRecentPath(newPath);

  if (!oldRoot || !newRoot) {
    return candidates;
  }

  const next: string[] = [];

  for (const candidate of candidates) {
    if (candidate === oldRoot) {
      if (reason === "move" && oldRoot !== newRoot) {
        next.push(newRoot);
      }
      continue;
    }

    next.push(candidate.startsWith(`${oldRoot}/`) ? `${newRoot}/${candidate.slice(oldRoot.length + 1)}` : candidate);
  }

  return sanitizeNamingCandidates(next);
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

/**
 * Which candidates to drop: those with an outside review, and those whose
 * document vanished from the tree — only once it was seen there (so a tree
 * read that predates the creation cannot drop a fresh one). `tree` is null
 * while the workspace's tree is not loaded; then only reviews apply.
 * `present` are the candidates the tree shows (to remember as seen).
 */
export function namingCandidatesToDrop(
  candidates: string[],
  options: { tree: FileTreeNode[] | null; seenInTree: ReadonlySet<string>; reviewedRelativePaths: string[] }
) {
  const existing = options.tree ? collectDocumentPaths(options.tree, new Set()) : null;
  const reviewed = new Set(
    options.reviewedRelativePaths.map((relativePath) => (normalizeRecentPath(relativePath) ?? relativePath).toLowerCase())
  );
  const present = existing ? candidates.filter((candidate) => existing.has(candidate)) : [];
  const drop = candidates.filter(
    (candidate) =>
      reviewed.has(candidate.toLowerCase()) ||
      (existing !== null && !existing.has(candidate) && options.seenInTree.has(candidate))
  );

  return { drop, present };
}

const emptyCandidates: string[] = [];

function sameList(a: string[], b: string[]) {
  return a.length === b.length && a.every((entry, index) => entry === b[index]);
}

export function readNamingCandidatesMap(): NamingCandidatesMap {
  try {
    const raw = localStorage.getItem(namingCandidatesStorageKey);
    const parsed: unknown = raw ? JSON.parse(raw) : null;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const map: NamingCandidatesMap = {};

    for (const [root, entries] of Object.entries(parsed as Record<string, unknown>)) {
      const sanitized = sanitizeNamingCandidates(entries);

      if (root && sanitized.length > 0) {
        map[root] = sanitized;
      }
    }

    return map;
  } catch {
    return {};
  }
}

export function readNamingCandidates(workspaceRoot: string) {
  return readNamingCandidatesMap()[workspaceRoot] ?? [];
}

/** Replaces one workspace's list (re-reading the map so other windows' workspaces survive). */
export function writeNamingCandidates(workspaceRoot: string, candidates: string[]) {
  try {
    const map = readNamingCandidatesMap();

    if (candidates.length > 0) {
      map[workspaceRoot] = sanitizeNamingCandidates(candidates);
    } else {
      delete map[workspaceRoot];
    }

    localStorage.setItem(namingCandidatesStorageKey, JSON.stringify(map));
  } catch {
    // Storage can be unavailable; naming is only a convenience.
  }
}

/**
 * The current workspace's candidates. Every update re-reads storage (another
 * window may share the workspace), so relocations from any window are kept.
 */
export function useNamingCandidates(workspaceRoot: string | null) {
  // The list and the root it belongs to change together, so a render between
  // a workspace switch and the re-read never pairs one root with another's list.
  const [state, setState] = useState<{ root: string | null; candidates: string[] }>(() => ({
    root: workspaceRoot,
    candidates: workspaceRoot ? readNamingCandidates(workspaceRoot) : []
  }));
  const stateRef = useRef(state);

  useEffect(() => {
    const next = { root: workspaceRoot, candidates: workspaceRoot ? readNamingCandidates(workspaceRoot) : [] };
    stateRef.current = next;
    setState(next);
  }, [workspaceRoot]);

  const update = useCallback(
    (root: string, change: (current: string[]) => string[]) => {
      const current = readNamingCandidates(root);
      const next = change(current);

      if (!sameList(current, next)) {
        writeNamingCandidates(root, next);
      }

      if (root === workspaceRoot && !sameList(stateRef.current.candidates, next)) {
        stateRef.current = { root, candidates: next };
        setState(stateRef.current);
      }
    },
    [workspaceRoot]
  );

  const recordCandidate = useCallback(
    (root: string, relativePath: string) => update(root, (current) => recordNamingCandidate(current, relativePath)),
    [update]
  );
  const dropCandidate = useCallback(
    (root: string, relativePath: string) => update(root, (current) => dropNamingCandidate(current, relativePath)),
    [update]
  );
  const relocateCandidates = useCallback(
    (relocation: PathRelocation) =>
      update(relocation.workspaceRoot, (current) =>
        relocateNamingCandidates(current, relocation.oldRelativePath, relocation.newRelativePath, relocation.reason)
      ),
    [update]
  );

  const candidates = state.root === workspaceRoot ? state.candidates : emptyCandidates;

  return useMemo(
    () => ({ candidates, dropCandidate, recordCandidate, relocateCandidates }),
    [candidates, dropCandidate, recordCandidate, relocateCandidates]
  );
}
