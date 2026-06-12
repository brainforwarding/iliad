import { appendFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

export type DiagnosticLogLevel = "debug" | "info" | "warn" | "error";
export type DiagnosticLogArea = "app" | "workspace" | "agent" | "provider" | "review";
export type DiagnosticDetailValue = string | number | boolean | null;

export interface DiagnosticLogRecord {
  timestamp: string;
  level: DiagnosticLogLevel;
  area: DiagnosticLogArea;
  event: string;
  runId?: string;
  requestId?: string;
  model?: string;
  mode?: string;
  durationMs?: number;
  errorCode?: string;
  providerStatus?: number;
  retryable?: boolean;
  details?: Record<string, DiagnosticDetailValue>;
}

export type DiagnosticLogInput = Omit<DiagnosticLogRecord, "timestamp">;

export interface DiagnosticsLogger {
  log(record: DiagnosticLogInput): void;
  debug(record: Omit<DiagnosticLogInput, "level">): void;
  info(record: Omit<DiagnosticLogInput, "level">): void;
  warn(record: Omit<DiagnosticLogInput, "level">): void;
  error(record: Omit<DiagnosticLogInput, "level">): void;
  flush(): Promise<void>;
}

const LOG_RETENTION_DAYS = 7;
const LOG_RETENTION_BYTES = 10 * 1024 * 1024;
const LOG_FILENAME_PATTERN = /^iliad-\d{4}-\d{2}-\d{2}\.jsonl$/;
const MAX_STRING_LENGTH = 180;
const LOG_LEVELS: DiagnosticLogLevel[] = ["debug", "info", "warn", "error"];
const SECRET_KEY_PATTERN = /key|token|secret|authorization|password|credential/i;
const SECRET_VALUE_PATTERN = /\b(?:sk-[A-Za-z0-9_-]{8,}|gh[opsu]_[A-Za-z0-9_]{8,}|Bearer\s+[A-Za-z0-9._-]{8,})\b/i;
const ABSOLUTE_PATH_PATTERN = /(?:\/Users\/|\/private\/|\/var\/folders\/|\/tmp\/|[A-Za-z]:\\)[^\s"'`<>)]*/g;
const FORBIDDEN_CONTENT_KEYS = new Set([
  "basecontent",
  "body",
  "content",
  "document",
  "filepath",
  "markdown",
  "path",
  "payload",
  "prompt",
  "raw",
  "replacement",
  "workspaceroot"
]);

export function createDiagnosticsLogger(userDataPath: string): DiagnosticsLogger {
  return new JsonlDiagnosticsLogger(userDataPath);
}

export const diagnosticsRetentionPolicy = {
  maxAgeDays: LOG_RETENTION_DAYS,
  maxTotalBytes: LOG_RETENTION_BYTES
} as const;

export function sanitizeDiagnosticDetails(
  details: Record<string, unknown> | undefined
): Record<string, DiagnosticDetailValue> | undefined {
  if (!details) {
    return undefined;
  }

  const clean: Record<string, DiagnosticDetailValue> = {};

  for (const [key, value] of Object.entries(details)) {
    if (!isSafeDetailKey(key)) {
      continue;
    }

    const cleanValue = sanitizeDiagnosticValue(value);

    if (cleanValue !== undefined) {
      clean[key] = cleanValue;
    }
  }

  return Object.keys(clean).length > 0 ? clean : undefined;
}

export function sanitizeUnknownError(error: unknown): Record<string, DiagnosticDetailValue> {
  const details: Record<string, DiagnosticDetailValue> = {};

  if (isRecord(error)) {
    const name = sanitizeDiagnosticValue(error.name);
    const code = sanitizeDiagnosticValue(error.code);
    const status = sanitizeDiagnosticValue(error.status ?? error.statusCode ?? error.providerStatus);

    if (name !== undefined) {
      details.errorName = name;
    }

    if (code !== undefined) {
      details.errorCode = code;
    }

    if (status !== undefined) {
      details.providerStatus = status;
    }
  }

  if (error instanceof Error) {
    const name = sanitizeDiagnosticValue(error.name);
    const code = sanitizeDiagnosticValue((error as NodeJS.ErrnoException).code);
    const message = sanitizeErrorMessage(error.message);

    if (name !== undefined) {
      details.errorName = name;
    }

    if (code !== undefined) {
      details.errorCode = code;
    }

    if (message !== undefined) {
      details.errorMessage = message;
    }
  }

  return details;
}

class JsonlDiagnosticsLogger implements DiagnosticsLogger {
  private readonly logDir: string;
  private readonly minimumLevel: DiagnosticLogLevel;
  private writeQueue = Promise.resolve();
  private lastPruneAt = 0;

  constructor(userDataPath: string) {
    this.logDir = path.join(userDataPath, "logs");
    this.minimumLevel = configuredLogLevel();
  }

  log(record: DiagnosticLogInput) {
    if (!shouldLog(record.level, this.minimumLevel)) {
      return;
    }

    const clean = sanitizeLogRecord(record);

    this.writeQueue = this.writeQueue
      .then(() => this.writeRecord(clean))
      .catch((error) => {
        console.warn(`diagnostics logger failed ${safeConsoleError(error)}`);
      });
  }

  debug(record: Omit<DiagnosticLogInput, "level">) {
    this.log({ ...record, level: "debug" });
  }

  info(record: Omit<DiagnosticLogInput, "level">) {
    this.log({ ...record, level: "info" });
  }

  warn(record: Omit<DiagnosticLogInput, "level">) {
    this.log({ ...record, level: "warn" });
  }

  error(record: Omit<DiagnosticLogInput, "level">) {
    this.log({ ...record, level: "error" });
  }

  async flush() {
    await this.writeQueue;
  }

  private async writeRecord(record: DiagnosticLogRecord) {
    await mkdir(this.logDir, { recursive: true });
    await this.pruneIfNeeded();
    await appendFile(path.join(this.logDir, logFilename(new Date(record.timestamp))), `${JSON.stringify(record)}\n`, "utf8");
  }

  private async pruneIfNeeded() {
    const now = Date.now();

    if (now - this.lastPruneAt < 60_000) {
      return;
    }

    this.lastPruneAt = now;
    await pruneLogs(this.logDir);
  }
}

function sanitizeLogRecord(record: DiagnosticLogInput): DiagnosticLogRecord {
  const clean: DiagnosticLogRecord = {
    timestamp: new Date().toISOString(),
    level: record.level,
    area: record.area,
    event: sanitizeIdentifier(record.event, "unknown")
  };

  const runId = sanitizeOptionalString(record.runId);
  const requestId = sanitizeOptionalString(record.requestId);
  const model = sanitizeOptionalString(record.model);
  const mode = sanitizeOptionalString(record.mode);
  const durationMs = sanitizeNumber(record.durationMs);
  const providerStatus = sanitizeNumber(record.providerStatus);
  const errorCode = sanitizeOptionalString(record.errorCode);
  const details = sanitizeDiagnosticDetails(record.details);

  if (runId) {
    clean.runId = runId;
  }

  if (requestId) {
    clean.requestId = requestId;
  }

  if (model) {
    clean.model = model;
  }

  if (mode) {
    clean.mode = mode;
  }

  if (durationMs !== undefined) {
    clean.durationMs = durationMs;
  }

  if (errorCode) {
    clean.errorCode = errorCode;
  }

  if (providerStatus !== undefined) {
    clean.providerStatus = providerStatus;
  }

  if (typeof record.retryable === "boolean") {
    clean.retryable = record.retryable;
  }

  if (details) {
    clean.details = details;
  }

  return clean;
}

function sanitizeDiagnosticValue(value: unknown): DiagnosticDetailValue | undefined {
  if (value === null) {
    return null;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value);
  }

  if (typeof value === "string") {
    const clean = value.replace(/\s+/g, " ").trim();

    if (!clean) {
      return undefined;
    }

    return clean.length > MAX_STRING_LENGTH ? `${clean.slice(0, MAX_STRING_LENGTH - 3).trimEnd()}...` : clean;
  }

  return undefined;
}

function sanitizeErrorMessage(message: string): string | undefined {
  if (SECRET_KEY_PATTERN.test(message) || SECRET_VALUE_PATTERN.test(message)) {
    return undefined;
  }

  return sanitizeDiagnosticValue(message.replace(ABSOLUTE_PATH_PATTERN, "[path]")) as string | undefined;
}

function sanitizeOptionalString(value: string | undefined): string | undefined {
  const clean = sanitizeDiagnosticValue(value);
  return typeof clean === "string" ? clean : undefined;
}

function sanitizeIdentifier(value: string, fallback: string) {
  const clean = sanitizeOptionalString(value);
  return clean ?? fallback;
}

function sanitizeNumber(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : undefined;
}

function isSafeDetailKey(key: string) {
  const normalized = key.toLowerCase();

  if (SECRET_KEY_PATTERN.test(key) || FORBIDDEN_CONTENT_KEYS.has(normalized)) {
    return false;
  }

  return !normalized.endsWith("path");
}

function configuredLogLevel(): DiagnosticLogLevel {
  const value = process.env.ILIAD_LOG_LEVEL?.toLowerCase();
  return isDiagnosticLogLevel(value) ? value : "info";
}

function shouldLog(level: DiagnosticLogLevel, minimumLevel: DiagnosticLogLevel) {
  return LOG_LEVELS.indexOf(level) >= LOG_LEVELS.indexOf(minimumLevel);
}

function isDiagnosticLogLevel(value: string | undefined): value is DiagnosticLogLevel {
  return value === "debug" || value === "info" || value === "warn" || value === "error";
}

function logFilename(date: Date) {
  return `iliad-${date.toISOString().slice(0, 10)}.jsonl`;
}

async function pruneLogs(logDir: string) {
  const entries = await readdir(logDir).catch(() => []);
  const files = (
    await Promise.all(
      entries
        .filter((entry) => LOG_FILENAME_PATTERN.test(entry))
        .map(async (entry) => {
          const filePath = path.join(logDir, entry);
          const stats = await stat(filePath).catch(() => null);

          return stats ? { filePath, mtimeMs: stats.mtimeMs, size: stats.size } : null;
        })
    )
  ).filter((file): file is { filePath: string; mtimeMs: number; size: number } => file !== null);

  const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;

  for (const file of files.filter((candidate) => candidate.mtimeMs < cutoff)) {
    await rm(file.filePath, { force: true });
  }

  let retained = files.filter((candidate) => candidate.mtimeMs >= cutoff).sort((a, b) => a.mtimeMs - b.mtimeMs);
  let totalSize = retained.reduce((sum, file) => sum + file.size, 0);

  while (totalSize > LOG_RETENTION_BYTES && retained.length > 1) {
    const oldest = retained.shift();

    if (!oldest) {
      break;
    }

    totalSize -= oldest.size;
    await rm(oldest.filePath, { force: true });
  }
}

function safeConsoleError(error: unknown) {
  const details = sanitizeUnknownError(error);
  return Object.entries(details)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
