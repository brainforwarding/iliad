import { link, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMarkdownFile,
  duplicatePath,
  movePath,
  readDirectory,
  renamePath
} from "../../electron/fs/fileOps";

vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() }, shell: { trashItem: vi.fn() } }));

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

async function write(relativePath: string, content: string) {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
  return filePath;
}

async function exists(relativePath: string) {
  try {
    await stat(path.join(root, relativePath));
    return true;
  } catch {
    return false;
  }
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "iliad-companions-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("companion files in the tree", () => {
  it("annotates companions whose document exists; orphans stay ordinary", async () => {
    await write("chapter.md", "# Chapter\n");
    await write("chapter.notes.md", "voice\n");
    await write("chapter.comments.md", "> x\n\ny\n");
    await write("orphan.notes.md", "lonely\n");

    const tree = await readDirectory(root);
    const byName = new Map(tree.map((node) => [node.name, node]));

    expect(byName.get("chapter.notes.md")?.companion).toEqual({ kind: "notes", documentPath: path.join(root, "chapter.md") });
    expect(byName.get("chapter.comments.md")?.companion).toEqual({ kind: "comments", documentPath: path.join(root, "chapter.md") });
    expect(byName.get("orphan.notes.md")?.companion).toBeUndefined();
    expect(byName.get("chapter.md")?.companion).toBeUndefined();
  });
});

describe("document names", () => {
  it("rejects creating or renaming documents to companion-shaped names", async () => {
    const doc = await write("draft.md", "draft\n");

    await expect(createMarkdownFile(root, root, "draft.notes.md")).rejects.toThrow(/reserved/);
    await expect(createMarkdownFile(root, root, "draft.comments")).rejects.toThrow(/reserved/);
    await expect(renamePath(root, doc, "draft.notes.md")).rejects.toThrow(/reserved/);
    await expect(renamePath(root, doc, "x.comments.md")).rejects.toThrow(/reserved/);
    await expect(exists("draft.md")).resolves.toBe(true);
  });

  it("does not rename, move, or duplicate a companion on its own while its document exists", async () => {
    await write("doc.md", "doc\n");
    const notes = await write("doc.notes.md", "notes\n");
    await mkdir(path.join(root, "sub"));

    await expect(renamePath(root, notes, "other.md")).rejects.toThrow(/move with their document/);
    await expect(movePath(root, notes, path.join(root, "sub"))).rejects.toThrow(/move with their document/);
    await expect(duplicatePath(root, notes)).rejects.toThrow(/move with their document/);
  });
});

describe("file operations carry companions", () => {
  it("renames a document with its notes and comments", async () => {
    const doc = await write("draft.md", "doc\n");
    await write("draft.notes.md", "notes\n");
    await write("draft.comments.md", "comments\n");

    const renamed = await renamePath(root, doc, "final.md");

    expect(renamed.path).toBe(path.join(root, "final.md"));
    expect((await readdir(root)).sort()).toEqual(["final.comments.md", "final.md", "final.notes.md"]);
    await expect(readFile(path.join(root, "final.notes.md"), "utf8")).resolves.toBe("notes\n");
  });

  it("moves a document with its existing companions only", async () => {
    const doc = await write("draft.md", "doc\n");
    await write("draft.comments.md", "comments\n");
    await mkdir(path.join(root, "chapters"));

    await movePath(root, doc, path.join(root, "chapters"));

    expect((await readdir(path.join(root, "chapters"))).sort()).toEqual(["draft.comments.md", "draft.md"]);
    expect(await readdir(root)).toEqual(["chapters"]);
  });

  it("refuses the whole move when a companion target is taken (no overwrite)", async () => {
    const doc = await write("draft.md", "doc\n");
    await write("draft.notes.md", "mine\n");
    await write("chapters/draft.notes.md", "someone else's\n");

    await expect(movePath(root, doc, path.join(root, "chapters"))).rejects.toThrow(/already exists/);
    await expect(readFile(path.join(root, "draft.md"), "utf8")).resolves.toBe("doc\n");
    await expect(readFile(path.join(root, "chapters/draft.notes.md"), "utf8")).resolves.toBe("someone else's\n");
    await expect(exists("chapters/draft.md")).resolves.toBe(false);
  });

  it("rolls back completed moves when a companion move fails midway", async () => {
    const doc = await write("draft.md", "doc\n");
    await write("draft.notes.md", "notes\n");
    await write("draft.comments.md", "comments\n");
    await mkdir(path.join(root, "chapters"));
    const targetComments = path.join(root, "chapters/draft.comments.md");

    // A file appears at the comments target after the preflight: the hard
    // link refuses to overwrite it and everything already moved goes back.
    linkHook.before = async (_from, to) => {
      if (to === targetComments) {
        await writeFile(targetComments, "appeared\n", "utf8");
      }
    };

    try {
      await expect(movePath(root, doc, path.join(root, "chapters"))).rejects.toThrow(/nothing was moved/);
    } finally {
      linkHook.before = null;
    }

    expect((await readdir(root)).sort()).toEqual(["chapters", "draft.comments.md", "draft.md", "draft.notes.md"]);
    expect(await readdir(path.join(root, "chapters"))).toEqual(["draft.comments.md"]);
    await expect(readFile(targetComments, "utf8")).resolves.toBe("appeared\n");
    await expect(readFile(path.join(root, "draft.notes.md"), "utf8")).resolves.toBe("notes\n");
  });

  it("duplicates a document with its companions under a stem free for the whole group", async () => {
    const doc = await write("draft.md", "doc\n");
    await write("draft.notes.md", "notes\n");
    await write("draft.comments.md", "comments\n");
    // "draft copy" is taken for notes only: the group moves on to "draft copy-2".
    await write("draft copy.notes.md", "stray\n");

    const copy = await duplicatePath(root, doc);

    expect(copy.name).toBe("draft copy-2.md");
    await expect(readFile(path.join(root, "draft copy-2.notes.md"), "utf8")).resolves.toBe("notes\n");
    await expect(readFile(path.join(root, "draft copy-2.comments.md"), "utf8")).resolves.toBe("comments\n");
    await expect(readFile(path.join(root, "draft copy.notes.md"), "utf8")).resolves.toBe("stray\n");
  });

  it("still links correctly when companions are hard links already", async () => {
    const doc = await write("a.md", "doc\n");
    await write("elsewhere.md", "shared\n");
    await link(path.join(root, "elsewhere.md"), path.join(root, "a.notes.md"));

    await renamePath(root, doc, "b.md");

    await expect(readFile(path.join(root, "b.notes.md"), "utf8")).resolves.toBe("shared\n");
    await expect(exists("a.notes.md")).resolves.toBe(false);
  });
});

describe("trash and companion IPC helpers", () => {
  it("trashes the document, then its companions, and reports failures", async () => {
    const { trashWithCompanions } = await import("../../electron/ipc/files");
    const doc = await write("draft.md", "doc\n");
    await write("draft.notes.md", "notes\n");
    await write("draft.comments.md", "comments\n");
    const trashed: string[] = [];

    const result = await trashWithCompanions(root, doc, async (target) => {
      if (target.endsWith("draft.comments.md")) {
        throw new Error("locked");
      }
      trashed.push(path.basename(target));
      await rm(target);
    });

    expect(trashed).toEqual(["draft.md", "draft.notes.md"]);
    expect(result.companionFailures).toEqual([{ path: path.join(root, "draft.comments.md"), reason: "locked" }]);
  });

  it("reads and removes only companion paths, guarded by hash", async () => {
    const { readCompanionFile, removeCompanionFile } = await import("../../electron/ipc/files");
    const { WorkspaceBaselineService } = await import("../../electron/review/workspaceBaseline");
    const { hashMarkdown } = await import("../../electron/review/hash");
    const baseline = new WorkspaceBaselineService();
    const doc = await write("draft.md", "doc\n");
    const comments = await write("draft.comments.md", "c\n");

    await expect(readCompanionFile(root, doc)).rejects.toThrow(/notes and comments/);
    await expect(readCompanionFile(root, path.join(root, "draft.notes.md"))).resolves.toEqual({ status: "absent" });
    await expect(readCompanionFile(root, comments)).resolves.toEqual({ status: "present", content: "c\n", hash: hashMarkdown("c\n") });

    await expect(removeCompanionFile(baseline, root, doc, hashMarkdown("doc\n"))).rejects.toThrow(/notes and comments/);
    await expect(removeCompanionFile(baseline, root, comments, hashMarkdown("other"))).resolves.toEqual({
      status: "conflict",
      reason: "disk_changed"
    });
    await expect(exists("draft.comments.md")).resolves.toBe(true);
    await expect(removeCompanionFile(baseline, root, comments, hashMarkdown("c\n"))).resolves.toMatchObject({ status: "written" });
    await expect(exists("draft.comments.md")).resolves.toBe(false);
    baseline.dispose();
  });
});
