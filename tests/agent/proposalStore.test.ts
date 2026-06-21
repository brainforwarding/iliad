import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentProposalStore } from "../../electron/agent/proposalStore";
import type { AgentChangeProposal } from "../../electron/agent/types";

let root = "";
let userData = "";

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "iliad-review-workspace-"));
  userData = await mkdtemp(path.join(os.tmpdir(), "iliad-review-userdata-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(userData, { recursive: true, force: true });
});

function proposal(overrides: Partial<AgentChangeProposal>): AgentChangeProposal {
  return {
    id: "proposal-test",
    runId: "run-test",
    workspaceRoot: root,
    title: "Edit doc.md",
    summary: "Test proposal",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    model: "test",
    source: { kind: "legacy_marker_adapter" },
    status: "pending",
    files: [],
    ...overrides
  };
}

describe("AgentProposalStore", () => {
  it("accepts one edit hunk without applying stale hunks", async () => {
    const filePath = path.join(root, "doc.md");
    const base = "one\nsame\nthree\nsame\nfive\n";
    const replacement = "ONE\nsame\nthree\nsame\nFIVE\n";
    await writeFile(filePath, base, "utf8");

    const store = new AgentProposalStore(userData);
    const saved = await store.saveProposal(
      proposal({
        files: [
          {
            id: "file-test",
            kind: "edit_file",
            status: "pending",
            relativePath: "doc.md",
            baseHash: "",
            baseContent: base,
            replacement,
            unifiedDiff: ""
          }
        ]
      })
    );
    const file = saved.files[0];

    expect(file.kind).toBe("edit_file");
    expect(file.kind === "edit_file" ? file.hunks : []).toHaveLength(2);

    const first = file.kind === "edit_file" ? file.hunks?.[0] : undefined;
    expect(first).toBeDefined();
    await store.resolveProposalHunk(root, saved.id, file.id, first!.id, "accept");
    expect(await readFile(filePath, "utf8")).toMatch(/^ONE\nsame\n/);

    await writeFile(filePath, "manual\n", "utf8");
    const stale = await store.resolveProposalHunk(root, saved.id, file.id, file.kind === "edit_file" ? file.hunks![1].id : "", "accept");
    const staleFile = stale.proposal.files[0];

    expect(staleFile.kind).toBe("edit_file");
    expect(staleFile.kind === "edit_file" && staleFile.hunks?.some((hunk) => hunk.status === "stale")).toBe(true);
    expect(await readFile(filePath, "utf8")).toBe("manual\n");
  });

  it("rejects pending edit hunks without changing the file", async () => {
    const filePath = path.join(root, "doc.md");
    const base = "one\ntwo\n";
    await writeFile(filePath, base, "utf8");

    const store = new AgentProposalStore(userData);
    const saved = await store.saveProposal(
      proposal({
        files: [
          {
            id: "file-reject",
            kind: "edit_file",
            status: "pending",
            relativePath: "doc.md",
            baseHash: "",
            baseContent: base,
            replacement: "ONE\ntwo\n",
            unifiedDiff: ""
          }
        ]
      })
    );

    const rejected = await store.rejectProposalFile(root, saved.id, "file-reject");
    const rejectedFile = rejected.files[0];

    expect(rejectedFile.status).toBe("rejected");
    expect(rejectedFile.kind === "edit_file" && rejectedFile.hunks?.every((hunk) => hunk.status === "rejected")).toBe(
      true
    );
    expect(await readFile(filePath, "utf8")).toBe(base);
  });

  it("creates generated Markdown files only when applied", async () => {
    const store = new AgentProposalStore(userData);
    const saved = await store.saveProposal(
      proposal({
        id: "proposal-create",
        title: "Create new.md",
        files: [
          {
            id: "file-create",
            kind: "create_file",
            status: "pending",
            relativePath: "new.md",
            content: "new\n",
            unifiedDiff: ""
          }
        ]
      })
    );
    const newPath = path.join(root, "new.md");

    await expect(readFile(newPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    const applied = await store.applyProposalFile(root, saved.id, "file-create");

    expect(applied.status).toBe("applied");
    expect(await readFile(newPath, "utf8")).toBe("new\n");
  });

  it("deletes Markdown files only when a delete proposal is applied against unchanged base content", async () => {
    const filePath = path.join(root, "old.md");
    await writeFile(filePath, "old\n", "utf8");

    const store = new AgentProposalStore(userData);
    const saved = await store.saveProposal(
      proposal({
        id: "proposal-delete",
        title: "Delete old.md",
        files: [
          {
            id: "file-delete",
            kind: "delete_file",
            status: "pending",
            relativePath: "old.md",
            baseHash: "",
            baseContent: "old\n",
            unifiedDiff: ""
          }
        ]
      })
    );

    const applied = await store.applyProposalFile(root, saved.id, "file-delete");

    expect(applied).toMatchObject({ kind: "delete_file", status: "applied" });
    await expect(stat(filePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects delete proposals without recreating missing files", async () => {
    const store = new AgentProposalStore(userData);
    const saved = await store.saveProposal(
      proposal({
        id: "proposal-delete-reject",
        title: "Delete missing.md",
        files: [
          {
            id: "file-delete-reject",
            kind: "delete_file",
            status: "pending",
            relativePath: "missing.md",
            baseHash: "",
            baseContent: "old\n",
            unifiedDiff: ""
          }
        ]
      })
    );

    const rejected = await store.rejectProposalFile(root, saved.id, "file-delete-reject");

    expect(rejected.files[0]).toMatchObject({ kind: "delete_file", status: "rejected" });
    await expect(stat(path.join(root, "missing.md"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("marks delete proposals stale instead of deleting changed files", async () => {
    const filePath = path.join(root, "old.md");
    await writeFile(filePath, "changed\n", "utf8");

    const store = new AgentProposalStore(userData);
    const saved = await store.saveProposal(
      proposal({
        id: "proposal-delete-stale",
        files: [
          {
            id: "file-delete-stale",
            kind: "delete_file",
            status: "pending",
            relativePath: "old.md",
            baseHash: "",
            baseContent: "old\n",
            unifiedDiff: ""
          }
        ]
      })
    );

    const result = await store.applyProposalFile(root, saved.id, "file-delete-stale");

    expect(result).toMatchObject({ kind: "delete_file", status: "stale" });
    expect(await readFile(filePath, "utf8")).toBe("changed\n");
  });

  it("migrates legacy proposals to review hunks while preserving terminal status", async () => {
    const base = "base\n";
    const replacement = "changed\n";
    await writeFile(path.join(root, "doc.md"), base, "utf8");
    await mkdir(path.join(userData, "assistant"), { recursive: true });
    await writeFile(
      path.join(userData, "assistant", "proposals.json"),
      `${JSON.stringify(
        ["applied", "rejected", "stale", "failed"].map((status) =>
          proposal({
            id: `proposal-legacy-${status}`,
            runId: `run-legacy-${status}`,
            title: `Legacy ${status}`,
            summary: "Legacy proposal without hunks",
            status: status as AgentChangeProposal["status"],
            files: [
              {
                id: `file-legacy-${status}`,
                kind: "edit_file",
                status: status as AgentChangeProposal["files"][number]["status"],
                relativePath: "doc.md",
                baseHash: "",
                baseContent: base,
                replacement,
                unifiedDiff: ""
              }
            ]
          })
        ),
        null,
        2
      )}\n`,
      "utf8"
    );

    const store = new AgentProposalStore(userData);
    const proposals = await store.listProposals(root);
    const byId = new Map(proposals.map((item) => [item.id, item]));

    expect(byId.get("proposal-legacy-applied")?.files[0].status).toBe("applied");
    expect(byId.get("proposal-legacy-rejected")?.files[0].status).toBe("rejected");
    expect(byId.get("proposal-legacy-stale")?.files[0].status).toBe("stale");
    expect(byId.get("proposal-legacy-failed")?.files[0].status).toBe("failed");

    const appliedFile = byId.get("proposal-legacy-applied")?.files[0];
    const rejectedFile = byId.get("proposal-legacy-rejected")?.files[0];
    const staleFile = byId.get("proposal-legacy-stale")?.files[0];

    expect(appliedFile?.kind === "edit_file" && appliedFile.hunks?.every((hunk) => hunk.status === "accepted")).toBe(
      true
    );
    expect(rejectedFile?.kind === "edit_file" && rejectedFile.hunks?.every((hunk) => hunk.status === "rejected")).toBe(
      true
    );
    expect(staleFile?.kind === "edit_file" && staleFile.hunks?.every((hunk) => hunk.status === "stale")).toBe(true);
  });
});
