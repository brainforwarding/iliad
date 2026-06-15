import { useCallback, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { resolveMarkdownAssetPath } from "../editor/paths";
import type { FileTreeNode, WorkspaceInfo } from "../types/iliad";
import { findNode } from "./fileTree";
import { resolveCreationDirectoryPath } from "./fileTreeMove";
import { pathIsSameOrInside, relocatePath } from "./pathUtils";

interface DocumentStateRef {
  activeFile: FileTreeNode | null;
  documentText: string;
  savedText: string;
  workspace: WorkspaceInfo | null;
}

interface UseFileActionsOptions {
  activeFile: FileTreeNode | null;
  clearDocument: () => void;
  closeTreeContextMenu: () => void;
  flushSave: () => Promise<void>;
  loadDocument: (text: string) => void;
  messages: FileActionMessages;
  onMarkdownNavigation: (previousPath: string, nextPath: string) => void;
  onTreeNodeMoved?: (move: {
    oldNode: FileTreeNode;
    newNode: FileTreeNode;
    nextTree: FileTreeNode[];
    activeFileAfterMove: FileTreeNode | null;
  }) => void;
  refreshTree: (workspacePath: string) => Promise<FileTreeNode[]>;
  renamingPath: string | null;
  selectedTreePath: string | null;
  setActiveFile: Dispatch<SetStateAction<FileTreeNode | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setNotice: Dispatch<SetStateAction<string | null>>;
  setRenamingPath: Dispatch<SetStateAction<string | null>>;
  setRevealFolderPath: Dispatch<SetStateAction<string | null>>;
  setSelectedTreePath: Dispatch<SetStateAction<string | null>>;
  stateRef: MutableRefObject<DocumentStateRef>;
  tree: FileTreeNode[];
  workspace: WorkspaceInfo | null;
}

interface FileActionMessages {
  readImageFallback: string;
  openedExternally: (name: string) => string;
  openFileFallback: string;
  createFileFallback: string;
  createFolderFallback: string;
  renameItemFallback: string;
  duplicateItemFallback: string;
  moveItemFallback: string;
  moveToTrashFallback: string;
  copyPathFallback: string;
  copiedPath: string;
  revealInFinderFallback: string;
  openLinkFallback: string;
  createdFileMissing: string;
  createdFolderMissing: string;
  renamedFileMissing: string;
  duplicatedFileMissing: string;
  movedFileMissing: string;
  movedItem: (relativePath: string) => string;
  openMarkdownBeforeImages: string;
  savedImage: (relativePath: string) => string;
  linkedImage: (relativePath: string) => string;
  unsupportedImage: string;
  headingLinksUnsupported: string;
  trashConfirmation: (name: string, kind: "directory" | "file") => string;
}

export type OpenNodeResult =
  | { kind: "markdown"; path: string }
  | { kind: "external" }
  | { kind: "none" }
  | { kind: "error" };

export interface OpenNodeOptions {
  recordHistory?: boolean;
}

function fileToDataUrl(file: File, fallbackMessage: string) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error(fallbackMessage));
    reader.readAsDataURL(file);
  });
}

function normalizeMarkdownLinkHref(href: string) {
  return href.trim().replace(/^<|>$/g, "");
}

function externalLinkUrl(href: string) {
  try {
    const url = new URL(href);

    return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function stripLocalLinkFragment(href: string) {
  const hashIndex = href.indexOf("#");
  const queryIndex = href.indexOf("?");
  const boundaryIndexes = [hashIndex, queryIndex].filter((index) => index >= 0);
  const boundary = boundaryIndexes.length > 0 ? Math.min(...boundaryIndexes) : -1;

  return boundary >= 0 ? href.slice(0, boundary) : href;
}

export function useFileActions({
  activeFile,
  clearDocument,
  closeTreeContextMenu,
  flushSave,
  loadDocument,
  messages,
  onMarkdownNavigation,
  onTreeNodeMoved,
  refreshTree,
  renamingPath,
  selectedTreePath,
  setActiveFile,
  setError,
  setNotice,
  setRenamingPath,
  setRevealFolderPath,
  setSelectedTreePath,
  stateRef,
  tree,
  workspace
}: UseFileActionsOptions) {
  const [creatingFile, setCreatingFile] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const creatingFileRef = useRef(false);
  const creatingFolderRef = useRef(false);
  const selectedTreeNode = useMemo(
    () => (selectedTreePath ? findNode(tree, selectedTreePath) : null),
    [selectedTreePath, tree]
  );
  const creationDirectoryPath = useMemo(
    () =>
      workspace
        ? resolveCreationDirectoryPath({
            workspacePath: workspace.path,
            selectedTreePath,
            selectedTreeNode,
            activeFile
          })
        : "",
    [activeFile, selectedTreeNode, selectedTreePath, workspace]
  );

  const openNode = useCallback(
    async (node: FileTreeNode, options: OpenNodeOptions = {}): Promise<OpenNodeResult> => {
      if (!workspace) {
        return { kind: "none" };
      }

      setRenamingPath(null);

      if (node.kind === "external") {
        const externalError = await window.iliad.openExternalFile(workspace.path, node.path);

        if (externalError) {
          setError(externalError);
          return { kind: "error" };
        } else {
          setSelectedTreePath(node.path);
          setNotice(messages.openedExternally(node.name));
          return { kind: "external" };
        }
      }

      if (node.kind !== "markdown") {
        return { kind: "none" };
      }

      const previousPath = stateRef.current.activeFile?.path ?? null;

      if (previousPath === node.path) {
        setSelectedTreePath(node.path);
        setError(null);
        return { kind: "markdown", path: node.path };
      }

      try {
        await flushSave();
      } catch {
        return { kind: "error" };
      }

      try {
        const text = await window.iliad.readMarkdown(workspace.path, node.path);
        setActiveFile(node);
        setSelectedTreePath(node.path);
        loadDocument(text);
        if (options.recordHistory !== false && previousPath) {
          onMarkdownNavigation(previousPath, node.path);
        }
        setError(null);
        return { kind: "markdown", path: node.path };
      } catch (readError) {
        setError(readError instanceof Error ? readError.message : messages.openFileFallback);
        return { kind: "error" };
      }
    },
    [
      flushSave,
      loadDocument,
      messages,
      onMarkdownNavigation,
      setActiveFile,
      setError,
      setNotice,
      setRenamingPath,
      setSelectedTreePath,
      stateRef,
      workspace
    ]
  );

  const createMarkdownFile = useCallback(async () => {
    if (!workspace || creatingFileRef.current) {
      return;
    }

    creatingFileRef.current = true;
    setCreatingFile(true);
    try {
      await flushSave();
      const targetDirectoryPath = creationDirectoryPath || workspace.path;
      setRevealFolderPath(targetDirectoryPath);
      const file = await window.iliad.createMarkdown(workspace.path, targetDirectoryPath, "untitled.md");
      const nextTree = await refreshTree(workspace.path);
      const hydratedNode = findNode(nextTree, file.path);

      if (!hydratedNode) {
        throw new Error(messages.createdFileMissing);
      }

      const openResult = await openNode(hydratedNode);
      if (openResult.kind !== "markdown") {
        return;
      }
      setSelectedTreePath(hydratedNode.path);
      setRenamingPath(hydratedNode.path);
      setError(null);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : messages.createFileFallback);
    } finally {
      creatingFileRef.current = false;
      setCreatingFile(false);
    }
  }, [
    creationDirectoryPath,
    flushSave,
    messages,
    openNode,
    refreshTree,
    setError,
    setRenamingPath,
    setRevealFolderPath,
    setSelectedTreePath,
    workspace
  ]);

  const createFolder = useCallback(async () => {
    if (!workspace || creatingFolderRef.current) {
      return;
    }

    creatingFolderRef.current = true;
    setCreatingFolder(true);
    try {
      await flushSave();
      const targetDirectoryPath = creationDirectoryPath || workspace.path;
      setRevealFolderPath(targetDirectoryPath);
      const folder = await window.iliad.createFolder(workspace.path, targetDirectoryPath, "untitled folder");
      const nextTree = await refreshTree(workspace.path);
      const hydratedNode = findNode(nextTree, folder.path);

      if (!hydratedNode) {
        throw new Error(messages.createdFolderMissing);
      }

      setSelectedTreePath(hydratedNode.path);
      setRenamingPath(hydratedNode.path);
      setError(null);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : messages.createFolderFallback);
    } finally {
      creatingFolderRef.current = false;
      setCreatingFolder(false);
    }
  }, [
    creationDirectoryPath,
    flushSave,
    messages,
    refreshTree,
    setError,
    setRenamingPath,
    setRevealFolderPath,
    setSelectedTreePath,
    workspace
  ]);

  const renameNode = useCallback(async (node: FileTreeNode, requestedName: string) => {
    if (!workspace) {
      return;
    }

    const trimmedName = requestedName.trim();

    if (!trimmedName || trimmedName === node.name) {
      setRenamingPath(null);
      return;
    }

    try {
      await flushSave();
      const renamedFile = await window.iliad.renamePath(workspace.path, node.path, trimmedName);
      const nextTree = await refreshTree(workspace.path);
      const hydratedNode = findNode(nextTree, renamedFile.path);

      if (!hydratedNode) {
        throw new Error(messages.renamedFileMissing);
      }

      const currentActiveFile = stateRef.current.activeFile;

      if (currentActiveFile && pathIsSameOrInside(node.path, currentActiveFile.path)) {
        const relocatedActivePath = relocatePath(node.path, renamedFile.path, currentActiveFile.path);
        const relocatedActiveNode = findNode(nextTree, relocatedActivePath);

        if (relocatedActiveNode?.kind === "markdown") {
          setActiveFile(relocatedActiveNode);
        }
      }

      if (selectedTreePath && pathIsSameOrInside(node.path, selectedTreePath)) {
        setSelectedTreePath(relocatePath(node.path, hydratedNode.path, selectedTreePath));
      }

      setRenamingPath(null);
      setError(null);
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : messages.renameItemFallback);
      setRenamingPath(null);
    }
  }, [
    flushSave,
    messages,
    refreshTree,
    selectedTreePath,
    setActiveFile,
    setError,
    setRenamingPath,
    setSelectedTreePath,
    stateRef,
    workspace
  ]);

  const duplicateNode = useCallback(async (node: FileTreeNode) => {
    if (!workspace || node.kind === "directory") {
      return;
    }

    closeTreeContextMenu();

    try {
      await flushSave();
      const duplicatedNode = await window.iliad.duplicatePath(workspace.path, node.path);
      const nextTree = await refreshTree(workspace.path);
      const hydratedNode = findNode(nextTree, duplicatedNode.path);

      if (!hydratedNode) {
        throw new Error(messages.duplicatedFileMissing);
      }

      setSelectedTreePath(hydratedNode.path);

      if (hydratedNode.kind === "markdown") {
        const openResult = await openNode(hydratedNode);
        if (openResult.kind !== "markdown") {
          return;
        }
      }

      setError(null);
    } catch (duplicateError) {
      setError(duplicateError instanceof Error ? duplicateError.message : messages.duplicateItemFallback);
    }
  }, [closeTreeContextMenu, flushSave, messages, openNode, refreshTree, setError, setSelectedTreePath, workspace]);

  const moveNode = useCallback(async (node: FileTreeNode, targetDirectoryPath: string) => {
    if (!workspace) {
      return null;
    }

    closeTreeContextMenu();

    try {
      await flushSave();
      const movedNode = await window.iliad.movePath(workspace.path, node.path, targetDirectoryPath);
      const nextTree = await refreshTree(workspace.path);
      const hydratedNode = findNode(nextTree, movedNode.path);

      if (!hydratedNode) {
        throw new Error(messages.movedFileMissing);
      }

      const currentActiveFile = stateRef.current.activeFile;
      let activeFileAfterMove = currentActiveFile;

      if (currentActiveFile && pathIsSameOrInside(node.path, currentActiveFile.path)) {
        const relocatedActivePath = relocatePath(node.path, hydratedNode.path, currentActiveFile.path);
        const relocatedActiveNode = findNode(nextTree, relocatedActivePath);

        if (relocatedActiveNode?.kind === "markdown") {
          setActiveFile(relocatedActiveNode);
          activeFileAfterMove = relocatedActiveNode;
        } else {
          setActiveFile(null);
          clearDocument();
          activeFileAfterMove = null;
        }
      }

      if (renamingPath && pathIsSameOrInside(node.path, renamingPath)) {
        setRenamingPath(relocatePath(node.path, hydratedNode.path, renamingPath));
      }

      setSelectedTreePath(hydratedNode.path);
      setRevealFolderPath(hydratedNode.path);
      onTreeNodeMoved?.({ oldNode: node, newNode: hydratedNode, nextTree, activeFileAfterMove });
      setNotice(messages.movedItem(hydratedNode.relativePath));
      setError(null);
      return hydratedNode;
    } catch (moveError) {
      setError(moveError instanceof Error ? moveError.message : messages.moveItemFallback);
      return null;
    }
  }, [
    clearDocument,
    closeTreeContextMenu,
    flushSave,
    messages,
    onTreeNodeMoved,
    refreshTree,
    renamingPath,
    setActiveFile,
    setError,
    setNotice,
    setRenamingPath,
    setRevealFolderPath,
    setSelectedTreePath,
    stateRef,
    workspace
  ]);

  const startRenameFromContextMenu = useCallback((node: FileTreeNode) => {
    closeTreeContextMenu();
    setSelectedTreePath(node.path);
    setRenamingPath(node.path);
  }, [closeTreeContextMenu, setRenamingPath, setSelectedTreePath]);

  const moveNodeToTrash = useCallback(async (node: FileTreeNode) => {
    const nodeKind = node.kind === "directory" ? "directory" : "file";

    if (!workspace || !window.confirm(messages.trashConfirmation(node.name, nodeKind))) {
      closeTreeContextMenu();
      return;
    }

    closeTreeContextMenu();

    try {
      await flushSave();
      await window.iliad.moveToTrash(workspace.path, node.path);

      const currentActiveFile = stateRef.current.activeFile;

      if (currentActiveFile && pathIsSameOrInside(node.path, currentActiveFile.path)) {
        setActiveFile(null);
        clearDocument();
      }

      if (selectedTreePath && pathIsSameOrInside(node.path, selectedTreePath)) {
        setSelectedTreePath(null);
      }

      if (renamingPath && pathIsSameOrInside(node.path, renamingPath)) {
        setRenamingPath(null);
      }

      await refreshTree(workspace.path);
      setError(null);
    } catch (trashError) {
      setError(trashError instanceof Error ? trashError.message : messages.moveToTrashFallback);
    }
  }, [
    clearDocument,
    closeTreeContextMenu,
    flushSave,
    messages,
    refreshTree,
    renamingPath,
    selectedTreePath,
    setActiveFile,
    setError,
    setRenamingPath,
    setSelectedTreePath,
    stateRef,
    workspace
  ]);

  const copyNodePath = useCallback(
    async (node: FileTreeNode) => {
      closeTreeContextMenu();

      try {
        await navigator.clipboard.writeText(node.path);
        setNotice(messages.copiedPath);
        setError(null);
      } catch (copyError) {
        setError(copyError instanceof Error ? copyError.message : messages.copyPathFallback);
      }
    },
    [closeTreeContextMenu, messages, setError, setNotice]
  );

  const revealNodeInFinder = useCallback(
    async (node: FileTreeNode) => {
      closeTreeContextMenu();

      if (!workspace) {
        return;
      }

      try {
        await window.iliad.revealInFinder(workspace.path, node.path);
        setError(null);
      } catch (revealError) {
        setError(revealError instanceof Error ? revealError.message : messages.revealInFinderFallback);
      }
    },
    [closeTreeContextMenu, messages, setError, workspace]
  );

  const insertImage = useCallback(async (file: File) => {
    const current = stateRef.current;

    if (!current.workspace || !current.activeFile) {
      throw new Error(messages.openMarkdownBeforeImages);
    }

    const filePath = window.iliad.pathForFile?.(file) ?? "";

    if (filePath) {
      try {
        const asset = await window.iliad.referenceImageAsset({
          workspaceRoot: current.workspace.path,
          documentPath: current.activeFile.path,
          imagePath: filePath
        });

        setNotice(messages.linkedImage(asset.relativePath));

        return asset.markdown;
      } catch (referenceError) {
        if (pathIsSameOrInside(current.workspace.path, filePath)) {
          setError(referenceError instanceof Error ? referenceError.message : messages.unsupportedImage);
          return null;
        }
      }
    }

    const dataUrl = await fileToDataUrl(file, messages.readImageFallback);
    let asset;

    try {
      asset = await window.iliad.saveImageAsset({
        workspaceRoot: current.workspace.path,
        documentPath: current.activeFile.path,
        dataUrl,
        originalName: file.name
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : messages.unsupportedImage);
      return null;
    }

    void refreshTree(current.workspace.path);
    setNotice(messages.savedImage(asset.relativePath));

    return asset.markdown;
  }, [messages, refreshTree, setError, setNotice, stateRef]);

  const insertImageReference = useCallback(async (relativePath: string) => {
    const current = stateRef.current;

    if (!current.workspace?.sessionId || !current.activeFile) {
      throw new Error(messages.openMarkdownBeforeImages);
    }

    try {
      const asset = await window.iliad.referenceImageAssetByRelativePath({
        workspaceSessionId: current.workspace.sessionId,
        documentPath: current.activeFile.path,
        imageRelativePath: relativePath
      });

      setNotice(messages.linkedImage(asset.relativePath));

      return asset.markdown;
    } catch (referenceError) {
      setError(referenceError instanceof Error ? referenceError.message : messages.unsupportedImage);
      return null;
    }
  }, [messages, setError, setNotice, stateRef]);

  const openDocumentLink = useCallback(async (href: string) => {
    const target = normalizeMarkdownLinkHref(href);

    if (!target) {
      return;
    }

    const externalUrl = externalLinkUrl(target);

    if (externalUrl) {
      try {
        await window.iliad.openUrl(externalUrl);
      } catch (openError) {
        setError(openError instanceof Error ? openError.message : messages.openLinkFallback);
      }
      return;
    }

    const current = stateRef.current;

    if (!current.workspace || !current.activeFile) {
      return;
    }

    if (target.startsWith("#")) {
      setNotice(messages.headingLinksUnsupported);
      return;
    }

    const targetPath = resolveMarkdownAssetPath(current.activeFile.path, stripLocalLinkFragment(target));

    if (targetPath === current.activeFile.path) {
      if (target.includes("#")) {
        setNotice(messages.headingLinksUnsupported);
      }
      return;
    }

    const targetNode = findNode(tree, targetPath);

    if (targetNode?.kind === "markdown") {
      await openNode(targetNode);
      return;
    }

    const externalError = await window.iliad.openExternalFile(current.workspace.path, targetPath);

    if (externalError) {
      setError(externalError);
    }
  }, [messages, openNode, setError, setNotice, stateRef, tree]);

  return {
    copyNodePath,
    createFolder,
    createMarkdownFile,
    creatingFile,
    creatingFolder,
    duplicateNode,
    insertImage,
    insertImageReference,
    moveNode,
    moveNodeToTrash,
    openDocumentLink,
    openNode,
    renameNode,
    revealNodeInFinder,
    startRenameFromContextMenu
  };
}
