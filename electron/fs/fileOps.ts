import { constants as fsConstants } from "node:fs";
import { copyFile, cp, link, lstat, mkdir, readdir, readFile, realpath, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  companionKindOf,
  companionPathsFor,
  documentNamesForCompanion,
  type CompanionKind
} from "./companionFiles.js";
import {
  ensureInsideWorkspace,
  ensureMarkdownFile,
  ensureVisibleWorkspacePath,
  ignoredNames,
  isIgnoredWorkspaceName,
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
  /** Set on `stem.comments.md` when the sibling document exists (spec V10). */
  companion?: { kind: CompanionKind; documentPath: string };
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
  const visibleEntries = entries.filter((entry) => !isIgnoredWorkspaceName(entry.name));

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

  annotateCompanions(nodes);

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

/**
 * Marks companion files whose document exists in the same folder. Orphans
 * (no document) stay ordinary rows.
 */
function annotateCompanions(siblings: FileTreeNode[]) {
  const documents = new Map<string, FileTreeNode>();

  for (const node of siblings) {
    if (node.kind === "markdown" && !companionKindOf(node.name)) {
      documents.set(node.name.toLowerCase(), node);
    }
  }

  for (const node of siblings) {
    const kind = node.kind === "markdown" ? companionKindOf(node.name) : null;

    if (!kind) {
      continue;
    }

    const document = documentNamesForCompanion(node.name)
      .map((name) => documents.get(name.toLowerCase()))
      .find((candidate): candidate is FileTreeNode => Boolean(candidate));

    if (document) {
      node.companion = { kind, documentPath: document.path };
    }
  }
}

export async function readMarkdownFile(workspaceRoot: string, filePath: string) {
  ensureMarkdownFile(workspaceRoot, filePath);

  return readFile(filePath, "utf8");
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
  const content = `# ${path.basename(filePath, path.extname(filePath))}\n`;
  await writeFile(filePath, content, "utf8");

  return { ...fileTreeNode(workspaceRoot, filePath, false), content };
}

export async function createFolder(workspaceRoot: string, directoryPath: string, requestedName: string) {
  ensureVisibleWorkspacePath(workspaceRoot, directoryPath);
  const folderName = validateDirectoryName(requestedName || "untitled folder");
  const folderPath = await uniquePath(directoryPath, folderName);
  ensureVisibleWorkspacePath(workspaceRoot, folderPath);
  await mkdir(folderPath);

  return fileTreeNode(workspaceRoot, folderPath, true);
}

async function regularFileExists(filePath: string) {
  try {
    const stats = await lstat(filePath);
    return stats.isFile() && !stats.isSymbolicLink();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

async function pathExists(filePath: string) {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

/** The companion files that exist next to a Markdown document (absolute paths). */
export async function existingCompanions(documentPath: string): Promise<Array<{ kind: CompanionKind; path: string }>> {
  const paths = companionPathsFor(documentPath);

  if (!paths) {
    return [];
  }

  const existing: Array<{ kind: CompanionKind; path: string }> = [];

  for (const kind of ["comments"] as const) {
    if (await regularFileExists(paths[kind])) {
      existing.push({ kind, path: paths[kind] });
    }
  }

  return existing;
}

/** Every path a document's group can occupy: the document plus its companion name. */
export function documentGroupPaths(documentPath: string) {
  const paths = companionPathsFor(documentPath);
  return paths ? [documentPath, paths.comments] : [documentPath];
}

/** Rejects acting on a companion whose document exists: it follows its document. */
async function assertNotAttachedCompanion(filePath: string) {
  if (!companionKindOf(filePath)) {
    return;
  }

  const directory = path.dirname(filePath);

  for (const name of documentNamesForCompanion(path.basename(filePath))) {
    if (await regularFileExists(path.join(directory, name))) {
      throw new Error("Comments files move with their document.");
    }
  }
}

/**
 * Moves one file without ever replacing a file at the target: a hard link
 * fails with EEXIST if anything is there (copy-exclusive across devices),
 * then the source is removed.
 */
async function moveFileNoClobber(from: string, to: string) {
  try {
    await link(from, to);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code !== "EXDEV" && code !== "EPERM" && code !== "ENOTSUP") {
      throw error;
    }

    await copyFile(from, to, fsConstants.COPYFILE_EXCL);
  }

  try {
    await unlink(from);
  } catch (error) {
    await rm(to, { force: true }).catch(() => undefined);
    throw error;
  }
}

function samePath(left: string, right: string) {
  return path.resolve(left) === path.resolve(right);
}

/**
 * Moves a Markdown document and its existing companions as one group (spec
 * V13). The companion name at the destination is checked first, even when
 * the document has no companions yet, so an unrelated `name.comments.md`
 * there is never silently attached. The document and each
 * companion then move without overwriting (hard link, then remove the
 * source); any failure puts back what moved.
 */
async function moveDocumentGroup(workspaceRoot: string, documentPath: string, targetPath: string) {
  const companions = await existingCompanions(documentPath);
  const sources = companionPathsFor(documentPath);
  const targets = companionPathsFor(targetPath);

  if (!targets) {
    throw new Error("This document's comments cannot follow that name.");
  }

  for (const kind of ["comments"] as const) {
    const target = targets[kind];
    ensureVisibleWorkspacePath(workspaceRoot, target);

    // The group's own companion names (same stem, other extension) are not in the way.
    if (sources && samePath(sources[kind], target)) {
      continue;
    }

    if (await pathExists(target)) {
      throw new Error(
        `A comments file named "${path.basename(target)}" already exists there. Rename or remove it first.`
      );
    }
  }

  const moves = companions
    .map((companion) => ({ from: companion.path, to: targets[companion.kind] }))
    .filter((move) => !samePath(move.from, move.to));
  const done: Array<{ from: string; to: string }> = [];

  // The document itself is published no-clobber too: a file that appeared at
  // the destination after the checks is never replaced.
  try {
    await moveFileNoClobber(documentPath, targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("A file with that name already exists.");
    }

    throw error;
  }

  try {
    for (const move of moves) {
      await moveFileNoClobber(move.from, move.to);
      done.push(move);
    }
  } catch (error) {
    for (const move of done.reverse()) {
      await moveFileNoClobber(move.to, move.from).catch(() => undefined);
    }

    await moveFileNoClobber(targetPath, documentPath).catch(() => undefined);
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`The document's comments could not be moved with it, so nothing was moved. (${reason})`);
  }
}

function isDocumentFile(filePath: string, isDirectory: boolean) {
  return !isDirectory && toKind(filePath, false) === "markdown" && !companionKindOf(filePath);
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

  if (!samePath(newPath, filePath)) {
    await assertPathAvailable(newPath);
  }

  if (!fileStats.isDirectory()) {
    await assertNotAttachedCompanion(filePath);
  }

  if (isDocumentFile(filePath, fileStats.isDirectory())) {
    await moveDocumentGroup(workspaceRoot, filePath, newPath);
  } else {
    await rename(filePath, newPath);
  }

  return fileTreeNode(workspaceRoot, newPath, fileStats.isDirectory());
}

/** Best-effort target of a rename, for mutation markers only (never throws). */
export function plannedRenamePath(filePath: string, requestedName: string) {
  try {
    const fileName =
      toKind(filePath, false) === "markdown" ? validateMarkdownRenameName(requestedName) : validateVisibleFileName(requestedName);
    return path.join(path.dirname(filePath), fileName);
  } catch {
    return null;
  }
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

  if (!sourceStats.isDirectory()) {
    await assertNotAttachedCompanion(sourcePath);
  }

  if (isDocumentFile(sourcePath, sourceStats.isDirectory())) {
    await moveDocumentGroup(workspaceRoot, sourcePath, targetPath);
  } else {
    await rename(sourcePath, targetPath);
  }

  return fileTreeNode(workspaceRoot, targetPath, sourceStats.isDirectory());
}

/** The first `name copy`, `name copy-2`, … stem free for the document and both companion names. */
async function uniqueDocumentGroupPath(directoryPath: string, documentName: string) {
  const extension = path.extname(documentName);
  const stem = path.basename(documentName, extension);

  for (let index = 1; ; index += 1) {
    const candidate = path.join(directoryPath, `${stem} copy${index === 1 ? "" : `-${index}`}${extension}`);
    const taken = await Promise.all(documentGroupPaths(candidate).map(pathExists));

    if (!taken.some(Boolean)) {
      return candidate;
    }
  }
}

export async function duplicatePath(workspaceRoot: string, filePath: string) {
  ensureVisibleWorkspacePath(workspaceRoot, filePath);

  const fileStats = await stat(filePath);

  if (fileStats.isDirectory()) {
    throw new Error("Folder duplication is not supported yet.");
  }

  await assertNotAttachedCompanion(filePath);
  const parentDirectory = path.dirname(filePath);

  if (!isDocumentFile(filePath, false)) {
    const preferredName = duplicateName(path.basename(filePath));
    const duplicatePath = await uniquePath(parentDirectory, preferredName);
    ensureVisibleWorkspacePath(workspaceRoot, duplicatePath);
    await cp(filePath, duplicatePath);

    return fileTreeNode(workspaceRoot, duplicatePath, false);
  }

  const duplicatePath = await uniqueDocumentGroupPath(parentDirectory, path.basename(filePath));
  const targets = companionPathsFor(duplicatePath);
  ensureVisibleWorkspacePath(workspaceRoot, duplicatePath);
  await copyFile(filePath, duplicatePath, fsConstants.COPYFILE_EXCL);
  const created = [duplicatePath];

  try {
    for (const companion of await existingCompanions(filePath)) {
      const target = targets?.[companion.kind];

      if (target) {
        await copyFile(companion.path, target, fsConstants.COPYFILE_EXCL);
        created.push(target);
      }
    }
  } catch (error) {
    for (const createdPath of created) {
      await rm(createdPath, { force: true }).catch(() => undefined);
    }

    throw error;
  }

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
