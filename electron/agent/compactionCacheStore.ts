import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import type { ConversationHistoryMessage, ConversationSummary } from "./conversationHistory.js";

const COMPACTION_CACHE_SCHEMA_VERSION = 1;
const MAX_CACHE_ENTRIES = 64;

export interface CompactionCacheEntry {
  prefixMessageCount: number;
  prefixHash: string;
  summary: string;
  estimatedTokens: number;
  /** Diagnostics only — lookups never consult it; summaries are provider-agnostic data. */
  model: string;
  createdAt: string;
  lastUsedAt: string;
}

interface CompactionCacheFile {
  schemaVersion: 1;
  entries: CompactionCacheEntry[];
}

/**
 * Injective serialization is a security property, not a convenience: history
 * content is attacker-influenced (quoted workspace Markdown), and a
 * concatenation-based hash would let crafted content alias different message
 * boundaries onto one digest and serve a wrong summary. JSON.stringify of
 * [role, content] pairs cannot alias.
 */
export function compactionPrefixHash(messages: ConversationHistoryMessage[]) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(messages.map((message) => [message.role, message.content])))
    .digest("hex");
}

export interface CompactionCacheHit extends ConversationSummary {
  prefixHash: string;
}

function emptyCacheFile(): CompactionCacheFile {
  return { schemaVersion: COMPACTION_CACHE_SCHEMA_VERSION, entries: [] };
}

function sanitizeEntry(entry: unknown): CompactionCacheEntry | null {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const candidate = entry as Record<string, unknown>;

  if (
    typeof candidate.prefixHash !== "string" ||
    !candidate.prefixHash ||
    typeof candidate.summary !== "string" ||
    !candidate.summary.trim() ||
    typeof candidate.prefixMessageCount !== "number" ||
    !Number.isInteger(candidate.prefixMessageCount) ||
    candidate.prefixMessageCount <= 0
  ) {
    return null;
  }

  const now = new Date().toISOString();

  return {
    prefixMessageCount: candidate.prefixMessageCount,
    prefixHash: candidate.prefixHash,
    summary: candidate.summary,
    estimatedTokens:
      typeof candidate.estimatedTokens === "number" && candidate.estimatedTokens >= 0
        ? Math.floor(candidate.estimatedTokens)
        : 0,
    model: typeof candidate.model === "string" ? candidate.model : "unknown",
    createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : now,
    lastUsedAt: typeof candidate.lastUsedAt === "string" ? candidate.lastUsedAt : now
  };
}

/**
 * Content-addressed cache of conversation compaction summaries (ADR-0015).
 * No thread identity anywhere: entries are keyed by an injective hash of the
 * covered message prefix. Shared by both AgentService instances (the
 * chatHistoryStore injection precedent) and wiped entirely by clear-chat-
 * history — content-addressing makes selective purge impossible, and summaries
 * of deleted conversations must not outlive them.
 */
export class CompactionCacheStore {
  private readonly storePath: string;
  private queue: Promise<unknown> = Promise.resolve();
  private generation = 0;
  private readonly pendingTouches = new Map<string, string>();

  constructor(userDataPath: string) {
    this.storePath = path.join(userDataPath, "assistant", "compaction-cache.json");
  }

  /** Snapshot before generating; put() refuses to write if a clear happened since. */
  clearGeneration() {
    return this.generation;
  }

  /**
   * Finds the cached summary covering the largest head-anchored prefix of the
   * omitted messages. Touches lastUsedAt in memory only; the touch persists on
   * the next mutation (no per-hit file write).
   */
  async lookup(messages: ConversationHistoryMessage[], omittedCount: number): Promise<CompactionCacheHit | null> {
    if (omittedCount <= 0 || messages.length < omittedCount) {
      return null;
    }

    return this.enqueue(async () => {
      const file = await this.readFile();
      const candidates = file.entries
        .filter((entry) => entry.prefixMessageCount <= omittedCount)
        .sort((a, b) => b.prefixMessageCount - a.prefixMessageCount);

      for (const entry of candidates) {
        if (compactionPrefixHash(messages.slice(0, entry.prefixMessageCount)) === entry.prefixHash) {
          this.pendingTouches.set(entry.prefixHash, new Date().toISOString());
          return { text: entry.summary, coveredMessageCount: entry.prefixMessageCount, prefixHash: entry.prefixHash };
        }
      }

      return null;
    });
  }

  /**
   * Persists a generated summary. The superseded predecessor (the rolling
   * input) is deleted in the same mutation; LRU prunes past the cap. A clear
   * that happened after `generation` was snapshotted wins: nothing is written.
   */
  async put(
    entry: Omit<CompactionCacheEntry, "createdAt" | "lastUsedAt">,
    generation: number,
    supersededHash?: string
  ): Promise<void> {
    await this.enqueue(async () => {
      if (generation !== this.generation) {
        return;
      }

      const file = await this.readFile();
      const now = new Date().toISOString();
      const entries = file.entries.filter(
        (existing) => existing.prefixHash !== entry.prefixHash && existing.prefixHash !== supersededHash
      );

      for (const existing of entries) {
        const touch = this.pendingTouches.get(existing.prefixHash);

        if (touch) {
          existing.lastUsedAt = touch;
        }
      }

      this.pendingTouches.clear();
      // The fresh entry leads before the stable sort so same-millisecond
      // timestamps can never evict the entry being written.
      const next = [{ ...entry, createdAt: now, lastUsedAt: now }, ...entries];
      next.sort((a, b) => Date.parse(b.lastUsedAt) - Date.parse(a.lastUsedAt));
      await this.writeFile({ schemaVersion: COMPACTION_CACHE_SCHEMA_VERSION, entries: next.slice(0, MAX_CACHE_ENTRIES) });
    });
  }

  /** Wipes everything (clear-chat-history). In-flight generations cannot write back. */
  async clearAll(): Promise<void> {
    this.generation += 1;
    this.pendingTouches.clear();
    await this.enqueue(async () => {
      await this.writeFile(emptyCacheFile());
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async readFile(): Promise<CompactionCacheFile> {
    try {
      const raw = await readFile(this.storePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<CompactionCacheFile>;

      if (parsed.schemaVersion !== COMPACTION_CACHE_SCHEMA_VERSION || !Array.isArray(parsed.entries)) {
        return emptyCacheFile();
      }

      return {
        schemaVersion: COMPACTION_CACHE_SCHEMA_VERSION,
        entries: parsed.entries.map(sanitizeEntry).filter((entry): entry is CompactionCacheEntry => Boolean(entry))
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return emptyCacheFile();
      }

      if (error instanceof SyntaxError) {
        await this.backupCorruptFile();
        return emptyCacheFile();
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

  private async writeFile(file: CompactionCacheFile) {
    await mkdir(path.dirname(this.storePath), { recursive: true });
    const tempPath = `${this.storePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
    await rename(tempPath, this.storePath);
  }
}
