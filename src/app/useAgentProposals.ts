import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppStrings } from "../i18n/strings";
import { findNode } from "../files/fileTree";
import type { OpenNodeResult } from "../files/fileActions";
import type { EditorReviewState } from "../editor/aiReview/types";
import { fileHasMutableReview } from "../assistant/assistantUtils";
import {
  buildPendingFileTreeChanges,
  normalizeRelativePath,
  pendingFileTreePath,
  sameRelativePath
} from "../assistant/pendingFileTree";
import type { ReviewTarget } from "../assistant/reviewNavigation";
import type { AgentChangeProposal, FileTreeNode, WorkspaceInfo } from "../types/iliad";

export type { ReviewTarget };

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
  const workspacePathRef = useRef<string | null>(null);
  const activeFilePathRef = useRef<string | null>(null);
  workspacePathRef.current = workspace?.path ?? null;

  useEffect(() => {
    workspacePathRef.current = workspace?.path ?? null;
  }, [workspace?.path]);

  useEffect(() => {
    const previousPath = activeFilePathRef.current;
    const currentPath = activeFile?.path ?? null;
    activeFilePathRef.current = currentPath;

    if (previousPath === currentPath) {
      return;
    }

    setAgentReviewTarget((current) => {
      if (!current) {
        return current;
      }

      const proposal = agentProposals.find((candidate) => candidate.id === current.proposalId);
      const file = proposal?.files.find((candidate) => candidate.id === current.fileId);

      if (file?.kind === "create_file") {
        return null;
      }

      if (file?.kind === "edit_file" && !sameRelativePath(activeFile?.relativePath ?? "", file.relativePath)) {
        return null;
      }

      return current;
    });
  }, [activeFile?.path, activeFile?.relativePath, agentProposals]);

  const refreshAgentProposals = useCallback(async () => {
    if (!workspace) {
      setAgentProposals([]);
      setAgentReviewTarget(null);
      return [];
    }

    const proposals = await window.iliad.agent.listProposals(workspace.path);
    if (workspacePathRef.current !== workspace.path) {
      return [];
    }

    setAgentProposals(proposals);
    return proposals;
  }, [workspace]);

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

  const applyAgentProposalFile = useCallback(
    async (proposalId: string, fileId: string) => {
      if (!workspace) {
        return;
      }

      await flushSave();
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
    },
    [
      activeFile?.path,
      activeFile?.relativePath,
      flushSave,
      loadDocument,
      mergeAgentProposals,
      recordNormalNavigation,
      refreshTree,
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
      if (!workspace) {
        return;
      }

      await flushSave();
      try {
        const proposal = await window.iliad.agent.rejectProposal({
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
    [flushSave, mergeAgentProposals, setError, strings.assistant.errorFallback, workspace]
  );

  const rejectAgentProposalFile = useCallback(
    async (proposalId: string, fileId: string) => {
      if (!workspace) {
        return;
      }

      await flushSave();
      try {
        const proposal = await window.iliad.agent.rejectProposalFile({
          workspaceRoot: workspace.path,
          proposalId,
          fileId
        });
        mergeAgentProposals([proposal]);
        setAgentReviewTarget((current) =>
          current?.proposalId === proposalId && current.fileId === fileId ? null : current
        );
      } catch (rejectError) {
        setError(rejectError instanceof Error ? rejectError.message : strings.assistant.errorFallback);
        throw rejectError;
      }
    },
    [flushSave, mergeAgentProposals, setError, strings.assistant.errorFallback, workspace]
  );

  const resolveAgentProposalHunk = useCallback(
    async (proposalId: string, fileId: string, hunkId: string, decision: "accept" | "reject") => {
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
    },
    [
      activeFile?.relativePath,
      flushSave,
      loadDocument,
      mergeAgentProposals,
      setError,
      strings.assistant.errorFallback,
      workspace
    ]
  );

  const selectAgentReviewTarget = useCallback(
    async (target: ReviewTarget | null) => {
      if (!target) {
        setAgentReviewTarget(null);
        return;
      }

      let proposals = agentProposals;
      let proposal = proposals.find((candidate) => candidate.id === target.proposalId);

      if (!proposal && workspace) {
        proposals = await window.iliad.agent.listProposals(workspace.path);
        mergeAgentProposals(proposals);
        proposal = proposals.find((candidate) => candidate.id === target.proposalId);
      }

      const file = proposal?.files.find((candidate) => candidate.id === target.fileId);

      if (!proposal || !file || proposal.workspaceRoot !== workspace?.path) {
        setAgentReviewTarget(null);
        return;
      }

      await flushSave();

      if (file.kind === "edit_file") {
        const node = findNodeByRelativePath(tree, file.relativePath);

        if (!node) {
          setError(strings.assistant.fileChanged);
          return;
        }

        if (!sameRelativePath(activeFile?.relativePath ?? "", file.relativePath)) {
          const result = await openNode(node);

          if (result.kind !== "markdown") {
            setError(strings.assistant.fileChanged);
            return;
          }
        }

        requestReviewReveal?.(node.path);
      }

      if (file.kind === "create_file") {
        requestReviewReveal?.(pendingFileTreePath(file.relativePath));
      }

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
          return null;
        }

        if (file?.kind === "edit_file" && !sameRelativePath(node.relativePath, file.relativePath)) {
          return null;
        }

        return current;
      });
    },
    [agentProposals]
  );

  useEffect(() => {
    setAgentReviewTarget(null);
    void refreshAgentProposals().catch((proposalError) => {
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
    if (!activeReview || activeReview.file.kind !== "create_file") {
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
        currentContent: documentText,
        activeHunkId: null,
        labels: strings.editor.reviewToolbar,
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

    return {
      mode: "create_file",
      file: activeReview.file,
      currentContent: activeReview.file.content,
      labels: strings.editor.reviewToolbar,
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
    strings.editor.reviewToolbar
  ]);

  return {
    activeReview,
    agentProposals,
    clearReviewForNormalNavigation,
    editorReview,
    mergeAgentProposals,
    pendingTreeChanges,
    rejectAgentProposal,
    selectAgentReviewTarget,
    setAgentProposals,
    setAgentReviewTarget,
    virtualReviewFile
  };
}
