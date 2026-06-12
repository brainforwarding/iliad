import path from "node:path";
import { ignoredNames, markdownExtensions } from "../fs/pathSafety.js";

export function toPosixPath(value: string) {
  return value.replace(/\\/g, "/");
}

export function isPlausibleExtensionlessMarkdownMention(normalizedPath: string) {
  if (path.posix.extname(normalizedPath)) {
    return false;
  }

  return normalizedPath.includes("/") || (normalizedPath.includes("-") && !/\d/u.test(normalizedPath));
}

/**
 * The strict display-path gate for any workspace-relative path that may reach
 * prompt scaffolding or manifest receipts: rejects control characters (macOS
 * filenames can contain newlines, which would inject lines into the prompt),
 * backslashes, drive letters, absolute and non-normalized paths, hidden
 * segments, and ignored names; requires a Markdown extension unless the caller
 * explicitly allows plausible extensionless mentions.
 */
export function safeDisplayPath(
  rawPath: string,
  { allowExtensionless = false, requireMarkdown = true }: { allowExtensionless?: boolean; requireMarkdown?: boolean } = {}
) {
  if (!rawPath || /[\u0000-\u001F\u007F]/u.test(rawPath) || rawPath.includes("\\")) {
    return undefined;
  }

  const normalized = toPosixPath(rawPath);

  if (/^[A-Za-z]:/.test(normalized) || path.posix.isAbsolute(normalized) || path.posix.normalize(normalized) !== normalized) {
    return undefined;
  }

  const extension = path.posix.extname(normalized).toLowerCase();

  if (
    requireMarkdown &&
    !markdownExtensions.has(extension) &&
    !(allowExtensionless && isPlausibleExtensionlessMarkdownMention(normalized))
  ) {
    return undefined;
  }

  const segments = normalized.split("/");

  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment.startsWith(".") || ignoredNames.has(segment))) {
    return undefined;
  }

  return normalized;
}
