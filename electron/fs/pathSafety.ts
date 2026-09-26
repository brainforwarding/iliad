import path from "node:path";
import { realpathSync } from "node:fs";
import { companionNameMessage, isCompanionPath } from "./companionFiles.js";

export type FileKind = "directory" | "markdown" | "external";

export const ignoredNames = new Set(["node_modules", "dist", "dist-electron"]);
export const markdownExtensions = new Set([".md", ".markdown", ".mdown", ".mkd"]);

export function isIgnoredWorkspaceName(name: string) {
  return (
    name.startsWith(".") ||
    ignoredNames.has(name) ||
    /^__tmp(?:[-_.]|$)/i.test(name) ||
    name.endsWith(".tmp") ||
    name.endsWith("~")
  );
}

export function toKind(filePath: string, isDirectory: boolean): FileKind {
  if (isDirectory) {
    return "directory";
  }

  return markdownExtensions.has(path.extname(filePath).toLowerCase()) ? "markdown" : "external";
}

export function ensureInsideWorkspace(workspaceRoot: string, filePath: string) {
  const root = path.resolve(workspaceRoot);
  const target = path.resolve(filePath);
  const relative = path.relative(root, target);

  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Requested path is outside the current workspace.");
  }
  // Resolve existing ancestors too: a not-yet-created file can sit below a junction.
  const physical = (value: string): string => {
    try { return realpathSync(value); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = path.dirname(value);
      return parent === value ? value : path.join(physical(parent), path.basename(value));
    }
  };
  const physicalRelative = path.relative(physical(root), physical(target));
  if (physicalRelative === ".." || physicalRelative.startsWith(`..${path.sep}`) || path.isAbsolute(physicalRelative)) {
    throw new Error("Requested path is outside the current workspace (symbolic link or junction).");
  }
}

export function validatePlatformName(name: string, platform: NodeJS.Platform = process.platform) {
  if (platform !== "win32") return;
  if (/[<>:"/\\|?*\u0000-\u001f]/.test(name) || /[. ]$/.test(name) ||
      /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name)) {
    throw new Error("This name is not valid on Windows. Avoid reserved names, special characters, and trailing dots or spaces.");
  }
}

export function ensureVisibleWorkspacePath(workspaceRoot: string, filePath: string) {
  ensureInsideWorkspace(workspaceRoot, filePath);

  const relative = path.relative(path.resolve(workspaceRoot), path.resolve(filePath));
  const segments = relative.split(path.sep);

  if (segments.some((segment) => segment.startsWith(".") || /^__tmp(?:[-_.]|$)/i.test(segment))) {
    throw new Error("Hidden paths are not available in this workspace.");
  }
}

export function ensureMarkdownFile(workspaceRoot: string, filePath: string) {
  ensureVisibleWorkspacePath(workspaceRoot, filePath);

  if (toKind(filePath, false) !== "markdown") {
    throw new Error("Only Markdown files can be edited here.");
  }
}

export function normalizeMarkdownName(name: string) {
  if (name) validatePlatformName(name);
  const trimmedName = name.trim();
  const candidateName = trimmedName || "untitled.md";

  if (candidateName.startsWith(".") || candidateName.includes("/") || candidateName.includes("\\") || candidateName.includes("..")) {
    throw new Error("Markdown file names cannot be hidden paths or contain path separators.");
  }

  const fileName = markdownExtensions.has(path.extname(candidateName).toLowerCase()) ? candidateName : `${candidateName}.md`;

  if (path.basename(fileName) !== fileName) {
    throw new Error("Markdown file names must stay in the current folder.");
  }

  if (isCompanionPath(fileName)) {
    throw new Error(companionNameMessage);
  }

  return fileName;
}

export function validateMarkdownRenameName(name: string) {
  validatePlatformName(name);
  const trimmedName = name.trim();

  if (!trimmedName) {
    throw new Error("File name is required.");
  }

  if (trimmedName.startsWith(".") || trimmedName.includes("/") || trimmedName.includes("\\") || trimmedName.includes("..")) {
    throw new Error("Markdown file names cannot be hidden paths or contain path separators.");
  }

  if (path.basename(trimmedName) !== trimmedName) {
    throw new Error("Markdown file names must stay in the current folder.");
  }

  const extension = path.extname(trimmedName).toLowerCase();

  const fileName = extension ? trimmedName : `${trimmedName}.md`;

  if (extension && !markdownExtensions.has(extension)) {
    throw new Error("Markdown file names must keep a Markdown extension.");
  }

  if (isCompanionPath(fileName)) {
    throw new Error(companionNameMessage);
  }

  return fileName;
}

export function validateDirectoryName(name: string) {
  validatePlatformName(name);
  const trimmedName = name.trim();

  if (!trimmedName) {
    throw new Error("Folder name is required.");
  }

  if (trimmedName.startsWith(".") || trimmedName.includes("/") || trimmedName.includes("\\") || trimmedName.includes("..")) {
    throw new Error("Folder names cannot be hidden paths or contain path separators.");
  }

  if (path.basename(trimmedName) !== trimmedName) {
    throw new Error("Folder names must stay in the current folder.");
  }

  return trimmedName;
}

export function validateVisibleFileName(name: string) {
  validatePlatformName(name);
  const trimmedName = name.trim();

  if (!trimmedName) {
    throw new Error("File name is required.");
  }

  if (trimmedName.startsWith(".") || trimmedName.includes("/") || trimmedName.includes("\\") || trimmedName.includes("..")) {
    throw new Error("File names cannot be hidden paths or contain path separators.");
  }

  if (path.basename(trimmedName) !== trimmedName) {
    throw new Error("File names must stay in the current folder.");
  }

  if (isCompanionPath(trimmedName)) {
    throw new Error(companionNameMessage);
  }

  return trimmedName;
}

export function validateExternalUrl(rawUrl: string) {
  const url = new URL(rawUrl);

  if (!["http:", "https:", "mailto:"].includes(url.protocol)) {
    throw new Error("Only web and mail links can be opened externally.");
  }

  return url.toString();
}
