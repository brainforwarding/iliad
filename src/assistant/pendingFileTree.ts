import { fileHasMutableReview } from "./assistantUtils";
import type { AgentChangeProposal, AgentProposalFileStatus, FileTreeNode } from "../types/iliad";

export interface PendingFileTreeChange {
  proposalId: string;
  fileId: string;
  kind: "edit_file" | "create_file";
  relativePath: string;
  normalizedRelativePath: string;
  status: AgentProposalFileStatus;
}

export type FileTreeDisplayNode =
  | {
      source: "real";
      node: FileTreeNode;
      children?: FileTreeDisplayNode[];
      pendingTarget?: PendingFileTreeChange;
      hasPendingDescendant?: boolean;
    }
  | {
      source: "pending-create";
      pendingTarget: PendingFileTreeChange;
      name: string;
      path: string;
      relativePath: string;
    }
  | {
      source: "pending-dir";
      name: string;
      path: string;
      relativePath: string;
      children: FileTreeDisplayNode[];
      hasPendingDescendant?: boolean;
    };

export function normalizeRelativePath(relativePath: string) {
  const normalizedInput = relativePath.trim().replace(/\\/g, "/");

  if (normalizedInput.startsWith("/") || /^[A-Za-z]:\//.test(normalizedInput)) {
    return "";
  }

  const normalizedSegments: string[] = [];

  for (const segment of normalizedInput.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }

    if (segment === "..") {
      return "";
    }

    normalizedSegments.push(segment);
  }

  return normalizedSegments.join("/");
}

export function sameRelativePath(left: string, right: string) {
  const normalizedLeft = normalizeRelativePath(left);
  const normalizedRight = normalizeRelativePath(right);

  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

export function pendingFileTreePath(relativePath: string) {
  return `iliad-review://${normalizeRelativePath(relativePath)}`;
}

export function pendingFileTreeDirectoryPath(relativePath: string) {
  return `iliad-review-dir://${normalizeRelativePath(relativePath)}`;
}

function proposalTimestamp(proposal: AgentChangeProposal) {
  const timestamp = Date.parse(proposal.updatedAt || proposal.createdAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function buildPendingFileTreeChanges(proposals: AgentChangeProposal[]): PendingFileTreeChange[] {
  const candidates: Array<{ change: PendingFileTreeChange; timestamp: number; index: number }> = [];

  proposals.forEach((proposal, proposalIndex) => {
    proposal.files.forEach((file, fileIndex) => {
      if (!fileHasMutableReview(file)) {
        return;
      }

      const normalizedRelativePath = normalizeRelativePath(file.relativePath);

      if (!normalizedRelativePath) {
        return;
      }

      candidates.push({
        change: {
          proposalId: proposal.id,
          fileId: file.id,
          kind: file.kind,
          relativePath: file.relativePath,
          normalizedRelativePath,
          status: file.status
        },
        timestamp: proposalTimestamp(proposal),
        index: proposalIndex * 100_000 + fileIndex
      });
    });
  });

  candidates.sort((left, right) => {
    const timestampDifference = right.timestamp - left.timestamp;

    if (timestampDifference !== 0) {
      return timestampDifference;
    }

    return right.index - left.index;
  });

  const newestByPath = new Map<string, PendingFileTreeChange>();

  for (const candidate of candidates) {
    if (!newestByPath.has(candidate.change.normalizedRelativePath)) {
      newestByPath.set(candidate.change.normalizedRelativePath, candidate.change);
    }
  }

  return [...newestByPath.values()];
}

function realNodeRank(node: FileTreeNode) {
  const isAssetDirectory = node.kind === "directory" && node.name === "assets";

  if (node.kind === "directory" && !isAssetDirectory) {
    return 0;
  }

  if (node.kind === "markdown") {
    return 1;
  }

  if (isAssetDirectory) {
    return 2;
  }

  return 3;
}

function displayNodeName(node: FileTreeDisplayNode) {
  return node.source === "real" ? node.node.name : node.name;
}

function displayNodeRank(node: FileTreeDisplayNode) {
  if (node.source === "real") {
    return realNodeRank(node.node);
  }

  return node.source === "pending-dir" ? 0 : 1;
}

function sortDisplayNodes(nodes: FileTreeDisplayNode[]) {
  nodes.sort((left, right) => {
    const rankDifference = displayNodeRank(left) - displayNodeRank(right);

    if (rankDifference !== 0) {
      return rankDifference;
    }

    return displayNodeName(left).localeCompare(displayNodeName(right), undefined, { sensitivity: "base" });
  });

  for (const node of nodes) {
    const children = node.source === "real" ? node.children : node.source === "pending-dir" ? node.children : undefined;

    if (children) {
      sortDisplayNodes(children);
    }
  }
}

function collectRealPaths(nodes: FileTreeNode[], paths = new Set<string>()) {
  for (const node of nodes) {
    const normalizedRelativePath = normalizeRelativePath(node.relativePath);

    if (normalizedRelativePath) {
      paths.add(normalizedRelativePath);
    }

    if (node.children) {
      collectRealPaths(node.children, paths);
    }
  }

  return paths;
}

function realDirectoryChildren(displayNode: FileTreeDisplayNode): FileTreeDisplayNode[] | null {
  if (displayNode.source !== "real" || displayNode.node.kind !== "directory") {
    return null;
  }

  displayNode.children ??= [];
  return displayNode.children;
}

function findDirectoryChildren(
  nodes: FileTreeDisplayNode[],
  normalizedRelativePath: string
): FileTreeDisplayNode[] | null {
  for (const node of nodes) {
    const nodeRelativePath = node.source === "real" ? normalizeRelativePath(node.node.relativePath) : node.relativePath;

    if (nodeRelativePath !== normalizedRelativePath) {
      continue;
    }

    if (node.source === "pending-dir") {
      return node.children;
    }

    return realDirectoryChildren(node);
  }

  return null;
}

function insertPendingCreate(nodes: FileTreeDisplayNode[], pendingTarget: PendingFileTreeChange) {
  const segments = pendingTarget.normalizedRelativePath.split("/");

  if (segments.length === 0) {
    return;
  }

  let container = nodes;
  const parentSegments: string[] = [];

  for (const segment of segments.slice(0, -1)) {
    parentSegments.push(segment);
    const directoryRelativePath = parentSegments.join("/");
    const existingChildren = findDirectoryChildren(container, directoryRelativePath);

    if (existingChildren) {
      container = existingChildren;
      continue;
    }

    const pendingDirectory: FileTreeDisplayNode = {
      source: "pending-dir",
      name: segment,
      path: pendingFileTreeDirectoryPath(directoryRelativePath),
      relativePath: directoryRelativePath,
      children: []
    };

    container.push(pendingDirectory);
    container = pendingDirectory.children;
  }

  if (
    container.some((node) => {
      const nodeRelativePath = node.source === "real" ? normalizeRelativePath(node.node.relativePath) : node.relativePath;
      return nodeRelativePath === pendingTarget.normalizedRelativePath;
    })
  ) {
    return;
  }

  container.push({
    source: "pending-create",
    pendingTarget,
    name: segments[segments.length - 1] ?? pendingTarget.normalizedRelativePath,
    path: pendingFileTreePath(pendingTarget.normalizedRelativePath),
    relativePath: pendingTarget.normalizedRelativePath
  });
}

function annotatePendingDescendants(node: FileTreeDisplayNode): boolean {
  if (node.source === "pending-create") {
    return true;
  }

  const children = node.children;
  const hasPendingChild = children?.some(annotatePendingDescendants) ?? false;

  if (node.source === "real") {
    node.hasPendingDescendant = hasPendingChild || undefined;
    return Boolean(node.pendingTarget) || hasPendingChild;
  }

  node.hasPendingDescendant = hasPendingChild || undefined;
  return hasPendingChild;
}

export function buildFileTreeDisplayNodes(
  nodes: FileTreeNode[],
  pendingChanges: PendingFileTreeChange[]
): FileTreeDisplayNode[] {
  const realPaths = collectRealPaths(nodes);
  const pendingEditsByPath = new Map<string, PendingFileTreeChange>();

  for (const change of pendingChanges) {
    if (change.kind === "edit_file" && realPaths.has(change.normalizedRelativePath)) {
      pendingEditsByPath.set(change.normalizedRelativePath, change);
    }
  }

  const toDisplayNode = (node: FileTreeNode): FileTreeDisplayNode => {
    const normalizedRelativePath = normalizeRelativePath(node.relativePath);

    return {
      source: "real",
      node,
      children: node.children?.map(toDisplayNode),
      pendingTarget: pendingEditsByPath.get(normalizedRelativePath)
    };
  };

  const displayNodes = nodes.map(toDisplayNode);

  for (const change of pendingChanges) {
    if (change.kind === "create_file" && !realPaths.has(change.normalizedRelativePath)) {
      insertPendingCreate(displayNodes, change);
    }
  }

  sortDisplayNodes(displayNodes);
  displayNodes.forEach(annotatePendingDescendants);

  return displayNodes;
}
