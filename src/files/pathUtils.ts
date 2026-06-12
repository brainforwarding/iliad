export function parentDirectoryPath(filePath: string) {
  const normalized = filePath.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");

  return index > 0 ? normalized.slice(0, index) : normalized;
}

function normalizeComparablePath(filePath: string) {
  return filePath.replace(/\\/g, "/");
}

export function pathIsSameOrInside(parentPath: string, candidatePath: string) {
  const parent = normalizeComparablePath(parentPath);
  const candidate = normalizeComparablePath(candidatePath);

  return candidate === parent || candidate.startsWith(`${parent}/`);
}

export function relocatePath(oldRoot: string, newRoot: string, candidatePath: string) {
  const oldComparable = normalizeComparablePath(oldRoot);
  const candidateComparable = normalizeComparablePath(candidatePath);

  if (candidateComparable === oldComparable) {
    return newRoot;
  }

  if (!candidateComparable.startsWith(`${oldComparable}/`)) {
    return candidatePath;
  }

  return `${normalizeComparablePath(newRoot)}/${candidateComparable.slice(oldComparable.length + 1)}`;
}
