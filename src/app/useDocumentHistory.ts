import { useCallback, useMemo, useState } from "react";
import { findNode } from "../files/fileTree";
import { pathIsSameOrInside, relocatePath } from "../files/pathUtils";
import type { FileTreeNode } from "../types/iliad";

const maxHistoryEntries = 50;

export type DocumentHistoryDirection = "back" | "forward";

export interface DocumentHistoryTarget {
  node: FileTreeNode;
  path: string;
  skippedEntries: number;
}

interface ResolvedHistoryTarget extends DocumentHistoryTarget {
  index: number;
}

interface DocumentHistoryState {
  backStack: string[];
  forwardStack: string[];
}

function isMarkdownNode(node: FileTreeNode | null): node is FileTreeNode {
  return node?.kind === "markdown";
}

function pushHistoryPath(stack: string[], path: string) {
  if (stack[stack.length - 1] === path) {
    return stack;
  }

  return [...stack, path].slice(-maxHistoryEntries);
}

function resolveHistoryTarget(stack: string[], tree: FileTreeNode[]): ResolvedHistoryTarget | null {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const path = stack[index];
    const node = findNode(tree, path);

    if (isMarkdownNode(node)) {
      return {
        index,
        node,
        path,
        skippedEntries: stack.length - 1 - index
      };
    }
  }

  return null;
}

function publicTarget(target: ResolvedHistoryTarget | null): DocumentHistoryTarget | null {
  if (!target) {
    return null;
  }

  return {
    node: target.node,
    path: target.path,
    skippedEntries: target.skippedEntries
  };
}

function removeNavigatedTarget(stack: string[], targetPath: string) {
  const targetIndex = stack.lastIndexOf(targetPath);
  return targetIndex === -1 ? null : stack.slice(0, targetIndex);
}

export function relocateHistoryStackPaths(stack: string[], oldRoot: string, newRoot: string) {
  return stack.map((candidatePath) =>
    pathIsSameOrInside(oldRoot, candidatePath) ? relocatePath(oldRoot, newRoot, candidatePath) : candidatePath
  );
}

export function useDocumentHistory(tree: FileTreeNode[]) {
  const [history, setHistory] = useState<DocumentHistoryState>({
    backStack: [],
    forwardStack: []
  });
  const { backStack, forwardStack } = history;

  const resolvedBackTarget = useMemo(() => resolveHistoryTarget(backStack, tree), [backStack, tree]);
  const resolvedForwardTarget = useMemo(() => resolveHistoryTarget(forwardStack, tree), [forwardStack, tree]);
  const backTarget = useMemo(() => publicTarget(resolvedBackTarget), [resolvedBackTarget]);
  const forwardTarget = useMemo(() => publicTarget(resolvedForwardTarget), [resolvedForwardTarget]);

  const clearHistory = useCallback(() => {
    setHistory({ backStack: [], forwardStack: [] });
  }, []);

  const recordNormalNavigation = useCallback((previousPath: string | null | undefined, nextPath: string | null | undefined) => {
    if (!previousPath || !nextPath || previousPath === nextPath) {
      return;
    }

    setHistory((currentHistory) => ({
      backStack: pushHistoryPath(currentHistory.backStack, previousPath),
      forwardStack: []
    }));
  }, []);

  const getNavigationTarget = useCallback(
    (direction: DocumentHistoryDirection) => (direction === "back" ? backTarget : forwardTarget),
    [backTarget, forwardTarget]
  );

  const completeHistoryNavigation = useCallback(
    (
      direction: DocumentHistoryDirection,
      currentPath: string | null | undefined,
      openedTargetPath: string | null | undefined
    ) => {
      if (!currentPath || !openedTargetPath || currentPath === openedTargetPath) {
        return;
      }

      if (direction === "back") {
        setHistory((currentHistory) => {
          const nextBackStack = removeNavigatedTarget(currentHistory.backStack, openedTargetPath);

          if (!nextBackStack) {
            return currentHistory;
          }

          return {
            backStack: nextBackStack,
            forwardStack: pushHistoryPath(currentHistory.forwardStack, currentPath)
          };
        });
      } else {
        setHistory((currentHistory) => {
          const nextForwardStack = removeNavigatedTarget(currentHistory.forwardStack, openedTargetPath);

          if (!nextForwardStack) {
            return currentHistory;
          }

          return {
            backStack: pushHistoryPath(currentHistory.backStack, currentPath),
            forwardStack: nextForwardStack
          };
        });
      }
    },
    []
  );

  const relocateHistoryPaths = useCallback((oldRoot: string, newRoot: string) => {
    setHistory((currentHistory) => ({
      backStack: relocateHistoryStackPaths(currentHistory.backStack, oldRoot, newRoot),
      forwardStack: relocateHistoryStackPaths(currentHistory.forwardStack, oldRoot, newRoot)
    }));
  }, []);

  return {
    backStack,
    forwardStack,
    backTarget,
    forwardTarget,
    canGoBack: Boolean(backTarget),
    canGoForward: Boolean(forwardTarget),
    clearHistory,
    completeHistoryNavigation,
    getNavigationTarget,
    relocateHistoryPaths,
    recordNormalNavigation
  };
}
