import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MarkdownSnapshot } from "./codexFileChangeCapture.js";

/**
 * A durable record of the Markdown state before a Codex turn is allowed to
 * write into the workspace. If Iliad dies mid-run, the journal is what lets
 * the next launch restore the files and turn the abandoned writes into a
 * reviewable proposal instead of silently accepting them.
 */
export interface CodexRunJournalRecord {
  version: 1;
  runId: string;
  workspaceRoot: string;
  startedAt: string;
  files: Array<{ relativePath: string; hash: string; content: string }>;
}

const JOURNAL_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export class CodexRunJournalStore {
  private readonly directory: string;

  constructor(userDataPath: string) {
    this.directory = path.join(userDataPath, "assistant", "codex-runs");
  }

  journalPath(runId: string) {
    return path.join(this.directory, `${safeFileName(runId)}.json`);
  }

  async write(record: Omit<CodexRunJournalRecord, "version">) {
    await mkdir(this.directory, { recursive: true });
    const target = this.journalPath(record.runId);
    const tempPath = `${target}.${process.pid}.${Date.now()}.tmp`;
    const payload: CodexRunJournalRecord = { version: 1, ...record };
    await writeFile(tempPath, JSON.stringify(payload), "utf8");
    await rename(tempPath, target);
  }

  async writeFromSnapshot(runId: string, snapshot: MarkdownSnapshot) {
    await this.write({
      runId,
      workspaceRoot: path.resolve(snapshot.workspaceRoot),
      startedAt: new Date().toISOString(),
      files: [...snapshot.files.values()]
        .filter((entry) => entry.existed)
        .map((entry) => ({ relativePath: entry.relativePath, hash: entry.baseHash, content: entry.content }))
    });
  }

  async remove(runId: string) {
    await rm(this.journalPath(runId), { force: true });
  }

  async listForWorkspace(workspaceRoot: string): Promise<CodexRunJournalRecord[]> {
    const resolvedRoot = path.resolve(workspaceRoot);
    const records: CodexRunJournalRecord[] = [];

    for (const record of await this.listAll()) {
      if (path.resolve(record.workspaceRoot) === resolvedRoot) {
        records.push(record);
      }
    }

    return records.sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  }

  /** Drops journals whose workspace no longer exists once they are older than a week. */
  async pruneStale(now = Date.now()) {
    for (const record of await this.listAll()) {
      const age = now - Date.parse(record.startedAt);

      if (!(age > JOURNAL_MAX_AGE_MS)) {
        continue;
      }

      try {
        await stat(record.workspaceRoot);
      } catch {
        await this.remove(record.runId);
      }
    }
  }

  private async listAll(): Promise<CodexRunJournalRecord[]> {
    let names: string[];

    try {
      names = await readdir(this.directory);
    } catch {
      return [];
    }

    const records: CodexRunJournalRecord[] = [];

    for (const name of names) {
      if (!name.endsWith(".json")) {
        continue;
      }

      try {
        const parsed = JSON.parse(await readFile(path.join(this.directory, name), "utf8")) as unknown;

        if (isJournalRecord(parsed)) {
          records.push(parsed);
        }
      } catch {
        continue;
      }
    }

    return records;
  }
}

function isJournalRecord(value: unknown): value is CodexRunJournalRecord {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    record.version === 1 &&
    typeof record.runId === "string" &&
    typeof record.workspaceRoot === "string" &&
    typeof record.startedAt === "string" &&
    Array.isArray(record.files)
  );
}

function safeFileName(value: string) {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120) || "run";
}
