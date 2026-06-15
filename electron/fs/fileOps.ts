import { cp, lstat, mkdir, readdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ensureInsideWorkspace,
  ensureMarkdownFile,
  ensureVisibleWorkspacePath,
  ignoredNames,
  normalizeMarkdownName,
  toKind,
  validateDirectoryName,
  validateMarkdownRenameName,
  validateVisibleFileName,
  type FileKind
} from "./pathSafety.js";

export type { FileKind };

export interface FileTreeNode {
  name: string;
  path: string;
  relativePath: string;
  kind: FileKind;
  children?: FileTreeNode[];
}

export interface SaveImageAssetRequest {
  workspaceRoot: string;
  documentPath: string;
  dataUrl: string;
  originalName?: string;
}

export interface SavedImageAsset {
  filePath: string;
  relativePath: string;
  markdown: string;
}

export interface ReferenceImageAssetRequest {
  workspaceRoot: string;
  documentPath: string;
  imagePath: string;
}

function fileTreeNode(workspaceRoot: string, filePath: string, isDirectory: boolean): FileTreeNode {
  return {
    name: path.basename(filePath),
    path: filePath,
    relativePath: path.relative(workspaceRoot, filePath),
    kind: toKind(filePath, isDirectory),
    children: isDirectory ? [] : undefined
  };
}

export async function readDirectory(rootPath: string, currentPath = rootPath): Promise<FileTreeNode[]> {
  const entries = await readdir(currentPath, { withFileTypes: true });
  const visibleEntries = entries.filter((entry) => !entry.name.startsWith(".") && !ignoredNames.has(entry.name));

  const nodes = await Promise.all(
    visibleEntries.map(async (entry) => {
      const absolutePath = path.join(currentPath, entry.name);
      const node = fileTreeNode(rootPath, absolutePath, entry.isDirectory());

      if (entry.isDirectory()) {
        node.children = await readDirectory(rootPath, absolutePath);
      }

      return node;
    })
  );

  return nodes.sort((a, b) => {
    const rank = (node: FileTreeNode) => {
      const isAssetDirectory = node.kind === "directory" && node.name === "assets";

      if (node.kind === "directory" && !isAssetDirectory) {
        return 0;
      }

      if (node.kind === "markdown") {
        return 1;
      }

      if (isAssetDirectory) {
        return 2;
      }

      return 3;
    };
    const rankDifference = rank(a) - rank(b);

    if (rankDifference !== 0) {
      return rankDifference;
    }

    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

export async function readMarkdownFile(workspaceRoot: string, filePath: string) {
  ensureMarkdownFile(workspaceRoot, filePath);

  return readFile(filePath, "utf8");
}

export async function writeMarkdownFile(workspaceRoot: string, filePath: string, content: string) {
  ensureMarkdownFile(workspaceRoot, filePath);
  await writeFile(filePath, content, "utf8");

  return { savedAt: new Date().toISOString() };
}

function duplicateName(name: string) {
  const extension = path.extname(name);
  const baseName = extension ? path.basename(name, extension) : name;

  return `${baseName} copy${extension}`;
}

async function uniquePath(directoryPath: string, preferredName: string) {
  const extension = path.extname(preferredName);
  const baseName = path.basename(preferredName, extension);
  let candidate = path.join(directoryPath, preferredName);
  let index = 2;

  while (true) {
    try {
      await stat(candidate);
      candidate = path.join(directoryPath, `${baseName}-${index}${extension}`);
      index += 1;
    } catch {
      return candidate;
    }
  }
}

async function assertPathAvailable(filePath: string) {
  try {
    await stat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }

    throw error;
  }

  throw new Error("A file with that name already exists.");
}

function pathIsSameOrInside(parentPath: string, candidatePath: string) {
  const parent = path.resolve(parentPath);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(parent, candidate);

  return !relative || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function assertVisiblePathHasNoSymlinkAncestor(workspaceRoot: string, filePath: string) {
  ensureVisibleWorkspacePath(workspaceRoot, filePath);

  const root = path.resolve(workspaceRoot);
  const target = path.resolve(filePath);
  const relative = path.relative(root, target);

  if (!relative) {
    return;
  }

  let currentPath = root;

  for (const segment of relative.split(path.sep)) {
    if (!segment) {
      continue;
    }

    currentPath = path.join(currentPath, segment);
    const stats = await lstat(currentPath);

    if (stats.isSymbolicLink()) {
      throw new Error("Symlinked paths cannot be moved.");
    }
  }
}

export async function createMarkdownFile(workspaceRoot: string, directoryPath: string, requestedName: string) {
  ensureVisibleWorkspacePath(workspaceRoot, directoryPath);
  const fileName = normalizeMarkdownName(requestedName);
  const filePath = await uniquePath(directoryPath, fileName);
  ensureVisibleWorkspacePath(workspaceRoot, filePath);
  await writeFile(filePath, `# ${path.basename(filePath, path.extname(filePath))}\n`, "utf8");

  return fileTreeNode(workspaceRoot, filePath, false);
}

export async function createFolder(workspaceRoot: string, directoryPath: string, requestedName: string) {
  ensureVisibleWorkspacePath(workspaceRoot, directoryPath);
  const folderName = validateDirectoryName(requestedName || "untitled folder");
  const folderPath = await uniquePath(directoryPath, folderName);
  ensureVisibleWorkspacePath(workspaceRoot, folderPath);
  await mkdir(folderPath);

  return fileTreeNode(workspaceRoot, folderPath, true);
}

export async function renamePath(workspaceRoot: string, filePath: string, requestedName: string) {
  ensureVisibleWorkspacePath(workspaceRoot, filePath);

  const parentDirectory = path.dirname(filePath);
  const fileStats = await stat(filePath);
  const fileName = fileStats.isDirectory()
    ? validateDirectoryName(requestedName)
    : toKind(filePath, false) === "markdown"
      ? validateMarkdownRenameName(requestedName)
      : validateVisibleFileName(requestedName);
  const newPath = path.join(parentDirectory, fileName);
  ensureVisibleWorkspacePath(workspaceRoot, newPath);

  if (path.resolve(newPath) !== path.resolve(filePath)) {
    await assertPathAvailable(newPath);
  }

  await rename(filePath, newPath);

  return fileTreeNode(workspaceRoot, newPath, fileStats.isDirectory());
}

export async function movePath(workspaceRoot: string, sourcePath: string, targetDirectoryPath: string) {
  ensureVisibleWorkspacePath(workspaceRoot, sourcePath);
  ensureVisibleWorkspacePath(workspaceRoot, targetDirectoryPath);

  if (path.resolve(sourcePath) === path.resolve(workspaceRoot)) {
    throw new Error("The workspace root cannot be moved.");
  }

  await assertVisiblePathHasNoSymlinkAncestor(workspaceRoot, sourcePath);
  await assertVisiblePathHasNoSymlinkAncestor(workspaceRoot, targetDirectoryPath);

  const sourceStats = await lstat(sourcePath);
  const targetDirectoryStats = await lstat(targetDirectoryPath);

  if (sourceStats.isSymbolicLink() || targetDirectoryStats.isSymbolicLink()) {
    throw new Error("Symlinked paths cannot be moved.");
  }

  if (!targetDirectoryStats.isDirectory()) {
    throw new Error("Move target must be a folder.");
  }

  if (sourceStats.isDirectory() && pathIsSameOrInside(sourcePath, targetDirectoryPath)) {
    throw new Error("A folder cannot be moved into itself.");
  }

  const targetPath = path.join(targetDirectoryPath, path.basename(sourcePath));
  ensureVisibleWorkspacePath(workspaceRoot, targetPath);

  if (path.resolve(targetPath) === path.resolve(sourcePath)) {
    return fileTreeNode(workspaceRoot, sourcePath, sourceStats.isDirectory());
  }

  await assertPathAvailable(targetPath);
  await rename(sourcePath, targetPath);

  return fileTreeNode(workspaceRoot, targetPath, sourceStats.isDirectory());
}

export async function duplicatePath(workspaceRoot: string, filePath: string) {
  ensureVisibleWorkspacePath(workspaceRoot, filePath);

  const fileStats = await stat(filePath);

  if (fileStats.isDirectory()) {
    throw new Error("Folder duplication is not supported yet.");
  }

  const parentDirectory = path.dirname(filePath);
  const preferredName = duplicateName(path.basename(filePath));
  const duplicatePath = await uniquePath(parentDirectory, preferredName);
  ensureVisibleWorkspacePath(workspaceRoot, duplicatePath);
  await cp(filePath, duplicatePath);

  return fileTreeNode(workspaceRoot, duplicatePath, false);
}

export async function assertTrashablePath(workspaceRoot: string, filePath: string) {
  ensureVisibleWorkspacePath(workspaceRoot, filePath);
  await stat(filePath);
}

function timestampForFileName() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");

  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds())
  ].join("");
}

const supportedImageMimeExtensions = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/gif", ".gif"],
  ["image/webp", ".webp"],
  ["image/svg+xml", ".svg"]
]);
const supportedImageExtensions = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]);

function supportedImageExtension(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  return supportedImageExtensions.has(extension) ? extension : null;
}

function extensionFromDataUrl(dataUrl: string) {
  const mime = /^data:([^;]+);base64,/.exec(dataUrl)?.[1]?.toLowerCase();
  const extension = mime ? supportedImageMimeExtensions.get(mime) : null;

  if (!extension) {
    throw new Error("This image format is not supported.");
  }

  return extension;
}

function dataUrlToBuffer(dataUrl: string) {
  const match = /^data:[^;]+;base64,(.+)$/.exec(dataUrl);

  if (!match) {
    throw new Error("Image data must be a base64 data URL.");
  }

  return Buffer.from(match[1], "base64");
}

function markdownRelativePath(fromDocument: string, toAsset: string) {
  const relativePath = path.relative(path.dirname(fromDocument), toAsset).split(path.sep).join("/");
  const normalizedRelativePath = relativePath.startsWith("../")
    ? relativePath
    : relativePath.startsWith(".")
      ? relativePath
      : `./${relativePath}`;

  return normalizedRelativePath
    .split("/")
    .map((segment) =>
      segment === "." || segment === ".."
        ? segment
        : encodeURIComponent(segment).replace(/\(/g, "%28").replace(/\)/g, "%29")
    )
    .join("/");
}

function assetSlugFromDocument(documentPath: string) {
  const slug = path
    .basename(documentPath, path.extname(documentPath))
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "image";
}

function imageAltText(filePath: string, fallback = "Image") {
  const stem = path.basename(filePath, path.extname(filePath)).replace(/[-_]+/g, " ").trim();
  const alt = stem || fallback;

  return alt.replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

function assertWorkspacePathHasNoIgnoredSegments(workspaceRoot: string, filePath: string) {
  ensureVisibleWorkspacePath(workspaceRoot, filePath);

  const relative = path.relative(path.resolve(workspaceRoot), path.resolve(filePath));
  const segments = relative.split(path.sep).filter(Boolean);

  if (segments.some((segment) => ignoredNames.has(segment))) {
    throw new Error("Ignored paths are not available in this workspace.");
  }
}

async function assertWorkspaceAssetPathIsVisible(workspaceRoot: string, filePath: string) {
  assertWorkspacePathHasNoIgnoredSegments(workspaceRoot, filePath);

  const root = path.resolve(workspaceRoot);
  const target = path.resolve(filePath);
  const relative = path.relative(root, target);

  if (!relative) {
    return;
  }

  let currentPath = root;

  for (const segment of relative.split(path.sep)) {
    if (!segment) {
      continue;
    }

    currentPath = path.join(currentPath, segment);
    const stats = await lstat(currentPath);

    if (stats.isSymbolicLink()) {
      throw new Error("Symlinked image paths are not supported.");
    }
  }

  const realRoot = await realpath(root);
  const realTarget = await realpath(target);
  const realRelative = path.relative(realRoot, realTarget);

  if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
    throw new Error("Requested path is outside the current workspace.");
  }
}

async function assertExistingWorkspaceImage(workspaceRoot: string, imagePath: string) {
  await assertWorkspaceAssetPathIsVisible(workspaceRoot, imagePath);

  if (!supportedImageExtension(imagePath)) {
    throw new Error("This image format is not supported.");
  }

  const stats = await lstat(imagePath);

  if (!stats.isFile()) {
    throw new Error("Image path must be a file.");
  }
}

export async function saveImageAsset(request: SaveImageAssetRequest): Promise<SavedImageAsset> {
  ensureMarkdownFile(request.workspaceRoot, request.documentPath);
  const documentSlug = assetSlugFromDocument(request.documentPath);
  const assetDirectory = path.join(path.dirname(request.documentPath), "assets");
  ensureInsideWorkspace(request.workspaceRoot, assetDirectory);
  await mkdir(assetDirectory, { recursive: true });

  const extension = extensionFromDataUrl(request.dataUrl);
  const fileName = `${documentSlug}-${timestampForFileName()}${extension}`;
  const filePath = await uniquePath(assetDirectory, fileName);
  ensureInsideWorkspace(request.workspaceRoot, filePath);
  await writeFile(filePath, dataUrlToBuffer(request.dataUrl));

  const relativePath = markdownRelativePath(request.documentPath, filePath);
  const altText = request.originalName ? imageAltText(request.originalName) : "Image";

  return {
    filePath,
    relativePath,
    markdown: `![${altText}](${relativePath})`
  };
}

export async function referenceWorkspaceImageAsset(
  request: ReferenceImageAssetRequest
): Promise<SavedImageAsset> {
  ensureMarkdownFile(request.workspaceRoot, request.documentPath);
  await assertExistingWorkspaceImage(request.workspaceRoot, request.imagePath);

  const relativePath = markdownRelativePath(request.documentPath, request.imagePath);

  return {
    filePath: request.imagePath,
    relativePath,
    markdown: `![${imageAltText(request.imagePath)}](${relativePath})`
  };
}
