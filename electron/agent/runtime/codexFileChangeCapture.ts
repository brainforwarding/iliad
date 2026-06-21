import { mkdir, lstat, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureInsideWorkspace, ignoredNames, markdownExtensions } from "../../fs/pathSafety.js";
import { unifiedDiff } from "../diff.js";
import { hashMarkdown } from "../hash.js";
import type { AgentDraftFileChange, AgentRunRequest } from "../types.js";
import { convertCodexFileUpdateChangeToDraft } from "./codexPatchConversion.js";

export interface CodexCapturedFileChange {
  path: string;
  kind: { type: string; move_path?: string | null } | { type: string };
  diff: string;
}

export type CodexCapturedFileChangeMap = Map<string, CodexCapturedFileChange[]>;

export interface MarkdownSnapshotEntry {
  absolutePath: string;
  relativePath: string;
  content: string;
  baseHash: string;
  existed: boolean;
}

export interface MarkdownSnapshot {
  workspaceRoot: string;
  files: Map<string, MarkdownSnapshotEntry>;
}

export interface ConvertAndReconcileResult {
  draftFileChanges: AgentDraftFileChange[];
  notes: string[];
  unsupportedNotes: string[];
  sourceCounts: {
    protocol: number;
    disk: number;
    restored: number;
    skipped: number;
  };
}

interface DraftWithSource {
  draft: AgentDraftFileChange;
  source: "protocol" | "disk";
}

interface ProtocolConversionError {
  relativePath: string | null;
  message: string;
}

export async function captureMarkdownSnapshot(request: AgentRunRequest): Promise<MarkdownSnapshot> {
  const workspaceRoot = path.resolve(request.workspaceRoot);
  const files = new Map<string, MarkdownSnapshotEntry>();

  await scanMarkdownFiles(workspaceRoot, workspaceRoot, files);

  if (request.activeFile) {
    const relativePathResult = normalizeWorkspaceRelativeMarkdownPath(workspaceRoot, request.activeFile.relativePath);

    if (relativePathResult.ok && !(await isExistingUnsafePath(workspaceRoot, relativePathResult.value))) {
      files.set(relativePathResult.value, {
        absolutePath: path.join(workspaceRoot, relativePathResult.value),
        relativePath: relativePathResult.value,
        content: request.activeFile.content,
        baseHash: request.activeFile.baseHash,
        existed: true
      });
    }
  }

  return { workspaceRoot, files };
}

export async function convertAndReconcileCodexFileChanges({
  snapshot,
  fileChanges,
  unsupportedNotes
}: {
  snapshot: MarkdownSnapshot;
  fileChanges: CodexCapturedFileChangeMap;
  unsupportedNotes: Set<string>;
}): Promise<ConvertAndReconcileResult> {
  const notes: string[] = [];
  const protocolErrors: ProtocolConversionError[] = [];
  const protocolDrafts: DraftWithSource[] = [];
  let protocolCount = 0;
  let skippedCount = 0;

  for (const changes of fileChanges.values()) {
    for (const change of changes) {
      const normalizedPath = normalizeWorkspaceRelativeMarkdownPath(snapshot.workspaceRoot, change.path);

      if (!normalizedPath.ok) {
        protocolErrors.push({ relativePath: null, message: normalizedPath.error });
        skippedCount += 1;
        continue;
      }

      const relativePath = normalizedPath.value;
      if (await isExistingUnsafePath(snapshot.workspaceRoot, relativePath)) {
        protocolErrors.push({
          relativePath,
          message: `Codex path was skipped because it is not a regular visible Markdown file: ${relativePath}.`
        });
        skippedCount += 1;
        continue;
      }

      const baseEntry = snapshot.files.get(relativePath);
      const kind = change.kind.type;
      let result;

      if (kind === "add") {
        result = convertCodexFileUpdateChangeToDraft(
          {
            path: relativePath,
            kind: change.kind,
            diff: change.diff
          },
          {
            targetExists: Boolean(baseEntry?.existed)
          }
        );
      } else if (kind === "update" && "move_path" in change.kind && change.kind.move_path) {
        result = convertCodexFileUpdateChangeToDraft({
          path: relativePath,
          kind: change.kind,
          diff: change.diff
        });
      } else if (kind === "update") {
        if (!baseEntry?.existed) {
          result = {
            status: "error" as const,
            draftFileChanges: [] as AgentDraftFileChange[],
            notes: [] as string[],
            error: `Base content is unavailable for Codex update: ${relativePath}.`
          };
        } else {
          result = convertCodexFileUpdateChangeToDraft(
            {
              path: relativePath,
              kind: change.kind,
              diff: change.diff
            },
            { baseContent: baseEntry.content, baseHash: baseEntry.baseHash }
          );
        }
      } else {
        result = convertCodexFileUpdateChangeToDraft({
          path: relativePath,
          kind: change.kind,
          diff: change.diff
        });
      }

      if (result.status === "converted") {
        for (const draft of result.draftFileChanges) {
          protocolDrafts.push({ draft, source: "protocol" });
          protocolCount += 1;
        }
        notes.push(...result.notes);
      } else if (result.status === "skipped") {
        skippedCount += 1;
        for (const note of result.notes) {
          unsupportedNotes.add(note);
        }
      } else {
        skippedCount += 1;
        protocolErrors.push({ relativePath, message: result.error });
      }
    }
  }

  const postSnapshot = await captureDiskMarkdownSnapshot(snapshot.workspaceRoot);
  const diskDrafts = reconcileDiskDrafts(snapshot, postSnapshot, unsupportedNotes);
  appendUnrecoveredProtocolErrors(notes, protocolErrors, diskDrafts);
  const mergedDrafts = mergeDraftsByPath(protocolDrafts, diskDrafts, notes);
  const restoredCount = await restoreCapturedDiskChanges(snapshot, mergedDrafts.map(({ draft }) => draft), unsupportedNotes);

  return {
    draftFileChanges: mergedDrafts.map(({ draft }) => draft),
    notes,
    unsupportedNotes: [...unsupportedNotes],
    sourceCounts: {
      protocol: protocolCount,
      disk: diskDrafts.length,
      restored: restoredCount,
      skipped: skippedCount
    }
  };
}

async function captureDiskMarkdownSnapshot(workspaceRoot: string): Promise<MarkdownSnapshot> {
  const files = new Map<string, MarkdownSnapshotEntry>();
  await scanMarkdownFiles(workspaceRoot, workspaceRoot, files);
  return { workspaceRoot, files };
}

async function scanMarkdownFiles(
  workspaceRoot: string,
  directoryPath: string,
  files: Map<string, MarkdownSnapshotEntry>
) {
  let entries;

  try {
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".") || ignoredNames.has(entry.name)) {
      continue;
    }

    const absolutePath = path.join(directoryPath, entry.name);
    let stats;

    try {
      stats = await lstat(absolutePath);
    } catch {
      continue;
    }

    if (stats.isSymbolicLink()) {
      continue;
    }

    if (stats.isDirectory()) {
      await scanMarkdownFiles(workspaceRoot, absolutePath, files);
      continue;
    }

    if (!stats.isFile() || !markdownExtensions.has(path.extname(entry.name).toLowerCase())) {
      continue;
    }

    const relativePathResult = normalizeWorkspaceRelativeMarkdownPath(workspaceRoot, path.relative(workspaceRoot, absolutePath));

    if (!relativePathResult.ok) {
      continue;
    }

    try {
      const content = await readFile(absolutePath, "utf8");
      files.set(relativePathResult.value, {
        absolutePath,
        relativePath: relativePathResult.value,
        content,
        baseHash: hashMarkdown(content),
        existed: true
      });
    } catch {
      continue;
    }
  }
}

function reconcileDiskDrafts(
  preSnapshot: MarkdownSnapshot,
  postSnapshot: MarkdownSnapshot,
  unsupportedNotes: Set<string>
): DraftWithSource[] {
  const drafts: DraftWithSource[] = [];

  for (const [relativePath, preFile] of preSnapshot.files) {
    const postFile = postSnapshot.files.get(relativePath);

    if (!postFile) {
      unsupportedNotes.add(`Codex removed ${relativePath}, which is not supported. The original file was restored when possible.`);
      continue;
    }

    if (preFile.content === postFile.content) {
      continue;
    }

    drafts.push({
      source: "disk",
      draft: {
        kind: "edit_file",
        relativePath,
        baseHash: preFile.baseHash,
        baseContent: preFile.content,
        replacement: postFile.content,
        summary: `Edit ${relativePath}`,
        unifiedDiff: unifiedDiff(preFile.content, postFile.content, relativePath)
      }
    });
  }

  for (const [relativePath, postFile] of postSnapshot.files) {
    if (preSnapshot.files.has(relativePath)) {
      continue;
    }

    drafts.push({
      source: "disk",
      draft: {
        kind: "create_file",
        relativePath,
        content: postFile.content,
        summary: `Create ${relativePath}`,
        unifiedDiff: unifiedDiff("", postFile.content, relativePath)
      }
    });
  }

  return drafts;
}

function appendUnrecoveredProtocolErrors(
  notes: string[],
  protocolErrors: ProtocolConversionError[],
  diskDrafts: DraftWithSource[]
) {
  const recoveredDiskPaths = new Set(diskDrafts.map(({ draft }) => draft.relativePath));

  for (const error of protocolErrors) {
    if (error.relativePath && recoveredDiskPaths.has(error.relativePath)) {
      continue;
    }

    notes.push(error.message);
  }
}

function mergeDraftsByPath(protocolDrafts: DraftWithSource[], diskDrafts: DraftWithSource[], notes: string[]) {
  const merged = new Map<string, DraftWithSource>();

  for (const draft of protocolDrafts) {
    merged.set(draft.draft.relativePath, draft);
  }

  for (const diskDraft of diskDrafts) {
    const protocolDraft = merged.get(diskDraft.draft.relativePath);

    if (!protocolDraft) {
      merged.set(diskDraft.draft.relativePath, diskDraft);
      continue;
    }

    if (draftProposalContent(protocolDraft.draft) === draftProposalContent(diskDraft.draft)) {
      continue;
    }

    notes.push(`Codex protocol and disk changes disagreed for ${diskDraft.draft.relativePath}; using the disk change.`);
    merged.set(diskDraft.draft.relativePath, diskDraft);
  }

  return [...merged.values()];
}

async function restoreCapturedDiskChanges(
  snapshot: MarkdownSnapshot,
  drafts: AgentDraftFileChange[],
  unsupportedNotes: Set<string>
) {
  let restoredCount = 0;
  const restoredPaths = new Set<string>();

  for (const draft of drafts) {
    const normalizedPath = normalizeWorkspaceRelativeMarkdownPath(snapshot.workspaceRoot, draft.relativePath);

    if (!normalizedPath.ok) {
      throw new Error(normalizedPath.error);
    }

    const relativePath = normalizedPath.value;
    const absolutePath = path.join(snapshot.workspaceRoot, relativePath);
    const current = await readCurrentMarkdownContent(snapshot.workspaceRoot, absolutePath);

    if (current.status === "unsafe") {
      throw new Error(`Codex changed ${relativePath}, but the current path is no longer a regular Markdown file.`);
    }

    if (draft.kind === "edit_file") {
      if (current.status === "missing") {
        continue;
      }

      if (current.content === draft.baseContent) {
        continue;
      }

      if (current.content !== draft.replacement) {
        throw new Error(`Codex changed ${relativePath}, but it changed again before Iliad could restore it.`);
      }

      await writeFile(absolutePath, draft.baseContent, "utf8");
      restoredPaths.add(relativePath);
      restoredCount += 1;
      continue;
    }

    if (draft.kind === "create_file") {
      if (current.status === "missing") {
        continue;
      }

      if (current.content !== draft.content) {
        throw new Error(`Codex created ${relativePath}, but it changed before Iliad could remove it for review.`);
      }

      await rm(absolutePath, { force: true });
      restoredPaths.add(relativePath);
      restoredCount += 1;
      continue;
    }

    if (current.status === "readable") {
      if (current.content === draft.baseContent) {
        continue;
      }

      throw new Error(`Codex removed ${relativePath}, but it changed again before Iliad could restore it.`);
    }

    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, draft.baseContent, "utf8");
    restoredPaths.add(relativePath);
    restoredCount += 1;
  }

  for (const [relativePath, preFile] of snapshot.files) {
    if (restoredPaths.has(relativePath)) {
      continue;
    }

    const currentContent = await readCurrentMarkdownContent(snapshot.workspaceRoot, preFile.absolutePath);

    if (currentContent.status === "unsafe") {
      throw new Error(`Codex removed ${relativePath}, but the current path is no longer safe to restore.`);
    }

    if (currentContent.status === "missing") {
      await mkdir(path.dirname(preFile.absolutePath), { recursive: true });
      await writeFile(preFile.absolutePath, preFile.content, "utf8");
      unsupportedNotes.add(`Codex removed ${relativePath}, which is not supported. The original file was restored.`);
      restoredCount += 1;
    }
  }

  return restoredCount;
}

async function readCurrentMarkdownContent(workspaceRoot: string, absolutePath: string) {
  try {
    ensureInsideWorkspace(workspaceRoot, absolutePath);
    const stats = await lstat(absolutePath);

    if (stats.isSymbolicLink() || !stats.isFile()) {
      return { status: "unsafe" as const };
    }

    return { status: "readable" as const, content: await readFile(absolutePath, "utf8") };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { status: "missing" as const };
    }

    return { status: "unsafe" as const };
  }
}

async function isExistingUnsafePath(workspaceRoot: string, relativePath: string) {
  const absolutePath = path.join(workspaceRoot, relativePath);

  try {
    ensureInsideWorkspace(workspaceRoot, absolutePath);
    const stats = await lstat(absolutePath);
    return stats.isSymbolicLink() || !stats.isFile();
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ENOENT";
  }
}

function draftProposalContent(draft: AgentDraftFileChange) {
  if (draft.kind === "edit_file") {
    return draft.replacement;
  }

  if (draft.kind === "create_file") {
    return draft.content;
  }

  return "";
}

function normalizeWorkspaceRelativeMarkdownPath(workspaceRoot: string, rawPath: string) {
  const trimmedPath = rawPath.trim();
  let relativePath = trimmedPath;

  if (!trimmedPath) {
    return failure("Codex path must be a non-empty relative path.");
  }

  if (path.isAbsolute(trimmedPath)) {
    try {
      ensureInsideWorkspace(workspaceRoot, trimmedPath);
      relativePath = path.relative(workspaceRoot, trimmedPath);
    } catch (error) {
      return failure(error instanceof Error ? error.message : "Codex path is outside the workspace.");
    }
  }

  if (relativePath.includes("\\")) {
    return failure(`Codex path must use workspace-relative POSIX separators: ${rawPath}.`);
  }

  const normalized = path.posix.normalize(relativePath);

  if (
    normalized !== relativePath ||
    normalized.startsWith("../") ||
    normalized === ".." ||
    path.posix.isAbsolute(normalized)
  ) {
    return failure(`Codex path must stay inside the workspace: ${rawPath}.`);
  }

  const segments = normalized.split("/");

  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment.startsWith("."))) {
    return failure(`Codex path cannot target hidden or unsafe paths: ${rawPath}.`);
  }

  if (!markdownExtensions.has(path.extname(normalized).toLowerCase())) {
    return failure(`Codex path must target a Markdown file: ${rawPath}.`);
  }

  return { ok: true as const, value: normalized };
}

function failure(error: string) {
  return { ok: false as const, error };
}
