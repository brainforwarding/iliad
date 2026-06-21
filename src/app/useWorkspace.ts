import { useCallback, useEffect, useRef, useState } from "react";
import type { FileTreeNode, WorkspaceChangeEvent, WorkspaceInfo } from "../types/iliad";

interface PersistedWorkspace {
  name: string;
  path: string;
}

interface UseWorkspaceOptions {
  messages: {
    launchWorkspaceFallback: string;
    missingWorkspace: string;
    readWorkspaceFallback: string;
    recentMissing: string;
  };
  onError: (message: string) => void;
}

const workspaceStorageKey = "iliad:last-workspace";
const recentWorkspacesStorageKey = "iliad:recent-workspaces";
const recentWorkspacesCap = 6;

function recentKey(path: string) {
  // Case-insensitive on macOS/Windows; harmless on case-sensitive volumes.
  return path.toLowerCase();
}

/** Most-recent-first, deduped by canonical path, capped. Pure for testing. */
export function mergeRecentWorkspaces(
  list: WorkspaceInfo[],
  next: WorkspaceInfo,
  cap = recentWorkspacesCap
): WorkspaceInfo[] {
  const key = recentKey(next.path);
  return [next, ...list.filter((item) => recentKey(item.path) !== key)].slice(0, cap);
}

export function readRecentWorkspaces(): WorkspaceInfo[] {
  try {
    const raw = localStorage.getItem(recentWorkspacesStorageKey);
    const parsed = raw ? (JSON.parse(raw) as WorkspaceInfo[]) : [];
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.path === "string") : [];
  } catch {
    return [];
  }
}

function persistRecentWorkspaces(list: WorkspaceInfo[]) {
  localStorage.setItem(recentWorkspacesStorageKey, JSON.stringify(list));
}

export function readPersistedWorkspace(): WorkspaceInfo | null {
  try {
    const raw = localStorage.getItem(workspaceStorageKey);

    return raw ? (JSON.parse(raw) as PersistedWorkspace) : null;
  } catch {
    return null;
  }
}

export function persistWorkspace(workspace: WorkspaceInfo | null) {
  if (!workspace) {
    localStorage.removeItem(workspaceStorageKey);
    return;
  }

  localStorage.setItem(workspaceStorageKey, JSON.stringify({ name: workspace.name, path: workspace.path }));
}

export function useWorkspace({ messages, onError }: UseWorkspaceOptions) {
  const messagesRef = useRef(messages);
  const currentWorkspacePathRef = useRef<string | null>(null);
  const refreshRequestRef = useRef(0);
  const [workspace, setWorkspaceState] = useState<WorkspaceInfo | null>(null);
  const [tree, setTree] = useState<FileTreeNode[]>([]);
  const [lastWorkspaceChange, setLastWorkspaceChange] = useState<WorkspaceChangeEvent | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [recentWorkspaces, setRecentWorkspaces] = useState<WorkspaceInfo[]>(() => readRecentWorkspaces());

  const rememberRecentWorkspace = useCallback((next: WorkspaceInfo) => {
    setRecentWorkspaces((list) => {
      const merged = mergeRecentWorkspaces(list, { name: next.name, path: next.path });
      persistRecentWorkspaces(merged);
      return merged;
    });
  }, []);

  const pruneRecentWorkspace = useCallback((path: string) => {
    setRecentWorkspaces((list) => {
      const merged = list.filter((item) => recentKey(item.path) !== recentKey(path));
      persistRecentWorkspaces(merged);
      return merged;
    });
  }, []);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const setWorkspace = useCallback((nextWorkspace: WorkspaceInfo | null) => {
    persistWorkspace(nextWorkspace);
    currentWorkspacePathRef.current = nextWorkspace?.path ?? null;
    setWorkspaceState(nextWorkspace);
  }, []);

  const refreshTree = useCallback(async (workspacePath: string) => {
    const requestId = ++refreshRequestRef.current;
    const result = await window.iliad.readDirectory(workspacePath);

    if (result.status === "missing") {
      if (currentWorkspacePathRef.current === workspacePath && requestId === refreshRequestRef.current) {
        onError(messagesRef.current.missingWorkspace);
        setWorkspace(null);
        setTree([]);
      }

      return [];
    }

    const nextTree = result.tree;

    if (currentWorkspacePathRef.current === workspacePath && requestId === refreshRequestRef.current) {
      setWorkspace(result.workspace);
      setTree(nextTree);
      rememberRecentWorkspace(result.workspace);
    }

    return nextTree;
  }, [onError, rememberRecentWorkspace, setWorkspace]);

  useEffect(() => {
    let isCanceled = false;

    window.iliad.getLaunchWorkspace()
      .then((launchWorkspace) => {
        if (isCanceled) {
          return;
        }

        setWorkspace(launchWorkspace ?? readPersistedWorkspace());
      })
      .catch((launchError: unknown) => {
        if (isCanceled) {
          return;
        }

        onError(launchError instanceof Error ? launchError.message : messagesRef.current.launchWorkspaceFallback);
        currentWorkspacePathRef.current = null;
        setWorkspaceState(null);
      })
      .finally(() => {
        if (!isCanceled) {
          setIsInitializing(false);
        }
      });

    return () => {
      isCanceled = true;
    };
  }, [onError, setWorkspace]);

  useEffect(() => {
    const workspacePath = workspace?.path;

    if (!workspacePath) {
      return;
    }

    refreshTree(workspacePath).catch((refreshError: unknown) => {
      if (currentWorkspacePathRef.current !== workspacePath) {
        return;
      }

      onError(refreshError instanceof Error ? refreshError.message : messagesRef.current.readWorkspaceFallback);
      setWorkspace(null);
      setTree([]);
    });
  }, [onError, refreshTree, setWorkspace, workspace?.path]);

  useEffect(() => {
    const workspacePath = workspace?.path;

    if (!workspacePath) {
      return;
    }

    if (!window.iliad.watchWorkspace) {
      return;
    }

    return window.iliad.watchWorkspace(workspacePath, (event) => {
      if (currentWorkspacePathRef.current !== workspacePath) {
        return;
      }

      setLastWorkspaceChange(event);

      if (event.treeChanged === false) {
        return;
      }

      refreshTree(workspacePath).catch((refreshError: unknown) => {
        if (currentWorkspacePathRef.current !== workspacePath) {
          return;
        }

        onError(refreshError instanceof Error ? refreshError.message : messagesRef.current.readWorkspaceFallback);
      });
    });
  }, [onError, refreshTree, workspace?.path]);

  return {
    isInitializing,
    workspace,
    setWorkspace,
    tree,
    setTree,
    lastWorkspaceChange,
    refreshTree,
    recentWorkspaces,
    pruneRecentWorkspace
  };
}
