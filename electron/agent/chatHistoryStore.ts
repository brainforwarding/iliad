import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import type {
  AgentChatHistoryEntry,
  AgentChatThread,
  AgentChatThreadSummary,
  AgentChatThreadTitleSource
} from "./types.js";

const CHAT_HISTORY_SCHEMA_VERSION = 1;
const MAX_THREADS_PER_WORKSPACE = 100;
const MAX_TITLE_LENGTH = 72;
const MAX_ENTRY_TEXT_LENGTH = 80_000;
const historyEntryKinds = new Set<AgentChatHistoryEntry["kind"]>(["user", "assistant", "error", "status"]);
const historyEntrySources = new Set<NonNullable<AgentChatHistoryEntry["source"]>>(["desktop", "telegram"]);

type ChatHistoryMutation<T> = (file: AgentChatHistoryFile) => Promise<T> | T;

interface AgentChatHistoryFile {
  schemaVersion: 1;
  threads: AgentChatThread[];
}

export type SaveAgentChatThreadRequest = {
  workspaceRoot: string;
  thread: Omit<AgentChatThread, "workspaceRoot"> & { workspaceRoot?: string };
};

export type AppendAgentChatThreadEntriesRequest = {
  workspaceRoot: string;
  threadId: string;
  entries: AgentChatHistoryEntry[];
};

function cloneThread(thread: AgentChatThread): AgentChatThread {
  return JSON.parse(JSON.stringify(thread)) as AgentChatThread;
}

function cloneSummary(summary: AgentChatThreadSummary): AgentChatThreadSummary {
  return { ...summary };
}

function normalizedWorkspaceRoot(workspaceRoot: string) {
  if (typeof workspaceRoot !== "string" || !workspaceRoot.trim()) {
    throw new Error("Workspace root is required.");
  }

  return path.resolve(workspaceRoot);
}

function workspaceMatches(thread: AgentChatThread, workspaceRoot: string) {
  return path.resolve(thread.workspaceRoot) === path.resolve(workspaceRoot);
}

function validIsoDate(value: unknown, fallback: string) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    return fallback;
  }

  return new Date(value).toISOString();
}

function firstUserText(entries: AgentChatHistoryEntry[]) {
  return entries.find((entry) => entry.kind === "user" && entry.text.trim())?.text ?? "";
}

function truncate(value: string, maxLength: number) {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

function sanitizeThreadId(id: unknown) {
  const trimmed = typeof id === "string" ? id.trim() : "";
  if (trimmed && /^[A-Za-z0-9._:-]{1,120}$/.test(trimmed)) {
    return trimmed;
  }

  return `thread-${crypto.randomUUID()}`;
}

function sanitizeStoredEntry(entry: unknown, fallbackIndex: number, now: string): AgentChatHistoryEntry | null {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const candidate = entry as Record<string, unknown>;
  const kind = candidate.kind;
  const text = typeof candidate.text === "string" ? truncate(candidate.text, MAX_ENTRY_TEXT_LENGTH) : "";

  if (!historyEntryKinds.has(kind as AgentChatHistoryEntry["kind"]) || !text.trim()) {
    return null;
  }

  const source = historyEntrySources.has(candidate.source as NonNullable<AgentChatHistoryEntry["source"]>)
    ? (candidate.source as NonNullable<AgentChatHistoryEntry["source"]>)
    : undefined;

  return {
    id:
      typeof candidate.id === "string" && candidate.id.trim()
        ? truncate(candidate.id.trim(), 160)
        : `entry-${fallbackIndex}`,
    kind: kind as AgentChatHistoryEntry["kind"],
    text,
    createdAt: validIsoDate(candidate.createdAt, now),
    ...(source ? { source } : {})
  };
}

function sanitizeEntries(entries: unknown, now: string) {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .map((entry, index) => sanitizeStoredEntry(entry, index, now))
    .filter((entry): entry is AgentChatHistoryEntry => Boolean(entry));
}

function sanitizeTitleSource(value: unknown): AgentChatThreadTitleSource {
  return value === "ai" ? "ai" : "fallback";
}

export function fallbackChatThreadTitle(text: string) {
  const stripped = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/[*_~>#-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const title = stripped.slice(0, MAX_TITLE_LENGTH).trim().replace(/[.,;:!?]+$/u, "");
  return title || "Untitled conversation";
}

export function sanitizeGeneratedChatThreadTitle(text: string) {
  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? "";
  const sanitized = firstLine
    .replace(/^[-*#\d.)\s]+/u, "")
    .replace(/["'`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:!?]+$/u, "");

  return sanitized && sanitized.length <= MAX_TITLE_LENGTH
    ? sanitized
    : sanitized.slice(0, MAX_TITLE_LENGTH).trim() || "";
}

function sanitizeIncomingThread(
  workspaceRoot: string,
  incoming: SaveAgentChatThreadRequest["thread"],
  existing: AgentChatThread | undefined,
  now: string
): AgentChatThread | null {
  const entries = preserveExistingTelegramEntries(sanitizeEntries(incoming.entries, now), existing?.entries);

  if (entries.length === 0) {
    return null;
  }

  const createdAt = existing?.createdAt ?? validIsoDate(incoming.createdAt, entries[0]?.createdAt ?? now);
  const fallbackTitle = fallbackChatThreadTitle(firstUserText(entries));
  const title = existing?.titleSource === "ai" ? existing.title : fallbackTitle;
  const titleSource: AgentChatThreadTitleSource = existing?.titleSource === "ai" ? "ai" : "fallback";

  return {
    id: existing?.id ?? sanitizeThreadId(incoming.id),
    workspaceRoot,
    title,
    titleSource,
    createdAt,
    updatedAt: now,
    entries
  };
}

function preserveExistingTelegramEntries(
  incomingEntries: AgentChatHistoryEntry[],
  existingEntries: AgentChatHistoryEntry[] | undefined
) {
  if (!existingEntries?.length) {
    return incomingEntries;
  }

  const existingById = new Map(existingEntries.map((entry) => [entry.id, entry]));
  const mergedIncomingEntries = incomingEntries.map((entry) => {
    const existing = existingById.get(entry.id);
    return existing?.source === "telegram" && !entry.source ? { ...entry, source: "telegram" as const } : entry;
  });
  const incomingIds = new Set(mergedIncomingEntries.map((entry) => entry.id));
  const missingTelegramEntries = existingEntries.filter(
    (entry) => entry.source === "telegram" && !incomingIds.has(entry.id)
  );

  if (missingTelegramEntries.length === 0) {
    return mergedIncomingEntries;
  }

  return [...mergedIncomingEntries, ...missingTelegramEntries.map((entry) => ({ ...entry }))].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)
  );
}

function summaryForThread(thread: AgentChatThread): AgentChatThreadSummary {
  return {
    id: thread.id,
    title: thread.title,
    titleSource: thread.titleSource,
    updatedAt: thread.updatedAt,
    messageCount: thread.entries.length
  };
}

function sortByUpdatedAtDesc<T extends { updatedAt: string }>(items: T[]) {
  return [...items].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

function pruneWorkspaceThreads(threads: AgentChatThread[], workspaceRoot: string) {
  const normalizedRoot = normalizedWorkspaceRoot(workspaceRoot);
  const workspaceThreads = sortByUpdatedAtDesc(threads.filter((thread) => workspaceMatches(thread, normalizedRoot)));
  const keepIds = new Set(workspaceThreads.slice(0, MAX_THREADS_PER_WORKSPACE).map((thread) => thread.id));

  return threads.filter((thread) => !workspaceMatches(thread, normalizedRoot) || keepIds.has(thread.id));
}

function emptyHistoryFile(): AgentChatHistoryFile {
  return { schemaVersion: CHAT_HISTORY_SCHEMA_VERSION, threads: [] };
}

export class AgentChatHistoryStore {
  private readonly storePath: string;
  private queue: Promise<unknown> = Promise.resolve();
  private workspaceClearGenerations = new Map<string, number>();

  constructor(userDataPath: string) {
    this.storePath = path.join(userDataPath, "assistant", "chat-history.json");
  }

  async listThreads(workspaceRoot: string): Promise<AgentChatThreadSummary[]> {
    const normalizedRoot = normalizedWorkspaceRoot(workspaceRoot);
    return this.enqueue(async () => {
      const file = await this.readFile();
      return sortByUpdatedAtDesc(file.threads.filter((thread) => workspaceMatches(thread, normalizedRoot)))
        .map(summaryForThread)
        .map(cloneSummary);
    });
  }

  async getThread(workspaceRoot: string, threadId: string): Promise<AgentChatThread | null> {
    const normalizedRoot = normalizedWorkspaceRoot(workspaceRoot);
    return this.enqueue(async () => {
      const file = await this.readFile();
      const thread = file.threads.find((candidate) => candidate.id === threadId && workspaceMatches(candidate, normalizedRoot));
      return thread ? cloneThread(thread) : null;
    });
  }

  async saveThread(request: SaveAgentChatThreadRequest): Promise<AgentChatThread> {
    const normalizedRoot = normalizedWorkspaceRoot(request.workspaceRoot);
    const generation = this.clearGeneration(normalizedRoot);
    let savedThread: AgentChatThread | null = null;

    await this.mutate(async (file) => {
      if (generation !== this.clearGeneration(normalizedRoot)) {
        return;
      }

      const index = file.threads.findIndex(
        (candidate) => candidate.id === request.thread.id && workspaceMatches(candidate, normalizedRoot)
      );
      const existing = index >= 0 ? file.threads[index] : undefined;
      const sanitized = sanitizeIncomingThread(normalizedRoot, request.thread, existing, new Date().toISOString());

      if (!sanitized) {
        if (index >= 0) {
          file.threads.splice(index, 1);
        }
        return;
      }

      if (index >= 0) {
        file.threads[index] = sanitized;
      } else {
        file.threads.push(sanitized);
      }

      file.threads = pruneWorkspaceThreads(file.threads, normalizedRoot);
      savedThread = cloneThread(sanitized);
    });

    if (!savedThread) {
      if (generation !== this.clearGeneration(normalizedRoot)) {
        throw new Error("Chat history was cleared before this thread could be saved.");
      }

      throw new Error("Empty chat threads are not saved.");
    }

    return savedThread;
  }

  async appendThreadEntries(request: AppendAgentChatThreadEntriesRequest): Promise<AgentChatThread> {
    const normalizedRoot = normalizedWorkspaceRoot(request.workspaceRoot);
    const now = new Date().toISOString();
    const entries = sanitizeEntries(request.entries, now);

    if (entries.length === 0) {
      throw new Error("Empty chat history entries are not appended.");
    }

    let savedThread: AgentChatThread | null = null;

    await this.mutate((file) => {
      const index = file.threads.findIndex(
        (candidate) => candidate.id === request.threadId && workspaceMatches(candidate, normalizedRoot)
      );
      const existing = index >= 0 ? file.threads[index] : undefined;
      const existingEntryIds = new Set(existing?.entries.map((entry) => entry.id) ?? []);

      if (entries.some((entry) => existingEntryIds.has(entry.id))) {
        if (existing) {
          savedThread = cloneThread(existing);
          return;
        }
      }

      const appendedEntries = existing ? [...existing.entries, ...entries] : entries;
      const createdAt = existing?.createdAt ?? appendedEntries[0].createdAt;
      const thread: AgentChatThread = {
        id: existing?.id ?? sanitizeThreadId(request.threadId),
        workspaceRoot: normalizedRoot,
        title: existing?.title ?? fallbackChatThreadTitle(firstUserText(appendedEntries)),
        titleSource: existing?.titleSource ?? "fallback",
        createdAt,
        updatedAt: now,
        entries: appendedEntries
      };

      if (index >= 0) {
        file.threads[index] = thread;
      } else {
        file.threads.push(thread);
      }

      file.threads = pruneWorkspaceThreads(file.threads, normalizedRoot);
      savedThread = cloneThread(thread);
    });

    if (!savedThread) {
      throw new Error("Chat history entries could not be appended.");
    }

    return savedThread;
  }

  async updateThreadTitle(workspaceRoot: string, threadId: string, title: string): Promise<AgentChatThread | null> {
    const normalizedRoot = normalizedWorkspaceRoot(workspaceRoot);
    const generation = this.clearGeneration(normalizedRoot);
    let updatedThread: AgentChatThread | null = null;
    const sanitizedTitle = sanitizeGeneratedChatThreadTitle(title);

    if (!sanitizedTitle) {
      return this.getThread(normalizedRoot, threadId);
    }

    await this.mutate((file) => {
      if (generation !== this.clearGeneration(normalizedRoot)) {
        return;
      }

      const thread = file.threads.find((candidate) => candidate.id === threadId && workspaceMatches(candidate, normalizedRoot));
      if (!thread) {
        return;
      }

      thread.title = sanitizedTitle;
      thread.titleSource = "ai";
      updatedThread = cloneThread(thread);
    });

    return updatedThread;
  }

  async clearWorkspace(workspaceRoot: string): Promise<void> {
    const normalizedRoot = normalizedWorkspaceRoot(workspaceRoot);
    this.workspaceClearGenerations.set(normalizedRoot, this.clearGeneration(normalizedRoot) + 1);
    await this.mutate((file) => {
      file.threads = file.threads.filter((thread) => !workspaceMatches(thread, normalizedRoot));
    });
  }

  private clearGeneration(workspaceRoot: string) {
    return this.workspaceClearGenerations.get(normalizedWorkspaceRoot(workspaceRoot)) ?? 0;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async mutate<T>(operation: ChatHistoryMutation<T>): Promise<T> {
    return this.enqueue(async () => {
      const file = await this.readFile();
      const result = await operation(file);
      await this.writeFile(file);
      return result;
    });
  }

  private async readFile(): Promise<AgentChatHistoryFile> {
    try {
      const raw = await readFile(this.storePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<AgentChatHistoryFile>;

      if (parsed.schemaVersion !== CHAT_HISTORY_SCHEMA_VERSION || !Array.isArray(parsed.threads)) {
        return emptyHistoryFile();
      }

      const now = new Date().toISOString();
      return {
        schemaVersion: CHAT_HISTORY_SCHEMA_VERSION,
        threads: parsed.threads
          .map((thread) => sanitizePersistedThread(thread, now))
          .filter((thread): thread is AgentChatThread => Boolean(thread))
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return emptyHistoryFile();
      }

      if (error instanceof SyntaxError) {
        await this.backupCorruptFile();
        return emptyHistoryFile();
      }

      throw error;
    }
  }

  private async backupCorruptFile() {
    try {
      await rename(this.storePath, `${this.storePath}.${new Date().toISOString().replace(/[:.]/g, "-")}.corrupt`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  private async writeFile(file: AgentChatHistoryFile) {
    await mkdir(path.dirname(this.storePath), { recursive: true });
    const tempPath = `${this.storePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify({ schemaVersion: CHAT_HISTORY_SCHEMA_VERSION, threads: file.threads }, null, 2)}\n`, "utf8");
    await rename(tempPath, this.storePath);
  }
}

function sanitizePersistedThread(thread: unknown, now: string): AgentChatThread | null {
  if (!thread || typeof thread !== "object") {
    return null;
  }

  const candidate = thread as Record<string, unknown>;
  if (typeof candidate.workspaceRoot !== "string" || !candidate.workspaceRoot.trim()) {
    return null;
  }

  const workspaceRoot = normalizedWorkspaceRoot(candidate.workspaceRoot);
  const entries = sanitizeEntries(candidate.entries, now);
  if (entries.length === 0) {
    return null;
  }

  const fallbackTitle = fallbackChatThreadTitle(firstUserText(entries));
  const title =
    typeof candidate.title === "string" && candidate.title.trim()
      ? sanitizeGeneratedChatThreadTitle(candidate.title) || fallbackTitle
      : fallbackTitle;

  return {
    id: sanitizeThreadId(candidate.id),
    workspaceRoot,
    title,
    titleSource: sanitizeTitleSource(candidate.titleSource),
    createdAt: validIsoDate(candidate.createdAt, entries[0]?.createdAt ?? now),
    updatedAt: validIsoDate(candidate.updatedAt, now),
    entries
  };
}
