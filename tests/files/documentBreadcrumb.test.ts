import { describe, expect, it } from "vitest";
import { documentBreadcrumbParts } from "../../src/files/pathUtils";

describe("documentBreadcrumbParts", () => {
  it("starts with the workspace, then folders, then the name without .md", () => {
    expect(documentBreadcrumbParts("docs", "Circles/actividad-escucha.md")).toEqual(["docs", "Circles", "actividad-escucha"]);
  });

  it("handles a root document and other Markdown extensions", () => {
    expect(documentBreadcrumbParts("docs", "notes.markdown")).toEqual(["docs", "notes"]);
    expect(documentBreadcrumbParts("docs", "a/b/C.MD")).toEqual(["docs", "a", "b", "C"]);
  });

  it("keeps other extensions and normalizes separators and empty segments", () => {
    expect(documentBreadcrumbParts("docs", "a\\b//readme.txt")).toEqual(["docs", "a", "b", "readme.txt"]);
    expect(documentBreadcrumbParts("docs", "./a.md")).toEqual(["docs", "a"]);
  });

  it("keeps a name that is only an extension, and works without a workspace name", () => {
    expect(documentBreadcrumbParts("docs", ".md")).toEqual(["docs", ".md"]);
    expect(documentBreadcrumbParts("", "a/b.md")).toEqual(["a", "b"]);
    expect(documentBreadcrumbParts("docs", "")).toEqual(["docs"]);
  });
});
