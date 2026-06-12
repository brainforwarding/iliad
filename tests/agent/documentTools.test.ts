import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AgentDocumentToolError,
  createAgentDocumentTools,
  type AgentDocumentToolEvent
} from "../../electron/agent/documentTools";
import { hashMarkdown } from "../../electron/agent/hash";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "iliad-document-tools-"));
});

afterEach(async () => {
  await chmodSafe(path.join(root, "locked"));
  await chmodSafe(path.join(root, "locked.md"));
  await rm(root, { recursive: true, force: true });
});

async function chmodSafe(filePath: string) {
  try {
    await chmod(filePath, 0o700);
  } catch {
    // The file may not exist in every test.
  }
}

async function write(relativePath: string, content: string) {
  const absolutePath = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf8");
  return absolutePath;
}

async function mkdirp(relativePath: string) {
  const absolutePath = path.join(root, ...relativePath.split("/"));
  await mkdir(absolutePath, { recursive: true });
  return absolutePath;
}

async function symlinkSafe(target: string, relativePath: string) {
  try {
    await symlink(target, path.join(root, ...relativePath.split("/")));
    return true;
  } catch {
    return false;
  }
}

describe("Agent document tools", () => {
  it("lists Markdown documents recursively while skipping ignored, hidden, non-Markdown, and symlinked paths", async () => {
    await write("alpha.md", "# Alpha\n");
    await write("notes/beta.markdown", "# Beta\n");
    await write("notes/deep/gamma.mdown", "# Gamma\n");
    await write("notes/deep/too/far.md", "# Too far\n");
    await write(".hidden/secret.md", "# Secret\n");
    await write("node_modules/pkg/readme.md", "# Package\n");
    await write("dist/build.md", "# Build\n");
    await write("dist-electron/main.md", "# Main\n");
    await write("asset.png", "not markdown");
    await write("notes/todo.txt", "not markdown");
    await mkdirp("outside");
    await write("outside/linked.md", "# Linked\n");
    await symlinkSafe(path.join(root, "alpha.md"), "alpha-link.md");
    await symlinkSafe(path.join(root, "missing-target.md"), "broken.md");
    await symlinkSafe(path.join(root, "outside"), "linked-dir");

    const result = await createAgentDocumentTools({ workspaceRoot: root }).listDocuments({ depth: 2 });

    expect(result.files.map((file) => file.relativePath)).toEqual([
      "alpha.md",
      "notes/beta.markdown",
      "notes/deep/gamma.mdown",
      "outside/linked.md"
    ]);
    expect(result.files.map((file) => file.relativePath)).toEqual(
      [...result.files.map((file) => file.relativePath)].sort()
    );
    expect(result.skipped.ignored).toBeGreaterThanOrEqual(4);
    expect(result.skipped.nonMarkdown).toBe(2);
    expect(result.skipped.symlink).toBeGreaterThanOrEqual(3);
  });

  it("lists from a subdirectory and respects depth, limit, and size-based token estimates without reading content", async () => {
    await write("notes/a.md", "12345");
    await write("notes/b.md", "123456789");
    await write("notes/deep/c.md", "deep");
    await write("huge.md", "x".repeat(64));

    const tools = createAgentDocumentTools({
      workspaceRoot: root,
      limits: { maxReadBytes: 4, maxListResults: 10 }
    });
    const limited = await tools.listDocuments({ directory: "notes", depth: 0, limit: 1 });
    const rootList = await tools.listDocuments({ limit: 10 });

    expect(limited.files.map((file) => file.relativePath)).toEqual(["notes/a.md"]);
    expect(limited.truncated).toBe(true);
    expect(rootList.files).toContainEqual({
      relativePath: "huge.md",
      name: "huge.md",
      sizeBytes: 64,
      estimatedTokens: 16
    });
  });

  it("reads a Markdown document with exact content, hash, byte size, and token estimate", async () => {
    const content = "# Title\nExact content.\n";
    await write("notes/doc.md", content);

    const result = await createAgentDocumentTools({ workspaceRoot: root }).readDocument({ path: "notes/doc.md" });

    expect(result).toEqual({
      relativePath: "notes/doc.md",
      hash: hashMarkdown(content),
      content,
      sizeBytes: Buffer.byteLength(content, "utf8"),
      estimatedTokens: Math.ceil(content.length / 4)
    });
  });

  it("rejects unsafe read paths and invalid POSIX syntax before filesystem access", async () => {
    await write("doc.md", "# Doc\n");
    const tools = createAgentDocumentTools({ workspaceRoot: root });

    for (const unsafePath of [
      "/tmp/doc.md",
      "../doc.md",
      ".hidden/doc.md",
      "notes/.hidden/doc.md",
      "notes\\doc.md",
      "C:/doc.md",
      "C:doc.md",
      "//server/share/doc.md",
      "notes//doc.md",
      "doc.md/",
      "notes/./doc.md",
      "notes/\u0000bad.md",
      "notes/bad\nname.md"
    ]) {
      await expect(tools.readDocument({ path: unsafePath })).rejects.toBeInstanceOf(AgentDocumentToolError);
    }
  });

  it("rejects ignored, non-Markdown, directory, missing, symlinked, broken symlink, and oversized reads", async () => {
    await write("dist/doc.md", "# Ignored\n");
    await write("plain.txt", "text");
    await mkdirp("folder.md");
    await write("large.md", "12345");
    await mkdirp("outside");
    await write("outside/target.md", "# Target\n");
    const madeSymlinkFile = await symlinkSafe(path.join(root, "outside", "target.md"), "link.md");
    const madeSymlinkDir = await symlinkSafe(path.join(root, "outside"), "linked-dir");
    const madeBrokenSymlink = await symlinkSafe(path.join(root, "missing.md"), "broken.md");
    const tools = createAgentDocumentTools({ workspaceRoot: root, limits: { maxReadBytes: 4 } });

    for (const rejectedPath of ["dist/doc.md", "plain.txt", "folder.md", "missing.md", "large.md"]) {
      await expect(tools.readDocument({ path: rejectedPath })).rejects.toBeInstanceOf(AgentDocumentToolError);
    }

    if (madeSymlinkFile) {
      await expect(tools.readDocument({ path: "link.md" })).rejects.toMatchObject({ code: "symlink_path" });
    }
    if (madeSymlinkDir) {
      await expect(tools.readDocument({ path: "linked-dir/target.md" })).rejects.toMatchObject({ code: "symlink_path" });
    }
    if (madeBrokenSymlink) {
      await expect(tools.readDocument({ path: "broken.md" })).rejects.toMatchObject({ code: "symlink_path" });
    }
  });

  it("searches by file name and content with bounded deterministic matches", async () => {
    await write("alpha.md", "First line\nNeedle phrase here\n");
    await write("notes/needle-phrase-plan.md", "No matching content\n");
    await write("zeta.md", "Needle phrase again\nneedle phrase second\n");
    await write("notes/other.md", "needle only\n");

    const result = await createAgentDocumentTools({ workspaceRoot: root }).searchDocuments({
      query: " needle   phrase ",
      limit: 3
    });

    expect(result.truncated).toBe(true);
    expect(result.matches).toEqual([
      {
        relativePath: "notes/needle-phrase-plan.md",
        line: 0,
        matchType: "path",
        excerpt: "notes/needle-phrase-plan.md"
      },
      {
        relativePath: "alpha.md",
        line: 2,
        matchType: "content",
        excerpt: "Needle phrase here"
      },
      {
        relativePath: "zeta.md",
        line: 1,
        matchType: "content",
        excerpt: "Needle phrase again"
      }
    ]);
    expect(result.searchedFiles).toBe(4);
  });

  it("returns no matches and does not traverse the workspace for an empty search query", async () => {
    await write("doc.md", "anything");

    const result = await createAgentDocumentTools({ workspaceRoot: root }).searchDocuments({ query: " \n\t " });

    expect(result).toEqual({
      matches: [],
      truncated: false,
      searchedPaths: 0,
      searchedFiles: 0,
      skipped: {
        ignored: 0,
        unsafe: 0,
        unreadable: 0,
        oversized: 0,
        nonMarkdown: 0,
        symlink: 0
      }
    });
  });

  it("search skips oversized and unreadable files without failing", async () => {
    await write("readable.md", "needle phrase\n");
    await write("oversized.md", "needle phrase in a large file\n");
    const lockedDirectory = await mkdirp("locked");
    await write("locked/secret.md", "needle phrase hidden by permissions\n");
    await chmod(lockedDirectory, 0o000);

    const result = await createAgentDocumentTools({ workspaceRoot: root, limits: { maxReadBytes: 16 } }).searchDocuments({
      query: "needle phrase"
    });

    expect(result.matches).toEqual([
      {
        relativePath: "readable.md",
        line: 1,
        matchType: "content",
        excerpt: "needle phrase"
      }
    ]);
    expect(result.skipped.oversized).toBe(1);
    expect(result.skipped.unreadable).toBe(1);
  });

  it("finds deep course session paths with accent and alias folding without reading oversized content", async () => {
    await write("curso-odisea/curso-1/s1/s1.md", "x".repeat(128));
    const tools = createAgentDocumentTools({
      workspaceRoot: root,
      limits: {
        maxReadBytes: 16,
        maxContentSearchDepth: 1,
        maxPathSearchDepth: 6
      }
    });

    const result = await tools.searchDocuments({ query: "curso odisea sesión 1" });

    expect(result.matches).toEqual([
      {
        relativePath: "curso-odisea/curso-1/s1/s1.md",
        line: 0,
        matchType: "path",
        excerpt: "curso-odisea/curso-1/s1/s1.md"
      }
    ]);
    expect(result.searchedPaths).toBe(1);
    expect(result.searchedFiles).toBe(0);
    expect(result.skipped.oversized).toBe(0);
  });

  it("rejects invalid numeric inputs, clamps valid inputs, and reports truncation when caps are hit", async () => {
    await write("a.md", "needle phrase a\n");
    await write("b.md", "needle phrase b\n");
    await write("deep/c.md", "needle phrase c\n");
    const tools = createAgentDocumentTools({
      workspaceRoot: root,
      limits: { maxListResults: 1, maxSearchResults: 1, maxDepth: 0 }
    });

    await expect(tools.listDocuments({ depth: -1 })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(tools.listDocuments({ limit: 1.5 })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(tools.searchDocuments({ query: "needle", limit: Number.POSITIVE_INFINITY })).rejects.toMatchObject({
      code: "invalid_input"
    });

    const list = await tools.listDocuments({ depth: 10, limit: 10 });
    const search = await tools.searchDocuments({ query: "needle phrase", limit: 10 });

    expect(list.files.map((file) => file.relativePath)).toEqual(["a.md"]);
    expect(list.truncated).toBe(true);
    expect(search.matches).toHaveLength(1);
    expect(search.truncated).toBe(true);
  });

  it("emits metadata-only tool events without document content", async () => {
    const events: AgentDocumentToolEvent[] = [];
    const content = "DOCUMENT_CONTENT_SENTINEL\nneedle phrase";
    await write("doc.md", content);
    const tools = createAgentDocumentTools({
      workspaceRoot: root,
      onToolEvent: (event) => events.push(event)
    });

    await tools.readDocument({ path: "doc.md" });
    await tools.searchDocuments({ query: "needle phrase" });
    await expect(tools.readDocument({ path: "missing.md" })).rejects.toBeInstanceOf(AgentDocumentToolError);

    expect(events.map((event) => [event.toolName, event.status])).toEqual([
      ["read_document", "completed"],
      ["search_documents", "completed"],
      ["read_document", "failed"]
    ]);
    expect(JSON.stringify(events)).not.toContain("DOCUMENT_CONTENT_SENTINEL");
    expect(JSON.stringify(events)).not.toContain("needle phrase");
    expect(events[2].error).toMatchObject({ code: "not_found" });
  });
});

describe("exhaustive document discovery", () => {
  it("pins the traversal backstop defaults and the unchanged output budgets", () => {
    const { limits } = createAgentDocumentTools({ workspaceRoot: root });

    expect(limits.maxDepth).toBe(8);
    expect(limits.maxPathSearchDepth).toBe(16);
    expect(limits.maxContentSearchDepth).toBe(8);
    expect(limits.maxDirectories).toBe(10_000);
    expect(limits.maxFilesystemEntries).toBe(100_000);
    expect(limits.maxPathSearchFiles).toBe(20_000);
    expect(limits.maxSearchResults).toBe(50);
    expect(limits.maxListResults).toBe(500);
    expect(limits.maxContentSearchFiles).toBe(500);
  });

  it("finds a deep, late-alphabetical session file in one search at default limits (regression: traversal starvation)", async () => {
    // 200 empty early-alphabetical directories exceed the pre-fix
    // maxDirectories of 200 before the walk ever reaches `courses`.
    for (let index = 0; index < 200; index += 1) {
      await mkdirp(`a-${String(index).padStart(3, "0")}`);
    }
    await write("courses/curso-odisea/curso-1/s2/s2.md", "# Sesión 2\n");

    const result = await createAgentDocumentTools({ workspaceRoot: root }).searchDocuments({
      query: "curso odisea sesion 2"
    });

    expect(result.matches.map((match) => match.relativePath)).toContain("courses/curso-odisea/curso-1/s2/s2.md");
    expect(result.truncated).toBe(false);
  });

  it("finds depth-6 files by path search and lists them with sizes at depth 8", async () => {
    await write("a/b/c/d/e/f/deep-guide.md", "# Deep\n");
    const tools = createAgentDocumentTools({ workspaceRoot: root });

    const search = await tools.searchDocuments({ query: "deep guide" });
    expect(search.matches.map((match) => match.relativePath)).toContain("a/b/c/d/e/f/deep-guide.md");

    const listed = await tools.listDocuments({ depth: 8 });
    const row = listed.files.find((file) => file.relativePath === "a/b/c/d/e/f/deep-guide.md");
    expect(row?.sizeBytes).toBeGreaterThan(0);
    expect(row?.estimatedTokens).toBeGreaterThan(0);
  });

  it("gives content slots to path-relevant candidates first (regression: alphabetical content starvation)", async () => {
    await write("aaa.md", "nothing relevant here\n");
    await write("zzz-needle-phrase.md", "the needle phrase lives here\n");
    const tools = createAgentDocumentTools({ workspaceRoot: root, limits: { maxContentSearchFiles: 1 } });

    const result = await tools.searchDocuments({ query: "needle phrase" });

    // The single content slot went to the ranked candidate, not the
    // alphabetical first file.
    expect(result.searchedFiles).toBe(1);
    expect(result.matches).toContainEqual(
      expect.objectContaining({ relativePath: "zzz-needle-phrase.md", matchType: "content", line: 1 })
    );
  });

  it("scopes searches to a directory with scope-relative content depth", async () => {
    await write("courses/a/b/c/d/e/f/g/h/notes.md", "the hidden insight\n");
    const tools = createAgentDocumentTools({ workspaceRoot: root });

    const unscoped = await tools.searchDocuments({ query: "hidden insight" });
    expect(unscoped.matches.filter((match) => match.matchType === "content")).toEqual([]);

    const scoped = await tools.searchDocuments({ query: "hidden insight", directory: "courses" });
    expect(scoped.matches).toContainEqual(
      expect.objectContaining({ relativePath: "courses/a/b/c/d/e/f/g/h/notes.md", matchType: "content" })
    );
  });

  it("validates the search directory with the same rules as list_documents", async () => {
    await write("notes/a.md", "alpha\n");
    const tools = createAgentDocumentTools({ workspaceRoot: root });

    await expect(tools.searchDocuments({ query: "alpha", directory: "missing" })).rejects.toMatchObject({
      code: "not_found"
    });
    await expect(tools.searchDocuments({ query: "alpha", directory: "notes/a.md" })).rejects.toMatchObject({
      code: "not_directory"
    });
    await expect(tools.searchDocuments({ query: "alpha", directory: ".hidden" })).rejects.toMatchObject({
      code: "invalid_path"
    });
    await expect(tools.searchDocuments({ query: "alpha", directory: "../outside" })).rejects.toMatchObject({
      code: "invalid_path"
    });
  });

  it("uses directory scope as the escape hatch when tiny caps truncate the unscoped walk", async () => {
    await write("aaa/filler-1.md", "filler\n");
    await write("aaa/filler-2.md", "filler\n");
    await write("courses/target/sesion-dos.md", "# Sesión dos\n");
    const tools = createAgentDocumentTools({ workspaceRoot: root, limits: { maxDirectories: 2 } });

    const unscoped = await tools.searchDocuments({ query: "sesion dos" });
    expect(unscoped.matches).toEqual([]);
    expect(unscoped.truncated).toBe(true);

    const scoped = await tools.searchDocuments({ query: "sesion dos", directory: "courses/target" });
    expect(scoped.matches.map((match) => match.relativePath)).toContain("courses/target/sesion-dos.md");
  });

  it("open_document validates like a read, invokes the open callback once, and never reads content", async () => {
    await write("courses/curso-1/s2/s2.md", "# Sesión\n");
    await write("notes.txt", "not markdown\n");
    const opened: string[] = [];
    const tools = createAgentDocumentTools({
      workspaceRoot: root,
      onOpenDocument: (relativePath) => opened.push(relativePath)
    });

    const result = await tools.openDocument({ path: "courses/curso-1/s2/s2.md" });
    expect(result).toEqual({ relativePath: "courses/curso-1/s2/s2.md" });
    expect(opened).toEqual(["courses/curso-1/s2/s2.md"]);

    await mkdirp("folder.md");
    await expect(tools.openDocument({ path: "missing.md" })).rejects.toMatchObject({ code: "not_found" });
    await expect(tools.openDocument({ path: "folder.md" })).rejects.toMatchObject({ code: "not_file" });
    await expect(tools.openDocument({ path: "notes.txt" })).rejects.toMatchObject({ code: "not_markdown" });
    await expect(tools.openDocument({ path: ".hidden/x.md" })).rejects.toMatchObject({ code: "invalid_path" });
    await expect(tools.openDocument({ path: "../outside.md" })).rejects.toMatchObject({ code: "invalid_path" });
    expect(opened).toHaveLength(1);

    const controller = new AbortController();
    controller.abort();
    await expect(tools.openDocument({ path: "courses/curso-1/s2/s2.md" }, controller.signal)).rejects.toThrow(
      "Request canceled."
    );
    expect(opened).toHaveLength(1);
  });

  it("aborts promptly when the signal is already aborted", async () => {
    await write("doc.md", "content\n");
    const tools = createAgentDocumentTools({ workspaceRoot: root });
    const controller = new AbortController();
    controller.abort();

    await expect(tools.searchDocuments({ query: "content" }, controller.signal)).rejects.toThrow("Request canceled.");
    await expect(tools.listDocuments({}, controller.signal)).rejects.toThrow("Request canceled.");
    await expect(tools.readDocument({ path: "doc.md" }, controller.signal)).rejects.toThrow("Request canceled.");
  });
});
