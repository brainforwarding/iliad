export const imageReferenceDragMimeType = "application/x-iliad-image-reference";
export const imageReferenceDragPayloadType = "iliad/image-reference";

const supportedImageExtensions = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]);
const ignoredPathSegments = new Set([".git", ".hg", ".svn", "node_modules", "dist", "dist-electron"]);

export interface ImageReferenceDragPayload {
  type: typeof imageReferenceDragPayloadType;
  workspaceSessionId: string;
  relativePath: string;
}

export function normalizeImageReferenceRelativePath(relativePath: string) {
  const normalizedInput = relativePath.trim().replace(/\\/g, "/").replace(/\/+/g, "/");

  if (!normalizedInput || normalizedInput.startsWith("/") || /^[A-Za-z]:\//.test(normalizedInput)) {
    return "";
  }

  const segments: string[] = [];

  for (const segment of normalizedInput.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }

    if (segment === ".." || segment.startsWith(".") || ignoredPathSegments.has(segment)) {
      return "";
    }

    segments.push(segment);
  }

  const normalized = segments.join("/");
  const lastSegment = segments[segments.length - 1] ?? "";
  const dotIndex = lastSegment.lastIndexOf(".");
  const extension = dotIndex >= 0 ? lastSegment.slice(dotIndex).toLowerCase() : "";

  return supportedImageExtensions.has(extension) ? normalized : "";
}

export function createImageReferenceDragPayload(
  workspaceSessionId: string,
  relativePath: string
): ImageReferenceDragPayload | null {
  const normalizedRelativePath = normalizeImageReferenceRelativePath(relativePath);

  if (!workspaceSessionId || !normalizedRelativePath) {
    return null;
  }

  return {
    type: imageReferenceDragPayloadType,
    workspaceSessionId,
    relativePath: normalizedRelativePath
  };
}

export function readImageReferenceDragPayload(rawPayload: string, expectedWorkspaceSessionId: string) {
  try {
    const payload = JSON.parse(rawPayload) as Partial<ImageReferenceDragPayload>;
    const relativePath =
      typeof payload.relativePath === "string" ? normalizeImageReferenceRelativePath(payload.relativePath) : "";

    if (
      payload.type !== imageReferenceDragPayloadType ||
      payload.workspaceSessionId !== expectedWorkspaceSessionId ||
      !relativePath
    ) {
      return null;
    }

    return createImageReferenceDragPayload(payload.workspaceSessionId, relativePath);
  } catch {
    return null;
  }
}
