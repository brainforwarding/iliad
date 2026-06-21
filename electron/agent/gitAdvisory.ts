import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const gitTimeoutMs = 1500;
type GitUnavailableReason = "git_missing" | "not_repo" | "unborn_head" | "timeout" | "error";

export type GitAdvisorySnapshot =
  | { status: "unavailable"; reason: GitUnavailableReason }
  | { status: "ok"; repositoryRoot: string; head: string; indexIdentity: string };

export type GitAdvisoryCheck =
  | { status: "ok" }
  | { status: "head_changed" }
  | { status: "index_changed" }
  | { status: "unsafe"; reason: "git_missing" | "timeout" | "error" };

export async function captureGitAdvisorySnapshot(workspaceRoot: string): Promise<GitAdvisorySnapshot> {
  const repositoryRoot = await gitOutput(workspaceRoot, ["rev-parse", "--show-toplevel"]);

  if (!repositoryRoot.ok) {
    return { status: "unavailable", reason: unavailableReason(repositoryRoot.error) };
  }

  const head = await gitOutput(workspaceRoot, ["rev-parse", "HEAD"]);

  if (!head.ok) {
    const reason = unavailableReason(head.error);
    return { status: "unavailable", reason: reason === "error" ? "unborn_head" : reason };
  }

  const indexIdentity = await gitIndexIdentity(workspaceRoot);

  if (!indexIdentity.ok) {
    return { status: "unavailable", reason: unavailableReason(indexIdentity.error) };
  }

  return {
    status: "ok",
    repositoryRoot: repositoryRoot.value,
    head: head.value,
    indexIdentity: indexIdentity.value
  };
}

export async function checkGitAdvisorySnapshot(
  workspaceRoot: string,
  snapshot: GitAdvisorySnapshot
): Promise<GitAdvisoryCheck> {
  if (snapshot.status === "unavailable") {
    return { status: "ok" };
  }

  const head = await gitOutput(workspaceRoot, ["rev-parse", "HEAD"]);

  if (!head.ok) {
    return { status: "unsafe", reason: unavailableReason(head.error) === "timeout" ? "timeout" : "error" };
  }

  if (head.value !== snapshot.head) {
    return { status: "head_changed" };
  }

  const indexIdentity = await gitIndexIdentity(workspaceRoot);

  if (!indexIdentity.ok) {
    return { status: "unsafe", reason: unavailableReason(indexIdentity.error) === "timeout" ? "timeout" : "error" };
  }

  if (indexIdentity.value !== snapshot.indexIdentity) {
    return { status: "index_changed" };
  }

  return { status: "ok" };
}

async function gitIndexIdentity(workspaceRoot: string) {
  const status = await gitOutput(workspaceRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);

  if (!status.ok) {
    return status;
  }

  return {
    ok: true as const,
    value: createHash("sha256").update(status.value).digest("hex")
  };
}

async function gitOutput(workspaceRoot: string, args: string[]) {
  try {
    const result = await execFileAsync("git", args, {
      cwd: workspaceRoot,
      encoding: "utf8",
      timeout: gitTimeoutMs,
      maxBuffer: 1024 * 1024
    });
    return { ok: true as const, value: result.stdout.trim() };
  } catch (error) {
    return { ok: false as const, error };
  }
}

function unavailableReason(error: unknown): GitUnavailableReason {
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  const signal = typeof error === "object" && error !== null && "signal" in error ? error.signal : undefined;
  const stderr = typeof error === "object" && error !== null && "stderr" in error ? String(error.stderr) : "";

  if (code === "ENOENT") {
    return "git_missing";
  }

  if (signal === "SIGTERM" || code === "ETIMEDOUT") {
    return "timeout";
  }

  if (/not a git repository/i.test(stderr)) {
    return "not_repo";
  }

  return "error";
}
