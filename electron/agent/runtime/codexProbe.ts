import { execFile } from "node:child_process";
import path from "node:path";
import { codexCliSearchPath } from "./codexCliEnv.js";

export interface CodexCliProbeRequest {
  executablePath?: string;
  timeoutMs?: number;
}

export type CodexCliProbeErrorCode =
  | "invalid_path"
  | "not_found"
  | "not_codex_executable"
  | "timeout"
  | "failed"
  | "invalid_output";

export type CodexCliProbeResponse =
  | {
      ok: true;
      executablePath: string;
      version: string;
      rawVersion: string;
    }
  | {
      ok: false;
      executablePath: string;
      error: {
        code: CodexCliProbeErrorCode;
        message: string;
        detail?: string;
        exitCode?: number;
      };
    };

type CodexCliProbeError = Extract<CodexCliProbeResponse, { ok: false }>["error"];
type CodexCliProbeExecError = Error & {
  code?: string | number | null;
  killed?: boolean;
  signal?: string | null;
};
type ExecFileCallback = Parameters<typeof execFile>[3];
type ExecFileOptions = NonNullable<Parameters<typeof execFile>[2]>;
type ExecFileLike = (file: string, args: string[], options: ExecFileOptions, callback: ExecFileCallback) => unknown;

const defaultExecutablePath = "codex";
const defaultTimeoutMs = 5_000;

export function normalizeCodexCliProbeRequest(request: unknown): CodexCliProbeRequest {
  if (!request || typeof request !== "object") {
    return {};
  }

  const record = request as Record<string, unknown>;
  return {
    executablePath: typeof record.executablePath === "string" ? record.executablePath : undefined,
    timeoutMs: typeof record.timeoutMs === "number" && Number.isFinite(record.timeoutMs) ? record.timeoutMs : undefined
  };
}

export async function probeCodexCli(request: CodexCliProbeRequest = {}) {
  return probeCodexCliWithExec(request, execFile);
}

export function probeCodexCliWithExec(
  request: CodexCliProbeRequest = {},
  execFileImpl: ExecFileLike
): Promise<CodexCliProbeResponse> {
  const executablePath = (request.executablePath || defaultExecutablePath).trim();
  const pathError = validateCodexExecutablePath(executablePath);

  if (pathError) {
    return Promise.resolve({
      ok: false,
      executablePath: executablePath || defaultExecutablePath,
      error: pathError
    });
  }

  return new Promise((resolve) => {
    execFileImpl(
      executablePath,
      ["--version"],
      {
        shell: false,
        windowsHide: true,
        timeout: clampTimeoutMs(request.timeoutMs),
        maxBuffer: 16 * 1024,
        env: safeProbeEnv()
      },
      (error, stdout, stderr) => {
        if (error) {
          resolve(failedProbeResponse(executablePath, error, String(stderr ?? "")));
          return;
        }

        const rawVersion = [stdout, stderr].map((value) => String(value ?? "")).join("\n").trim();
        const version = parseCodexVersion(rawVersion);

        if (!version) {
          resolve({
            ok: false,
            executablePath,
            error: {
              code: "invalid_output",
              message: "Codex CLI did not return a recognizable version.",
              detail: truncateDetail(rawVersion)
            }
          });
          return;
        }

        resolve({
          ok: true,
          executablePath,
          version,
          rawVersion
        });
      }
    );
  });
}

export function parseCodexVersion(output: string) {
  const trimmed = output.trim();
  const match = trimmed.match(/\bv?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/);
  return match?.[1] ?? "";
}

function validateCodexExecutablePath(executablePath: string): CodexCliProbeError | null {
  if (!executablePath || /[\0\r\n]/.test(executablePath)) {
    return {
      code: "invalid_path",
      message: "Enter a Codex CLI executable path."
    };
  }

  if (executablePath === defaultExecutablePath) {
    return null;
  }

  if (!path.isAbsolute(executablePath)) {
    return {
      code: "invalid_path",
      message: "Codex CLI probes require an absolute executable path, or the default codex command."
    };
  }

  if (!path.basename(executablePath).toLowerCase().includes("codex")) {
    return {
      code: "not_codex_executable",
      message: "The executable name must look like a Codex CLI binary."
    };
  }

  return null;
}

function clampTimeoutMs(timeoutMs: number | undefined) {
  if (!timeoutMs) {
    return defaultTimeoutMs;
  }

  return Math.max(500, Math.min(timeoutMs, 15_000));
}

function failedProbeResponse(
  executablePath: string,
  error: CodexCliProbeExecError,
  stderr: string
): CodexCliProbeResponse {
  const code =
    error.code === "ENOENT"
      ? "not_found"
      : error.killed || error.signal === "SIGTERM"
        ? "timeout"
        : "failed";

  return {
    ok: false,
    executablePath,
    error: {
      code,
      message:
        code === "not_found"
          ? "Codex CLI was not found at that path."
          : code === "timeout"
            ? "Codex CLI version check timed out."
            : "Codex CLI version check failed.",
      detail: truncateDetail(stderr || error.message),
      exitCode: typeof error.code === "number" ? error.code : undefined
    }
  };
}

function safeProbeEnv() {
  return {
    PATH: codexCliSearchPath(),
    SystemRoot: process.env.SystemRoot ?? "",
    windir: process.env.windir ?? ""
  };
}

function truncateDetail(detail: string) {
  const trimmed = detail.trim();
  return trimmed ? trimmed.slice(0, 300) : undefined;
}
