import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type SelectionCommentStatus = "pending" | "sent" | "discarded";

export interface SelectionComment {
  id: string;
  workspacePath: string;
  documentRelativePath: string;
  from: number;
  to: number;
  quote: string;
  occurrence: number;
  prefix: string;
  comment: string;
  createdAt: string;
  status: SelectionCommentStatus;
}

const MAX_COMMENT_TEXT_LENGTH = 4_000;
const MAX_QUOTE_LENGTH = 20_000;
const MAX_COMMENTS_PER_DOCUMENT = 200;

function workspaceMatches(comment: SelectionComment, workspacePath: string) {
  return path.resolve(comment.workspacePath) === path.resolve(workspacePath);
}

function sameDocument(comment: SelectionComment, documentRelativePath: string) {
  return comment.documentRelativePath.toLowerCase() === documentRelativePath.toLowerCase();
}

function nonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function boundedString(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.slice(0, maxLength) : null;
}

/**
 * Validates one renderer-supplied comment. The workspace path and document
 * relative path are assigned by the store from main-process-resolved values —
 * renderer-provided values for those fields are ignored.
 */
export function sanitizeSelectionComment(
  candidate: unknown,
  workspacePath: string,
  documentRelativePath: string
): SelectionComment | null {
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const value = candidate as Record<string, unknown>;
  const id = boundedString(value.id, 160)?.trim();
  const from = nonNegativeInteger(value.from);
  const to = nonNegativeInteger(value.to);
  const quote = boundedString(value.quote, MAX_QUOTE_LENGTH);
  const comment = boundedString(value.comment, MAX_COMMENT_TEXT_LENGTH);
  const occurrence = nonNegativeInteger(value.occurrence);
  const prefix = boundedString(value.prefix, 120);

  if (!id || from === null || to === null || quote === null || comment === null || !comment.trim()) {
    return null;
  }

  if (value.status !== "pending") {
    // Pending-only persistence: sent/discarded comments are pruned on write.
    return null;
  }

  const createdAt =
    typeof value.createdAt === "string" && !Number.isNaN(Date.parse(value.createdAt))
      ? new Date(value.createdAt).toISOString()
      : new Date().toISOString();

  return {
    id,
    workspacePath,
    documentRelativePath,
    from,
    to: Math.max(from, to),
    quote,
    occurrence: occurrence ?? 1,
    prefix: prefix ?? "",
    comment,
    createdAt,
    status: "pending"
  };
}

/**
 * Persists pending selection comments under
 * `${userData}/assistant/selection-comments.json`, keyed by workspace path +
 * document relative path (the proposals precedent: workspacePath is persisted,
 * unlike the context-manifest store which deliberately does not persist roots).
 *
 * Multi-window scope (v1, explicit): renderer state is per-window and this
 * store is last-write-wins, so two windows on the same workspace can diverge
 * until reload. Accepted, not solved.
 */
export class SelectionCommentsStore {
  private readonly storePath: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(userDataPath: string) {
    this.storePath = path.join(userDataPath, "assistant", "selection-comments.json");
  }

  async listForWorkspace(workspacePath: string): Promise<SelectionComment[]> {
    return this.enqueue(async () => {
      const comments = await this.readAll();
      return comments.filter((comment) => workspaceMatches(comment, workspacePath)).map((comment) => ({ ...comment }));
    });
  }

  /** Replaces all stored comments for one workspace document with the pending subset of `incoming`. */
  async replaceForDocument(
    workspacePath: string,
    documentRelativePath: string,
    incoming: unknown[]
  ): Promise<SelectionComment[]> {
    return this.enqueue(async () => {
      const comments = await this.readAll();
      const kept = comments.filter(
        (comment) => !(workspaceMatches(comment, workspacePath) && sameDocument(comment, documentRelativePath))
      );
      const sanitized = (Array.isArray(incoming) ? incoming : [])
        .map((candidate) => sanitizeSelectionComment(candidate, workspacePath, documentRelativePath))
        .filter((comment): comment is SelectionComment => Boolean(comment))
        .slice(0, MAX_COMMENTS_PER_DOCUMENT);

      await this.writeAll([...kept, ...sanitized]);
      return sanitized.map((comment) => ({ ...comment }));
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async readAll(): Promise<SelectionComment[]> {
    try {
      const raw = await readFile(this.storePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;

      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed.filter(
        (candidate): candidate is SelectionComment =>
          Boolean(candidate) &&
          typeof candidate === "object" &&
          typeof (candidate as SelectionComment).workspacePath === "string" &&
          typeof (candidate as SelectionComment).documentRelativePath === "string" &&
          (candidate as SelectionComment).status === "pending"
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) {
        return [];
      }

      throw error;
    }
  }

  private async writeAll(comments: SelectionComment[]) {
    await mkdir(path.dirname(this.storePath), { recursive: true });
    const tempPath = `${this.storePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(comments, null, 2)}\n`, "utf8");
    await rename(tempPath, this.storePath);
  }
}
