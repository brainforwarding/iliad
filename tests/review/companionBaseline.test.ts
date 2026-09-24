import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hashMarkdown } from "../../electron/review/hash";
import { WorkspaceBaselineService, type ExternalReviewSnapshot } from "../../electron/review/workspaceBaseline";

let roots: string[] = [];
let services: WorkspaceBaselineService[] = [];

afterEach(async () => {
  services.forEach((service) => service.dispose());
  services = [];
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  roots = [];
});

async function workspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), "iliad-companion-baseline-"));
  roots.push(root);
  return root;
}

function service() {
  const instance = new WorkspaceBaselineService({ settleMs: 10, deferMs: 10, confirmMs: 5, releaseGraceMs: 40 });
  services.push(instance);
  return instance;
}

const subscriber = { id: 1, send: vi.fn() };

function reviewPaths(snapshot: ExternalReviewSnapshot) {
  return (snapshot.proposal?.files ?? []).map((file) => `${file.kind}:${file.relativePath}`).sort();
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("companion files never enter outside review (V9)", () => {
  it("skips companions when scanning and refreshing", async () => {
    const root = await workspace();
    await writeFile(path.join(root, "doc.md"), "doc\n");
    await writeFile(path.join(root, "doc.notes.md"), "notes\n");
    const baseline = service();
    await baseline.attach(root, subscriber);

    // An outside tool edits the notes, adds comments, and edits the document.
    await writeFile(path.join(root, "doc.notes.md"), "notes changed\n");
    await writeFile(path.join(root, "doc.comments.md"), "> doc\n\nhandled?\n");
    await writeFile(path.join(root, "doc.md"), "doc changed\n");
    await baseline.refreshNow(root);

    expect(reviewPaths(baseline.currentReview(root))).toEqual(["edit_file:doc.md"]);
    expect(baseline.hasPendingReview(root, "doc.notes.md")).toBe(false);
  });

  it("writes companions only through compare-and-swap, without joining the baseline", async () => {
    const root = await workspace();
    await writeFile(path.join(root, "doc.md"), "doc\n");
    const baseline = service();
    await baseline.attach(root, subscriber);

    await expect(
      baseline.writeMarkdownIfUnchanged(root, { relativePath: "doc.comments.md", content: "one\n", expected: { kind: "absent" } })
    ).resolves.toMatchObject({ status: "written" });
    await expect(
      baseline.writeMarkdownIfUnchanged(root, { relativePath: "doc.comments.md", content: "two\n", expected: { kind: "absent" } })
    ).resolves.toEqual({ status: "conflict", reason: "disk_changed" });
    await expect(
      baseline.writeMarkdownIfUnchanged(root, {
        relativePath: "doc.comments.md",
        content: "two\n",
        expected: { kind: "hash", hash: hashMarkdown("one\n") }
      })
    ).resolves.toMatchObject({ status: "written" });

    // An agent deletes the file afterwards: not a reviewable deletion.
    await rm(path.join(root, "doc.comments.md"));
    await baseline.refreshNow(root);
    expect(reviewPaths(baseline.currentReview(root))).toEqual([]);
  });

  it("ignores disk-change hints for companions", async () => {
    const root = await workspace();
    await writeFile(path.join(root, "doc.md"), "doc\n");
    const baseline = service();
    await baseline.attach(root, subscriber);

    await writeFile(path.join(root, "doc.md"), "doc changed\n");
    baseline.noteDiskChange(root, { relativePath: "doc.comments.md", eventType: "change" });
    baseline.noteDiskChange(root, { relativePath: "doc.notes.md", eventType: "rename" });
    await sleep(60);
    expect(reviewPaths(baseline.currentReview(root))).toEqual([]);

    baseline.noteDiskChange(root, { relativePath: "doc.md", eventType: "change" });
    await sleep(80);
    expect(reviewPaths(baseline.currentReview(root))).toEqual(["edit_file:doc.md"]);
  });

  it("does not carry companions through baseline records", async () => {
    const root = await workspace();
    await writeFile(path.join(root, "doc.md"), "doc\n");
    await writeFile(path.join(root, "doc.notes.md"), "notes\n");
    const baseline = service();
    await baseline.attach(root, subscriber);

    await baseline.runIliadMutation(root, {
      paths: ["doc.notes.md"],
      operation: async () => {
        await writeFile(path.join(root, "renamed.notes.md"), "notes\n");
        await rm(path.join(root, "doc.notes.md"));
      },
      record: () => [
        { op: "move", fromRelativePath: "doc.notes.md", toRelativePath: "renamed.notes.md", directory: false },
        { op: "set", relativePath: "x.comments.md", content: "x" },
        { op: "reconcile", relativePath: "renamed.notes.md" }
      ]
    });
    await baseline.refreshNow(root);

    expect(reviewPaths(baseline.currentReview(root))).toEqual([]);
  });
});
