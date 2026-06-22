import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppStrings } from "../i18n/strings";
import { findNode } from "../files/fileTree";
import type { OpenNodeResult } from "../files/fileActions";
import type { EditorReviewState } from "../editor/aiReview/types";
import { fileHasMutableReview } from "../assistant/assistantUtils";
import { logReviewNavigation } from "../assistant/reviewDebug";
import {
  buildPendingFileTreeChanges,
  normalizeRelativePath,
  pendingFileTreePath,
  sameRelativePath
} from "../assistant/pendingFileTree";
import type { ReviewTarget } from "../assistant/reviewNavigation";
import type { AgentApi, AgentChangeProposal, FileTreeNode, WorkspaceInfo } from "../types/iliad";

export type { ReviewTarget };

type ProposalFile = AgentChangeProposal["files"][number];

interface UseAgentProposalsOptions {
  activeFile: FileTreeNode | null;
  documentText: string;
  flushSave: () => Promise<void>;
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
  strings: AppStrings;
  tree: FileTreeNode[];
  workspace: WorkspaceInfo | null;
}

export function rejectProposalWithoutSaving({
  agent,
  workspaceRoot,
  proposalId
}: {
  agent: Pick<AgentApi, "rejectProposal">;
  workspaceRoot: string;
  proposalId: string;
}) {
  return agent.rejectProposal({ workspaceRoot, proposalId });
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

function isExternalFilesystemProposal(proposal: AgentChangeProposal | undefined | null) {
  return proposal?.metadata?.kind === "external_filesystem";
}

export function shouldFlushBeforeSelectingReviewTarget(proposal: AgentChangeProposal | undefined | null) {
  return !isExternalFilesystemProposal(proposal);
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

export function editorReviewActionLabelsForMode(
  mode: EditorReviewState["mode"],
  reviewToolbar: AppStrings["editor"]["reviewToolbar"]
) {
  if (mode === "edit_file") {
    return {
      acceptAll: reviewToolbar.acceptAll,
      rejectAll: reviewToolbar.rejectAll,
      rejectRemaining: reviewToolbar.rejectRemaining
    };
  }

  if (mode === "create_file") {
    return {
      create: reviewToolbar.acceptAll,
      discard: reviewToolbar.rejectAll
    };
  }

  return {
    delete: reviewToolbar.acceptAll,
    discard: reviewToolbar.rejectAll
  };
}

export function useAgentProposals({
  activeFile,
  documentText,
  flushSave,
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
  strings,
  tree,
  workspace
}: UseAgentProposalsOptions) {
  const [agentProposals, setAgentProposals] = useState<AgentChangeProposal[]>([]);
  const [agentReviewTarget, setAgentReviewTarget] = useState<ReviewTarget | null>(null);
  const [proposalLoadState, setProposalLoadState] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [reviewActionKey, setReviewActionKey] = useState<string | null>(null);
  const workspacePathRef = useRef<string | null>(null);
  const activeFilePathRef = useRef<string | null>(null);
  const activeFileRelativePathRef = useRef<string | null>(null);
  const reviewActionKeyRef = useRef<string | null>(null);
  workspacePathRef.current = workspace?.path ?? null;

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

      return next;
    });
  }, [activeFile?.path, activeFile?.relativePath, agentProposals]);

  const refreshAgentProposals = useCallback(async () => {
    const workspacePath = workspace?.path;

    if (!workspacePath) {
      setAgentProposals([]);
      setAgentReviewTarget(null);
      setProposalLoadState("loaded");
      return [];
    }

    setProposalLoadState("loading");
    const proposals = await window.iliad.agent.listProposals(workspacePath);
    if (workspacePathRef.current !== workspacePath) {
      return [];
    }

    setAgentProposals(proposals);
    setProposalLoadState("loaded");
    return proposals;
  }, [workspace?.path]);

  const mergeAgentProposals = useCallback((proposals: AgentChangeProposal[]) => {
    const currentWorkspacePath = workspacePathRef.current;
    const scopedProposals = currentWorkspacePath
      ? proposals.filter((proposal) => proposal.workspaceRoot === currentWorkspacePath)
      : [];

    if (scopedProposals.length === 0) {
      return;
    }

    setAgentProposals((current) => {
      const byId = new Map(current.map((proposal) => [proposal.id, proposal]));

      for (const proposal of scopedProposals) {
        byId.set(proposal.id, proposal);
      }

      return [...byId.values()].sort(
        (a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt)
      );
    });
  }, []);

  const pendingTreeChanges = useMemo(() => buildPendingFileTreeChanges(agentProposals), [agentProposals]);

  const runReviewAction = useCallback(async <T,>(key: string, action: () => Promise<T>) => {
    if (reviewActionKeyRef.current) {
      logReviewNavigation("review_action_blocked", {
        key,
        inFlight: reviewActionKeyRef.current
      });
      return undefined;
    }

    reviewActionKeyRef.current = key;
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
        setReviewActionKey(null);
      }
    }
  }, []);

  const applyAgentProposalFile = useCallback(
    async (proposalId: string, fileId: string) => {
      return runReviewAction(`apply-file:${proposalId}:${fileId}`, async () => {
        if (!workspace) {
          return;
        }

        const proposal = agentProposals.find((candidate) => candidate.id === proposalId);

        if (!isExternalFilesystemProposal(proposal)) {
          await flushSave();
        }

        try {
          const result = await window.iliad.agent.applyProposalFile({
            workspaceRoot: workspace.path,
            proposalId,
            fileId
          });
        mergeAgentProposals([result.proposal]);

        if (result.kind === "edit_file" && result.content) {
          const file = result.proposal.files.find((candidate) => candidate.id === result.fileId);

          if (file && activeFile?.relativePath && sameRelativePath(activeFile.relativePath, file.relativePath)) {
            loadDocument(result.content);
          }
        }

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

          if (file?.kind === "delete_file" && activeFile?.relativePath && sameRelativePath(activeFile.relativePath, file.relativePath)) {
            await refreshTree(workspace.path);
            setActiveFile(null);
            setSelectedTreePath(null);
            loadDocument("");
          }
        }

        const resultFile = result.proposal.files.find((candidate) => candidate.id === result.fileId);

        if (result.status === "applied" || (resultFile && !fileHasMutableReview(resultFile))) {
          setNotice(result.kind === "create_file" ? strings.assistant.status.created : strings.assistant.status.applied);
          setAgentReviewTarget(null);
        } else {
          setError(resultFile?.error ?? strings.assistant.errorFallback);
        }
        } catch (applyError) {
          setError(applyError instanceof Error ? applyError.message : strings.assistant.errorFallback);
          throw applyError;
        }
      });
    },
    [
      activeFile?.path,
      activeFile?.relativePath,
      agentProposals,
      flushSave,
      loadDocument,
      mergeAgentProposals,
      recordNormalNavigation,
      refreshTree,
      runReviewAction,
      setActiveFile,
      setError,
      setNotice,
      setSelectedTreePath,
      strings.assistant.errorFallback,
      strings.assistant.status.applied,
      strings.assistant.status.created,
      workspace
    ]
  );

  const rejectAgentProposal = useCallback(
    async (proposalId: string) => {
      return runReviewAction(`reject-proposal:${proposalId}`, async () => {
        if (!workspace) {
          return;
        }

        const proposal = agentProposals.find((candidate) => candidate.id === proposalId);

        if (!isExternalFilesystemProposal(proposal)) {
          await flushSave();
        }

        try {
          const proposal = await rejectProposalWithoutSaving({
            agent: window.iliad.agent,
            workspaceRoot: workspace.path,
            proposalId
          });
          mergeAgentProposals([proposal]);
          setAgentReviewTarget((current) => (current?.proposalId === proposalId ? null : current));
        } catch (rejectError) {
          setError(rejectError instanceof Error ? rejectError.message : strings.assistant.errorFallback);
          throw rejectError;
        }
      });
    },
    [agentProposals, flushSave, mergeAgentProposals, runReviewAction, setError, strings.assistant.errorFallback, workspace]
  );
  const rejectAgentProposalStateOnly = useCallback(
    async (proposalId: string) => {
      if (!workspace) {
        return;
      }

      try {
        const proposal = await rejectProposalWithoutSaving({
          agent: window.iliad.agent,
          workspaceRoot: workspace.path,
          proposalId
        });
        mergeAgentProposals([proposal]);
        setAgentReviewTarget((current) => (current?.proposalId === proposalId ? null : current));
      } catch (rejectError) {
        setError(rejectError instanceof Error ? rejectError.message : strings.assistant.errorFallback);
        throw rejectError;
      }
    },
    [mergeAgentProposals, setError, strings.assistant.errorFallback, workspace]
  );

  const rejectAgentProposalFile = useCallback(
    async (proposalId: string, fileId: string) => {
      return runReviewAction(`reject-file:${proposalId}:${fileId}`, async () => {
        if (!workspace) {
          return;
        }

        const previousProposal = agentProposals.find((candidate) => candidate.id === proposalId);
        const previousFile = previousProposal?.files.find((candidate) => candidate.id === fileId);
        const externalReview = isExternalFilesystemProposal(previousProposal);

        if (!externalReview) {
          await flushSave();
        }

        try {
          const proposal = await window.iliad.agent.rejectProposalFile({
            workspaceRoot: workspace.path,
            proposalId,
            fileId
          });
        mergeAgentProposals([proposal]);

        if (externalReview) {
          await refreshTree(workspace.path);

          if (
            previousFile &&
            activeFile?.relativePath &&
            sameRelativePath(activeFile.relativePath, previousFile.relativePath)
          ) {
            try {
              const text = await window.iliad.readMarkdown(workspace.path, activeFile.path);
              loadDocument(text);
            } catch {
              setActiveFile(null);
              setSelectedTreePath(null);
              loadDocument("");
            }
          }
        }

        setAgentReviewTarget((current) =>
          current?.proposalId === proposalId && current.fileId === fileId ? null : current
        );
        } catch (rejectError) {
          setError(rejectError instanceof Error ? rejectError.message : strings.assistant.errorFallback);
          throw rejectError;
        }
      });
    },
    [
      activeFile,
      agentProposals,
      flushSave,
      loadDocument,
      mergeAgentProposals,
      refreshTree,
      runReviewAction,
      setActiveFile,
      setError,
      setSelectedTreePath,
      strings.assistant.errorFallback,
      workspace
    ]
  );

  const resolveAgentProposalHunk = useCallback(
    async (proposalId: string, fileId: string, hunkId: string, decision: "accept" | "reject") => {
      return runReviewAction(`hunk:${proposalId}:${fileId}:${hunkId}:${decision}`, async () => {
        if (!workspace) {
          return;
        }

        await flushSave();
        try {
          const result = await window.iliad.agent.resolveProposalHunk({
            workspaceRoot: workspace.path,
            proposalId,
            fileId,
            hunkId,
            decision
          });
        mergeAgentProposals([result.proposal]);

        const file = result.proposal.files.find((candidate) => candidate.id === result.fileId);

        if (
          file?.kind === "edit_file" &&
          result.content &&
          activeFile?.relativePath &&
          sameRelativePath(activeFile.relativePath, file.relativePath)
        ) {
          loadDocument(result.content);
        }

        if (file && !fileHasMutableReview(file)) {
          setAgentReviewTarget(null);
        }

        if (file?.error) {
          setError(file.error);
        }
        } catch (resolveError) {
          setError(resolveError instanceof Error ? resolveError.message : strings.assistant.errorFallback);
          throw resolveError;
        }
      });
    },
    [
      activeFile?.relativePath,
      flushSave,
      loadDocument,
      mergeAgentProposals,
      runReviewAction,
      setError,
      strings.assistant.errorFallback,
      workspace
    ]
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
        proposals = await window.iliad.agent.listProposals(workspace.path);
        mergeAgentProposals(proposals);
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

      if (shouldFlushBeforeSelectingReviewTarget(proposal)) {
        logReviewNavigation("select_target_flush_save", {
          target,
          ...reviewFileLogDetails(file),
          fileKind: file.kind,
          relativePath: file.relativePath
        });
        await flushSave();
      }

      if (file.kind === "edit_file") {
        const node = findNodeByRelativePath(tree, file.relativePath);

        if (!node) {
          logReviewNavigation("select_target_missing_edit_node", {
            target,
            ...reviewFileLogDetails(file),
            relativePath: file.relativePath
          });
          setError(strings.assistant.fileChanged);
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
            setError(strings.assistant.fileChanged);
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
        const node = findNodeByRelativePath(tree, file.relativePath);

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
            setError(strings.assistant.fileChanged);
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
      flushSave,
      mergeAgentProposals,
      openNode,
      requestReviewReveal,
      setError,
      setSelectedTreePath,
      strings.assistant.fileChanged,
      tree,
      workspace
    ]
  );

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

  useEffect(() => {
    setAgentReviewTarget(null);
    void refreshAgentProposals().catch((proposalError) => {
      setProposalLoadState("error");
      setError(proposalError instanceof Error ? proposalError.message : strings.assistant.errorFallback);
    });
  }, [refreshAgentProposals, setError, strings.assistant.errorFallback, workspace?.path]);

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

    return { proposal, file };
  }, [agentProposals, agentReviewTarget, workspace]);

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
      const externalReview = isExternalFilesystemProposal(activeReview.proposal);

      return {
        mode: "edit_file",
        file: activeReview.file,
        currentContent: externalReview ? activeReview.file.baseContent : documentText,
        activeHunkId: null,
        readOnly: externalReview,
        hideHunkActions: externalReview,
        actionBusy: Boolean(reviewActionKey),
        labels: {
          ...strings.editor.reviewToolbar,
          ...editorReviewActionLabelsForMode("edit_file", strings.editor.reviewToolbar)
        },
        onAcceptHunk: (hunkId) => {
          onReviewNavigation?.();
          void resolveAgentProposalHunk(activeReview.proposal.id, activeReview.file.id, hunkId, "accept");
        },
        onRejectHunk: (hunkId) => {
          onReviewNavigation?.();
          void resolveAgentProposalHunk(activeReview.proposal.id, activeReview.file.id, hunkId, "reject");
        },
        onAcceptFile: () => {
          onReviewNavigation?.();
          void applyAgentProposalFile(activeReview.proposal.id, activeReview.file.id);
        },
        onRejectFile: () => {
          onReviewNavigation?.();
          void rejectAgentProposalFile(activeReview.proposal.id, activeReview.file.id);
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
          void applyAgentProposalFile(activeReview.proposal.id, activeReview.file.id);
        },
        onRejectFile: () => {
          onReviewNavigation?.();
          void rejectAgentProposalFile(activeReview.proposal.id, activeReview.file.id);
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
        void applyAgentProposalFile(activeReview.proposal.id, activeReview.file.id);
      },
      onRejectFile: () => {
        onReviewNavigation?.();
        void rejectAgentProposalFile(activeReview.proposal.id, activeReview.file.id);
      }
    };
  }, [
    activeReview,
    applyAgentProposalFile,
    documentText,
    onReviewNavigation,
    rejectAgentProposalFile,
    resolveAgentProposalHunk,
    reviewActionKey,
    strings.editor.reviewToolbar
  ]);

  return {
    activeReview,
    agentProposals,
    applyAgentProposalFile,
    clearReviewForNormalNavigation,
    editorReview,
    mergeAgentProposals,
    pendingTreeChanges,
    proposalLoadState,
    rejectAgentProposal,
    rejectAgentProposalFile,
    rejectAgentProposalStateOnly,
    selectAgentReviewTarget,
    setAgentProposals,
    setAgentReviewTarget,
    virtualReviewFile
  };
}
