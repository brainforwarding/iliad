import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { isIgnoredWorkspaceName, markdownExtensions } from "../fs/pathSafety.js";
import { canonicalizeWorkspaceDirectory, type WorkspaceInfo } from "../launch/workspace.js";
import type { CliOpenResult } from "./openRequests.js";
import type { CliRequest, CliResponse, CliWindowStatus } from "./protocol.js";

export interface CliWindowTarget {
  webContentsId: number;
  workspaceRoot: string;
}

/** What the CLI handler needs from the window manager. */
export interface CliWindowHost {
  listWindowStatus: () => CliWindowStatus[];
  findWindowForPath: (absolutePath: string) => CliWindowTarget | null;
  openWorkspaceWindow: (workspace: WorkspaceInfo) => CliWindowTarget;
  focusWindow: (webContentsId: number) => void;
  requestOpenDocument: (webContentsId: number, request: { path: string; line: number | null }) => Promise<CliOpenResult>;
}

export function isPathInside(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/** True when any name along the path (relative or absolute) is hidden or ignored. */
export function hasIgnoredSegment(somePath: string) {
  return somePath.split(path.sep).filter(Boolean).some(isIgnoredWorkspaceName);
}

async function openDocument(
  host: CliWindowHost,
  request: Extract<CliRequest, { cmd: "open" }>,
  canonicalizeWorkspace: (directory: string) => Promise<WorkspaceInfo>
): Promise<CliResponse> {
  if (!path.isAbsolute(request.path)) {
    return { ok: false, error: "open needs an absolute file path." };
  }

  let filePath: string;

  try {
    filePath = await realpath(request.path);
  } catch {
    return { ok: false, error: `File not found: ${request.path}` };
  }

  if (!(await stat(filePath)).isFile()) {
    return { ok: false, error: `Not a file: ${request.path}` };
  }

  if (!markdownExtensions.has(path.extname(filePath).toLowerCase())) {
    return { ok: false, error: `Not a Markdown file: ${request.path}` };
  }

  const hiddenError: CliResponse = { ok: false, error: `Iliad does not show hidden or ignored files: ${request.path}` };
  const requestedPath = path.resolve(request.path);
  let target = host.findWindowForPath(filePath);

  if (target) {
    // Inside an open workspace, only the part below its root must be visible
    // (for both the canonical and the requested spelling of the path).
    const root = target.workspaceRoot;

    if (
      hasIgnoredSegment(path.relative(root, filePath)) ||
      (isPathInside(root, requestedPath) && hasIgnoredSegment(path.relative(root, requestedPath)))
    ) {
      return hiddenError;
    }
  } else if (hasIgnoredSegment(requestedPath) || hasIgnoredSegment(filePath)) {
    // A new window would open the file's own folder: never a hidden or
    // ignored one, whichever spelling of the path shows it.
    return hiddenError;
  }

  if (target) {
    host.focusWindow(target.webContentsId);
  } else {
    // No window shows this file: open its own folder (never the git root).
    target = host.openWorkspaceWindow(await canonicalizeWorkspace(path.dirname(filePath)));
  }

  const result = await host.requestOpenDocument(target.webContentsId, { path: filePath, line: request.line });
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

export function createCliRequestHandler({
  host,
  canonicalizeWorkspace = canonicalizeWorkspaceDirectory
}: {
  host: CliWindowHost;
  canonicalizeWorkspace?: (directory: string) => Promise<WorkspaceInfo>;
}) {
  return async (request: CliRequest): Promise<CliResponse> => {
    switch (request.cmd) {
      case "status":
        return { ok: true, windows: host.listWindowStatus() };
      case "open":
        return openDocument(host, request, canonicalizeWorkspace);
    }
  };
}
