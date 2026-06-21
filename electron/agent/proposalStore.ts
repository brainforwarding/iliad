import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { readMarkdownFile, writeMarkdownFile } from "../fs/fileOps.js";
import { ensureMarkdownFile, ensureVisibleWorkspacePath } from "../fs/pathSafety.js";
import {
  buildLineReviewHunks,
  deriveEditFileStatus,
  hasMutableReviewHunks,
  markUnresolvedHunksStale,
  reconstructContent,
  resolveHunkStatus
} from "./reviewDiff.js";
import type {
  AgentChangeProposal,
  AgentEditFileProposal,
  AgentProposalFileChange,
  AgentProposalFileStatus,
  AgentProposalStatus,
  ApplyAgentProposalFileResponse,
  ResolveAgentProposalHunkResponse
} from "./types.js";

const TERMINAL_HISTORY_LIMIT = 100;
const STALE_EDIT_MESSAGE = "This document changed after the proposal was created. Ask the agent to regenerate it.";
const CREATE_COLLISION_MESSAGE = "A file with that assistant-proposed name already exists.";

type ProposalMutation<T> = (proposals: AgentChangeProposal[]) => Promise<T> | T;

function isTerminalStatus(status: AgentProposalStatus) {
  return status === "applied" || status === "rejected";
}

function cloneProposal(proposal: AgentChangeProposal): AgentChangeProposal {
  return JSON.parse(JSON.stringify(proposal)) as AgentChangeProposal;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to update this proposal.";
}

function fileTreeNode(workspaceRoot: string, filePath: string) {
  return {
    name: path.basename(filePath),
    path: filePath,
    relativePath: path.relative(workspaceRoot, filePath),
    kind: "markdown" as const
  };
}

function mutableCreateFileStatus(status: AgentProposalFileStatus) {
  return status === "pending" || status === "stale" || status === "failed";
}

function mutableStateOnlyFileStatus(status: AgentProposalFileStatus) {
  return status === "pending" || status === "stale" || status === "failed";
}

export function recomputeProposalStatus(files: AgentProposalFileChange[]): AgentProposalStatus {
  if (files.length === 0) {
    return "pending";
  }

  if (files.every((file) => file.status === "applied")) {
    return "applied";
  }

  if (files.every((file) => file.status === "rejected")) {
    return "rejected";
  }

  if (files.some((file) => file.status === "applied" || file.status === "partially_applied")) {
    return "partially_applied";
  }

  if (files.some((file) => file.status === "stale")) {
    return "stale";
  }

  if (files.some((file) => file.status === "failed")) {
    return "failed";
  }

  return "pending";
}

function touchAndRecompute(proposal: AgentChangeProposal) {
  ensureProposalReviewHunks(proposal);
  proposal.status = recomputeProposalStatus(proposal.files);
  proposal.updatedAt = new Date().toISOString();
}

function ensureEditReviewHunks(file: AgentEditFileProposal) {
  if (Array.isArray(file.hunks)) {
    const previousStatus = file.status;
    file.status = deriveEditFileStatus(file);
    return file.status !== previousStatus;
  }

  const previousStatus = file.status;
  file.hunks = buildLineReviewHunks(file.baseContent, file.replacement, file.id);

  if (previousStatus === "applied" || previousStatus === "rejected" || previousStatus === "stale") {
    for (const hunk of file.hunks) {
      hunk.status = previousStatus === "applied" ? "accepted" : previousStatus;
    }
  }

  if (previousStatus === "failed") {
    file.status = "failed";
    return true;
  }

  if (file.hunks.length === 0 && (previousStatus === "applied" || previousStatus === "rejected")) {
    file.status = previousStatus;
    return true;
  }

  file.status = deriveEditFileStatus(file);
  return true;
}

function ensureProposalReviewHunks(proposal: AgentChangeProposal) {
  let changed = false;

  for (const file of proposal.files) {
    if (file.kind === "edit_file") {
      changed = ensureEditReviewHunks(file) || changed;
    }
  }

  return changed;
}

function fileHasMutableWork(file: AgentProposalFileChange) {
  if (file.kind === "edit_file") {
    return file.status === "failed" || hasMutableReviewHunks(file);
  }

  return mutableStateOnlyFileStatus(file.status);
}

function pruneTerminalHistory(proposals: AgentChangeProposal[]) {
  const terminal = proposals
    .filter((proposal) => isTerminalStatus(proposal.status))
    .sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt));
  const keepTerminalIds = new Set(terminal.slice(0, TERMINAL_HISTORY_LIMIT).map((proposal) => proposal.id));

  return proposals.filter((proposal) => !isTerminalStatus(proposal.status) || keepTerminalIds.has(proposal.id));
}

function proposalMatchesWorkspace(proposal: AgentChangeProposal, workspaceRoot: string) {
  return path.resolve(proposal.workspaceRoot) === path.resolve(workspaceRoot);
}

function resolveProposalFile(workspaceRoot: string, relativePath: string) {
  return path.join(workspaceRoot, relativePath);
}

function validateGeneratedMarkdownPath(workspaceRoot: string, relativePath: string) {
  const trimmed = relativePath.trim();
  const segments = trimmed.split(/[\\/]+/);

  if (
    !trimmed ||
    path.isAbsolute(trimmed) ||
    segments.some((segment) => !segment || segment === "." || segment === ".." || segment.startsWith("."))
  ) {
    throw new Error("Assistant document paths must be relative Markdown paths.");
  }

  const filePath = resolveProposalFile(workspaceRoot, trimmed);
  ensureMarkdownFile(workspaceRoot, filePath);
  ensureVisibleWorkspacePath(workspaceRoot, path.dirname(filePath));
  return filePath;
}

export class AgentProposalStore {
  private readonly storePath: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(userDataPath: string) {
    this.storePath = path.join(userDataPath, "assistant", "proposals.json");
  }

  async listProposals(workspaceRoot: string): Promise<AgentChangeProposal[]> {
    return this.enqueue(async () => {
      const proposals = await this.readAll();
      let changed = false;

      for (const proposal of proposals) {
        if (proposalMatchesWorkspace(proposal, workspaceRoot)) {
          const previousStatus = proposal.status;
          changed = ensureProposalReviewHunks(proposal) || changed;
          proposal.status = recomputeProposalStatus(proposal.files);
          changed = proposal.status !== previousStatus || changed;
        }
      }

      if (changed) {
        await this.writeAll(pruneTerminalHistory(proposals));
      }

      return proposals
        .filter((proposal) => proposalMatchesWorkspace(proposal, workspaceRoot))
        .sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt))
        .map(cloneProposal);
    });
  }

  async getProposal(workspaceRoot: string, proposalId: string): Promise<AgentChangeProposal | null> {
    return this.enqueue(async () => {
      const proposals = await this.readAll();
      const proposal = proposals.find(
        (candidate) => candidate.id === proposalId && proposalMatchesWorkspace(candidate, workspaceRoot)
      );

      if (proposal) {
        const previousStatus = proposal.status;
        const changed = ensureProposalReviewHunks(proposal);
        proposal.status = recomputeProposalStatus(proposal.files);
        if (changed || proposal.status !== previousStatus) {
          await this.writeAll(pruneTerminalHistory(proposals));
        }
      }

      return proposal ? cloneProposal(proposal) : null;
    });
  }

  async saveProposal(proposal: AgentChangeProposal): Promise<AgentChangeProposal> {
    return this.mutate(async (proposals) => {
      const nextProposal = cloneProposal(proposal);
      touchAndRecompute(nextProposal);
      const index = proposals.findIndex((candidate) => candidate.id === nextProposal.id);

      if (index >= 0) {
        proposals[index] = nextProposal;
      } else {
        proposals.push(nextProposal);
      }

      return cloneProposal(nextProposal);
    });
  }

  async applyProposalFile(
    workspaceRoot: string,
    proposalId: string,
    fileId: string
  ): Promise<ApplyAgentProposalFileResponse> {
    return this.mutate(async (proposals) => {
      const proposal = findStoredProposal(proposals, workspaceRoot, proposalId);
      const file = findStoredFile(proposal, fileId);
      ensureProposalReviewHunks(proposal);

      if (file.status === "applied") {
        return {
          kind: file.kind,
          proposal: cloneProposal(proposal),
          fileId: file.id,
          status: file.status
        } as ApplyAgentProposalFileResponse;
      }

      if (file.status === "rejected") {
        throw new Error("Rejected proposal files cannot be applied.");
      }

      if (file.kind === "edit_file") {
        const filePath = resolveProposalFile(workspaceRoot, file.relativePath);

        try {
          const current = await readMarkdownFile(workspaceRoot, filePath);
          const expected = reconstructContent(file.baseContent, file.hunks ?? []);

          if (current !== expected) {
            markUnresolvedHunksStale(file);
            file.error = STALE_EDIT_MESSAGE;
            file.status = deriveEditFileStatus(file);
            touchAndRecompute(proposal);
            return {
              kind: "edit_file",
              proposal: cloneProposal(proposal),
              fileId: file.id,
              status: file.status
            };
          }

          for (const hunk of file.hunks ?? []) {
            if (hunk.status === "pending") {
              hunk.status = "accepted";
            }
          }

          const nextContent = reconstructContent(file.baseContent, file.hunks ?? []);

          if (nextContent !== current) {
            await writeMarkdownFile(workspaceRoot, filePath, nextContent);
          }

          if (file.status === "failed") {
            file.status = "pending";
          }
          file.status = deriveEditFileStatus(file);
          delete file.error;
          touchAndRecompute(proposal);
          return {
            kind: "edit_file",
            proposal: cloneProposal(proposal),
            fileId: file.id,
            status: file.status,
            content: nextContent
          };
        } catch (error) {
          if (file.status !== "stale") {
            file.status = "failed";
            file.error = errorMessage(error);
            touchAndRecompute(proposal);
          }

          return {
            kind: "edit_file",
            proposal: cloneProposal(proposal),
            fileId: file.id,
            status: file.status
          };
        }
      }

      if (file.kind === "create_file") {
        try {
          const filePath = validateGeneratedMarkdownPath(workspaceRoot, file.relativePath);

          try {
            await mkdir(path.dirname(filePath), { recursive: true });
            await writeFile(filePath, file.content, { encoding: "utf8", flag: "wx" });
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "EEXIST") {
              file.status = "stale";
              file.error = CREATE_COLLISION_MESSAGE;
              touchAndRecompute(proposal);
              return {
                kind: "create_file",
                proposal: cloneProposal(proposal),
                fileId: file.id,
                status: file.status
              };
            }

            throw error;
          }

          file.status = "applied";
          delete file.error;
          touchAndRecompute(proposal);
          return {
            kind: "create_file",
            proposal: cloneProposal(proposal),
            fileId: file.id,
            status: file.status,
            file: fileTreeNode(workspaceRoot, filePath),
            content: file.content
          };
        } catch (error) {
          file.status = "failed";
          file.error = errorMessage(error);
          touchAndRecompute(proposal);
          return {
            kind: "create_file",
            proposal: cloneProposal(proposal),
            fileId: file.id,
            status: file.status
          };
        }
      }

      try {
        const filePath = validateGeneratedMarkdownPath(workspaceRoot, file.relativePath);
        const current = await readMarkdownFile(workspaceRoot, filePath);

        if (current !== file.baseContent) {
          file.status = "stale";
          file.error = STALE_EDIT_MESSAGE;
          touchAndRecompute(proposal);
          return {
            kind: "delete_file",
            proposal: cloneProposal(proposal),
            fileId: file.id,
            status: file.status
          };
        }

        await rm(filePath);
        file.status = "applied";
        delete file.error;
        touchAndRecompute(proposal);
        return {
          kind: "delete_file",
          proposal: cloneProposal(proposal),
          fileId: file.id,
          status: file.status
        };
      } catch (error) {
        file.status = "failed";
        file.error = errorMessage(error);
        touchAndRecompute(proposal);
        return {
          kind: "delete_file",
          proposal: cloneProposal(proposal),
          fileId: file.id,
          status: file.status
        };
      }
    });
  }

  async rejectProposalFile(workspaceRoot: string, proposalId: string, fileId: string): Promise<AgentChangeProposal> {
    return this.mutate((proposals) => {
      const proposal = findStoredProposal(proposals, workspaceRoot, proposalId);
      const file = findStoredFile(proposal, fileId);
      ensureProposalReviewHunks(proposal);

      if (file.kind === "edit_file") {
        if (file.status !== "rejected" && file.status !== "applied") {
          for (const hunk of file.hunks ?? []) {
            if (hunk.status === "pending" || hunk.status === "stale") {
              hunk.status = "rejected";
            }
          }

          if (file.status === "failed") {
            file.status = "pending";
          }
          file.status = deriveEditFileStatus(file);
          delete file.error;
          touchAndRecompute(proposal);
        }

        return cloneProposal(proposal);
      }

      if (mutableStateOnlyFileStatus(file.status)) {
        file.status = "rejected";
        delete file.error;
        touchAndRecompute(proposal);
      }

      return cloneProposal(proposal);
    });
  }

  async rejectProposal(workspaceRoot: string, proposalId: string): Promise<AgentChangeProposal> {
    return this.mutate((proposals) => {
      const proposal = findStoredProposal(proposals, workspaceRoot, proposalId);
      ensureProposalReviewHunks(proposal);

      for (const file of proposal.files) {
        if (file.kind === "edit_file") {
          if (fileHasMutableWork(file)) {
            for (const hunk of file.hunks ?? []) {
              if (hunk.status === "pending" || hunk.status === "stale") {
                hunk.status = "rejected";
              }
            }

            if (file.status === "failed") {
              file.status = "pending";
            }
            file.status = deriveEditFileStatus(file);
            delete file.error;
          }

          continue;
        }

        if (mutableStateOnlyFileStatus(file.status)) {
          file.status = "rejected";
          delete file.error;
        }
      }

      touchAndRecompute(proposal);
      return cloneProposal(proposal);
    });
  }

  async resolveProposalHunk(
    workspaceRoot: string,
    proposalId: string,
    fileId: string,
    hunkId: string,
    decision: "accept" | "reject"
  ): Promise<ResolveAgentProposalHunkResponse> {
    return this.mutate(async (proposals) => {
      const proposal = findStoredProposal(proposals, workspaceRoot, proposalId);
      const file = findStoredFile(proposal, fileId);
      ensureProposalReviewHunks(proposal);

      if (file.kind !== "edit_file") {
        throw new Error("Generated document proposals do not have review hunks.");
      }

      const hunk = (file.hunks ?? []).find((candidate) => candidate.id === hunkId);

      if (!hunk) {
        throw new Error("Review hunk not found.");
      }

      if (
        hunk.status === "accepted" ||
        hunk.status === "rejected" ||
        (hunk.status === "stale" && decision === "accept")
      ) {
        return {
          proposal: cloneProposal(proposal),
          fileId: file.id,
          hunkId: hunk.id,
          status: hunk.status
        };
      }

      if (file.status === "rejected") {
        throw new Error("Rejected proposal files cannot be updated.");
      }

      const filePath = resolveProposalFile(workspaceRoot, file.relativePath);

      try {
        const current = await readMarkdownFile(workspaceRoot, filePath);
        const expected = reconstructContent(file.baseContent, file.hunks ?? []);

        if (current !== expected) {
          markUnresolvedHunksStale(file);
          file.error = STALE_EDIT_MESSAGE;
          file.status = deriveEditFileStatus(file);
          touchAndRecompute(proposal);
          return {
            proposal: cloneProposal(proposal),
            fileId: file.id,
            hunkId: hunk.id,
            status: hunk.status
          };
        }

        hunk.status = resolveHunkStatus(decision);
        const nextContent = reconstructContent(file.baseContent, file.hunks ?? []);

        if (nextContent !== current) {
          await writeMarkdownFile(workspaceRoot, filePath, nextContent);
        }

        if (file.status === "failed") {
          file.status = "pending";
        }
        file.status = deriveEditFileStatus(file);
        delete file.error;
        touchAndRecompute(proposal);
        return {
          proposal: cloneProposal(proposal),
          fileId: file.id,
          hunkId: hunk.id,
          status: hunk.status,
          content: nextContent
        };
      } catch (error) {
        file.status = "failed";
        file.error = errorMessage(error);
        touchAndRecompute(proposal);
        return {
          proposal: cloneProposal(proposal),
          fileId: file.id,
          hunkId: hunk.id,
          status: hunk.status
        };
      }
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async mutate<T>(operation: ProposalMutation<T>): Promise<T> {
    return this.enqueue(async () => {
      const proposals = await this.readAll();
      const result = await operation(proposals);
      await this.writeAll(pruneTerminalHistory(proposals));
      return result;
    });
  }

  private async readAll(): Promise<AgentChangeProposal[]> {
    try {
      const raw = await readFile(this.storePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? (parsed as AgentChangeProposal[]) : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) {
        return [];
      }

      throw error;
    }
  }

  private async writeAll(proposals: AgentChangeProposal[]) {
    await mkdir(path.dirname(this.storePath), { recursive: true });
    const tempPath = `${this.storePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(proposals, null, 2)}\n`, "utf8");
    await rename(tempPath, this.storePath);
  }
}

function findStoredProposal(proposals: AgentChangeProposal[], workspaceRoot: string, proposalId: string) {
  const proposal = proposals.find(
    (candidate) => candidate.id === proposalId && proposalMatchesWorkspace(candidate, workspaceRoot)
  );

  if (!proposal) {
    throw new Error("Proposal not found for this workspace.");
  }

  return proposal;
}

function findStoredFile(proposal: AgentChangeProposal, fileId: string) {
  const file = proposal.files.find((candidate) => candidate.id === fileId);

  if (!file) {
    throw new Error("Proposal file not found.");
  }

  return file;
}
