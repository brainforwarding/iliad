import { realpath, stat } from "node:fs/promises";
import path from "node:path";

export interface WorkspaceInfo {
  name: string;
  path: string;
  sessionId?: string;
}

export async function canonicalizeWorkspaceDirectory(workspacePath: string): Promise<WorkspaceInfo> {
  const resolvedPath = path.resolve(workspacePath);
  const pathStats = await stat(resolvedPath);

  if (!pathStats.isDirectory()) {
    throw new Error(`Workspace path is not a directory: ${resolvedPath}`);
  }

  const canonicalPath = await realpath(resolvedPath);

  return {
    name: path.basename(canonicalPath) || canonicalPath,
    path: canonicalPath
  };
}

export function workspaceKey(workspacePath: string) {
  return process.platform === "win32" ? workspacePath.toLowerCase() : workspacePath;
}
