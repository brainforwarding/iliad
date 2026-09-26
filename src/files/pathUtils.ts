export function parentDirectoryPath(filePath: string) {
  const normalized = filePath.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");

  return index > 0 ? normalized.slice(0, index) : normalized;
}

export function normalizeComparablePath(filePath: string) {
  const slashes = filePath.replace(/\\/g, "/");
  const normalized = slashes === "/" || /^[a-z]:\/$/i.test(slashes) ? slashes : slashes.replace(/\/$/, "");
  // Only Windows absolute paths are case-insensitive; POSIX spelling is significant.
  return /^(?:[a-z]:\/|\/\/)/i.test(normalized) ? normalized.toLowerCase() : normalized;
}

export function pathsEqual(left: string, right: string) {
  return normalizeComparablePath(left) === normalizeComparablePath(right);
}

export function pathIsSameOrInside(parentPath: string, candidatePath: string) {
  const parent = normalizeComparablePath(parentPath);
  const candidate = normalizeComparablePath(candidatePath);

  return candidate === parent || candidate.startsWith(parent.endsWith("/") ? parent : `${parent}/`);
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

  return `${newRoot.replace(/\\/g, "/")}/${candidatePath.replace(/\\/g, "/").slice(oldComparable.length + 1)}`;
}
