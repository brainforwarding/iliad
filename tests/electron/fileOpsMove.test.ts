import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { movePath } from "../../electron/fs/fileOps";

let workspaceRoot: string;
let outsideRoot: string;

async function write(relativePath: string, content: string) {
  const filePath = path.join(workspaceRoot, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
  return filePath;
}

async function makeDir(relativePath: string) {
  const directoryPath = path.join(workspaceRoot, relativePath);
  await mkdir(directoryPath, { recursive: true });
  return directoryPath;
}

describe("movePath", () => {
  beforeEach(async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "iliad-move-"));
    outsideRoot = await mkdtemp(path.join(os.tmpdir(), "iliad-move-outside-"));
  });

  afterEach(async () => {
    await rm(workspaceRoot, { force: true, recursive: true });
    await rm(outsideRoot, { force: true, recursive: true });
  });

  it("moves a Markdown file into a folder and returns the moved file node", async () => {
    const source = await write("draft.md", "hello");
    const targetDirectory = await makeDir("notes");

    const moved = await movePath(workspaceRoot, source, targetDirectory);

    expect(moved).toMatchObject({
      name: "draft.md",
      path: path.join(targetDirectory, "draft.md"),
      relativePath: path.join("notes", "draft.md"),
      kind: "markdown"
    });
    await expect(readFile(path.join(targetDirectory, "draft.md"), "utf8")).resolves.toBe("hello");
    await expect(stat(source)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("moves a folder with children and supports root-level no-op moves", async () => {
    const folder = await makeDir("drafts/notes");
    await write("drafts/notes/source.md", "source");

    const movedFolder = await movePath(workspaceRoot, folder, workspaceRoot);

    expect(movedFolder).toMatchObject({
      name: "notes",
      path: path.join(workspaceRoot, "notes"),
      relativePath: "notes",
      kind: "directory"
    });
    await expect(readFile(path.join(workspaceRoot, "notes/source.md"), "utf8")).resolves.toBe("source");

    const rootFile = await write("root.md", "root");
    const noOp = await movePath(workspaceRoot, rootFile, workspaceRoot);

    expect(noOp).toMatchObject({
      path: rootFile,
      relativePath: "root.md",
      kind: "markdown"
    });
  });

  it("rejects outside, hidden, non-directory, collision, workspace-root, and descendant moves", async () => {
    const source = await write("draft.md", "hello");
    const targetDirectory = await makeDir("notes");
    const outsideFile = path.join(outsideRoot, "outside.md");
    await writeFile(outsideFile, "outside", "utf8");
    await write("notes/draft.md", "collision");
    await write(".hidden.md", "hidden");
    const targetFile = await write("target.md", "not a folder");
    const folder = await makeDir("folder");
    const descendant = await makeDir("folder/child");

    await expect(movePath(workspaceRoot, outsideFile, targetDirectory)).rejects.toThrow(/outside/i);
    await expect(movePath(workspaceRoot, source, outsideRoot)).rejects.toThrow(/outside/i);
    await expect(movePath(workspaceRoot, path.join(workspaceRoot, ".hidden.md"), targetDirectory)).rejects.toThrow(/hidden/i);
    await expect(movePath(workspaceRoot, source, targetFile)).rejects.toThrow(/folder/i);
    await expect(movePath(workspaceRoot, source, targetDirectory)).rejects.toThrow(/already exists/i);
    await expect(movePath(workspaceRoot, workspaceRoot, targetDirectory)).rejects.toThrow(/workspace root/i);
    await expect(movePath(workspaceRoot, folder, descendant)).rejects.toThrow(/itself/i);
  });

  it("rejects symlinked sources and target directories", async () => {
    const realFile = await write("real.md", "real");
    const linkFile = path.join(workspaceRoot, "link.md");
    await symlink(realFile, linkFile);

    const realDirectory = await makeDir("real-dir");
    const linkDirectory = path.join(workspaceRoot, "link-dir");
    await symlink(realDirectory, linkDirectory, "dir");

    const targetDirectory = await makeDir("target");
    await expect(movePath(workspaceRoot, linkFile, targetDirectory)).rejects.toThrow(/symlink/i);
    await expect(movePath(workspaceRoot, realFile, linkDirectory)).rejects.toThrow(/symlink/i);
  });
});
