import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentService } from "../../electron/agent/agentService";
import { hashMarkdown } from "../../electron/agent/hash";
import { restoreSnapshotSafely } from "../../electron/agent/runtime/codexFileChangeCapture";
import { CodexRunJournalStore } from "../../electron/agent/runtime/codexRunJournal";

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

async function tempDir(prefix: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe("Codex run journal", () => {
  it("lists journals per workspace and prunes stale ones whose workspace vanished", async () => {
    const userData = await tempDir("iliad-journal-userdata-");
    const workspaceRoot = await tempDir("iliad-journal-workspace-");
    const store = new CodexRunJournalStore(userData);
    await store.write({ runId: "run-a", workspaceRoot, startedAt: new Date().toISOString(), files: [] });
    await store.write({
      runId: "run-old",
      workspaceRoot: path.join(workspaceRoot, "missing"),
      startedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      files: []
    });

    expect((await store.listForWorkspace(workspaceRoot)).map((record) => record.runId)).toEqual(["run-a"]);
    await store.pruneStale();
    expect((await store.listForWorkspace(path.join(workspaceRoot, "missing"))).length).toBe(0);
    expect((await store.listForWorkspace(workspaceRoot)).length).toBe(1);
  });

  it("restores changed files from a stale journal and persists them as a Codex proposal", async () => {
    const userData = await tempDir("iliad-journal-userdata-");
    const workspaceRoot = await tempDir("iliad-journal-workspace-");
    await writeFile(path.join(workspaceRoot, "doc.md"), "Codex changed this\n", "utf8");
    await writeFile(path.join(workspaceRoot, "new.md"), "Codex created this\n", "utf8");
    await writeFile(path.join(workspaceRoot, "same.md"), "untouched\n", "utf8");
    const journal = new CodexRunJournalStore(userData);
    await journal.write({
      runId: "run-crashed",
      workspaceRoot,
      startedAt: new Date().toISOString(),
      files: [
        { relativePath: "doc.md", hash: hashMarkdown("Original\n"), content: "Original\n" },
        { relativePath: "same.md", hash: hashMarkdown("untouched\n"), content: "untouched\n" },
        { relativePath: "removed.md", hash: hashMarkdown("bring me back\n"), content: "bring me back\n" }
      ]
    });

    const service = new AgentService(userData);
    try {
      await service.recoverCodexRunJournals(workspaceRoot);

      expect(await readFile(path.join(workspaceRoot, "doc.md"), "utf8")).toBe("Original\n");
      expect(await readFile(path.join(workspaceRoot, "removed.md"), "utf8")).toBe("bring me back\n");
      await expect(readFile(path.join(workspaceRoot, "new.md"), "utf8")).rejects.toThrow();
      expect(await journal.listForWorkspace(workspaceRoot)).toHaveLength(0);

      const proposals = await service.listProposals(workspaceRoot);
      expect(proposals).toHaveLength(1);
      expect(proposals[0].source.kind).toBe("codex_app_server");
      expect(proposals[0].runId).toBe("run-crashed");
      expect(proposals[0].files.map((file) => `${file.kind}:${file.relativePath}`).sort()).toEqual([
        "create_file:new.md",
        "delete_file:removed.md",
        "edit_file:doc.md"
      ]);
    } finally {
      service.dispose();
    }
  });

  it("restores per path and reports paths that changed again instead of stopping", async () => {
    const workspaceRoot = await tempDir("iliad-restore-workspace-");
    await writeFile(path.join(workspaceRoot, "a.md"), "A changed\n", "utf8");
    await writeFile(path.join(workspaceRoot, "b.md"), "B changed\n", "utf8");
    const snapshot = {
      workspaceRoot,
      files: new Map([
        ["a.md", { absolutePath: path.join(workspaceRoot, "a.md"), relativePath: "a.md", content: "A\n", baseHash: hashMarkdown("A\n"), existed: true }],
        ["b.md", { absolutePath: path.join(workspaceRoot, "b.md"), relativePath: "b.md", content: "B\n", baseHash: hashMarkdown("B\n"), existed: true }]
      ])
    };

    // Simulate a path that keeps changing between reconcile and restore by
    // making it a directory, which the restore must refuse without aborting.
    await rm(path.join(workspaceRoot, "b.md"));
    const { mkdir } = await import("node:fs/promises");
    await mkdir(path.join(workspaceRoot, "b.md"));

    const outcome = await restoreSnapshotSafely(snapshot);
    expect(outcome.restored).toEqual(["a.md"]);
    expect(outcome.unrestored.map((entry) => entry.relativePath)).toEqual(["b.md"]);
    expect(await readFile(path.join(workspaceRoot, "a.md"), "utf8")).toBe("A\n");
  });
});
