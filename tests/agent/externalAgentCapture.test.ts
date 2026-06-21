import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { AgentService } from "../../electron/agent/agentService";
import { workspaceMutationLeaseOwner } from "../../electron/agent/workspaceMutationLease";

let tempDirs: string[] = [];
let services: AgentService[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  services.forEach((service) => service.dispose());
  services = [];
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

async function tempDirectory(prefix: string) {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(directory);
  return directory;
}

async function serviceForWorkspace() {
  const workspaceRoot = await tempDirectory("iliad-external-capture-workspace-");
  const userDataPath = await tempDirectory("iliad-external-capture-userdata-");
  const service = new AgentService(userDataPath);
  services.push(service);

  return {
    workspaceRoot,
    userDataPath,
    service
  };
}

async function externalCaptureLogRecords(service: AgentService, userDataPath: string) {
  await (service as unknown as { diagnostics: { flush(): Promise<void> } }).diagnostics.flush();
  const logDir = path.join(userDataPath, "logs");
  const files = await readdir(logDir);
  const lines = (
    await Promise.all(files.map((file) => readFile(path.join(logDir, file), "utf8")))
  )
    .join("")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { event: string; details?: Record<string, unknown> });

  return lines.filter((record) => record.event.startsWith("external_capture."));
}

async function tryGit(workspaceRoot: string, args: string[]) {
  try {
    await execFileAsync("git", args, { cwd: workspaceRoot, encoding: "utf8" });
    return true;
  } catch {
    return false;
  }
}

async function proposalAfterRefresh(service: AgentService, workspaceRoot: string, captureId: string) {
  const result = await service.finishExternalCapture({ workspaceRoot, captureId });
  expect(result.status).toBe("proposal");

  if (result.status !== "proposal") {
    throw new Error("Expected proposal");
  }

  return result.proposal;
}

describe("external agent capture", () => {
  it("does not hold the workspace mutation lease while observing", async () => {
    const { service, workspaceRoot } = await serviceForWorkspace();

    await service.startExternalCapture({ workspaceRoot });

    expect(workspaceMutationLeaseOwner(workspaceRoot)).toBeNull();
  });

  it("turns an external Markdown edit into a live proposal without restoring disk", async () => {
    const { service, workspaceRoot } = await serviceForWorkspace();
    const documentPath = path.join(workspaceRoot, "lesson.md");
    await writeFile(documentPath, "Old lesson\n", "utf8");

    const capture = await service.startExternalCapture({ workspaceRoot });
    await writeFile(documentPath, "New lesson\n", "utf8");
    const proposal = await proposalAfterRefresh(service, workspaceRoot, capture.captureId);

    expect(await readFile(documentPath, "utf8")).toBe("New lesson\n");
    expect(proposal.metadata).toMatchObject({ kind: "external_filesystem", liveDisk: true, sessionScoped: true });
    expect(proposal.source).toEqual({ kind: "external_agent", agentName: undefined });
    expect(proposal.files).toMatchObject([
      {
        kind: "edit_file",
        relativePath: "lesson.md",
        baseContent: "Old lesson\n",
        replacement: "New lesson\n",
        baselineState: "present",
        reviewedState: "present"
      }
    ]);
  });

  it("writes safe diagnostics for external capture lifecycle", async () => {
    const { service, workspaceRoot, userDataPath } = await serviceForWorkspace();
    const documentPath = path.join(workspaceRoot, "lesson.md");
    await writeFile(documentPath, "Old lesson\n", "utf8");

    const capture = await service.startExternalCapture({ workspaceRoot });
    await writeFile(documentPath, "New lesson\n", "utf8");
    await service.finishExternalCapture({ workspaceRoot, captureId: capture.captureId });

    const records = await externalCaptureLogRecords(service, userDataPath);

    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "external_capture.started",
          details: expect.objectContaining({
            captureId: capture.captureId,
            markdownFileCount: 1
          })
        }),
        expect.objectContaining({
          event: "external_capture.finished",
          details: expect.objectContaining({
            captureId: capture.captureId,
            status: "proposal",
            changeFileCount: 1,
            editFileCount: 1,
            createFileCount: 0,
            deleteFileCount: 0
          })
        })
      ])
    );

    const serialized = JSON.stringify(records);
    expect(serialized).not.toContain(workspaceRoot);
    expect(serialized).not.toContain("lesson.md");
    expect(serialized).not.toContain("Old lesson");
    expect(serialized).not.toContain("New lesson");
  });

  it("updates the same pending edit cumulatively when the file changes again", async () => {
    const { service, workspaceRoot } = await serviceForWorkspace();
    const documentPath = path.join(workspaceRoot, "lesson.md");
    await writeFile(documentPath, "Old\n", "utf8");

    const capture = await service.startExternalCapture({ workspaceRoot });
    await writeFile(documentPath, "New one\n", "utf8");
    const first = await proposalAfterRefresh(service, workspaceRoot, capture.captureId);
    const firstFileId = first.files[0]?.id;

    await writeFile(documentPath, "New two\n", "utf8");
    const second = await proposalAfterRefresh(service, workspaceRoot, capture.captureId);

    expect(second.id).toBe(first.id);
    expect(second.files).toHaveLength(1);
    expect(second.files[0]?.id).toBe(firstFileId);
    expect(second.files[0]).toMatchObject({
      kind: "edit_file",
      baseContent: "Old\n",
      replacement: "New two\n"
    });
  });

  it("restores the latest external edit even when the visible proposal is stale", async () => {
    const { service, workspaceRoot } = await serviceForWorkspace();
    const documentPath = path.join(workspaceRoot, "lesson.md");
    await writeFile(documentPath, "Old\n", "utf8");

    const capture = await service.startExternalCapture({ workspaceRoot });
    await writeFile(documentPath, "New one\n", "utf8");
    const first = await proposalAfterRefresh(service, workspaceRoot, capture.captureId);

    await writeFile(documentPath, "New two\n", "utf8");
    const restored = await service.rejectProposalFile({
      workspaceRoot,
      proposalId: first.id,
      fileId: first.files[0]!.id
    });

    expect(await readFile(documentPath, "utf8")).toBe("Old\n");
    expect(restored.files[0]).toMatchObject({
      kind: "edit_file",
      status: "rejected",
      replacement: "New two\n"
    });
    expect(await service.listProposals(workspaceRoot)).toEqual([]);
  });

  it("keeps the latest external edit even when the visible proposal is stale", async () => {
    const { service, workspaceRoot } = await serviceForWorkspace();
    const documentPath = path.join(workspaceRoot, "lesson.md");
    await writeFile(documentPath, "Old\n", "utf8");

    const capture = await service.startExternalCapture({ workspaceRoot });
    await writeFile(documentPath, "New one\n", "utf8");
    const first = await proposalAfterRefresh(service, workspaceRoot, capture.captureId);

    await writeFile(documentPath, "New two\n", "utf8");
    const kept = await service.applyProposalFile({
      workspaceRoot,
      proposalId: first.id,
      fileId: first.files[0]!.id
    });

    expect(await readFile(documentPath, "utf8")).toBe("New two\n");
    expect(kept).toMatchObject({
      kind: "edit_file",
      status: "applied",
      content: "New two\n"
    });
    expect(await service.listProposals(workspaceRoot)).toEqual([]);
  });

  it("returns the active capture when the renderer has to reclaim an existing session", async () => {
    const { service, workspaceRoot } = await serviceForWorkspace();
    const documentPath = path.join(workspaceRoot, "lesson.md");
    await writeFile(documentPath, "Old\n", "utf8");

    const first = await service.startExternalCapture({ workspaceRoot });
    const resumed = await service.startExternalCapture({ workspaceRoot });

    expect(resumed).toMatchObject({
      captureId: first.captureId,
      workspaceRoot,
      startedAt: first.startedAt,
      markdownFileCount: first.markdownFileCount,
      resumed: true
    });

    await writeFile(documentPath, "New after reclaim\n", "utf8");
    const proposal = await proposalAfterRefresh(service, workspaceRoot, resumed.captureId);

    expect(proposal.files[0]).toMatchObject({
      kind: "edit_file",
      relativePath: "lesson.md",
      baseContent: "Old\n",
      replacement: "New after reclaim\n"
    });
  });

  it("clears the live proposal when a file returns to baseline", async () => {
    const { service, workspaceRoot } = await serviceForWorkspace();
    const documentPath = path.join(workspaceRoot, "lesson.md");
    await writeFile(documentPath, "Old\n", "utf8");

    const capture = await service.startExternalCapture({ workspaceRoot });
    await writeFile(documentPath, "Changed\n", "utf8");
    await proposalAfterRefresh(service, workspaceRoot, capture.captureId);

    await writeFile(documentPath, "Old\n", "utf8");
    const result = await service.finishExternalCapture({ workspaceRoot, captureId: capture.captureId });

    expect(result.status).toBe("empty");
    expect(await service.listProposals(workspaceRoot)).toEqual([]);
  });

  it("captures a new Markdown file while leaving it on disk, then keeps it as baseline", async () => {
    const { service, workspaceRoot } = await serviceForWorkspace();
    const capture = await service.startExternalCapture({ workspaceRoot });
    const documentPath = path.join(workspaceRoot, "drafts", "new-note.md");
    await mkdir(path.dirname(documentPath), { recursive: true });
    await writeFile(documentPath, "# New\n", "utf8");

    const proposal = await proposalAfterRefresh(service, workspaceRoot, capture.captureId);
    const file = proposal.files[0];

    expect(await readFile(documentPath, "utf8")).toBe("# New\n");
    expect(file).toMatchObject({
      kind: "create_file",
      relativePath: "drafts/new-note.md",
      content: "# New\n",
      baselineState: "absent",
      reviewedState: "present"
    });

    await service.applyProposalFile({ workspaceRoot, proposalId: proposal.id, fileId: file.id });
    expect(await service.listProposals(workspaceRoot)).toEqual([]);

    await rm(documentPath);
    const deleteProposal = await proposalAfterRefresh(service, workspaceRoot, capture.captureId);
    expect(deleteProposal.files[0]).toMatchObject({
      kind: "delete_file",
      relativePath: "drafts/new-note.md",
      baseContent: "# New\n"
    });
  });

  it("moves a rejected new Markdown file out of the workspace", async () => {
    const { service, workspaceRoot } = await serviceForWorkspace();
    const capture = await service.startExternalCapture({ workspaceRoot });
    const documentPath = path.join(workspaceRoot, "drafts", "new-note.md");
    await mkdir(path.dirname(documentPath), { recursive: true });
    await writeFile(documentPath, "# New\n", "utf8");

    const proposal = await proposalAfterRefresh(service, workspaceRoot, capture.captureId);
    await service.rejectProposalFile({ workspaceRoot, proposalId: proposal.id, fileId: proposal.files[0]!.id });

    await expect(stat(documentPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(path.dirname(documentPath))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await service.listProposals(workspaceRoot)).toEqual([]);
  });

  it("captures a deleted Markdown file without restoring it, then restores on reject", async () => {
    const { service, workspaceRoot } = await serviceForWorkspace();
    const documentPath = path.join(workspaceRoot, "lesson.md");
    await writeFile(documentPath, "Keep me\n", "utf8");

    const capture = await service.startExternalCapture({ workspaceRoot });
    await rm(documentPath);
    const proposal = await proposalAfterRefresh(service, workspaceRoot, capture.captureId);

    await expect(stat(documentPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(proposal.files).toMatchObject([
      {
        kind: "delete_file",
        relativePath: "lesson.md",
        baseContent: "Keep me\n",
        baselineState: "present",
        reviewedState: "absent"
      }
    ]);

    await service.rejectProposalFile({ workspaceRoot, proposalId: proposal.id, fileId: proposal.files[0]!.id });
    expect(await readFile(documentPath, "utf8")).toBe("Keep me\n");
    expect(await service.listProposals(workspaceRoot)).toEqual([]);
  });

  it("restores every file in a mixed external proposal when rejecting the proposal", async () => {
    const { service, workspaceRoot } = await serviceForWorkspace();
    const editPath = path.join(workspaceRoot, "edit.md");
    const clearPath = path.join(workspaceRoot, "clear.md");
    const deletePath = path.join(workspaceRoot, "folder", "delete.md");
    const createPath = path.join(workspaceRoot, "folder", "created.md");
    await mkdir(path.dirname(deletePath), { recursive: true });
    await writeFile(editPath, "Old edit\n", "utf8");
    await writeFile(clearPath, "Old clear\n", "utf8");
    await writeFile(deletePath, "Old delete\n", "utf8");

    const capture = await service.startExternalCapture({ workspaceRoot });
    await writeFile(editPath, "New edit\n", "utf8");
    await writeFile(clearPath, "", "utf8");
    await rm(deletePath);
    await writeFile(createPath, "# Created\n", "utf8");
    const proposal = await proposalAfterRefresh(service, workspaceRoot, capture.captureId);

    expect(proposal.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "edit_file", relativePath: "edit.md" }),
        expect.objectContaining({ kind: "edit_file", relativePath: "clear.md", replacement: "" }),
        expect.objectContaining({ kind: "delete_file", relativePath: "folder/delete.md" }),
        expect.objectContaining({ kind: "create_file", relativePath: "folder/created.md" })
      ])
    );

    await service.rejectProposal({ workspaceRoot, proposalId: proposal.id });

    expect(await readFile(editPath, "utf8")).toBe("Old edit\n");
    expect(await readFile(clearPath, "utf8")).toBe("Old clear\n");
    expect(await readFile(deletePath, "utf8")).toBe("Old delete\n");
    await expect(stat(createPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await service.listProposals(workspaceRoot)).toEqual([]);
  });

  it("treats a cleared file as an edit rather than a delete", async () => {
    const { service, workspaceRoot } = await serviceForWorkspace();
    const documentPath = path.join(workspaceRoot, "lesson.md");
    await writeFile(documentPath, "Text\n", "utf8");

    const capture = await service.startExternalCapture({ workspaceRoot });
    await writeFile(documentPath, "", "utf8");
    const proposal = await proposalAfterRefresh(service, workspaceRoot, capture.captureId);

    expect(proposal.files).toMatchObject([
      {
        kind: "edit_file",
        relativePath: "lesson.md",
        baseContent: "Text\n",
        replacement: ""
      }
    ]);
  });

  it("treats pre-existing Git dirtiness as the clean capture baseline", async () => {
    const { service, workspaceRoot } = await serviceForWorkspace();
    const documentPath = path.join(workspaceRoot, "lesson.md");
    await writeFile(documentPath, "Old\n", "utf8");

    if (!(await tryGit(workspaceRoot, ["init"]))) {
      return;
    }

    await tryGit(workspaceRoot, ["config", "user.email", "test@example.com"]);
    await tryGit(workspaceRoot, ["config", "user.name", "Test User"]);
    await tryGit(workspaceRoot, ["add", "lesson.md"]);
    if (!(await tryGit(workspaceRoot, ["commit", "-m", "initial"]))) {
      return;
    }

    await writeFile(documentPath, "Already dirty\n", "utf8");
    const capture = await service.startExternalCapture({ workspaceRoot });
    const result = await service.finishExternalCapture({ workspaceRoot, captureId: capture.captureId });

    expect(result.status).toBe("empty");
    expect(await readFile(documentPath, "utf8")).toBe("Already dirty\n");
    expect(await service.listProposals(workspaceRoot)).toEqual([]);
  });

  it("blocks destructive restore when Git HEAD changed after review refresh", async () => {
    const { service, workspaceRoot } = await serviceForWorkspace();
    const documentPath = path.join(workspaceRoot, "lesson.md");
    await writeFile(documentPath, "Old\n", "utf8");

    if (!(await tryGit(workspaceRoot, ["init"]))) {
      return;
    }

    await tryGit(workspaceRoot, ["config", "user.email", "test@example.com"]);
    await tryGit(workspaceRoot, ["config", "user.name", "Test User"]);
    await tryGit(workspaceRoot, ["add", "lesson.md"]);
    if (!(await tryGit(workspaceRoot, ["commit", "-m", "initial"]))) {
      return;
    }

    const capture = await service.startExternalCapture({ workspaceRoot });
    await writeFile(documentPath, "New\n", "utf8");
    const proposal = await proposalAfterRefresh(service, workspaceRoot, capture.captureId);

    await tryGit(workspaceRoot, ["add", "lesson.md"]);
    await tryGit(workspaceRoot, ["commit", "-m", "external"]);

    await expect(
      service.rejectProposalFile({ workspaceRoot, proposalId: proposal.id, fileId: proposal.files[0]!.id })
    ).rejects.toThrow(/Repository changed outside Iliad/);
    expect(await readFile(documentPath, "utf8")).toBe("New\n");
  });

  it("returns empty when no Markdown files changed", async () => {
    const { service, workspaceRoot } = await serviceForWorkspace();
    await mkdir(path.join(workspaceRoot, "assets"));
    await writeFile(path.join(workspaceRoot, "assets", "image.txt"), "ignored\n", "utf8");

    const capture = await service.startExternalCapture({ workspaceRoot });
    const result = await service.finishExternalCapture({ workspaceRoot, captureId: capture.captureId });

    expect(result).toMatchObject({
      status: "empty",
      captureId: capture.captureId,
      restoredRelativePaths: [],
      restoredCreateRelativePaths: [],
      unsupportedNotes: []
    });
  });

  it("cancels without restoring captured changes or keeping proposals", async () => {
    const { service, workspaceRoot } = await serviceForWorkspace();
    const documentPath = path.join(workspaceRoot, "lesson.md");
    await writeFile(documentPath, "Old\n", "utf8");

    const capture = await service.startExternalCapture({ workspaceRoot });
    await writeFile(documentPath, "Changed\n", "utf8");
    const result = await service.cancelExternalCapture({ workspaceRoot, captureId: capture.captureId });

    expect(result.status).toBe("canceled");
    expect(await readFile(documentPath, "utf8")).toBe("Changed\n");
    expect(await service.listProposals(workspaceRoot)).toEqual([]);
  });
});
