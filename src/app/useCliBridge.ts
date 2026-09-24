import { useCallback, useEffect, useRef } from "react";
import type { OpenNodeResult } from "../files/fileActions";
import type { CliOpenDocumentRequest, CliOpenResult, FileTreeNode } from "../types/iliad";

export interface CliOpenSteps {
  /** Finds the Markdown node in the current tree, refreshing it once if needed. */
  findNode: (absolutePath: string) => Promise<FileTreeNode | null>;
  /** Leaves any review-only view, like a normal navigation. */
  prepareNavigation: (node: FileTreeNode) => void;
  /** Opens the document through the normal path (flushes pending saves). */
  openNode: (node: FileTreeNode) => Promise<OpenNodeResult>;
  /** Reveals a line of the now-open document; resolves false if it never happened. */
  revealLine: (absolutePath: string, line: number) => Promise<boolean>;
}

/**
 * Carries out one `iliad open` request in the renderer and says how it went;
 * the CLI prints the error text as is.
 */
export async function runCliOpenRequest(request: CliOpenDocumentRequest, steps: CliOpenSteps): Promise<CliOpenResult> {
  const node = await steps.findNode(request.path);

  if (!node || node.kind !== "markdown") {
    return { ok: false, error: `The document is not in this Iliad window's folder: ${request.path}` };
  }

  steps.prepareNavigation(node);
  const result = await steps.openNode(node);

  if (result.kind !== "markdown") {
    return {
      ok: false,
      error: "Iliad could not open the document (the current document may have unsaved changes that failed to save)."
    };
  }

  if (request.line !== null && !(await steps.revealLine(node.path, request.line))) {
    return { ok: false, error: `Iliad opened the document but could not show line ${request.line}.` };
  }

  return { ok: true };
}

interface UseCliBridgeOptions {
  workspacePath: string | null;
  tree: FileTreeNode[];
  activeDocumentPath: string | null;
  steps: CliOpenSteps;
}

/**
 * Keeps main informed of the open document (for `iliad status`) and handles
 * `iliad open` requests queued for this window. Requests are pulled once the
 * workspace is loaded and again whenever main says one is waiting.
 */
export function useCliBridge({ workspacePath, tree, activeDocumentPath, steps }: UseCliBridgeOptions) {
  const stepsRef = useRef(steps);
  const handlingRef = useRef(false);
  const pullAgainRef = useRef(false);
  const workspacePathRef = useRef(workspacePath);
  stepsRef.current = steps;
  workspacePathRef.current = workspacePath;

  useEffect(() => {
    void window.iliad.cli?.setActiveDocument(workspacePath ? activeDocumentPath : null).catch(() => undefined);
  }, [activeDocumentPath, workspacePath]);

  const pullOpenRequest = useCallback(async () => {
    const cli = window.iliad.cli;

    if (!cli || !workspacePathRef.current) {
      return;
    }

    if (handlingRef.current) {
      pullAgainRef.current = true;
      return;
    }

    handlingRef.current = true;

    try {
      for (;;) {
        pullAgainRef.current = false;
        const request = await cli.takeOpenRequest();

        if (!request) {
          if (pullAgainRef.current) {
            continue;
          }

          return;
        }

        let result: CliOpenResult;

        try {
          result = await runCliOpenRequest(request, stepsRef.current);
        } catch (error) {
          result = { ok: false, error: error instanceof Error ? error.message : "Iliad could not open the document." };
        }

        await cli.completeOpenRequest(request.id, result).catch(() => undefined);
      }
    } catch {
      // Main is gone or refused; the CLI times out on its own.
    } finally {
      handlingRef.current = false;
    }
  }, []);

  useEffect(() => window.iliad.cli?.onOpenRequested(() => void pullOpenRequest()), [pullOpenRequest]);

  useEffect(() => {
    if (workspacePath) {
      void pullOpenRequest();
    }
  }, [pullOpenRequest, tree, workspacePath]);
}
