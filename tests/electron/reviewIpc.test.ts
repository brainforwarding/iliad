import { describe, expect, it, vi } from "vitest";
import {
  handleGetExternalReviewIpc,
  handleKeepChunkIpc,
  handleKeepFileIpc,
  handleRestoreAllIpc,
  handleRestoreChunkIpc,
  handleRestoreFileIpc,
  type ReviewBaselineService
} from "../../electron/ipc/review";

const trusted = vi.hoisted(() => ({ value: true }));

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { fromWebContents: () => (trusted.value ? {} : null) }
}));

const event = { sender: { id: 3 }, senderFrame: { url: "file:///app/index.html" } } as never;
const proposal = { id: "proposal-external", files: [] } as never;

function baseline(overrides: Partial<ReviewBaselineService> = {}): ReviewBaselineService {
  return {
    currentReview: vi.fn((workspaceRoot: string) => ({ workspaceRoot, revision: 2, proposal: null })),
    keep: vi.fn(async () => ({
      status: "applied" as const,
      proposal,
      relativePath: "doc.md",
      kind: "edit" as const,
      content: "kept\n",
      unrestored: [],
      snapshot: { workspaceRoot: "/ws", revision: 3, proposal: null }
    })),
    restore: vi.fn(async () => ({
      status: "rejected" as const,
      proposal,
      relativePath: "doc.md",
      kind: "edit" as const,
      unrestored: [],
      snapshot: { workspaceRoot: "/ws", revision: 3, proposal: null }
    })),
    restoreAll: vi.fn(async () => ({
      status: "rejected" as const,
      proposal,
      relativePath: null,
      kind: null,
      unrestored: [],
      snapshot: { workspaceRoot: "/ws", revision: 3, proposal: null }
    })),
    keepChunk: vi.fn(async () => ({
      status: "applied" as const,
      proposal,
      relativePath: "doc.md",
      kind: "edit" as const,
      content: "disk\n",
      unrestored: [],
      snapshot: { workspaceRoot: "/ws", revision: 4, proposal: null }
    })),
    restoreChunk: vi.fn(async () => ({
      status: "stale" as const,
      proposal,
      relativePath: null,
      kind: null,
      unrestored: [],
      snapshot: { workspaceRoot: "/ws", revision: 5, proposal: null }
    })),
    isExternalProposalId: vi.fn((_root: string, id: string) => id === "proposal-external"),
    ...overrides
  } as ReviewBaselineService;
}

function deps(service = baseline()) {
  return {
    baselineService: service,
    resolveWorkspaceRootForSession: vi.fn((_event: unknown, sessionId: string) => (sessionId === "session-1" ? "/ws" : null))
  };
}

describe("review IPC", () => {
  it("resolves the workspace from the window's session, never from a renderer-sent root", async () => {
    const d = deps();

    await expect(
      handleGetExternalReviewIpc(event, { workspaceSessionId: "session-1", workspaceRoot: "/elsewhere" }, d)
    ).resolves.toMatchObject({ workspaceRoot: "/ws" });
    expect(d.baselineService.currentReview).toHaveBeenCalledWith("/ws");
    await expect(handleGetExternalReviewIpc(event, { workspaceRoot: "/ws" }, d)).rejects.toThrow(/trusted workspace/);
    await expect(handleGetExternalReviewIpc(event, { workspaceSessionId: "other" }, d)).rejects.toThrow(/trusted workspace/);
  });

  it("keeps and restores through the baseline service", async () => {
    const d = deps();
    const request = { workspaceSessionId: "session-1", proposalId: "proposal-external", fileId: "file-1" };

    await expect(handleKeepFileIpc(event, request, d)).resolves.toMatchObject({
      kind: "edit_file",
      status: "applied",
      content: "kept\n"
    });
    expect(d.baselineService.keep).toHaveBeenCalledWith("/ws", "file-1");
    await expect(handleRestoreFileIpc(event, request, d)).resolves.toBe(proposal);
    expect(d.baselineService.restore).toHaveBeenCalledWith("/ws", "file-1");
    await expect(handleRestoreAllIpc(event, request, d)).resolves.toBe(proposal);
    expect(d.baselineService.restoreAll).toHaveBeenCalledWith("/ws");
  });

  it("routes chunk actions with the hashes the renderer saw", async () => {
    const d = deps();
    const request = {
      workspaceSessionId: "session-1",
      proposalId: "proposal-external",
      fileId: "file-1",
      chunkId: "file-1-hunk-2",
      baselineHash: "b",
      diskHash: "d"
    };

    await expect(handleKeepChunkIpc(event, request, d)).resolves.toMatchObject({
      status: "applied",
      chunkId: "file-1-hunk-2",
      content: "disk\n",
      snapshot: { revision: 4 }
    });
    expect(d.baselineService.keepChunk).toHaveBeenCalledWith("/ws", {
      proposalId: "proposal-external",
      fileId: "file-1",
      chunkId: "file-1-hunk-2",
      baselineHash: "b",
      diskHash: "d"
    });
    await expect(handleRestoreChunkIpc(event, request, d)).resolves.toMatchObject({ status: "stale" });
    await expect(handleKeepChunkIpc(event, { ...request, diskHash: "" }, d)).rejects.toThrow(/missing its target/);
    await expect(handleRestoreChunkIpc(event, { ...request, proposalId: "old" }, d)).rejects.toThrow(/no longer current/);
  });

  it("refuses review ids that are not the current outside review", async () => {
    const d = deps();

    await expect(
      handleKeepFileIpc(event, { workspaceSessionId: "session-1", proposalId: "proposal-old", fileId: "file-1" }, d)
    ).rejects.toThrow(/no longer current/);
    expect(d.baselineService.keep).not.toHaveBeenCalled();
  });

  it("reports restore-all failures", async () => {
    const d = deps(
      baseline({
        restoreAll: vi.fn(async () => ({
          status: "rejected" as const,
          proposal,
          relativePath: null,
          kind: null,
          unrestored: [{ relativePath: "a.md", reason: "changed" }],
          snapshot: { workspaceRoot: "/ws", revision: 3, proposal: null }
        }))
      })
    );

    await expect(
      handleRestoreAllIpc(event, { workspaceSessionId: "session-1", proposalId: "proposal-external" }, d)
    ).rejects.toThrow(/a\.md \(changed\)/);
  });

  it("rejects untrusted senders", async () => {
    trusted.value = false;

    try {
      await expect(handleGetExternalReviewIpc(event, { workspaceSessionId: "session-1" }, deps())).rejects.toThrow(/untrusted/);
    } finally {
      trusted.value = true;
    }
  });
});
