import { describe, expect, it } from "vitest";
import {
  collectMarkdownContextDocuments,
  contextAttachmentDisplayLabels,
  createContextFileDragPayload,
  findActiveMentionToken,
  rankMarkdownContextDocuments,
  readContextFileDragPayload,
  replaceMentionTokenWithPath
} from "../../src/assistant/contextAttachments";
import type { FileTreeNode } from "../../src/types/iliad";

function fileNode(relativePath: string, kind: FileTreeNode["kind"] = "markdown", children?: FileTreeNode[]): FileTreeNode {
  const name = relativePath.split(/[\\/]/).filter(Boolean).pop() ?? relativePath;

  return {
    name,
    path: `/workspace/${relativePath}`,
    relativePath,
    kind,
    children
  };
}

describe("context attachment suggestions", () => {
  it("collects visible markdown files from the file tree only", () => {
    const documents = collectMarkdownContextDocuments([
      fileNode("notes", "directory", [
        fileNode("notes/s2.md"),
        fileNode("notes/image.png", "external"),
        fileNode("notes/.hidden.md"),
        fileNode("notes/node_modules/package.md")
      ]),
      fileNode("report.markdown")
    ]);

    expect(documents.map((document) => document.relativePath)).toEqual(["notes/s2.md", "report.markdown"]);
  });

  it("matches diacritics case-insensitively and normalizes query spaces to hyphens", () => {
    const documents = collectMarkdownContextDocuments([
      fileNode("reports/reporte-control-calidad.md"),
      fileNode("reports/Árbol-de-decisiones.md")
    ]);

    expect(
      rankMarkdownContextDocuments(documents, {
        query: "REPORTE CONTROL",
        activeRelativePath: null
      }).map((document) => document.relativePath)
    ).toEqual(["reports/reporte-control-calidad.md"]);

    expect(
      rankMarkdownContextDocuments(documents, {
        query: "arbol",
        activeRelativePath: null
      }).map((document) => document.relativePath)
    ).toEqual(["reports/Árbol-de-decisiones.md"]);
  });

  it("orders match class, active sibling directory, path length, then stable path", () => {
    const documents = collectMarkdownContextDocuments([
      fileNode("deep/reports/report.md"),
      fileNode("s3/report.md"),
      fileNode("s2/report-longer.md"),
      fileNode("appendix/project-report.md")
    ]);

    expect(
      rankMarkdownContextDocuments(documents, {
        query: "report",
        activeRelativePath: "s2/current.md"
      }).map((document) => document.relativePath)
    ).toEqual(["s2/report-longer.md", "s3/report.md", "deep/reports/report.md", "appendix/project-report.md"]);
  });

  it("shows bare @ suggestions with active-directory siblings first", () => {
    const documents = collectMarkdownContextDocuments([
      fileNode("zeta.md"),
      fileNode("notes/a.md"),
      fileNode("alpha.md")
    ]);

    expect(
      rankMarkdownContextDocuments(documents, {
        query: "",
        activeRelativePath: "notes/current.md"
      }).map((document) => document.relativePath)
    ).toEqual(["notes/a.md", "zeta.md", "alpha.md"]);
  });
});

describe("context attachment mention tokens", () => {
  it("finds @ tokens at input start or after whitespace", () => {
    expect(findActiveMentionToken("@rep", 4)).toEqual({ start: 0, end: 4, query: "rep" });
    expect(findActiveMentionToken("Use this. @rep", 14)).toEqual({ start: 10, end: 14, query: "rep" });
  });

  it("does not trigger in email addresses, inline code, fenced code, or after a space", () => {
    expect(findActiveMentionToken("me@example.com", 14)).toBeNull();
    expect(findActiveMentionToken("Use `@rep", 9)).toBeNull();
    expect(findActiveMentionToken("```\n@rep", 8)).toBeNull();
    expect(findActiveMentionToken("@rep now", 8)).toBeNull();
  });

  it("replaces a partial @ query with the selected canonical Markdown path", () => {
    const prompt = "Suggest changes based on @course-";
    const token = findActiveMentionToken(prompt, prompt.length);

    expect(token).not.toBeNull();
    const result = replaceMentionTokenWithPath(prompt, token!, "course-summary-2026-borrador.md");

    expect(result).toEqual({
      text: "Suggest changes based on @course-summary-2026-borrador.md ",
      caret: "Suggest changes based on @course-summary-2026-borrador.md ".length
    });
    expect(findActiveMentionToken(result.text, result.caret)).toBeNull();
  });

  it("preserves text after the selected @ query", () => {
    const token = { start: 5, end: 9, query: "rep" };

    const result = replaceMentionTokenWithPath("Read @rep, then summarize", token, "reports/reporte.md");

    expect(result).toEqual({
      text: "Read @reports/reporte.md, then summarize",
      caret: "Read @reports/reporte.md, ".length
    });
    expect(findActiveMentionToken(result.text, result.caret)).toBeNull();
  });
});

describe("context attachment labels and drag payloads", () => {
  it("disambiguates duplicate basenames with the shortest unique parent suffix", () => {
    const labels = contextAttachmentDisplayLabels(["s2/report.md", "s3/report.md", "notes/summary.md"]);

    expect(labels.get("s2/report.md")).toBe("s2/report.md");
    expect(labels.get("s3/report.md")).toBe("s3/report.md");
    expect(labels.get("notes/summary.md")).toBe("summary.md");
  });

  it("accepts only current-workspace markdown drag payloads", () => {
    const payload = createContextFileDragPayload("workspace-session", "notes/s2.md");

    expect(readContextFileDragPayload(JSON.stringify(payload), "workspace-session")).toEqual(payload);
    expect(readContextFileDragPayload(JSON.stringify(payload), "other-session")).toBeNull();
    expect(
      readContextFileDragPayload(
        JSON.stringify(createContextFileDragPayload("workspace-session", ".hidden/s2.md")),
        "workspace-session"
      )
    ).toBeNull();
  });
});
