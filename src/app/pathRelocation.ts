import type { PathRelocation } from "../preferences/namingCandidates";

export interface PathRelocationTargets {
  relocateRecent: (workspaceRoot: string, oldRelativePath: string, newRelativePath: string) => void;
  relocateHistoryPaths: (oldPath: string, newPath: string) => void;
  relocateNamingCandidates: (relocation: PathRelocation) => void;
}

/**
 * The one relocation path (spec 2026-09-27 "Name untitled documents"):
 * every successful in-app rename — manual or automatic — and every move
 * relocates recents (workspace-relative), Back/Forward history (absolute) and
 * naming candidates (which also read the reason).
 */
export function applyPathRelocation(relocation: PathRelocation, targets: PathRelocationTargets) {
  targets.relocateRecent(relocation.workspaceRoot, relocation.oldRelativePath, relocation.newRelativePath);
  targets.relocateHistoryPaths(relocation.oldPath, relocation.newPath);
  targets.relocateNamingCandidates(relocation);
}
