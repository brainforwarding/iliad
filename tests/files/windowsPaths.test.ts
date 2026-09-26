import { expect, it } from "vitest";
import { pathsEqual, pathIsSameOrInside, relocatePath } from "../../src/files/pathUtils";
import { fileTreeRevealAncestorPaths, type FileTreeDisplayNode } from "../../src/review/pendingFileTree";

it("reveals a Windows node using different separators and drive casing", () => {
  const nodes: FileTreeDisplayNode[] = [{ source: "real", node: {
    path: "C:\\Book\\Draft.md", relativePath: "Draft.md", name: "Draft.md", kind: "markdown"
  } }];
  expect(fileTreeRevealAncestorPaths(nodes, "c:/book/draft.md")).toEqual([]);
  expect(pathsEqual("/book/Draft.md", "/book/draft.md")).toBe(false);
  expect(pathIsSameOrInside("C:\\Book", "c:/bookish/doc.md")).toBe(false);
  expect(relocatePath("C:\\Book", "D:\\NewBook", "c:/book/Draft.md")).toBe("D:/NewBook/Draft.md");
});

it("preserves root identity and descendant boundaries", () => {
  expect(pathsEqual("/", "")).toBe(false);
  expect(pathIsSameOrInside("/", "/book/doc.md")).toBe(true);
  expect(pathIsSameOrInside("C:/", "c:/book/doc.md")).toBe(true);
});
