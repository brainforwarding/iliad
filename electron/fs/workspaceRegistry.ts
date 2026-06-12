import path from "node:path";

const allowedWorkspaceRoots = new Set<string>();

export function rememberWorkspace(workspaceRoot: string) {
  allowedWorkspaceRoots.add(path.resolve(workspaceRoot));
}

export function isInsideAllowedWorkspace(filePath: string) {
  const target = path.resolve(filePath);

  for (const root of allowedWorkspaceRoots) {
    const relative = path.relative(root, target);

    if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
      return true;
    }
  }

  return false;
}
