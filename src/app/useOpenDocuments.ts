import { useCallback, useEffect, useRef, useState } from "react";
import { pathIsSameOrInside, relocatePath } from "../files/pathUtils";
import type { PathRelocation } from "../preferences/namingCandidates";
import type { FileTreeNode } from "../types/iliad";

export interface OpenDocument {
  id: string;
  path: string;
  name: string;
  relativePath: string;
}

export interface OpenDocumentsSession {
  paths: string[];
  activePath: string | null;
}

const markdownExtension = /\.(md|markdown|mdown|mkd)$/i;
const normalizePath = (path: string) => path.replace(/\\/g, "/");
const normalizeRoot = (path: string) => normalizePath(path).replace(/\/+$/, "") || "/";
let nextDocumentId = 0;
const newDocumentId = () => `document-${++nextDocumentId}`;

/** Strict relative paths only. These are metadata, never authority to open arbitrary paths. */
export function safeOpenDocumentPath(value: unknown): string | null {
  if (typeof value !== "string" || !value || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const path = normalizePath(value);
  if (path.startsWith("/") || /^[a-z]:/i.test(path) || path.includes(":")) return null;
  const parts = path.split("/");
  if (parts.some((part) => !part || part === "." || part === "..") || !markdownExtension.test(path)) return null;
  return path;
}

export function sanitizeOpenDocumentsSession(value: unknown): OpenDocumentsSession {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { paths: [], activePath: null };
  const candidate = value as Record<string, unknown>;
  const paths = Array.isArray(candidate.paths)
    ? [...new Set(candidate.paths.map(safeOpenDocumentPath).filter((path): path is string => path !== null))]
    : [];
  const activePath = safeOpenDocumentPath(candidate.activePath);
  return { paths, activePath: activePath && paths.includes(activePath) ? activePath : null };
}

export function openDocumentsStorageKey(workspacePath: string) {
  return `iliad:open-documents:${encodeURIComponent(normalizeRoot(workspacePath))}`;
}

export function readOpenDocumentsSession(workspacePath: string): OpenDocumentsSession {
  try {
    const raw = localStorage.getItem(openDocumentsStorageKey(workspacePath));
    return sanitizeOpenDocumentsSession(raw ? JSON.parse(raw) : null);
  } catch {
    return { paths: [], activePath: null };
  }
}

export function writeOpenDocumentsSession(workspacePath: string, session: OpenDocumentsSession) {
  try {
    localStorage.setItem(openDocumentsStorageKey(workspacePath), JSON.stringify(sanitizeOpenDocumentsSession(session)));
  } catch {
    // Local display metadata must not block writing or document navigation.
  }
}

function documentForNode(workspaceRoot: string, node: FileTreeNode, id?: string): OpenDocument | null {
  const relativePath = safeOpenDocumentPath(node.relativePath);
  const root = normalizeRoot(workspaceRoot);
  const path = normalizePath(node.path);
  const expectedPath = `${root === "/" ? "" : root}/${relativePath}`;
  if (node.kind !== "markdown" || !relativePath || path !== expectedPath) return null;
  return { id: id ?? newDocumentId(), path, name: node.name, relativePath };
}

/** Called only for successful opens. Existing entries retain both order and session identity. */
export function recordOpenDocument(documents: OpenDocument[], workspaceRoot: string, node: FileTreeNode): OpenDocument[] {
  const existing = documents.find((document) => document.path === normalizePath(node.path));
  const document = documentForNode(workspaceRoot, node, existing?.id);
  if (!document) return documents;
  if (!existing) return [...documents, document];
  if (existing.name === document.name && existing.relativePath === document.relativePath) return documents;
  return documents.map((entry) => entry.id === existing.id ? document : entry);
}

export function removeOpenDocument(documents: OpenDocument[], id: string) {
  return documents.filter((document) => document.id !== id);
}

export function openDocumentCloseNeighbor(documents: OpenDocument[], id: string): OpenDocument | null {
  const index = documents.findIndex((document) => document.id === id);
  return index < 0 ? null : documents[index + 1] ?? documents[index - 1] ?? null;
}

export function relocateOpenDocuments(documents: OpenDocument[], relocation: PathRelocation): OpenDocument[] {
  const oldPath = normalizePath(relocation.oldPath);
  const newPath = normalizePath(relocation.newPath);
  return documents.map((document) => {
    if (!pathIsSameOrInside(oldPath, document.path)) return document;
    const path = relocatePath(oldPath, newPath, document.path);
    const relativePath = relocatePath(normalizePath(relocation.oldRelativePath), normalizePath(relocation.newRelativePath), document.relativePath);
    return documentForNode(relocation.workspaceRoot, {
      kind: "markdown", path, relativePath, name: path.split("/").at(-1) ?? document.name
    }, document.id) ?? document;
  });
}

/** Resolve through the loaded tree, never by joining unchecked persisted input to a root. */
export function resolveOpenDocumentsSession(workspaceRoot: string, value: unknown, tree: FileTreeNode[]) {
  const session = sanitizeOpenDocumentsSession(value);
  const nodes = new Map<string, FileTreeNode>();
  const collect = (children: FileTreeNode[]) => {
    for (const node of children) {
      if (node.kind === "markdown" && documentForNode(workspaceRoot, node)) nodes.set(normalizePath(node.relativePath), node);
      if (node.children) collect(node.children);
    }
  };
  collect(tree);
  const documents = session.paths.flatMap((path) => {
    const node = nodes.get(path);
    const document = node ? documentForNode(workspaceRoot, node) : null;
    return document ? [document] : [];
  });
  const active = documents.find((document) => document.relativePath === session.activePath) ?? documents[0];
  return { documents, restoreTarget: active ? nodes.get(active.relativePath) ?? null : null };
}

/** Extensionless titles, adding only enough trailing parents to distinguish duplicate titles. */
export function openDocumentLabels(documents: OpenDocument[]): Map<string, string> {
  const titles = documents.map((document) => document.name.replace(markdownExtension, ""));
  const folders = documents.map((document) => document.relativePath.split("/").slice(0, -1));
  const labels = new Map<string, string>();
  documents.forEach((document, index) => {
    const duplicates = documents.map((_, candidate) => candidate).filter((candidate) => titles[candidate] === titles[index]);
    if (duplicates.length === 1) { labels.set(document.id, titles[index]); return; }
    const ownFolders = folders[index];
    let depth = 1;
    while (depth < ownFolders.length && duplicates.some((candidate) => candidate !== index &&
      folders[candidate].slice(-depth).join("/") === ownFolders.slice(-depth).join("/"))) depth += 1;
    let suffix = ownFolders.slice(-depth).join("/") || ".";
    // Different Markdown extensions can have the same title in the very same folder.
    if (duplicates.some((candidate) => candidate !== index && folders[candidate].join("/") === ownFolders.join("/"))) suffix = document.relativePath;
    labels.set(document.id, `${titles[index]} · ${suffix}`);
  });
  return labels;
}

export function tabCycleDirection(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "repeat" | "isComposing" | "defaultPrevented">): 1 | -1 | null {
  if (event.key !== "Tab" || !event.ctrlKey || event.metaKey || event.altKey || event.repeat || event.isComposing || event.defaultPrevented) return null;
  return event.shiftKey ? -1 : 1;
}

export function cycleOpenDocument(documents: OpenDocument[], activeId: string | null, direction: 1 | -1): OpenDocument | null {
  if (!documents.length) return null;
  const index = documents.findIndex((document) => document.id === activeId);
  if (index < 0) return direction === 1 ? documents[0] : documents[documents.length - 1];
  return documents[(index + direction + documents.length) % documents.length];
}

export interface OpenDocumentsState {
  root: string | null;
  documents: OpenDocument[];
  activeId: string | null;
  restoration: "waiting" | "pending" | "done";
  restoreTarget: FileTreeNode | null;
  savedSession: OpenDocumentsSession;
}

export function createOpenDocumentsState(root: string | null): OpenDocumentsState {
  root = root ? normalizeRoot(root) : null;
  return {
    root, documents: [], activeId: null, restoration: root ? "waiting" : "done", restoreTarget: null,
    savedSession: root ? readOpenDocumentsSession(root) : { paths: [], activePath: null }
  };
}

/** Successful explicit activation also supersedes any pending restored activation. */
export function recordOpenDocumentsState(current: OpenDocumentsState, workspaceRoot: string, node: FileTreeNode): OpenDocumentsState {
  if (!current.root || normalizeRoot(workspaceRoot) !== current.root || !documentForNode(current.root, node)) return current;
  const documents = recordOpenDocument(current.documents, current.root, node);
  const activeId = documents.find((document) => document.path === normalizePath(node.path))?.id ?? null;
  if (documents === current.documents && activeId === current.activeId && current.restoration === "done") return current;
  return { ...current, documents, activeId, restoration: "done", restoreTarget: null };
}

/** Initial pruning only; live tree deletion must leave open entries available for review. */
export function prepareOpenDocumentsRestore(state: OpenDocumentsState, tree: FileTreeNode[], treeReady: boolean): OpenDocumentsState {
  if (!state.root || !treeReady || state.restoration !== "waiting") return state;
  const resolved = resolveOpenDocumentsSession(state.root, state.savedSession, tree);
  return { ...state, ...resolved, restoration: resolved.restoreTarget ? "pending" : "done" };
}

function sessionForState(state: OpenDocumentsState): OpenDocumentsSession {
  if (state.restoration === "waiting") return state.savedSession;
  return {
    paths: state.documents.map((document) => document.relativePath),
    activePath: state.documents.find((document) => document.id === state.activeId)?.relativePath ??
      (state.restoration === "pending" ? state.restoreTarget?.relativePath ?? null : null)
  };
}

interface UseOpenDocumentsOptions {
  workspacePath: string | null;
  tree: FileTreeNode[];
  treeReady: boolean;
  activeFile: FileTreeNode | null;
}

export function useOpenDocuments({ workspacePath, tree, treeReady, activeFile }: UseOpenDocumentsOptions) {
  const root = workspacePath ? normalizeRoot(workspacePath) : null;
  const [state, setState] = useState(() => createOpenDocumentsState(root));
  const stateRef = useRef(state);
  const rootRef = useRef(root);
  rootRef.current = root;

  const currentState = useCallback(() => {
    if (stateRef.current.root !== rootRef.current) stateRef.current = createOpenDocumentsState(rootRef.current);
    return stateRef.current;
  }, []);

  const commit = useCallback((next: OpenDocumentsState, persist = true) => {
    stateRef.current = next;
    setState(next);
    if (persist && next.root) writeOpenDocumentsSession(next.root, sessionForState(next));
  }, []);

  const recordOpen = useCallback((workspaceRoot: string, node: FileTreeNode) => {
    const current = currentState();
    const next = recordOpenDocumentsState(current, workspaceRoot, node);
    if (next !== current) commit(next);
  }, [commit, currentState]);

  useEffect(() => {
    const current = currentState();
    const next = prepareOpenDocumentsRestore(current, tree, treeReady);
    if (next !== stateRef.current || current !== state) commit(next, next.restoration !== "waiting");
    // `state` deliberately does not drive this effect: restoration is once per root.
  }, [root, tree, treeReady, commit, currentState]);

  useEffect(() => {
    if (root && activeFile) recordOpen(root, activeFile);
    else {
      const current = currentState();
      if (!activeFile && current.activeId) commit({ ...current, activeId: null });
    }
  }, [root, activeFile?.path, activeFile?.name, activeFile?.relativePath, recordOpen, currentState, commit]);

  const remove = useCallback((id: string) => {
    const current = currentState();
    const removed = current.documents.find((document) => document.id === id);
    if (!removed) return;
    const removesRestoreTarget = current.restoreTarget && normalizePath(current.restoreTarget.path) === removed.path;
    commit({ ...current, documents: removeOpenDocument(current.documents, id),
      activeId: current.activeId === id ? null : current.activeId,
      restoreTarget: removesRestoreTarget ? null : current.restoreTarget,
      restoration: removesRestoreTarget ? "done" : current.restoration });
  }, [commit, currentState]);

  const relocate = useCallback((relocation: PathRelocation) => {
    const current = currentState();
    if (current.root !== normalizeRoot(relocation.workspaceRoot)) return;
    const documents = relocateOpenDocuments(current.documents, relocation);
    const restoreDocument = current.restoreTarget ? documents.find((document) => document.id ===
      current.documents.find((document) => document.path === normalizePath(current.restoreTarget!.path))?.id) : null;
    const relocateRelative = (path: string) => relocatePath(normalizePath(relocation.oldRelativePath), normalizePath(relocation.newRelativePath), path);
    const savedSession = sanitizeOpenDocumentsSession({
      paths: current.savedSession.paths.map(relocateRelative),
      activePath: current.savedSession.activePath ? relocateRelative(current.savedSession.activePath) : null
    });
    commit({ ...current, documents, savedSession, restoreTarget: restoreDocument ? { ...restoreDocument, kind: "markdown" } : current.restoreTarget });
  }, [commit, currentState]);

  const finishRestore = useCallback(() => {
    const current = currentState();
    commit({ ...current, restoration: "done", restoreTarget: null });
  }, [commit, currentState]);
  const closeNeighbor = useCallback((id: string) => openDocumentCloseNeighbor(currentState().documents, id), [currentState]);
  const getDocuments = useCallback((): readonly OpenDocument[] => currentState().documents, [currentState]);
  const visible = state.root === root ? state : null;
  return { documents: visible?.documents ?? [], activeId: visible?.activeId ?? null,
    restoreTarget: visible?.restoreTarget ?? null, recordOpen, remove, relocate, finishRestore, closeNeighbor, getDocuments };
}
