import { ipcMain } from "electron";
import path from "node:path";
import { sanitizeUnknownError, type DiagnosticDetailValue, type DiagnosticsLogger } from "../diagnostics/logger.js";
import { workspaceFingerprint } from "../review/externalReviewProjection.js";
import type { ExternalReviewActionResult, WorkspaceBaselineService } from "../review/workspaceBaseline.js";
import type {
  AgentChangeProposal,
  ApplyAgentProposalFileResponse
} from "../review/types.js";
import { isTrustedIpcSender, type TrustedIpcEvent } from "./trust.js";

// Outside-change review surface. Channel names keep their historical `agent:`
// prefix (spec V2); every handler resolves the workspace from the window's
// workspace session, never from a renderer-sent root.

export type WorkspaceSessionResolver = (
  event: TrustedIpcEvent,
  workspaceSessionId: string
) => Promise<string | null> | string | null;

export type ReviewBaselineService = Pick<
  WorkspaceBaselineService,
  "currentReview" | "keep" | "restore" | "restoreAll" | "isExternalProposalId"
>;

export interface ReviewIpcDeps {
  baselineService: ReviewBaselineService;
  resolveWorkspaceRootForSession: WorkspaceSessionResolver;
  diagnostics?: Pick<DiagnosticsLogger, "info" | "warn">;
}

interface ReviewFileRequest {
  workspaceSessionId: string;
  proposalId: string;
  fileId: string;
}

interface ReviewProposalRequest {
  workspaceSessionId: string;
  proposalId: string;
}

export function registerReviewIpc(deps: ReviewIpcDeps) {
  ipcMain.handle("agent:get-external-review", (event, request: unknown) => handleGetExternalReviewIpc(event, request, deps));
  ipcMain.handle("agent:apply-proposal-file", (event, request: unknown) => handleKeepFileIpc(event, request, deps));
  ipcMain.handle("agent:reject-proposal-file", (event, request: unknown) => handleRestoreFileIpc(event, request, deps));
  ipcMain.handle("agent:reject-proposal", (event, request: unknown) => handleRestoreAllIpc(event, request, deps));
}

export async function handleGetExternalReviewIpc(event: TrustedIpcEvent, request: unknown, deps: ReviewIpcDeps) {
  const workspaceRoot = await trustedWorkspaceRoot(event, request, deps, "The outside-changes request came from an untrusted window.");
  return deps.baselineService.currentReview(workspaceRoot);
}

/** Keep one outside file change: the baseline accepts the disk state (no disk write). */
export async function handleKeepFileIpc(
  event: TrustedIpcEvent,
  request: unknown,
  deps: ReviewIpcDeps
): Promise<ApplyAgentProposalFileResponse> {
  const workspaceRoot = await trustedWorkspaceRoot(event, request, deps, "The review action came from an untrusted window.");
  const { proposalId, fileId } = fileRequest(request);
  requireCurrentProposal(deps, workspaceRoot, proposalId);

  return logged(deps, "review.keep_file", workspaceRoot, { fileId }, async () =>
    keepResponse(await deps.baselineService.keep(workspaceRoot, fileId), fileId)
  );
}

/** Restore one outside file change: disk returns to the baseline. */
export async function handleRestoreFileIpc(
  event: TrustedIpcEvent,
  request: unknown,
  deps: ReviewIpcDeps
): Promise<AgentChangeProposal> {
  const workspaceRoot = await trustedWorkspaceRoot(event, request, deps, "The review action came from an untrusted window.");
  const { proposalId, fileId } = fileRequest(request);
  requireCurrentProposal(deps, workspaceRoot, proposalId);

  return logged(deps, "review.restore_file", workspaceRoot, { fileId }, async () =>
    (await deps.baselineService.restore(workspaceRoot, fileId)).proposal
  );
}

/** Restore every pending outside change; continues past failures and reports them. */
export async function handleRestoreAllIpc(
  event: TrustedIpcEvent,
  request: unknown,
  deps: ReviewIpcDeps
): Promise<AgentChangeProposal> {
  const workspaceRoot = await trustedWorkspaceRoot(event, request, deps, "The review action came from an untrusted window.");
  const { proposalId } = proposalRequest(request);
  requireCurrentProposal(deps, workspaceRoot, proposalId);

  return logged(deps, "review.restore_all", workspaceRoot, {}, async () => {
    const result = await deps.baselineService.restoreAll(workspaceRoot);

    if (result.unrestored.length > 0) {
      throw new Error(
        `Some outside changes could not be restored: ${result.unrestored
          .map((entry) => `${entry.relativePath} (${entry.reason})`)
          .join("; ")}`
      );
    }

    return result.proposal;
  });
}

export function keepResponse(result: ExternalReviewActionResult, fileId: string): ApplyAgentProposalFileResponse {
  const file = result.proposal.files.find((candidate) => candidate.id === fileId);
  const kind =
    result.kind === "edit"
      ? "edit_file"
      : result.kind === "create"
        ? "create_file"
        : result.kind === "delete"
          ? "delete_file"
          : (file?.kind ?? "edit_file");
  const status = result.status === "applied" ? "applied" : "stale";

  if (kind === "create_file") {
    return {
      kind,
      proposal: result.proposal,
      fileId,
      status,
      ...(result.relativePath
        ? {
            file: {
              name: path.basename(result.relativePath),
              path: path.join(result.snapshot.workspaceRoot, result.relativePath),
              relativePath: result.relativePath,
              kind: "markdown" as const
            },
            content: result.content
          }
        : {})
    };
  }

  if (kind === "delete_file") {
    return { kind, proposal: result.proposal, fileId, status };
  }

  return { kind, proposal: result.proposal, fileId, status, content: result.content };
}

async function trustedWorkspaceRoot(event: TrustedIpcEvent, request: unknown, deps: ReviewIpcDeps, untrustedMessage: string) {
  if (!isTrustedIpcSender(event)) {
    throw new Error(untrustedMessage);
  }

  const workspaceSessionId = stringField(request, "workspaceSessionId");
  const workspaceRoot = workspaceSessionId
    ? await deps.resolveWorkspaceRootForSession(event, workspaceSessionId)
    : null;

  if (typeof workspaceRoot !== "string" || !workspaceRoot.trim()) {
    throw new Error("Outside-changes review requires the current trusted workspace.");
  }

  return path.resolve(workspaceRoot);
}

function requireCurrentProposal(deps: ReviewIpcDeps, workspaceRoot: string, proposalId: string) {
  if (!deps.baselineService.isExternalProposalId(workspaceRoot, proposalId)) {
    throw new Error("That review is no longer current.");
  }
}

function fileRequest(request: unknown): ReviewFileRequest {
  const proposalId = stringField(request, "proposalId");
  const fileId = stringField(request, "fileId");
  const workspaceSessionId = stringField(request, "workspaceSessionId");

  if (!proposalId || !fileId || !workspaceSessionId) {
    throw new Error("The review action is missing its target.");
  }

  return { workspaceSessionId, proposalId, fileId };
}

function proposalRequest(request: unknown): ReviewProposalRequest {
  const proposalId = stringField(request, "proposalId");
  const workspaceSessionId = stringField(request, "workspaceSessionId");

  if (!proposalId || !workspaceSessionId) {
    throw new Error("The review action is missing its target.");
  }

  return { workspaceSessionId, proposalId };
}

function stringField(value: unknown, key: string) {
  if (!value || typeof value !== "object" || !(key in value)) {
    return "";
  }

  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" ? field.trim() : "";
}

async function logged<T>(
  deps: ReviewIpcDeps,
  event: string,
  workspaceRoot: string,
  details: Record<string, DiagnosticDetailValue>,
  action: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now();
  const baseDetails = { workspaceFingerprint: workspaceFingerprint(workspaceRoot), ...details };

  try {
    const result = await action();
    deps.diagnostics?.info({ area: "review", event: `${event}.finished`, durationMs: Date.now() - startedAt, details: baseDetails });
    return result;
  } catch (error) {
    deps.diagnostics?.warn({
      area: "review",
      event: `${event}.failed`,
      durationMs: Date.now() - startedAt,
      details: { ...baseDetails, ...sanitizeUnknownError(error) }
    });
    throw error;
  }
}
