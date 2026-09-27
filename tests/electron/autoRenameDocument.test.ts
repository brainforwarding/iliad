import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMarkdownFile } from "../../electron/fs/fileOps";
import { autoRenameDocument } from "../../electron/ipc/files";
import { WorkspaceBaselineService } from "../../electron/review/workspaceBaseline";

vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() }, shell: { trashItem: vi.fn() }, BrowserWindow: { fromWebContents: () => ({}) } }));

const linkHook = vi.hoisted(() => ({ before: null as null | ((from: string, to: string) => Promise<void>) }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    link: async (from: string, to: string) => {
      await linkHook.before?.(String(from), String(to));
      return actual.link(from, to);
    }
  };
});

let root: string;
let services: WorkspaceBaselineService[] = [];

function hashOf(content: string) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

async function write(relativePath: string, content: string) {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
  return filePath;
}

async function attachedBaseline() {
  const baseline = new WorkspaceBaselineService({ settleMs: 15, deferMs: 15, confirmMs: 10, releaseGraceMs: 40 });
  services.push(baseline);
  await baseline.attach(root, { id: 1, send: vi.fn() });
  return baseline;
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

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "iliad-auto-rename-"));
});

afterEach(async () => {
  linkHook.before = null;
  services.forEach((service) => service.dispose());
  services = [];
  await rm(root, { recursive: true, force: true });
});

describe("createMarkdownFile", () => {
  it("creates an empty document, exclusively, with -2, -3 on collisions", async () => {
    await write("untitled.md", "keep me\n");

    const second = await createMarkdownFile(root, root, "untitled");
    const third = await createMarkdownFile(root, root, "untitled");

    expect(second).toMatchObject({ name: "untitled-2.md", content: "" });
    expect(third).toMatchObject({ name: "untitled-3.md", content: "" });
    await expect(readFile(path.join(root, "untitled-2.md"), "utf8")).resolves.toBe("");
    await expect(readFile(path.join(root, "untitled.md"), "utf8")).resolves.toBe("keep me\n");
  });

  it("propagates errors other than EEXIST", async () => {
    await expect(createMarkdownFile(root, path.join(root, "missing"), "untitled")).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("autoRenameDocument", () => {
  it("renames to the stem when the disk still matches, with comments, and keeps the baseline consistent", async () => {
    const doc = await write("untitled.md", "Some text\n");
    await write("untitled.comments.md", "> x\n\nnote\n");
    const baseline = await attachedBaseline();

    const result = await autoRenameDocument(baseline, root, doc, { expectedHash: hashOf("Some text\n"), stem: "plan-de-sesion" });

    expect(result).toMatchObject({ ok: true, relativePath: "plan-de-sesion.md", node: { name: "plan-de-sesion.md", kind: "markdown" } });
    expect((await readdir(root)).sort()).toEqual(["plan-de-sesion.comments.md", "plan-de-sesion.md"]);

    // The baseline moved with the file: no outside review, and a guarded save at the new path works.
    baseline.noteDiskChange(root, { relativePath: null, eventType: "unknown" });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(baseline.currentReview(root).proposal).toBeNull();
    await expect(
      baseline.writeMarkdownIfUnchanged(root, {
        relativePath: "plan-de-sesion.md",
        content: "More\n",
        expected: { kind: "hash", hash: hashOf("Some text\n") }
      })
    ).resolves.toMatchObject({ status: "written" });
  });

  it("keeps spaced names and accents", async () => {
    const doc = await write("untitled.md", "Texto\n");
    const baseline = await attachedBaseline();

    await expect(autoRenameDocument(baseline, root, doc, { expectedHash: hashOf("Texto\n"), stem: "Plan de sesión" })).resolves.toMatchObject({
      ok: true,
      relativePath: "Plan de sesión.md"
    });
  });

  it("answers changed without renaming when the disk hash differs", async () => {
    const doc = await write("untitled.md", "typed more\n");
    const baseline = await attachedBaseline();

    await expect(autoRenameDocument(baseline, root, doc, { expectedHash: hashOf("older\n"), stem: "plan" })).resolves.toEqual({
      ok: false,
      reason: "changed"
    });
    expect(await readdir(root)).toEqual(["untitled.md"]);
  });

  it("runs after a save already queued (serialized with guarded writes)", async () => {
    const doc = await write("untitled.md", "one\n");
    const baseline = await attachedBaseline();

    const save = baseline.writeMarkdownIfUnchanged(root, {
      relativePath: "untitled.md",
      content: "two\n",
      expected: { kind: "hash", hash: hashOf("one\n") }
    });
    const rename = autoRenameDocument(baseline, root, doc, { expectedHash: hashOf("one\n"), stem: "plan" });

    await expect(save).resolves.toMatchObject({ status: "written" });
    await expect(rename).resolves.toEqual({ ok: false, reason: "changed" });
    expect(await readdir(root)).toEqual(["untitled.md"]);
  });

  it("answers under_review when the document has pending outside changes", async () => {
    const doc = await write("untitled.md", "one\n");
    const baseline = await attachedBaseline();
    await writeFile(doc, "outside\n", "utf8");
    baseline.noteDiskChange(root, { relativePath: "untitled.md", eventType: "change" });
    await waitFor(() => baseline.currentReview(root).proposal !== null);

    await expect(autoRenameDocument(baseline, root, doc, { expectedHash: hashOf("outside\n"), stem: "plan" })).resolves.toEqual({
      ok: false,
      reason: "under_review"
    });
    expect(await readdir(root)).toEqual(["untitled.md"]);
  });

  it("adds -2 on a collision and skips a name whose orphan comments file exists", async () => {
    const doc = await write("untitled.md", "text\n");
    await write("plan.md", "other\n");
    await write("plan-2.comments.md", "orphan\n");
    const baseline = await attachedBaseline();

    const result = await autoRenameDocument(baseline, root, doc, { expectedHash: hashOf("text\n"), stem: "plan" });

    expect(result).toMatchObject({ ok: true, relativePath: "plan-3.md" });
    await expect(readFile(path.join(root, "plan.md"), "utf8")).resolves.toBe("other\n");
    await expect(readFile(path.join(root, "plan-2.comments.md"), "utf8")).resolves.toBe("orphan\n");
    await expect(readFile(path.join(root, "plan-3.md"), "utf8")).resolves.toBe("text\n");
  });

  it("answers collision when stem … stem-9 are all taken", async () => {
    const doc = await write("untitled.md", "text\n");
    await write("plan.md", "x\n");
    for (let index = 2; index <= 9; index += 1) {
      await write(`plan-${index}.md`, "x\n");
    }
    const baseline = await attachedBaseline();

    await expect(autoRenameDocument(baseline, root, doc, { expectedHash: hashOf("text\n"), stem: "plan" })).resolves.toEqual({
      ok: false,
      reason: "collision"
    });
    await expect(readFile(doc, "utf8")).resolves.toBe("text\n");
  });

  it("moves on to the next suffix when a file appears between the check and the rename", async () => {
    const doc = await write("untitled.md", "text\n");
    const baseline = await attachedBaseline();
    linkHook.before = async (_from, to) => {
      if (path.basename(to) === "plan.md") {
        linkHook.before = null;
        await writeFile(to, "raced in\n", "utf8");
      }
    };

    const result = await autoRenameDocument(baseline, root, doc, { expectedHash: hashOf("text\n"), stem: "plan" });

    expect(result).toMatchObject({ ok: true, relativePath: "plan-2.md" });
    await expect(readFile(path.join(root, "plan.md"), "utf8")).resolves.toBe("raced in\n");
    await expect(readFile(path.join(root, "plan-2.md"), "utf8")).resolves.toBe("text\n");
  });

  it("refuses invalid stems, companions, and bad requests as failed", async () => {
    const doc = await write("untitled.md", "text\n");
    const comments = await write("untitled.comments.md", "c\n");
    const baseline = await attachedBaseline();
    const expectedHash = hashOf("text\n");

    for (const stem of ["", "../escape", "a/b", ".hidden", "x.comments", "x".repeat(200)]) {
      await expect(autoRenameDocument(baseline, root, doc, { expectedHash, stem })).resolves.toEqual({ ok: false, reason: "failed" });
    }
    await expect(autoRenameDocument(baseline, root, comments, { expectedHash: hashOf("c\n"), stem: "plan" })).resolves.toEqual({
      ok: false,
      reason: "failed"
    });
    await expect(autoRenameDocument(baseline, root, doc, { stem: "plan" })).resolves.toEqual({ ok: false, reason: "failed" });
    await expect(autoRenameDocument(baseline, root, path.join(root, "..", "outside.md"), { expectedHash, stem: "plan" })).resolves.toEqual({
      ok: false,
      reason: "failed"
    });
    expect((await readdir(root)).sort()).toEqual(["untitled.comments.md", "untitled.md"]);
  });
});
