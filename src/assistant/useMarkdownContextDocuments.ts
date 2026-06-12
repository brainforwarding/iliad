import { useEffect, useMemo, useState } from "react";
import {
  collectMarkdownContextDocuments,
  isVisibleMarkdownContextPath,
  normalizeRelativePath,
  workspaceContextApiSessionId,
  type MarkdownContextDocumentList
} from "./contextAttachments";
import type { FileTreeNode, IliadApi, WorkspaceInfo } from "../types/iliad";

type IliadApiWithContextDocuments = IliadApi & {
  listMarkdownContextDocuments?: (workspaceSessionId: string) => Promise<MarkdownContextDocumentList>;
};

function documentListKey(files: MarkdownContextDocumentList["files"]) {
  return files.map((file) => normalizeRelativePath(file.relativePath)).join("|");
}

function sanitizeDocumentList(list: MarkdownContextDocumentList): MarkdownContextDocumentList {
  return {
    truncated: Boolean(list.truncated),
    files: list.files
      .map((file) => ({
        ...file,
        relativePath: normalizeRelativePath(file.relativePath),
        name: file.name || normalizeRelativePath(file.relativePath).split("/").pop() || file.relativePath
      }))
      .filter((file) => isVisibleMarkdownContextPath(file.relativePath))
  };
}

export function useMarkdownContextDocuments(workspace: WorkspaceInfo, tree: FileTreeNode[]) {
  const workspaceSessionId = workspaceContextApiSessionId(workspace);
  const fallbackList = useMemo<MarkdownContextDocumentList>(
    () => ({
      files: collectMarkdownContextDocuments(tree),
      truncated: false
    }),
    [tree]
  );
  const fallbackKey = useMemo(() => documentListKey(fallbackList.files), [fallbackList.files]);
  const [remoteList, setRemoteList] = useState<MarkdownContextDocumentList | null>(null);

  useEffect(() => {
    const api = window.iliad as IliadApiWithContextDocuments;

    setRemoteList(null);

    if (!api.listMarkdownContextDocuments) {
      return;
    }

    let canceled = false;

    api
      .listMarkdownContextDocuments(workspaceSessionId)
      .then((list) => {
        if (!canceled) {
          setRemoteList(sanitizeDocumentList(list));
        }
      })
      .catch((error) => {
        console.warn("context:list-markdown-documents failed", error);
      });

    return () => {
      canceled = true;
    };
  }, [fallbackKey, workspaceSessionId]);

  return remoteList ?? fallbackList;
}
