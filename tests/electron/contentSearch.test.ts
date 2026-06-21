import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { searchMarkdownContent } from "../../electron/fs/contentSearch";

let workspaceRoot: string;

async function write(relativePath: string, content: string) {
  const filePath = path.join(workspaceRoot, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
  return filePath;
}

describe("markdown content search", () => {
  beforeEach(async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "iliad-content-search-"));
  });

  afterEach(async () => {
    await rm(workspaceRoot, { force: true, recursive: true });
  });

  it("finds text in Markdown files and ignores external, hidden, and ignored paths", async () => {
    await write("drafts/one.md", "alpha beta\nbeta again");
    await write("drafts/two.txt", "beta external");
    await write(".secret.md", "beta hidden");
    await write(".hidden/three.md", "beta hidden directory");
    await write("node_modules/four.md", "beta ignored");
    await write("__tmp-draft.md", "beta temporary");

    const response = await searchMarkdownContent({
      workspaceRoot,
      query: "beta",
      matchCase: false,
      wholeWord: false,
      regex: false
    });

    expect(response.status).toBe("ok");
    expect(response.returnedFiles).toBe(1);
    expect(response.returnedMatches).toBe(2);
    expect(response.files[0]?.relativePath).toBe("drafts/one.md");
    expect(response.files[0]?.matches.map((match) => match.lineNumber)).toEqual([1, 2]);
  });

  it("skips symlinked Markdown files and directories", async () => {
    const realFile = await write("real.md", "needle real");
    const realDirectory = path.join(workspaceRoot, "real-dir");
    await mkdir(realDirectory);
    await writeFile(path.join(realDirectory, "inside.md"), "needle symlinked directory", "utf8");
    await symlink(realFile, path.join(workspaceRoot, "link.md"));
    await symlink(realDirectory, path.join(workspaceRoot, "linked-dir"), "dir");

    const response = await searchMarkdownContent({
      workspaceRoot,
      query: "needle",
      matchCase: false,
      wholeWord: false,
      regex: false
    });

    expect(response.files.map((file) => file.relativePath)).toEqual(["real-dir/inside.md", "real.md"]);
    expect(response.files.some((file) => file.relativePath === "link.md")).toBe(false);
    expect(response.files.some((file) => file.relativePath === "linked-dir/inside.md")).toBe(false);
  });

  it("respects match case, whole word, and valid regex options", async () => {
    await write("case.md", "Alpha alpha alphabet beta-42 beta-7");

    const caseSensitive = await searchMarkdownContent({
      workspaceRoot,
      query: "Alpha",
      matchCase: true,
      wholeWord: false,
      regex: false
    });
    const wholeWord = await searchMarkdownContent({
      workspaceRoot,
      query: "alpha",
      matchCase: false,
      wholeWord: true,
      regex: false
    });
    const regex = await searchMarkdownContent({
      workspaceRoot,
      query: "beta-\\d+",
      matchCase: false,
      wholeWord: false,
      regex: true
    });

    expect(caseSensitive.returnedMatches).toBe(1);
    expect(caseSensitive.files[0]?.matches[0]?.matchedText).toBe("Alpha");
    expect(wholeWord.returnedMatches).toBe(2);
    expect(regex.files[0]?.matches.map((match) => match.matchedText)).toEqual(["beta-42", "beta-7"]);
  });

  it("reports invalid regex without scanning and guards zero-length regex matches", async () => {
    await write("doc.md", "alpha\nbeta");

    const invalid = await searchMarkdownContent({
      workspaceRoot,
      query: "(",
      matchCase: false,
      wholeWord: false,
      regex: true
    });
    const zeroLength = await searchMarkdownContent({
      workspaceRoot,
      query: "^",
      matchCase: false,
      wholeWord: false,
      regex: true
    });

    expect(invalid.status).toBe("invalid_regex");
    expect(invalid.scannedMarkdownFiles).toBe(0);
    expect(invalid.visitedEntries).toBe(0);
    expect(invalid.invalidRegexMessage).toBeTruthy();
    expect(zeroLength.status).toBe("ok");
    expect(zeroLength.returnedMatches).toBe(0);
    expect(zeroLength.scannedMarkdownFiles).toBe(1);
  });

  it("returns raw-document UTF-16 offsets, line numbers, columns, matched text, ranges, and snippets", async () => {
    await write("unicode.md", "héllo 😀\r\nnext héllo");

    const response = await searchMarkdownContent({
      workspaceRoot,
      query: "héllo",
      matchCase: true,
      wholeWord: false,
      regex: false
    });

    expect(response.returnedMatches).toBe(2);
    expect(response.files[0]?.matches[0]).toMatchObject({
      lineNumber: 1,
      lineText: "héllo 😀",
      matchedText: "héllo",
      startOffset: 0,
      endOffset: 5,
      startColumn: 0,
      endColumn: 5,
      ranges: [{ startColumn: 0, endColumn: 5 }]
    });
    expect(response.files[0]?.matches[1]).toMatchObject({
      lineNumber: 2,
      lineText: "next héllo",
      matchedText: "héllo",
      startOffset: 15,
      endOffset: 20,
      startColumn: 5,
      endColumn: 10,
      ranges: [{ startColumn: 5, endColumn: 10 }]
    });
  });

  it("caps returned matches and files with truncation metadata", async () => {
    await write("a.md", "hit hit hit");
    await write("b.md", "hit");

    const matchCapped = await searchMarkdownContent({
      workspaceRoot,
      query: "hit",
      matchCase: false,
      wholeWord: false,
      regex: false,
      maxReturnedMatches: 2
    });
    const fileCapped = await searchMarkdownContent({
      workspaceRoot,
      query: "hit",
      matchCase: false,
      wholeWord: false,
      regex: false,
      maxReturnedFiles: 1
    });

    expect(matchCapped.returnedMatches).toBe(2);
    expect(matchCapped.truncatedReasons).toContain("matches");
    expect(fileCapped.returnedFiles).toBe(1);
    expect(fileCapped.truncatedReasons).toContain("files");
  });

  it("caps visited entries, scanned Markdown files, directory depth, and query length", async () => {
    await write("a.md", "hit");
    await write("b.md", "hit");
    await write("deep/child/grandchild.md", "hit");

    const visitedCapped = await searchMarkdownContent({
      workspaceRoot,
      query: "hit",
      matchCase: false,
      wholeWord: false,
      regex: false,
      maxVisitedEntries: 1
    });
    const scannedCapped = await searchMarkdownContent({
      workspaceRoot,
      query: "hit",
      matchCase: false,
      wholeWord: false,
      regex: false,
      maxScannedMarkdownFiles: 1
    });
    const depthCapped = await searchMarkdownContent({
      workspaceRoot,
      query: "hit",
      matchCase: false,
      wholeWord: false,
      regex: false,
      maxDirectoryDepth: 1
    });
    const queryCapped = await searchMarkdownContent({
      workspaceRoot,
      query: "hit".repeat(100),
      matchCase: false,
      wholeWord: false,
      regex: false
    });

    expect(visitedCapped.truncatedReasons).toContain("visited_entries");
    expect(scannedCapped.truncatedReasons).toContain("scanned_files");
    expect(depthCapped.truncatedReasons).toContain("directory_depth");
    expect(queryCapped.truncatedReasons).toContain("query_length");
    expect(queryCapped.query.length).toBe(200);
  });

  it("skips files above the max size and counts oversized skips separately", async () => {
    await write("large.md", "needle ".repeat(20));
    await write("small.md", "needle");

    const response = await searchMarkdownContent({
      workspaceRoot,
      query: "needle",
      matchCase: false,
      wholeWord: false,
      regex: false,
      maxFileBytes: 20
    });

    expect(response.files.map((file) => file.relativePath)).toEqual(["small.md"]);
    expect(response.skippedOversizedFiles).toBe(1);
    expect(response.truncatedReasons).not.toContain("matches");
  });
});
