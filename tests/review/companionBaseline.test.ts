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
    await writeFile(path.join(root, "doc.comments.md"), "> doc\n\nfirst\n");
    const baseline = service();
    await baseline.attach(root, subscriber);

    // An outside tool edits the comments and the document.
    await writeFile(path.join(root, "doc.comments.md"), "> doc\n\nhandled?\n");
    await writeFile(path.join(root, "doc.md"), "doc changed\n");
    await baseline.refreshNow(root);

    expect(reviewPaths(baseline.currentReview(root))).toEqual(["edit_file:doc.md"]);
    expect(baseline.hasPendingReview(root, "doc.comments.md")).toBe(false);
  });

  it("reviews a name.notes.md file like any document (notes removed 2026-09-25)", async () => {
    const root = await workspace();
    await writeFile(path.join(root, "doc.md"), "doc\n");
    await writeFile(path.join(root, "doc.notes.md"), "notes\n");
    const baseline = service();
    await baseline.attach(root, subscriber);

    await writeFile(path.join(root, "doc.notes.md"), "notes changed\n");
    await baseline.refreshNow(root);

    expect(reviewPaths(baseline.currentReview(root))).toEqual(["edit_file:doc.notes.md"]);
    expect(baseline.hasPendingReview(root, "doc.notes.md")).toBe(true);
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
    baseline.noteDiskChange(root, { relativePath: "other.comments.md", eventType: "rename" });
    await sleep(60);
    expect(reviewPaths(baseline.currentReview(root))).toEqual([]);

    baseline.noteDiskChange(root, { relativePath: "doc.md", eventType: "change" });
    const startedAt = Date.now();
    while (reviewPaths(baseline.currentReview(root)).length === 0 && Date.now() - startedAt < 10_000) {
      await sleep(10);
    }
    expect(reviewPaths(baseline.currentReview(root))).toEqual(["edit_file:doc.md"]);
  });

  it("does not carry companions through baseline records", async () => {
    const root = await workspace();
    await writeFile(path.join(root, "doc.md"), "doc\n");
    await writeFile(path.join(root, "doc.comments.md"), "comments\n");
    const baseline = service();
    await baseline.attach(root, subscriber);

    await baseline.runIliadMutation(root, {
      paths: ["doc.comments.md"],
      operation: async () => {
        await writeFile(path.join(root, "renamed.comments.md"), "comments\n");
        await rm(path.join(root, "doc.comments.md"));
      },
      record: () => [
        { op: "move", fromRelativePath: "doc.comments.md", toRelativePath: "renamed.comments.md", directory: false },
        { op: "set", relativePath: "x.comments.md", content: "x" },
        { op: "reconcile", relativePath: "renamed.comments.md" }
      ]
    });
    await baseline.refreshNow(root);

    expect(reviewPaths(baseline.currentReview(root))).toEqual([]);
  });
});

describe("guarded companion writes", () => {
  it("does not lose an outside write that lands between the check and the write", async () => {
    const root = await workspace();
    await writeFile(path.join(root, "doc.comments.md"), "one\n");
    let raced = false;
    const baseline = new WorkspaceBaselineService({
      beforeRestorePublish: async () => {
        raced = true;
      }
    });
    services.push(baseline);

    // Outside write already happened when Iliad writes with the old hash.
    await writeFile(path.join(root, "doc.comments.md"), "agent\n");
    await expect(
      baseline.writeMarkdownIfUnchanged(root, {
        relativePath: "doc.comments.md",
        content: "mine\n",
        expected: { kind: "hash", hash: hashMarkdown("one\n") }
      })
    ).resolves.toEqual({ status: "conflict", reason: "disk_changed" });
    expect(raced).toBe(false);
    const { readFile, readdir } = await import("node:fs/promises");
    await expect(readFile(path.join(root, "doc.comments.md"), "utf8")).resolves.toBe("agent\n");

    // A file appearing at the path during the publish is never replaced.
    const racing = new WorkspaceBaselineService({
      beforeRestorePublish: async (absolutePath) => {
        await writeFile(absolutePath, "appeared\n");
      }
    });
    services.push(racing);
    await expect(
      racing.writeMarkdownIfUnchanged(root, {
        relativePath: "doc.comments.md",
        content: "mine\n",
        expected: { kind: "hash", hash: hashMarkdown("agent\n") }
      })
    ).resolves.toEqual({ status: "conflict", reason: "disk_changed" });
    await expect(readFile(path.join(root, "doc.comments.md"), "utf8")).resolves.toBe("appeared\n");
    // The held bytes are kept beside it, nothing hidden is left behind.
    const names = (await readdir(root)).sort();
    expect(names).toContain("doc.comments (outside copy).md");
    expect(names.some((name) => name.startsWith(".iliad-restore"))).toBe(false);
  });

  it("writes through the hold when the hash matches, leaving no holding files", async () => {
    const root = await workspace();
    await writeFile(path.join(root, "doc.comments.md"), "one\n");
    const baseline = service();
    const { readFile, readdir } = await import("node:fs/promises");

    await expect(
      baseline.writeMarkdownIfUnchanged(root, {
        relativePath: "doc.comments.md",
        content: "two\n",
        expected: { kind: "hash", hash: hashMarkdown("one\n") }
      })
    ).resolves.toMatchObject({ status: "written" });
    await expect(readFile(path.join(root, "doc.comments.md"), "utf8")).resolves.toBe("two\n");
    expect(await readdir(root)).toEqual(["doc.comments.md"]);
  });

  it("removes a companion by moving the verified held file to the Trash", async () => {
    const root = await workspace();
    await writeFile(path.join(root, "doc.comments.md"), "one\n");
    const trashed: string[] = [];
    const baseline = new WorkspaceBaselineService({
      trashItem: async (absolutePath) => {
        const { readFile: read } = await import("node:fs/promises");
        trashed.push(await read(absolutePath, "utf8"));
        await rm(absolutePath);
      }
    });
    services.push(baseline);
    const { readdir } = await import("node:fs/promises");

    await expect(
      baseline.removeMarkdownIfUnchanged(root, { relativePath: "doc.comments.md", expected: { kind: "hash", hash: hashMarkdown("two\n") } })
    ).resolves.toEqual({ status: "conflict", reason: "disk_changed" });
    await expect(
      baseline.removeMarkdownIfUnchanged(root, { relativePath: "doc.comments.md", expected: { kind: "hash", hash: hashMarkdown("one\n") } })
    ).resolves.toMatchObject({ status: "written" });
    expect(trashed).toEqual(["one\n"]);
    expect(await readdir(root)).toEqual([]);
  });
});
