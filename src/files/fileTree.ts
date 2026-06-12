import type { FileTreeNode } from "../types/iliad";

export function findNodeByRelativePath(nodes: FileTreeNode[], relativePath: string): FileTreeNode | null {
  const target = relativePath.replace(/\\/g, "/").toLowerCase();

  for (const node of nodes) {
    if (node.relativePath.replace(/\\/g, "/").toLowerCase() === target) {
      return node;
    }

    const child = node.children ? findNodeByRelativePath(node.children, relativePath) : null;

    if (child) {
      return child;
    }
  }

  return null;
}

export function findNode(nodes: FileTreeNode[], path: string): FileTreeNode | null {
  for (const node of nodes) {
    if (node.path === path) {
      return node;
    }

    const child = node.children ? findNode(node.children, path) : null;

    if (child) {
      return child;
    }
  }

  return null;
}
