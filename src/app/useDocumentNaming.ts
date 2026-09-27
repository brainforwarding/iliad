import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import {
  detectFolderNamingStyle,
  documentStem,
  formatDocumentStem,
  planDocumentName,
  siblingDocumentNames
} from "../files/documentNaming";
import type { AutoRenameOutcome } from "../files/fileActions";
import { isNamingCandidate, namingCandidatesToDrop } from "../preferences/namingCandidates";
import { normalizeRecentPath } from "../preferences/recentDocuments";
import type { FileTreeNode, WorkspaceInfo } from "../types/iliad";
import { documentNamingApi } from "./documentNamingApi";
import { hashDocumentText, type SaveStatus } from "./useDocumentPersistence";

/**
 * Names untitled documents (spec 2026-09-27 "Name untitled documents"): for
 * the active document, when it is a naming candidate, wait for the first
 * ~2 s pause once it has enough text, then take the name from the writer's
 * heading or ask the AI, and rename it through main's guarded rename inside
 * the autosave fence. Nothing is shown on failure; success is shown only by
 * the name typing itself (the caller's `onNamed`).
 */

export const namingIdleDelayMs = 2000;
/** Dispatched attempts (AI calls, or guarded renames from a heading) per candidate per session. */
export const maxNamingAttempts = 2;

export interface NamingConditions {
  isCandidate: boolean;
  /** The editor shows the active file itself (not a virtual review file). */
  editorShowsActiveFile: boolean;
  saveStatus: SaveStatus;
  underReview: boolean;
  renaming: boolean;
  windowFocused: boolean;
}

/** The static conditions for a naming attempt (text and idle time are checked separately). */
export function namingConditionsMet(conditions: NamingConditions) {
  return (
    conditions.isCandidate &&
    conditions.editorShowsActiveFile &&
    conditions.saveStatus === "saved" &&
    !conditions.underReview &&
    !conditions.renaming &&
    conditions.windowFocused
  );
}

/** Whether another attempt may be dispatched for a candidate that already made `attempts`. */
export function namingAttemptAllowed(attempts: number) {
  return attempts < maxNamingAttempts;
}

/** A guarded-rename failure that means the document is no longer untouched by others: stop naming it. */
export function namingFailureDropsCandidate(reason: string) {
  return reason === "changed" || reason === "under_review";
}

/**
 * Forgets the attempt counts (keyed `root\0relativePath`) of paths in
 * `workspaceRoot` that are no longer naming candidates, so a new document
 * created at a reused path (⌘N makes `untitled.md` again once the previous
 * one was named) starts with a fresh budget.
 */
export function forgetNamingAttempts(attempts: Map<string, number>, workspaceRoot: string, candidates: string[]) {
  const prefix = `${workspaceRoot}\u0000`;

  for (const key of [...attempts.keys()]) {
    if (key.startsWith(prefix) && !isNamingCandidate(candidates, key.slice(prefix.length))) {
      attempts.delete(key);
    }
  }
}

interface DocumentStateRef {
  activeFile: FileTreeNode | null;
  documentText: string;
  savedText: string;
  workspace: WorkspaceInfo | null;
}

interface UseDocumentNamingOptions {
  workspace: WorkspaceInfo | null;
  activeFile: FileTreeNode | null;
  editorShowsActiveFile: boolean;
  documentText: string;
  saveStatus: SaveStatus;
  tree: FileTreeNode[];
  candidates: string[];
  /** Workspace-relative paths with a pending outside review. */
  reviewedRelativePaths: string[];
  renaming: boolean;
  language: "en" | "es";
  stateRef: MutableRefObject<DocumentStateRef>;
  isDocumentSettled: () => boolean;
  runWithAutosavePaused: <T>(operation: () => Promise<T>) => Promise<T>;
  autoRenameDocument: (node: FileTreeNode, stem: string, expectedHash: string) => Promise<AutoRenameOutcome>;
  dropCandidate: (workspaceRoot: string, relativePath: string) => void;
  onNamed: (node: FileTreeNode) => void;
}

interface Attempt {
  token: number;
  requestId: string | null;
}

function treeBelongsTo(tree: FileTreeNode[], workspaceRoot: string) {
  const root = workspaceRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  return tree.length > 0 && tree.every((node) => node.path.replace(/\\/g, "/").startsWith(`${root}/`));
}

function useWindowFocused() {
  const [focused, setFocused] = useState(() => (typeof document === "undefined" ? true : document.hasFocus()));

  useEffect(() => {
    const onFocus = () => setFocused(true);
    const onBlur = () => setFocused(false);

    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    setFocused(document.hasFocus());

    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  return focused;
}

export function useDocumentNaming(options: UseDocumentNamingOptions) {
  const {
    workspace,
    activeFile,
    editorShowsActiveFile,
    documentText,
    saveStatus,
    tree,
    candidates,
    reviewedRelativePaths,
    renaming,
    dropCandidate
  } = options;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const windowFocused = useWindowFocused();
  const attemptRef = useRef<Attempt | null>(null);
  const tokenRef = useRef(0);
  const attemptsRef = useRef(new Map<string, number>());
  const lastChangeAtRef = useRef(Date.now());
  const seenInTreeRef = useRef(new Set<string>());
  const firstReadyRootRef = useRef<string | null>(null);
  const workspaceRoot = workspace?.path ?? null;
  const activeRelativePath = activeFile?.kind === "markdown" ? normalizeRecentPath(activeFile.relativePath) : null;
  const isCandidate = Boolean(activeRelativePath && isNamingCandidate(candidates, activeRelativePath));
  const candidateKey = workspaceRoot && activeRelativePath && isCandidate ? `${workspaceRoot}\u0000${activeRelativePath}` : null;
  const underReview = Boolean(
    activeRelativePath &&
      reviewedRelativePaths.some(
        (relativePath) => (normalizeRecentPath(relativePath) ?? relativePath).toLowerCase() === activeRelativePath.toLowerCase()
      )
  );

  /** Cancels the attempt in progress: its late answers are dropped. */
  const invalidate = useCallback(() => {
    tokenRef.current += 1;
    const attempt = attemptRef.current;
    attemptRef.current = null;

    if (attempt?.requestId) {
      documentNamingApi()?.cancelSuggestDocumentName(attempt.requestId);
    }
  }, []);

  // Typing, a different (or relocated) candidate, a review, a rename field,
  // a workspace switch: whatever was in flight no longer applies.
  useEffect(() => {
    lastChangeAtRef.current = Date.now();
    invalidate();
  }, [documentText, invalidate]);

  useEffect(() => {
    invalidate();
  }, [candidateKey, invalidate, renaming, underReview, workspaceRoot]);

  useEffect(() => () => invalidate(), [invalidate]);

  // Attempts belong to one candidate, not to its path: ⌘N reuses
  // `untitled.md` once the previous one was named, and that new document
  // starts with a fresh budget. Forget the counts of paths that are no longer
  // candidates (named, renamed by hand, dropped).
  useEffect(() => {
    if (!workspaceRoot) {
      return;
    }

    forgetNamingAttempts(attemptsRef.current, workspaceRoot, candidates);
  }, [candidates, workspaceRoot]);

  // Drop candidates whose document vanished (after it was seen at least once,
  // so a tree read that predates the creation cannot drop a fresh one) or
  // that got an outside review.
  useEffect(() => {
    if (!workspaceRoot || candidates.length === 0) {
      return;
    }

    // A tree still loading (or another workspace's) says nothing about
    // vanished paths; reviews still apply.
    const treeReady = treeBelongsTo(tree, workspaceRoot);

    if (!treeReady && reviewedRelativePaths.length === 0) {
      return;
    }

    const seenKey = (candidate: string) => `${workspaceRoot}\u0000${candidate}`;

    // Candidates stored by an earlier session are judged by the first loaded
    // tree: one missing from it was deleted or renamed while Iliad was closed.
    if (treeReady && firstReadyRootRef.current !== workspaceRoot) {
      firstReadyRootRef.current = workspaceRoot;

      for (const candidate of candidates) {
        seenInTreeRef.current.add(seenKey(candidate));
      }
    }
    const seenInTree = new Set(candidates.filter((candidate) => seenInTreeRef.current.has(seenKey(candidate))));
    const { drop, present } = namingCandidatesToDrop(candidates, {
      tree: treeReady ? tree : null,
      seenInTree,
      reviewedRelativePaths
    });

    for (const candidate of present) {
      seenInTreeRef.current.add(seenKey(candidate));
    }

    for (const candidate of drop) {
      dropCandidate(workspaceRoot, candidate);
    }
  }, [candidates, dropCandidate, reviewedRelativePaths, tree, workspaceRoot]);

  // A conflict means the file changed outside Iliad: it is no longer untitled-by-Iliad.
  useEffect(() => {
    if (saveStatus === "conflict" && workspaceRoot && activeRelativePath && isCandidate) {
      dropCandidate(workspaceRoot, activeRelativePath);
    }
  }, [activeRelativePath, dropCandidate, isCandidate, saveStatus, workspaceRoot]);

  const conditionsMet = namingConditionsMet({
    isCandidate,
    editorShowsActiveFile,
    saveStatus,
    underReview,
    renaming,
    windowFocused
  });

  const attemptNaming = useCallback(async () => {
    const current = optionsRef.current;
    const state = current.stateRef.current;
    const node = current.activeFile;
    const root = current.workspace?.path;

    if (!node || node.kind !== "markdown" || !root || !current.isDocumentSettled()) {
      return;
    }

    if (state.activeFile?.path !== node.path || state.workspace?.path !== root) {
      return;
    }

    const relativePath = normalizeRecentPath(node.relativePath);

    if (!relativePath || !isNamingCandidate(current.candidates, relativePath)) {
      return;
    }

    const key = `${root}\u0000${relativePath}`;
    const attempts = attemptsRef.current.get(key) ?? 0;

    if (!namingAttemptAllowed(attempts)) {
      return;
    }

    const text = state.savedText;
    const plan = planDocumentName(text);

    if (!plan) {
      return;
    }

    invalidate();
    const token = tokenRef.current;
    const attempt: Attempt = { token, requestId: null };
    attemptRef.current = attempt;
    const live = () => tokenRef.current === token && attemptRef.current === attempt;
    let title: string;

    if (plan.source === "heading") {
      title = plan.title;
    } else {
      const api = documentNamingApi();

      if (!api) {
        return;
      }

      attemptsRef.current.set(key, attempts + 1);
      const requestId = `name-${token}-${Date.now().toString(36)}`;
      attempt.requestId = requestId;
      const result = await api
        .suggestDocumentName({ requestId, language: current.language, text: plan.text })
        .catch(() => null);
      attempt.requestId = null;

      if (!live() || !result?.ok) {
        return;
      }

      title = result.title;
    }

    const siblings = siblingDocumentNames(optionsRef.current.tree, root, node.path);
    const stem = formatDocumentStem(title, detectFolderNamingStyle(siblings));

    if (!stem) {
      return;
    }

    if (stem.toLowerCase() === documentStem(node.name).toLowerCase()) {
      // It already has that name: nothing to rename, and nothing left to name.
      current.dropCandidate(root, relativePath);
      return;
    }

    if (plan.source === "heading") {
      attemptsRef.current.set(key, attempts + 1);
    }

    const outcome = await current.runWithAutosavePaused(async () => {
      const latest = optionsRef.current.stateRef.current;

      if (
        !live() ||
        latest.activeFile?.path !== node.path ||
        latest.documentText !== text ||
        latest.savedText !== text
      ) {
        return null;
      }

      const expectedHash = await hashDocumentText(text);

      if (!live()) {
        return null;
      }

      return optionsRef.current.autoRenameDocument(node, stem, expectedHash);
    });

    if (attemptRef.current === attempt) {
      attemptRef.current = null;
    }

    if (!outcome) {
      return;
    }

    if (outcome.ok) {
      // Named: this candidate is consumed, and its old path may be reused by the next ⌘N.
      attemptsRef.current.delete(key);
      optionsRef.current.onNamed(outcome.node);
      return;
    }

    if (namingFailureDropsCandidate(outcome.reason)) {
      optionsRef.current.dropCandidate(root, relativePath);
    }
  }, [invalidate]);

  // The first pause: ~2 s after the last change, once saved.
  useEffect(() => {
    if (!conditionsMet || !planDocumentName(documentText)) {
      return;
    }

    const delay = Math.max(0, lastChangeAtRef.current + namingIdleDelayMs - Date.now());
    const timer = window.setTimeout(() => {
      void attemptNaming().catch(() => undefined);
    }, delay);

    return () => window.clearTimeout(timer);
  }, [attemptNaming, conditionsMet, documentText]);
}
