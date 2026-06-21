import path from "node:path";

const activeWorkspaceMutationLeases = new Map<string, string>();

function leaseKey(workspaceRoot: string) {
  return path.resolve(workspaceRoot);
}

export function tryAcquireWorkspaceMutationLease(workspaceRoot: string, owner: string) {
  const key = leaseKey(workspaceRoot);

  if (activeWorkspaceMutationLeases.has(key)) {
    return null;
  }

  activeWorkspaceMutationLeases.set(key, owner);

  return () => {
    if (activeWorkspaceMutationLeases.get(key) === owner) {
      activeWorkspaceMutationLeases.delete(key);
    }
  };
}

export function workspaceMutationLeaseOwner(workspaceRoot: string) {
  return activeWorkspaceMutationLeases.get(leaseKey(workspaceRoot)) ?? null;
}
