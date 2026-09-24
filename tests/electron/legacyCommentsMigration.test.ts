import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  legacyCommentsAttachHook,
  legacyCommentsStorePath
} from "../../electron/comments/legacyCommentsMigration";
import { WorkspaceBaselineService } from "../../electron/review/workspaceBaseline";
import { parseCommentsFile, serializeCommentsFile } from "../../electron/shared/commentsFile";

let userData: string;
let workspaceA: string;
let workspaceB: string;
let baseline: WorkspaceBaselineService;

function legacy(workspacePath: string, documentRelativePath: string, id: string, quote: string, comment: string, extra = {}) {
  return { id, workspacePath, documentRelativePath, from: 0, to: 0, quote, occurrence: 1, prefix: "", comment, createdAt: "", status: "pending", ...extra };
}

async function writeStore(rows: unknown[]) {
  await mkdir(path.dirname(legacyCommentsStorePath(userData)), { recursive: true });
  await writeFile(legacyCommentsStorePath(userData), JSON.stringify(rows), "utf8");
}

async function readStore() {
  try {
    return JSON.parse(await readFile(legacyCommentsStorePath(userData), "utf8")) as Array<{ id: string }>;
  } catch {
    return null;
  }
}

beforeEach(async () => {
  userData = await mkdtemp(path.join(os.tmpdir(), "iliad-userdata-"));
  workspaceA = await mkdtemp(path.join(os.tmpdir(), "iliad-ws-a-"));
  workspaceB = await mkdtemp(path.join(os.tmpdir(), "iliad-ws-b-"));
  baseline = new WorkspaceBaselineService();
});

afterEach(async () => {
  baseline.dispose();
  await Promise.all([userData, workspaceA, workspaceB].map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("legacy comments migration (V19)", () => {
  it("moves one workspace's comments into companion files and keeps the rest", async () => {
    await writeFile(path.join(workspaceA, "doc.md"), "One line. twice here, twice here.\n");
    await mkdir(path.join(workspaceA, "sub"));
    await writeFile(path.join(workspaceA, "sub", "other.md"), "Other text\n");
    await writeFile(path.join(workspaceB, "doc.md"), "B\n");
    await writeStore([
      legacy(workspaceA, "doc.md", "c1", "One line.", "first"),
      legacy(workspaceA, "doc.md", "c2", "twice here", "second", { occurrence: 2, prefix: "twice here, " }),
      legacy(workspaceA, "sub/other.md", "c3", "Other", "third"),
      legacy(workspaceA, "gone.md", "c4", "x", "document no longer exists"),
      legacy(workspaceB, "doc.md", "c5", "B", "other workspace"),
      legacy(workspaceA, "doc.md", "c6", "x", "sent long ago", { status: "sent" })
    ]);

    const written = await legacyCommentsAttachHook(userData, baseline)(workspaceA);

    expect(written.sort()).toEqual([path.join(workspaceA, "doc.comments.md"), path.join(workspaceA, "sub", "other.comments.md")].sort());
    const entries = parseCommentsFile(await readFile(path.join(workspaceA, "doc.comments.md"), "utf8"));
    expect(entries).toEqual([
      { id: "c1", quote: "One line.", comment: "first" },
      { id: "c2", quote: "twice here", comment: "second", occurrence: 2, prefix: "twice here, " }
    ]);
    expect(parseCommentsFile(await readFile(path.join(workspaceA, "sub", "other.comments.md"), "utf8"))).toEqual([
      { id: "c3", quote: "Other", comment: "third" }
    ]);
    expect((await readStore())?.map((row) => row.id).sort()).toEqual(["c4", "c5"]);
  });

  it("merges by id into an existing file and deletes the store when empty", async () => {
    await writeFile(path.join(workspaceA, "doc.md"), "Alpha Beta\n");
    await writeFile(
      path.join(workspaceA, "doc.comments.md"),
      serializeCommentsFile([{ id: "c1", quote: "Alpha", comment: "already here (edited)" }])
    );
    await writeStore([legacy(workspaceA, "doc.md", "c1", "Alpha", "old"), legacy(workspaceA, "doc.md", "c2", "Beta", "new")]);

    await legacyCommentsAttachHook(userData, baseline)(workspaceA);

    expect(parseCommentsFile(await readFile(path.join(workspaceA, "doc.comments.md"), "utf8"))).toEqual([
      { id: "c1", quote: "Alpha", comment: "already here (edited)" },
      { id: "c2", quote: "Beta", comment: "new" }
    ]);
    await expect(stat(legacyCommentsStorePath(userData))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does nothing without a legacy store", async () => {
    await expect(legacyCommentsAttachHook(userData, baseline)(workspaceA)).resolves.toEqual([]);
  });
});
