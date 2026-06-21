import path from "node:path";

const defaultMarkerTtlMs = 1500;

interface WorkspaceMutationMarkers {
  workspaceExpiresAt: number;
  paths: Map<string, number>;
}

const markersByWorkspace = new Map<string, WorkspaceMutationMarkers>();

function workspaceKey(workspaceRoot: string) {
  return path.resolve(workspaceRoot);
}

function normalizeRelativePath(workspaceRoot: string, filePath: string | Buffer | null | undefined) {
  if (!filePath) {
    return null;
  }

  const rawPath = typeof filePath === "string" ? filePath : filePath.toString("utf8");
  const normalized = path.normalize(rawPath);
  const relativePath = path.isAbsolute(normalized) ? path.relative(workspaceRoot, normalized) : normalized;

  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return null;
  }

  return relativePath;
}

function pruneWorkspaceMarkers(key: string, now = Date.now()) {
  const markers = markersByWorkspace.get(key);

  if (!markers) {
    return null;
  }

  for (const [relativePath, expiresAt] of markers.paths) {
    if (expiresAt <= now) {
      markers.paths.delete(relativePath);
    }
  }

  if (markers.workspaceExpiresAt <= now && markers.paths.size === 0) {
    markersByWorkspace.delete(key);
    return null;
  }

  return markers;
}

export function markWorkspaceMutation(
  workspaceRoot: string,
  filePaths?: Array<string | Buffer | null | undefined>,
  ttlMs = defaultMarkerTtlMs
) {
  const key = workspaceKey(workspaceRoot);
  const expiresAt = Date.now() + ttlMs;
  const markers = pruneWorkspaceMarkers(key) ?? {
    workspaceExpiresAt: 0,
    paths: new Map<string, number>()
  };

  if (!filePaths || filePaths.length === 0) {
    markers.workspaceExpiresAt = Math.max(markers.workspaceExpiresAt, expiresAt);
  } else {
    for (const filePath of filePaths) {
      const relativePath = normalizeRelativePath(key, filePath);

      if (relativePath) {
        markers.paths.set(relativePath, Math.max(markers.paths.get(relativePath) ?? 0, expiresAt));
      }
    }
  }

  markersByWorkspace.set(key, markers);
}

export async function trackWorkspaceMutation<T>(
  workspaceRoot: string,
  filePaths: Array<string | Buffer | null | undefined> | undefined,
  operation: () => Promise<T>
): Promise<T> {
  markWorkspaceMutation(workspaceRoot, filePaths);

  try {
    return await operation();
  } finally {
    markWorkspaceMutation(workspaceRoot, filePaths);
  }
}

export function workspaceMutationMarkerMatches(
  workspaceRoot: string,
  filePath?: string | Buffer | null,
  now = Date.now()
) {
  const key = workspaceKey(workspaceRoot);
  const markers = pruneWorkspaceMarkers(key, now);

  if (!markers) {
    return false;
  }

  if (markers.workspaceExpiresAt > now) {
    return true;
  }

  const relativePath = normalizeRelativePath(key, filePath);

  return relativePath ? (markers.paths.get(relativePath) ?? 0) > now : false;
}

export function clearWorkspaceMutationMarkersForTests() {
  markersByWorkspace.clear();
}
