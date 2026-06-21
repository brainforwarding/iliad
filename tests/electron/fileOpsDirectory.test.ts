import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readDirectory } from "../../electron/fs/fileOps";

let workspaceRoot: string;

async function write(relativePath: string, content: string) {
  const filePath = path.join(workspaceRoot, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

describe("readDirectory", () => {
  beforeEach(async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "iliad-directory-"));
  });

  afterEach(async () => {
    await rm(workspaceRoot, { force: true, recursive: true });
  });

  it("hides temporary workspace files from the file tree", async () => {
    await write("__tmp-08.md", "temporary");
    await write("__tmp-09-slide.md", "temporary");
    await write("draft.tmp", "temporary");
    await write("backup.md~", "temporary");
    await write("lesson.md", "visible");

    const nodes = await readDirectory(workspaceRoot);

    expect(nodes.map((node) => node.name)).toEqual(["lesson.md"]);
  });
});
