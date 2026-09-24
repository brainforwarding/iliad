import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { externalReviewFileId } from "../../electron/review/externalReviewProjection";
import { WorkspaceBaselineService, type ExternalReviewSnapshot } from "../../electron/review/workspaceBaseline";

const execFileAsync = promisify(execFile);
let tempDirs: string[] = [];
let services: WorkspaceBaselineService[] = [];

afterEach(async () => {
  services.forEach((service) => service.dispose());
  services = [];
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

async function workspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), "iliad-baseline-"));
  tempDirs.push(root);
  return root;
}

function service(options: ConstructorParameters<typeof WorkspaceBaselineService>[0] = {}) {
  const instance = new WorkspaceBaselineService({
    settleMs: 15,
    deferMs: 15,
    confirmMs: 10,
    releaseGraceMs: 40,
    ...options
  });
  services.push(instance);
  return instance;
}

function subscriber(id = 1) {
  const snapshots: ExternalReviewSnapshot[] = [];
  return {
    id,
    snapshots,
    send: vi.fn((_channel: string, payload: unknown) => {
      snapshots.push(payload as ExternalReviewSnapshot);
    })
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 1500) {
  const startedAt = Date.now();

  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for condition.");
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function itemPaths(snapshot: ExternalReviewSnapshot) {
  return (snapshot.proposal?.files ?? []).map((file) => `${file.kind}:${file.relativePath}`).sort();
}

async function tryGit(root: string, args: string[]) {
  try {
    await execFileAsync("git", args, { cwd: root, encoding: "utf8" });
    return true;
  } catch {
    return false;
  }
}

describe("WorkspaceBaselineService", () => {
  it("captures the baseline on attach and classifies outside edits, creates, deletes, and clears", async () => {
    const root = await workspace();
    await writeFile(path.join(root, "edit.md"), "one\n", "utf8");
    await writeFile(path.join(root, "delete.md"), "gone\n", "utf8");
    await writeFile(path.join(root, "clear.md"), "text\n", "utf8");
    const baseline = service();
    const sub = subscriber();

    const initial = await baseline.attach(root, sub);
    expect(initial.proposal).toBeNull();
    expect(initial.revision).toBe(0);

    await writeFile(path.join(root, "edit.md"), "two\n", "utf8");
    await rm(path.join(root, "delete.md"));
    await writeFile(path.join(root, "clear.md"), "", "utf8");
    await writeFile(path.join(root, "new.md"), "fresh\n", "utf8");
    baseline.noteDiskChange(root, { relativePath: null, eventType: "unknown" });

    await waitFor(() => (baseline.currentReview(root).proposal?.files.length ?? 0) === 4);
    const snapshot = baseline.currentReview(root);
    expect(itemPaths(snapshot)).toEqual([
      "create_file:new.md",
      "delete_file:delete.md",
      "edit_file:clear.md",
      "edit_file:edit.md"
    ]);
    expect(snapshot.proposal?.metadata?.kind).toBe("external_filesystem");
    expect(snapshot.proposal?.metadata?.revision).toBe(snapshot.revision);
    // Outside content stays on disk; nothing is restored to make review possible.
    expect(await readFile(path.join(root, "edit.md"), "utf8")).toBe("two\n");
    expect(sub.snapshots.at(-1)?.revision).toBe(snapshot.revision);
  });

  it("removes an item when the path returns to the baseline and publishes null when nothing is left", async () => {
    const root = await workspace();
    await writeFile(path.join(root, "doc.md"), "one\n", "utf8");
    const baseline = service();
    const sub = subscriber();
    await baseline.attach(root, sub);

    await writeFile(path.join(root, "doc.md"), "two\n", "utf8");
    baseline.noteDiskChange(root, { relativePath: "doc.md", eventType: "change" });
    await waitFor(() => baseline.currentReview(root).proposal !== null);

    await writeFile(path.join(root, "doc.md"), "one\n", "utf8");
    baseline.noteDiskChange(root, { relativePath: "doc.md", eventType: "change" });
    await waitFor(() => baseline.currentReview(root).proposal === null && baseline.currentReview(root).revision >= 2);
    expect(sub.snapshots.at(-1)?.proposal).toBeNull();
  });

  it("does not publish a delete for a transient atomic-save shaped delete", async () => {
    const root = await workspace();
    await writeFile(path.join(root, "doc.md"), "one\n", "utf8");
    const baseline = service({ confirmMs: 60 });
    const sub = subscriber();
    await baseline.attach(root, sub);

    await rm(path.join(root, "doc.md"));
    baseline.noteDiskChange(root, { relativePath: "doc.md", eventType: "rename" });
    // Recreate with the same content before the confirmation observation.
    await new Promise((resolve) => setTimeout(resolve, 25));
    await writeFile(path.join(root, "doc.md"), "one\n", "utf8");

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(baseline.currentReview(root).proposal).toBeNull();
    expect(sub.snapshots.filter((snapshot) => snapshot.proposal !== null)).toHaveLength(0);
  });

  it("scopes refreshes to change hints and falls back to a full scan for rename or unknown hints", async () => {
    const root = await workspace();
    await writeFile(path.join(root, "a.md"), "a\n", "utf8");
    await writeFile(path.join(root, "b.md"), "b\n", "utf8");
    const baseline = service();
    await baseline.attach(root, subscriber());

    await writeFile(path.join(root, "a.md"), "A\n", "utf8");
    await writeFile(path.join(root, "b.md"), "B\n", "utf8");
    baseline.noteDiskChange(root, { relativePath: "a.md", eventType: "change" });
    await waitFor(() => baseline.currentReview(root).proposal !== null);
    expect(itemPaths(baseline.currentReview(root))).toEqual(["edit_file:a.md"]);

    baseline.noteDiskChange(root, { relativePath: "b.md", eventType: "rename" });
    await waitFor(() => (baseline.currentReview(root).proposal?.files.length ?? 0) === 2);
    expect(itemPaths(baseline.currentReview(root))).toEqual(["edit_file:a.md", "edit_file:b.md"]);
  });

  it("defers refreshes while an Iliad mutation is in flight and reconciles after it", async () => {
    const root = await workspace();
    await writeFile(path.join(root, "doc.md"), "one\n", "utf8");
    const baseline = service();
    await baseline.attach(root, subscriber());
    let finish: () => void = () => undefined;
    const mutation = baseline.runIliadMutation(root, {
      paths: [],
      operation: () => new Promise<void>((resolve) => {
        finish = resolve;
      })
    });

    try {
      await writeFile(path.join(root, "doc.md"), "two\n", "utf8");
      baseline.noteDiskChange(root, { relativePath: "doc.md", eventType: "change" });
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(baseline.currentReview(root).proposal).toBeNull();
    } finally {
      finish();
      await mutation;
    }

    await waitFor(() => baseline.currentReview(root).proposal !== null);
  });

  it("reconciles once more when a refresh is requested during an in-flight refresh", async () => {
    const root = await workspace();
    await writeFile(path.join(root, "doc.md"), "one\n", "utf8");
    const baseline = service({ confirmMs: 80 });
    await baseline.attach(root, subscriber());

    // A create triggers the confirmation wait, keeping the refresh in flight.
    await writeFile(path.join(root, "new.md"), "fresh\n", "utf8");
    const first = baseline.refreshNow(root);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await writeFile(path.join(root, "doc.md"), "two\n", "utf8");
    const second = baseline.refreshNow(root);
    await Promise.all([first, second]);

    await waitFor(() => (baseline.currentReview(root).proposal?.files.length ?? 0) === 2);
    expect(itemPaths(baseline.currentReview(root))).toEqual(["create_file:new.md", "edit_file:doc.md"]);
  });

  it("records Iliad-owned writes so they never become outside changes", async () => {
    const root = await workspace();
    await writeFile(path.join(root, "doc.md"), "one\n", "utf8");
    const baseline = service();
    const sub = subscriber();
    await baseline.attach(root, sub);

    const result = await baseline.writeMarkdownIfUnchanged(root, {
      relativePath: "doc.md",
      content: "two\n",
      expected: { kind: "hash", hash: hashOf("one\n") }
    });
    expect(result.status).toBe("written");
    baseline.noteDiskChange(root, { relativePath: "doc.md", eventType: "change" });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(baseline.currentReview(root).proposal).toBeNull();

    await baseline.runIliadMutation(root, {
      paths: [],
      operation: () => writeFile(path.join(root, "made.md"), "# made\n", "utf8"),
      record: () => [{ op: "set", relativePath: "made.md", content: "# made\n" }]
    });
    baseline.noteDiskChange(root, { relativePath: "made.md", eventType: "rename" });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(baseline.currentReview(root).proposal).toBeNull();
    expect(sub.snapshots.filter((snapshot) => snapshot.proposal !== null)).toHaveLength(0);
  });

  it("moves baseline entries and pending items on folder rename and removes them on trash", async () => {
    const root = await workspace();
    await mkdir(path.join(root, "docs"));
    await writeFile(path.join(root, "docs", "a.md"), "a\n", "utf8");
    await writeFile(path.join(root, "docs", "b.md"), "b\n", "utf8");
    const baseline = service();
    await baseline.attach(root, subscriber());

    await writeFile(path.join(root, "docs", "b.md"), "B\n", "utf8");
    baseline.noteDiskChange(root, { relativePath: "docs/b.md", eventType: "change" });
    await waitFor(() => baseline.currentReview(root).proposal !== null);

    await baseline.runIliadMutation(root, {
      paths: ["docs"],
      operation: () => rename(path.join(root, "docs"), path.join(root, "notes")),
      record: () => [{ op: "move", fromRelativePath: "docs", toRelativePath: "notes", directory: true }]
    });

    await waitFor(() => itemPaths(baseline.currentReview(root)).join() === "edit_file:notes/b.md");

    await writeFile(path.join(root, "notes", "a.md"), "A\n", "utf8");
    baseline.noteDiskChange(root, { relativePath: "notes/a.md", eventType: "change" });
    await waitFor(() => (baseline.currentReview(root).proposal?.files.length ?? 0) === 2);
    expect(itemPaths(baseline.currentReview(root))).toEqual(["edit_file:notes/a.md", "edit_file:notes/b.md"]);

    await baseline.runIliadMutation(root, {
      paths: ["notes/a.md"],
      operation: () => rm(path.join(root, "notes", "a.md")),
      record: () => [{ op: "remove", relativePath: "notes/a.md" }]
    });
    await waitFor(() => itemPaths(baseline.currentReview(root)).join() === "edit_file:notes/b.md");
  });

  it("refuses guarded writes on pending review, disk drift, and unsafe paths", async () => {
    const root = await workspace();
    await writeFile(path.join(root, "doc.md"), "one\n", "utf8");
    await writeFile(path.join(root, "other.md"), "x\n", "utf8");
    const baseline = service();
    await baseline.attach(root, subscriber());

    await writeFile(path.join(root, "doc.md"), "outside\n", "utf8");
    baseline.noteDiskChange(root, { relativePath: "doc.md", eventType: "change" });
    await waitFor(() => baseline.currentReview(root).proposal !== null);

    expect(
      await baseline.writeMarkdownIfUnchanged(root, {
        relativePath: "doc.md",
        content: "mine\n",
        expected: { kind: "hash", hash: hashOf("one\n") }
      })
    ).toEqual({ status: "conflict", reason: "pending_review" });
    expect(await readFile(path.join(root, "doc.md"), "utf8")).toBe("outside\n");
    expect(baseline.hasPendingReview(root, "doc.md")).toBe(true);
    expect(baseline.hasPendingReview(root, "./doc.md")).toBe(true);
    expect(baseline.hasPendingReview(root, "other.md")).toBe(false);
    expect(baseline.hasPendingReview(path.join(root, "elsewhere"), "doc.md")).toBe(false);

    expect(
      await baseline.writeMarkdownIfUnchanged(root, {
        relativePath: "other.md",
        content: "y\n",
        expected: { kind: "hash", hash: hashOf("stale\n") }
      })
    ).toEqual({ status: "conflict", reason: "disk_changed" });
    expect(
      await baseline.writeMarkdownIfUnchanged(root, {
        relativePath: "other.md",
        content: "y\n",
        expected: { kind: "absent" }
      })
    ).toEqual({ status: "conflict", reason: "disk_changed" });
    expect(
      await baseline.writeMarkdownIfUnchanged(root, {
        relativePath: "missing.md",
        content: "y\n",
        expected: { kind: "hash", hash: hashOf("") }
      })
    ).toEqual({ status: "conflict", reason: "disk_changed" });

    await symlink(path.join(root, "other.md"), path.join(root, "link.md"));
    expect(
      await baseline.writeMarkdownIfUnchanged(root, {
        relativePath: "link.md",
        content: "y\n",
        expected: { kind: "hash", hash: hashOf("x\n") }
      })
    ).toEqual({ status: "conflict", reason: "unsafe_path" });
    expect(await readFile(path.join(root, "other.md"), "utf8")).toBe("x\n");

    expect(
      await baseline.writeMarkdownIfUnchanged(root, {
        relativePath: "other.md",
        content: "y\n",
        expected: { kind: "hash", hash: hashOf("x\n") }
      })
    ).toMatchObject({ status: "written" });
    expect(await readFile(path.join(root, "other.md"), "utf8")).toBe("y\n");
  });

  it("keeps an outside edit by advancing the baseline without writing", async () => {
    const root = await workspace();
    await writeFile(path.join(root, "doc.md"), "one\n", "utf8");
    const baseline = service();
    const sub = subscriber();
    await baseline.attach(root, sub);

    await writeFile(path.join(root, "doc.md"), "two\n", "utf8");
    baseline.noteDiskChange(root, { relativePath: "doc.md", eventType: "change" });
    await waitFor(() => baseline.currentReview(root).proposal !== null);
    const before = await stat(path.join(root, "doc.md"));

    const result = await baseline.keep(root, externalReviewFileId("doc.md"));
    expect(result.status).toBe("applied");
    expect(result.content).toBe("two\n");
    expect(result.proposal.files[0]?.status).toBe("applied");
    expect(result.snapshot.proposal).toBeNull();
    expect((await stat(path.join(root, "doc.md"))).mtimeMs).toBe(before.mtimeMs);
    expect(baseline.currentReview(root).proposal).toBeNull();

    // The kept content is now the accepted state: a later edit diffs against it.
    await writeFile(path.join(root, "doc.md"), "three\n", "utf8");
    baseline.noteDiskChange(root, { relativePath: "doc.md", eventType: "change" });
    await waitFor(() => baseline.currentReview(root).proposal !== null);
    const file = baseline.currentReview(root).proposal?.files[0];
    expect(file?.kind === "edit_file" && file.baseContent).toBe("two\n");
  });

  it("restores an outside edit and a deleted file, and moves an outside-created file to the Trash", async () => {
    const root = await workspace();
    await writeFile(path.join(root, "edit.md"), "one\n", "utf8");
    await writeFile(path.join(root, "gone.md"), "keep me\n", "utf8");
    const trashed: string[] = [];
    const baseline = service({
      trashItem: async (absolutePath) => {
        trashed.push(absolutePath);
        await rm(absolutePath);
      }
    });
    await baseline.attach(root, subscriber());

    await writeFile(path.join(root, "edit.md"), "two\n", "utf8");
    await rm(path.join(root, "gone.md"));
    await mkdir(path.join(root, "drafts"));
    await writeFile(path.join(root, "drafts", "new.md"), "fresh\n", "utf8");
    baseline.noteDiskChange(root, { relativePath: null, eventType: "unknown" });
    await waitFor(() => (baseline.currentReview(root).proposal?.files.length ?? 0) === 3);

    const restored = await baseline.restore(root, externalReviewFileId("edit.md"));
    expect(restored.status).toBe("rejected");
    expect(await readFile(path.join(root, "edit.md"), "utf8")).toBe("one\n");

    await baseline.restore(root, externalReviewFileId("gone.md"));
    expect(await readFile(path.join(root, "gone.md"), "utf8")).toBe("keep me\n");

    await baseline.restore(root, externalReviewFileId("drafts/new.md"));
    // The file is held in a hidden sibling folder before it goes to the
    // Trash, under its own basename.
    expect(trashed).toHaveLength(1);
    expect(path.basename(trashed[0])).toBe("new.md");
    expect(path.basename(path.dirname(trashed[0]))).toMatch(/^\.iliad-restore-/);
    await expect(stat(path.join(root, "drafts"))).rejects.toThrow();
    expect(baseline.currentReview(root).proposal).toBeNull();
  });

  it("never trashes content written after the review's last look", async () => {
    const root = await workspace();
    const trashed: string[] = [];
    const baseline = service({
      trashItem: async (absolutePath) => {
        // A writer that opens the original path now creates a new file there
        // and never touches the held one.
        await writeFile(path.join(root, "made.md"), "C2 written after the click\n", "utf8");
        trashed.push(absolutePath);
        await rm(absolutePath);
      }
    });
    await baseline.attach(root, subscriber());
    await writeFile(path.join(root, "made.md"), "C1\n", "utf8");
    baseline.noteDiskChange(root, { relativePath: "made.md", eventType: "rename" });
    await waitFor(() => baseline.currentReview(root).proposal !== null);

    const result = await baseline.restore(root, externalReviewFileId("made.md"));
    expect(result.status).toBe("rejected");
    expect(path.basename(trashed[0])).toBe("made.md");
    expect(await readFile(path.join(root, "made.md"), "utf8")).toBe("C2 written after the click\n");
    await waitFor(() => baseline.currentReview(root).proposal?.files[0]?.kind === "create_file");
    const entries = (await readdir(root)).filter((name) => name.startsWith(".iliad-restore-"));
    expect(entries).toEqual([]);
  });

  it("puts a file back when it changed between the last look and the move", async () => {
    const root = await workspace();
    const trashed: string[] = [];
    const baseline = service({
      trashItem: async (absolutePath) => {
        trashed.push(absolutePath);
        await rm(absolutePath);
      }
    });
    await baseline.attach(root, subscriber());
    await writeFile(path.join(root, "made.md"), "C1\n", "utf8");
    baseline.noteDiskChange(root, { relativePath: "made.md", eventType: "rename" });
    await waitFor(() => baseline.currentReview(root).proposal !== null);

    // Simulate the write landing after the reviewed hash was validated but
    // before the move: the held content no longer matches the item.
    const original = baseline.restore.bind(baseline);
    const before = baseline.currentReview(root);
    const item = { relativePath: "made.md", diskHash: "not-the-reviewed-hash" };
    const outcome = await (baseline as unknown as {
      trashReviewedFile: (s: unknown, i: unknown, p: string) => Promise<string | null>;
    }).trashReviewedFile(
      (baseline as unknown as { states: Map<string, unknown> }).states.get(path.resolve(root)),
      item,
      path.join(root, "made.md")
    );
    expect(outcome).toMatch(/changed again/);
    expect(trashed).toEqual([]);
    expect(await readFile(path.join(root, "made.md"), "utf8")).toBe("C1\n");
    expect((await readdir(root)).filter((name) => name.startsWith("."))).toEqual([]);
    expect(before.proposal).not.toBeNull();
    expect(typeof original).toBe("function");
  });

  it("shows a file replaced by a folder as a delete whose restore fails visibly", async () => {
    const root = await workspace();
    await writeFile(path.join(root, "doc.md"), "one\n", "utf8");
    const baseline = service();
    await baseline.attach(root, subscriber());

    await rm(path.join(root, "doc.md"));
    await mkdir(path.join(root, "doc.md"));
    await writeFile(path.join(root, "doc.md", "inner.md"), "inside\n", "utf8");
    baseline.noteDiskChange(root, { relativePath: "doc.md", eventType: "rename" });
    await waitFor(() => (baseline.currentReview(root).proposal?.files.length ?? 0) === 2);

    const files = baseline.currentReview(root).proposal?.files ?? [];
    expect(files.map((file) => [file.kind, file.relativePath]).sort()).toEqual([
      ["create_file", "doc.md/inner.md"],
      ["delete_file", "doc.md"]
    ]);

    await expect(baseline.restore(root, externalReviewFileId("doc.md"))).rejects.toThrow(/folder has taken/);
    expect((await stat(path.join(root, "doc.md"))).isDirectory()).toBe(true);
    expect(await readFile(path.join(root, "doc.md", "inner.md"), "utf8")).toBe("inside\n");
  });

  it("fails cleanly when the Trash is unavailable and keeps the file", async () => {
    const root = await workspace();
    const baseline = service({
      trashItem: async () => {
        throw new Error("Trash unavailable");
      }
    });
    await baseline.attach(root, subscriber());
    await writeFile(path.join(root, "new.md"), "fresh\n", "utf8");
    baseline.noteDiskChange(root, { relativePath: "new.md", eventType: "rename" });
    await waitFor(() => baseline.currentReview(root).proposal !== null);

    await expect(baseline.restore(root, externalReviewFileId("new.md"))).rejects.toThrow("Trash unavailable");
    expect(await readFile(path.join(root, "new.md"), "utf8")).toBe("fresh\n");
    expect(baseline.currentReview(root).proposal?.files).toHaveLength(1);
  });

  it("restores every validated item in restoreAll and reports the ones that failed", async () => {
    const root = await workspace();
    await writeFile(path.join(root, "a.md"), "a\n", "utf8");
    await writeFile(path.join(root, "b.md"), "b\n", "utf8");
    const baseline = service({
      trashItem: async () => {
        throw new Error("Trash unavailable");
      }
    });
    await baseline.attach(root, subscriber());

    await writeFile(path.join(root, "a.md"), "A\n", "utf8");
    await writeFile(path.join(root, "b.md"), "B\n", "utf8");
    await writeFile(path.join(root, "new.md"), "fresh\n", "utf8");
    baseline.noteDiskChange(root, { relativePath: null, eventType: "unknown" });
    await waitFor(() => (baseline.currentReview(root).proposal?.files.length ?? 0) === 3);

    const result = await baseline.restoreAll(root);
    expect(result.unrestored).toEqual([{ relativePath: "new.md", reason: "Trash unavailable" }]);
    expect(await readFile(path.join(root, "a.md"), "utf8")).toBe("a\n");
    expect(await readFile(path.join(root, "b.md"), "utf8")).toBe("b\n");
    expect(itemPaths(baseline.currentReview(root))).toEqual(["create_file:new.md"]);
  });

  it("reports stale from restoreAll when the items were already resolved elsewhere", async () => {
    const root = await workspace();
    await writeFile(path.join(root, "doc.md"), "one\n", "utf8");
    const baseline = service();
    await baseline.attach(root, subscriber());

    await writeFile(path.join(root, "doc.md"), "two\n", "utf8");
    baseline.noteDiskChange(root, { relativePath: "doc.md", eventType: "change" });
    await waitFor(() => baseline.currentReview(root).proposal !== null);

    // The other window wins the race.
    expect((await baseline.restoreAll(root)).status).toBe("rejected");
    expect(await readFile(path.join(root, "doc.md"), "utf8")).toBe("one\n");

    const loser = await baseline.restoreAll(root);
    expect(loser.status).toBe("stale");
    expect(loser.proposal.status).toBe("stale");
    expect(loser.unrestored).toEqual([]);
  });

  it("returns stale instead of acting when the reviewed file changed again", async () => {
    const root = await workspace();
    await writeFile(path.join(root, "doc.md"), "one\n", "utf8");
    const baseline = service();
    await baseline.attach(root, subscriber());

    await writeFile(path.join(root, "doc.md"), "two\n", "utf8");
    baseline.noteDiskChange(root, { relativePath: "doc.md", eventType: "change" });
    await waitFor(() => baseline.currentReview(root).proposal !== null);
    const fileId = externalReviewFileId("doc.md");

    await writeFile(path.join(root, "doc.md"), "one\n", "utf8");
    const result = await baseline.restore(root, fileId);
    expect(result.status).toBe("stale");
    expect(result.snapshot.proposal).toBeNull();
    expect(await readFile(path.join(root, "doc.md"), "utf8")).toBe("one\n");
  });

  it("never restores over content that changed again after the reviewed version", async () => {
    const root = await workspace();
    await writeFile(path.join(root, "doc.md"), "one\n", "utf8");
    const baseline = service();
    await baseline.attach(root, subscriber());

    await writeFile(path.join(root, "doc.md"), "two\n", "utf8");
    baseline.noteDiskChange(root, { relativePath: "doc.md", eventType: "change" });
    await waitFor(() => baseline.currentReview(root).proposal !== null);
    const reviewedRevision = baseline.currentReview(root).revision;

    // A newer, never-shown version lands right before the writer clicks Restore.
    await writeFile(path.join(root, "doc.md"), "three\n", "utf8");
    const result = await baseline.restore(root, externalReviewFileId("doc.md"));

    expect(result.status).toBe("stale");
    expect(await readFile(path.join(root, "doc.md"), "utf8")).toBe("three\n");
    const refreshed = baseline.currentReview(root);
    expect(refreshed.revision).toBeGreaterThan(reviewedRevision);
    const file = refreshed.proposal?.files[0];
    expect(file?.kind === "edit_file" && file.replacement).toBe("three\n");
  });

  it("blocks a destructive restore once when Git HEAD changed and refreshes the review", async () => {
    const root = await workspace();

    if (
      !(await tryGit(root, ["init", "-q"])) ||
      !(await tryGit(root, ["config", "user.email", "test@example.com"])) ||
      !(await tryGit(root, ["config", "user.name", "Test"]))
    ) {
      return;
    }

    await writeFile(path.join(root, "doc.md"), "one\n", "utf8");
    await tryGit(root, ["add", "."]);
    await tryGit(root, ["commit", "-q", "-m", "init"]);
    const baseline = service();
    await baseline.attach(root, subscriber());

    await writeFile(path.join(root, "doc.md"), "two\n", "utf8");
    baseline.noteDiskChange(root, { relativePath: "doc.md", eventType: "change" });
    await waitFor(() => baseline.currentReview(root).proposal !== null);
    // Give the git snapshot recapture a moment to settle after the review change.
    await new Promise((resolve) => setTimeout(resolve, 100));

    await tryGit(root, ["commit", "-q", "-am", "outside commit"]);
    await expect(baseline.restore(root, externalReviewFileId("doc.md"))).rejects.toThrow("Repository changed outside Iliad");
    expect(await readFile(path.join(root, "doc.md"), "utf8")).toBe("two\n");

    await baseline.restore(root, externalReviewFileId("doc.md"));
    expect(await readFile(path.join(root, "doc.md"), "utf8")).toBe("one\n");
  });

  it("publishes only when the projected review changed and reconciles on re-attach after a write", async () => {
    const root = await workspace();
    await writeFile(path.join(root, "doc.md"), "one\n", "utf8");
    const baseline = service();
    const sub = subscriber(7);
    await baseline.attach(root, sub);
    const initialCount = sub.snapshots.length;

    baseline.noteDiskChange(root, { relativePath: "doc.md", eventType: "change" });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(sub.snapshots.length).toBe(initialCount);

    baseline.detach(root, sub.id);
    await writeFile(path.join(root, "doc.md"), "two\n", "utf8");
    const again = subscriber(8);
    const snapshot = await baseline.attach(root, again);
    expect(itemPaths(snapshot)).toEqual(["edit_file:doc.md"]);
    expect(again.snapshots.at(-1)?.revision).toBe(snapshot.revision);
  });

  it("drops the baseline after the grace period once the last subscriber leaves", async () => {
    const root = await workspace();
    await writeFile(path.join(root, "doc.md"), "one\n", "utf8");
    const baseline = service({ releaseGraceMs: 20 });
    const sub = subscriber();
    await baseline.attach(root, sub);
    baseline.detach(root, sub.id);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(baseline.hasWorkspace(root)).toBe(false);

    // A fresh attach starts from disk as the accepted state again.
    await writeFile(path.join(root, "doc.md"), "two\n", "utf8");
    const snapshot = await baseline.attach(root, subscriber(2));
    expect(snapshot.proposal).toBeNull();
  });

  it("runs a full scan when the watcher restarts", async () => {
    const root = await workspace();
    await writeFile(path.join(root, "doc.md"), "one\n", "utf8");
    const baseline = service();
    await baseline.attach(root, subscriber());

    await writeFile(path.join(root, "doc.md"), "two\n", "utf8");
    baseline.noteWatcherRestarted(root);
    await waitFor(() => baseline.currentReview(root).proposal !== null);
  });
});

function hashOf(content: string) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

describe("WorkspaceBaselineService per-chunk review", () => {
  const BASE = "alpha\nbeta\ngamma\ndelta\nepsilon\n";
  const DISK = "ALPHA\nbeta\ngamma\nDELTA\nepsilon\n";

  async function reviewedEdit(base = BASE, disk = DISK, options: ConstructorParameters<typeof WorkspaceBaselineService>[0] = {}) {
    const root = await workspace();
    await writeFile(path.join(root, "doc.md"), base, "utf8");
    const baseline = service(options);
    await baseline.attach(root, subscriber());
    await writeFile(path.join(root, "doc.md"), disk, "utf8");
    baseline.noteDiskChange(root, { relativePath: "doc.md", eventType: "change" });
    await waitFor(() => baseline.currentReview(root).proposal !== null);
    return { root, baseline };
  }

  function editFile(baseline: WorkspaceBaselineService, root: string) {
    const file = baseline.currentReview(root).proposal?.files[0];

    if (!file || file.kind !== "edit_file") {
      throw new Error("expected an edit item");
    }

    return file;
  }

  function chunkRequest(baseline: WorkspaceBaselineService, root: string, index: number) {
    const file = editFile(baseline, root);
    return {
      fileId: file.id,
      chunkId: file.hunks![index].id,
      baselineHash: file.baseHash,
      diskHash: file.reviewedContentHash!
    };
  }

  it("keeps one chunk into a partial baseline and leaves the rest pending", async () => {
    const { root, baseline } = await reviewedEdit();
    expect(editFile(baseline, root).hunks).toHaveLength(2);
    const before = await stat(path.join(root, "doc.md"));

    const result = await baseline.keepChunk(root, chunkRequest(baseline, root, 0));

    expect(result.status).toBe("applied");
    expect(await readFile(path.join(root, "doc.md"), "utf8")).toBe(DISK);
    expect((await stat(path.join(root, "doc.md"))).mtimeMs).toBe(before.mtimeMs);
    const file = editFile(baseline, root);
    expect(file.baseContent).toBe("ALPHA\nbeta\ngamma\ndelta\nepsilon\n");
    expect(file.hunks).toHaveLength(1);
    expect(file.hunks![0].newLines).toEqual(["DELTA"]);
  });

  it("clears the item when the last chunk is kept", async () => {
    const { root, baseline } = await reviewedEdit();
    await baseline.keepChunk(root, chunkRequest(baseline, root, 0));
    const result = await baseline.keepChunk(root, chunkRequest(baseline, root, 0));

    expect(result.status).toBe("applied");
    expect(baseline.currentReview(root).proposal).toBeNull();
    // The kept text is now accepted: Iliad can write over it.
    expect(
      await baseline.writeMarkdownIfUnchanged(root, {
        relativePath: "doc.md",
        content: "mine\n",
        expected: { kind: "hash", hash: hashOf(DISK) }
      })
    ).toMatchObject({ status: "written" });
  });

  it("restores one chunk by writing disk minus that chunk and leaves the baseline", async () => {
    const { root, baseline } = await reviewedEdit();

    const result = await baseline.restoreChunk(root, chunkRequest(baseline, root, 1));

    expect(result.status).toBe("rejected");
    expect(result.content).toBe("ALPHA\nbeta\ngamma\ndelta\nepsilon\n");
    expect(await readFile(path.join(root, "doc.md"), "utf8")).toBe("ALPHA\nbeta\ngamma\ndelta\nepsilon\n");
    const file = editFile(baseline, root);
    expect(file.baseContent).toBe(BASE);
    expect(file.hunks).toHaveLength(1);
    expect(file.hunks![0].newLines).toEqual(["ALPHA"]);
    expect((await readdir(root)).filter((name) => name.startsWith("."))).toEqual([]);

    await baseline.restoreChunk(root, chunkRequest(baseline, root, 0));
    expect(await readFile(path.join(root, "doc.md"), "utf8")).toBe(BASE);
    expect(baseline.currentReview(root).proposal).toBeNull();
  });

  it("returns stale and writes nothing when the hashes do not match the current item", async () => {
    const { root, baseline } = await reviewedEdit();
    const request = chunkRequest(baseline, root, 0);

    for (const bad of [
      { ...request, baselineHash: hashOf("something else") },
      { ...request, diskHash: hashOf("something else") },
      { ...request, chunkId: `${request.fileId}-hunk-9` }
    ]) {
      expect((await baseline.keepChunk(root, bad)).status).toBe("stale");
      expect((await baseline.restoreChunk(root, bad)).status).toBe("stale");
    }

    expect(await readFile(path.join(root, "doc.md"), "utf8")).toBe(DISK);
    expect(editFile(baseline, root).baseContent).toBe(BASE);
    expect(editFile(baseline, root).hunks).toHaveLength(2);
  });

  it("returns stale when the file changed on disk after the review", async () => {
    const { root, baseline } = await reviewedEdit();
    const request = chunkRequest(baseline, root, 0);
    await writeFile(path.join(root, "doc.md"), "newer\n", "utf8");

    expect((await baseline.restoreChunk(root, request)).status).toBe("stale");
    expect(await readFile(path.join(root, "doc.md"), "utf8")).toBe("newer\n");
    expect((await baseline.keepChunk(root, request)).status).toBe("stale");
    expect(editFile(baseline, root).baseContent).toBe(BASE);
    expect(editFile(baseline, root).replacement).toBe("newer\n");
  });

  it("never clobbers a file that appears at the path during a chunk restore and keeps the held bytes", async () => {
    let raced = false;
    const { root, baseline } = await reviewedEdit(BASE, DISK, {
      beforeRestorePublish: async (absolutePath) => {
        if (!raced) {
          raced = true;
          await writeFile(absolutePath, "written during restore\n", "utf8");
        }
      }
    });

    const result = await baseline.restoreChunk(root, chunkRequest(baseline, root, 0));

    expect(result.status).toBe("stale");
    expect(await readFile(path.join(root, "doc.md"), "utf8")).toBe("written during restore\n");
    const names = await readdir(root);
    const copy = names.find((name) => name.startsWith("doc (outside copy"));
    expect(copy).toBeDefined();
    expect(await readFile(path.join(root, copy!), "utf8")).toBe(DISK);
    expect(names.filter((name) => name.startsWith("."))).toEqual([]);
  });

  it("uses the guarded replacement for a whole-file restore too", async () => {
    let raced = false;
    const { root, baseline } = await reviewedEdit(BASE, DISK, {
      beforeRestorePublish: async (absolutePath) => {
        if (!raced) {
          raced = true;
          await writeFile(absolutePath, "racing writer\n", "utf8");
        }
      }
    });

    const result = await baseline.restore(root, externalReviewFileId("doc.md"));

    expect(result.status).toBe("stale");
    expect(await readFile(path.join(root, "doc.md"), "utf8")).toBe("racing writer\n");
    expect((await readdir(root)).some((name) => name.startsWith("doc (outside copy"))).toBe(true);
  });

  it("restores an outside deletion exclusively and never replaces a file that appeared", async () => {
    const root = await workspace();
    await writeFile(path.join(root, "gone.md"), "original\n", "utf8");
    const baseline = service();
    await baseline.attach(root, subscriber());
    await rm(path.join(root, "gone.md"));
    baseline.noteDiskChange(root, { relativePath: "gone.md", eventType: "rename" });
    await waitFor(() => baseline.currentReview(root).proposal !== null);

    const internals = baseline as unknown as {
      states: Map<string, unknown>;
      restoreItem: (state: unknown, item: unknown, content?: string) => Promise<string | null>;
    };
    const item = {
      relativePath: "gone.md",
      kind: "delete",
      baselineContent: "original\n",
      baselineHash: hashOf("original\n"),
      diskContent: null,
      diskHash: null
    };
    // Simulate a file that lands after the last look but before the create.
    const state = internals.states.get(path.resolve(root));
    await writeFile(path.join(root, "gone.md"), "appeared\n", "utf8");
    const outcome = await internals.restoreItem(state, item);
    expect(outcome).toMatch(/changed again/);
    expect(await readFile(path.join(root, "gone.md"), "utf8")).toBe("appeared\n");

    await rm(path.join(root, "gone.md"));
    expect(await internals.restoreItem(state, item)).toBeNull();
    expect(await readFile(path.join(root, "gone.md"), "utf8")).toBe("original\n");
  });

  it("reviews a whitespace split pair as two chunks that can be kept and restored independently", async () => {
    const base = "one\n\ntwo\n";
    const disk = "one\nnew text\ntwo\n";
    const { root, baseline } = await reviewedEdit(base, disk);
    const hunks = editFile(baseline, root).hunks!;
    expect(hunks).toHaveLength(2);
    expect(hunks.map((hunk) => [hunk.oldLines, hunk.newLines])).toEqual([
      [[], ["new text"]],
      [[""], []]
    ]);

    // Restore the blank-line removal: disk keeps the new text and the blank line.
    await baseline.restoreChunk(root, chunkRequest(baseline, root, 1));
    expect(await readFile(path.join(root, "doc.md"), "utf8")).toBe("one\nnew text\n\ntwo\n");
    expect(editFile(baseline, root).hunks).toHaveLength(1);

    // Keep the insertion: nothing left to review.
    await baseline.keepChunk(root, chunkRequest(baseline, root, 0));
    expect(baseline.currentReview(root).proposal).toBeNull();
  });
});
