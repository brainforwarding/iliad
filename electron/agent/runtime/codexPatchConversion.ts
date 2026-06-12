import { unifiedDiff } from "../diff.js";
import { hashMarkdown } from "../hash.js";
import type { AgentDraftFileChange } from "../types.js";

export interface CodexFileUpdateChangeLike {
  path?: unknown;
  relativePath?: unknown;
  change?: unknown;
  kind?: unknown;
  type?: unknown;
  unified_diff?: unknown;
  unifiedDiff?: unknown;
  diff?: unknown;
  patch?: unknown;
  move_path?: unknown;
  movePath?: unknown;
}

export type CodexPatchConversionResult =
  | {
      status: "converted";
      draftFileChanges: AgentDraftFileChange[];
      notes: string[];
    }
  | {
      status: "skipped";
      draftFileChanges: [];
      notes: string[];
    }
  | {
      status: "error";
      draftFileChanges: [];
      notes: string[];
      error: string;
    };

export interface ConvertCodexFileUpdateChangeOptions {
  baseContent?: string;
  baseHash?: string;
  targetExists?: boolean;
}

interface NormalizedCodexFileUpdateChange {
  relativePath: string;
  kind: string;
  unifiedDiff: string;
  movePath: string | null;
}

interface DiffHeader {
  oldPath: string;
  newPath: string;
  oldRelativePath: string | null;
  newRelativePath: string | null;
}

type ParsedHunkLine =
  | {
      kind: "context" | "delete" | "add";
      text: string;
      oldNoNewline: boolean;
      newNoNewline: boolean;
    };

interface ParsedHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: ParsedHunkLine[];
}

interface ParsedUnifiedDiff {
  header: DiffHeader;
  hunks: ParsedHunk[];
}

interface ContentLines {
  lines: string[];
  finalNewline: boolean;
  eol: "\n" | "\r\n";
}

export function convertCodexFileUpdateChangeToDraft(
  input: CodexFileUpdateChangeLike,
  options: ConvertCodexFileUpdateChangeOptions = {}
): CodexPatchConversionResult {
  const normalized = normalizeCodexFileUpdateChange(input);

  if (!normalized.ok) {
    return errorResult(normalized.error);
  }

  const pathCheck = validateSafeMarkdownRelativePath(normalized.value.relativePath);

  if (!pathCheck.ok) {
    return errorResult(pathCheck.error);
  }

  const change = normalized.value;

  if (change.kind === "delete") {
    return skippedResult(`Codex delete for ${change.relativePath} is not supported.`);
  }

  if (change.kind === "rename" || change.kind === "move" || change.movePath) {
    return skippedResult(`Codex move or rename for ${change.relativePath} is not supported.`);
  }

  if (change.kind !== "add" && change.kind !== "update") {
    return skippedResult(`Codex ${change.kind || "file"} change for ${change.relativePath} is not supported.`);
  }

  const parsed = parseUnifiedDiff(change.unifiedDiff);

  if (!parsed.ok) {
    return errorResult(parsed.error);
  }

  const headerCheck = validateDiffHeader(parsed.value.header, change.relativePath, change.kind);

  if (!headerCheck.ok) {
    return errorResult(headerCheck.error);
  }

  if (change.kind === "add") {
    if (options.targetExists) {
      return errorResult(`Codex add target already exists: ${change.relativePath}.`);
    }

    const applied = applyParsedUnifiedDiff("", parsed.value);

    if (!applied.ok) {
      return errorResult(applied.error);
    }

    if (!applied.value.trim()) {
      return errorResult(`Codex add produced empty Markdown content for ${change.relativePath}.`);
    }

    return {
      status: "converted",
      draftFileChanges: [
        {
          kind: "create_file",
          relativePath: change.relativePath,
          content: applied.value,
          summary: `Create ${change.relativePath}`,
          unifiedDiff: unifiedDiff("", applied.value, change.relativePath)
        }
      ],
      notes: []
    };
  }

  if (options.baseContent === undefined) {
    return errorResult(`Base content is required for Codex update: ${change.relativePath}.`);
  }

  const applied = applyParsedUnifiedDiff(options.baseContent, parsed.value);

  if (!applied.ok) {
    return errorResult(applied.error);
  }

  return {
    status: "converted",
    draftFileChanges: [
      {
        kind: "edit_file",
        relativePath: change.relativePath,
        baseHash: options.baseHash ?? hashMarkdown(options.baseContent),
        baseContent: options.baseContent,
        replacement: applied.value,
        summary: `Edit ${change.relativePath}`,
        unifiedDiff: unifiedDiff(options.baseContent, applied.value, change.relativePath)
      }
    ],
    notes: []
  };
}

export function applyUnifiedDiffStrict(baseContent: string, diff: string, expectedRelativePath: string) {
  const pathCheck = validateSafeMarkdownRelativePath(expectedRelativePath);

  if (!pathCheck.ok) {
    return errorResult(pathCheck.error);
  }

  const parsed = parseUnifiedDiff(diff);

  if (!parsed.ok) {
    return errorResult(parsed.error);
  }

  const headerCheck = validateDiffHeader(parsed.value.header, expectedRelativePath, "update");

  if (!headerCheck.ok) {
    return errorResult(headerCheck.error);
  }

  const applied = applyParsedUnifiedDiff(baseContent, parsed.value);

  if (!applied.ok) {
    return errorResult(applied.error);
  }

  return {
    status: "converted" as const,
    draftFileChanges: [] as AgentDraftFileChange[],
    notes: [],
    replacement: applied.value
  };
}

function normalizeCodexFileUpdateChange(input: CodexFileUpdateChangeLike) {
  const change = asRecord(input.change) ?? input;
  const kindRecord = asRecord(change.kind);
  const rawKind = kindRecord?.type ?? change.type;
  const rawPath = input.relativePath ?? input.path ?? change.relativePath ?? change.path;
  const rawUnifiedDiff = change.unified_diff ?? change.unifiedDiff ?? change.diff ?? change.patch;
  const rawMovePath = change.move_path ?? change.movePath ?? kindRecord?.move_path ?? kindRecord?.movePath;

  if (typeof rawPath !== "string" || !rawPath.trim()) {
    return failure("Codex file change is missing a path.");
  }

  if (typeof rawKind !== "string" || !rawKind.trim()) {
    return failure(`Codex file change for ${rawPath} is missing a kind.`);
  }

  const kind = rawKind.trim();

  if (
    (typeof rawUnifiedDiff !== "string" || !rawUnifiedDiff.trim()) &&
    kind !== "delete" &&
    kind !== "rename" &&
    kind !== "move"
  ) {
    return failure(`Codex file change for ${rawPath} is missing a unified diff.`);
  }

  return success<NormalizedCodexFileUpdateChange>({
    relativePath: rawPath.trim(),
    kind,
    unifiedDiff: typeof rawUnifiedDiff === "string" ? rawUnifiedDiff : "",
    movePath: typeof rawMovePath === "string" && rawMovePath.trim() ? rawMovePath.trim() : null
  });
}

function parseUnifiedDiff(diff: string) {
  const lines = splitDiffLines(diff);

  if (lines.length < 2) {
    return failure("Unified diff is missing headers.");
  }

  if (lines.some((line) => /^diff --git\b|^rename (?:from|to)\b|^similarity index\b|^deleted file mode\b|^new file mode\b/.test(line))) {
    return failure("Unified diff includes unsupported metadata.");
  }

  if (!lines[0].startsWith("--- ") || !lines[1].startsWith("+++ ")) {
    return failure("Unified diff must start with --- and +++ headers.");
  }

  const header: DiffHeader = {
    oldPath: parseHeaderPath(lines[0]),
    newPath: parseHeaderPath(lines[1]),
    oldRelativePath: normalizeHeaderRelativePath(parseHeaderPath(lines[0])),
    newRelativePath: normalizeHeaderRelativePath(parseHeaderPath(lines[1]))
  };

  const hunks: ParsedHunk[] = [];
  let index = 2;

  while (index < lines.length) {
    if (lines[index] === "") {
      return failure("Unified diff includes an empty line outside a hunk.");
    }

    const headerMatch = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/.exec(lines[index]);

    if (!headerMatch) {
      return failure(`Malformed unified diff hunk header: ${lines[index]}`);
    }

    const hunk: ParsedHunk = {
      oldStart: Number(headerMatch[1]),
      oldCount: headerMatch[2] === undefined ? 1 : Number(headerMatch[2]),
      newStart: Number(headerMatch[3]),
      newCount: headerMatch[4] === undefined ? 1 : Number(headerMatch[4]),
      lines: []
    };

    if (hunk.oldCount < 0 || hunk.newCount < 0) {
      return failure("Unified diff hunk line counts must be non-negative.");
    }

    if ((hunk.oldStart === 0 && hunk.oldCount !== 0) || (hunk.newStart === 0 && hunk.newCount !== 0)) {
      return failure("Unified diff zero line starts are only valid with zero line counts.");
    }

    index += 1;

    while (index < lines.length && !lines[index].startsWith("@@ ")) {
      const line = lines[index];

      if (line === "\\ No newline at end of file") {
        const previous = hunk.lines[hunk.lines.length - 1];

        if (!previous) {
          return failure("No-newline marker must follow a hunk line.");
        }

        if (previous.kind === "delete") {
          previous.oldNoNewline = true;
        } else if (previous.kind === "add") {
          previous.newNoNewline = true;
        } else {
          previous.oldNoNewline = true;
          previous.newNoNewline = true;
        }

        index += 1;
        continue;
      }

      const prefix = line[0];

      if (prefix !== " " && prefix !== "-" && prefix !== "+") {
        return failure(`Malformed unified diff hunk line: ${line}`);
      }

      hunk.lines.push({
        kind: prefix === " " ? "context" : prefix === "-" ? "delete" : "add",
        text: line.slice(1),
        oldNoNewline: false,
        newNoNewline: false
      });
      index += 1;
    }

    const oldLineCount = hunk.lines.filter((line) => line.kind === "context" || line.kind === "delete").length;
    const newLineCount = hunk.lines.filter((line) => line.kind === "context" || line.kind === "add").length;

    if (oldLineCount !== hunk.oldCount || newLineCount !== hunk.newCount) {
      return failure("Unified diff hunk body does not match header line counts.");
    }

    hunks.push(hunk);
  }

  if (hunks.length === 0) {
    return failure("Unified diff contains no hunks.");
  }

  return success<ParsedUnifiedDiff>({ header, hunks });
}

function applyParsedUnifiedDiff(baseContent: string, diff: ParsedUnifiedDiff) {
  const base = splitContentLines(baseContent);
  const outputLines: string[] = [];
  let baseIndex = 0;
  let newNoNewlineOutputIndex: number | null = null;

  for (const hunk of diff.hunks) {
    const hunkStartIndex = hunk.oldStart === 0 ? 0 : hunk.oldStart - 1;

    if (hunkStartIndex < baseIndex) {
      return failure("Unified diff hunks overlap or are out of order.");
    }

    if (hunkStartIndex > base.lines.length) {
      return failure("Unified diff hunk starts beyond the base content.");
    }

    outputLines.push(...base.lines.slice(baseIndex, hunkStartIndex));
    baseIndex = hunkStartIndex;

    for (const line of hunk.lines) {
      if (line.kind === "context" || line.kind === "delete") {
        if (base.lines[baseIndex] !== line.text) {
          return failure(`Unified diff context mismatch near base line ${baseIndex + 1}.`);
        }

        baseIndex += 1;

        if (line.oldNoNewline && (baseIndex !== base.lines.length || base.finalNewline)) {
          return failure("Unified diff old no-newline marker does not match base content.");
        }
      }

      if (line.kind === "context" || line.kind === "add") {
        outputLines.push(line.text);

        if (line.newNoNewline) {
          newNoNewlineOutputIndex = outputLines.length - 1;
        }
      }
    }
  }

  const copiedTail = baseIndex < base.lines.length;
  outputLines.push(...base.lines.slice(baseIndex));

  if (newNoNewlineOutputIndex !== null && newNoNewlineOutputIndex !== outputLines.length - 1) {
    return failure("Unified diff new no-newline marker does not point at the final output line.");
  }

  const finalNewline =
    outputLines.length > 0 &&
    (newNoNewlineOutputIndex !== null ? false : copiedTail ? base.finalNewline : true);

  return success(joinContentLines(outputLines, finalNewline, base.eol));
}

function validateDiffHeader(header: DiffHeader, expectedRelativePath: string, kind: string) {
  if (kind === "add") {
    if (header.oldPath !== "/dev/null") {
      return failure(`Codex add for ${expectedRelativePath} must use /dev/null as the old diff path.`);
    }

    if (header.newRelativePath !== expectedRelativePath) {
      return failure(`Codex diff path ${header.newPath} does not match event path ${expectedRelativePath}.`);
    }

    return success(undefined);
  }

  if (header.oldPath === "/dev/null" || header.newPath === "/dev/null") {
    return failure(`Codex update for ${expectedRelativePath} cannot use /dev/null diff paths.`);
  }

  if (header.oldRelativePath !== expectedRelativePath || header.newRelativePath !== expectedRelativePath) {
    return failure(`Codex diff paths do not match event path ${expectedRelativePath}.`);
  }

  return success(undefined);
}

function validateSafeMarkdownRelativePath(relativePath: string) {
  if (relativePath !== relativePath.trim() || relativePath.length === 0) {
    return failure("Codex path must be a non-empty relative path.");
  }

  if (
    relativePath.startsWith("/") ||
    relativePath.startsWith("\\") ||
    /^[A-Za-z]:[\\/]/.test(relativePath) ||
    relativePath.includes("\\")
  ) {
    return failure(`Codex path must be workspace-relative: ${relativePath}.`);
  }

  const segments = relativePath.split("/");

  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return failure(`Codex path cannot contain empty, current, or parent segments: ${relativePath}.`);
  }

  if (segments.some((segment) => segment.startsWith("."))) {
    return failure(`Codex path cannot target hidden files or folders: ${relativePath}.`);
  }

  if (!relativePath.toLowerCase().endsWith(".md")) {
    return failure(`Codex path must target a Markdown .md file: ${relativePath}.`);
  }

  return success(undefined);
}

function normalizeHeaderRelativePath(headerPath: string) {
  if (headerPath === "/dev/null") {
    return null;
  }

  const stripped = headerPath.replace(/^(?:a|b)\//, "");
  const pathCheck = validateSafeMarkdownRelativePath(stripped);

  return pathCheck.ok ? stripped : null;
}

function parseHeaderPath(line: string) {
  return line.slice(4).split("\t")[0].trim();
}

function splitDiffLines(diff: string) {
  const normalized = diff.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");

  if (lines.at(-1) === "") {
    lines.pop();
  }

  return lines;
}

function splitContentLines(content: string): ContentLines {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const finalNewline = normalized.endsWith("\n");
  const lines = normalized.split("\n");

  if (finalNewline) {
    lines.pop();
  }

  if (lines.length === 1 && lines[0] === "" && !finalNewline) {
    return { lines: [], finalNewline: false, eol };
  }

  return { lines, finalNewline, eol };
}

function joinContentLines(lines: string[], finalNewline: boolean, eol: "\n" | "\r\n") {
  if (lines.length === 0) {
    return "";
  }

  return `${lines.join(eol)}${finalNewline ? eol : ""}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function success<T>(value: T) {
  return { ok: true as const, value };
}

function failure(error: string) {
  return { ok: false as const, error };
}

function errorResult(error: string): CodexPatchConversionResult {
  return {
    status: "error",
    draftFileChanges: [],
    notes: [],
    error
  };
}

function skippedResult(note: string): CodexPatchConversionResult {
  return {
    status: "skipped",
    draftFileChanges: [],
    notes: [note]
  };
}
