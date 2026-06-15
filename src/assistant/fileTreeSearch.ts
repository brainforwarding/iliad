import {
  displayNodeChildren,
  displayNodeId,
  displayNodeKind,
  displayNodePath,
  displayNodeRelativePath,
  displayTreeName,
  type FileTreeDisplayNode
} from "./pendingFileTree";

export type FileTreeSearchMode = "continuous" | "fuzzy";

export interface FileTreeSearchRange {
  start: number;
  end: number;
}

export interface FileTreeSearchMatch {
  id: string;
  path: string;
  relativePath: string;
  displayName: string;
  selfRanges: FileTreeSearchRange[];
  ancestorPaths: string[];
}

export interface FileTreeSearchNodeMeta {
  selfMatch: boolean;
  selfRanges: FileTreeSearchRange[];
  descendantMatchCount: number;
  visibleInFilter: boolean;
}

export interface FileTreeSearchResult {
  normalizedQuery: string;
  matches: FileTreeSearchMatch[];
  metaById: Map<string, FileTreeSearchNodeMeta>;
  filterAncestorPaths: Set<string>;
}

interface SearchableNode {
  id: string;
  path: string;
  relativePath: string;
  displayName: string;
  kind: ReturnType<typeof displayNodeKind>;
  ancestorPaths: string[];
}

export function normalizeFileTreeSearchQuery(query: string) {
  return query.trim().replace(/\s+/g, " ");
}

function lowerSearchText(value: string) {
  return value.toLocaleLowerCase();
}

function mergeRanges(ranges: FileTreeSearchRange[]) {
  const sorted = ranges
    .filter((range) => range.end > range.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const merged: FileTreeSearchRange[] = [];

  for (const range of sorted) {
    const previous = merged[merged.length - 1];

    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
      continue;
    }

    merged.push({ ...range });
  }

  return merged;
}

export function matchFileTreeSearchRanges(
  displayName: string,
  query: string,
  mode: FileTreeSearchMode
): FileTreeSearchRange[] {
  const normalizedQuery = normalizeFileTreeSearchQuery(query);

  if (!normalizedQuery) {
    return [];
  }

  const haystack = lowerSearchText(displayName);
  const needle = lowerSearchText(normalizedQuery);

  if (mode === "continuous") {
    const start = haystack.indexOf(needle);
    return start >= 0 ? [{ start, end: start + needle.length }] : [];
  }

  const ranges: FileTreeSearchRange[] = [];
  let searchFrom = 0;

  for (const character of needle) {
    const index = haystack.indexOf(character, searchFrom);

    if (index < 0) {
      return [];
    }

    ranges.push({ start: index, end: index + character.length });
    searchFrom = index + character.length;
  }

  return mergeRanges(ranges);
}

function flattenDisplayNodes(nodes: FileTreeDisplayNode[]) {
  const flattened: SearchableNode[] = [];

  const visit = (treeNodes: FileTreeDisplayNode[], ancestorPaths: string[]) => {
    for (const node of treeNodes) {
      const id = displayNodeId(node);

      flattened.push({
        id,
        path: displayNodePath(node),
        relativePath: displayNodeRelativePath(node),
        displayName: displayTreeName(node),
        kind: displayNodeKind(node),
        ancestorPaths
      });

      const children = displayNodeChildren(node);

      if (children) {
        visit(children, [...ancestorPaths, id]);
      }
    }
  };

  visit(nodes, []);
  return flattened;
}

function initializeMeta(nodes: SearchableNode[], visibleInFilter: boolean) {
  const metaById = new Map<string, FileTreeSearchNodeMeta>();

  for (const node of nodes) {
    metaById.set(node.id, {
      selfMatch: false,
      selfRanges: [],
      descendantMatchCount: 0,
      visibleInFilter
    });
  }

  return metaById;
}

function markDescendantsVisible(node: FileTreeDisplayNode, metaById: Map<string, FileTreeSearchNodeMeta>) {
  const children = displayNodeChildren(node);

  if (!children) {
    return;
  }

  for (const child of children) {
    const childMeta = metaById.get(displayNodeId(child));

    if (childMeta) {
      childMeta.visibleInFilter = true;
    }

    markDescendantsVisible(child, metaById);
  }
}

export function searchFileTreeDisplayNodes(
  nodes: FileTreeDisplayNode[],
  query: string,
  mode: FileTreeSearchMode
): FileTreeSearchResult {
  const normalizedQuery = normalizeFileTreeSearchQuery(query);
  const flattened = flattenDisplayNodes(nodes);
  const metaById = initializeMeta(flattened, !normalizedQuery);
  const matches: FileTreeSearchMatch[] = [];
  const filterAncestorPaths = new Set<string>();

  if (!normalizedQuery) {
    return { normalizedQuery, matches, metaById, filterAncestorPaths };
  }

  for (const node of flattened) {
    const selfRanges = matchFileTreeSearchRanges(node.displayName, normalizedQuery, mode);

    if (selfRanges.length === 0) {
      continue;
    }

    matches.push({
      id: node.id,
      path: node.path,
      relativePath: node.relativePath,
      displayName: node.displayName,
      selfRanges,
      ancestorPaths: node.ancestorPaths
    });

    const selfMeta = metaById.get(node.id);

    if (selfMeta) {
      selfMeta.selfMatch = true;
      selfMeta.selfRanges = selfRanges;
      selfMeta.visibleInFilter = true;
    }

    for (const ancestorPath of node.ancestorPaths) {
      filterAncestorPaths.add(ancestorPath);
      const ancestorMeta = metaById.get(ancestorPath);

      if (ancestorMeta) {
        ancestorMeta.descendantMatchCount += 1;
        ancestorMeta.visibleInFilter = true;
      }
    }
  }

  const markMatchingDirectoryDescendants = (treeNodes: FileTreeDisplayNode[]) => {
    for (const node of treeNodes) {
      const meta = metaById.get(displayNodeId(node));

      if (meta?.selfMatch && displayNodeKind(node) === "directory") {
        markDescendantsVisible(node, metaById);
      }

      const children = displayNodeChildren(node);

      if (children) {
        markMatchingDirectoryDescendants(children);
      }
    }
  };

  markMatchingDirectoryDescendants(nodes);

  return { normalizedQuery, matches, metaById, filterAncestorPaths };
}

export function filterFileTreeDisplayNodesForSearch(
  nodes: FileTreeDisplayNode[],
  result: FileTreeSearchResult
): FileTreeDisplayNode[] {
  const filterNode = (node: FileTreeDisplayNode): FileTreeDisplayNode | null => {
    const meta = result.metaById.get(displayNodeId(node));

    if (!meta?.visibleInFilter) {
      return null;
    }

    const children = displayNodeChildren(node);

    if (!children) {
      return node;
    }

    const filteredChildren = children
      .map((child) => filterNode(child))
      .filter((child): child is FileTreeDisplayNode => child !== null);

    if (node.source === "real") {
      return { ...node, children: filteredChildren.length > 0 ? filteredChildren : undefined };
    }

    if (node.source === "pending-dir") {
      return { ...node, children: filteredChildren };
    }

    return node;
  };

  return nodes.map((node) => filterNode(node)).filter((node): node is FileTreeDisplayNode => node !== null);
}

export function clampFileTreeSearchActiveIndex(index: number, matchCount: number) {
  if (matchCount <= 0) {
    return -1;
  }

  if (index < 0) {
    return 0;
  }

  return Math.min(index, matchCount - 1);
}

export function moveFileTreeSearchActiveIndex(index: number, matchCount: number, direction: 1 | -1) {
  if (matchCount <= 0) {
    return -1;
  }

  if (index < 0) {
    return direction > 0 ? 0 : matchCount - 1;
  }

  return (index + direction + matchCount) % matchCount;
}
