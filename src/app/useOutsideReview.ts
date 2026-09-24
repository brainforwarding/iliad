import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppStrings } from "../i18n/strings";
import { findNode } from "../files/fileTree";
import type { OpenNodeResult } from "../files/fileActions";
import type { EditorReviewState } from "../editor/aiReview/types";
import { fileHasMutableReview } from "../review/reviewFiles";
import { logReviewNavigation } from "../review/reviewDebug";
import {
  buildPendingFileTreeChanges,
  normalizeRelativePath,
  pendingFileTreePath,
  sameRelativePath
} from "../review/pendingFileTree";
import { isExternalFilesystemProposal, type ReviewTarget } from "../review/reviewQueue";
import type { AgentChangeProposal, ExternalReviewSnapshot, FileTreeNode, WorkspaceInfo } from "../types/iliad";

export type { ReviewTarget };

type ProposalFile = AgentChangeProposal["files"][number];

interface UseOutsideReviewOptions {
  activeFile: FileTreeNode | null;
  loadDocument: (content: string) => void;
  openNode: (node: FileTreeNode) => Promise<OpenNodeResult>;
  recordNormalNavigation: (fromPath: string, toPath: string) => void;
  refreshTree: (workspacePath: string) => Promise<FileTreeNode[]>;
  setActiveFile: (file: FileTreeNode | null) => void;
  setError: (error: string | null) => void;
  setNotice: (notice: string | null) => void;
  setSelectedTreePath: (path: string | null) => void;
  requestReviewReveal?: (path: string) => void;
  onReviewNavigation?: () => void;
  /** True while the active document's buffer is in save conflict with disk. */
  activeFileInConflict?: boolean;
  /** Fires when the active file's outside-change item disappears while the buffer is in conflict. */
  onActiveFileExternalItemCleared?: () => void;
  /** Reloads the active document from disk (used when its outside item vanishes under a clean buffer). */
  reloadActiveDocument?: () => Promise<void>;
  /**
   * True when the active buffer may be replaced with disk text: not in
   * conflict and no unsaved edits (spec V5). Defaults to "not in conflict".
   */
  canReplaceActiveBuffer?: () => boolean;
  strings: AppStrings;
  tree: FileTreeNode[];
  workspace: WorkspaceInfo | null;
}

function findNodeByRelativePath(nodes: FileTreeNode[], relativePath: string): FileTreeNode | null {
  const normalizedRelativePath = normalizeRelativePath(relativePath);

  for (const node of nodes) {
    if (normalizeRelativePath(node.relativePath) === normalizedRelativePath) {
      return node;
    }

    const childMatch = node.children ? findNodeByRelativePath(node.children, relativePath) : null;

    if (childMatch) {
      return childMatch;
    }
  }

  return null;
}

export type ExternalActiveFileAutoSelectionDecision = "allow" | "noop_same_target" | "block_different_target";

export function externalActiveFileAutoSelectionDecision({
  hasActiveReview,
  alreadyReviewingFile
}: {
  hasActiveReview: boolean;
  alreadyReviewingFile: boolean;
}): ExternalActiveFileAutoSelectionDecision {
  if (alreadyReviewingFile) {
    return "noop_same_target";
  }

  if (hasActiveReview) {
    return "block_different_target";
  }

  return "allow";
}

export function externalReviewTargetForActiveFile(
  proposals: AgentChangeProposal[],
  workspacePath: string | undefined | null,
  activeRelativePath: string | undefined | null
): ReviewTarget | null {
  if (!workspacePath || !activeRelativePath) {
    return null;
  }

  for (const proposal of proposals) {
    if (proposal.metadata?.kind !== "external_filesystem" || proposal.workspaceRoot !== workspacePath) {
      continue;
    }

    const file = proposal.files.find(
      (candidate) =>
        candidate.kind !== "create_file" &&
        fileHasMutableReview(candidate) &&
        sameRelativePath(activeRelativePath, candidate.relativePath)
    );

    if (file) {
      return { proposalId: proposal.id, fileId: file.id };
    }
  }

  return null;
}

export function reviewTargetAfterActiveFileChange({
  activeRelativePath,
  currentTarget,
  proposals
}: {
  activeRelativePath: string | undefined | null;
  currentTarget: ReviewTarget | null;
  proposals: AgentChangeProposal[];
}) {
  if (!currentTarget) {
    return currentTarget;
  }

  const proposal = proposals.find((candidate) => candidate.id === currentTarget.proposalId);
  const file = proposal?.files.find((candidate) => candidate.id === currentTarget.fileId);

  if (file?.kind === "create_file") {
    return null;
  }

  if (
    (file?.kind === "edit_file" || file?.kind === "delete_file") &&
    !sameRelativePath(activeRelativePath ?? "", file.relativePath)
  ) {
    return null;
  }

  return currentTarget;
}

function reviewTargetLogDetails(target: ReviewTarget | null, proposals: AgentChangeProposal[]) {
  if (!target) {
    return {};
  }

  const proposal = proposals.find((candidate) => candidate.id === target.proposalId);
  const file = proposal?.files.find((candidate) => candidate.id === target.fileId);

  return {
    targetProposalId: target.proposalId,
    targetFileId: target.fileId,
    targetKind: file?.kind ?? null,
    targetRel: file?.relativePath ?? null
  };
}

function reviewFileLogDetails(file: ProposalFile | undefined | null) {
  return {
    targetKind: file?.kind ?? null,
    targetRel: file?.relativePath ?? null
  };
}

function activeFileClearReason(activeRelativePath: string | undefined | null, file: ProposalFile | undefined) {
  if (!file) {
    return "missing_target_file";
  }

  if (file.kind === "create_file") {
    return "active_file_changed_from_create_target";
  }

  if (!sameRelativePath(activeRelativePath ?? "", file.relativePath)) {
    return "active_file_mismatch";
  }

  return "unknown";
}

/**
 * Outside-review labels (spec V6): an edit is kept or restored per chunk
 * (Keep / Restore) or per file (Keep all / Restore all); a created file is
 * kept or moved to the Trash; a deletion is confirmed or the file restored.
 */
export function editorReviewActionLabelsForMode(
  mode: EditorReviewState["mode"],
  reviewToolbar: AppStrings["editor"]["reviewToolbar"]
) {
  if (mode === "edit_file") {
    return {
      acceptAll: reviewToolbar.acceptAll,
      rejectAll: reviewToolbar.rejectAll,
      acceptChange: reviewToolbar.keepChange,
      rejectChange: reviewToolbar.restoreChange
    };
  }

  if (mode === "create_file") {
    return {
      create: reviewToolbar.keepFile,
      discard: reviewToolbar.moveToTrash
    };
  }

  return {
    delete: reviewToolbar.confirmDeletion,
    discard: reviewToolbar.restoreFile
  };
}

/**
 * Whether a review action may load disk text into the active buffer: only for
 * the reviewed document, and never over a conflicted or dirty buffer unless
 * the writer explicitly chose to discard it (the conflict banner's Keep).
 */
export function reviewActionMayLoadActiveBuffer({
  activeRelativePath,
  targetRelativePath,
  wasInConflict,
  canReplaceActiveBuffer,
  discardBuffer = false
}: {
  activeRelativePath: string | null | undefined;
  targetRelativePath: string;
  wasInConflict: boolean;
  canReplaceActiveBuffer: boolean;
  discardBuffer?: boolean;
}) {
  if (!activeRelativePath || !sameRelativePath(activeRelativePath, targetRelativePath)) {
    return false;
  }

  if (discardBuffer) {
    return true;
  }

  return !wasInConflict && canReplaceActiveBuffer;
}

/**
 * Outside-change review in the renderer: the review snapshot pushed or pulled
 * from main, the active review target, and the keep / restore actions. Review
 * actions never flush the editor first; the review compares against disk.
 */
export function useOutsideReview({
  activeFile,
  loadDocument,
  openNode,
  recordNormalNavigation,
  refreshTree,
  setActiveFile,
  setError,
  setNotice,
  setSelectedTreePath,
  requestReviewReveal,
  onReviewNavigation,
  activeFileInConflict = false,
  onActiveFileExternalItemCleared,
  reloadActiveDocument,
  canReplaceActiveBuffer,
  strings,
  tree,
  workspace
}: UseOutsideReviewOptions) {
  const [agentProposals, setAgentProposals] = useState<AgentChangeProposal[]>([]);
  const [agentReviewTarget, setAgentReviewTarget] = useState<ReviewTarget | null>(null);
  const [reviewActionKey, setReviewActionKey] = useState<string | null>(null);
  const workspacePathRef = useRef<string | null>(null);
  const activeFilePathRef = useRef<string | null>(null);
  const activeFileRelativePathRef = useRef<string | null>(null);
  const reviewActionKeyRef = useRef<string | null>(null);
  const agentProposalsRef = useRef<AgentChangeProposal[]>([]);
  const agentReviewTargetRef = useRef<ReviewTarget | null>(null);
  const activeFileInConflictRef = useRef(activeFileInConflict);
  const activeReviewActionRef = useRef(false);
  const externalRevisionRef = useRef(0);
  workspacePathRef.current = workspace?.path ?? null;
  agentProposalsRef.current = agentProposals;
  agentReviewTargetRef.current = agentReviewTarget;
  activeFileInConflictRef.current = activeFileInConflict;
  const canReplaceActiveBufferRef = useRef(canReplaceActiveBuffer);
  canReplaceActiveBufferRef.current = canReplaceActiveBuffer;
  const bufferReplaceable = useCallback(
    () => !activeFileInConflictRef.current && (canReplaceActiveBufferRef.current?.() ?? true),
    []
  );

  useEffect(() => {
    workspacePathRef.current = workspace?.path ?? null;
  }, [workspace?.path]);

  useEffect(() => {
    const previousPath = activeFilePathRef.current;
    const previousActiveRel = activeFileRelativePathRef.current;
    const currentPath = activeFile?.path ?? null;
    const activeRel = activeFile?.relativePath ?? null;
    activeFilePathRef.current = currentPath;
    activeFileRelativePathRef.current = activeRel;

    if (previousPath === currentPath) {
      return;
    }

    logReviewNavigation("active_file_changed", {
      previousPath,
      currentPath,
      previousActiveRel,
      activeRel,
      activeRelativePath: activeRel
    });

    setAgentReviewTarget((current) => {
      const proposal = agentProposals.find((candidate) => candidate.id === current?.proposalId);
      const file = proposal?.files.find((candidate) => candidate.id === current?.fileId);
      const next = reviewTargetAfterActiveFileChange({
        activeRelativePath: activeRel,
        currentTarget: current,
        proposals: agentProposals
      });

      if (current && !next) {
        logReviewNavigation("active_file_cleared_review_target", {
          activeRel,
          activeRelativePath: activeRel,
          clearReason: activeFileClearReason(activeRel, file),
          target: current,
          ...reviewTargetLogDetails(current, agentProposals)
        });
      }

      // A document reached through history or a link that has a pending
      // outside edit must open in review, never as an editable copy of the
      // outside content (typing there would only end in a conflict).
      if (!next && !activeFileInConflictRef.current && workspacePathRef.current) {
        const externalTarget = externalReviewTargetForActiveFile(agentProposals, workspacePathRef.current, activeRel);

        if (externalTarget) {
          logReviewNavigation("active_file_entered_external_review", { target: externalTarget, activeRel });
          return externalTarget;
        }
      }

      return next;
    });
  }, [activeFile?.path, activeFile?.relativePath, agentProposals]);

  const pendingTreeChanges = useMemo(() => buildPendingFileTreeChanges(agentProposals), [agentProposals]);
  const applyExternalReviewUpdateRef = useRef<(snapshot: ExternalReviewSnapshot) => void>(() => undefined);

  const refreshExternalReview = useCallback(async () => {
    const workspaceSessionId = workspace?.sessionId;

    if (!workspaceSessionId) {
      return;
    }

    const snapshot = await window.iliad.agent.getExternalReview({ workspaceSessionId });
    applyExternalReviewUpdateRef.current(snapshot);
    return snapshot;
  }, [workspace?.sessionId]);

  const runReviewAction = useCallback(async <T,>(key: string, action: () => Promise<T>) => {
    if (reviewActionKeyRef.current) {
      logReviewNavigation("review_action_blocked", {
        key,
        inFlight: reviewActionKeyRef.current
      });
      return undefined;
    }

    reviewActionKeyRef.current = key;
    activeReviewActionRef.current = true;
    setReviewActionKey(key);
    logReviewNavigation("review_action_start", { key });

    try {
      const result = await action();
      logReviewNavigation("review_action_finish", { key });
      return result;
    } catch (error) {
      logReviewNavigation("review_action_error", {
        key,
        message: error instanceof Error ? error.message : String(error)
      });
      throw error;
    } finally {
      if (reviewActionKeyRef.current === key) {
        reviewActionKeyRef.current = null;
        activeReviewActionRef.current = false;
        setReviewActionKey(null);
      }
    }
  }, []);

  const applyAgentProposalFile = useCallback(
    async (proposalId: string, fileId: string, options: { discardBuffer?: boolean } = {}) => {
      return runReviewAction(`apply-file:${proposalId}:${fileId}`, async () => {
        if (!workspace) {
          return;
        }

        // Read before any await: the refresh below may clear the conflict.
        const wasInConflict = activeFileInConflictRef.current;
        const replaceable = bufferReplaceable();

        try {
          const result = await window.iliad.agent.applyProposalFile({
            workspaceSessionId: workspace.sessionId ?? "",
            proposalId,
            fileId
          });

        if (workspacePathRef.current !== workspace.path) {
          // The workspace changed while the action was in flight; nothing
          // below may touch the new workspace's editor.
          return;
        }

        if (result.kind === "edit_file" && result.content) {
          const file = result.proposal.files.find((candidate) => candidate.id === result.fileId);
          // Compare against the file that is active now, not the one captured
          // before the await: navigating mid-apply must not clobber another buffer.
          const activeRelativePath = activeFileRelativePathRef.current;

          // Load before refreshing the outside review, so a conflict buffer the
          // writer chose to discard is already replaced when the item's
          // disappearance is processed. Keep never loads over a conflicted or
          // dirty buffer otherwise (spec V5).
          if (
            file &&
            reviewActionMayLoadActiveBuffer({
              activeRelativePath,
              targetRelativePath: file.relativePath,
              wasInConflict,
              canReplaceActiveBuffer: replaceable,
              discardBuffer: options.discardBuffer
            })
          ) {
            loadDocument(result.content);
          }
        }

        await refreshExternalReview();

        if (result.kind === "create_file" && result.file && result.content) {
          const previousPath = activeFile?.path ?? null;
          const nextTree = await refreshTree(workspace.path);
          const nextFile = findNode(nextTree, result.file.path) ?? result.file;

          if (previousPath) {
            recordNormalNavigation(previousPath, nextFile.path);
          }

          setActiveFile(nextFile);
          setSelectedTreePath(nextFile.path);
          loadDocument(result.content);
        }

        if (result.kind === "delete_file") {
          const file = result.proposal.files.find((candidate) => candidate.id === result.fileId);
          const activeRelativePath = activeFileRelativePathRef.current;

          if (file?.kind === "delete_file" && activeRelativePath && sameRelativePath(activeRelativePath, file.relativePath)) {
            await refreshTree(workspace.path);
            setActiveFile(null);
            setSelectedTreePath(null);
            loadDocument("");
          }
        }

        const resultFile = result.proposal.files.find((candidate) => candidate.id === result.fileId);

        if (result.status === "applied" || (resultFile && !fileHasMutableReview(resultFile))) {
          setNotice(result.kind === "create_file" ? strings.review.created : strings.review.applied);
          setAgentReviewTarget(null);
        } else if (result.status === "stale") {
          // The outside tool changed the file again (or reverted it). Main
          // already refreshed the review; the target stays so the refreshed
          // item is what the editor shows next.
          setNotice(strings.review.outsideChangeStale);
        } else {
          setError(resultFile?.error ?? strings.review.errorFallback);
        }
        } catch (applyError) {
          setError(applyError instanceof Error ? applyError.message : strings.review.errorFallback);
          throw applyError;
        }
      });
    },
    [
      activeFile?.path,
      bufferReplaceable,
      loadDocument,
      recordNormalNavigation,
      refreshExternalReview,
      refreshTree,
      runReviewAction,
      setActiveFile,
      setError,
      setNotice,
      setSelectedTreePath,
      strings.review.errorFallback,
      strings.review.outsideChangeStale,
      strings.review.applied,
      strings.review.created,
      workspace
    ]
  );

  const rejectAgentProposal = useCallback(
    async (proposalId: string) => {
      return runReviewAction(`reject-proposal:${proposalId}`, async () => {
        if (!workspace) {
          return;
        }

        const wasInConflict = activeFileInConflictRef.current;
        const replaceable = bufferReplaceable();

        try {
          const proposal = await window.iliad.agent.rejectProposal({
            workspaceSessionId: workspace.sessionId ?? "",
            proposalId
          });

          if (workspacePathRef.current !== workspace.path) {
            return;
          }

          await refreshExternalReview();
          await refreshTree(workspace.path);

          if (proposal.status === "stale") {
            // Nothing was restored: the items changed or were resolved
            // elsewhere first. The refreshed review replaces them in place.
            setNotice(strings.review.outsideChangeStale);
            return "stale" as const;
          }

          const activeRelativePath = activeFileRelativePathRef.current;
          const activePath = activeFilePathRef.current;
          const touchedActive = proposal.files.some(
            (file) => activeRelativePath && sameRelativePath(activeRelativePath, file.relativePath)
          );

          if (touchedActive && activePath && !wasInConflict && replaceable) {
            try {
              loadDocument(await window.iliad.readMarkdown(workspace.path, activePath));
            } catch {
              setActiveFile(null);
              setSelectedTreePath(null);
              loadDocument("");
            }
          }

          setAgentReviewTarget((current) => (current?.proposalId === proposalId ? null : current));
        } catch (rejectError) {
          setError(rejectError instanceof Error ? rejectError.message : strings.review.errorFallback);
          throw rejectError;
        }
      });
    },
    [
      bufferReplaceable,
      loadDocument,
      refreshExternalReview,
      refreshTree,
      runReviewAction,
      setActiveFile,
      setError,
      setNotice,
      setSelectedTreePath,
      strings.review.errorFallback,
      strings.review.outsideChangeStale,
      workspace
    ]
  );

  const rejectAgentProposalFile = useCallback(
    async (proposalId: string, fileId: string) => {
      return runReviewAction(`reject-file:${proposalId}:${fileId}`, async () => {
        if (!workspace) {
          return;
        }

        const previousProposal = agentProposals.find((candidate) => candidate.id === proposalId);
        const previousFile = previousProposal?.files.find((candidate) => candidate.id === fileId);
        // Read before any await: the refresh below clears the conflict state,
        // and the reload decision must reflect the state when the writer acted.
        const wasInConflict = activeFileInConflictRef.current;
        const replaceable = bufferReplaceable();

        try {
          const proposal = await window.iliad.agent.rejectProposalFile({
            workspaceSessionId: workspace.sessionId ?? "",
            proposalId,
            fileId
          });

        if (workspacePathRef.current !== workspace.path) {
          return;
        }

        await refreshExternalReview();
        await refreshTree(workspace.path);
        const activeRelativePath = activeFileRelativePathRef.current;
        const activePath = activeFilePathRef.current;
        const resultFile = proposal.files.find((candidate) => candidate.id === fileId);

        // A stale result carries the file marked stale, or no file at all
        // when the item was already gone (another window acted first).
        if (!resultFile || resultFile.status === "stale") {
          // Nothing was written; keep the review target so the refreshed
          // item replaces the old one in place instead of dropping to an
          // editable buffer holding unreviewed text.
          setNotice(strings.review.outsideChangeStale);
          return "stale" as const;
        }

        // In conflict mode the buffer holds the writer's edits; restoring the
        // previous version on disk must leave that buffer alone.
        if (
          previousFile &&
          activeRelativePath &&
          activePath &&
          sameRelativePath(activeRelativePath, previousFile.relativePath) &&
          !wasInConflict &&
          replaceable
        ) {
          try {
            const text = await window.iliad.readMarkdown(workspace.path, activePath);
            loadDocument(text);
          } catch {
            setActiveFile(null);
            setSelectedTreePath(null);
            loadDocument("");
          }
        }

        setAgentReviewTarget((current) =>
          current?.proposalId === proposalId && current.fileId === fileId ? null : current
        );
        } catch (rejectError) {
          setError(rejectError instanceof Error ? rejectError.message : strings.review.errorFallback);
          throw rejectError;
        }
      });
    },
    [
      agentProposals,
      bufferReplaceable,
      loadDocument,
      refreshExternalReview,
      refreshTree,
      runReviewAction,
      setActiveFile,
      setError,
      setNotice,
      setSelectedTreePath,
      strings.review.errorFallback,
      strings.review.outsideChangeStale,
      workspace
    ]
  );

  /**
   * Keep or Restore one chunk of an outside edit. Carries the hashes the
   * writer saw; main answers `stale` (nothing done) when the file moved on.
   * Afterwards the review is refreshed and the active document reloaded from
   * disk, unless its buffer is in conflict or dirty (spec V5). No flushSave:
   * the review compares against disk, not the buffer.
   */
  const runChunkAction = useCallback(
    async (action: "keep" | "restore", proposalId: string, fileId: string, chunkId: string) => {
      return runReviewAction(`${action}-chunk:${proposalId}:${fileId}:${chunkId}`, async () => {
        if (!workspace) {
          return;
        }

        const proposal = agentProposalsRef.current.find((candidate) => candidate.id === proposalId);
        const file = proposal?.files.find((candidate) => candidate.id === fileId);

        if (!file || file.kind !== "edit_file") {
          setNotice(strings.review.outsideChangeStale);
          return "stale" as const;
        }

        const wasInConflict = activeFileInConflictRef.current;
        const replaceable = bufferReplaceable();

        try {
          const request = {
            workspaceSessionId: workspace.sessionId ?? "",
            proposalId,
            fileId,
            chunkId,
            baselineHash: file.baseHash,
            diskHash: file.reviewedContentHash ?? ""
          };
          const result =
            action === "keep"
              ? await window.iliad.agent.keepChunk(request)
              : await window.iliad.agent.restoreChunk(request);

          if (workspacePathRef.current !== workspace.path) {
            return;
          }

          await refreshExternalReview();

          if (result.status === "stale") {
            setNotice(strings.review.outsideChangeStale);
            return "stale" as const;
          }

          const activePath = activeFilePathRef.current;

          if (
            activePath &&
            reviewActionMayLoadActiveBuffer({
              activeRelativePath: activeFileRelativePathRef.current,
              targetRelativePath: file.relativePath,
              wasInConflict: wasInConflict || activeFileInConflictRef.current,
              canReplaceActiveBuffer: replaceable
            })
          ) {
            try {
              loadDocument(await window.iliad.readMarkdown(workspace.path, activePath));
            } catch {
              // The file moved on again; the refreshed review shows it.
            }
          }

          return result.status;
        } catch (chunkError) {
          setError(chunkError instanceof Error ? chunkError.message : strings.review.errorFallback);
          throw chunkError;
        }
      });
    },
    [
      bufferReplaceable,
      loadDocument,
      refreshExternalReview,
      runReviewAction,
      setError,
      setNotice,
      strings.review.errorFallback,
      strings.review.outsideChangeStale,
      workspace
    ]
  );

  const keepOutsideChunk = useCallback(
    (proposalId: string, fileId: string, chunkId: string) => runChunkAction("keep", proposalId, fileId, chunkId),
    [runChunkAction]
  );
  const restoreOutsideChunk = useCallback(
    (proposalId: string, fileId: string, chunkId: string) => runChunkAction("restore", proposalId, fileId, chunkId),
    [runChunkAction]
  );

  const selectAgentReviewTarget = useCallback(
    async (target: ReviewTarget | null) => {
      if (!target) {
        logReviewNavigation("select_target_clear_requested", {
          activeRelativePath: activeFile?.relativePath ?? null
        });
        setAgentReviewTarget(null);
        return;
      }

      logReviewNavigation("select_target_start", {
        target,
        ...reviewTargetLogDetails(target, agentProposals),
        activeRel: activeFile?.relativePath ?? null,
        activeRelativePath: activeFile?.relativePath ?? null,
        workspacePath: workspace?.path ?? null
      });

      let proposals = agentProposals;
      let proposal = proposals.find((candidate) => candidate.id === target.proposalId);

      if (!proposal && workspace) {
        logReviewNavigation("select_target_refetch_proposals", { target });
        const snapshot = await refreshExternalReview().catch(() => undefined);
        proposals = snapshot?.proposal ? [snapshot.proposal] : [];
        proposal = proposals.find((candidate) => candidate.id === target.proposalId);
      }

      const file = proposal?.files.find((candidate) => candidate.id === target.fileId);

      if (!proposal || !file || proposal.workspaceRoot !== workspace?.path) {
        logReviewNavigation("select_target_invalid", {
          target,
          ...reviewTargetLogDetails(target, proposals),
          hasProposal: Boolean(proposal),
          hasFile: Boolean(file),
          workspaceMatches: proposal?.workspaceRoot === workspace?.path,
          proposalWorkspaceRoot: proposal?.workspaceRoot ?? null,
          workspacePath: workspace?.path ?? null
        });
        setAgentReviewTarget(null);
        return;
      }

      if (file.kind === "edit_file") {
        const node = findNodeByRelativePath(tree, file.relativePath);

        if (!node) {
          logReviewNavigation("select_target_missing_edit_node", {
            target,
            ...reviewFileLogDetails(file),
            relativePath: file.relativePath
          });
          setError(strings.review.fileChanged);
          return;
        }

        if (!sameRelativePath(activeFile?.relativePath ?? "", file.relativePath)) {
          logReviewNavigation("select_target_open_edit_node", {
            target,
            ...reviewFileLogDetails(file),
            activeRel: activeFile?.relativePath ?? null,
            nodeRel: node.relativePath,
            nodeKind: node.kind,
            nodeFound: true,
            openedNode: true,
            fromRelativePath: activeFile?.relativePath ?? null,
            toRelativePath: file.relativePath,
            nodePath: node.path
          });
          const result = await openNode(node);

          if (result.kind !== "markdown") {
            logReviewNavigation("select_target_open_edit_node_failed", {
              target,
              ...reviewFileLogDetails(file),
              resultKind: result.kind
            });
            setError(strings.review.fileChanged);
            return;
          }
        }

        logReviewNavigation("select_target_reveal_edit", {
          target,
          ...reviewFileLogDetails(file),
          revealPath: node.path,
          nodeRel: node.relativePath,
          nodePath: node.path,
          relativePath: file.relativePath
        });
        requestReviewReveal?.(node.path);
      }

      if (file.kind === "create_file") {
        const node = findNodeByRelativePath(tree, file.relativePath);
        if (!node) {
          setSelectedTreePath(null);
        }
        logReviewNavigation("select_target_reveal_create", {
          target,
          ...reviewFileLogDetails(file),
          nodePath: node?.path ?? null,
          nodeRel: node?.relativePath ?? null,
          nodeKind: node?.kind ?? null,
          nodeFound: Boolean(node),
          revealPath: node?.path ?? pendingFileTreePath(file.relativePath),
          revealRel: file.relativePath,
          relativePath: file.relativePath
        });
        requestReviewReveal?.(node?.path ?? pendingFileTreePath(file.relativePath));
      }

      if (file.kind === "delete_file") {
        const found = findNodeByRelativePath(tree, file.relativePath);
        // A folder that took the file's name is not the document: the delete
        // is reviewed virtually, from its own ghost row.
        const node = found?.kind === "markdown" ? found : null;

        if (node && !sameRelativePath(activeFile?.relativePath ?? "", file.relativePath)) {
          logReviewNavigation("select_target_open_delete_node", {
            target,
            ...reviewFileLogDetails(file),
            activeRel: activeFile?.relativePath ?? null,
            nodeRel: node.relativePath,
            nodeKind: node.kind,
            nodeFound: true,
            openedNode: true,
            fromRelativePath: activeFile?.relativePath ?? null,
            toRelativePath: file.relativePath,
            nodePath: node.path
          });
          const result = await openNode(node);

          if (result.kind !== "markdown") {
            logReviewNavigation("select_target_open_delete_node_failed", {
              target,
              ...reviewFileLogDetails(file),
              resultKind: result.kind
            });
            setError(strings.review.fileChanged);
            return;
          }
        }

        if (!node) {
          setSelectedTreePath(null);
        }

        logReviewNavigation("select_target_reveal_delete", {
          target,
          ...reviewFileLogDetails(file),
          nodeFound: Boolean(node),
          nodeRel: node?.relativePath ?? null,
          nodeKind: node?.kind ?? null,
          revealPath: node ? node.path : pendingFileTreePath(file.relativePath),
          revealRel: file.relativePath
        });
        requestReviewReveal?.(node ? node.path : pendingFileTreePath(file.relativePath));
      }

      logReviewNavigation("select_target_set", {
        target,
        ...reviewFileLogDetails(file),
        fileKind: file.kind,
        relativePath: file.relativePath
      });
      setAgentReviewTarget(target);
    },
    [
      activeFile?.relativePath,
      agentProposals,
      openNode,
      refreshExternalReview,
      requestReviewReveal,
      setError,
      setSelectedTreePath,
      strings.review.fileChanged,
      tree,
      workspace
    ]
  );

  /**
   * Single entry point for outside-change review state pushed or pulled from
   * main. Stale revisions and other workspaces are ignored; the external
   * proposal is replaced or removed; the tree refreshes when the item set
   * changed by path; the active file's item auto-selects unless the buffer is
   * in conflict, where the banner owns the decision.
   */
  const applyExternalReviewUpdate = useCallback(
    (snapshot: ExternalReviewSnapshot) => {
      const workspacePath = workspacePathRef.current;

      if (!workspacePath || snapshot.workspaceRoot !== workspacePath) {
        return;
      }

      // A pull and a push often carry the same revision; applying it twice
      // would re-run the active-file side effects on stale refs.
      if (
        snapshot.revision < externalRevisionRef.current ||
        (snapshot.revision === externalRevisionRef.current && externalRevisionRef.current !== 0)
      ) {
        logReviewNavigation("external_review_stale_revision", {
          revision: snapshot.revision,
          knownRevision: externalRevisionRef.current
        });
        return;
      }

      externalRevisionRef.current = snapshot.revision;
      const incoming = snapshot.proposal;
      const previous = agentProposalsRef.current.find(isExternalFilesystemProposal) ?? null;
      const previousPaths = new Set((previous?.files ?? []).map((file) => normalizeRelativePath(file.relativePath)));
      const nextPaths = new Set((incoming?.files ?? []).map((file) => normalizeRelativePath(file.relativePath)));
      const pathSetChanged =
        previousPaths.size !== nextPaths.size || [...previousPaths].some((relativePath) => !nextPaths.has(relativePath));

      setAgentProposals(incoming && isExternalFilesystemProposal(incoming) ? [incoming] : []);

      if (previous) {
        setAgentReviewTarget((current) => {
          if (!current || current.proposalId !== previous.id) {
            return current;
          }

          return incoming?.files.some((file) => file.id === current.fileId) ? current : null;
        });
      }

      if (pathSetChanged) {
        void refreshTree(workspacePath).catch(() => undefined);
      }

      const activeRelativePath = activeFileRelativePathRef.current;

      if (!activeRelativePath) {
        return;
      }

      const normalizedActive = normalizeRelativePath(activeRelativePath);
      const hadItem = previousPaths.has(normalizedActive);
      const hasItem = nextPaths.has(normalizedActive);

      if (hadItem && !hasItem) {
        if (activeFileInConflictRef.current) {
          // The writer's buffer is the truth; disk matches its saved identity again.
          onActiveFileExternalItemCleared?.();
        } else if (!activeReviewActionRef.current) {
          // The read-only review vanished under a clean buffer that may hold
          // the outside content (opened while the item was pending): reload
          // so the editor never shows text that is not on disk.
          void reloadActiveDocument?.();
        }
      }

      if (!hasItem || !incoming || activeFileInConflictRef.current) {
        return;
      }

      const target = externalReviewTargetForActiveFile([incoming], workspacePath, activeRelativePath);

      if (!target) {
        return;
      }

      const currentTarget = agentReviewTargetRef.current;
      const alreadyReviewingFile =
        currentTarget?.proposalId === target.proposalId && currentTarget.fileId === target.fileId;
      const decision = externalActiveFileAutoSelectionDecision({
        hasActiveReview: Boolean(currentTarget),
        alreadyReviewingFile
      });

      logReviewNavigation("external_review_active_file_target", {
        target,
        revision: snapshot.revision,
        autoSelectDecision: decision,
        activeRel: activeRelativePath
      });

      if (decision === "allow") {
        void selectAgentReviewTarget(target);
      }
    },
    [onActiveFileExternalItemCleared, refreshTree, reloadActiveDocument, selectAgentReviewTarget]
  );

  useEffect(() => {
    applyExternalReviewUpdateRef.current = applyExternalReviewUpdate;
  }, [applyExternalReviewUpdate]);

  const clearReviewForNormalNavigation = useCallback(
    (node: FileTreeNode) => {
      setAgentReviewTarget((current) => {
        if (!current) {
          return current;
        }

        const proposal = agentProposals.find((candidate) => candidate.id === current.proposalId);
        const file = proposal?.files.find((candidate) => candidate.id === current.fileId);

        if (file?.kind === "create_file") {
          logReviewNavigation("normal_navigation_cleared_review_target", {
            activeRel: activeFile?.relativePath ?? null,
            clearReason: "normal_navigation_from_create_target",
            nodeRel: node.relativePath,
            nodeKind: node.kind,
            target: current,
            ...reviewTargetLogDetails(current, agentProposals)
          });
          return null;
        }

        if (
          (file?.kind === "edit_file" || file?.kind === "delete_file") &&
          !sameRelativePath(node.relativePath, file.relativePath)
        ) {
          logReviewNavigation("normal_navigation_cleared_review_target", {
            activeRel: activeFile?.relativePath ?? null,
            clearReason: "normal_navigation_file_mismatch",
            nodeRel: node.relativePath,
            nodeKind: node.kind,
            target: current,
            ...reviewTargetLogDetails(current, agentProposals)
          });
          return null;
        }

        return current;
      });
    },
    [activeFile?.relativePath, agentProposals]
  );

  // A workspace change starts from an empty review; the first load is a pull
  // of main's current snapshot (pushes keep it current afterwards).
  useEffect(() => {
    externalRevisionRef.current = 0;
    setAgentProposals([]);
    setAgentReviewTarget(null);

    if (!workspace?.sessionId) {
      return;
    }

    void refreshExternalReview().catch((reviewError) => {
      setError(reviewError instanceof Error ? reviewError.message : strings.review.errorFallback);
    });
  }, [refreshExternalReview, setError, strings.review.errorFallback, workspace?.path, workspace?.sessionId]);

  useEffect(() => {
    if (!agentReviewTarget) {
      return;
    }

    const proposal = agentProposals.find((candidate) => candidate.id === agentReviewTarget.proposalId);
    const file = proposal?.files.find((candidate) => candidate.id === agentReviewTarget.fileId);

    if (!proposal || !file || proposal.workspaceRoot !== workspace?.path) {
      logReviewNavigation("proposal_state_cleared_review_target", {
        target: agentReviewTarget,
        ...reviewTargetLogDetails(agentReviewTarget, agentProposals),
        hasProposal: Boolean(proposal),
        hasFile: Boolean(file),
        workspaceMatches: proposal?.workspaceRoot === workspace?.path,
        clearReason: !proposal ? "missing_proposal" : !file ? "missing_file" : "workspace_mismatch"
      });
      setAgentReviewTarget(null);
    }
  }, [agentProposals, agentReviewTarget, workspace?.path]);

  const activeReview = useMemo(() => {
    if (!agentReviewTarget || !workspace) {
      return null;
    }

    const proposal = agentProposals.find((candidate) => candidate.id === agentReviewTarget.proposalId);
    const file = proposal?.files.find((candidate) => candidate.id === agentReviewTarget.fileId);

    if (!proposal || !file || proposal.workspaceRoot !== workspace.path) {
      return null;
    }

    // Conflict mode shows the writer's editable buffer instead of the
    // read-only outside review of the same file.
    if (
      activeFileInConflict &&
      file.kind === "edit_file" &&
      activeFile?.relativePath &&
      sameRelativePath(activeFile.relativePath, file.relativePath)
    ) {
      return null;
    }

    return { proposal, file };
  }, [activeFile?.relativePath, activeFileInConflict, agentProposals, agentReviewTarget, workspace]);

  const virtualReviewFile = useMemo<FileTreeNode | null>(() => {
    if (!activeReview || (activeReview.file.kind !== "create_file" && activeReview.file.kind !== "delete_file")) {
      return null;
    }

    const relativePath = normalizeRelativePath(activeReview.file.relativePath);
    const nameParts = relativePath.split("/").filter(Boolean);

    return {
      name: nameParts[nameParts.length - 1] ?? relativePath,
      path: pendingFileTreePath(relativePath),
      relativePath,
      kind: "markdown"
    };
  }, [activeReview]);

  const editorReview = useMemo<EditorReviewState | null>(() => {
    if (!activeReview) {
      return null;
    }

    if (activeReview.file.kind === "edit_file") {
      return {
        mode: "edit_file",
        file: activeReview.file,
        currentContent: activeReview.file.baseContent,
        activeHunkId: null,
        readOnly: true,
        actionBusy: Boolean(reviewActionKey),
        labels: {
          ...strings.editor.reviewToolbar,
          ...editorReviewActionLabelsForMode("edit_file", strings.editor.reviewToolbar)
        },
        onAcceptHunk: (hunkId: string) => {
          onReviewNavigation?.();
          void keepOutsideChunk(activeReview.proposal.id, activeReview.file.id, hunkId).catch(() => undefined);
        },
        onRejectHunk: (hunkId: string) => {
          onReviewNavigation?.();
          void restoreOutsideChunk(activeReview.proposal.id, activeReview.file.id, hunkId).catch(() => undefined);
        },
        onAcceptFile: () => {
          onReviewNavigation?.();
          void applyAgentProposalFile(activeReview.proposal.id, activeReview.file.id).catch(() => undefined);
        },
        onRejectFile: () => {
          onReviewNavigation?.();
          void rejectAgentProposalFile(activeReview.proposal.id, activeReview.file.id).catch(() => undefined);
        }
      };
    }

    if (activeReview.file.kind === "create_file") {
      return {
        mode: "create_file",
        file: activeReview.file,
        currentContent: activeReview.file.content,
        actionBusy: Boolean(reviewActionKey),
        labels: {
          ...strings.editor.reviewToolbar,
          ...editorReviewActionLabelsForMode("create_file", strings.editor.reviewToolbar)
        },
        onAcceptFile: () => {
          onReviewNavigation?.();
          void applyAgentProposalFile(activeReview.proposal.id, activeReview.file.id).catch(() => undefined);
        },
        onRejectFile: () => {
          onReviewNavigation?.();
          void rejectAgentProposalFile(activeReview.proposal.id, activeReview.file.id).catch(() => undefined);
        }
      };
    }

    return {
      mode: "delete_file",
      file: activeReview.file,
      currentContent: activeReview.file.baseContent,
      actionBusy: Boolean(reviewActionKey),
      labels: {
        ...strings.editor.reviewToolbar,
        ...editorReviewActionLabelsForMode("delete_file", strings.editor.reviewToolbar)
      },
      onAcceptFile: () => {
        onReviewNavigation?.();
        void applyAgentProposalFile(activeReview.proposal.id, activeReview.file.id).catch(() => undefined);
      },
      onRejectFile: () => {
        onReviewNavigation?.();
        void rejectAgentProposalFile(activeReview.proposal.id, activeReview.file.id).catch(() => undefined);
      }
    };
  }, [
    activeReview,
    applyAgentProposalFile,
    keepOutsideChunk,
    onReviewNavigation,
    rejectAgentProposalFile,
    restoreOutsideChunk,
    reviewActionKey,
    strings.editor.reviewToolbar
  ]);

  return {
    activeReview,
    agentProposals,
    applyAgentProposalFile,
    applyExternalReviewUpdate,
    clearReviewForNormalNavigation,
    editorReview,
    keepOutsideChunk,
    refreshExternalReview,
    reviewActionBusy: Boolean(reviewActionKey),
    pendingTreeChanges,
    rejectAgentProposal,
    rejectAgentProposalFile,
    restoreOutsideChunk,
    selectAgentReviewTarget,
    setAgentProposals,
    setAgentReviewTarget,
    virtualReviewFile
  };
}
