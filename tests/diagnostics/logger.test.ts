import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createDiagnosticsLogger,
  diagnosticsRetentionPolicy,
  sanitizeDiagnosticDetails,
  sanitizeUnknownError
} from "../../electron/diagnostics/logger";

let userData = "";
let previousLogLevel: string | undefined;

beforeEach(async () => {
  userData = await mkdtemp(path.join(os.tmpdir(), "iliad-diagnostics-userdata-"));
  previousLogLevel = process.env.ILIAD_LOG_LEVEL;
});

afterEach(async () => {
  if (previousLogLevel === undefined) {
    delete process.env.ILIAD_LOG_LEVEL;
  } else {
    process.env.ILIAD_LOG_LEVEL = previousLogLevel;
  }

  await rm(userData, { recursive: true, force: true });
});

describe("diagnostics logger", () => {
  it("redacts unsafe detail keys and unsafe error messages", () => {
    expect(
      sanitizeDiagnosticDetails({
        providerEventType: "response.completed",
        hunkCount: 2,
        retryable: true,
        prompt: "raw prompt",
        apiKey: "sk-secret",
        relativePath: "course/s1.md",
        raw: { payload: true },
        longString: "x".repeat(220)
      })
    ).toEqual({
      providerEventType: "response.completed",
      hunkCount: 2,
      retryable: true,
      longString: `${"x".repeat(177)}...`
    });

    expect(sanitizeUnknownError(new Error("Authorization token was rejected"))).toEqual({
      errorName: "Error"
    });
    expect(sanitizeUnknownError(new Error("Failed near /Users/sebastian/private/course.md"))).toEqual({
      errorName: "Error",
      errorMessage: "Failed near [path]"
    });
    expect(sanitizeUnknownError(new Error("Provider returned sk-secretvalue123456"))).toEqual({
      errorName: "Error"
    });
  });

  it("writes redacted JSONL records and respects the configured log level", async () => {
    process.env.ILIAD_LOG_LEVEL = "warn";
    const logger = createDiagnosticsLogger(userData);

    logger.info({
      area: "agent",
      event: "agent.run.started",
      runId: "run-1"
    });
    logger.warn({
      area: "provider",
      event: "provider.retry",
      runId: "run-1",
      model: "gpt-5.5",
      details: {
        retryReason: "unsupported_reasoning_summary",
        prompt: "raw prompt should not be persisted"
      }
    });
    await logger.flush();

    const logDir = path.join(userData, "logs");
    const files = await readdir(logDir);
    const lines = (await readFile(path.join(logDir, files[0]), "utf8")).trim().split("\n");

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({
      level: "warn",
      area: "provider",
      event: "provider.retry",
      runId: "run-1",
      model: "gpt-5.5",
      details: {
        retryReason: "unsupported_reasoning_summary"
      }
    });
    expect(lines[0]).not.toContain("raw prompt");
  });

  it("prunes expired log files before writing a new record", async () => {
    const logDir = path.join(userData, "logs");
    await mkdir(logDir, { recursive: true });
    const oldLogPath = path.join(logDir, "iliad-2000-01-01.jsonl");
    await writeFile(oldLogPath, "{}\n", "utf8");
    const oldDate = new Date(Date.now() - (diagnosticsRetentionPolicy.maxAgeDays + 2) * 24 * 60 * 60 * 1000);
    await utimes(oldLogPath, oldDate, oldDate);

    const logger = createDiagnosticsLogger(userData);
    logger.warn({
      area: "agent",
      event: "agent.run.failed",
      runId: "run-prune"
    });
    await logger.flush();

    const files = await readdir(logDir);
    expect(files).not.toContain("iliad-2000-01-01.jsonl");
    expect(files.some((file) => /^iliad-\d{4}-\d{2}-\d{2}\.jsonl$/.test(file))).toBe(true);
  });
});
